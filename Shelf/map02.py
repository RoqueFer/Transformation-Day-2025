import folium
import json

# --- arquivos ---
ELETROPOSTOS_JSON = "eletropostos_free_apis.json"
ROTA_JSON = "rota.json"

# --- carregar dados ---
with open(ELETROPOSTOS_JSON, "r", encoding="utf-8") as f:
    eletropostos = json.load(f)

with open(ROTA_JSON, "r", encoding="utf-8") as f:
    rota = json.load(f)

# --- criar mapa ---
mapa = folium.Map(location=[-23.5505, -46.6333], zoom_start=6)

# --- adicionar markers ---
for posto in eletropostos:
    lat = posto.get("latitude")
    lon = posto.get("longitude")
    if lat is None or lon is None:
        continue
    folium.Marker(
        location=[lat, lon],
        popup=f"{posto.get('name', 'Posto')}<br>{posto.get('address','')}",
        icon=folium.Icon(color="green", icon="bolt", prefix="fa")
    ).add_to(mapa)

# --- adicionar rota ---
rota_folium = [[lat, lon] for lon, lat in rota]  # inverter cada ponto
folium.PolyLine(rota_folium, color="blue", weight=4, opacity=0.7).add_to(mapa)

# --- salvar ---
mapa.save("mapa_rota.html")
print("Mapa gerado: mapa_rota.html")
