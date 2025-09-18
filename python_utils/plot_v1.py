import folium
import json
import pandas as pd
import sys

# --- 1. CONFIGURAÇÕES E CARREGAMENTO DOS DADOS ---

# Defina a autonomia média de um carro elétrico em KM
AUTONOMIA_KM = 350

try:
    # Correção: Caminhos relativos para carregar os dados da pasta raiz
    with open('resources\waypoints_curitiba_sao_paulo.json', 'r') as f:
        waypoints_data = json.load(f)
    print("Arquivo 'resources\waypoints_curitiba_sao_paulo.json' carregado.")

    df_eletropostos = pd.read_json('resources\plugshare.json')
    print(f"Carregados {len(df_eletropostos)} eletropostos do 'plugshare.json'.")

except FileNotFoundError as e:
    print(f"ERRO: Arquivo não encontrado! -> {e}")
    print("Certifique-se de que este script está na pasta 'python_utils' e os arquivos de dados na pasta principal.")
    sys.exit()


# --- 2. PREPARAÇÃO DOS DADOS PARA O MAPA ---

# Inverte as coordenadas da rota para o formato [latitude, longitude] do Folium
rota_invertida = [(lat, lon) for lon, lat in waypoints_data]

coord_inicio = rota_invertida[0]
coord_fim = rota_invertida[-1]

# Calcula o ponto central do mapa
mapa_centro = [
    (coord_inicio[0] + coord_fim[0]) / 2,
    (coord_inicio[1] + coord_fim[1]) / 2
]


# --- 3. CRIAÇÃO DO MAPA COM FOLIUM ---

mapa = folium.Map(location=mapa_centro, zoom_start=8, tiles="CartoDB positron")

# Adiciona os círculos de autonomia
print("Adicionando círculos de autonomia...")
folium.Circle(
    location=coord_inicio,
    radius=AUTONOMIA_KM * 1000,
    color='#3186cc', fill=True, fill_color='#3186cc', fill_opacity=0.2,
    tooltip=f"Raio de Autonomia de {AUTONOMIA_KM}km a partir de Curitiba"
).add_to(mapa)

folium.Circle(
    location=coord_fim,
    radius=AUTONOMIA_KM * 1000,
    color='#cc3131', fill=True, fill_color='#cc3131', fill_opacity=0.2,
    tooltip=f"Raio de Autonomia de {AUTONOMIA_KM}km a partir de São Paulo"
).add_to(mapa)

# Adiciona a rota da estrada no mapa
print("Adicionando a rota da rodovia...")
folium.PolyLine(
    locations=rota_invertida, color='blue', weight=5, opacity=0.8,
    tooltip="Rota Curitiba -> São Paulo"
).add_to(mapa)

# Adiciona os eletropostos existentes
print("Adicionando marcadores de eletropostos...")
grupo_eletropostos = folium.FeatureGroup(name="Eletropostos Existentes")

for index, posto in df_eletropostos.iterrows():
    # --- CORREÇÃO APLICADA AQUI ---
    # Usamos .get(chave, valor_padrao) para evitar o erro se uma chave não existir.
    nome_posto = posto.get('name', 'Nome Indisponível')
    endereco_posto = posto.get('address', 'Endereço Indisponível')
    is_fast = posto.get('is_fast_charger', False) # Assume que não é rápido se a info faltar

    popup_html = f"""
    <b>{nome_posto}</b><br>
    <i>{endereco_posto}</i><br>
    Carregador Rápido: {'Sim' if is_fast else 'Não'}
    """
    
    cor_icone = 'green' if is_fast else 'orange'
    
    # Verifica se as coordenadas existem antes de tentar plotar o marcador
    if pd.notna(posto.get('latitude')) and pd.notna(posto.get('longitude')):
        folium.Marker(
            location=[posto['latitude'], posto['longitude']],
            popup=folium.Popup(popup_html, max_width=300),
            tooltip=nome_posto,
            icon=folium.Icon(color=cor_icone, icon='flash')
        ).add_to(grupo_eletropostos)

grupo_eletropostos.add_to(mapa)
folium.LayerControl().add_to(mapa)


# --- 4. SALVAR O MAPA ---

output_filename = 'mapa_com_autonomia_e_rota.html'
mapa.save(output_filename)
print(f"\nSUCESSO! Mapa salvo como '{output_filename}'.")
print("Abra este arquivo em seu navegador para ver o resultado interativo.")