# WKT Polygon Map - Power BI Custom Visual

Visual customizado de altíssima performance para o Microsoft Power BI, inspirado no IconMap, projetado especificamente para renderizar polígonos a partir de colunas **WKT (Well-Known Text)** com aceleração gráfica por GPU (HTML5 Canvas ou SVG vetorial).

---

## ✨ Principais Funcionalidades

1. **Aceleração Gráfica por GPU (Canvas de Alta Performance)**:
   - **Motor de Renderização Selecionável**: escolha entre **Canvas** (padrão, acelerado por hardware para renderizar milhares de feições a 60 FPS fluidos) ou **SVG** (padrão vetorial).
   - **Cache Inteligente de WKT (Memoization)**: armazena geometrias e centroides parseados em memória, evitando reprocessamento custoso durante redimensionamento de janela, filtros e cross-highlighting.
   - **Redimensionamento Instantâneo**: atualiza apenas as dimensões do mapa sem re-parsear dados na thread principal.
   - **Simplificação Dinâmica de Linhas (`smoothFactor`)**: algoritmo Douglas-Peucker integrado para suavizar e acelerar o desenho de geometrias complexas em zooms mais afastados.
   - **Throttling de Tooltips**: taxa controlada de disparo de tooltips (35ms), garantindo que o ponteiro do mouse deslize com máxima suavidade.

2. **Nível de Detalhe (LOD), Culling e Streaming para Grandes Bases (1M+ Polígonos)**:
   - **Bypass do Limite Nativo do Power BI (30.000)**: Carregamento progressivo contínuo via streaming assíncrono (`fetchMoreData(true)`), permitindo acumular fatias de dados até um teto configurável (ex: 100.000+ linhas).
   - **Level of Detail (LOD) Adaptativo**: Calcula em tempo real o tamanho aparente de cada polígono em pixels na tela (`pxPerDegLng/Lat`). Polígonos microscópicos (sub-pixel, menores que o limiar configurado como 4px) são filtrados quando a visualização está afastada, revelando apenas as feições maiores e mais relevantes.
   - **Deslocamento Progressivo com Zoom**: Conforme o usuário aproxima o zoom em uma região, os polígonos menores ganham pixels de tela e passam a ser renderizados gradualmente e automaticamente.
   - **Viewport Culling (Oclusão Espacial)**: Polígonos fora do retângulo visível da tela (`map.getBounds()`) são descartados do pipeline de desenho imediato, poupando CPU e GPU.
   - **Trava de Segurança de Performance (`maxPolygonsOnScreen`)**: Ordena os polígonos candidatos visíveis por área/diagonal e limita a renderização máxima simultânea (padrão 10.000 feições na tela) para garantir taxa de quadros a 60 FPS sem congelar ou derrubar o navegador.
   - **Exceção de Seleção**: Qualquer polígono selecionado pelo usuário ou filtrado por cross-highlighting é mantido visível mesmo quando afastado, garantindo continuidade analítica.

3. **Personalização Avançada de Estilos dos Polígonos**:
   - **Padrões de Linha de Contorno**: escolha entre contorno **Sólido (Contínuo)**, **Tracejado (`dashed`)**, **Pontilhado (`dotted`)** ou **Traço-Ponto (`dash-dot`)**.
   - **Destaque Interativo ao Passar o Mouse (Hover State)**:
     - Realce visual imediato sob o cursor: cor da borda, espessura e opacidade de preenchimento personalizáveis no momento do hover.
   - **Rótulos dos Polígonos no Mapa (Labels)**:
     - Exibe o nome ou categoria centralizado no polígono (calculado via centroide com cache).
     - Personalização de **Tamanho da Fonte**, **Cor do Texto**, e **Zoom Mínimo de Exibição** (para manter o mapa limpo quando afastado).
   - **Cores, Espessura e Opacidades**: controle total de preenchimento, borda, seleção/destaque e atenuação dos polígonos não selecionados.

