// crawler.ts
import fs from "fs";
import { writeFile as writeFileAsync, readFile as readFileAsync } from "fs/promises";
import cliProgress from "cli-progress";

// ===============================
// CONFIGURAÇÃO
// ===============================

type Eletroposto = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  source: string;
};

type POI = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  type: string;
  source: string;
};

const OUTPUT_PATH = "eletropostos_live.json";
const CACHE_DIR = "cache";
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const LAT_MIN = -33;
const LAT_MAX = 5;
const LON_MIN = -74;
const LON_MAX = -34;
const STEP = 1;

const OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94";
const GOOGLE_API_KEY = "AIzaSyDBCTWl8x73zEo236biO6ZsSRgIIU43Yuk";
const GOOGLE_PLACES_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const ANEEL_URL =
  "https://dadosabertos.aneel.gov.br/dataset/4c2a50f2-d3a1-40b9-b4c8-4f087dc72ff0/resource/03f3914a-2bb0-4f6e-aadf-9e0bcf42e2d7/download/eletropostos-brasil.json";

const RADIUS_KM = 150;

// ===============================
// AUTO-CALIBRAÇÃO GENÉRICA
// ===============================
const config = {
  batchSize: 3,
  interBatchDelay: 1500,
  maxBatch: 11,
  minBatch: 1,
  maxDelay: 60000,
  minDelay: 530,
  stableOkBatches: 0,
  stableIncreaseThreshold: 3,
};

function ajustarCalibracao(statuses: number[], cfg = config) {
  const count429 = statuses.filter((s) => s === 429).length;
  const count403 = statuses.filter((s) => s === 403).length;
  const countOk = statuses.filter((s) => s === 200).length;
  const total = statuses.length;

  if (count429 > 0) {
    cfg.batchSize = Math.max(cfg.minBatch, Math.floor(cfg.batchSize / 2));
    cfg.interBatchDelay = Math.min(cfg.maxDelay, cfg.interBatchDelay * 1.5);
    cfg.stableOkBatches = 0;
  } else if (count403 > 0) {
    cfg.batchSize = Math.max(cfg.minBatch, Math.floor(cfg.batchSize / 2));
    cfg.interBatchDelay = Math.min(cfg.maxDelay, cfg.interBatchDelay * 4);
    cfg.stableOkBatches = 0;
  } else if (countOk === total) {
    cfg.stableOkBatches++;
    if (cfg.stableOkBatches >= cfg.stableIncreaseThreshold) {
      cfg.batchSize = Math.min(cfg.maxBatch, cfg.batchSize + 1);
      cfg.interBatchDelay = Math.max(cfg.minDelay, Math.floor(cfg.interBatchDelay * 0.9));
      cfg.stableOkBatches = 0;
    }
  } else {
    cfg.stableOkBatches = 0;
  }
}

// ===============================
// VARIÁVEIS GLOBAIS
// ===============================
let postos: Eletroposto[] = [];
const idsRegistrados = new Set<string>();

// ===============================
// FUNÇÕES BÁSICAS
// ===============================
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function salvarJSON() {
  await writeFileAsync(OUTPUT_PATH, JSON.stringify(postos, null, 2), "utf-8");
  console.log(`💾 ${postos.length} postos salvos em ${OUTPUT_PATH}`);
}

function gerarGrid() {
  const grid: { lat: number; lon: number }[] = [];
  for (let lat = LAT_MIN; lat < LAT_MAX; lat += STEP) {
    for (let lon = LON_MIN; lon < LON_MAX; lon += STEP) {
      grid.push({ lat, lon });
    }
  }
  return grid;
}

async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ===============================
// FONTES DE DADOS
// ===============================

