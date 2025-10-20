import json
import os
import pandas as pd
from geopy.distance import geodesic
from src.data_processing import get_route_waypoints, find_pois_on_route, find_charging_stations_on_route
from src.route_constructor import construir_rota_snv
from src.analysis import calculate_potential_score
from src.visualization import create_analysis_map

def main():
    """Função principal que orquestra o pipeline de análise para MÚLTIPLAS rotas."""
    print("--- Iniciando Análise de Potencial para Eletropostos ---")

    with open('config.json', 'r') as f:
        config = json.load(f)

    os.makedirs(os.path.dirname(config['file_paths']['output_map']), exist_ok=True)

    # Listas para acumular os resultados de todas as rotas
    all_ranked_pois = []
    all_waypoints = []
    all_route_segments = []
    all_stations = []

    # Carrega os dados do SNV uma única vez
    df_snv_raw = pd.read_excel(
        config['file_paths']['snv_data_excel'],
        sheet_name=config['file_paths']['snv_data_sheet']
    )

    # Loop principal que processa cada rota definida no config.json
    for route_config in config['routes_to_analyze']:
        print(f"\n\n--- Processando Rota: {route_config['name'].replace('_', ' ').title()} ---")

        start_city_coords_api = config['cities'][route_config['start_city']]['api_coords']
        end_city_coords_api = config['cities'][route_config['end_city']]['api_coords']
        
        print(f"1. Buscando rota geográfica...")
        waypoints = get_route_waypoints(start_city_coords_api, end_city_coords_api)
        if not waypoints: continue
        all_waypoints.append(waypoints)

        df_stations = find_charging_stations_on_route(waypoints, config['api_keys']['ocm_api_key'])
        all_stations.append(df_stations)

        print(f"2. Processando dados de VMD...")
        df_rota_snv = construir_rota_snv(df_snv_raw, route_config['snv_ufs'], route_config['snv_brs'], route_config['snv_start_uf'], route_config['snv_start_br'], route_config['snv_end_city_name'])
        if df_rota_snv.empty: continue
        
        df_rota_snv['VMDa_C'] = pd.to_numeric(df_rota_snv['VMDa_C'], errors='coerce').fillna(0)
        df_rota_snv['VMDa_D'] = pd.to_numeric(df_rota_snv['VMDa_D'], errors='coerce').fillna(0)
        df_rota_snv['vmd_total_trecho'] = df_rota_snv['VMDa_C'] + df_rota_snv['VMDa_D']
        df_rota_snv['extensao_trecho'] = abs(df_rota_snv['vl_km_fina'] - df_rota_snv['vl_km_inic'])
        vmd_medio_ponderado = (df_rota_snv['vmd_total_trecho'] * df_rota_snv['extensao_trecho']).sum() / df_rota_snv['extensao_trecho'].sum()
        print(f"VMD médio: {vmd_medio_ponderado:.0f} veículos/dia.")

        print(f"3. Buscando e analisando POIs...")
        df_pois = find_pois_on_route(waypoints, config['analysis_params']['poi_search_radius_km'])
        if df_pois.empty: continue

        df_ranked = calculate_potential_score(df_pois, df_stations, waypoints, vmd_medio_ponderado, config['vehicles'][0], config['cities'], route_config['start_city'])
        all_ranked_pois.append(df_ranked)

        vehicle = config['vehicles'][0]
        autonomia_max = vehicle['autonomia_km']
        autonomia_reserva = autonomia_max * 0.80
        
        start_coords_map = config['cities'][route_config['start_city']]['map_coords']
        end_coords_map = config['cities'][route_config['end_city']]['map_coords']
        
        gap, reserva_start, reserva_end = [], [], []
        for lon, lat in waypoints:
            dist_start = geodesic((lat, lon), start_coords_map).kilometers
            dist_end = geodesic((lat, lon), end_coords_map).kilometers
            
            if dist_start > autonomia_max and dist_end > autonomia_max: gap.append((lon, lat))
            if autonomia_reserva < dist_start <= autonomia_max: reserva_start.append((lon, lat))
            if autonomia_reserva < dist_end <= autonomia_max: reserva_end.append((lon, lat))
        
        all_route_segments.append({'gap': gap, 'reserva_start': reserva_start, 'reserva_end': reserva_end})

    # Consolida os resultados de todas as rotas
    df_final_ranked_pois = pd.concat(all_ranked_pois, ignore_index=True)
    df_final_stations = pd.concat(all_stations, ignore_index=True).drop_duplicates().reset_index(drop=True)

    # --- ETAPA FINAL: Gerar Mapa Consolidado ---
    print("\n\n--- Gerando Mapa Consolidado com Todas as Rotas ---")
    create_analysis_map(
        df_final_ranked_pois,
        df_final_stations,
        all_waypoints,
        all_route_segments,
        config['cities'],
        config['vehicles'],
        config['file_paths']['output_map']
    )

    print("\n--- Análise Concluída com Sucesso! ---")

if __name__ == "__main__":
    main()