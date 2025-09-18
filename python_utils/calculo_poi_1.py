import pandas as pd
from haversine import haversine, Unit

# 1. CARREGAR OS DADOS
df_pois = pd.read_csv('pois_na_rota.csv')
df_eletropostos = pd.read_csv('eletropostos_existentes.csv') # Exemplo de nome de arquivo
df_fluxo = pd.read_csv('fluxo_veiculos_rodovia.csv')       # Exemplo de nome de arquivo

# --- 2. CÁLCULO 1: Distância ao Eletroposto Mais Próximo ---
def calcular_distancia_minima(poi_lat, poi_lon, df_eletropostos):
    distancias = []
    for index, eletroposto in df_eletropostos.iterrows():
        dist = haversine((poi_lat, poi_lon), (eletroposto['latitude'], eletroposto['longitude']), unit=Unit.KILOMETERS)
        distancias.append(dist)
    return min(distancias) if distancias else float('inf')

print("Calculando distância para eletropostos existentes...")
# Aplica a função a cada linha do DataFrame de POIs
df_pois['dist_eletroposto_km'] = df_pois.apply(
    lambda row: calcular_distancia_minima(row['latitude'], row['longitude'], df_eletropostos),
    axis=1
)

# --- 3. CÁLCULO 2: Encontrar o Fluxo de Veículos Mais Próximo ---
# (A lógica é similar: para cada POI, encontre o ponto de medição de fluxo mais próximo)
def encontrar_fluxo_mais_proximo(poi_lat, poi_lon, df_fluxo):
    # Lógica similar à de cima, mas retorna o valor de 'VMDA' do ponto mais próximo
    # (Esta função é um exemplo, você pode precisar adaptá-la)
    distancias = {}
    for index, medidor in df_fluxo.iterrows():
        dist = haversine((poi_lat, poi_lon), (medidor['latitude'], medidor['longitude']))
        distancias[dist] = medidor['VMDA'] # VMDA = Volume Médio Diário Anual

    if not distancias:
        return 0

    distancia_minima = min(distancias.keys())
    return distancias[distancia_minima]

print("Vinculando dados de fluxo de veículos...")
df_pois['fluxo_veiculos'] = df_pois.apply(
    lambda row: encontrar_fluxo_mais_proximo(row['latitude'], row['longitude'], df_fluxo),
    axis=1
)

# Ao final desta etapa, df_pois terá novas colunas: 'dist_eletroposto_km' e 'fluxo_veiculos'
print("\nDataFrame enriquecido:")
print(df_pois.head())