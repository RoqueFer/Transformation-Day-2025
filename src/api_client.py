def get_route_waypoints(start_coords, end_coords):
    # ... (função sem alterações) ...
    start_clean = start_coords.replace(" ", "")
    end_clean = end_coords.replace(" ", "")
    url = f"http://router.project-osrm.org/route/v1/driving/{start_clean};{end_clean}?overview=full&geometries=geojson"
    try:
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        data = response.json()
        if data.get('routes'):
            return data['routes'][0]['geometry']['coordinates']
        else:
            print(f"--> Aviso: Nenhuma rota encontrada no OSRM.")
            return []
    except Exception as e:
        print(f"--> ERRO ao buscar rota: {e}")
        return []

def find_charging_stations_on_route(waypoints):
    # ... (função sem alterações) ...
    postos_encontrados = {}
    radius_km = 15
    print("\n--- Buscando eletropostos na rota via API ---")
    for i, wp in enumerate(waypoints[::50]):
        lon, lat = wp
        ocm_url = (
            f"https://api.openchargemap.io/v3/poi/?output=json"
            f"&countrycode=BR&latitude={lat}&longitude={lon}"
            f"&distance={radius_km}&distanceunit=KM&maxresults=50"
        )
        try:
            print(f"Consultando postos perto do waypoint {i+1}/{len(waypoints[::50])}...")
            req = requests.get(ocm_url, headers=headers, timeout=15)
            req.raise_for_status()
            res = req.json()
            for posto in res:
                postos_encontrados[posto["ID"]] = posto
        except Exception as e:
            print(f"--> Aviso: erro ao consultar waypoint: {e}")
        time.sleep(0.5)
    print(f"Busca finalizada. Total de {len(postos_encontrados)} postos únicos encontrados.")
    return list(postos_encontrados.values())

def find_pois_on_route_segment(segment_waypoints, segment_name):
    """
    Busca por POIs (postos, restaurantes, hotéis) ao longo de um segmento de rota específico.
    """
    if not segment_waypoints:
        print(f"\n--- Segmento '{segment_name}' está vazio. Nenhuma busca de POIs será feita. ---")
        return {}

    overpass_url = "http://overpass-api.de/api/interpreter"
    pois_encontrados = {}
    radius_m = 7000 # Raio de busca de 7km ao redor do ponto da rota

    poi_queries = {
        "posto_combustivel": 'node["amenity"="fuel"]',
        "restaurante": 'node["amenity"="restaurant"]',
        "hotel": 'node["tourism"~"hotel|motel"]'
    }

    print(f"\n--- Buscando POIs no segmento '{segment_name}' via Overpass API ---")

    waypoints_to_check = segment_waypoints[::20]
    if len(segment_waypoints) > 0 and not waypoints_to_check:
        waypoints_to_check = segment_waypoints[:1]

    for i, wp in enumerate(waypoints_to_check):
        lon, lat = wp
        print(f"Consultando POIs perto do waypoint {i+1}/{len(waypoints_to_check)} do segmento...")
        
        full_query = "[out:json];("
        for poi_type, query_part in poi_queries.items():
            full_query += f'{query_part}(around:{radius_m},{lat},{lon});'
        full_query += ");out body;>;out skel qt;"

        try:
            response = requests.post(overpass_url, data=full_query, timeout=30)
            response.raise_for_status()
            data = response.json()

            for element in data.get('elements', []):
                poi_id = element['id']
                if poi_id not in pois_encontrados:
                    if 'tags' in element:
                        if element['tags'].get('amenity') == 'fuel':
                            element['poi_type'] = 'Posto de Combustível'
                        elif element['tags'].get('amenity') == 'restaurant':
                             element['poi_type'] = 'Restaurante'
                        elif element['tags'].get('tourism') in ['hotel', 'motel']:
                             element['poi_type'] = 'Hotel/Motel'
                        else:
                             element['poi_type'] = 'Outro'
                    element['found_in'] = segment_name # --- NOVO --- Adiciona onde o POI foi encontrado
                    pois_encontrados[poi_id] = element
        except Exception as e:
            print(f"--> Aviso: erro ao consultar Overpass API: {e}")
        time.sleep(1) 

    print(f"Busca de POIs finalizada para '{segment_name}'. Total de {len(pois_encontrados)} POIs únicos encontrados.")
    return pois_encontrados
