import requests
import pandas as pd
import time

# Nota: As URLs e chaves de API foram removidas daqui.
# Elas virão do arquivo de configuração!

def get_route_waypoints(start_coords, end_coords):
    """Busca os waypoints de uma rota usando a API OSRM."""
    url = f"http://router.project-osrm.org/route/v1/driving/{start_coords};{end_coords}?overview=full&geometries=geojson"
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        data = response.json()
        if data.get('routes'):
            return data['routes'][0]['geometry']['coordinates']
        print("--> Aviso: Nenhuma rota encontrada no OSRM.")
        return []
    except requests.RequestException as e:
        print(f"--> ERRO ao buscar rota: {e}")
        return []

def find_pois_on_route(waypoints, radius_m):
    """Busca por POIs (postos, restaurantes, hotéis) ao longo de uma rota."""
    overpass_url = "http://overpass-api.de/api/interpreter"
    pois_encontrados = {}
    poi_queries = {
        "posto_combustivel": 'node["amenity"="fuel"]',
        "restaurante": 'node["amenity"="restaurant"]',
        "hotel": 'node["tourism"~"hotel|motel"]'
    }

    # Amostra os waypoints para não fazer muitas requisições
    waypoints_to_check = waypoints[::20]

    print(f"Buscando POIs em {len(waypoints_to_check)} pontos da rota...")
    for i, (lon, lat) in enumerate(waypoints_to_check):
        full_query = "[out:json];("
        for query_part in poi_queries.values():
            full_query += f'{query_part}(around:{radius_m},{lat},{lon});'
        full_query += ");out body;>;out skel qt;"

        try:
            response = requests.post(overpass_url, data=full_query, timeout=30)
            response.raise_for_status()
            data = response.json()
            for element in data.get('elements', []):
                if element['id'] not in pois_encontrados:
                    # Simplificando a extração de dados
                    poi_info = {
                        "id": element['id'],
                        "latitude": element.get('lat'),
                        "longitude": element.get('lon'),
                        "nome": element.get('tags', {}).get('name', 'Sem nome'),
                        "tipo": element.get('tags', {}).get('amenity', element.get('tags', {}).get('tourism'))
                    }
                    pois_encontrados[element['id']] = poi_info
        except requests.RequestException as e:
            print(f"--> Aviso: erro ao consultar Overpass API: {e}")
        time.sleep(1)

    # Converte o dicionário para uma lista e depois para um DataFrame
    df_pois = pd.DataFrame(list(pois_encontrados.values()))
    print(f"Busca finalizada. Total de {len(df_pois)} POIs únicos encontrados.")
    return df_pois