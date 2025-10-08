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
const WAYPOINT_STEP = 25; // Espaçamento entre pontos na rota (quanto menor, mais postos mas mais lento)
const BATCH_SIZE = 10; // AJUSTE: Aumentado para 10 com buffer no bbox (reduz requests sem perda)
const MAX_CONCURRENT_REQUESTS = 2; // AJUSTE: Reduzido para 2 para evitar 429 (mude para 1 se persistir)
const FETCH_TIMEOUT_MS = 5000; // AJUSTE: Reduzido para 5s como sugerido para desempenho
const SEARCH_RADIUS_KM = 1.5; // Raio de busca em quilômetros ao redor de cada ponto
const BBOX_BUFFER_DEG = 0.01; // AJUSTE: Buffer ~1km para expandir bbox (permite batches maiores)

// =============== INTERFACES E TIPOS ===============
/**
 * Representa um eletroposto (estação de carregamento)
 */
interface Eletroposto {
  id: string; // Identificador único
  name: string; // Nome do posto
  latitude: number; // Coordenada latitude
  longitude: number; // Coordenada longitude
  address: string; // Endereço completo
  network: string; // Rede/operadora do posto
  connectorType: string[]; // Tipos de conectores disponíveis
  power: string; // Potência de carregamento
  access: string; // Tipo de acesso (público, privado, etc.)
  source: string; // Fonte dos dados (OpenChargeMap ou OpenStreetMap)
  distanceFromRoute?: number; // Distância aproximada da rota principal
}

// =============== FUNÇÕES UTILITÁRIAS ===============
/**
 * Calcula a distância entre dois pontos geográficos usando a fórmula de Haversine
 * @returns Distância em quilômetros
 */
