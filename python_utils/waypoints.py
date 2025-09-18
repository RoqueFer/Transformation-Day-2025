import requests
import json

# Coordenadas de exemplo (Latitude, Longitude)
# Formato do OSRM é {longitude},{latitude}
start_coords = "-49.2733,-25.4284"  # Curitiba
end_coords = "-46.6333,-23.5505" # São Paulo

headers = {"X-API-Key": "813110e4-2f26-4b74-9fc8-da2269128a94"}

# Monta a URL da API do OSRM
# 'geometries=geojson' retorna os waypoints em um formato fácil de usar
url = f"https://router.project-osrm.org/route/v1/driving/{start_coords};{end_coords}?overview=full&geometries=geojson"
try:
    response = requests.get(url)
    response.raise_for_status()  # Levanta um erro para códigos de status HTTP ruins (4xx ou 5xx)
    data = response.json()
    print(data)
except requests.exceptions.RequestException as e:
    print(f"Ocorreu um erro: {e}")
except Exception as e:
    print(f"Ocorreu um erro inesperado: {e}")
try:
    # Faz a requisição para a API
    response = requests.get(url)
    response.raise_for_status()  # Lança um erro se a requisição falhar

    # Converte a resposta em JSON
    data = response.json()

    # Extrai a geometria da rota (a lista de waypoints)
    # A rota está em formato GeoJSON: uma lista de pares [longitude, latitude]
    waypoints = data['routes'][0]['geometry']['coordinates']

    print(f"Rota encontrada com sucesso!")
    print(f"Total de waypoints (coordenadas) no trajeto: {len(waypoints)}")
    
    # Mostra os 10 primeiros waypoints como exemplo
    print("\n10 primeiros waypoints [Longitude, Latitude]:")
    for wp in waypoints[:10]:
        print(wp)

    # Você pode salvar esses waypoints em um arquivo se quiser
    with open('waypoints_curitiba_sao_paulo.json', 'w') as f:
        json.dump(waypoints, f)
    print("\nWaypoints salvos em 'waypoints_curitiba_sao_paulo.json'")

    print('consultando eletropostos no trajeto...')

    postos_encontrados = {}
    radius_km = 0.8 #coloquei aqui pra achar os eletropostos a um raio de 800 m da nossa trajetoria

    for i, wp in enumerate(waypoints[::50]): #pegando os postos a cada 50 pontos da trajetoria pra gente nao fazer mt req
        lon, lat = wp 
        ocm_url = (
            f"https://api.openchargemap.io/v3/poi/?output=json"
            f"&countrycode=BR&latitude={lat}&longitude={lon}"
            f"&distance={radius_km}&distanceunit=KM"
        )

        try:
            print('enviando req...')
            req = requests.get(ocm_url, headers=headers)
            print('req enviada')
            req.raise_for_status()
            res = req.json()
            print('response: ', res)
            for posto in res:
                posto_id = posto["ID"]
                postos_encontrados[posto_id] = posto
                print('adicionando posto à lista...')
        except Exception as e:
            print(f'erro ao consultar waypoint {i}: {e}')

    print(f"\nTotal de eletropostos únicos encontrados no trajeto: {len(postos_encontrados)}")

    with open("eletropostos_rota.json", "w", encoding="utf-8") as f:
        json.dump(list(postos_encontrados.values()), f, ensure_ascii=False, indent=2)
    print("Eletropostos salvos em 'eletropostos_rota.json'")


except requests.exceptions.HTTPError as err:
    print(f"Erro na requisição: {err}")
except Exception as e:
    print(f"Ocorreu um erro: {e}")