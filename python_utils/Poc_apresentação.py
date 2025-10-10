import requests
import json
import folium
import os
import sys
import time
from geopy.distance import geodesic

# --- ETAPA 1: CONFIGURAÇÃO DA ROTA E AUTONOMIA ---

PONTOS_CHAVE_API = {
    "brasilia": "-47.9292,-15.7801",
    "campo_grande": "-54.6295,-20.4428"
}
PONTOS_CHAVE_MAPA = {
    "brasilia": [-15.7801, -47.9292],
    "campo_grande": [-20.4428, -54.6295]
}
OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94"
headers = {"X-API-Key": OCM_API_KEY}

VEICULOS_AUTONOMIA = [
    # ... (lista de veículos permanece a mesma) ...
    {
        "modelo": "Renault Megane E-Tech",
        "autonomia_km": 337,
        "cor": "red"
    },
    # ...
]

# --- ETAPA 2: FUNÇÕES PARA BUSCAR DADOS ---

def get_route_waypoints(start_coords, end_coords):
    # ... (função sem alterações) ...
    start_clean = start_coords.replace(" ", "")
    end_clean = end_coords.replace(" ", "")
    url = f"http://router.project-osrm.org/route/v1/driving/{start_clean};{end_clean}?overview=full&geometries=geojson"
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        data = response.json()
        if data.get('routes'):
            return data['routes'][0]['geometry']['coordinates']
        else:
            print(f"--> Aviso: Nenhuma rota encontrada no OSRM.")
            return []
    except Exception as e:
        print(f"--> ERRO ao buscar rota: {e}")
        return []

def find_charging_stations_on_route(waypoints):
    # ... (função sem alterações) ...
    postos_encontrados = {}
    radius_km = 15
    print("\n--- Buscando eletropostos na rota via API ---")
    for i, wp in enumerate(waypoints[::50]):
        lon, lat = wp
        ocm_url = (
            f"https://api.openchargemap.io/v3/poi/?output=json"
            f"&countrycode=BR&latitude={lat}&longitude={lon}"
            f"&distance={radius_km}&distanceunit=KM&maxresults=50"
        )
        try:
            print(f"Consultando postos perto do waypoint {i+1}/{len(waypoints[::50])}...")
            req = requests.get(ocm_url, headers=headers, timeout=15)
            req.raise_for_status()
            res = req.json()
            for posto in res:
                postos_encontrados[posto["ID"]] = posto
        except Exception as e:
            print(f"--> Aviso: erro ao consultar waypoint: {e}")
        time.sleep(0.5)
    print(f"Busca finalizada. Total de {len(postos_encontrados)} postos únicos encontrados.")
    return list(postos_encontrados.values())


# --- MODIFICADO --- Função renomeada e com parâmetro para nome do segmento
def find_pois_on_route_segment(segment_waypoints, segment_name):
    """
    Busca por POIs (postos, restaurantes, hotéis) ao longo de um segmento de rota específico.
    """
    if not segment_waypoints:
        print(f"\n--- Segmento '{segment_name}' está vazio. Nenhuma busca de POIs será feita. ---")
        return {}

    overpass_url = "http://overpass-api.de/api/interpreter"
    pois_encontrados = {}
    radius_m = 7000 # Raio de busca de 7km ao redor do ponto da rota

    poi_queries = {
        "posto_combustivel": 'node["amenity"="fuel"]',
        "restaurante": 'node["amenity"="restaurant"]',
        "hotel": 'node["tourism"~"hotel|motel"]'
    }

    print(f"\n--- Buscando POIs no segmento '{segment_name}' via Overpass API ---")

    waypoints_to_check = segment_waypoints[::20]
    if len(segment_waypoints) > 0 and not waypoints_to_check:
        waypoints_to_check = segment_waypoints[:1]

    for i, wp in enumerate(waypoints_to_check):
        lon, lat = wp
        print(f"Consultando POIs perto do waypoint {i+1}/{len(waypoints_to_check)} do segmento...")
        
        full_query = "[out:json];("
        for poi_type, query_part in poi_queries.items():
            full_query += f'{query_part}(around:{radius_m},{lat},{lon});'
        full_query += ");out body;>;out skel qt;"

        try:
            response = requests.post(overpass_url, data=full_query, timeout=30)
            response.raise_for_status()
            data = response.json()

            for element in data.get('elements', []):
                poi_id = element['id']
                if poi_id not in pois_encontrados:
                    if 'tags' in element:
                        if element['tags'].get('amenity') == 'fuel':
                            element['poi_type'] = 'Posto de Combustível'
                        elif element['tags'].get('amenity') == 'restaurant':
                             element['poi_type'] = 'Restaurante'
                        elif element['tags'].get('tourism') in ['hotel', 'motel']:
                             element['poi_type'] = 'Hotel/Motel'
                        else:
                             element['poi_type'] = 'Outro'
                    element['found_in'] = segment_name # --- NOVO --- Adiciona onde o POI foi encontrado
                    pois_encontrados[poi_id] = element
        except Exception as e:
            print(f"--> Aviso: erro ao consultar Overpass API: {e}")
        time.sleep(1) 

    print(f"Busca de POIs finalizada para '{segment_name}'. Total de {len(pois_encontrados)} POIs únicos encontrados.")
    return pois_encontrados


