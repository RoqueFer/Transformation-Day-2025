import requests
import json
import folium
import os
import sys

# --- ETAPA 1: CONFIGURAÇÃO DA ROTA E AUTONOMIA ---

# Coordenadas para a API OSRM (formato: longitude,latitude)
PONTOS_CHAVE_API = {
    "brasilia": "-47.9292,-15.7801",
    "campo_grande": "-54.6295,-20.4428"
}

# Coordenadas para o Folium (formato: [latitude, longitude])
PONTOS_CHAVE_MAPA = {
    "brasilia": [-15.7801, -47.9292],
    "campo_grande": [-20.4428, -54.6295]
}

# Lista de veículos para a análise de autonomia (do seu SCRIPT 3)
VEICULOS_AUTONOMIA = [
    {
        "modelo": "Peugeot E-2008 GT",
        "autonomia_km": 261,
        "cor": "green"
    },
    {
        "modelo": "BYD Dolphin Mini",
        "autonomia_km": 280,
        "cor": "blue"
    },
    {
        "modelo": "Renault Megane E-Tech",
        "autonomia_km": 337,
        "cor": "red"
    },
    {
        "modelo": "BMW IX2",
        "autonomia_km": 337,
        "cor": "yellow"
    },
    {
        "modelo": "ZEEKR X",
        "autonomia_km": 332,
        "cor": "purple"
    },
    {
        "modelo": "GMW ORA 03 GT",
        "autonomia_km": 317,
        "cor": "orange"
    },
    {
        "modelo": "Volkswagen ID.4",
        "autonomia_km": 370,
        "cor": "gray"
    },
    {
        "modelo": "Porsche Macan Turbo",
        "autonomia_km": 435,
        "cor": "darkred"
    },
    {
        "modelo": "Mercedes EQS + 450",
        "autonomia_km": 411,
        "cor": "lightgray"
    },
    {
        "modelo": "Chevrolet Blazer EV",
        "autonomia_km": 481,
        "cor": "black" # Alterado de 'white' para ser visível
    },
]

# --- ETAPA 2: FUNÇÃO PARA BUSCAR A ROTA ---

def get_route_waypoints(start_coords, end_coords):
    """Busca os waypoints de uma rota entre dois pontos usando a API OSRM."""
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

# --- ETAPA 3: CARREGAR DADOS DE ELETROPOSTOS ---

print("--- Carregando dados de eletropostos ---")
eletropostos_na_rota = []
try:
    script_path = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_path)
    eletropostos_filepath = os.path.join(project_root, 'eletropostos_rota_completa.json')

    with open(eletropostos_filepath, 'r', encoding="utf-8") as f:
        eletropostos_na_rota = json.load(f)
    print(f"Arquivo '{os.path.basename(eletropostos_filepath)}' carregado com {len(eletropostos_na_rota)} postos.")
except FileNotFoundError:
    print("Aviso: 'eletropostos_rota_completa.json' não encontrado. O mapa será gerado sem os postos.")
except Exception as e:
    print(f"Ocorreu um erro ao carregar os eletropostos: {e}")

# --- ETAPA 4: BUSCA DA ROTA E PLOTAGEM DO MAPA ---

print("\n--- Buscando rota Brasília -> Campo Grande ---")
rota_bsb_cg = get_route_waypoints(PONTOS_CHAVE_API["brasilia"], PONTOS_CHAVE_API["campo_grande"])

if not rota_bsb_cg:
    print("Não foi possível calcular a rota. O mapa será gerado sem o traçado.")
else:
    print(f"Rota calculada com {len(rota_bsb_cg)} waypoints.")

print("\n--- Gerando o mapa interativo com Folium ---")

mapa_centro = [
    (PONTOS_CHAVE_MAPA["brasilia"][0] + PONTOS_CHAVE_MAPA["campo_grande"][0]) / 2,
    (PONTOS_CHAVE_MAPA["brasilia"][1] + PONTOS_CHAVE_MAPA["campo_grande"][1]) / 2,
]
mapa = folium.Map(location=mapa_centro, zoom_start=7, tiles="CartoDB positron")

# ** ---- INÍCIO DO BLOCO DE CÓDIGO INTEGRADO (LÓGICA DO SCRIPT 2) ---- **

# 1. Cria camadas (FeatureGroup) para cada modelo de carro e para as cidades
camadas_de_autonomia = {}
for veiculo in VEICULOS_AUTONOMIA:
    camada_nome = f"Autonomia: {veiculo['modelo']} ({veiculo['autonomia_km']}km)"
    camadas_de_autonomia[veiculo["modelo"]] = folium.FeatureGroup(name=camada_nome, show=False)

camada_cidades = folium.FeatureGroup(name="Cidades-Chave", show=True)

# 2. Adiciona os círculos de autonomia usando laços
for nome_cidade, coords in PONTOS_CHAVE_MAPA.items():
    # Adiciona um marcador para a cidade
    folium.Marker(
        location=coords,
        tooltip=nome_cidade.replace("_", " ").title(),
        icon=folium.Icon(color='black', icon='star') # Alterado para estrela para destacar
    ).add_to(camada_cidades)

    # Para cada cidade, desenha um círculo para cada carro
    for veiculo in VEICULOS_AUTONOMIA:
        folium.Circle(
            location=coords,
            radius=veiculo["autonomia_km"] * 1000,
            color=veiculo["cor"],
            weight=2,
            fill=True,
            fill_color=veiculo["cor"],
            fill_opacity=0.15,
            tooltip=f"Raio de {veiculo['autonomia_km']}km a partir de {nome_cidade.title()}"
        ).add_to(camadas_de_autonomia[veiculo["modelo"]])

# 3. Adiciona as camadas prontas ao mapa
camada_cidades.add_to(mapa)
for camada in camadas_de_autonomia.values():
    camada.add_to(mapa)
    
# ** ---- FIM DO BLOCO DE CÓDIGO INTEGRADO ---- **

# Adiciona a ROTA no mapa
if rota_bsb_cg:
    rota_para_mapa = [(lat, lon) for lon, lat in rota_bsb_cg]
    folium.PolyLine(
        locations=rota_para_mapa,
        color='red', weight=5, opacity=0.8,
        tooltip="Rota Brasília -> Campo Grande"
    ).add_to(mapa)

# Adiciona os ELETROPOSTOS no mapa
for posto in eletropostos_na_rota:
    try:
        lat, lon = posto['AddressInfo']['Latitude'], posto['AddressInfo']['Longitude']
        nome = posto['AddressInfo']['Title']
        if -21 < lat < -15 and -55 < lon < -47:
            folium.Marker(
                location=[lat, lon],
                tooltip=nome,
                icon=folium.Icon(color='purple', icon='flash', prefix='fa')
            ).add_to(mapa)
    except (KeyError, TypeError):
        continue

# Adiciona o controle de camadas para poder ligar/desligar os círculos
folium.LayerControl().add_to(mapa)

# Salva o mapa
output_filename = "mapa_beta_brasilia_cg.html"
mapa.save(output_filename)

print(f"\nSUCESSO! Mapa salvo como '{output_filename}'. Abra este arquivo no seu navegador.")