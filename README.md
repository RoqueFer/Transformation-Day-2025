🗺️ Análise de Potencial para Eletropostos - Renault Transformation Day 2025

Este projeto foi desenvolvido como parte do desafio "Mobilize" do Renault Transformation Day 2025. O objetivo principal é realizar uma análise de dados geoespaciais e de tráfego para identificar os melhores locais para a instalação de novos pontos de recarga para veículos elétricos. A análise foca em criar um "Score de Potencial" para PIs (Pontos de Interesse) ao longo de rotas estratégicas, como Curitiba -> São Paulo.

✨ Funcionalidades Principais

    Coleta de Rotas: Traça o caminho exato de rodovias entre duas cidades.

    Busca de POIs: Identifica pontos de interesse (restaurantes, hotéis, postos) ao longo da rota.

    Análise de Concorrência: Mapeia os eletropostos já existentes na região.

    Análise de Fluxo: Utiliza dados de Volume Total Diário (VTD) para medir o tráfego nas rodovias.

    Score de Potencial: Consolida todos os dados em um modelo de pontuação para classificar os locais mais promissores.

    Visualização em Mapa: Gera mapas interativos (.html) com a rota, os raios de autonomia e a localização dos pontos.

🛠️ Tecnologias Utilizadas

    Linguagem: Python

    Bibliotecas Principais:

        pandas: Para manipulação e análise de dados.

        folium: Para a criação de mapas interativos.

        requests: Para fazer requisições a APIs externas.

        haversine: Para calcular distâncias geográficas precisas.

        openpyxl: Para compatibilidade com arquivos Excel.

    APIs Externas:

        OSRM (Open Source Routing Machine): Para traçar as rotas.

        Overpass API (OpenStreetMap): Para coletar os Pontos de Interesse.

🚀 Como Rodar o Projeto

Siga os passos abaixo para configurar e executar a análise completa.

Pré-requisitos

    Python 3.9 ou superior

    Git

Instalação

    Clone o repositório:
    Bash

git clone <URL_DO_SEU_REPOSITORIO>
cd <NOME_DO_REPOSITORIO>

Crie e ative um ambiente virtual (Recomendado):
Bash

python -m venv .venv
# No Windows
.venv\Scripts\activate
# No macOS/Linux
source .venv/bin/activate

Instale as dependências:
(Recomendação: Crie um arquivo requirements.txt com o conteúdo abaixo e rode pip install -r requirements.txt)
Plaintext

    # requirements.txt
    pandas
    folium
    requests
    haversine
    openpyxl

Execução da Análise (Sequência Correta)

A análise de dados depende de uma sequência específica de execução dos scripts. Rode os scripts localizados na pasta python_utils/ na seguinte ordem:

    waypoints.py: Gera o "esqueleto" da rota.

        Input: Coordenadas de início e fim (definidas no código).

        Output: waypoints_curitiba_sao_paulo.json (na pasta raiz).

    calculo_poi_2.py: Busca os POIs ao longo da rota.

        Input: waypoints_curitiba_sao_paulo.json.

        Output: pois_na_rota.csv (na pasta raiz).

    analise_final.py (ou calculo_poi_1.py): Executa a análise principal.

        Input: pois_na_rota.csv, plugshare.json, Media VTD.xlsx - Planilha1.csv.

        Output: resultado_analise_pontos.csv (na pasta raiz), com os POIs classificados pelo "Score de Potencial".

    plot_v1.py (ou map.py): Gera a visualização final em mapa.

        Input: waypoints_curitiba_sao_paulo.json, plugshare.json, e opcionalmente resultado_analise_pontos.csv.

        Output: mapa_com_autonomia_e_rota.html (na pasta raiz).
