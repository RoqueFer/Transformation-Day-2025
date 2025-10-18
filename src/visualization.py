import folium

def create_analysis_map(df_ranked_pois, route_waypoints, city_coords, vehicle_info, output_path):
    """Gera um mapa Folium interativo com os resultados da análise."""

    start_coords = list(city_coords.values())[0]['map']
    map_center = [
        (start_coords[0] + list(city_coords.values())[1]['map'][0]) / 2,
        (start_coords[1] + list(city_coords.values())[1]['map'][1]) / 2,
    ]

    mapa = folium.Map(location=map_center, zoom_start=7, tiles="CartoDB positron")

    # Adiciona a rota
    route_for_map = [(lat, lon) for lon, lat in route_waypoints]
    folium.PolyLine(locations=route_for_map, color='gray', weight=5).add_to(mapa)

    # Adiciona círculos de autonomia
    for city_data in city_coords.values():
        folium.Circle(
            location=city_data['map'],
            radius=vehicle_info['range_km'] * 1000,
            color=vehicle_info['color'],
            fill=True,
            fill_opacity=0.2
        ).add_to(mapa)

    # Adiciona os 20 melhores POIs ranqueados
    for _, poi in df_ranked_pois.head(20).iterrows():
        folium.Marker(
            location=[poi['latitude'], poi['longitude']],
            popup=f"<b>{poi['nome']}</b><br>Score: {poi['score_potencial']:.2f}",
            icon=folium.Icon(color='green', icon='star')
        ).add_to(mapa)

    mapa.save(output_path)
    print(f"Mapa de análise salvo em: {output_path}")