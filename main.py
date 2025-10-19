import json
import os
from src.data_processing import get_route_waypoints, find_pois_on_route
from src.calculate_vtd import processar_dados_vmd, calcular_vtd_medio_rota
from src.analysis import load_intermediate_data, calculate_potential_score
from src.visualization import create_analysis_map

def main():
    """Função principal que orquestra todo o pipeline de análise."""
    print("--- Iniciando Análise de Potencial para Eletropostos ---")

    with open('config.json', 'r') as f:
        config = json.load(f)

    os.makedirs(os.path.dirname(config['file_paths']['output_map']), exist_ok=True)

    # --- ETAPA 1: Obter a Rota ---
    route_config = config['routes_to_analyze'][0]
    start_city_coords = config['cities'][route_config['start_city']]['api_coords']
    end_city_coords = config['cities'][route_config['end_city']]['api_coords']
    print(f"\n1. Buscando rota: {route_config['name']}...")
    waypoints = get_route_waypoints(start_city_coords, end_city_coords)
    if not waypoints:
        print("Não foi possível obter a rota. Encerrando.")
        return

    # --- ETAPA 2: Processar VMD da Rota ---
    print("\n2. Processando dados de tráfego (VMD) para a rota...")
    df_vmd = processar_dados_vmd(
        config['file_paths']['vmd_data'],
        config['file_paths']['vmd_metadata']
    )
    vmd_da_rota = calcular_vtd_medio_rota(df_vmd, waypoints)

    # --- ETAPA 3: Buscar POIs ---
    print("\n3. Buscando Pontos de Interesse (POIs) na rota...")
    poi_radius_km = config['analysis_params']['poi_search_radius_km']
    df_pois = find_pois_on_route(waypoints, poi_radius_km)
    if df_pois.empty:
        print("Nenhum POI foi encontrado. Encerrando a análise.")
        return
    df_pois.to_csv(config['file_paths']['pois_on_route'], index=False)

    # --- ETAPA 4: Calcular Score de Potencial ---
    print("\n4. Calculando Score de Potencial...")
    df_pois_loaded, df_stations = load_intermediate_data(
        config['file_paths']['pois_on_route'],
        config['file_paths']['existing_stations']
    )
    df_ranked = calculate_potential_score(
        df_pois_loaded, 
        df_stations, 
        vmd_da_rota, 
        config['analysis_params']['score_weights']
    )
    df_ranked.to_csv(config['file_paths']['analysis_result'], index=False)

    # --- ETAPA 5: Gerar Mapa ---
    print("\n5. Gerando mapa de visualização...")
    city_coords_for_map = {
        route_config['start_city']: config['cities'][route_config['start_city']],
        route_config['end_city']: config['cities'][route_config['end_city']]
    }
    create_analysis_map(
        df_ranked,
        waypoints,
        city_coords_for_map,
        config['vehicles'][0],
        config['file_paths']['output_map']
    )

    print("\n--- Análise Concluída com Sucesso! ---")

if __name__ == "__main__":
    main()