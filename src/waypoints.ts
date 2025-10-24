// ESSE CODIGO ESTÁ ASSINCRONO E SE AUTO-CALIBRA, FAZ REQUISIÇÕES DE ELETROPOSTOS NO BRASIL TODO

import { writeFile, readFile } from "fs/promises";


const JSON_PATH = "eletropostos_live.json";
let postosParciais: Eletroposto[] = [];
const idsRegistrados = new Set<string>();

async function salvarParcial() {
  try {
    await writeFile(JSON_PATH, JSON.stringify(postosParciais, null, 2), "utf-8");
    console.log(`💾 JSON atualizado (${postosParciais.length} postos salvos)`);
  } catch (e) {
    console.error("❌ Erro ao salvar JSON parcial:", e);
  }
}

// =============== CONFIGURAÇÕES PRINCIPAIS ===============
// Coordenadas de início e fim da rota (Curitiba → São Paulo)
const START_COORDS: [number, number] = [-49.2733, -25.4284];
const END_COORDS: [number, number] = [-46.6333, -23.5505];

// Chave de API para o OpenChargeMap (obtenha uma gratuitamente em openchargemap.io)
const OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94";


interface Config {
  SEARCH_RADIUS_KM: number;
  WAYPOINT_STEP: number;
  BATCH_SIZE: number;
  MAX_CONCURRENT_REQUESTS: number;
  FETCH_TIMEOUT_MS: number;
  adapt: {
    maxRate429: number;
    maxEmptyBatches: number;
    adjustInterval: number;
  };
}

// Configurações de busca
const config: Config = {
  SEARCH_RADIUS_KM: 1.5,
  WAYPOINT_STEP: 25,
  BATCH_SIZE: 5,
  MAX_CONCURRENT_REQUESTS: 1,
  FETCH_TIMEOUT_MS: 5000,
  adapt: {
    maxRate429: 0.2,
    maxEmptyBatches: 0.5,
    adjustInterval: 3,
  },
};

const metrics = {
  totalRequests: 0,
  rate429: 0,
  emptyBatches: 0,
  lastAdjust: Date.now(),
};

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
function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function identificarPostosDuplicados(postos: Eletroposto[], raioDuplicacaoMetros = 10) {
  const unicos: Eletroposto[] = [];
  for (const posto of postos) {
    const duplicado = unicos.find((p) => {
      const d = calcularDistancia(p.latitude, p.longitude, posto.latitude, posto.longitude);
      return d * 1000 < raioDuplicacaoMetros;
    });
    if (!duplicado) unicos.push(posto);
  }
  return unicos;
}