# --- ETAPA 3: EXECUÇÃO DA COLETA E PLOTAGEM ---

print("--- Iniciando análise para a rota Brasília -> Campo Grande ---")

rota_bsb_cg = get_route_waypoints(PONTOS_CHAVE_API["brasilia"], PONTOS_CHAVE_API["campo_grande"])
if not rota_bsb_cg:
    print("Não foi possível calcular a rota. O script será encerrado.")
    sys.exit()
print(f"Rota calculada com {len(rota_bsb_cg)} waypoints.")

eletropostos_na_rota = find_charging_stations_on_route(rota_bsb_cg)

# --- MODIFICADO --- Lógica expandida para identificar 3 segmentos: Gap e duas Zonas de Reserva
print("\n--- Calculando as 'zonas de análise' (gap de autonomia e zonas de reserva) ---")
veiculo_referencia = next(v for v in VEICULOS_AUTONOMIA if v["modelo"] == "Renault Megane E-Tech")
autonomia_maxima_km = veiculo_referencia["autonomia_km"]
autonomia_reserva_km = autonomia_maxima_km * 0.80 # Ponto de 80%

print(f"Veículo de referência: {veiculo_referencia['modelo']}")
print(f"Autonomia máxima (100%): {autonomia_maxima_km:.2f} km")
print(f"Início da zona de reserva (80%): {autonomia_reserva_km:.2f} km")


coord_brasilia = (PONTOS_CHAVE_MAPA["brasilia"][0], PONTOS_CHAVE_MAPA["brasilia"][1])
coord_campo_grande = (PONTOS_CHAVE_MAPA["campo_grande"][0], PONTOS_CHAVE_MAPA["campo_grande"][1])

gap_waypoints = []
reserva_bsb_waypoints = []
reserva_cg_waypoints = []

for wp in rota_bsb_cg:
    wp_coord = (wp[1], wp[0])
    dist_de_bsb = geodesic(coord_brasilia, wp_coord).kilometers
    dist_de_cg = geodesic(coord_campo_grande, wp_coord).kilometers

    # 1. Checa se está no GAP central
    if dist_de_bsb > autonomia_maxima_km and dist_de_cg > autonomia_maxima_km:
        gap_waypoints.append(wp)
    
    # 2. Checa se está na zona de reserva de Brasília
    if autonomia_reserva_km < dist_de_bsb <= autonomia_maxima_km:
        reserva_bsb_waypoints.append(wp)

    # 3. Checa se está na zona de reserva de Campo Grande
    if autonomia_reserva_km < dist_de_cg <= autonomia_maxima_km:
        reserva_cg_waypoints.append(wp)

print(f"Segmento 'Gap Central' encontrado com {len(gap_waypoints)} waypoints.")
print(f"Segmento 'Reserva Brasília' encontrado com {len(reserva_bsb_waypoints)} waypoints.")
print(f"Segmento 'Reserva Campo Grande' encontrado com {len(reserva_cg_waypoints)} waypoints.")

# Buscar POIs em todos os segmentos e unificar os resultados
pois_gap = find_pois_on_route_segment(gap_waypoints, "Gap Central")
pois_reserva_bsb = find_pois_on_route_segment(reserva_bsb_waypoints, "Reserva Brasília")
pois_reserva_cg = find_pois_on_route_segment(reserva_cg_waypoints, "Reserva Campo Grande")

# Unifica todos os POIs encontrados em um único dicionário para evitar duplicatas
todos_os_pois = {**pois_gap, **pois_reserva_bsb, **pois_reserva_cg}
lista_pois_final = list(todos_os_pois.values())
print(f"\nTotal de {len(lista_pois_final)} POIs únicos encontrados em todas as zonas de análise.")

# --- ETAPA 4: GERAÇÃO DO MAPA ---
print("\n--- Gerando o mapa interativo com Folium ---")
mapa_centro = [
    (PONTOS_CHAVE_MAPA["brasilia"][0] + PONTOS_CHAVE_MAPA["campo_grande"][0]) / 2,
    (PONTOS_CHAVE_MAPA["brasilia"][1] + PONTOS_CHAVE_MAPA["campo_grande"][1]) / 2,
]
mapa = folium.Map(location=mapa_centro, zoom_start=7, tiles="CartoDB positron")

# Camadas de autonomia
# ... (lógica sem alterações, mas vamos adicionar os círculos de 80% abaixo) ...

