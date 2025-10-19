import pandas as pd
from haversine import haversine

def processar_dados_vmd(vmd_path, metadados_path):
    """
    Carrega e limpa os dados de VMD do SNV, retornando um DataFrame pronto para uso.
    """
    try:
        # CORREÇÃO: Especificado o separador como ';' que é comum em arquivos do governo brasileiro
        df_vmd = pd.read_csv(vmd_path, sep=';', encoding='latin1', decimal=',')
        df_metadados = pd.read_csv(metadados_path, sep=';', encoding='latin1')
    except FileNotFoundError as e:
        print(f"--> ERRO: Arquivo de VMD não encontrado: {e}")
        return pd.DataFrame()
    except Exception as e:
        print(f"--> ERRO ao processar arquivos de VMD: {e}")
        return pd.DataFrame()

    df_vmd = df_vmd.rename(columns={'id_trecho_snv': 'id_snv'})
    df_vmd_completo = pd.merge(df_vmd, df_metadados, on='id_snv')
    
    # Converte coordenadas para numérico, tratando erros
    df_vmd_completo['latitude'] = pd.to_numeric(df_vmd_completo['latitude'], errors='coerce')
    df_vmd_completo['longitude'] = pd.to_numeric(df_vmd_completo['longitude'], errors='coerce')
    df_vmd_completo.dropna(subset=['latitude', 'longitude'], inplace=True)
    
    print("Dados de VMD do SNV processados com sucesso.")
    return df_vmd_completo

def calcular_vtd_medio_rota(df_vmd_completo, waypoints):
    """
    Calcula o Volume Médio Diário (VMD) total para a rota, encontrando os
    trechos de rodovia mais próximos dos waypoints.
    """
    if df_vmd_completo.empty or not waypoints:
        return 0

    vmd_total_rota = 0
    pontos_analisados = 0
    
    # Analisa um waypoint a cada 10 para otimizar
    for i, (lon, lat) in enumerate(waypoints[::10]):
        ponto_rota = (lat, lon)
        
        # Encontra o ponto de medição de VMD mais próximo do waypoint atual
        distancias = [
            haversine(ponto_rota, (row.latitude, row.longitude))
            for row in df_vmd_completo.itertuples()
        ]
        
        if not distancias:
            continue

        ponto_vmd_mais_proximo = df_vmd_completo.iloc[distancias.index(min(distancias))]
        
        # Usa o VMD total do ponto mais próximo
        vmd_trecho = ponto_vmd_mais_proximo['vmd_total']
        vmd_total_rota += vmd_trecho
        pontos_analisados += 1

    if pontos_analisados == 0:
        return 0
        
    vmd_medio = vmd_total_rota / pontos_analisados
    print(f"VMD médio calculado para a rota: {vmd_medio:.0f} veículos/dia.")
    return vmd_medio