async function buscarEletropostosTile(
  lat: number,
  lon: number
): Promise<{ status: number; postos: Eletroposto[] }> {
  const cachePath = `${CACHE_DIR}/${lat}_${lon}.json`;
  if (fs.existsSync(cachePath)) {
    try {
      const raw = await readFileAsync(cachePath, "utf-8");
      const parsed = JSON.parse(raw);
      return { status: 200, postos: parsed as Eletroposto[] };
    } catch {}
  }

  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&latitude=${lat}&longitude=${lon}&distance=${RADIUS_KM}&distanceunit=KM&maxresults=500`;
  const headers: Record<string, string> = { "User-Agent": "EletropostoBrasil/1.0" };
  if (OCM_API_KEY) headers["X-API-Key"] = OCM_API_KEY;

  try {
    const res = await fetchWithTimeout(url, { headers }, 15000);

    const retryAfterHeader = res.headers.get("Retry-After");
    if (res.status === 429)
      return { status: 429, postos: [] };
    if (res.status === 403)
      return { status: 403, postos: [] };
    if (!res.ok)
      return { status: res.status, postos: [] };

    const data = await res.json();
    const postos: Eletroposto[] = (data || []).map((p: any) => ({
      id: `ocm_${p.ID}`,
      name: p.AddressInfo?.Title || "Sem nome",
      latitude: p.AddressInfo?.Latitude,
      longitude: p.AddressInfo?.Longitude,
      address: [p.AddressInfo?.AddressLine1, p.AddressInfo?.Town, p.AddressInfo?.StateOrProvince]
        .filter(Boolean)
        .join(", "),
      source: "OpenChargeMap",
    }));

    await writeFileAsync(cachePath, JSON.stringify(postos, null, 2), "utf-8");
    return { status: 200, postos };
  } catch (err: any) {
    return { status: 500, postos: [] };
  }
}

async function buscarEletropostosANEEL(): Promise<Eletroposto[]> {
  try {
    const res = await fetchWithTimeout(ANEEL_URL, {}, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data
      .filter((p: any) => p.Latitude && p.Longitude)
      .map((p: any, i: number) => ({
        id: `aneel_${i}`,
        name: p["Nome Empreendimento"] || "Eletroposto ANEEL",
        latitude: parseFloat(p.Latitude),
        longitude: parseFloat(p.Longitude),
        address: p.Municipio || "",
        source: "ANEEL",
      }));
  } catch {
    return [];
  }
}

async function buscarEletropostosGoogle(): Promise<Eletroposto[]> {
  const cidades = [
    { nome: "São Paulo", lat: -23.5505, lon: -46.6333 },
    { nome: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
    { nome: "Brasília", lat: -15.8267, lon: -47.9218 },
    { nome: "Belo Horizonte", lat: -19.9167, lon: -43.9345 },
    { nome: "Salvador", lat: -12.9714, lon: -38.5014 },
    { nome: "Porto Alegre", lat: -30.0346, lon: -51.2177 },
  ];

  const todos: Eletroposto[] = [];
  for (const c of cidades) {
    const url = `${GOOGLE_PLACES_URL}?location=${c.lat},${c.lon}&radius=50000&type=charging_station&key=${GOOGLE_API_KEY}&language=pt-BR`;
    try {
      const res = await fetchWithTimeout(url, {}, 15000);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.results) {
        for (const r of data.results) {
          const loc = r.geometry?.location;
          if (!loc) continue;
          todos.push({
            id: `google_${r.place_id}`,
            name: r.name || "Eletroposto Google",
            latitude: loc.lat,
            longitude: loc.lng,
            address: r.vicinity || "",
            source: "GooglePlaces",
          });
        }
      }
    } catch {}
  }
  return todos;
}

// ===============================
// POIs (Google + OSM)
// ===============================
async function buscarPOIsGoogle(lat: number, lon: number, radius = 50000): Promise<POI[]> {
  const tipos = ["gas_station", "restaurant", "hotel", "shopping_mall", "parking", "supermarket"];
  const pois: POI[] = [];
  for (const tipo of tipos) {
    const url = `${GOOGLE_PLACES_URL}?location=${lat},${lon}&radius=${radius}&type=${tipo}&key=${GOOGLE_API_KEY}&language=pt-BR`;
    try {
      const res = await fetchWithTimeout(url, {}, 15000);
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of data.results || []) {
        const loc = r.geometry?.location;
        if (!loc) continue;
        pois.push({
          id: `gpoi_${r.place_id}`,
          name: r.name || tipo,
          latitude: loc.lat,
          longitude: loc.lng,
          address: r.vicinity || "",
          type: tipo,
          source: "GooglePlaces",
        });
      }
    } catch {}
  }
  return pois;
}

async function buscarPOIsOSM(lat: number, lon: number, radiusKm = 50): Promise<POI[]> {
  const url = `https://overpass-api.de/api/interpreter`;
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"restaurant|fuel|parking"](around:${radiusKm * 1000},${lat},${lon});
      node["tourism"="hotel"](around:${radiusKm * 1000},${lat},${lon});
      node["shop"="mall"](around:${radiusKm * 1000},${lat},${lon});
      node["shop"="supermarket"](around:${radiusKm * 1000},${lat},${lon});
    );
    out center;`;

  try {
    const res = await fetchWithTimeout(url, { method: "POST", body: query }, 20000);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.elements || []).map((e: any) => ({
      id: `osm_${e.id}`,
      name: e.tags?.name || "POI OSM",
      latitude: e.lat,
      longitude: e.lon,
      address: e.tags?.addr_full || "",
      type: e.tags?.amenity || e.tags?.tourism || e.tags?.shop || "unknown",
      source: "OpenStreetMap",
    }));
  } catch {
    return [];
  }
}

// ===============================
// FILTROS DE RELEVÂNCIA
// ===============================
function filtrarPOIsRelevantes(pois: POI[]): POI[] {
  const tiposRelevantes = [
    "parking",
    "fuel",
    "gas_station",
    "supermarket",
    "shopping_mall",
    "hotel",
    "motel",
    "rest_area",
  ];
  const vistos = new Set<string>();
  return pois.filter((p) => {
    const tipo = p.type?.toLowerCase() || "";
    if (!tiposRelevantes.some((t) => tipo.includes(t))) return false;
    const chave = `${Math.round(p.latitude * 1000)}_${Math.round(p.longitude * 1000)}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function filtrarPOIsPorDensidade(pois: POI[], postosExistentes: Eletroposto[]): POI[] {
  const RAIO_DE_EXCLUSAO_KM = 20;
  return pois.filter((p) => {
    const perto = postosExistentes.some((e) => {
      const dLat = (p.latitude - e.latitude) * (Math.PI / 180);
      const dLon = (p.longitude - e.longitude) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(p.latitude * (Math.PI / 180)) *
          Math.cos(e.latitude * (Math.PI / 180)) *
          Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dist = 6371 * c;
      return dist < RAIO_DE_EXCLUSAO_KM;
    });
    return !perto;
  });
}

