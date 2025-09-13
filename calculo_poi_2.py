# 1. NORMALIZAÇÃO (escala de 0 a 1)
# Para fluxo, quanto maior, melhor.
df_pois['fluxo_norm'] = (df_pois['fluxo_veiculos'] - df_pois['fluxo_veiculos'].min()) / \
                        (df_pois['fluxo_veiculos'].max() - df_pois['fluxo_veiculos'].min())

# Para distância, quanto maior, melhor.
df_pois['dist_norm'] = (df_pois['dist_eletroposto_km'] - df_pois['dist_eletroposto_km'].min()) / \
                       (df_pois['dist_eletroposto_km'].max() - df_pois['dist_eletroposto_km'].min())

# (Você pode adicionar uma lógica para o 'tipo' de POI, ex: Hotel=1, Restaurante=0.8, etc.)

# 2. DEFINIÇÃO DOS PESOS
W_FLUXO = 0.6  # 60% de importância
W_DISTANCIA = 0.4 # 40% de importância

# 3. CÁLCULO DO SCORE FINAL
df_pois['score_potencial'] = (df_pois['fluxo_norm'] * W_FLUXO) + \
                             (df_pois['dist_norm'] * W_DISTANCIA)

# 4. CLASSIFICAÇÃO
df_final_ranqueado = df_pois.sort_values(by='score_potencial', ascending=False)

print("\n--- TOP 10 MELHORES PONTOS ENCONTRADOS ---")
print(df_final_ranqueado.head(10)[['nome', 'tipo', 'score_potencial', 'fluxo_veiculos', 'dist_eletroposto_km']])

# Salva o resultado final para a próxima etapa
df_final_ranqueado.to_csv('resultado_analise_pontos.csv', index=False)