function calcularDistancia(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const converterParaRadianos = (graus: number) => (graus * Math.PI) / 180;
  const RAIO_TERRA_KM = 6371;

  const dLat = converterParaRadianos(lat2 - lat1);
  const dLon = converterParaRadianos(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(converterParaRadianos(lat1)) *
      Math.cos(converterParaRadianos(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * RAIO_TERRA_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula o bounding box (min/max lat/lon) para um array de coordenadas, com buffer
 */
function calcularBoundingBox(waypoints: [number, number][]): [number, number, number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  waypoints.forEach(([lon, lat]) => {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  });
  // AJUSTE: Adiciona buffer para cobrir mais área, permitindo batches maiores
  minLat -= BBOX_BUFFER_DEG;
  maxLat += BBOX_BUFFER_DEG;
  minLon -= BBOX_BUFFER_DEG;
  maxLon += BBOX_BUFFER_DEG;
  return [minLat, minLon, maxLat, maxLon]; // south, west, north, east
}

/**
 * Calcula a distância mínima de um posto para qualquer waypoint em um batch
 */
function distanciaMinimaAoBatch(postoLat: number, postoLon: number, batchWaypoints: [number, number][]): number {
  return Math.min(...batchWaypoints.map(([lon, lat]) => calcularDistancia(postoLat, postoLon, lat, lon)));
}

/**
 * Executa uma requisição com timeout
 * @param url URL para requisição
 * @param options Opções da requisição
 * @param timeoutMs Tempo máximo de espera em milissegundos
 */
async function requisicaoComTimeout(
  url: string,
  options: any,
  timeoutMs: number
): Promise<Response> {
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

      // AJUSTE: Tratamento específico para 429 (rate limit)
      if (resposta.status === 429) {
        const tempoEspera = Math.max(5000, 2 ** tentativa * 1000 + Math.random() * 500); // Min 5s para 429, com jitter
        console.log(
          `⚠️ Rate limit (429) em ${url}, esperando ${tempoEspera}ms antes de retry...`
        );
        await new Promise((resolver) => setTimeout(resolver, tempoEspera));
        continue;
      }

      // Outros erros de servidor
      if ([500, 502, 503, 504].includes(resposta.status)) {
        const tempoEspera = 2 ** tentativa * 1000 + Math.random() * 500; // Espera exponencial com jitter
        console.log(
          `⚠️ HTTP ${resposta.status} em ${url}, nova tentativa em ${tempoEspera}ms...`
        );
        await new Promise((resolver) => setTimeout(resolver, tempoEspera));

        // Tenta mirror
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

      const tempoEspera = 2 ** tentativa * 1000 + Math.random() * 500;
      console.log(
        `⚠️ Falha: ${erro.message} em ${url}, nova tentativa em ${tempoEspera}ms...`
      );
      await new Promise((resolver) => setTimeout(resolver, tempoEspera));
    }
  }

  throw ultimoErro || new Error("Todas as tentativas falharam");
}

// =============== INTEGRAÇÕES COM APIs ===============
/**
 * Busca eletropostos no OpenChargeMap usando bounding box
 * @param bbox [south, west, north, east]
 */
async function buscarOpenChargeMapBBox(
  bbox: [number, number, number, number]
): Promise<Eletroposto[]> {
  const [south, west, north, east] = bbox;
  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&boundingbox=${south},${west},${north},${east}&maxresults=50`; // AJUSTE: maxresults=50 para reduzir carga
  console.log(`🔍 OCM URL: ${url}`);

  try {
    const resposta = await requisicaoComRetry(
      url,
      {
        headers: { "X-API-Key": OCM_API_KEY },
      },
      FETCH_TIMEOUT_MS
    );

    if (!resposta.ok) {
      console.log(`⚠️ OpenChargeMap retornou HTTP ${resposta.status}`);
      return [];
    }

    const dados = await resposta.json();

    return dados.map((posto: any) => ({
      id: `ocm_${posto.ID}`,
      name: posto.AddressInfo?.Title || "Posto sem nome",
      latitude: posto.AddressInfo?.Latitude || 0,
      longitude: posto.AddressInfo?.Longitude || 0,
      address: [
        posto.AddressInfo?.AddressLine1,
        posto.AddressInfo?.Town,
        posto.AddressInfo?.StateOrProvince,
      ]
        .filter(Boolean)
        .join(", "),
      network: posto.OperatorInfo?.Title || "Rede desconhecida",
      connectorType: posto.Connections?.map(
        (c: any) => c.ConnectionType?.Title
      ).filter(Boolean) || ["Desconhecido"],
      power: posto.Connections?.[0]?.PowerKW
        ? `${posto.Connections[0].PowerKW}kW`
        : "N/A",
      access: posto.UsageType?.Title || "N/A",
      source: "OpenChargeMap",
    }));
  } catch (erro: any) {
    console.log(`❌ Erro no OpenChargeMap: ${erro.message}`);
    return [];
  }
}

/**
 * Busca eletropostos no OpenStreetMap usando bbox na Overpass
 * @param bbox [south, west, north, east]
 */
async function buscarOpenStreetMapBBox(
  bbox: [number, number, number, number]
): Promise<Eletroposto[]> {
  const [south, west, north, east] = bbox;
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="charging_station"](${south},${west},${north},${east});
      way["amenity"="charging_station"](${south},${west},${north},${east});
      relation["amenity"="charging_station"](${south},${west},${north},${east});
    );
    out center meta;
  `;
  console.log(`🔍 OSM Query:\n${query}`);

  const mirrors = [
    "https://overpass-api.de/api",
    "https://overpass.kumi.systems/api",
    "https://lz4.overpass-api.de/api",
  ];

  try {
    const resposta = await requisicaoComRetry(
      `${mirrors[0]}/interpreter`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": "EletropostoBrasil/1.0",
        },
        body: query,
      },
      FETCH_TIMEOUT_MS,
      3,
      mirrors // Passe mirrors para retry
    );

    if (!resposta.ok) {
      console.log(`⚠️ API Overpass retornou HTTP ${resposta.status}`);
      return [];
    }

    const dados = await resposta.json();

    return dados.elements.map((elemento: any) => {
      const elementoLat = elemento.lat || elemento.center?.lat || (south + north) / 2;
      const elementoLon = elemento.lon || elemento.center?.lon || (west + east) / 2;

      const tags = elemento.tags || {};

      const conectores: string[] = [];
      if (tags["socket:type2"]) conectores.push(`Type2 (${tags["socket:type2"]}x)`);
      if (tags["socket:ccs"]) conectores.push(`CCS2 (${tags["socket:ccs"]}x)`);
      if (tags["socket:chademo"]) conectores.push(`CHAdeMO (${tags["socket:chademo"]}x)`);
      if (tags["socket:tesla_supercharger"]) conectores.push(`Tesla SC (${tags["socket:tesla_supercharger"]}x)`);
      if (tags["socket:tesla_destination"]) conectores.push(`Tesla Dest (${tags["socket:tesla_destination"]}x)`);
      if (tags["socket:schuko"]) conectores.push(`Schuko (${tags["socket:schuko"]}x)`);
      if (conectores.length === 0) conectores.push("Tipo não especificado");

      return {
        id: `osm_${elemento.id}`,
        name: tags.name || tags.operator || tags.brand || `Eletroposto OSM`,
        latitude: elementoLat,
        longitude: elementoLon,
        address:
          [
            tags["addr:street"] && tags["addr:housenumber"]
              ? `${tags["addr:street"]}, ${tags["addr:housenumber"]}`
              : tags["addr:street"],
            tags["addr:city"] || tags["addr:suburb"],
            tags["addr:state"],
          ]
            .filter(Boolean)
            .join(", ") || "Endereço não informado",
        network:
          tags.network || tags.operator || tags.brand || "Rede não informada",
        connectorType: conectores,
        power:
          tags.maxpower ||
          tags["socket:type2:output"] ||
          tags.capacity ||
          "Potência não informada",
        access:
          tags.access === "private"
            ? "Privado"
            : tags.access === "customers"
            ? "Clientes"
            : "Público",
        source: "OpenStreetMap",
      };
    });
  } catch (erro: any) {
    console.log(`❌ Erro no OpenStreetMap: ${erro.message}`);
    return [];
  }
}

// =============== LÓGICA PRINCIPAL ===============
/**
 * Busca eletropostos em um batch de waypoints usando todas as APIs
 * @param batchWaypoints Array de waypoints no batch
 * @param indiceBatch Índice do batch na rota (para logging)
 */
async function buscarEletropostosNoBatch(
  batchWaypoints: [number, number][],
  indiceBatch: number
): Promise<Eletroposto[]> {
  if (batchWaypoints.length === 0) return [];

  console.log(
    `🎯 Batch ${indiceBatch} [${batchWaypoints.length} waypoints, bbox: ${batchWaypoints[0][1].toFixed(4)},${batchWaypoints[0][0].toFixed(4)} → ${batchWaypoints[batchWaypoints.length-1][1].toFixed(4)},${batchWaypoints[batchWaypoints.length-1][0].toFixed(4)}]`
  );

  const bbox = calcularBoundingBox(batchWaypoints);

  const [resultadoOCM, resultadoOSM] = await Promise.allSettled([
    buscarOpenChargeMapBBox(bbox),
    buscarOpenStreetMapBBox(bbox),
  ]);

  const postos: Eletroposto[] = [];

  if (resultadoOCM.status === "fulfilled") {
    postos.push(...resultadoOCM.value);
    console.log(`   ✅ OpenChargeMap: ${resultadoOCM.value.length} postos`);
  } else {
    console.log(`   ❌ OpenChargeMap: Falhou - ${resultadoOCM.reason}`);
  }

  if (resultadoOSM.status === "fulfilled") {
    postos.push(...resultadoOSM.value);
    console.log(`   ✅ OpenStreetMap: ${resultadoOSM.value.length} postos`);
  } else {
    console.log(`   ❌ OpenStreetMap: Falhou - ${resultadoOSM.reason}`);
  }

  const postosDentroDoRaio = postos
    .map((posto) => {
      const distancia = distanciaMinimaAoBatch(posto.latitude, posto.longitude, batchWaypoints);
      posto.distanceFromRoute = distancia;
      return posto;
    })
    .filter((posto) => posto.distanceFromRoute! <= SEARCH_RADIUS_KM);

  console.log(`   📍 Total válidos: ${postosDentroDoRaio.length}`);
  return postosDentroDoRaio;
}

const PONTOS_CHAVE_API: Record<string, string> = {
  florianopolis: "-48.5583,-27.5935",
  curitiba: "-49.2733,-25.4284",
  sao_paulo: "-46.6333,-23.5505",
  rio_de_janeiro: "-43.1729,-22.9068",
  belo_horizonte: "-43.9830,-19.9307",
  campo_grande: "-54.5692,-20.5236",
  porto_alegre: "-51.069,-29.954",
  salvador: "-38.284,-12.855",
  recife: "-34.9369,-8.1706",
};

const ROTAS: [string, string][] = [
  ["florianopolis", "curitiba"],
  ["curitiba", "sao_paulo"],
  ["sao_paulo", "rio_de_janeiro"],
  ["sao_paulo", "campo_grande"],
  ["sao_paulo", "belo_horizonte"],
  ["salvador", "recife"],
  ["florianopolis", "porto_alegre"],
];

async function getRouteWaypoints(
  startCoords: string,
  endCoords: string
): Promise<[number, number][]> {
  const urlOSRM = `https://router.project-osrm.org/route/v1/driving/${startCoords};${endCoords}?overview=full&geometries=geojson`;
  const respostaRota = await requisicaoComRetry(urlOSRM, {}, FETCH_TIMEOUT_MS, 3);

  if (!respostaRota.ok) {
    throw new Error(`Erro ao obter rota (${startCoords} → ${endCoords}): ${respostaRota.status}`);
  }

  const dadosRota = await respostaRota.json();
  const waypoints: [number, number][] = dadosRota.routes[0].geometry.coordinates;
  return waypoints.filter((_, i) => i % WAYPOINT_STEP === 0);
}

/**
 * Função principal que orquestra todo o processo
 */
async function main() {
  console.log("🚗 BUSCA DE ELETROPOSTOS - SÓ APIS GRATUITAS");
  console.log("📍 Rota: Curitiba → São Paulo");
  console.log(
    "🔑 APIs usadas: OpenChargeMap (sua chave) + OpenStreetMap (gratuita)"
  );
  console.log(
    `⚙️  Configurações: raio ${SEARCH_RADIUS_KM}km, passo ${WAYPOINT_STEP}, batch ${BATCH_SIZE}, concurrent ${MAX_CONCURRENT_REQUESTS}, timeout ${FETCH_TIMEOUT_MS}ms`
  );

  console.log("\n🗺️  Calculando rota...");
  const urlOSRM = `https://router.project-osrm.org/route/v1/driving/${START_COORDS.join(
    ","
  )};${END_COORDS.join(",")}?overview=full&geometries=geojson`;
  const respostaRota = await requisicaoComRetry(
    urlOSRM,
    {},
    FETCH_TIMEOUT_MS,
    3
  );

  if (!respostaRota.ok) {
    throw new Error(`Erro ao obter rota: ${respostaRota.status}`);
  }

  const dadosRota = await respostaRota.json();
  const waypoints: [number, number][] =
    dadosRota.routes[0].geometry.coordinates;
  const waypointsAmostrados = waypoints.filter(
    (_, i) => i % WAYPOINT_STEP === 0
  );

  console.log(`📍 Total de pontos na rota: ${waypoints.length}`);
  console.log(
    `🎯 Pontos selecionados: ${waypointsAmostrados.length}`
  );

  const batches: [number, number][][] = [];
  for (let i = 0; i < waypointsAmostrados.length; i += BATCH_SIZE) {
    batches.push(waypointsAmostrados.slice(i, i + BATCH_SIZE));
  }
  console.log(`📦 Total de batches: ${batches.length}`);

  const todosPostos: Eletroposto[] = [];
  let batchesProcessados = 0;

  for (
    let i = 0;
    i < batches.length;
    i += MAX_CONCURRENT_REQUESTS
  ) {
    const loteBatches = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const numeroLote = Math.floor(i / MAX_CONCURRENT_REQUESTS) + 1;
    const totalLotes = Math.ceil(batches.length / MAX_CONCURRENT_REQUESTS);

    console.log(
      `\n📦 LOTE ${numeroLote}/${totalLotes} (batches ${i}-${i + loteBatches.length - 1})`
    );

    const promessas = loteBatches.map(async (batch, indiceLote) => {
      const indiceBatch = i + indiceLote;
      // AJUSTE: Atraso maior por batch
      await new Promise((resolver) => setTimeout(resolver, indiceLote * 200));
      return buscarEletropostosNoBatch(batch, indiceBatch);
    });

    const resultados = await Promise.allSettled(promessas);

    resultados.forEach((resultado, indice) => {
      batchesProcessados++;
      if (resultado.status === "fulfilled") {
        todosPostos.push(...resultado.value);
      } else {
        console.log(`   💀 Batch ${i + indice}: ${resultado.reason}`);
      }
    });

    const progresso = ((batchesProcessados / batches.length) * 100).toFixed(1);
    console.log(
      `📊 Progresso: ${progresso}% | Postos acumulados: ${todosPostos.length}`
    );

    // AJUSTE: Pausa maior entre lotes para evitar rate limit
    if (i + MAX_CONCURRENT_REQUESTS < batches.length) {
      console.log("⏳ Aguardando 2000ms antes do próximo lote...");
      await new Promise((resolver) => setTimeout(resolver, 2000));
    }
  }

  console.log(`\n🔍 Removendo duplicatas...`);

  const postosUnicos: Eletroposto[] = [];
  const DISTANCIA_MINIMA_KM = 0.05;

  todosPostos.forEach((posto) => {
    const duplicata = postosUnicos.find((existente) => {
      const distancia = calcularDistancia(
        posto.latitude,
        posto.longitude,
        existente.latitude,
        existente.longitude
      );
      return distancia < DISTANCIA_MINIMA_KM;
    });

    if (!duplicata) {
      postosUnicos.push(posto);
    } else {
      if (posto.connectorType.length > duplicata.connectorType.length) {
        const indice = postosUnicos.indexOf(duplicata);
        postosUnicos[indice] = posto;
      }
    }
  });

  postosUnicos.sort(
    (a, b) => (a.distanceFromRoute || 999) - (b.distanceFromRoute || 999)
  );

  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTADO FINAL");
  console.log("=".repeat(60));
  console.log(`🎯 Batches processados: ${batchesProcessados}`);
  console.log(`🔌 Postos encontrados: ${todosPostos.length}`);
  console.log(`✨ Postos únicos: ${postosUnicos.length}`);

  const porFonte: Record<string, number> = {};
  postosUnicos.forEach((posto) => {
    porFonte[posto.source] = (porFonte[posto.source] || 0) + 1;
  });

  console.log(`\n📈 POSTOS POR FONTE:`);
  Object.entries(porFonte).forEach(([fonte, quantidade]) => {
    console.log(`   • ${fonte}: ${quantidade}`);
  });

  const porRede: Record<string, number> = {};
  postosUnicos.forEach((posto) => {
    const rede = posto.network || "Desconhecida";
    porRede[rede] = (porRede[rede] || 0) + 1;
  });

  console.log(`\n🏢 PRINCIPAIS REDES:`);
  Object.entries(porRede)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .forEach(([rede, quantidade]) => {
      console.log(
        `   • ${rede}: ${quantidade} posto${quantidade > 1 ? "s" : ""}`
      );
  });

  await writeFile(
    "eletropostos_free_apis.json",
    JSON.stringify(postosUnicos, null, 2),
    "utf-8"
  );
  console.log(`\n📁 Eletropostos salvos em: eletropostos_free_apis.json`);

  const relatorio = {
    resumo: {
      batches: batchesProcessados,
      postosEncontrados: todosPostos.length,
      postosUnicos: postosUnicos.length,
      dataProcessamento: new Date().toISOString(),
    },
    configuracao: {
      origem: "Curitiba [-49.2733, -25.4284]",
      destino: "São Paulo [-46.6333, -23.5505]",
      waypointStep: WAYPOINT_STEP,
      batchSize: BATCH_SIZE,
      raioKm: SEARCH_RADIUS_KM,
      concurrent: MAX_CONCURRENT_REQUESTS,
    },
    estatisticas: {
      porFonte,
      porRede: Object.entries(porRede).sort(([, a], [, b]) => b - a),
    },
  };

  await writeFile(
    "relatorio_free_apis.json",
    JSON.stringify(relatorio, null, 2),
    "utf-8"
  );
  console.log("📊 Relatório salvo em: relatorio_free_apis.json");

  console.log("\n✅ Concluído! Usando apenas APIs gratuitas.");
  console.log("=".repeat(60));
}

// Inicia a execução do script
main().catch(console.error);