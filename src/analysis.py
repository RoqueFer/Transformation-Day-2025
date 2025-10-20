import pandas as pd
from haversine import haversine, Unit

def calculate_potential_score(df_pois, df_eletropostos, route_waypoints, vmd_medio_rota, vehicle, cities, start_city_name):
    """
    Calcula o Score de Potencial para cada POI, filtrando primeiro pela proximidade da rota
    e depois analisando a janela de autonomia.
    """
    
    # --- ETAPA 1: FILTRAR POIs RELEVANTES (A GRANDE IDEIA DA 'main') ---
    print("Filtrando POIs próximos à rota para análise...")
    pois_relevantes = []
    distancia_max_da_rota_km = 15 # Considera POIs a até 15km da estrada

    for _, poi in df_pois.iterrows():
        poi_coord = (poi['latitude'], poi['longitude'])
        # Verifica a menor distância do POI para qualquer ponto na rota (amostrado para performance)
        distancia_minima = min([haversine(poi_coord, (lat, lon), unit=Unit.KILOMETERS) for lon, lat in route_waypoints[::5]])
        
        if distancia_minima <= distancia_max_da_rota_km:
            pois_relevantes.append(poi)
    
    if not pois_relevantes:
        print("AVISO: Nenhum POI encontrado próximo à rota. Análise de score não pode continuar.")
        return pd.DataFrame()

    df_analise = pd.DataFrame(pois_relevantes).reset_index(drop=True)
    print(f"{len(df_analise)} POIs relevantes encontrados para a análise de score.")

    # --- ETAPA 2: ANÁLISE DE SCORE NOS POIs FILTRADOS ---
    autonomia_km = vehicle['autonomia_km']
    raio_ideal_min = autonomia_km * 0.60
    raio_ideal_max = autonomia_km * 0.90
    
    # Torna a análise genérica, usando o nome da cidade de partida do config
    coord_partida = cities[start_city_name]['map_coords']
    ponto_partida = (coord_partida[0], coord_partida[1])

    print(f"Calculando distância de {start_city_name.title()} para cada POI...")
    df_analise['dist_origem_km'] = df_analise.apply(
        lambda row: haversine(ponto_partida, (row['latitude'], row['longitude']), unit=Unit.KILOMETERS),
        axis=1
    )

    def get_min_distance_to_competitor(poi_lat, poi_lon, df_stations):
        if df_stations.empty: return float('inf')
        distances = [
            haversine((poi_lat, poi_lon), (lat, lon), unit=Unit.KILOMETERS)
            for lat, lon in zip(df_stations['latitude'], df_stations['longitude'])
        ]
        return min(distances) if distances else float('inf')

    print("Calculando distância para concorrentes...")
    df_analise['dist_concorrente_km'] = df_analise.apply(
        lambda row: get_min_distance_to_competitor(row['latitude'], row['longitude'], df_eletropostos),
        axis=1
    )

    def score_janela(distancia):
        if raio_ideal_min <= distancia <= raio_ideal_max: return 1.0
        elif distancia < raio_ideal_min: return max(0, distancia / raio_ideal_min - 0.5)
        else: return max(0, 1 - (distancia - raio_ideal_max) / (autonomia_km * 0.5))
            
    print("Calculando score de janela de autonomia...")
    df_analise['score_janela'] = df_analise['dist_origem_km'].apply(score_janela)

    # Normalização e Score Final
    df_analise['score_dist_concorrente'] = df_analise['dist_concorrente_km'] / df_analise['dist_concorrente_km'].max()
    
    W_JANELA, W_CONCORRENTE, W_FLUXO = 0.60, 0.30, 0.10
    fluxo_norm = vmd_medio_rota / 20000 

    df_analise['score_potencial'] = (df_analise['score_janela'] * W_JANELA) + \
                                    (df_analise['score_dist_concorrente'] * W_CONCORRENTE) + \
                                    (fluxo_norm * W_FLUXO)
                                 
    df_ranked = df_analise.sort_values(by='score_potencial', ascending=False)
    
    print("Cálculo de score finalizado.")
    return df_ranked