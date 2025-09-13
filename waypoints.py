import requests
import json

# Coordenadas de exemplo (Latitude, Longitude)
# Formato do OSRM é {longitude},{latitude}
start_coords = "-49.2733,-25.4284"  # Curitiba
end_coords = "-46.6333,-23.5505" # São Paulo

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


except requests.exceptions.HTTPError as err:
    print(f"Erro na requisição: {err}")
except Exception as e:
    print(f"Ocorreu um erro: {e}")