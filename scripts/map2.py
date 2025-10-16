import folium
from folium.plugins import BeautifyIcon

print("Iniciando a geração do mapa de cobertura estratégica...")

# --- 1. Definição dos Hotspots Estratégicos ---
# Estes são os locais propostos para os eletropostos.
# A localização foi pensada para criar uma "corrente" de cobertura.
hotspots = [
    {'lat': -27.59, 'lon': -48.54, 'local': 'Florianópolis, SC'},
    {'lat': -26.29, 'lon': -48.84, 'local': 'Joinville, SC'},
    {'lat': -25.42, 'lon': -49.27, 'local': 'Curitiba, PR'},
    {'lat': -24.78, 'lon': -48.35, 'local': 'Registro, SP'},
    {'lat': -23.55, 'lon': -46.63, 'local': 'São Paulo, SP'},
    {'lat': -23.21, 'lon': -45.88, 'local': 'São José dos Campos, SP'},
    {'lat': -22.50, 'lon': -44.10, 'local': 'Barra Mansa, RJ'},
    {'lat': -22.90, 'lon': -43.17, 'local': 'Rio de Janeiro, RJ'},
]

# --- 2. Criação do Mapa Base ---
mapa_base = folium.Map(
    location=[-25.0, -48.0],
    zoom_start=7,
    tiles='CartoDB positron'
)

# --- 3. Definição dos Perfis de Veículos ---
perfis = {
    "urbano_regional": {
        "nome": "Perfil Urbano/Regional (Autonomia 280km)",
        "cor": "blue",
        "alcance_seguro_m": 220 * 1000  # 220km em metros
    },
    "viagem_premium": {
        "nome": "Perfil Viagem/Premium (Autonomia 430km)",
        "cor": "red",
        "alcance_seguro_m": 340 * 1000  # 340km em metros
    }
}

# --- 4. Criação e Adição das Camadas ao Mapa ---

# Para cada perfil, criamos uma camada (FeatureGroup)
for key, perfil in perfis.items():
    
    # FeatureGroup é uma camada que podemos adicionar/remover do mapa
    camada = folium.FeatureGroup(name=perfil["nome"], show=True)

    # Adicionamos os círculos e marcadores para cada hotspot
    for ponto in hotspots:
        # Adiciona o círculo de alcance
        folium.Circle(
            location=[ponto['lat'], ponto['lon']],
            radius=perfil["alcance_seguro_m"],
            color=perfil["cor"],
            weight=1,
            fill_opacity=0.1,
            fill_color=perfil["cor"],
            tooltip=f"Alcance de {int(perfil['alcance_seguro_m']/1000)} km"
        ).add_to(camada)

        # Adiciona o marcador do eletroposto
        folium.Marker(
            location=[ponto['lat'], ponto['lon']],
            popup=f"<b>Eletroposto Proposto</b><br>{ponto['local']}",
            icon=BeautifyIcon(
                icon='plug',
                icon_shape='marker',
                number=None,
                border_color=perfil["cor"],
                background_color='#FFFFFF',
                text_color=perfil["cor"]
            )
        ).add_to(camada)
        
    # Adiciona a camada completa ao mapa
    camada.add_to(mapa_base)


# --- 5. Adição do Controle de Camadas e Salvamento ---

# Adiciona o controle no canto superior direito para ligar/desligar as camadas
folium.LayerControl(collapsed=False).add_to(mapa_base)

# Salva o mapa em um arquivo HTML
nome_arquivo = 'mapa_cobertura_autonomia.html'
mapa_base.save(nome_arquivo)

print(f"Mapa gerado com sucesso! Abra o arquivo '{nome_arquivo}' no seu navegador.")