function logToFile(message: string) {
  const dir = path.join(process.cwd(), "src", "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "eletropostos.log");
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

function autoCalibrate() {
  const rate429 = metrics.rate429 / metrics.totalRequests;
  const emptyRate = metrics.emptyBatches / metrics.totalRequests;

  if (rate429 > config.adapt.maxRate429) {
    config.MAX_CONCURRENT_REQUESTS = Math.max(1, config.MAX_CONCURRENT_REQUESTS - 1);
    log(`🔧 Reduzindo concorrência: ${config.MAX_CONCURRENT_REQUESTS}`);
  } else if (rate429 === 0 && config.MAX_CONCURRENT_REQUESTS < 3) {
    config.MAX_CONCURRENT_REQUESTS++;
    log(`⚙️ Aumentando concorrência: ${config.MAX_CONCURRENT_REQUESTS}`);
  }

  if (emptyRate > config.adapt.maxEmptyBatches) {
    config.SEARCH_RADIUS_KM = Math.min(config.SEARCH_RADIUS_KM * 1.3, 5);
    log(`📈 Aumentando raio: ${config.SEARCH_RADIUS_KM.toFixed(2)} km`);
  } else if (emptyRate < 0.1 && config.SEARCH_RADIUS_KM > 1) {
    config.SEARCH_RADIUS_KM = Math.max(config.SEARCH_RADIUS_KM * 0.8, 1);
    log(`📉 Reduzindo raio: ${config.SEARCH_RADIUS_KM.toFixed(2)} km`);
  }

  log(
    `📊 Ajuste automático concluído | rate429=${(rate429 * 100).toFixed(1)}% | empty=${(
      emptyRate * 100
    ).toFixed(1)}%`
  );

  metrics.totalRequests = 0;
  metrics.rate429 = 0;
  metrics.emptyBatches = 0;
  metrics.lastAdjust = Date.now();
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
  // Adiciona buffer para cobrir mais área, permitindo batches maiores
  minLat -= config.BBOX_BUFFER_DEG;
  maxLat += config.BBOX_BUFFER_DEG;
  minLon -= config.BBOX_BUFFER_DEG;
  maxLon += config.BBOX_BUFFER_DEG;
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

      // Tratamento específico para 429 (rate limit)
      if (resposta.status === 429) {
        const tempoEspera = Math.max(10000, 2 ** tentativa * 1000 + Math.random() * 500); // AJUSTE PARA RETRY/CACHE: Min 10s para 429, com jitter
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
  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&boundingbox=${south},${west},${north},${east}&maxresults=100`; // maxresults=50 para reduzir carga
  console.log(`🔍 OCM URL: ${url}`);

  try {
    const resposta = await requisicaoComRetry(  
      url,
      {
        headers: { "X-API-Key": OCM_API_KEY },
      },
      config.FETCH_TIMEOUT_MS
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
    "https://overpass.nchc.org.tw/api" // AJUSTE PARA RETRY/CACHE: Adicionado mais mirror
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
      config.FETCH_TIMEOUT_MS,
      3,
      mirrors
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

import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import retry from "p-retry";
import { getRoute } from "./openRouteService";
import { Eletroposto } from "../types/eletroposto";
import { amostrarWaypointsComMenorDistancia } from "./amostrarPontos";
import { buscarEletropostos } from "./overpassApi";
import { salvarPostosCSV } from "./salvarPostosCSV";
import { delay } from "./delay";

interface Config {
  SEARCH_RADIUS_KM: number;
  WAYPOINT_STEP: number;
  BATCH_SIZE: number;
  MAX_CONCURRENT_REQUESTS: number;
  FETCH_TIMEOUT_MS: number;
  adapt: {
    maxRate429: number;
    maxEmptyBatches: number;
    adjustInterval: number;
  };
}

function log(message: string) {
  console.log(message);
  logToFile(message);
}

function autoCalibrate() {
  const rate429 = metrics.rate429 / metrics.totalRequests;
  const emptyRate = metrics.emptyBatches / metrics.totalRequests;

  if (rate429 > config.adapt.maxRate429) {
    config.MAX_CONCURRENT_REQUESTS = Math.max(1, config.MAX_CONCURRENT_REQUESTS - 1);
    log(`🔧 Reduzindo concorrência: ${config.MAX_CONCURRENT_REQUESTS}`);
  } else if (rate429 === 0 && config.MAX_CONCURRENT_REQUESTS < 3) {
    config.MAX_CONCURRENT_REQUESTS++;
    log(`⚙️ Aumentando concorrência: ${config.MAX_CONCURRENT_REQUESTS}`);
  }

  if (emptyRate > config.adapt.maxEmptyBatches) {
    config.SEARCH_RADIUS_KM = Math.min(config.SEARCH_RADIUS_KM * 1.3, 5);
    log(`📈 Aumentando raio: ${config.SEARCH_RADIUS_KM.toFixed(2)} km`);
  } else if (emptyRate < 0.1 && config.SEARCH_RADIUS_KM > 1) {
    config.SEARCH_RADIUS_KM = Math.max(config.SEARCH_RADIUS_KM * 0.8, 1);
    log(`📉 Reduzindo raio: ${config.SEARCH_RADIUS_KM.toFixed(2)} km`);
  }

  log(
    `📊 Ajuste automático concluído | rate429=${(rate429 * 100).toFixed(1)}% | empty=${(
      emptyRate * 100
    ).toFixed(1)}%`
  );

  metrics.totalRequests = 0;
  metrics.rate429 = 0;
  metrics.emptyBatches = 0;
  metrics.lastAdjust = Date.now();
}

async function buscarEletropostosNoBatch(
  waypoints: [number, number][],
  batchIndex: number
): Promise<Eletroposto[]> {
  const limit = pLimit(config.MAX_CONCURRENT_REQUESTS);

  const resultados = await Promise.all(
    waypoints.map(([lon, lat]) =>
      limit(() =>
        retry(
          async () => {
            metrics.totalRequests++;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), config.FETCH_TIMEOUT_MS);

            try {
              const postosDentroDoRaio = await buscarEletropostos(
                lat,
                lon,
                config.SEARCH_RADIUS_KM
              );
              clearTimeout(timeout);

              if (!postosDentroDoRaio.length) metrics.emptyBatches++;

              log(`✅ Batch ${batchIndex + 1}: ${postosDentroDoRaio.length} postos encontrados`);
              await delay(1000);
              return postosDentroDoRaio;
            } catch (err: any) {
              clearTimeout(timeout);

              if (err.message.includes("429")) {
                metrics.rate429++;
                log(`⚠️ 429 detectado no batch ${batchIndex + 1}`);
                throw err;
              }

              log(`❌ Erro no batch ${batchIndex + 1}: ${err.message || err}`);
              throw err;
            }
          },
          {
            retries: 3,
            onFailedAttempt: async (error) => {
              const status = (error as any).message?.match(/status (\d+)/)?.[1] || "desconhecido";
              log(`Tentativa ${error.attemptNumber} falhou (status ${status}).`);
              await delay(1000 * error.attemptNumber);
            },
          }
        )
      )
    )
  );

  return resultados.flat();
}

export async function buscarEletropostosNaRota(
  coordenadas: [number, number][],
  nomeArquivo: string
): Promise<Eletroposto[]> {
  log("🚗 Obtendo rota...");
  const route = await getRoute(coordenadas);
  const waypointsAmostrados = amostrarWaypointsComMenorDistancia(route, config.WAYPOINT_STEP);
  log(`🧭 ${waypointsAmostrados.length} pontos amostrados.`);

  const totalBatches = Math.ceil(waypointsAmostrados.length / config.BATCH_SIZE);
  const allEletropostos: Eletroposto[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const start = i * config.BATCH_SIZE;
    const end = start + config.BATCH_SIZE;
    const batchWaypoints = waypointsAmostrados.slice(start, end);

    log(`🚀 Processando batch ${i + 1}/${totalBatches}...`);
    const postosBatch = await buscarEletropostosNoBatch(batchWaypoints, i);
    allEletropostos.push(...postosBatch);

    if ((i + 1) % config.adapt.adjustInterval === 0) autoCalibrate();

    const progresso = (((i + 1) / totalBatches) * 100).toFixed(1);
    log(`📊 Progresso: ${progresso}%`);
  }

  const postosUnicos = identificarPostosDuplicados(allEletropostos);
  log(`🔍 ${postosUnicos.length} eletropostos únicos após deduplicação.`);

  const dir = path.join(process.cwd(), "src", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const outputPath = path.join(dir, nomeArquivo);
  fs.writeFileSync(outputPath, JSON.stringify(postosUnicos, null, 2));
  log(`💾 Salvo em ${outputPath}`);

  await salvarPostosCSV(postosUnicos, nomeArquivo.replace(".json", ".csv"));

  log("✅ Concluído.");
  return postosUnicos;
}


// =============== LÓGICA PRINCIPAL ===============
/**
 * Busca eletropostos em um batch de waypoints usando todas as APIs
 * @param batchWaypoints Array de waypoints no batch
 * @param indiceBatch Índice do batch na rota (para logging)
 * @returns {postos: Eletroposto[], success: boolean} // AJUSTE PARA RETRY/CACHE: Retorna sucesso para identificar falhas
 */
async function buscarEletropostosNoBatch(
  waypoints: [number, number][],
  batchIndex: number
): Promise<Eletroposto[]> {
  const limit = pLimit(config.MAX_CONCURRENT_REQUESTS);

  const resultados = await Promise.all(
    waypoints.map(([lon, lat]) =>
      limit(() =>
        retry(
          async () => {
            metrics.totalRequests++;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), config.FETCH_TIMEOUT_MS);

            try {
              const postosDentroDoRaio = await buscarEletropostos(
                lat,
                lon,
                config.SEARCH_RADIUS_KM
              );
              clearTimeout(timeout);

              if (!postosDentroDoRaio.length) metrics.emptyBatches++;

              log(`✅ Batch ${batchIndex + 1}: ${postosDentroDoRaio.length} postos encontrados`);
              await delay(1000);
              return postosDentroDoRaio;
            } catch (err: any) {
              clearTimeout(timeout);

              if (err.message.includes("429")) {
                metrics.rate429++;
                log(`⚠️ 429 detectado no batch ${batchIndex + 1}`);
                throw err;
              }

              log(`❌ Erro no batch ${batchIndex + 1}: ${err.message || err}`);
              throw err;
            }
          },
          {
            retries: 3,
            onFailedAttempt: async (error) => {
              const status = (error as any).message?.match(/status (\d+)/)?.[1] || "desconhecido";
              log(`Tentativa ${error.attemptNumber} falhou (status ${status}).`);
              await delay(1000 * error.attemptNumber);
            },
          }
        )
      )
    )
  );

  return resultados.flat();
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
  const respostaRota = await requisicaoComRetry(urlOSRM, {}, config.FETCH_TIMEOUT_MS, 3);

  if (!respostaRota.ok) {
    throw new Error(`Erro ao obter rota (${startCoords} → ${endCoords}): ${respostaRota.status}`);
  }

  const dadosRota = await respostaRota.json();
  const waypoints: [number, number][] = dadosRota.routes[0].geometry.coordinates;
  return waypoints.filter((_, i) => i % config.WAYPOINT_STEP === 0);
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
    `⚙️  Configurações: raio ${config.SEARCH_RADIUS_KM}km, passo ${config.WAYPOINT_STEP}, batch ${config.BATCH_SIZE}, concurrent ${config.MAX_CONCURRENT_REQUESTS}, timeout ${config.FETCH_TIMEOUT_MS}ms, retries ${config.MAX_RETRY_ATTEMPTS}`
  );

  // Obtém a rota da API OSRM
  console.log("\n🗺️  Calculando rota...");
  const urlOSRM = `https://router.project-osrm.org/route/v1/driving/${START_COORDS.join(
    ","
  )};${END_COORDS.join(",")}?overview=full&geometries=geojson`;
  const respostaRota = await requisicaoComRetry(
    urlOSRM,
    {},
    config.FETCH_TIMEOUT_MS,
    3
  );

  if (!respostaRota.ok) {
    throw new Error(`Erro ao obter rota: ${respostaRota.status}`);
  }

  const dadosRota = await respostaRota.json();
  const waypoints: [number, number][] =
    dadosRota.routes[0].geometry.coordinates;
  const waypointsAmostrados = waypoints.filter(
    (_, i) => i % config.WAYPOINT_STEP === 0
  );

  console.log(`📍 Total de pontos na rota: ${waypoints.length}`);
  console.log(
    `🎯 Pontos selecionados para busca: ${waypointsAmostrados.length}`
  );

  // Agrupa waypoints em batches
  const batches: [number, number][][] = [];
  for (let i = 0; i < waypointsAmostrados.length; i += config.BATCH_SIZE) {
    batches.push(waypointsAmostrados.slice(i, i + config.BATCH_SIZE));
  }
  console.log(`📦 Total de batches: ${batches.length}`);

  const todosPostos: Eletroposto[] = [];
  const batchCache = new Map<number, Eletroposto[]>(); // AJUSTE PARA RETRY/CACHE: Cache de resultados por indiceBatch
  let attempt = 1;

  // AJUSTE PARA RETRY/CACHE: Loop de retry para batches falhados
  while (attempt <= config.MAX_RETRY_ATTEMPTS) {
    console.log(`\n🔄 Tentativa global ${attempt}/${config.MAX_RETRY_ATTEMPTS}`);
    const failedBatches: number[] = []; // Coleta falhas nesta tentativa

    let batchesProcessados = batchCache.size; // Começa com cacheados

    for (
      let i = 0;
      i < batches.length;
      i += config.MAX_CONCURRENT_REQUESTS
    ) {
      const loteBatches = batches.slice(i, i + config.MAX_CONCURRENT_REQUESTS).filter((_, idx) => !batchCache.has(i + idx)); // Skip cacheados
      if (loteBatches.length === 0) continue; // Nada para processar

      const numeroLote = Math.floor(i / config.MAX_CONCURRENT_REQUESTS) + 1;
      const totalLotes = Math.ceil(
        batches.length / config.MAX_CONCURRENT_REQUESTS
      );

      console.log(
        `\n📦 LOTE ${numeroLote}/${totalLotes} (batches ${i}-${i + loteBatches.length - 1})`
      );

      // Prepara as promessas para processamento em paralelo
      const promessas = loteBatches.map(async (batch, indiceLote) => {
        const indiceBatch = i + indiceLote;
        // Adiciona um pequeno atraso entre requisições para evitar sobrecarga
        await new Promise((resolver) => setTimeout(resolver, indiceLote * 500)); // AJUSTE PARA RETRY/CACHE: Atraso maior
        const result = await buscarEletropostosNoBatch(batch, indiceBatch);
        if (result.success) {
          batchCache.set(indiceBatch, result.postos); // Cache sucesso
        } else {
          failedBatches.push(indiceBatch); // Marca falha
        }
        return result.postos;
      });

      // Executa todas as buscas do lote em paralelo
      const resultados = await Promise.allSettled(promessas);

      // Processa os resultados do lote
      resultados.forEach((resultado) => {
        batchesProcessados++;
        if (resultado.status === "fulfilled") {
          todosPostos.push(...resultado.value);
        } // Falhas já marcadas acima
      });

      // Exibe progresso
      const progresso = (
        (batchesProcessados / batches.length) *
        100
      ).toFixed(1);
      console.log(
        `📊 Progresso: ${progresso}% | Postos acumulados: ${todosPostos.length}`
      );

      // Pausa entre lotes para evitar sobrecarga das APIs
      if (i + config.MAX_CONCURRENT_REQUESTS < batches.length) {
        console.log("⏳ Aguardando 5000ms antes do próximo lote..."); // AJUSTE PARA RETRY/CACHE: Aumentado para 5s
        await new Promise((resolver) => setTimeout(resolver, 5000));
      }
    }

    // Se não houver falhas, sai do loop
    if (failedBatches.length === 0) break;

    console.log(`❗ Batches falhados nesta tentativa: ${failedBatches.join(', ')}. Retentando na próxima...`);

    // Salva cache parcial para depuração
    await writeFile(
      "batch_cache_parcial.json",
      JSON.stringify(Array.from(batchCache.entries()), null, 2),
      "utf-8"
    );
    console.log("📁 Cache parcial salvo em: batch_cache_parcial.json");

    attempt++;
    if (attempt <= config.MAX_RETRY_ATTEMPTS) {
      await new Promise((resolver) => setTimeout(resolver, 10000)); // Espera 10s antes de nova tentativa global
    }
  }

  // Coleta todos os postos do cache (inclui retries)
  batchCache.forEach(postos => todosPostos.push(...postos));

  console.log(`\n🔍 Removendo duplicatas...`);

  // Remove postos duplicados (com base na proximidade)
  const postosUnicos: Eletroposto[] = [];
  const DISTANCIA_MINIMA_KM = 0.05; // 50 metros

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
      // Mantém o posto com mais informações (mais tipos de conectores)
      if (posto.connectorType.length > duplicata.connectorType.length) {
        const indice = postosUnicos.indexOf(duplicata);
        postosUnicos[indice] = posto;
      }
    }
  });

  // Ordena por distância da rota (mais próximos primeiro)
  postosUnicos.sort(
    (a, b) => (a.distanceFromRoute || 999) - (b.distanceFromRoute || 999)
  );

  // Gera estatísticas
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTADO FINAL");
  console.log("=".repeat(60));
  console.log(`🎯 Batches processados: ${batches.length}`);
  console.log(`🔌 Postos encontrados: ${todosPostos.length}`);
  console.log(`✨ Postos únicos: ${postosUnicos.length}`);

  // Estatísticas por fonte de dados
  const porFonte: Record<string, number> = {};
  postosUnicos.forEach((posto) => {
    porFonte[posto.source] = (porFonte[posto.source] || 0) + 1;
  });

  console.log(`\n📈 POSTOS POR FONTE:`);
  Object.entries(porFonte).forEach(([fonte, quantidade]) => {
    console.log(`   • ${fonte}: ${quantidade}`);
  });

  // Estatísticas por rede/operadora
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

  // Salva os resultados em arquivo JSON
  await writeFile(
    "eletropostos_free_apis.json",
    JSON.stringify(postosUnicos, null, 2),
    "utf-8"
  );
  console.log(`\n📁 Eletropostos salvos em: eletropostos_free_apis.json`);

  // Cria e salva um relatório detalhado
  const relatorio = {
    resumo: {
      batches: batches.length,
      postosEncontrados: todosPostos.length,
      postosUnicos: postosUnicos.length,
      dataProcessamento: new Date().toISOString(),
    },
    configuracao: {
      origem: "Curitiba [-49.2733, -25.4284]",
      destino: "São Paulo [-46.6333, -23.5505]",
      waypointStep: config.WAYPOINT_STEP,
      batchSize: config.BATCH_SIZE,
      raioKm: config.SEARCH_RADIUS_KM,
      concurrent: config.MAX_CONCURRENT_REQUESTS,
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