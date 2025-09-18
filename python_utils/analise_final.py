import pandas as pd
from haversine import haversine, Unit
import json

# --- ETAPA 1: CARREGAR TODOS OS DADOS ---

print("--- Carregando arquivos de dados ---")

try:
    # Carrega os POIs que encontramos ao longo da rota
    df_pois = pd.read_csv('pois_na_rota.csv')
    print(f"Carregados {len(df_pois)} POIs candidatos.")

    # Carrega os eletropostos existentes do PlugShare
    df_eletropostos = pd.read_json('plugshare.json')
    print(f"Carregados {len(df_eletropostos)} eletropostos existentes.")

    # Carrega e processa os dados de tráfego (VTD)
    df_vtd_raw = pd.read_csv('Media VTD.xlsx - Planilha1.csv', header=None)
    
    # Extrai a média de carros de cada trecho do CSV de forma manual
    # Nota: Esta lógica é específica para a estrutura do seu arquivo
    vtd_data = {
        'Curitiba -> Sao Paulo': df_vtd_raw.iloc[5, 2],      # Pega o valor da linha 'media'
        'Sao paulo -> Rio de janeiro': df_vtd_raw.iloc[12, 2],
        'Curitiba -> florianopolis': df_vtd_raw.iloc[19, 2]
    }
    print("Dados de tráfego (VTD) processados:", vtd_data)

except FileNotFoundError as e:
    print(f"\nERRO: Arquivo não encontrado! -> {e}")
    print("Por favor, certifique-se de que os arquivos 'pois_na_rota.csv', 'plugshare.json' e 'Media VTD.xlsx - Planilha1.csv' estão na mesma pasta que este script.")
    exit() # Encerra o script se os arquivos não forem encontrados

# --- ETAPA 2: ENRIQUECER OS DADOS DOS POIs ---

print("\n--- Enriquecendo dados dos POIs ---")

# Função para calcular a distância mínima até um eletroposto
def calcular_distancia_minima(poi_lat, poi_lon, df_eletropostos):
    distancias = [
        haversine((poi_lat, poi_lon), (eletro_lat, eletro_lon), unit=Unit.KILOMETERS)
        for eletro_lat, eletro_lon in zip(df_eletropostos['latitude'], df_eletropostos['longitude'])
    ]
    return min(distancias) if distancias else float('inf')

# Função para atribuir o fluxo de veículos baseado na rota (latitude)
# Esta é uma simplificação: consideramos que latitudes menores que -24.5 são rota CWB->FLN, etc.
def atribuir_fluxo_veiculos(latitude, vtd_data):
    if latitude < -25.5: # Abaixo de Curitiba -> Rota para Florianópolis
        return vtd_data.get('Curitiba -> florianopolis', 0)
    else: # Acima de Curitiba -> Rota para São Paulo
        # (Para simplificar, não diferenciamos SP->RIO aqui, mas poderia ser feito com mais faixas de latitude)
        return vtd_data.get('Curitiba -> Sao Paulo', 0)

print("Calculando distância para eletropostos existentes...")
df_pois['dist_eletroposto_km'] = df_pois.apply(
    lambda row: calcular_distancia_minima(row['latitude'], row['longitude'], df_eletropostos),
    axis=1
)

print("Vinculando dados de fluxo de veículos...")
df_pois['fluxo_veiculos'] = df_pois.apply(
    lambda row: atribuir_fluxo_veiculos(row['latitude'], vtd_data),
    axis=1
)

# --- ETAPA 3: NORMALIZAÇÃO E CÁLCULO DO SCORE ---

print("\n--- Calculando o Score de Potencial ---")

# Normaliza os dados para uma escala de 0 a 1
df_pois['fluxo_norm'] = (df_pois['fluxo_veiculos'] - df_pois['fluxo_veiculos'].min()) / \
                        (df_pois['fluxo_veiculos'].max() - df_pois['fluxo_veiculos'].min())

df_pois['dist_norm'] = (df_pois['dist_eletroposto_km'] - df_pois['dist_eletroposto_km'].min()) / \
                       (df_pois['dist_eletroposto_km'].max() - df_pois['dist_eletroposto_km'].min())

# Define os pesos de cada critério
W_FLUXO = 0.6  # 60% de importância
W_DISTANCIA = 0.4 # 40% de importância para a distância de um concorrente

# Calcula o score final
df_pois['score_potencial'] = (df_pois['fluxo_norm'] * W_FLUXO) + \
                             (df_pois['dist_norm'] * W_DISTANCIA)

# Classifica os POIs pelo score
df_final_ranqueado = df_pois.sort_values(by='score_potencial', ascending=False)

# Salva o resultado final em um novo CSV
df_final_ranqueado.to_csv('resultado_analise_pontos.csv', index=False)
print("\nAnálise concluída! O resultado foi salvo em 'resultado_analise_pontos.csv'")

# --- ETAPA 4: EXIBIR OS MELHORES RESULTADOS ---

print("\n\n--- TOP 15 MELHORES PONTOS ENCONTRADOS ---")
print("Colunas: Nome do Local, Tipo, Score (0 a 1), Tráfego Próximo, Distância do Concorrente (km)")
print(df_final_ranqueado.head(15)[[
    'nome', 
    'tipo', 
    'score_potencial', 
    'fluxo_veiculos', 
    'dist_eletroposto_km'
]].round(2)) # .round(2) para arredondar os valores