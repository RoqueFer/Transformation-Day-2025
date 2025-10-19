import json
import os
import pandas as pd
from src.data_processing import get_route_waypoints, find_pois_on_route
from src.route_constructor import construir_rota_snv
from src.analysis import calculate_potential_score
from src.visualization import create_analysis_map

def main():
    """Função principal que orquestra todo o pipeline de análise."""
    print("--- Iniciando Análise de Potencial para Eletropostos ---")

    with open('config.json', 'r') as f:
        config = json.load(f)

    os.makedirs(os.path.dirname(config['file_paths']['output_map']), exist_ok=True)

    # --- ETAPA 1: Obter a Rota Geográfica (para buscar POIs) ---
    route_config = config['routes_to_analyze'][0]
    start_city_coords = config['cities'][route_config['start_city']]['api_coords']
    end_city_coords = config['cities'][route_config['end_city']]['api_coords']
    print(f"\n1. Buscando rota geográfica: {route_config['name']}...")
    waypoints = get_route_waypoints(start_city_coords, end_city_coords)
    if not waypoints:
        return

    # --- ETAPA 2: Construir Rota do SNV e Calcular VMD ---
    print("\n2. Processando dados de tráfego (VMD) via construção de rota SNV...")
    df_snv_raw = pd.read_excel(
        config['file_paths']['snv_data_excel'],
        sheet_name=config['file_paths']['snv_data_sheet']
    )
    df_rota_snv = construir_rota_snv(
        df_snv_raw,
        route_config['snv_ufs'],
        route_config['snv_brs'],
        route_config['snv_start_uf'],
        route_config['snv_start_br'],
        route_config['snv_end_city_name']
    )

    if df_rota_snv.empty:
        print("ERRO: Não foi possível construir a rota do SNV. Encerrando.")
        return
    
    # --- CORREÇÃO DO CÁLCULO DE VMD ---
    # Converte as colunas VMDa_C e VMDa_D para numérico e soma para obter o total
    df_rota_snv['VMDa_C'] = pd.to_numeric(df_rota_snv['VMDa_C'], errors='coerce').fillna(0)
    df_rota_snv['VMDa_D'] = pd.to_numeric(df_rota_snv['VMDa_D'], errors='coerce').fillna(0)
    df_rota_snv['vmd_total_trecho'] = df_rota_snv['VMDa_C'] + df_rota_snv['VMDa_D']
    
    # Calcula a média ponderada pela extensão de cada trecho
    df_rota_snv['extensao_trecho'] = abs(df_rota_snv['vl_km_fina'] - df_rota_snv['vl_km_inic'])
    vmd_medio_ponderado = (df_rota_snv['vmd_total_trecho'] * df_rota_snv['extensao_trecho']).sum() / df_rota_snv['extensao_trecho'].sum()
    print(f"VMD médio ponderado calculado para a rota: {vmd_medio_ponderado:.0f} veículos/dia.")

    # --- ETAPA 3: Buscar POIs ---
    print("\n3. Buscando Pontos de Interesse (POIs) na rota...")
    df_pois = find_pois_on_route(waypoints, config['analysis_params']['poi_search_radius_km'])
    if df_pois.empty: return
    df_pois.to_csv(config['file_paths']['pois_on_route'], index=False)

    # --- ETAPA 4: Calcular Score de Potencial ---
    print("\n4. Calculando Score de Potencial...")
    df_stations = pd.read_json(config['file_paths']['existing_stations'])
    df_ranked = calculate_potential_score(
        df_pois, 
        df_stations, 
        vmd_medio_ponderado, 
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