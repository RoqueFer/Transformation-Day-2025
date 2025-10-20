import json
import os
import pandas as pd
from geopy.distance import geodesic # Nova importação
from src.data_processing import get_route_waypoints, find_pois_on_route, find_charging_stations_on_route
from src.route_constructor import construir_rota_snv
from src.analysis import calculate_potential_score
from src.visualization import create_analysis_map

def main():
    """Função principal que orquestra todo o pipeline de análise."""
    print("--- Iniciando Análise de Potencial para Eletropostos ---")

    with open('config.json', 'r') as f:
        config = json.load(f)

    os.makedirs(os.path.dirname(config['file_paths']['output_map']), exist_ok=True)

    # --- ETAPA 1: Obter Rota Geográfica e Eletropostos ---
    route_config = config['routes_to_analyze'][0]
    start_city_coords_api = config['cities'][route_config['start_city']]['api_coords']
    end_city_coords_api = config['cities'][route_config['end_city']]['api_coords']
    print(f"\n1. Buscando rota geográfica: {route_config['name']}...")
    waypoints = get_route_waypoints(start_city_coords_api, end_city_coords_api)
    if not waypoints: return

    # Busca eletropostos via API, em vez de ler arquivo
    df_stations = find_charging_stations_on_route(waypoints, config['api_keys']['ocm_api_key'])

    # --- ETAPA 2: Calcular VMD ---
    # ... (esta seção permanece a mesma) ...
    print("\n2. Processando dados de tráfego (VMD) via construção de rota SNV...")
    df_snv_raw = pd.read_excel(config['file_paths']['snv_data_excel'], sheet_name=config['file_paths']['snv_data_sheet'])
    df_rota_snv = construir_rota_snv(df_snv_raw, route_config['snv_ufs'], route_config['snv_brs'], route_config['snv_start_uf'], route_config['snv_start_br'], route_config['snv_end_city_name'])
    if df_rota_snv.empty: return
    df_rota_snv['VMDa_C'] = pd.to_numeric(df_rota_snv['VMDa_C'], errors='coerce').fillna(0)
    df_rota_snv['VMDa_D'] = pd.to_numeric(df_rota_snv['VMDa_D'], errors='coerce').fillna(0)
    df_rota_snv['vmd_total_trecho'] = df_rota_snv['VMDa_C'] + df_rota_snv['VMDa_D']
    df_rota_snv['extensao_trecho'] = abs(df_rota_snv['vl_km_fina'] - df_rota_snv['vl_km_inic'])
    vmd_medio_ponderado = (df_rota_snv['vmd_total_trecho'] * df_rota_snv['extensao_trecho']).sum() / df_rota_snv['extensao_trecho'].sum()
    print(f"VMD médio ponderado calculado: {vmd_medio_ponderado:.0f} veículos/dia.")

    # --- ETAPA 3: Buscar e Analisar POIs ---
    print("\n3. Buscando e analisando Pontos de Interesse (POIs)...")
    df_pois = find_pois_on_route(waypoints, config['analysis_params']['poi_search_radius_km'])
    if df_pois.empty: return

    df_ranked = calculate_potential_score(df_pois, df_stations, waypoints, vmd_medio_ponderado, config['vehicles'][0], config['cities'], route_config['start_city'])
    df_ranked.to_csv(config['file_paths']['analysis_result'], index=False)

    # --- ETAPA 4: Calcular Segmentos de Rota para Visualização (LÓGICA DA 'main') ---
    print("\n4. Calculando segmentos de autonomia para o mapa...")
    vehicle = config['vehicles'][0]
    autonomia_max = vehicle['autonomia_km']
    autonomia_reserva = autonomia_max * 0.80 # 80%
    
    start_city_coords = config['cities'][route_config['start_city']]['map_coords']
    end_city_coords = config['cities'][route_config['end_city']]['map_coords']
    
    gap_waypoints, reserva_start_waypoints, reserva_end_waypoints = [], [], []
    for lon, lat in waypoints:
        dist_de_start = geodesic((lat, lon), start_city_coords).kilometers
        dist_de_end = geodesic((lat, lon), end_city_coords).kilometers
        
        if dist_de_start > autonomia_max and dist_de_end > autonomia_max:
            gap_waypoints.append((lon, lat))
        if autonomia_reserva < dist_de_start <= autonomia_max:
            reserva_start_waypoints.append((lon, lat))
        if autonomia_reserva < dist_de_end <= autonomia_max:
            reserva_end_waypoints.append((lon, lat))
    
    print(f"Segmento 'Gap Central' encontrado: {len(gap_waypoints)} pontos.")
    print(f"Segmento 'Reserva (Partida)' encontrado: {len(reserva_start_waypoints)} pontos.")
    print(f"Segmento 'Reserva (Destino)' encontrado: {len(reserva_end_waypoints)} pontos.")

    # --- ETAPA 5: Gerar Mapa Final ---
    print("\n5. Gerando mapa de visualização...")
    city_coords_for_map = {
        route_config['start_city']: config['cities'][route_config['start_city']],
        route_config['end_city']: config['cities'][route_config['end_city']]
    }
    create_analysis_map(
        df_ranked,
        df_stations,
        waypoints,
        {
            'gap': gap_waypoints, 
            'reserva_start': reserva_start_waypoints, 
            'reserva_end': reserva_end_waypoints
        },
        city_coords_for_map,
        config['vehicles'][0],
        config['file_paths']['output_map']
    )

    print("\n--- Análise Concluída com Sucesso! ---")

if __name__ == "__main__":
    main()