3. **Múltiplas Camadas de WKT com Seletor Interativo no Mapa**:
   - Permite vincular **múltiplas colunas com polígonos WKT** (mesmo de tabelas diferentes do modelo).
   - Cada coluna é tratada como uma **camada independente**.
   - **Exibição Inteligente do Controle de Camadas**: quando houver apenas **uma coluna WKT** no campo (e nenhuma camada externa ativa), o seletor de camadas é ocultado automaticamente no mapa para manter a tela limpa e sem elementos redundantes. Ele é exibido assim que houver 2 ou mais camadas no mapa.
   - **Controle de Camadas no Mapa**: seletor moderno e interativo no canto superior direito para ativar/desativar camadas individuais ou usar atalhos ("Todas" / "Nenhuma").
   - **Cores Automáticas por Camada**: cada camada recebe automaticamente uma cor distinta e harmônica quando não houver formatação condicional específica.
   - O tooltip exibe em destaque a qual camada o polígono pertence.

4. **Camadas Externas OGC (WMS, WMTS e WFS)**:
   - Permite adicionar uma camada externa a partir de um link **WMS (Web Map Service)**, **WMTS (Web Map Tile Service)** ou **WFS (Web Feature Service)**.
   - A camada externa é integrada ao mapa e ao seletor de camadas ("como outra camada"), permitindo ligar e desligar pelo painel interativo.
   - **WMS (Raster Dinâmico)**: renderiza imagens georreferenciadas transparentes (GeoServer, ArcGIS Server, MapServer, IBGE, INPE, etc.) com controle de versão, transparência e opacidade.
   - **WMTS (Tiles Pré-renderizados)**: alta performance com pirâmides de tiles em cache (padrão KVP com `GetTile` ou modelos de URL RESTful com `{z}/{x}/{y}`).
   - **WFS (Vetorial GeoJSON)**: baixa e renderiza feições vetoriais (pontos, linhas e polígonos) com cor e borda personalizáveis e tooltips interativos mostrando os atributos da feição.
   - **Detecção Inteligente de Link**: aceita tanto URLs base quanto URLs completas com parâmetros ou padrões de tiles.

5. **Suporte Nativo e Automático a WKT**:
   - Suporta `POLYGON` e `MULTIPOLYGON`.
   - **Detecção Inteligente**: o visual detecta automaticamente colunas com texto WKT mesmo se os campos forem arrastados em ordens diferentes.
   - Opção de **inversão de coordenadas (Latitude/Longitude vs Longitude/Latitude)** no painel de formatação.

6. **Mapas de Fundo (Basemaps) Gratuitos & Sem Chave de API**:
   - **Carto Claro (Positron)**: visual clean e moderno (padrão).
   - **Carto Escuro (Dark Matter)**: modo dark elegante.
   - **OpenStreetMap Padrão**.
   - **Esri Imagem de Satélite** (alta resolução).
   - **URL de Tiles Personalizada**.

7. **Cross-Filtering Bidirecional**:
   - Ao clicar em qualquer polígono no mapa, os outros gráficos do relatório são filtrados instantaneamente.
   - Suporta seleção múltipla com `Ctrl` ou `Shift`.
   - Ao clicar no fundo do mapa, a seleção é limpa automaticamente.

8. **Formatação Condicional de Cores**:
   - Campo opcional **Cor de Preenchimento**: permite vincular uma coluna ou medida contendo código hexadecimal de cor (ex: `#3B82F6`, `#EF4444`).
   - Caso não seja informada cor condicional, cada camada utiliza sua cor temática automática.

9. **Tooltips Nativos do Power BI**:
   - Mostra a camada e o nome/categoria do polígono ao passar o mouse.
   - Suporta medidas e colunas adicionais no campo **Dicas de Ferramenta (Tooltips)**.
   - Opção para exibir ou ocultar o texto WKT no tooltip.

10. **Ajuste Automático de Zoom (Fit Bounds)**:
    - Centraliza e ajusta o zoom automaticamente aos limites dos polígonos visíveis das camadas ativas.
    - Opção de ajustar o zoom dinamicamente ao alternar a visibilidade de camadas.

---

## 🚀 Como Utilizar no Power BI Desktop

1. O novo arquivo compilado está em:
   [`dist/wktPolygonMapD3C983E422CF431EB88DC278ED1CA011.1.0.0.0.pbiviz`](dist/wktPolygonMapD3C983E422CF431EB88DC278ED1CA011.1.0.0.0.pbiviz)
