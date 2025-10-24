import json
import folium
from folium.plugins import MarkerCluster, FastMarkerCluster
import os
import sys

# ===============================
# CONFIGURAÇÃO
# ===============================

ARQUIVO_ELETROPOSTOS = "eletropostos_live.json"
ARQUIVO_POIS = "pois_brasil.json"
OUTPUT_MAPA = "mapa_brasil_completo.html"

# Centro do Brasil (aproximado)
CENTRO_BRASIL = [-14.2350, -51.9253]

# Cores por fonte de dados
CORES_FONTES = {
    "OpenChargeMap": "purple",
    "ANEEL": "blue",
    "GooglePlaces": "darkpurple"
}

# Configuração de POIs
POI_CONFIG = {
    "parking": {'color': 'orange', 'icon': 'parking', 'prefix': 'fa', 'nome': 'Estacionamento'},
    "fuel": {'color': 'red', 'icon': 'tint', 'prefix': 'fa', 'nome': 'Posto de Combustível'},
    "gas_station": {'color': 'red', 'icon': 'tint', 'prefix': 'fa', 'nome': 'Posto de Combustível'},
    "supermarket": {'color': 'green', 'icon': 'shopping-cart', 'prefix': 'fa', 'nome': 'Supermercado'},
    "shopping_mall": {'color': 'darkgreen', 'icon': 'shopping-bag', 'prefix': 'fa', 'nome': 'Shopping'},
    "hotel": {'color': 'darkblue', 'icon': 'bed', 'prefix': 'fa', 'nome': 'Hotel'},
    "motel": {'color': 'lightblue', 'icon': 'bed', 'prefix': 'fa', 'nome': 'Motel'},
    "restaurant": {'color': 'green', 'icon': 'cutlery', 'prefix': 'fa', 'nome': 'Restaurante'},
    "rest_area": {'color': 'cadetblue', 'icon': 'coffee', 'prefix': 'fa', 'nome': 'Área de Descanso'},
    "unknown": {'color': 'gray', 'icon': 'question-circle', 'prefix': 'fa', 'nome': 'Outro'}
}

# ===============================
# FUNÇÕES DE LEITURA
# ===============================

def carregar_eletropostos():
    """Carrega os eletropostos do arquivo JSON gerado pelo crawler"""
    if not os.path.exists(ARQUIVO_ELETROPOSTOS):
        print(f"❌ ERRO: Arquivo '{ARQUIVO_ELETROPOSTOS}' não encontrado!")
        print("Execute o crawler primeiro para gerar os dados.")
        return []
    
    try:
        with open(ARQUIVO_ELETROPOSTOS, 'r', encoding='utf-8') as f:
            postos = json.load(f)
        print(f"✅ {len(postos)} eletropostos carregados de '{ARQUIVO_ELETROPOSTOS}'")
        return postos
    except Exception as e:
        print(f"❌ Erro ao carregar eletropostos: {e}")
        return []

def carregar_pois():
    """Carrega os POIs do arquivo JSON gerado pelo crawler"""
    if not os.path.exists(ARQUIVO_POIS):
        print(f"⚠️ Arquivo '{ARQUIVO_POIS}' não encontrado. Continuando sem POIs.")
        return []
    
    try:
        with open(ARQUIVO_POIS, 'r', encoding='utf-8') as f:
            pois = json.load(f)
        print(f"✅ {len(pois)} POIs carregados de '{ARQUIVO_POIS}'")
        return pois
    except Exception as e:
        print(f"⚠️ Erro ao carregar POIs: {e}")
        return []

# ===============================
# FUNÇÕES DE ESTATÍSTICAS
# ===============================

def gerar_estatisticas(eletropostos, pois):
    """Gera estatísticas sobre os dados carregados"""
    print("\n" + "="*60)
    print("ESTATÍSTICAS DOS DADOS")
    print("="*60)
    
    # Estatísticas de Eletropostos
    print(f"\n📊 ELETROPOSTOS: {len(eletropostos)} total")
    if eletropostos:
        fontes = {}
        for posto in eletropostos:
            fonte = posto.get('source', 'Desconhecido')
            fontes[fonte] = fontes.get(fonte, 0) + 1
        
        for fonte, count in sorted(fontes.items(), key=lambda x: x[1], reverse=True):
            print(f"   - {fonte}: {count}")
    
    # Estatísticas de POIs
    print(f"\n📊 POIs: {len(pois)} total")
    if pois:
        tipos = {}
        fontes_poi = {}
        for poi in pois:
            tipo = poi.get('type', 'unknown')
            fonte = poi.get('source', 'Desconhecido')
            tipos[tipo] = tipos.get(tipo, 0) + 1
            fontes_poi[fonte] = fontes_poi.get(fonte, 0) + 1
        
        print("\n   Por tipo:")
        for tipo, count in sorted(tipos.items(), key=lambda x: x[1], reverse=True)[:10]:
            nome_tipo = POI_CONFIG.get(tipo, POI_CONFIG['unknown'])['nome']
            print(f"   - {nome_tipo} ({tipo}): {count}")
        
        print("\n   Por fonte:")
        for fonte, count in sorted(fontes_poi.items(), key=lambda x: x[1], reverse=True):
            print(f"   - {fonte}: {count}")
    
    print("="*60 + "\n")

# ===============================
# GERAÇÃO DO MAPA
# ===============================

