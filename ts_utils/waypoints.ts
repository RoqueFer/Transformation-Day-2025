// ESSE CODIGO ESTÁ ASSINCRONO PARA FACILITAR O DESENVOLVIMENTO, MAS PARA MAXIIMO DESEMPENHO ALTERE MAX_CONCURRENT PARA 1 E TIMEOUT DE 5000 

// Script para buscar eletropostos (postos de carregamento para veículos elétricos)
// ao longo da rota entre Curitiba e São Paulo usando APIs gratuitas

import { writeFile } from "fs/promises";

// =============== CONFIGURAÇÕES PRINCIPAIS ===============
// Coordenadas de início e fim da rota (Curitiba → São Paulo)
const START_COORDS: [number, number] = [-49.2733, -25.4284];
const END_COORDS: [number, number] = [-46.6333, -23.5505];

// Chave de API para o OpenChargeMap (obtenha uma gratuitamente em openchargemap.io)
const OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94";

// Configurações de busca
const WAYPOINT_STEP = 25;        // Espaçamento entre pontos na rota (quanto menor, mais postos mas mais lento)
const MAX_CONCURRENT_REQUESTS = 10; // Número máximo de requisições simultâneas
const FETCH_TIMEOUT_MS = 12000;  // Tempo máximo para cada requisição (ms)
const SEARCH_RADIUS_KM = 4.5;    // Raio de busca em quilômetros ao redor de cada ponto

// =============== INTERFACES E TIPOS ===============
/**
 * Representa um eletroposto (estação de carregamento)
 */
interface Eletroposto {
  id: string;           // Identificador único
  name: string;         // Nome do posto
  latitude: number;     // Coordenada latitude
  longitude: number;    // Coordenada longitude
  address: string;      // Endereço completo
  network: string;      // Rede/operadora do posto
  connectorType: string[]; // Tipos de conectores disponíveis
  power: string;        // Potência de carregamento
  access: string;       // Tipo de acesso (público, privado, etc.)
  source: string;       // Fonte dos dados (OpenChargeMap ou OpenStreetMap)
  distanceFromRoute?: number; // Distância aproximada da rota principal
}

// =============== FUNÇÕES UTILITÁRIAS ===============
/**
 * Calcula a distância entre dois pontos geográficos usando a fórmula de Haversine
 * @returns Distância em quilômetros
 */
function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const converterParaRadianos = (graus: number) => graus * Math.PI / 180;
  const RAIO_TERRA_KM = 6371;
  
  const dLat = converterParaRadianos(lat2 - lat1);
  const dLon = converterParaRadianos(lon2 - lon1);
  
  const a = Math.sin(dLat/2)**2 + 
            Math.cos(converterParaRadianos(lat1)) * 
            Math.cos(converterParaRadianos(lat2)) * 
            Math.sin(dLon/2)**2;
            
  return 2 * RAIO_TERRA_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Executa uma requisição com timeout
 * @param url URL para requisição
 * @param options Opções da requisição
 * @param timeoutMs Tempo máximo de espera em milissegundos
 */
