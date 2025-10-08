import requests
import json
import folium
import time

# --- ETAPA 1: CONFIGURAÇÃO ---

# Catálogo de veículos com suas autonomias e cores para o mapa
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
        "cor": "gray" # Corrigido para 'gray' que é uma cor válida no Folium
    },
    {
        "modelo": "Porsche Macan Turbo",
        "autonomia_km": 435,
        "cor": "darkred" # Corrigido para uma cor válida
    },
    {
        "modelo": "Mercedes EQS + 450",
        "autonomia_km": 411,
        "cor": "lightgray" # Corrigido para uma cor válida
    },
    {
        "modelo": "Chevrolet Blazer EV",
        "autonomia_km": 481,
        "cor": "white"
    },
]

# Coordenadas dos pontos-chave da rota no formato {longitude},{latitude}
PONTOS_CHAVE_API = {
    "florianopolis": "-48.5583,-27.5935",
    "curitiba": "-49.2733,-25.4284",
    "sao_paulo": "-46.6333,-23.5505",
    "rio_de_janeiro": "-43.1729,-22.9068", 
    "belo_horizonte": "-43.9830,-19.9307",
    "campo_grande": "-54.5692,-20.5236",
    "porto_alegre": "-51.069,-29.954",
    "salvador": "-38.284,-12.855",
    "recife": "-34.9369,-8.1706",
     


}

# Sua chave da API OpenChargeMap
OCM_API_KEY = "813110e4-2f26-4b74-9fc8-da2269128a94"
headers = {"X-API-Key": OCM_API_KEY}

# --- ETAPA 2: FUNÇÕES PARA COLETAR DADOS ---

def get_route_waypoints(start_coords, end_coords):
    """
    Busca os waypoints de uma rota entre dois pontos usando a API OSRM.
    Função robusta que verifica se uma rota foi encontrada.
    """
    # Limpa as coordenadas de possíveis espaços em branco
    start_coords_clean = start_coords.replace(" ", "")
    end_coords_clean = end_coords.replace(" ", "")
    
    url = f"https://router.project-osrm.org/route/v1/driving/{start_coords_clean};{end_coords_clean}?overview=full&geometries=geojson"
    
    try:
        response = requests.get(url)
        # Verifica se a requisição foi bem-sucedida
        response.raise_for_status()
        data = response.json()
        
        # --- MUDANÇA PRINCIPAL AQUI ---
        # Verifica se a chave 'routes' existe e se a lista não está vazia
        if data.get('routes'):
            # Se tudo estiver ok, retorna as coordenadas
            return data['routes'][0]['geometry']['coordinates']
        else:
            # Se a API não retornou uma rota, imprime um aviso e retorna uma lista vazia
            print(f"--> Aviso: Nenhuma rota encontrada no OSRM para o trecho {start_coords} -> {end_coords}.")
            return []
            
    except requests.exceptions.RequestException as e:
        print(f"--> Erro de Conexão ao buscar rota de {start_coords} para {end_coords}: {e}")
        return []
    except json.JSONDecodeError:
        print(f"--> Erro: A resposta da API para o trecho {start_coords} -> {end_coords} não é um JSON válido.")
        return []


def find_charging_stations(waypoints):
    """Busca por eletropostos ao longo de uma lista de waypoints."""
    postos_encontrados = {}
    radius_km = 5 # Correção: Definindo o raio aqui

    for i, wp in enumerate(waypoints[::50]):
        lon, lat = wp
        ocm_url = (
            f"https://api.openchargemap.io/v3/poi/?output=json"
            f"&countrycode=BR&latitude={lat}&longitude={lon}"
            f"&distance={radius_km}&distanceunit=KM"
        )
        try:
            print(f"Consultando postos perto do waypoint {i+1}/{len(waypoints[::50])}...")
            req = requests.get(ocm_url, headers=headers)
            req.raise_for_status()
            res = req.json()
            for posto in res:
                postos_encontrados[posto["ID"]] = posto
        except Exception as e:
            print(f"--> Aviso: erro ao consultar waypoint {i}: {e}")
        time.sleep(0.5)

    return list(postos_encontrados.values())

# --- ETAPA 3: EXECUÇÃO DA COLETA ---

