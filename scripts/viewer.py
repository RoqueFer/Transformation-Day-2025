import json
import folium
from folium.plugins import MarkerCluster

# ===============================
# CONFIGURAÇÃO
# ===============================
ARQUIVO_ELETROPOSTOS = "eletropostos_live.json"
ARQUIVO_POIS = "pois_brasil_filtrado.json"
OUTPUT_MAPA = "mapa_brasil_investidores.html"

# ===============================
# FUNÇÕES AUXILIARES
# ===============================
def cor_por_score(score):
    if score >= 25:
        return "green"
    elif score >= 15:
        return "orange"
    else:
        return "red"

# ===============================
# LEITURA DOS DADOS
# ===============================
print("🗺️ Lendo dados...")
with open(ARQUIVO_ELETROPOSTOS, "r", encoding="utf-8") as f:
    eletropostos = json.load(f)

with open(ARQUIVO_POIS, "r", encoding="utf-8") as f:
    pois = json.load(f)

print(f"⚡ Eletropostos carregados: {len(eletropostos)}")
print(f"📍 POIs carregados: {len(pois)}")

# ===============================
# MAPA BASE
# ===============================
print("📍 Gerando mapa...")
mapa = folium.Map(location=[-15.78, -47.93], zoom_start=5, tiles="OpenStreetMap")

# ===============================
# CLUSTER DE ELETROPOSTOS (sem filtro)
# ===============================
cluster_eletro = MarkerCluster(name="Eletropostos").add_to(mapa)
for el in eletropostos:
    folium.Marker(
        location=[el["latitude"], el["longitude"]],
        popup=f"<b>{el['name']}</b><br>⚡ Eletroposto",
        icon=folium.Icon(color="blue", icon="bolt", prefix="fa"),
    ).add_to(cluster_eletro)

# ===============================
# CLUSTER DE POIs (com score)
# ===============================
cluster_poi = MarkerCluster(name="POIs Potenciais").add_to(mapa)
for p in pois:
    color = cor_por_score(p["score"])
    motivos = "<br>".join(p.get("motivos", []))
    marker = folium.Marker(
        location=[p["latitude"], p["longitude"]],
        popup=f"<b>{p['name']}</b><br>Tipo: {p['type']}<br>Score: {p['score']}<br><small>{motivos}</small>",
        icon=folium.Icon(color=color, icon="map-marker", prefix="fa"),
    )
    # Armazena o score no atributo "title" do ícone para uso do JS
    marker.add_child(folium.Popup())
    marker.add_to(cluster_poi)

# ===============================
# SLIDER DE SCORE (HTML + JS)
# ===============================
slider_html = """
<style>
#scoreSliderContainer {
  position: absolute;
  top: 15px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255,255,255,0.9);
  padding: 8px 16px;
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  font-family: sans-serif;
  z-index: 9999;
}
#scoreSlider {
  width: 250px;
}
</style>

<div id="scoreSliderContainer">
  <label><b>Filtrar POIs por Score mínimo:</b> <span id="scoreValue">0</span></label><br>
  <input type="range" id="scoreSlider" min="0" max="30" step="1" value="0">
</div>

<script>
  const slider = document.getElementById('scoreSlider');
  const scoreValue = document.getElementById('scoreValue');

  function atualizarVisibilidadePOIs(minScore) {
    scoreValue.textContent = minScore;
    document.querySelectorAll('.leaflet-marker-icon').forEach(icon => {
      const title = icon.title || '';
      // Apenas os POIs têm "Score" no title (eletropostos não)
      if (title.includes('Score')) {
        const match = title.match(/Score: (\\d+)/);
        const score = match ? parseInt(match[1]) : 0;
        icon.style.display = score >= minScore ? 'block' : 'none';
      }
    });
  }

  slider.addEventListener('input', e => {
    const minScore = parseInt(e.target.value);
    atualizarVisibilidadePOIs(minScore);
  });

  // Inicializa com valor 0
  atualizarVisibilidadePOIs(0);
</script>
"""

mapa.get_root().html.add_child(folium.Element(slider_html))

# ===============================
# SALVAR MAPA
# ===============================
mapa.save(OUTPUT_MAPA)
print(f"✅ Mapa gerado com sucesso: {OUTPUT_MAPA}")
