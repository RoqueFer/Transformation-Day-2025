import folium
import pandas as pd
from haversine import haversine, Unit

def create_analysis_map(df_ranked_pois, df_eletropostos, route_waypoints, route_segments, city_coords, vehicle_info, output_path):
    """
    Gera um mapa Folium interativo e rico em insights, inspirado na versão Poc_apresentação.py.
    """
    start_coords = list(city_coords.values())[0]['map_coords']
    map_center = [
        (start_coords[0] + list(city_coords.values())[1]['map_coords'][0]) / 2,
        (start_coords[1] + list(city_coords.values())[1]['map_coords'][1]) / 2,
    ]
    
    mapa = folium.Map(location=map_center, zoom_start=7, tiles="CartoDB positron")

    # --- Camadas para Interatividade ---
    fg_rota = folium.FeatureGroup(name="Rota Principal e Segmentos", show=True).add_to(mapa)
    fg_concorrentes = folium.FeatureGroup(name="Eletropostos Existentes", show=True).add_to(mapa)
    fg_oportunidades = folium.FeatureGroup(name="Melhores Oportunidades (POIs)", show=True).add_to(mapa)

    # 1. Rota Principal
    route_for_map = [(lat, lon) for lon, lat in route_waypoints]
    folium.PolyLine(locations=route_for_map, color='gray', weight=5, tooltip="Rota Completa").add_to(fg_rota)

    # 2. Círculos de Autonomia (100% e 80%)
    autonomia_max = vehicle_info['autonomia_km']
    autonomia_reserva = autonomia_max * 0.8
    for city_data in city_coords.values():
        folium.Circle(location=city_data['map_coords'], radius=autonomia_max * 1000, color=vehicle_info['cor'], fill=True, fill_opacity=0.1, tooltip=f"Raio de {autonomia_max}km").add_to(mapa)
        folium.Circle(location=city_data['map_coords'], radius=autonomia_reserva * 1000, color=vehicle_info['cor'], weight=2, fill=False, dash_array='5, 5', tooltip=f"Início da Zona de Reserva ({autonomia_reserva:.0f}km)").add_to(mapa)

    # 3. Segmentos da Rota (Gap e Reservas)
    if route_segments['gap']:
        folium.PolyLine([(lat, lon) for lon, lat in route_segments['gap']], color='red', weight=8, opacity=0.7, tooltip="Gap de Autonomia").add_to(fg_rota)
    if route_segments['reserva_start']:
        folium.PolyLine([(lat, lon) for lon, lat in route_segments['reserva_start']], color='orange', weight=8, opacity=0.7, tooltip="Zona de Reserva (Partida)").add_to(fg_rota)
    if route_segments['reserva_end']:
        folium.PolyLine([(lat, lon) for lon, lat in route_segments['reserva_end']], color='orange', weight=8, opacity=0.7, tooltip="Zona de Reserva (Destino)").add_to(fg_rota)

    # 4. Eletropostos Concorrentes
    print("Plotando eletropostos concorrentes...")
    for _, station in df_eletropostos.iterrows():
        if pd.notna(station['latitude']) and pd.notna(station['longitude']):
            folium.Marker(
                location=[station['latitude'], station['longitude']],
                popup=f"<b>Concorrente:</b><br>{station['name']}",
                icon=folium.Icon(color='purple', icon='bolt', prefix='fa')
            ).add_to(fg_concorrentes)

    # 5. POIs (Oportunidades) com Ícones Hierárquicos
    print("Plotando as melhores oportunidades (POIs)...")
    poi_icons = {
        'fuel': {'color': 'orange', 'icon': 'gas-pump', 'prefix': 'fa'},
        'restaurant': {'color': 'green', 'icon': 'utensils', 'prefix': 'fa'},
        'hotel': {'color': 'blue', 'icon': 'bed', 'prefix': 'fa'},
        'motel': {'color': 'darkblue', 'icon': 'bed', 'prefix': 'fa'},
        'desconhecido': {'color': 'gray', 'icon': 'question-circle', 'prefix': 'fa'}
    }
    
    # Filtra os 20 melhores POIs que estão realmente perto da rota
    pois_para_plotar = []
    for _, poi in df_ranked_pois.iterrows():
        dist_min = min([haversine((poi['latitude'], poi['longitude']), (lat, lon), unit=Unit.KILOMETERS) for lon, lat in route_waypoints[::5]])
        if dist_min <= 20:
            pois_para_plotar.append(poi)
        if len(pois_para_plotar) >= 20:
            break
            
    for poi in pois_para_plotar:
        icon_info = poi_icons.get(poi['tipo'], poi_icons['desconhecido'])
        folium.Marker(
            location=[poi['latitude'], poi['longitude']],
            popup=f"<b>{poi['nome']} ({poi['tipo']})</b><br>Score: {poi['score_potencial']:.3f}",
            icon=folium.Icon(**icon_info)
        ).add_to(fg_oportunidades)

    # Adiciona marcadores das cidades
    for city_name, city_data in city_coords.items():
        folium.Marker(location=city_data['map_coords'], tooltip=city_name.title(), icon=folium.Icon(color='black', icon='star')).add_to(mapa)

    folium.LayerControl().add_to(mapa)
    mapa.save(output_path)
    print(f"\nMapa final salvo em: {output_path}")