2. No **Power BI Desktop**, vá no painel de **Visualizações**, clique nos **três pontos (`...`)** e selecione **Importar um visual de um arquivo**.
3. Selecione o arquivo `.pbiviz` gerado na pasta `Map_Viz/dist/`.
4. Arraste os campos no visual:
   - **Camadas WKT (Geometria)**: Arraste **uma ou mais colunas** contendo WKT.
     - *Se arrastar apenas 1 coluna WKT*: o visual renderiza diretamente sem exibir o botão de camadas no mapa.
     - *Se arrastar 2 ou mais colunas WKT*: o seletor flutuante de camadas aparecerá no canto superior direito para alternar a visibilidade.
   - **Categoria / Nome** *(opcional)*: Arraste as colunas de nome correspondentes.
    - **Tamanho / Área / Prioridade (LOD)** *(Recomendado para bases com milhares/milhões de polígonos)*:
      - Arraste a coluna com a área do polígono (ex: rea_ha, rea_m2, shape_area, hectares ou coluna calculada Tamanho = LEN([WKT])).
      - **Como espalhar os maiores por todo o país**: Nos três pontos (...) no cabeçalho do visual no relatório:
        1. Selecione **Classificar por -> Tamanho / Área / Prioridade (LOD)**.
        2. Selecione **Classificar em ordem decrescente**.
        Isso força o Power BI a extrair os 30.000 **maiores polígonos de todo o território nacional** (espalhados pelo Brasil) em vez de puxar apenas o primeiro bloco físico da tabela.
   - **Cor de Preenchimento** *(opcional)*: Medida ou coluna com código `#HEX`.
   - **Dicas de Ferramenta** *(opcional)*: Medidas ou colunas adicionais.
5. **Para Adicionar uma Camada Externa (WMS, WMTS ou WFS)**:
   - No painel de **Formatação do Visual** (ícone de pincel), abra a seção **Camada Externa (WMS / WMTS / WFS)**.
   - Marque **Ativar Camada Externa**.
   - Escolha o **Tipo de Serviço** (`WMS`, `WMTS` ou `WFS`).
   - Insira o **Link / URL do Serviço** (ex: URL base ou com template `{z}/{x}/{y}`).
   - Opcionalmente informe o **Nome da Camada** (ex: `workspace:camada`).
   - Ajuste a **Opacidade (%)** e o estilo desejado.
   - A camada aparecerá no mapa e fará parte do controle de camadas caso haja mais de uma camada ativa!

6. **Para Ajustar Desempenho e Nível de Detalhe (Bases Grandes / 1M+ Polígonos)**:
   - No painel de **Formatação do Visual**, abra **Desempenho e LOD (Grandes Bases)**:
     - **Otimização LOD por Zoom**: ative para exibir somente polígonos com dimensão perceptível na tela.
     - **Tamanho Mínimo na Tela (Pixels)**: defina quantos pixels o polígono precisa ter para ser desenhado (padrão: `4px`). Conforme você dá zoom, mais polígonos menores aparecem.
     - **Oclusão Espacial (Viewport Culling)**: apenas polígonos que tocam o enquadramento atual da tela são desenhados.
     - **Limite Máximo na Tela**: teto de segurança de polígonos simultâneos (padrão: `10.000`), priorizando os de maior dimensão para manter 60 FPS.
     - **Carregamento Contínuo (Streaming)**: ative para contornar o limite de 30.000 feições nativo do Power BI, requisitando fatias sucessivas até o **Limite Total de Linhas** configurado (ex: `100.000`).
     - O rodapé do mapa exibe o contador em tempo real: `X exibidos de Y carregados (Carregando...)`.

---

## 🧪 Dados de Teste Disponíveis

1. **[`sample_layers_data.csv`](sample_layers_data.csv) (Recomendado para testar camadas e geometrias variadas)**:
   - Contém 10 regiões brasileiras (São Paulo, Rio de Janeiro, Brasília, Curitiba, Belo Horizonte, Florianópolis, Salvador, Porto Alegre, Manaus, Recife).
   - Tipos de geometrias testadas:
     - **Polígonos Irregulares** (vários vértices, côncavos e convexos).
     - **MultiPolígonos (`MULTIPOLYGON`)** (ilhas e porções separadas, ex: RJ e Florianópolis).
     - **Polígonos com Furo Interno / Donut** (`POLYGON ((exterior), (interior))` - ex: Curitiba).
   - Duas colunas WKT prontas para testar o **Controle de Camadas**:
     - `wkt_camada_principal`: Macrozonas / áreas urbanas principais.
     - `wkt_camada_secundaria`: Zonas de amortecimento / ambientais sobrepostas.

2. **[`sample_data.csv`](sample_data.csv)**:
   - Conjunto inicial simplificado com 5 polígonos na região de Brasília/DF.
