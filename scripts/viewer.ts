// visualizador.ts
import fs from "fs";
import path from "path";
import fetch from "node-fetch"; // Certifique-se de instalar node-fetch: npm install node-fetch

/**
 * GERADOR DE MAPA STANDALONE COM LEAFLET
 * 
 * Este script:
 * 1. LÊ os JSON que você já tem (eletropostos_live.json e pois_brasil.json)
 * 2. Converte para GeoJSON
 * 3. Gera um HTML que funciona 100% standalone
 * 
 * NÃO FAZ NOVAS BUSCAS EM APIS - só renderiza o que você já coletou!
 */

interface Eletroposto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  source: string;
}

interface POI {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  type: string;
  source: string;
  score?: number; // Adicionado para suportar scores do filtrar_pois.ts (fallback 0)
}

// Configuração
const ARQUIVO_ELETROPOSTOS = "eletropostos_live.json";
const ARQUIVO_POIS = "pois_brasil_filtrado.json";
const OUTPUT_HTML = "mapa_brasils.html";

// ============================================
// GERADOR DE HTML STANDALONE
// ============================================

function gerarHTML(postos: Eletroposto[], pois: POI[], routeCoords: [number, number][]) {
  // Agrupa POIs por tipo
  const poisPorTipo: Record<string, POI[]> = {};
  pois.forEach((poi) => {
    const tipo = poi.type || "unknown";
    if (!poisPorTipo[tipo]) poisPorTipo[tipo] = [];
    poisPorTipo[tipo].push(poi);
  });

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mapa de Eletropostos - Brasil</title>
  
  <!-- Leaflet CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  
  <!-- Leaflet MarkerCluster CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
  
  <!-- Turf.js for distance calculations -->
  <script src="https://unpkg.com/@turf/turf@6/turf.min.js"><\/script>
  
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
    
    /* Painel de Controle */
    .control-panel {
      position: absolute;
      top: 10px;
      left: 10px;
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      max-width: 320px;
      max-height: 90vh;
      overflow-y: auto;
      z-index: 1000;
    }
    
    .control-panel h2 {
      font-size: 18px;
      margin-bottom: 10px;
      color: #333;
      border-bottom: 2px solid #8A2BE2;
      padding-bottom: 5px;
    }
    
    .control-section {
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid #eee;
    }
    
    .control-section:last-child { border-bottom: none; }
    
    .control-section h3 {
      font-size: 14px;
      margin-bottom: 8px;
      color: #555;
      font-weight: 600;
    }
    
    .layer-toggle {
      display: flex;
      align-items: center;
      margin: 8px 0;
      cursor: pointer;
      padding: 5px;
      border-radius: 4px;
      transition: background 0.2s;
    }
    
    .layer-toggle:hover {
      background: #f5f5f5;
    }
    
    .layer-toggle input {
      margin-right: 8px;
      cursor: pointer;
    }
    
    .layer-toggle label {
      cursor: pointer;
      font-size: 14px;
      flex: 1;
    }
    
    .stats {
      font-size: 12px;
      color: #666;
      margin-top: 3px;
      margin-left: 24px;
      font-style: italic;
    }
    
    /* Loading */
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px 50px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 2000;
      font-size: 16px;
      text-align: center;
    }

    .loading-spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #8A2BE2;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 15px auto 0;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Customização de Popup */
    .leaflet-popup-content-wrapper {
      border-radius: 8px;
    }
    
    .leaflet-popup-content {
      margin: 10px 15px;
      font-size: 14px;
    }

    .popup-title {
      font-weight: bold;
      font-size: 15px;
      margin-bottom: 5px;
      color: #333;
    }

    .popup-address {
      color: #666;
      font-size: 13px;
      margin: 3px 0;
    }

    .popup-source {
      color: #999;
      font-size: 12px;
      font-style: italic;
      margin-top: 5px;
    }

    /* Botão de estatísticas */
    .btn-stats {
      background: #8A2BE2;
      color: white;
      border: none;
      padding: 8px 15px;
      border-radius: 5px;
      cursor: pointer;
      width: 100%;
      font-size: 13px;
      margin-top: 10px;
    }

    .btn-stats:hover {
      background: #7020C0;
    }

    .total-stats {
      background: #f0f0f0;
      padding: 10px;
      border-radius: 5px;
      margin-top: 10px;
      font-size: 12px;
    }

    .total-stats div {
      margin: 3px 0;
    }

    /* Estilos para o slider */
    #score-slider {
      width: 100%;
      margin: 10px 0;
    }

    #score-value {
      font-size: 13px;
      color: #555;
      text-align: center;
    }

    #autonomia-section {
      display: none;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  
  <div class="loading" id="loading">
    <div>🗺️ Carregando mapa...</div>
    <div class="loading-spinner"></div>
  </div>
  
  <div class="control-panel">
    <h2>🗺️ Eletropostos Brasil</h2>
    
    <div class="control-section">
      <h3>⚡ Eletropostos</h3>
      <div class="layer-toggle">
        <input type="checkbox" id="toggle-eletropostos" checked>
        <label for="toggle-eletropostos">Mostrar Eletropostos</label>
      </div>
      <div class="stats">${postos.length.toLocaleString('pt-BR')} postos no Brasil</div>
    </div>
    
    <div class="control-section">
      <h3>📍 Pontos de Interesse</h3>
      <div id="poi-toggles"></div>
      <div class="control-section">
        <h3>🔍 Filtro por Score Mínimo</h3>
        <input type="range" id="score-slider" min="0" value="0" step="1">
        <div id="score-value">Score mínimo: 0</div>
      </div>
    </div>
    
    <div class="control-section">
      <h3>🛣️ Rota Brasília - Campo Grande</h3>
      <div class="layer-toggle">
        <input type="checkbox" id="toggle-rota">
        <label for="toggle-rota">Ativar Modo Rota</label>
      </div>
    </div>
    
    <div class="control-section" id="autonomia-section">
      <h3>🚗 Autonomias de Veículos</h3>
      <div id="autonomia-toggles"></div>
    </div>
    
    <div class="control-section">
      <h3>📊 Total Geral</h3>
      <div class="total-stats">
        <div>⚡ Eletropostos: <strong>${postos.length.toLocaleString('pt-BR')}</strong></div>
        <div>📍 POIs: <strong>${pois.length.toLocaleString('pt-BR')}</strong></div>
        <div>📌 Total: <strong>${(postos.length + pois.length).toLocaleString('pt-BR')}</strong></div>
      </div>
    </div>
  </div>

  <!-- Leaflet JS -->
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  
  <!-- Leaflet MarkerCluster JS -->
  <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
  
  <script>
    console.log('🚀 Iniciando mapa...');
    
    // ============================================
    // DADOS (embutidos no HTML)
    // ============================================
    
    const ELETROPOSTOS = ${JSON.stringify(postos)};
    const POIS_POR_TIPO = ${JSON.stringify(poisPorTipo)};
    
    console.log('📊 Dados carregados:');
    console.log('  - Eletropostos:', ELETROPOSTOS.length);
    console.log('  - Tipos de POI:', Object.keys(POIS_POR_TIPO).length);
    console.log('  - Total POIs:', Object.values(POIS_POR_TIPO).reduce((sum, arr) => sum + arr.length, 0));
    
    // ============================================
    // CONFIGURAÇÃO
    // ============================================
    
    const POI_CONFIG = {
      parking: { cor: '#FF8C00', nome: 'Estacionamento', icon: '🅿️' },
      fuel: { cor: '#DC143C', nome: 'Posto Combustível', icon: '⛽' },
      gas_station: { cor: '#DC143C', nome: 'Posto Combustível', icon: '⛽' },
      supermarket: { cor: '#228B22', nome: 'Supermercado', icon: '🛒' },
      shopping_mall: { cor: '#006400', nome: 'Shopping', icon: '🏬' },
      hotel: { cor: '#191970', nome: 'Hotel', icon: '🏨' },
      motel: { cor: '#87CEEB', nome: 'Motel', icon: '🛏️' },
      restaurant: { cor: '#32CD32', nome: 'Restaurante', icon: '🍴' },
      rest_area: { cor: '#5F9EA0', nome: 'Área Descanso', icon: '☕' },
      unknown: { cor: '#808080', nome: 'Outro', icon: '❓' }
    };

    const PONTOS_CHAVE = {
      brasilia: [-15.7801, -47.9292],
      campo_grande: [-20.4428, -54.6295]
    };

    const VEICULOS_AUTONOMIA = [
      { modelo: "Peugeot E-2008 GT", autonomia_km: 261, cor: "green" },
      { modelo: "BYD Dolphin Mini", autonomia_km: 280, cor: "blue" },
      { modelo: "Renault Megane E-Tech", autonomia_km: 337, cor: "red" },
      { modelo: "BMW IX2", autonomia_km: 337, cor: "yellow" },
      { modelo: "ZEEKR X", autonomia_km: 332, cor: "purple" },
      { modelo: "GMW ORA 03 GT", autonomia_km: 317, cor: "orange" },
      { modelo: "Volkswagen ID.4", autonomia_km: 370, cor: "gray" },
      { modelo: "Porsche Macan Turbo", autonomia_km: 435, cor: "darkred" },
      { modelo: "Mercedes EQS + 450", autonomia_km: 411, cor: "lightgray" },
      { modelo: "Chevrolet Blazer EV", autonomia_km: 481, cor: "black" }
    ];

    const ROUTE_COORDS = ${JSON.stringify(routeCoords)}; // [lon, lat] pairs

    // ============================================
    // CRIAÇÃO DO MAPA
    // ============================================
    
    const map = L.map('map').setView([-14.2350, -51.9253], 5);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
      attribution: '© CartoDB',
      maxZoom: 19
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      attribution: '© CartoDB',
      maxZoom: 19
    });

    // ============================================
    // ELETROPOSTOS
    // ============================================
    
    console.log('⚡ Adicionando eletropostos...');
    
    const eletropostosCluster = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 200,
      chunkDelay: 50,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count > 100) size = 'large';
        else if (count > 10) size = 'medium';
        
        return L.divIcon({
          html: '<div style="background: #8A2BE2; color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">' + count + '</div>',
          className: 'marker-cluster marker-cluster-' + size,
          iconSize: L.point(40, 40)
        });
      }
    });

    const eletropostosMarkers = [];
    ELETROPOSTOS.forEach((posto, index) => {
      if (!posto.latitude || !posto.longitude) return;
      
      const marker = L.marker([posto.latitude, posto.longitude], {
        icon: L.divIcon({
          html: '<div style="background: #8A2BE2; color: white; border-radius: 50%; width: 20px; height: 20px; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>',
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      });
      
      marker.bindPopup(\`
        <div class="popup-title">⚡ \${posto.name || 'Sem nome'}</div>
        <div class="popup-address">\${posto.address || 'Endereço não disponível'}</div>
        <div class="popup-source">Fonte: \${posto.source}</div>
      \`);
      
      marker.score = 0; // Fallback, eletropostos não têm score
      eletropostosMarkers.push(marker);
    });

    eletropostosCluster.addLayers(eletropostosMarkers);
    map.addLayer(eletropostosCluster);
    const allMarkers = new Map([['eletropostos', eletropostosMarkers]]);
    const layersMap = new Map([['eletropostos', eletropostosCluster]]);

    // ============================================
    // POIs
    // ============================================
    
    console.log('📍 Adicionando POIs...');
    
    const poiTogglesContainer = document.getElementById('poi-toggles');
    
    Object.entries(POIS_POR_TIPO).forEach(([tipo, pois]) => {
      const config = POI_CONFIG[tipo] || POI_CONFIG.unknown;
      
      const poiCluster = L.markerClusterGroup({
        chunkedLoading: true,
        chunkInterval: 200,
        chunkDelay: 50,
        maxClusterRadius: 40,
        iconCreateFunction: function(cluster) {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: '<div style="background: ' + config.cor + '; color: white; border-radius: 50%; width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">' + count + '</div>',
            className: '',
            iconSize: L.point(35, 35)
          });
        }
      });

      const markers = [];
      pois.forEach(poi => {
        if (!poi.latitude || !poi.longitude) return;
        
        const marker = L.marker([poi.latitude, poi.longitude], {
          icon: L.divIcon({
            html: '<div style="background: ' + config.cor + '; color: white; border-radius: 50%; width: 16px; height: 16px; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>',
            className: '',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          })
        });
        
        marker.bindPopup(\`
          <div class="popup-title">\${config.icon} \${poi.name || 'Sem nome'}</div>
          <div class="popup-address">\${poi.address || 'Endereço não disponível'}</div>
          <div class="popup-source">\${config.nome} • \${poi.source}</div>
        \`);
        
        marker.score = poi.score || 0; // Fallback para 0
        markers.push(marker);
      });

      poiCluster.addLayers(markers);
      allMarkers.set(tipo, markers);
      layersMap.set(\`poi-\${tipo}\`, poiCluster);

      // Cria toggle
      const toggleDiv = document.createElement('div');
      toggleDiv.className = 'layer-toggle';
      toggleDiv.innerHTML = \`
        <input type="checkbox" id="toggle-\${tipo}">
        <label for="toggle-\${tipo}">\${config.icon} \${config.nome}</label>
      \`;
      poiTogglesContainer.appendChild(toggleDiv);

      const statsDiv = document.createElement('div');
      statsDiv.className = 'stats';
      statsDiv.textContent = \`\${pois.length.toLocaleString('pt-BR')} locais\`;
      poiTogglesContainer.appendChild(statsDiv);

      document.getElementById(\`toggle-\${tipo}\`).addEventListener('change', (e) => {
        const layer = layersMap.get(\`poi-\${tipo}\`);
        if (e.target.checked) {
          map.addLayer(layer);
        } else {
          map.removeLayer(layer);
        }
        updateMarkers(); // Atualiza para aplicar filtros
      });
      
      console.log(\`  ✓ \${tipo}: \${pois.length} pontos\`);
    });

    // ============================================
    // CONFIGURAÇÃO DO SLIDER E ROTA
    // ============================================
    
    // Calcular max score
    let maxScore = 0;
    Object.values(POIS_POR_TIPO).forEach(arr => {
      arr.forEach(poi => {
        maxScore = Math.max(maxScore, poi.score || 0);
      });
    });
    document.getElementById('score-slider').max = maxScore;

    let minScore = 0;
    let rotaFilterOn = false;
    let rotaPolyline = null;
    let routeLine = null;
    let cidadesMarkers = L.layerGroup();

    // Layers para autonomias
    const autonomiaLayers = new Map();

    // Cria toggles para autonomias
    const autonomiaTogglesContainer = document.getElementById('autonomia-toggles');
    VEICULOS_AUTONOMIA.forEach((veiculo, index) => {
      const toggleDiv = document.createElement('div');
      toggleDiv.className = 'layer-toggle';
      toggleDiv.innerHTML = \`
        <input type="checkbox" id="toggle-autonomia-\${index}">
        <label for="toggle-autonomia-\${index}">\${veiculo.modelo} (\${veiculo.autonomia_km}km)</label>
      \`;
      autonomiaTogglesContainer.appendChild(toggleDiv);

      const layerGroup = L.layerGroup();
      autonomiaLayers.set(index, layerGroup);

      document.getElementById(\`toggle-autonomia-\${index}\`).addEventListener('change', (e) => {
        if (e.target.checked) {
          map.addLayer(layerGroup);
        } else {
          map.removeLayer(layerGroup);
        }
      });
    });

    if (ROUTE_COORDS && ROUTE_COORDS.length > 0) {
      routeLine = turf.lineString(ROUTE_COORDS); // [lon, lat]
      const polyCoords = ROUTE_COORDS.map(c => [c[1], c[0]]); // [lat, lon] for Leaflet
      rotaPolyline = L.polyline(polyCoords, {color: 'red', weight: 5, opacity: 0.8});
    } else {
      console.warn('Rota não disponível.');
    }

    // Adiciona markers das cidades
    Object.entries(PONTOS_CHAVE).forEach(([nome, coords]) => {
      L.marker(coords, {
        icon: L.divIcon({
          html: '<i class="fa fa-star" style="color: black; font-size: 20px;"></i>',
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).bindTooltip(nome.replace('_', ' ').toUpperCase()).addTo(cidadesMarkers);
    });

    // Preenche os layers de autonomia
    VEICULOS_AUTONOMIA.forEach((veiculo, index) => {
      const layerGroup = autonomiaLayers.get(index);
      Object.entries(PONTOS_CHAVE).forEach(([nome, coords]) => {
        L.circle(coords, {
          radius: veiculo.autonomia_km * 1000,
          color: veiculo.cor,
          weight: 2,
          fill: true,
          fillColor: veiculo.cor,
          fillOpacity: 0.15
        }).bindTooltip(\`Raio de \${veiculo.autonomia_km}km - \${veiculo.modelo}\`).addTo(layerGroup);
      });
    });

    function updateMarkers() {
      // Eletropostos
      const eletroCluster = layersMap.get('eletropostos');
      if (map.hasLayer(eletroCluster)) {
        eletroCluster.clearLayers();
        const filtered = eletropostosMarkers.filter(marker => {
          if (rotaFilterOn) {
            if (!routeLine) return false;
            const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
            const dist = turf.pointToLineDistance(point, routeLine, {units: 'kilometers'});
            if (dist > 1.5) return false;
          }
          return marker.score >= minScore;
        });
        eletroCluster.addLayers(filtered);
      }

      // POIs
      Object.keys(POIS_POR_TIPO).forEach(tipo => {
        const cluster = layersMap.get(\`poi-\${tipo}\`);
        if (map.hasLayer(cluster)) {
          cluster.clearLayers();
          const markers = allMarkers.get(tipo);
          const filtered = markers.filter(marker => {
            if (rotaFilterOn) {
              if (!routeLine) return false;
              const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
              const dist = turf.pointToLineDistance(point, routeLine, {units: 'kilometers'});
              if (dist > 1.5) return false;
            }
            return marker.score >= minScore;
          });
          cluster.addLayers(filtered);
        }
      });
    }

    // Evento do slider
    document.getElementById('score-slider').addEventListener('input', (e) => {
      minScore = parseInt(e.target.value);
      document.getElementById('score-value').textContent = \`Score mínimo: \${minScore}\`;
      updateMarkers();
    });

    // Evento do toggle rota
    document.getElementById('toggle-rota').addEventListener('change', (e) => {
      rotaFilterOn = e.target.checked;
      const autonomiaSection = document.getElementById('autonomia-section');
      autonomiaSection.style.display = rotaFilterOn ? 'block' : 'none';

      if (rotaFilterOn) {
        if (rotaPolyline) map.addLayer(rotaPolyline);
        map.addLayer(cidadesMarkers);
      } else {
        if (rotaPolyline) map.removeLayer(rotaPolyline);
        map.removeLayer(cidadesMarkers);
        // Remove todas as autonomias
        for (let i = 0; i < VEICULOS_AUTONOMIA.length; i++) {
          const checkbox = document.getElementById(\`toggle-autonomia-\${i}\`);
          checkbox.checked = false;
          const layer = autonomiaLayers.get(i);
          map.removeLayer(layer);
        }
      }
      updateMarkers();
    });

    // ============================================
    // CONTROLES
    // ============================================
    
    document.getElementById('toggle-eletropostos').addEventListener('change', (e) => {
      const layer = layersMap.get('eletropostos');
      if (e.target.checked) {
        map.addLayer(layer);
      } else {
        map.removeLayer(layer);
      }
      updateMarkers(); // Atualiza para aplicar filtros
    });

    // Remove loading
    document.getElementById('loading').style.display = 'none';
    
    console.log('✅ Mapa pronto!');
  <\/script>
</body>
</html>`;

  return html;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🗺️ GERADOR DE MAPA STANDALONE");
  console.log("   (Lê seus JSON e gera HTML autocontido)");
  console.log("=".repeat(60) + "\n");

  // Carrega dados existentes
  let postos: Eletroposto[] = [];
  let pois: POI[] = [];
  let routeCoords: [number, number][] = [];

  console.log("📥 Lendo arquivos JSON...\n");

  if (fs.existsSync(ARQUIVO_ELETROPOSTOS)) {
    const data = fs.readFileSync(ARQUIVO_ELETROPOSTOS, "utf-8");
    postos = JSON.parse(data);
    console.log(`  ✅ ${postos.length.toLocaleString()} eletropostos carregados`);
  } else {
    console.log(`  ⚠️ Arquivo ${ARQUIVO_ELETROPOSTOS} não encontrado`);
  }

  if (fs.existsSync(ARQUIVO_POIS)) {
    const data = fs.readFileSync(ARQUIVO_POIS, "utf-8");
    pois = JSON.parse(data);
    console.log(`  ✅ ${pois.length.toLocaleString()} POIs carregados`);
  } else {
    console.log(`  ⚠️ Arquivo ${ARQUIVO_POIS} não encontrado`);
  }

  if (postos.length === 0 && pois.length === 0) {
    console.log("\n❌ Nenhum dado encontrado! Execute o crawler primeiro.");
    return;
  }

  // Busca a rota via OSRM
  console.log("\n🛣️ Buscando rota Brasília - Campo Grande...");
  try {
    const start = "-47.9292,-15.7801";
    const end = "-54.6295,-20.4428";
    const url = `http://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.routes && data.routes[0]) {
      routeCoords = data.routes[0].geometry.coordinates; // [lon, lat]
      console.log(`  ✅ Rota carregada com ${routeCoords.length} pontos`);
    } else {
      console.log("  ⚠️ Nenhuma rota encontrada");
    }
  } catch (e) {
    console.log(`  ❌ Erro ao buscar rota: ${e}`);
  }

  // Estatísticas
  console.log("\n📊 Estatísticas dos POIs:");
  const tiposPOI: Record<string, number> = {};
  pois.forEach(poi => {
    const tipo = poi.type || "unknown";
    tiposPOI[tipo] = (tiposPOI[tipo] || 0) + 1;
  });
  
  Object.entries(tiposPOI)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([tipo, count]) => {
      console.log(`  • ${tipo}: ${count.toLocaleString()}`);
    });

  // Gera HTML
  console.log("\n🌐 Gerando HTML standalone...");
  const html = gerarHTML(postos, pois, routeCoords);
  fs.writeFileSync(OUTPUT_HTML, html);

  const tamanhoMB = (fs.statSync(OUTPUT_HTML).size / 1024 / 1024).toFixed(2);
  console.log(`  ✅ Arquivo gerado: ${OUTPUT_HTML} (${tamanhoMB} MB)`);

  console.log("\n" + "=".repeat(60));
  console.log("✨ PRONTO!");
  console.log("=".repeat(60));
  console.log(`\n💡 Como visualizar:`);
  console.log(`   python -m http.server 8000`);
  console.log(`   Abra: http://localhost:8000/${OUTPUT_HTML}`);
  console.log(`\n📌 Total de pontos no mapa: ${(postos.length + pois.length).toLocaleString()}`);
  console.log(`   ⚡ Eletropostos: ${postos.length.toLocaleString()}`);
  console.log(`   📍 POIs: ${pois.length.toLocaleString()}`);
  console.log("=".repeat(60) + "\n");
}

main();