import json
import os
from src.data_processing import get_route_waypoints, find_pois_on_route
from src.analysis import load_data, calculate_potential_score
from src.visualization import create_analysis_map

def main():
    """Função principal que orquestra todo o pipeline de análise."""
    print("--- Iniciando Análise de Potencial para Eletropostos ---")

    # 1. Carregar configurações
    with open('config.json', 'r') as f:
        config = json.load(f)

    # Cria a pasta de output se ela não existir
    os.makedirs(os.path.dirname(config['file_paths']['output_map']), exist_ok=True)

    # 2. Executar para a primeira rota definida no config
    route_config = config['routes_to_analyze'][0]
    # CORREÇÃO: Usando 'cities' e 'api_coords'
    start_city_coords = config['cities'][route_config['start_city']]['api_coords']
    end_city_coords = config['cities'][route_config['end_city']]['api_coords']

    # 3. Pipeline de Dados e Análise
    print(f"\n1. Buscando rota: {route_config['name']}...")
    waypoints = get_route_waypoints(start_city_coords, end_city_coords)

    if not waypoints:
        print("Não foi possível obter a rota. Encerrando.")
        return

    print("\n2. Buscando Pontos de Interesse (POIs) na rota...")
    # CORREÇÃO: Usando 'analysis_params' e convertendo KM para Metros
    poi_radius_meters = config['analysis_params']['poi_search_radius_km'] * 1000
    df_pois = find_pois_on_route(waypoints, poi_radius_meters)
    df_pois.to_csv(config['file_paths']['pois_on_route'], index=False)

    print("\n3. Calculando Score de Potencial...")
    # CORREÇÃO: Usando 'existing_stations'
    df_pois_loaded, df_stations, df_vtd = load_data(
        config['file_paths']['pois_on_route'],
        config['file_paths']['existing_stations'],
        config['file_paths']['vtd_data']
    )
    
    # CORREÇÃO: Usando 'analysis_params' e 'analysis_result'
    df_ranked = calculate_potential_score(df_pois_loaded, df_stations, df_vtd, config['analysis_params']['score_weights'])
    df_ranked.to_csv(config['file_paths']['analysis_result'], index=False)

    print("\n4. Gerando mapa de visualização...")
    # CORREÇÃO: Usando 'cities' para montar o dicionário para o mapa
    city_coords_for_map = {
        route_config['start_city']: config['cities'][route_config['start_city']],
        route_config['end_city']: config['cities'][route_config['end_city']]
    }

    create_analysis_map(
        df_ranked,
        waypoints,
        city_coords_for_map,
        config['vehicles'][0], # Pega o primeiro veículo da lista
        config['file_paths']['output_map']
    )

    print("\n--- Análise Concluída com Sucesso! ---")

if __name__ == "__main__":
    main()