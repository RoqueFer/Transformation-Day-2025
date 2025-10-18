import pandas as pd
import folium
from folium.plugins import HeatMap

print("Iniciando a geração do heatmap...")

# --- 1. Dados Fictícios ---
# Criamos uma lista de dicionários para representar os pontos.
# O 'score' simula o "potencial" do local, onde 10 é o mais alto.
# Os pontos foram distribuídos para simular a rota e criar "hotspots" perto das grandes cidades.
dados_ficticios = [
    # Trecho Florianópolis a Curitiba (BR-101)
    {'lat': -27.59, 'lon': -48.54, 'cidade': 'Florianópolis', 'score': 9},
    {'lat': -27.24, 'lon': -48.63, 'cidade': 'Porto Belo', 'score': 6},
    {'lat': -26.91, 'lon': -48.67, 'cidade': 'Itajaí', 'score': 7},
    {'lat': -26.48, 'lon': -48.84, 'cidade': 'Joinville', 'score': 8},
    {'lat': -26.13, 'lon': -49.12, 'cidade': 'Garuva', 'score': 5},

    # Trecho Curitiba a São Paulo (BR-116)
    {'lat': -25.42, 'lon': -49.27, 'cidade': 'Curitiba', 'score': 10},
    {'lat': -25.09, 'lon': -49.95, 'cidade': 'Ponto Intermediário PR', 'score': 4}, # Ponto mais genérico
    {'lat': -24.78, 'lon': -48.35, 'cidade': 'Registro', 'score': 7},
    {'lat': -24.18, 'lon': -47.15, 'cidade': 'Ponto Intermediário SP', 'score': 5},
    {'lat': -23.88, 'lon': -46.80, 'cidade': 'Embu das Artes', 'score': 6},

    # Chegada em São Paulo e trecho para o Rio (Via Dutra)
    {'lat': -23.55, 'lon': -46.63, 'cidade': 'São Paulo', 'score': 10},
    {'lat': -23.45, 'lon': -46.53, 'cidade': 'Guarulhos', 'score': 8},
    {'lat': -23.21, 'lon': -45.88, 'cidade': 'São José dos Campos', 'score': 9},
    {'lat': -23.00, 'lon': -45.55, 'cidade': 'Taubaté', 'score': 7},
    {'lat': -22.74, 'lon': -45.19, 'cidade': 'Aparecida', 'score': 6},
    {'lat': -22.50, 'lon': -44.10, 'cidade': 'Barra Mansa', 'score': 7},

    # Chegada ao Rio de Janeiro
    {'lat': -22.87, 'lon': -43.33, 'cidade': 'Entrada do Rio', 'score': 8},
    {'lat': -22.90, 'lon': -43.17, 'cidade': 'Rio de Janeiro', 'score': 10},
]

# Convertendo a lista para um DataFrame do Pandas
data = pd.DataFrame(dados_ficticios)


# --- 2. Criação do Mapa Base ---
# Centralizamos o mapa em um ponto geográfico entre SP e Curitiba para boa visualização.
# O 'zoom_start' controla o nível de zoom inicial.
mapa_base = folium.Map(
    location=[-24.5, -47.5],
    zoom_start=7,
    tiles='CartoDB positron' # Usando um tema de mapa mais limpo
)


# --- 3. Preparação e Adição da Camada de Heatmap ---
# O plugin HeatMap espera uma lista de listas no formato [latitude, longitude, peso/score].
heat_data = [[row['lat'], row['lon'], row['score']] for index, row in data.iterrows()]

# Adicionamos a camada ao mapa base.
# 'radius' e 'blur' controlam a aparência do "calor".
HeatMap(
    heat_data,
    radius=30,
    blur=20,
    gradient={0.2: 'blue', 0.4: 'green', 0.6: 'yellow', 1: 'red'} # Gradiente de cores
).add_to(mapa_base)


# --- 4. Adição de Marcadores para as Cidades Principais (Opcional, mas ajuda na apresentação) ---
cidades_principais = data[data['cidade'].isin(['Florianópolis', 'Curitiba', 'São Paulo', 'Rio de Janeiro'])]

for _, cidade in cidades_principais.iterrows():
    folium.Marker(
        location=[cidade['lat'], cidade['lon']],
        popup=f"<b>{cidade['cidade']}</b><br>Score: {cidade['score']}",
        icon=folium.Icon(color='black', icon='info-sign')
    ).add_to(mapa_base)


# --- 5. Salvando o resultado ---
nome_arquivo = 'heatmap_apresentacao.html'
mapa_base.save(nome_arquivo)

print(f"Mapa gerado com sucesso! Abra o arquivo '{nome_arquivo}' no seu navegador.") 