print("--- Iniciando coleta da rota completa ---")
rota_fln_cwb = get_route_waypoints(PONTOS_CHAVE_API["florianopolis"], PONTOS_CHAVE_API["curitiba"])
rota_cwb_sp = get_route_waypoints(PONTOS_CHAVE_API["curitiba"], PONTOS_CHAVE_API["sao_paulo"])
rota_sp_rj = get_route_waypoints(PONTOS_CHAVE_API["sao_paulo"], PONTOS_CHAVE_API["rio_de_janeiro"])
rota_sp_cg = get_route_waypoints(PONTOS_CHAVE_API["sao_paulo"], PONTOS_CHAVE_API["campo_grande"])
rota_sp_mg = get_route_waypoints(PONTOS_CHAVE_API["sao_paulo"], PONTOS_CHAVE_API["belo_horizonte"])
rota_sv_rf = get_route_waypoints(PONTOS_CHAVE_API["salvador"], PONTOS_CHAVE_API["recife"])
rota_fln_poa = get_route_waypoints(PONTOS_CHAVE_API["florianopolis"], PONTOS_CHAVE_API["porto_alegre"])


rota_completa = rota_fln_cwb + rota_cwb_sp + rota_sp_rj + rota_sp_cg + rota_sp_mg + rota_sv_rf + rota_fln_poa 
print(f"\nRota completa calculada com {len(rota_completa)} waypoints.")

with open('waypoints_rota_completa.json', 'w') as f:
    json.dump(rota_completa, f)
print("Waypoints da rota completa salvos em 'waypoints_rota_completa.json'")

print("\n--- Iniciando busca por eletropostos na rota ---")
eletropostos_na_rota = find_charging_stations(rota_completa)
print(f"\nTotal de {len(eletropostos_na_rota)} eletropostos únicos encontrados no trajeto.")

with open("eletropostos_rota_completa.json", "w", encoding="utf-8") as f:
    json.dump(eletropostos_na_rota, f, ensure_ascii=False, indent=2)
print("Eletropostos salvos em 'eletropostos_rota_completa.json'")


# --- ETAPA 4: PLOTAGEM DO MAPA COM FOLIUM ---

print("\n--- Gerando o mapa interativo com Folium ---")

# Dicionário com as coordenadas das 4 cidades-chave no formato para o Folium [latitude, longitude]
PONTOS_CHAVE_MAPA = {
    "florianopolis": [-27.5935, -48.5583],
    "curitiba": [-25.4284, -49.2733],
    "sao_paulo": [-23.5505, -46.6333],
    "rio_de_janeiro": [-22.9068, -43.1729],
    "belo_horizonte": [-19.9227, -43.9451],
    "campo_grande": [-20.442778, -54.646389],
    "porto_alegre": [-30.0325, -51.2304],
    "salvador": [-12.971111, -38.510833],
    "recife": [-8.05, -34.9],
}

# Inverte a rota para o formato [latitude, longitude]
rota_para_mapa = [(lat, lon) for lon, lat in rota_completa]

# Calcula o centro do mapa
mapa_centro = [
    (PONTOS_CHAVE_MAPA["florianopolis"][0] + PONTOS_CHAVE_MAPA["rio_de_janeiro"][0]) / 2,
    (PONTOS_CHAVE_MAPA["florianopolis"][1] + PONTOS_CHAVE_MAPA["rio_de_janeiro"][1]) / 2,
]

mapa = folium.Map(location=mapa_centro, zoom_start=7, tiles="CartoDB positron")

# ** ---- BLOCO DE CÓDIGO ATUALIZADO ---- **

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
        icon=folium.Icon(color='black', icon='info-sign')
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
    
# ** ---- FIM DO BLOCO ATUALIZADO ---- **

# Adiciona a rota completa no mapa
folium.PolyLine(
    locations=rota_para_mapa,
    color='blue', weight=5, opacity=0.8,
    tooltip="Rota Completa"
).add_to(mapa)

# Adiciona marcadores para os eletropostos encontrados
for posto in eletropostos_na_rota:
    try:
        lat = posto['AddressInfo']['Latitude']
        lon = posto['AddressInfo']['Longitude']
        nome = posto['AddressInfo']['Title']
        folium.Marker(
            location=[lat, lon],
            tooltip=nome,
            icon=folium.Icon(color='green', icon='flash')
        ).add_to(mapa)
    except (KeyError, TypeError):
        print(f"Aviso: registro de posto inválido ou sem coordenadas. Ignorando: {posto.get('ID')}")

# Adiciona o controle de camadas para poder ligar/desligar os círculos
folium.LayerControl().add_to(mapa)

# Salva o mapa em um arquivo HTML
mapa.save("mapa_rota_completa.html")

print("\nSUCESSO! Mapa salvo como 'mapa_rota_completa.html'. Abra este arquivo no seu navegador.")