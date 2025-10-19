import pandas as pd
from haversine import haversine, Unit

def calculate_potential_score(df_pois, df_eletropostos, vmd_medio_rota, weights):
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
    df_pois['fluxo_veiculos'] = vmd_medio_rota
    
    fluxo_range = df_pois['fluxo_veiculos'].max() - df_pois['fluxo_veiculos'].min()
    df_pois['fluxo_norm'] = 1.0 if fluxo_range == 0 else (df_pois['fluxo_veiculos'] - df_pois['fluxo_veiculos'].min()) / fluxo_range
    
    dist_range = df_pois['dist_concorrente_km'].max() - df_pois['dist_concorrente_km'].min()
    df_pois['dist_norm'] = 1.0 if dist_range == 0 else (df_pois['dist_concorrente_km'] - df_pois['dist_concorrente_km'].min()) / dist_range

    df_pois['score_potencial'] = (df_pois['fluxo_norm'] * weights['fluxo']) + \
                                 (df_pois['dist_norm'] * weights['distancia'])
    
    df_ranked = df_pois.sort_values(by='score_potencial', ascending=False)
    
    print("Cálculo de score finalizado.")
    return df_ranked