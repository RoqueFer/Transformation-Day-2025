import requests
import pandas as pd
import time
import requests

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

def find_pois_on_route(waypoints, radius_km):
    """
    Busca POIs usando uma única consulta de bounding box para máxima eficiência.
    """
    if not waypoints:
        return pd.DataFrame()

    print("\nOtimizando a busca de POIs com uma única consulta de área...")

    buffer = radius_km / 111
    min_lon = min(lon for lon, lat in waypoints) - buffer
    max_lon = max(lon for lon, lat in waypoints) + buffer
    min_lat = min(lat for lon, lat in waypoints) - buffer
    max_lat = max(lat for lon, lat in waypoints) + buffer
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"

    overpass_url = "http://overpass-api.de/api/interpreter"
    
    # ***** CORREÇÃO APLICADA AQUI *****
    # A sintaxe correta do Overpass QL não usa chaves {} na bounding box.
    # Passamos a string diretamente dentro dos parênteses do filtro.
    poi_query = f"""
    [out:json][timeout:180];
    (
      node["amenity"~"fuel|restaurant"]({bbox_str});
      node["tourism"~"hotel|motel"]({bbox_str});
    );
    out body;
    >;
    out skel qt;
    """

    try:
        print(f"Executando consulta massiva de POIs. Isso pode levar até 2 minutos...")
        response = requests.post(overpass_url, data=poi_query, timeout=180)
        response.raise_for_status()
        data = response.json()
        print(f"API respondeu com {len(data.get('elements', []))} elementos.")

    except requests.RequestException as e:
        print(f"--> ERRO CRÍTICO ao consultar Overpass API: {e}")
        print("--> Não foi possível obter os POIs. A análise de score será imprecisa.")
        return pd.DataFrame()

    pois_encontrados = []
    for element in data.get('elements', []):
        if 'tags' in element:
            poi_info = {
                "id": element.get('id'),
                "latitude": element.get('lat'),
                "longitude": element.get('lon'),
                "nome": element.get('tags', {}).get('name', 'Sem nome'),
                "tipo": (element.get('tags', {}).get('amenity') or 
                         element.get('tags', {}).get('tourism', 'desconhecido'))
            }
            pois_encontrados.append(poi_info)

    df_pois = pd.DataFrame(pois_encontrados)
    if not df_pois.empty:
        df_pois = df_pois.drop_duplicates(subset='id').reset_index(drop=True)
    
    print(f"Busca finalizada. Total de {len(df_pois)} POIs únicos encontrados na área da rota.")
    return df_pois

def find_charging_stations_on_route(waypoints, api_key):
    """
    Busca por eletropostos (concorrentes) ao longo da rota usando a API do OpenChargeMap.
    """
    print("\nBuscando eletropostos existentes (concorrentes) via API...")
    postos_encontrados = {}
    headers = {"X-API-Key": api_key}
    
    # Amostra a rota para não fazer requisições demais
    for i, (lon, lat) in enumerate(waypoints[::50]): # Verifica a cada ~50km
        ocm_url = (
            f"https://api.openchargemap.io/v3/poi/?output=json&countrycode=BR"
            f"&latitude={lat}&longitude={lon}&distance=25&distanceunit=KM"
        )
        try:
            req = requests.get(ocm_url, headers=headers, timeout=20)
            req.raise_for_status()
            for posto in req.json():
                # Adiciona apenas se tiver informações de endereço válidas
                if posto.get('AddressInfo', {}).get('Latitude') and posto.get('AddressInfo', {}).get('Longitude'):
                    postos_encontrados[posto["ID"]] = {
                        "name": posto['AddressInfo'].get('Title', 'Sem nome'),
                        "latitude": posto['AddressInfo']['Latitude'],
                        "longitude": posto['AddressInfo']['Longitude']
                    }
        except requests.RequestException as e:
            print(f"--> Aviso: erro ao consultar API de eletropostos: {e}")
        time.sleep(0.5) # Pausa para não sobrecarregar a API

    df_stations = pd.DataFrame(list(postos_encontrados.values()))
    print(f"Busca finalizada. {len(df_stations)} eletropostos concorrentes encontrados.")
    return df_stations