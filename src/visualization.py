import folium
import pandas as pd
from haversine import haversine, Unit

def create_analysis_map(df_ranked_pois, df_eletropostos, all_waypoints, all_route_segments, city_coords, vehicles_list, output_path):
    """
    Gera um mapa Folium consolidado com MÚLTIPLAS rotas e suas análises.
    """
    lats = [data['map_coords'][0] for data in city_coords.values()]
    lons = [data['map_coords'][1] for data in city_coords.values()]
    map_center = [(min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2]
    
    mapa = folium.Map(location=map_center, zoom_start=6, tiles="CartoDB positron")

    fg_rotas = folium.FeatureGroup(name="Rotas e Segmentos", show=True).add_to(mapa)
    fg_concorrentes = folium.FeatureGroup(name="Eletropostos Existentes", show=True).add_to(mapa)
    fg_oportunidades = folium.FeatureGroup(name="Melhores Oportunidades (POIs)", show=True).add_to(mapa)

    for i, waypoints in enumerate(all_waypoints):
        route_segments = all_route_segments[i]
        folium.PolyLine([(lat, lon) for lon, lat in waypoints], color='gray', weight=4).add_to(fg_rotas)
        if route_segments['gap']: folium.PolyLine([(lat, lon) for lon, lat in route_segments['gap']], color='red', weight=7, opacity=0.8).add_to(fg_rotas)
        if route_segments['reserva_start']: folium.PolyLine([(lat, lon) for lon, lat in route_segments['reserva_start']], color='orange', weight=7, opacity=0.8).add_to(fg_rotas)
        if route_segments['reserva_end']: folium.PolyLine([(lat, lon) for lon, lat in route_segments['reserva_end']], color='orange', weight=7, opacity=0.8).add_to(fg_rotas)

    for vehicle in vehicles_list:
        autonomia_max = vehicle['autonomia_km']
        fg_vehicle = folium.FeatureGroup(name=f"Autonomia: {vehicle['modelo']}", show=False)
        for city_data in city_coords.values():
            folium.Circle(location=city_data['map_coords'], radius=autonomia_max * 1000, color=vehicle['cor'], fill=True, fill_opacity=0.05).add_to(fg_vehicle)
        fg_vehicle.add_to(mapa)

    for _, station in df_eletropostos.iterrows():
        if pd.notna(station['latitude']) and pd.notna(station['longitude']):
            folium.Marker(location=[station['latitude'], station['longitude']], popup=f"<b>Concorrente:</b><br>{station['name']}", icon=folium.Icon(color='purple', icon='bolt', prefix='fa')).add_to(fg_concorrentes)

    # --- CORREÇÃO APLICADA AQUI: Dicionário de ícones completo ---
    poi_icons = {
        'fuel': {'color': 'orange', 'icon': 'gas-pump', 'prefix': 'fa'},
        'restaurant': {'color': 'green', 'icon': 'utensils', 'prefix': 'fa'},
        'hotel': {'color': 'blue', 'icon': 'bed', 'prefix': 'fa'},
        'motel': {'color': 'darkblue', 'icon': 'bed', 'prefix': 'fa'},
        'desconhecido': {'color': 'gray', 'icon': 'question-circle', 'prefix': 'fa'}
    }
    
    for _, poi in df_ranked_pois.sort_values(by='score_potencial', ascending=False).head(50).iterrows():
        # A lógica agora funciona, pois o dicionário está completo
        icon_info = poi_icons.get(poi['tipo'], poi_icons['desconhecido'])
        folium.Marker(
            location=[poi['latitude'], poi['longitude']], 
            popup=f"<b>{poi['nome']}</b><br>Score: {poi['score_potencial']:.3f}", 
            icon=folium.Icon(**icon_info)
        ).add_to(fg_oportunidades)

    for city_name, city_data in city_coords.items():
        folium.Marker(location=city_data['map_coords'], tooltip=city_name.replace('_', ' ').title(), icon=folium.Icon(color='black', icon='star')).add_to(mapa)

    folium.LayerControl().add_to(mapa)
    mapa.save(output_path)
    print(f"\nMapa consolidado salvo em: {output_path}")