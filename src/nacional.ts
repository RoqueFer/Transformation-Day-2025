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

const OUTPUT_PATH = "eletropostos_live.json";
const CACHE_DIR = "cache";
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const LAT_MIN = -33;
const LAT_MAX = 5;
const LON_MIN = -74;
const LON_MAX = -34;
const STEP = 1;

const OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94";
const RADIUS_KM = 150;

// ANEEL + GOOGLE
const ANEEL_URL =
  "https://dadosabertos.aneel.gov.br/dataset/4c2a50f2-d3a1-40b9-b4c8-4f087dc72ff0/resource/03f3914a-2bb0-4f6e-aadf-9e0bcf42e2d7/download/eletropostos-brasil.json";
const GOOGLE_API_KEY = "SUA_CHAVE_AQUI";
const GOOGLE_PLACES_URL =
  "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

// Auto-calibração
let batchSize = 3;
const MAX_BATCH = 11;
const MIN_BATCH = 1;

let interBatchDelay = 1500;
const MAX_DELAY = 60000;
const MIN_DELAY = 530;

const STABLE_INCREASE_THRESHOLD = 3;
let stableOkBatches = 0;

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
// FUNÇÃO: OPENCHARGEMAP
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
    } catch {
      // se cache corrompido, ignora
    }
  }

  const url = `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&latitude=${lat}&longitude=${lon}&distance=${RADIUS_KM}&distanceunit=KM&maxresults=500`;
  const headers: Record<string, string> = { "User-Agent": "EletropostoBrasil/1.0" };
  if (OCM_API_KEY) headers["X-API-Key"] = OCM_API_KEY;

  try {
    const res = await fetchWithTimeout(url, { headers }, 15000);

    const retryAfterHeader = res.headers.get("Retry-After");

    if (res.status === 429) {
      console.log(
        `⚠️ 429 em tile [${lat},${lon}]${retryAfterHeader ? ` (Retry-After: ${retryAfterHeader}s)` : ""}`
      );
      return { status: 429, postos: [] };
    }

    if (res.status === 403) {
      console.log(`⛔ 403 em tile [${lat},${lon}] — verifique API key / bloqueio de IP`);
      return { status: 403, postos: [] };
    }

    if (!res.ok) {
      console.log(`❌ HTTP ${res.status} em tile [${lat},${lon}]`);
      return { status: res.status, postos: [] };
    }

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
    if (err.name === "AbortError") {
      console.log(`⏱️ Timeout em tile [${lat},${lon}]`);
      return { status: 408, postos: [] };
    }
    console.log(`❌ Erro fetch em tile [${lat},${lon}]: ${err.message}`);
    return { status: 500, postos: [] };
  }
}

// ===============================
// FUNÇÃO: ANEEL
// ===============================
async function buscarEletropostosANEEL(): Promise<Eletroposto[]> {
  console.log("🔌 Buscando eletropostos da base ANEEL...");
  try {
    const res = await fetchWithTimeout(ANEEL_URL, {}, 20000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const postosANEEL: Eletroposto[] = data
      .filter((p: any) => p.Latitude && p.Longitude)
      .map((p: any, i: number) => ({
        id: `aneel_${i}`,
        name: p["Nome Empreendimento"] || "Eletroposto ANEEL",
        latitude: parseFloat(p.Latitude),
        longitude: parseFloat(p.Longitude),
        address: p.Municipio || "",
        source: "ANEEL",
      }));
    console.log(`✅ ANEEL: ${postosANEEL.length} registros`);
    return postosANEEL;
  } catch (err: any) {
    console.error("⚠️ Erro ao buscar ANEEL:", err.message);
    return [];
  }
}

// ===============================
// FUNÇÃO: GOOGLE PLACES
// ===============================
async function buscarEletropostosGoogle(): Promise<Eletroposto[]> {
  console.log("🌐 Buscando eletropostos via Google Places...");
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
    } catch (err: any) {
      console.warn(`⚠️ Falha em ${c.nome}: ${err.message}`);
    }
  }

  console.log(`✅ Google Places: ${todos.length} registros`);
  return todos;
}

// ===============================
// MAIN LOOP
// ===============================
async function main() {
  console.log("🗺️ Iniciando crawler autocalibrável (Brasil)...");
  const grid = gerarGrid();
  console.log(`📍 Total tiles: ${grid.length}`);

  // 👉 Criar a barra de progresso
  const bar = new cliProgress.SingleBar(
    {
      format: "Progresso |{bar}| {percentage}% | Tiles: {value}/{total} | BatchSize: {batchSize}",
      barCompleteChar: "█",
      barIncompleteChar: "-",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(grid.length, 0, { batchSize });

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
    const batch = grid.slice(idx, idx + batchSize);

    const promises = batch.map((tile) =>
      buscarEletropostosTile(tile.lat, tile.lon)
        .then((res) => ({ tile, res }))
        .catch(() => ({ tile, res: { status: 500, postos: [] } }))
    );

    const results = await Promise.all(promises);

    let countOk = 0,
      count429 = 0,
      count403 = 0,
      countOther = 0;
    for (const item of results) {
      const s = item.res.status;
      if (s === 200) countOk++;
      else if (s === 429) count429++;
      else if (s === 403) count403++;
      else countOther++;
    }

    let novosNoBatch = 0;
    for (const item of results) {
      if (item.res.status !== 200) continue;
      for (const posto of item.res.postos) {
        if (!idsRegistrados.has(posto.id)) {
          idsRegistrados.add(posto.id);
          postos.push(posto);
          novosNoBatch++;
        }
      }
    }

    if (novosNoBatch > 0) await salvarJSON();

    // Atualizar a barra de progresso
    idx += batch.length;
    bar.update(idx, { batchSize });

    // Adaptação automática (mantida igual)
    if (count429 > 0) {
      batchSize = Math.max(MIN_BATCH, Math.floor(batchSize / 2));
      interBatchDelay = Math.min(MAX_DELAY, interBatchDelay * 1.5);
      stableOkBatches = 0;
      await sleep(interBatchDelay);
      continue;
    }

    if (count403 > 0) {
      batchSize = Math.max(MIN_BATCH, Math.floor(batchSize / 2));
      interBatchDelay = Math.min(MAX_DELAY, interBatchDelay * 4);
      stableOkBatches = 0;
      await sleep(60000);
      continue;
    }

    if (countOk === batch.length) {
      stableOkBatches++;
      if (stableOkBatches >= STABLE_INCREASE_THRESHOLD) {
        batchSize = Math.min(MAX_BATCH, batchSize + 1);
        interBatchDelay = Math.max(MIN_DELAY, Math.floor(interBatchDelay * 0.9));
        stableOkBatches = 0;
      }
    } else {
      stableOkBatches = 0;
    }

    await sleep(interBatchDelay);
  }

  bar.stop(); // Finaliza a barra ao final do grid

  // --- NOVO: fontes externas ---
  console.log("\n🌍 Adicionando fontes extras (ANEEL + Google)...");
  const aneel = await buscarEletropostosANEEL();
  const google = await buscarEletropostosGoogle();
  const extras = [...aneel, ...google].filter((p) => !idsRegistrados.has(p.id));
  for (const e of extras) {
    idsRegistrados.add(e.id);
    postos.push(e);
  }
  await salvarJSON();

  console.log(`\n✅ Crawler finalizado. Postos totais: ${postos.length}`);
}

main().catch((err) => {
  console.error("Erro fatal no crawler:", err);
});
