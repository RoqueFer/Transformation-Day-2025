// waypoints_batches_with_logs.ts
import { writeFile } from "fs/promises";

const startCoords = [-49.2733, -25.4284]; // Curitiba
const endCoords = [-46.6333, -23.5505];   // São Paulo

const OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94";

// Parâmetros
const WAYPOINT_STEP = 10;       // 1 a cada 10 pontos
const MAX_CONCURRENT = 10;      // max requests simultâneas
const MAX_RETRIES = 3;          // max tentativas
const BATCH_DELAY_MS = 500;     // delay entre batches
const FETCH_TIMEOUT_MS = 10000; // timeout de cada fetch
const RADIUS_KM = 0.8;

// Haversine para calcular distância real
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (x: number) => x * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2)**2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// fetch com timeout
async function fetchWithTimeout(url: string, headers: any, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// fetch com retries e backoff exponencial
async function fetchWithRetry(url: string, headers: any, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, headers, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e: any) {
      console.error(`Erro na requisição ${url} (tentativa ${attempt}):`, e.message || e);
      if (attempt === retries) throw e;
      const wait = 500 * Math.pow(2, attempt - 1); // backoff exponencial
      console.log(`→ Retry ${attempt} em ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// Worker limitado
async function worker(urls: string[], results: any[], startIndex: number, headers: any) {
  for (let i = 0; i < urls.length; i++) {
    try {
      const data = await fetchWithRetry(urls[i], headers);
      results[startIndex + i] = { i: startIndex + i, postos: data };
    } catch (error: any) {
      console.error(`❌ Erro persistente no waypoint ${startIndex + i}:`, error.message || error);
      results[startIndex + i] = { i: startIndex + i, error };
    }
  }
}

// Função principal
async function main() {
  console.log("Buscando rota no OSRM...");
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startCoords.join(",")};${endCoords.join(",")}?overview=full&geometries=geojson`;
  const routeRes = await fetch(osrmUrl);
  const routeData = await routeRes.json();

  const waypoints: [number, number][] = routeData.routes[0].geometry.coordinates;
  console.log(`Total de waypoints: ${waypoints.length}`);

  const sampledWaypoints = waypoints.filter((_, i) => i % WAYPOINT_STEP === 0);
  console.log(`Waypoints amostrados: ${sampledWaypoints.length}`);

  // URLs para consulta de eletropostos
  const urls = sampledWaypoints.map(([lon, lat]) =>
    `https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR&latitude=${lat}&longitude=${lon}&distance=${RADIUS_KM}&distanceunit=KM`
  );

  const results: any[] = [];

  // Processamento em batches com limite de concorrência
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
    const batch = urls.slice(i, i + MAX_CONCURRENT);
    console.log(`🔹 Processando batch ${i} - ${i + batch.length - 1}`);
    await worker(batch, results, i, { "X-API-Key": OCM_API_KEY });
    console.log(`numero de postos encontrados: ${results.length}`)
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  // Filtrar e criar lista de eletropostos únicos
  const postosUnicos: Record<number, any> = {};
  results.forEach(r => {
    if ("postos" in r) {
      r.postos.forEach((posto: any) => {
        const [lonWp, latWp] = sampledWaypoints[r.i];
        const dist = haversine(latWp, lonWp, posto.AddressInfo.Latitude, posto.AddressInfo.Longitude);
        if (dist <= RADIUS_KM) postosUnicos[posto.ID] = posto;
      });
    } else if ("error" in r) {
      console.warn(`⚠️ Waypoint ${r.i} com erro persistente:`, r.error.message || r.error);
    }
  });

  console.log(`Total de eletropostos únicos: ${Object.keys(postosUnicos).length}`);

  await writeFile("eletropostos_rota.json", JSON.stringify(Object.values(postosUnicos), null, 2), "utf-8");
  console.log("Eletropostos salvos em 'eletropostos_rota.json'");
}

main().catch(console.error);
