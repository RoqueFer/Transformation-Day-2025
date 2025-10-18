import json
import folium
import os
import sys
import requests # Adicionado para buscar as rotas novamente

# --- ETAPA 1: CONFIGURAÇÃO ---
VEICULOS_AUTONOMIA = [
    # ... (sua lista de veículos continua aqui, sem alterações)
]

# Dicionário com as coordenadas para a API OSRM (lon, lat)
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
    # ... (restante das suas cidades)
}

# --- ETAPA 2: FUNÇÃO PARA BUSCAR ROTAS ---
# Reintroduzimos a função aqui para que o script de plotagem possa redesenhar as rotas

def get_route_waypoints(start_coords, end_coords):
    """Busca os waypoints de uma rota entre dois pontos usando a API OSRM."""
    start_coords_clean = start_coords.replace(" ", "")
    end_coords_clean = end_coords.replace(" ", "")
    url = f"https://router.project-osrm.org/route/v1/driving/{start_coords_clean};{end_coords_clean}?overview=full&geometries=geojson"
    try:
        response = requests.get(url)
        response.raise_for_status()
        data = response.json()
        if data.get('routes'):
            return data['routes'][0]['geometry']['coordinates']
        else:
            print(f"--> Aviso: Nenhuma rota encontrada no OSRM para o trecho.")
            return []
    except Exception as e:
        print(f"--> ERRO ao buscar rota: {e}")
        return []

# --- ETAPA 3: CARREGAR DADOS DE ELETROPOSTOS ---

print("--- Carregando arquivos de dados pré-coletados ---")
try:
    # A única coisa que precisamos carregar agora são os eletropostos. As rotas vamos buscar de novo.
    script_path = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_path)
    eletropostos_filepath = os.path.join(project_root, 'eletropostos_rota_completa.json')
    with open(eletropostos_filepath, 'r', encoding="utf-8") as f:
        eletropostos_na_rota = json.load(f)
    print("Arquivo 'eletropostos_rota_completa.json' carregado.")
except FileNotFoundError:
    print("Aviso: 'eletropostos_rota_completa.json' não encontrado. O mapa será gerado sem os eletropostos.")
    eletropostos_na_rota = []


# --- ETAPA 4: PLOTAGEM DO MAPA COM FOLIUM ---

print("\n--- Gerando o mapa interativo com Folium ---")

# Dicionário com as coordenadas para o Folium [latitude, longitude]
PONTOS_CHAVE_MAPA = {
    # ... (seu dicionário PONTOS_CHAVE_MAPA continua aqui, sem alterações)
}

# Cria o mapa base
mapa = folium.Map(location=[-22, -48], zoom_start=6, tiles="CartoDB positron")

# ** ---- MUDANÇA PRINCIPAL: DESENHAR ROTAS INDIVIDUALMENTE ---- **

# Define as rotas que queremos desenhar e as cores
rotas_a_desenhar = {
    "Sul-Sudeste": [("florianopolis", "curitiba"), ("curitiba", "sao_paulo"), ("sao_paulo", "rio_de_janeiro")],
    "Expansão Oeste": [("sao_paulo", "campo_grande")],
    "Conexão Minas": [("sao_paulo", "belo_horizonte"), ("rio_de_janeiro", "belo_horizonte")],
    "Eixo Nordeste": [("salvador", "recife")],
}

cores_rotas = ["blue", "purple", "darkred", "orange", "darkgreen"]

# Cria uma camada para as rotas
camada_rotas = folium.FeatureGroup(name="Rotas Nacionais", show=True)

print("\n--- Buscando e desenhando rotas individuais ---")
# Itera sobre cada grande eixo
for i, (nome_eixo, trechos) in enumerate(rotas_a_desenhar.items()):
    # Itera sobre os trechos dentro de cada eixo
    for inicio, fim in trechos:
        print(f"Buscando trecho: {inicio} -> {fim}")
        # Busca os waypoints para este trecho
        waypoints = get_route_waypoints(PONTOS_CHAVE_API[inicio], PONTOS_CHAVE_API[fim])
        
        if waypoints:
            # Inverte para o formato do Folium
            rota_para_mapa = [(lat, lon) for lon, lat in waypoints]
            # Desenha a linha no mapa
            folium.PolyLine(
                locations=rota_para_mapa,
                color=cores_rotas[i % len(cores_rotas)], # Usa uma cor diferente para cada eixo
                weight=5,
                opacity=0.8,
                tooltip=f"Trecho: {inicio.title()} -> {fim.title()}"
            ).add_to(camada_rotas)

camada_rotas.add_to(mapa)

# --- O RESTO DO CÓDIGO CONTINUA IGUAL ---

# Bloco para criar círculos e camadas (Lógica já estava correta)
camadas_de_autonomia = {}
for veiculo in VEICULOS_AUTONOMIA:
    camada_nome = f"Autonomia: {veiculo['modelo']} ({veiculo['autonomia_km']}km)"
    camadas_de_autonomia[veiculo["modelo"]] = folium.FeatureGroup(name=camada_nome, show=False)
camada_cidades = folium.FeatureGroup(name="Cidades-Chave", show=True)
for nome_cidade, coords in PONTOS_CHAVE_MAPA.items():
    folium.Marker(
        location=coords,
        tooltip=nome_cidade.replace("_", " ").title(),
        icon=folium.Icon(color='black', icon='info-sign')
    ).add_to(camada_cidades)
    for veiculo in VEICULOS_AUTONOMIA:
        folium.Circle(
            location=coords,
            radius=veiculo["autonomia_km"] * 1000,
            color=veiculo["cor"],
            weight=2, fill=True, fill_color=veiculo["cor"], fill_opacity=0.15,
            tooltip=f"Raio de {veiculo['autonomia_km']}km a partir de {nome_cidade.title()}"
        ).add_to(camadas_de_autonomia[veiculo["modelo"]])
camada_cidades.add_to(mapa)
for camada in camadas_de_autonomia.values():
    camada.add_to(mapa)

# Adiciona marcadores para os eletropostos
# Adiciona marcadores para os eletropostos encontrados
for posto in eletropostos_na_rota:
    try:
        lat = posto['AddressInfo']['Latitude']
        lon = posto['AddressInfo']['Longitude']
        nome = posto['AddressInfo']['Title']
        folium.Marker(
            location=[lat, lon],
            tooltip=nome,
            icon=folium.Icon(color='green', icon='flash', prefix='fa')
        ).add_to(mapa)
    except (KeyError, TypeError):
        print(f"Aviso: registro de posto inválido ou sem coordenadas. Ignorando: {posto.get('ID')}")

folium.LayerControl().add_to(mapa)
mapa.save("mapa_rotas_detalhadas.html")

print("\nSUCESSO! Mapa salvo como 'mapa_rotas_detalhadas.html'.")