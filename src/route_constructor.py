import pandas as pd

def construir_rota_snv(df_snv, ufs_rota, brs_rota, cidade_partida_uf, br_partida, cidade_destino):
    """
    Constrói uma rota trecho a trecho a partir dos dados do SNV,
    com lógica aprimorada para lidar com quebras e transições de rodovia.
    """
    print("Iniciando construção da rota a partir dos dados do SNV...")

    df_snv.columns = df_snv.columns.str.strip()
    if 'id_trecho_' in df_snv.columns:
        df_snv = df_snv.rename(columns={'id_trecho_': 'id_trecho_snv'})
    else:
        print("ERRO CRÍTICO: Coluna 'id_trecho_' não encontrada.")
        return pd.DataFrame()

    df_snv['sg_uf'] = df_snv['sg_uf'].astype(str).str.strip()
    df_snv['vl_br'] = pd.to_numeric(df_snv['vl_br'], errors='coerce').astype('Int64').astype(str).str.zfill(3)

    df_rota_potencial = df_snv[df_snv['sg_uf'].isin(ufs_rota) & df_snv['vl_br'].isin(brs_rota)].copy()
    print(f"Dados filtrados por UF e BR. Restaram {len(df_rota_potencial)} trechos potenciais.")

    trechos_iniciais_df = df_rota_potencial[
        (df_rota_potencial['sg_uf'] == cidade_partida_uf) &
        (df_rota_potencial['vl_br'] == br_partida)
    ]
    if trechos_iniciais_df.empty:
        print(f"ERRO CRÍTico: Nenhum trecho da BR-{br_partida} foi encontrado em {cidade_partida_uf}.")
        return pd.DataFrame()

    trecho_inicial = trechos_iniciais_df.sort_values(by='vl_km_inic').iloc[0]
    print(f"Ponto de partida encontrado: {trecho_inicial['ds_local_i']} -> {trecho_inicial['ds_local_f']}")

    rota_completa = [trecho_inicial]
    trecho_atual = trecho_inicial
    ids_ja_na_rota = {trecho_atual['id_trecho_snv']}

    while not any(keyword in str(trecho_atual['ds_local_f']).upper() for keyword in [cidade_destino.upper()]):
        local_final_atual = trecho_atual['ds_local_f']
        trecho_encontrado = None

        # TENTATIVA 1: Busca por correspondência exata
        proximo_trecho_df = df_rota_potencial[
            (df_rota_potencial['ds_local_i'] == local_final_atual) &
            (~df_rota_potencial['id_trecho_snv'].isin(ids_ja_na_rota))
        ]
        
        if not proximo_trecho_df.empty:
            trecho_encontrado = proximo_trecho_df.iloc[0]
        else:
            # TENTATIVA 2: Lógica flexível para quebras e transições de BR
            km_final_atual = trecho_atual['vl_km_fina']
            br_atual = trecho_atual['vl_br']
            uf_atual = trecho_atual['sg_uf']
            
            # Procura por trechos na MESMA BR e UF, com pequena tolerância de KM
            candidatos_mesma_br = df_rota_potencial[
                (df_rota_potencial['vl_br'] == br_atual) &
                (df_rota_potencial['sg_uf'] == uf_atual) &
                (abs(df_rota_potencial['vl_km_inic'] - km_final_atual) < 5) & # Tolerância de 5km
                (~df_rota_potencial['id_trecho_snv'].isin(ids_ja_na_rota))
            ]

            if not candidatos_mesma_br.empty:
                trecho_encontrado = candidatos_mesma_br.sort_values(by='vl_km_inic').iloc[0]
            else:
                # Procura por trechos em OUTRAS BRs da rota que comecem em um entroncamento
                candidatos_transicao = df_rota_potencial[
                    (df_rota_potencial['vl_br'] != br_atual) &
                    (df_rota_potencial['sg_uf'] == uf_atual) &
                    (df_rota_potencial['ds_local_i'].str.contains(f'ENTR.*{br_atual}', case=False, na=False)) &
                    (~df_rota_potencial['id_trecho_snv'].isin(ids_ja_na_rota))
                ]
                if not candidatos_transicao.empty:
                    trecho_encontrado = candidatos_transicao.sort_values(by='vl_km_inic').iloc[0]


        if trecho_encontrado is None:
            print(f"\nAVISO: Quebra definitiva na rota. Não foi possível encontrar a continuação a partir de '{local_final_atual}'.")
            break
        
        rota_completa.append(pd.Series(trecho_encontrado))
        ids_ja_na_rota.add(trecho_encontrado['id_trecho_snv'])
        trecho_atual = trecho_encontrado
    
    df_rota_final = pd.DataFrame(rota_completa).reset_index(drop=True)
    print(f"Construção da rota finalizada com {len(df_rota_final)} trechos.")
    return df_rota_final