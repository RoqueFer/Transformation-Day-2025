import pandas as pd
from haversine import haversine, Unit

def load_data(poi_path, stations_path, vtd_path):
    """Carrega todos os arquivos de dados necessários."""
    df_pois = pd.read_csv(poi_path)
    df_eletropostos = pd.read_json(stations_path)
    df_vtd = pd.read_csv(vtd_path, encoding='latin-1', header=None)
    return df_pois, df_eletropostos, df_vtd

def calculate_potential_score(df_pois, df_eletropostos, df_vtd, weights):
    """Calcula o Score de Potencial para cada POI."""
    
    def get_min_distance(poi_lat, poi_lon, df_stations):
        distances = [
            haversine((poi_lat, poi_lon), (lat, lon), unit=Unit.KILOMETERS)
            for lat, lon in zip(df_stations['latitude'], df_stations['longitude'])
        ]
        return min(distances) if distances else float('inf')

    print("Calculando distância para concorrentes...")
    df_pois['dist_concorrente_km'] = df_pois.apply(
        lambda row: get_min_distance(row['latitude'], row['longitude'], df_eletropostos),
        axis=1
    )

    print("Vinculando dados de fluxo de veículos...")
    df_pois['fluxo_veiculos'] = df_vtd.iloc[5, 2] # Lógica simplificada mantida

    df_pois['fluxo_norm'] = (df_pois['fluxo_veiculos'] - df_pois['fluxo_veiculos'].min()) / \
                            (df_pois['fluxo_veiculos'].max() - df_pois['fluxo_veiculos'].min())
    df_pois['dist_norm'] = (df_pois['dist_concorrente_km'] - df_pois['dist_concorrente_km'].min()) / \
                           (df_pois['dist_concorrente_km'].max() - df_pois['dist_concorrente_km'].min())

    # CORREÇÃO: Usando as chaves 'fluxo' e 'distancia' do seu JSON
    df_pois['score_potencial'] = (df_pois['fluxo_norm'] * weights['fluxo']) + \
                                 (df_pois['dist_norm'] * weights['distancia'])
    
    df_ranked = df_pois.sort_values(by='score_potencial', ascending=False)
    
    print("Cálculo de score finalizado.")
    return df_ranked