def criar_mapa(eletropostos, pois):
    """Cria o mapa interativo com todos os dados"""
    print("🗺️ Gerando mapa interativo...")
    
    # Cria o mapa base
    mapa = folium.Map(
        location=CENTRO_BRASIL,
        zoom_start=5,
        tiles="CartoDB positron"
    )
    
    # Adiciona tiles alternativos
    folium.TileLayer('OpenStreetMap').add_to(mapa)
    folium.TileLayer('CartoDB dark_matter').add_to(mapa)
    
    # === CAMADA DE ELETROPOSTOS ===
    print("  → Adicionando eletropostos...")
    
    # Separa por fonte para criar clusters diferentes
    eletropostos_por_fonte = {}
    for posto in eletropostos:
        fonte = posto.get('source', 'Desconhecido')
        if fonte not in eletropostos_por_fonte:
            eletropostos_por_fonte[fonte] = []
        eletropostos_por_fonte[fonte].append(posto)
    
    # Cria uma camada para cada fonte
    for fonte, postos_fonte in eletropostos_por_fonte.items():
        camada = folium.FeatureGroup(
            name=f"⚡ Eletropostos - {fonte} ({len(postos_fonte)})",
            show=True
        )
        coords = [
            [posto["latitude"], posto["longitude"]]
            for posto in postos_fonte
            if posto.get("latitude") and posto.get("longitude")
        ]
        FastMarkerCluster(coords).add_to(camada)
        camada.add_to(mapa)
        # === CAMADA DE POIs ===
        if pois:
            print("  → Adicionando POIs...")
            
            # Agrupa POIs por tipo
            pois_por_tipo = {}
            for poi in pois:
                tipo = poi.get('type', 'unknown')
                if tipo not in pois_por_tipo:
                    pois_por_tipo[tipo] = []
                pois_por_tipo[tipo].append(poi)
            
            # Cria camadas por tipo de POI
            for tipo, pois_tipo in pois_por_tipo.items():
                config = POI_CONFIG.get(tipo, POI_CONFIG['unknown'])
                
                camada_poi = folium.FeatureGroup(
                    name=f"📍 {config['nome']} ({len(pois_tipo)})",
                    show=False  # Desativado por padrão para não sobrecarregar
                )
                
                cluster_poi = MarkerCluster(name=f"cluster_poi_{tipo}").add_to(camada_poi)
                
                for poi in pois_tipo:
                    try:
                        lat = poi['latitude']
                        lon = poi['longitude']
                        nome = poi.get('name', 'Sem nome')
                        endereco = poi.get('address', '')
                        fonte = poi.get('source', 'Desconhecido')
                        
                        popup_html = f"""
                        <div style="width: 200px;">
                            <b>{config['nome']}</b><br>
                            {nome}<br>
                            <i>{endereco}</i><br>
                            <small>Fonte: {fonte}</small>
                        </div>
                        """
                        
                        folium.Marker(
                            location=[lat, lon],
                            popup=folium.Popup(popup_html, max_width=250),
                            tooltip=f"{config['nome']}: {nome}",
                            icon=folium.Icon(**{k: v for k, v in config.items() if k != 'nome'})
                        ).add_to(cluster_poi)
                    except (KeyError, TypeError):
                        continue
                
                camada_poi.add_to(mapa)
    
    # Adiciona controle de camadas
    folium.LayerControl(collapsed=False).add_to(mapa)
    
    # Adiciona legenda
    legenda_html = '''
    <div style="position: fixed; 
                bottom: 50px; right: 50px; width: 220px; height: auto; 
                background-color: white; z-index:9999; font-size:14px;
                border:2px solid grey; border-radius: 5px; padding: 10px">
        <p style="margin-bottom: 5px;"><b>🗺️ Mapa de Eletropostos e POIs</b></p>
        <p style="margin: 3px 0;"><i class="fa fa-bolt" style="color:purple"></i> Eletropostos</p>
        <p style="margin: 3px 0;"><i class="fa fa-tint" style="color:red"></i> Postos de Combustível</p>
        <p style="margin: 3px 0;"><i class="fa fa-bed" style="color:darkblue"></i> Hotéis</p>
        <p style="margin: 3px 0;"><i class="fa fa-cutlery" style="color:green"></i> Restaurantes</p>
        <p style="margin: 3px 0; font-size: 11px;"><i>Use o controle de camadas para filtrar</i></p>
    </div>
    '''
    mapa.get_root().html.add_child(folium.Element(legenda_html))
    
    return mapa

# ===============================
# MAIN
# ===============================

def main():
    print("\n" + "="*60)
    print("🇧🇷 GERADOR DE MAPA COMPLETO - BRASIL")
    print("="*60 + "\n")
    
    # Carrega os dados
    eletropostos = carregar_eletropostos()
    pois = carregar_pois()
    
    if not eletropostos:
        print("\n❌ Nenhum eletroposto carregado. Abortando.")
        sys.exit(1)
    
    # Gera estatísticas
    gerar_estatisticas(eletropostos, pois)
    
    # Cria o mapa
    mapa = criar_mapa(eletropostos, pois)
    
    # Salva o arquivo
    mapa.save(OUTPUT_MAPA)
    
    print(f"\n✅ SUCESSO! Mapa salvo como '{OUTPUT_MAPA}'")
    print(f"📊 Total de pontos no mapa:")
    print(f"   - Eletropostos: {len(eletropostos)}")
    print(f"   - POIs: {len(pois)}")
    print(f"\n🌐 Abra o arquivo '{OUTPUT_MAPA}' no navegador para visualizar.")
    print("="*60 + "\n")

if __name__ == "__main__":
    main()