// ===============================
// MAIN LOOP
// ===============================
async function main() {
  console.log("🗺️ Iniciando crawler autocalibrável (Brasil)...");
  const grid = gerarGrid();

  const bar = new cliProgress.SingleBar(
    {
      format: "Progresso |{bar}| {percentage}% | Tiles: {value}/{total} | Batch: {batchSize}",
      barCompleteChar: "█",
      barIncompleteChar: "-",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(grid.length, 0, { batchSize: config.batchSize });

  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const raw = await readFileAsync(OUTPUT_PATH, "utf-8");
      postos = JSON.parse(raw) as Eletroposto[];
      postos.forEach((p) => idsRegistrados.add(p.id));
      console.log(`♻️ Retomando com ${postos.length} postos salvos`);
    } catch {}
  }

  let idx = 0;
  while (idx < grid.length) {
    const batch = grid.slice(idx, idx + config.batchSize);
    const results = await Promise.all(
      batch.map((tile) =>
        buscarEletropostosTile(tile.lat, tile.lon)
          .then((res) => ({ tile, res }))
          .catch(() => ({ tile, res: { status: 500, postos: [] } }))
      )
    );

    const statuses = results.map((r) => r.res.status);
    ajustarCalibracao(statuses, config);

    for (const item of results) {
      if (item.res.status !== 200) continue;
      for (const posto of item.res.postos) {
        if (!idsRegistrados.has(posto.id)) {
          idsRegistrados.add(posto.id);
          postos.push(posto);
        }
      }
    }

    await salvarJSON();
    idx += batch.length;
    bar.update(idx, { batchSize: config.batchSize });
    await sleep(config.interBatchDelay);
  }

  bar.stop();

  console.log("\n🌍 Adicionando fontes extras (ANEEL + Google)...");
  const aneel = await buscarEletropostosANEEL();
  const google = await buscarEletropostosGoogle();
  const extras = [...aneel, ...google].filter((p) => !idsRegistrados.has(p.id));
  for (const e of extras) {
    idsRegistrados.add(e.id);
    postos.push(e);
  }
  await salvarJSON();

  console.log("\n🏨 Buscando POIs (Google + OSM)...");
  const pois: POI[] = [];

  let poiIdx = 0;
  while (poiIdx < grid.length) {
    const batch = grid.slice(poiIdx, poiIdx + config.batchSize);
    const results = await Promise.all(
      batch.map(async (tile) => {
        try {
          const [pg, po] = await Promise.all([
            buscarPOIsGoogle(tile.lat, tile.lon),
            buscarPOIsOSM(tile.lat, tile.lon),
          ]);
          return { status: 200, pois: [...pg, ...po] };
        } catch {
          return { status: 500, pois: [] };
        }
      })
    );

    const statuses = results.map((r) => r.status);
    ajustarCalibracao(statuses, config);

    for (const r of results) pois.push(...r.pois);
    poiIdx += batch.length;
    console.log(`Tiles: ${poiIdx}/${grid.length} | POIs acumulados: ${pois.length}`);
    await sleep(config.interBatchDelay);
  }

  const poisFiltrados = filtrarPOIsPorDensidade(filtrarPOIsRelevantes(pois), postos);
  await writeFileAsync("pois_brasil.json", JSON.stringify(poisFiltrados, null, 2), "utf-8");
  console.log(`✅ POIs relevantes: ${poisFiltrados.length}`);

  await salvarJSON();
  console.log(`\n✅ Crawler finalizado. Postos totais: ${postos.length}`);
}

main().catch((err) => {
  console.error("Erro fatal no crawler:", err);
});
