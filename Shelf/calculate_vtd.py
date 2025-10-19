import pandas as pd
from haversine import haversine

def processar_dados_vmd(excel_path, data_sheet, metadata_sheet):
    """
    Carrega e limpa os dados de VMD do SNV a partir de um arquivo Excel,
    lendo as abas especificadas.
    """
    try:
        print(f"Lendo dados da aba '{data_sheet}' do arquivo Excel...")
        df_vmd = pd.read_excel(excel_path, sheet_name=data_sheet)
        
        print(f"Lendo metadados da aba '{metadata_sheet}' do arquivo Excel...")
        df_metadados = pd.read_excel(excel_path, sheet_name=metadata_sheet)

    except FileNotFoundError as e:
        print(f"--> ERRO: Arquivo Excel de VMD não encontrado: {e}")
        return pd.DataFrame()
    except ValueError as e:
        print(f"--> ERRO: Aba não encontrada no arquivo Excel. Verifique os nomes em config.json. Detalhe: {e}")
        return pd.DataFrame()
    except Exception as e:
        print(f"--> ERRO inesperado ao processar arquivo Excel: {e}")
        return pd.DataFrame()

    df_vmd = df_vmd.rename(columns={'id_trecho_snv': 'id_snv'})
    df_vmd_completo = pd.merge(df_vmd, df_metadados, on='id_snv')
    
    df_vmd_completo['latitude'] = pd.to_numeric(df_vmd_completo['latitude'], errors='coerce')
    df_vmd_completo['longitude'] = pd.to_numeric(df_vmd_completo['longitude'], errors='coerce')
    df_vmd_completo.dropna(subset=['latitude', 'longitude'], inplace=True)
    
    print("Dados de VMD do SNV processados com sucesso.")
    return df_vmd_completo

def calcular_vtd_medio_rota(df_vmd_completo, waypoints):
    """
    Calcula o Volume Médio Diário (VMD) total para a rota.
    """
    if df_vmd_completo.empty or not waypoints:
        return 0

    vmd_total_rota = 0
    pontos_analisados = 0
    
    for i, (lon, lat) in enumerate(waypoints[::10]): # Amostragem para performance
        ponto_rota = (lat, lon)
        
        distancias = [
            haversine(ponto_rota, (row.latitude, row.longitude))
            for row in df_vmd_completo.itertuples()
        ]
        
        if not distancias:
            continue

        ponto_vmd_mais_proximo = df_vmd_completo.iloc[distancias.index(min(distancias))]
        vmd_total_rota += ponto_vmd_mais_proximo['vmd_total']
        pontos_analisados += 1

    if pontos_analisados == 0:
        return 0
        
    vmd_medio = vmd_total_rota / pontos_analisados
    print(f"VMD médio calculado para a rota: {vmd_medio:.0f} veículos/dia.")
    return vmd_medio