async function requisicaoComTimeout(url: string, options: any, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Executa uma requisição com sistema de repetição em caso de falha
 * @param url URL para requisição
 * @param options Opções da requisição
 * @param timeoutMs Tempo máximo de espera
 * @param tentativasMax Número máximo de tentativas
 * @param mirrors Espelhos alternativos (para APIs como Overpass)
 */
async function requisicaoComRetry(
  url: string,
  options: any,
  timeoutMs: number,
  tentativasMax = 3,
  mirrors: string[] = []
): Promise<Response> {
  let ultimoErro: any;

  for (let tentativa = 0; tentativa <= tentativasMax; tentativa++) {
    try {
      const resposta = await requisicaoComTimeout(url, options, timeoutMs);

      if (resposta.ok) return resposta;

      // Em caso de erro do servidor ou limite de requisições, tenta novamente
      if ([429, 500, 502, 503, 504].includes(resposta.status)) {
        const tempoEspera = (2 ** tentativa) * 1000; // Espera exponencial: 1s, 2s, 4s...
        console.log(`⚠️ HTTP ${resposta.status} em ${url}, nova tentativa em ${tempoEspera}ms...`);
        await new Promise(resolver => setTimeout(resolver, tempoEspera));

        // Para APIs com espelhos, tenta um espelho diferente a cada tentativa
        if (mirrors.length > 0 && tentativa < mirrors.length) {
          const proximoMirror = mirrors[tentativa % mirrors.length];
          url = url.replace(/^https:\/\/[^/]+/, proximoMirror);
          console.log(`🔄 Tentando mirror: ${proximoMirror}`);
        }

        continue;
      }

      throw new Error(`HTTP ${resposta.status}`);
    } catch (erro: any) {
      ultimoErro = erro;
      if (tentativa === tentativasMax) break;

      const tempoEspera = (2 ** tentativa) * 1000;
      console.log(`⚠️ Falha: ${erro.message}, na url: ${mirrors[tentativa]} nova tentativa em ${tempoEspera}ms...`);
      await new Promise(resolver => setTimeout(resolver, tempoEspera));
    }
  }

  throw ultimoErro || new Error("Todas as tentativas falharam");
}

// =============== INTEGRAÇÕES COM APIs ===============
/**
 * Busca eletropostos no OpenChargeMap
 * @param lat Latitude do ponto de busca
 * @param lon Longitude do ponto de busca
 */
async function buscarOpenChargeMap(lat: number, lon: number): Promise<Eletroposto[]> {
  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&latitude=${lat}&longitude=${lon}&distance=${SEARCH_RADIUS_KM}&distanceunit=KM&maxresults=100`;
  
  try {
    const resposta = await requisicaoComRetry(url, { 
      headers: { "X-API-Key": OCM_API_KEY }
    }, FETCH_TIMEOUT_MS);
    
    if (!resposta.ok) {
      console.log(`⚠️ OpenChargeMap retornou HTTP ${resposta.status}`);
      return [];
    }
    
    const dados = await resposta.json();
    
    // Converte os dados da API para o formato interno
    return dados.map((posto: any) => {
      const postoLat = posto.AddressInfo?.Latitude || 0;
      const postoLon = posto.AddressInfo?.Longitude || 0;
      const distancia = calcularDistancia(lat, lon, postoLat, postoLon);
      
      return {
        id: `ocm_${posto.ID}`,
        name: posto.AddressInfo?.Title || "Posto sem nome",
        latitude: postoLat,
        longitude: postoLon,
        address: [
          posto.AddressInfo?.AddressLine1,
          posto.AddressInfo?.Town,
          posto.AddressInfo?.StateOrProvince
        ].filter(Boolean).join(", "),
        network: posto.OperatorInfo?.Title || "Rede desconhecida",
        connectorType: posto.Connections?.map((c: any) => c.ConnectionType?.Title).filter(Boolean) || ["Desconhecido"],
        power: posto.Connections?.[0]?.PowerKW ? `${posto.Connections[0].PowerKW}kW` : "N/A",
        access: posto.UsageType?.Title || "N/A",
        source: "OpenChargeMap",
        distanceFromRoute: distancia
      };
    });
  } catch (erro: any) {
    console.log(`❌ Erro no OpenChargeMap: ${erro.message}`);
    return [];
  }
}

/**
 * Busca eletropostos no OpenStreetMap através da API Overpass
 * @param lat Latitude do ponto de busca
 * @param lon Longitude do ponto de busca
 */
async function buscarOpenStreetMap(lat: number, lon: number): Promise<Eletroposto[]> {
  // Query para a API Overpass - busca elementos com amenity=charging_station
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="charging_station"](around:${Math.round(SEARCH_RADIUS_KM * 1000)},${lat},${lon});
      way["amenity"="charging_station"](around:${Math.round(SEARCH_RADIUS_KM * 1000)},${lat},${lon});
      relation["amenity"="charging_station"](around:${Math.round(SEARCH_RADIUS_KM * 1000)},${lat},${lon});
    );
    out center meta;
  `;
  
  // Lista de servidores espelho da API Overpass
  const mirrors = [
    "https://overpass-api.de/api",
    "https://overpass.kumi.systems/api",
    "https://lz4.overpass-api.de/api"
  ];

  try {
    const resposta = await requisicaoComRetry(`${mirrors[0]}/interpreter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'EletropostoBrasil/1.0'
      },
      body: query
    }, FETCH_TIMEOUT_MS, 3);
    
    if (!resposta.ok) {
      console.log(`⚠️ API Overpass retornou HTTP ${resposta.status}`);
      return [];
    }
    
    const dados = await resposta.json();
    
    // Converte os dados do OSM para o formato interno
    return dados.elements.map((elemento: any) => {
      const elementoLat = elemento.lat || elemento.center?.lat || lat;
      const elementoLon = elemento.lon || elemento.center?.lon || lon;
      const distancia = calcularDistancia(lat, lon, elementoLat, elementoLon);
      
      // Extrai informações das tags OSM
      const tags = elemento.tags || {};
      
      // Determina os tipos de conectores baseado nas tags OSM
      const conectores: string[] = [];
      if (tags['socket:type2']) conectores.push(`Type2 (${tags['socket:type2']}x)`);
      if (tags['socket:ccs']) conectores.push(`CCS2 (${tags['socket:ccs']}x)`);
      if (tags['socket:chademo']) conectores.push(`CHAdeMO (${tags['socket:chademo']}x)`);
      if (tags['socket:tesla_supercharger']) conectores.push(`Tesla SC (${tags['socket:tesla_supercharger']}x)`);
      if (tags['socket:tesla_destination']) conectores.push(`Tesla Dest (${tags['socket:tesla_destination']}x)`);
      if (tags['socket:schuko']) conectores.push(`Schuko (${tags['socket:schuko']}x)`);
      if (conectores.length === 0) conectores.push("Tipo não especificado");
      
      return {
        id: `osm_${elemento.id}`,
        name: tags.name || tags.operator || tags.brand || `Eletroposto OSM`,
        latitude: elementoLat,
        longitude: elementoLon,
        address: [
          tags['addr:street'] && tags['addr:housenumber'] ? 
            `${tags['addr:street']}, ${tags['addr:housenumber']}` : tags['addr:street'],
          tags['addr:city'] || tags['addr:suburb'],
          tags['addr:state']
        ].filter(Boolean).join(", ") || "Endereço não informado",
        network: tags.network || tags.operator || tags.brand || "Rede não informada",
        connectorType: conectores,
        power: tags.maxpower || tags['socket:type2:output'] || tags.capacity || "Potência não informada",
        access: tags.access === "private" ? "Privado" : 
                tags.access === "customers" ? "Clientes" : 
                "Público",
        source: "OpenStreetMap",
        distanceFromRoute: distancia
      };
    });
    
  } catch (erro: any) {
    console.log(`❌ Erro no OpenStreetMap: ${erro.message}`);
    return [];
  }
}

// =============== LÓGICA PRINCIPAL ===============
/**
 * Busca eletropostos em um ponto específico da rota usando todas as APIs disponíveis
 * @param lat Latitude do ponto
 * @param lon Longitude do ponto
 * @param indiceWaypoint Índice do ponto na rota (para logging)
 */
async function buscarEletropostosNoPonto(lat: number, lon: number, indiceWaypoint: number): Promise<Eletroposto[]> {
  console.log(`🎯 Ponto ${indiceWaypoint} [${lat.toFixed(4)}, ${lon.toFixed(4)}]`);
  
  // Executa as buscas em paralelo
  const [resultadoOCM, resultadoOSM] = await Promise.allSettled([
    buscarOpenChargeMap(lat, lon),
    buscarOpenStreetMap(lat, lon)
  ]);
  
  const postos: Eletroposto[] = [];
  
  // Processa resultados do OpenChargeMap
  if (resultadoOCM.status === "fulfilled") {
    postos.push(...resultadoOCM.value);
    console.log(`   ✅ OpenChargeMap: ${resultadoOCM.value.length} postos`);
  } else {
    console.log(`   ❌ OpenChargeMap: Falhou`);
  }
  
  // Processa resultados do OpenStreetMap
  if (resultadoOSM.status === "fulfilled") {
    postos.push(...resultadoOSM.value);
    console.log(`   ✅ OpenStreetMap: ${resultadoOSM.value.length} postos`);
  } else {
    console.log(`   ❌ OpenStreetMap: Falhou`);
  }
  
  // Filtra postos que estão realmente dentro do raio de busca
  const postosDentroDoRaio = postos.filter(posto => {
    const distancia = calcularDistancia(lat, lon, posto.latitude, posto.longitude);
    return distancia <= SEARCH_RADIUS_KM;
  });
  
  console.log(`   📍 Total válidos: ${postosDentroDoRaio.length}`);
  return postosDentroDoRaio;
}

/**
 * Função principal que orquestra todo o processo
 */
async function main() {
  console.log("🚗 BUSCA DE ELETROPOSTOS - SÓ APIS GRATUITAS");
  console.log("📍 Rota: Curitiba → São Paulo");
  console.log("🔑 APIs usadas: OpenChargeMap (sua chave) + OpenStreetMap (gratuita)");
  console.log(`⚙️  Configurações: raio ${SEARCH_RADIUS_KM}km, passo ${WAYPOINT_STEP}, requisições simultâneas ${MAX_CONCURRENT_REQUESTS}`);
  
  // Obtém a rota da API OSRM
  console.log("\n🗺️  Calculando rota...");
  const urlOSRM = `https://router.project-osrm.org/route/v1/driving/${START_COORDS.join(",")};${END_COORDS.join(",")}?overview=full&geometries=geojson`;
  const respostaRota = await requisicaoComRetry(urlOSRM, {}, FETCH_TIMEOUT_MS, 3);
  
  if (!respostaRota.ok) {
    throw new Error(`Erro ao obter rota: ${respostaRota.status}`);
  }
  
  const dadosRota = await respostaRota.json();
  const waypoints: [number, number][] = dadosRota.routes[0].geometry.coordinates;
  const waypointsAmostrados = waypoints.filter((_, i) => i % WAYPOINT_STEP === 0);
  
  console.log(`📍 Total de pontos na rota: ${waypoints.length}`);
  console.log(`🎯 Pontos selecionados para busca: ${waypointsAmostrados.length}`);
  
  const todosPostos: Eletroposto[] = [];
  let waypointsProcessados = 0;
  
  // Processa os pontos em lotes para controlar o número de requisições simultâneas
  for (let i = 0; i < waypointsAmostrados.length; i += MAX_CONCURRENT_REQUESTS) {
    const lote = waypointsAmostrados.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const numeroLote = Math.floor(i / MAX_CONCURRENT_REQUESTS) + 1;
    const totalLotes = Math.ceil(waypointsAmostrados.length / MAX_CONCURRENT_REQUESTS);
    
    console.log(`\n📦 LOTE ${numeroLote}/${totalLotes} (pontos ${i}-${i + lote.length - 1})`);
    
    // Prepara as promessas para processamento em paralelo
    const promessas = lote.map(async ([lon, lat], indiceLote) => {
      const indiceWaypoint = i + indiceLote;
      // Adiciona um pequeno atraso entre requisições para evitar sobrecarga
      await new Promise(resolver => setTimeout(resolver, indiceLote * 100));
      return buscarEletropostosNoPonto(lat, lon, indiceWaypoint);
    });
    
    // Executa todas as buscas do lote em paralelo
    const resultados = await Promise.allSettled(promessas);
    
    // Processa os resultados do lote
    resultados.forEach((resultado, indice) => {
      waypointsProcessados++;
      if (resultado.status === "fulfilled") {
        todosPostos.push(...resultado.value);
      } else {
        console.log(`   💀 Ponto ${i + indice}: ${resultado.reason}`);
      }
    });
    
    // Exibe progresso
    const progresso = (waypointsProcessados / waypointsAmostrados.length * 100).toFixed(1);
    console.log(`📊 Progresso: ${progresso}% | Postos acumulados: ${todosPostos.length}`);
    
    // Pausa entre lotes para evitar sobrecarga das APIs
    if (i + MAX_CONCURRENT_REQUESTS < waypointsAmostrados.length) {
      console.log("⏳ Aguardando 800ms antes do próximo lote...");
      await new Promise(resolver => setTimeout(resolver, 800));
    }
  }
  
  console.log(`\n🔍 Removendo duplicatas...`);
  
  // Remove postos duplicados (com base na proximidade)
  const postosUnicos: Eletroposto[] = [];
  const DISTANCIA_MINIMA_KM = 0.05; // 50 metros
  
  todosPostos.forEach(posto => {
    const duplicata = postosUnicos.find(existente => {
      const distancia = calcularDistancia(
        posto.latitude, posto.longitude, 
        existente.latitude, existente.longitude
      );
      return distancia < DISTANCIA_MINIMA_KM;
    });
    
    if (!duplicata) {
      postosUnicos.push(posto);
    } else {
      // Mantém o posto com mais informações (mais tipos de conectores)
      if (posto.connectorType.length > duplicata.connectorType.length) {
        const indice = postosUnicos.indexOf(duplicata);
        postosUnicos[indice] = posto;
      }
    }
  });
  
  // Ordena por distância da rota (mais próximos primeiro)
  postosUnicos.sort((a, b) => (a.distanceFromRoute || 999) - (b.distanceFromRoute || 999));
  
  // Gera estatísticas
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTADO FINAL");
  console.log("=".repeat(60));
  console.log(`🎯 Pontos processados: ${waypointsProcessados}`);
  console.log(`🔌 Postos encontrados: ${todosPostos.length}`);
  console.log(`✨ Postos únicos: ${postosUnicos.length}`);
  
  // Estatísticas por fonte de dados
  const porFonte: Record<string, number> = {};
  postosUnicos.forEach(posto => {
    porFonte[posto.source] = (porFonte[posto.source] || 0) + 1;
  });
  
  console.log(`\n📈 POSTOS POR FONTE:`);
  Object.entries(porFonte).forEach(([fonte, quantidade]) => {
    console.log(`   • ${fonte}: ${quantidade}`);
  });
  
  // Estatísticas por rede/operadora
  const porRede: Record<string, number> = {};
  postosUnicos.forEach(posto => {
    const rede = posto.network || "Desconhecida";
    porRede[rede] = (porRede[rede] || 0) + 1;
  });
  
  console.log(`\n🏢 PRINCIPAIS REDES:`);
  Object.entries(porRede)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 8)
    .forEach(([rede, quantidade]) => {
      console.log(`   • ${rede}: ${quantidade} posto${quantidade > 1 ? 's' : ''}`);
    });
  
  // Salva os resultados em arquivo JSON
  await writeFile("eletropostos_free_apis.json", JSON.stringify(postosUnicos, null, 2), "utf-8");
  console.log(`\n📁 Eletropostos salvos em: eletropostos_free_apis.json`);
  
  // Cria e salva um relatório detalhado
  const relatorio = {
    resumo: {
      waypoints: waypointsProcessados,
      postosEncontrados: todosPostos.length,
      postosUnicos: postosUnicos.length,
      dataProcessamento: new Date().toISOString()
    },
    configuracao: {
      origem: "Curitiba [-49.2733, -25.4284]",
      destino: "São Paulo [-46.6333, -23.5505]",
      waypointStep: WAYPOINT_STEP,
      raioKm: SEARCH_RADIUS_KM,
      concurrent: MAX_CONCURRENT_REQUESTS
    },
    estatisticas: {
      porFonte,
      porRede: Object.entries(porRede).sort(([,a], [,b]) => b - a)
    },
  };
  
  await writeFile("relatorio_free_apis.json", JSON.stringify(relatorio, null, 2), "utf-8");
  console.log("📊 Relatório salvo em: relatorio_free_apis.json");
  
  console.log("\n✅ Concluído! Usando apenas APIs gratuitas.");
  console.log("=".repeat(60));
}

// Inicia a execução do script
main().catch(console.error);