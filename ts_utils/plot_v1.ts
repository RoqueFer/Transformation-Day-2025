// mapa_rota.ts (rode com `bun run mapa_rota.ts`)
import { readFile, writeFile } from "fs/promises";

const AUTONOMIA_KM = 350;

async function main() {
  // --- 1. CARREGAR OS JSONs ---
  const waypointsData: [number, number][] = JSON.parse(
    await readFile("../resources/waypoints_curitiba_sao_paulo.json", "utf-8")
  );

  const eletropostos = JSON.parse(
    await readFile("eletropostos_free_apis.json", "utf-8")
  );

  console.log(`Carregados ${waypointsData.length} waypoints.`);
  console.log(`Carregados ${eletropostos.length} eletropostos.`);

  // --- 2. PREPARAR ROTA ---
  const rotaInvertida = waypointsData.map(([lon, lat]) => [lat, lon]);
  const coordInicio = rotaInvertida[0];
  const coordFim = rotaInvertida[rotaInvertida.length - 1];
  const mapaCentro = [
    (coordInicio[0] + coordFim[0]) / 2,
    (coordInicio[1] + coordFim[1]) / 2,
  ];

  // --- 3. GERAR HTML COM LEAFLET ---
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Mapa com Autonomia e Rota</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
  <style>
    #map { height: 100vh; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
  <script>
    const AUTONOMIA_KM = ${AUTONOMIA_KM};
    const rota = ${JSON.stringify(rotaInvertida)};
    const inicio = ${JSON.stringify(coordInicio)};
    const fim = ${JSON.stringify(coordFim)};
    const eletropostos = ${JSON.stringify(eletropostos)};

    const map = L.map('map').setView(${JSON.stringify(mapaCentro)}, 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    // Círculo de autonomia - início
    L.circle(inicio, {
      radius: AUTONOMIA_KM * 1000,
      color: '#3186cc',
      fillColor: '#3186cc',
      fillOpacity: 0.2
    }).bindPopup("Raio de Autonomia de " + AUTONOMIA_KM + "km a partir de Curitiba").addTo(map);

    // Círculo de autonomia - fim
    L.circle(fim, {
      radius: AUTONOMIA_KM * 1000,
      color: '#cc3131',
      fillColor: '#cc3131',
      fillOpacity: 0.2
    }).bindPopup("Raio de Autonomia de " + AUTONOMIA_KM + "km a partir de São Paulo").addTo(map);

    // Rota
    L.polyline(rota, { color: 'blue', weight: 5, opacity: 0.8 })
      .bindPopup("Rota Curitiba -> São Paulo")
      .addTo(map);

    // Eletropostos
    eletropostos.forEach(posto => {
      const lat = posto.AddressInfo?.Latitude;
      const lon = posto.AddressInfo?.Longitude;
      if (lat && lon) {
        const nome = posto.AddressInfo?.Title || "Nome Indisponível";
        const endereco = posto.AddressInfo?.AddressLine1 || "Endereço Indisponível";
        const popup = \`<b>\${nome}</b><br><i>\${endereco}</i>\`;
        L.marker([lat, lon]).bindPopup(popup).addTo(map);
      }
    });
  </script>
</body>
</html>
`;

  // --- 4. SALVAR ---
  await writeFile("../results/mapa_rota.html", html, "utf-8");
  console.log("Mapa salvo em ../results/mapa_rota.html");
}

main().catch(console.error);
