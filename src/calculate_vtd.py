import pandas as pd
import sys
import os
from pathlib import Path

# --- CONFIGURAÇÃO DE CAMINHOS ---
script_path = Path(__file__).resolve()
src_dir = script_path.parent
root_dir = src_dir.parent
data_raw_path = root_dir / 'data' / 'raw'
os.makedirs(data_raw_path, exist_ok=True)
input_filename = data_raw_path / 'VMDa 2023.xlsx'
output_filename = data_raw_path / 'rota_brasilia_campo_grande.csv'
# --- FIM DA CONFIGURAÇÃO DE CAMINHOS ---

try:
    df = pd.read_excel(input_filename, sheet_name='SNV202401A')
except FileNotFoundError:
    print(f"ERRO: Arquivo de entrada não encontrado em '{input_filename}'")
    sys.exit()
except Exception as e:
    print(f"ERRO ao ler o arquivo Excel: {e}")
    sys.exit()

print("Arquivo Excel carregado com sucesso. Iniciando limpeza e formatação dos dados...")

# ======================================================================
# ETAPA DE LIMPEZA E FORMATAÇÃO (SOLUÇÃO DEFINITIVA)

# 1. Limpa espaços em branco da coluna UF
df['sg_uf'] = df['sg_uf'].astype(str).str.strip()

# 2. Corrige a formatação da coluna da BR para garantir a correspondência
#    Converte para número (para remover casas decimais como .0), depois para texto
#    e preenche com zeros à esquerda para garantir 3 dígitos (ex: 60 -> "060")
df['vl_br'] = pd.to_numeric(df['vl_br'], errors='coerce').astype('Int64').astype(str).str.zfill(3)
# ======================================================================

# 1. FILTRAGEM INICIAL
ufs_rota = ['DF', 'GO', 'MS']
brs_rota = ['060', '163', '364']
df_rota_potencial = df[df['sg_uf'].isin(ufs_rota) & df['vl_br'].isin(brs_rota)].copy()
print(f"Dados filtrados. Restaram {len(df_rota_potencial)} trechos para análise.")

# 2. IDENTIFICAR O PONTO DE PARTIDA (Método por Quilometragem)
trechos_iniciais_df = df_rota_potencial[
    (df_rota_potencial['sg_uf'] == 'DF') &
    (df_rota_potencial['vl_br'] == '060')
]

if trechos_iniciais_df.empty:
    print("ERRO CRÍTICO: Mesmo após a formatação, nenhum trecho da BR-060 foi encontrado no DF.")
    sys.exit()

# O trecho 10626 que você encontrou, com km inicial 0, será o nosso ponto de partida.
trecho_inicial = trechos_iniciais_df.sort_values(by='vl_km_inic').iloc[0]
print(f"Ponto de partida encontrado: {trecho_inicial['ds_local_i']} -> {trecho_inicial['ds_local_f']}")

# 3. CONSTRUIR A ROTA, TRECHO POR TRECHO
rota_completa = [trecho_inicial]
trecho_atual = trecho_inicial
# Usar uma coluna que seja um identificador único, como 'ID' ou o código do trecho
id_coluna = 'ID' if 'ID' in df.columns else 'vl_codigo'
ids_ja_na_rota = {trecho_inicial[id_coluna]}

while not any(keyword in str(trecho_atual['ds_local_f']).upper() for keyword in ['CAMPO GRANDE']):
    local_final_atual = trecho_atual['ds_local_f']
    trecho_encontrado = None

    # TENTATIVA 1: Busca por correspondência exata
    proximo_trecho_df = df_rota_potencial[
        (df_rota_potencial['ds_local_i'] == local_final_atual) &
        (~df_rota_potencial[id_coluna].isin(ids_ja_na_rota))
    ]
    
    if not proximo_trecho_df.empty:
        trecho_encontrado = proximo_trecho_df.iloc[0]
    else:
        # TENTATIVAS ADICIONAIS (transição de BR, proximidade de km, etc.)
        # ... (código para lógicas flexíveis) ...
        if any(city in str(local_final_atual).upper() for city in ['JATAI', 'RIO VERDE']):
            candidatos_transicao = df_rota_potencial[
                (df_rota_potencial['vl_br'].isin(['163', '364'])) &
                (df_rota_potencial['sg_uf'] == 'GO') &
                (df_rota_potencial['ds_local_i'].str.contains('ENTR.*060', case=False, na=False)) &
                (~df_rota_potencial[id_coluna].isin(ids_ja_na_rota))
            ]
            if not candidatos_transicao.empty:
                trecho_encontrado = candidatos_transicao.sort_values(by='vl_km_inic').iloc[0]
        
        if trecho_encontrado is None:
            km_final_atual = trecho_atual['vl_km_fina']
            br_atual = trecho_atual['vl_br']
            uf_atual = trecho_atual['sg_uf']
            candidatos_flex = df_rota_potencial[
                (df_rota_potencial['vl_br'] == br_atual) &
                (df_rota_potencial['sg_uf'] == uf_atual) &
                (abs(df_rota_potencial['vl_km_inic'] - km_final_atual) < 2) &
                (~df_rota_potencial[id_coluna].isin(ids_ja_na_rota))
            ]
            if not candidatos_flex.empty:
                trecho_encontrado = candidatos_flex.sort_values(by='vl_km_inic').iloc[0]


    if trecho_encontrado is None:
        print(f"\nAVISO: Quebra na rota. Não foi possível encontrar a continuação a partir de:")
        print(f"-> {local_final_atual} (BR-{trecho_atual['vl_br']}, KM {trecho_atual['vl_km_fina']})")
        break
    
    rota_completa.append(pd.Series(trecho_encontrado))
    ids_ja_na_rota.add(trecho_encontrado[id_coluna])
    trecho_atual = trecho_encontrado
    print(f"Adicionado trecho: {trecho_atual['ds_local_i']} -> {trecho_atual['ds_local_f']} (BR-{trecho_atual['vl_br']})")

# 4. FINALIZAÇÃO E EXPORTAÇÃO
df_rota_final = pd.DataFrame(rota_completa)
# Selecionar apenas as colunas que podem ser numéricas para a conversão
cols_numericas = ['VMDa_C', 'VMDa_D']
for col in cols_numericas:
    df_rota_final[col] = pd.to_numeric(df_rota_final[col], errors='coerce').fillna(0)

df_rota_final['VMDa_Total'] = df_rota_final['VMDa_C'] + df_rota_final['VMDa_D']
df_rota_final.to_csv(output_filename, index=False, encoding='utf-8-sig')

print(f"\n--- Processo Concluído ---")
print(f"Rota extraída com sucesso! Foram encontrados {len(df_rota_final)} trechos.")
print(f"Os dados da rota foram salvos em '{output_filename}'.")