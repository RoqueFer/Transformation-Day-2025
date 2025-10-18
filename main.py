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
    # (Pode ser transformado em um loop para analisar múltiplas rotas)
    route_config = config['routes_to_analyze'][0]
    start_city_coords = config['city_coordinates'][route_config['start_city']]['api']
    end_city_coords = config['city_coordinates'][route_config['end_city']]['api']

    # 3. Pipeline de Dados e Análise
    print(f"\n1. Buscando rota: {route_config['name']}...")
    waypoints = get_route_waypoints(start_city_coords, end_city_coords)

    if not waypoints:
        print("Não foi possível obter a rota. Encerrando.")
        return

    print("\n2. Buscando Pontos de Interesse (POIs) na rota...")
    df_pois = find_pois_on_route(waypoints, config['analysis_parameters']['poi_search_radius_m'])
    df_pois.to_csv(config['file_paths']['pois_on_route'], index=False)

    print("\n3. Calculando Score de Potencial...")
    df_pois, df_stations, df_vtd = load_data(
        config['file_paths']['pois_on_route'],
        config['file_paths']['existing_charging_stations'],
        config['file_paths']['vtd_data']
    )

    df_ranked = calculate_potential_score(df_pois, df_stations, df_vtd, config['analysis_parameters']['score_weights'])
    df_ranked.to_csv(config['file_paths']['ranked_pois'], index=False)

    print("\n4. Gerando mapa de visualização...")
    city_coords_for_map = {
        route_config['start_city']: config['city_coordinates'][route_config['start_city']],
        route_config['end_city']: config['city_coordinates'][route_config['end_city']]
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