# Adiciona círculos de autonomia (100% e 80%)
for nome_cidade, coords in PONTOS_CHAVE_MAPA.items():
    # Círculo de 100% (igual ao anterior)
    folium.Circle(
        location=coords, radius=autonomia_maxima_km * 1000, color=veiculo_referencia["cor"],
        weight=2, fill=True, fill_color=veiculo_referencia["cor"], fill_opacity=0.15,
        tooltip=f"Raio de {autonomia_maxima_km}km (100%)"
    ).add_to(mapa)
    # --- NOVO --- Círculo de 80% (tracejado)
    folium.Circle(
        location=coords, radius=autonomia_reserva_km * 1000, color=veiculo_referencia["cor"],
        weight=2, fill=False, dash_array='5, 5',
        tooltip=f"Raio de {autonomia_reserva_km:.0f}km (80%)"
    ).add_to(mapa)
    
# Adiciona marcadores das cidades
for nome_cidade, coords in PONTOS_CHAVE_MAPA.items():
     folium.Marker(location=coords, tooltip=nome_cidade.replace("_", " ").title(), icon=folium.Icon(color='black', icon='star')).add_to(mapa)

# Adiciona a ROTA completa
rota_para_mapa = [(lat, lon) for lon, lat in rota_bsb_cg]
folium.PolyLine(locations=rota_para_mapa, color='gray', weight=5, opacity=0.8, tooltip="Rota Completa").add_to(mapa)

# --- NOVO --- Adiciona os segmentos de análise com cores diferentes
camada_segmentos = folium.FeatureGroup(name="Zonas de Análise de POIs", show=True).add_to(mapa)
if gap_waypoints:
    gap_para_mapa = [(lat, lon) for lon, lat in gap_waypoints]
    folium.PolyLine(locations=gap_para_mapa, color='blue', weight=8, opacity=0.7, tooltip="Segmento Crítico (Gap Central)").add_to(camada_segmentos)
if reserva_bsb_waypoints:
    reserva_bsb_mapa = [(lat, lon) for lon, lat in reserva_bsb_waypoints]
    folium.PolyLine(locations=reserva_bsb_mapa, color='orange', weight=8, opacity=0.7, tooltip="Segmento 'Reserva Brasília'").add_to(camada_segmentos)
if reserva_cg_waypoints:
    reserva_cg_mapa = [(lat, lon) for lon, lat in reserva_cg_waypoints]
    folium.PolyLine(locations=reserva_cg_mapa, color='orange', weight=8, opacity=0.7, tooltip="Segmento 'Reserva Campo Grande'").add_to(camada_segmentos)

# Adiciona os ELETROPOSTOS existentes
camada_eletropostos = folium.FeatureGroup(name="Eletropostos Existentes", show=True).add_to(mapa)
# ... (lógica sem alterações) ...
for posto in eletropostos_na_rota:
    try:
        lat, lon = posto['AddressInfo']['Latitude'], posto['AddressInfo']['Longitude']
        nome = posto['AddressInfo']['Title']
        folium.Marker(location=[lat, lon], tooltip=f"ELETROPOSTO: {nome}", icon=folium.Icon(color='purple', icon='bolt', prefix='fa')).add_to(camada_eletropostos)
    except (KeyError, TypeError): continue

# Adiciona os POIs encontrados
camada_pois = folium.FeatureGroup(name="Pontos de Interesse (Potenciais)", show=True).add_to(mapa)
poi_icons = {
    "Posto de Combustível": {'color': 'red', 'icon': 'tint', 'prefix': 'fa'},
    "Restaurante": {'color': 'green', 'icon': 'cutlery', 'prefix': 'fa'},
    "Hotel/Motel": {'color': 'darkblue', 'icon': 'bed', 'prefix': 'fa'},
    "Outro": {'color': 'gray', 'icon': 'question-circle', 'prefix': 'fa'}
}
for poi in lista_pois_final:
    try:
        lat, lon = poi['lat'], poi['lon']
        nome = poi.get('tags', {}).get('name', 'Sem nome')
        tipo = poi.get('poi_type', 'Outro')
        zona = poi.get('found_in', 'N/A') # --- NOVO --- Pega a zona onde foi encontrado
        icon_info = poi_icons[tipo]
        
        popup_html = f"<b>{tipo}</b><br>Nome: {nome}<br><i>Encontrado em: {zona}</i>" # --- NOVO --- Adiciona zona ao popup
        folium.Marker(
            location=[lat, lon], tooltip=f"POI: {nome} ({tipo})",
            popup=folium.Popup(popup_html, max_width=250),
            icon=folium.Icon(**icon_info)
        ).add_to(camada_pois)
    except (KeyError, TypeError): continue

# Controle de Camadas e Salvamento
folium.LayerControl().add_to(mapa)
output_filename = "mapa_analise_completa_eletropostos.html"
mapa.save(output_filename)

print(f"\nSUCESSO! Mapa salvo como '{output_filename}'.")
print("Abra o arquivo no seu navegador para ver a análise interativa.")