import folium
from haversine import haversine, Unit

def create_analysis_map(df_ranked_pois, route_waypoints, city_coords, vehicle_info, output_path):
    """
    Gera um mapa Folium interativo com os resultados da análise, mostrando
    apenas os melhores POIs que estão próximos à rota.
    """
    start_coords = list(city_coords.values())[0]['map_coords']
    map_center = [
        (start_coords[0] + list(city_coords.values())[1]['map_coords'][0]) / 2,
        (start_coords[1] + list(city_coords.values())[1]['map_coords'][1]) / 2,
    ]
    
    mapa = folium.Map(location=map_center, zoom_start=7, tiles="CartoDB positron")

    route_for_map = [(lat, lon) for lon, lat in route_waypoints]
    folium.PolyLine(locations=route_for_map, color='gray', weight=5, tooltip="Rota Analisada").add_to(mapa)

    for city_data in city_coords.values():
        folium.Circle(
            location=city_data['map_coords'],
            radius=vehicle_info['autonomia_km'] * 1000,
            color=vehicle_info['cor'],
            fill=True,
            fill_opacity=0.15,
            tooltip=f"Raio de Autonomia: {vehicle_info['autonomia_km']} km"
        ).add_to(mapa)

    # --- LÓGICA DE FILTRAGEM ADICIONADA ---
    print("Filtrando os melhores POIs próximos à rota para visualização...")
    pois_para_plotar = []
    distancia_max_km = 10 # Define uma distância máxima de 10km da rota para um POI ser considerado relevante
    
    for _, poi in df_ranked_pois.iterrows():
        poi_coord = (poi['latitude'], poi['longitude'])
        
        # Verifica a menor distância do POI para qualquer ponto na rota
        distancia_minima = min([haversine(poi_coord, (lat, lon), unit=Unit.KILOMETERS) for lon, lat in route_waypoints[::5]])
        
        if distancia_minima <= distancia_max_km:
            pois_para_plotar.append(poi)

        # Para de procurar quando tivermos 20 POIs relevantes para não sobrecarregar o mapa
        if len(pois_para_plotar) >= 20:
            break
            
    print(f"Plotando {len(pois_para_plotar)} POIs relevantes no mapa.")
    for poi in pois_para_plotar:
        folium.Marker(
            location=[poi['latitude'], poi['longitude']],
            popup=f"<b>{poi['nome']} ({poi['tipo']})</b><br>Score: {poi['score_potencial']:.2f}",
            icon=folium.Icon(color='green', icon='star')
        ).add_to(mapa)

    mapa.save(output_path)
    print(f"Mapa de análise salvo em: {output_path}")