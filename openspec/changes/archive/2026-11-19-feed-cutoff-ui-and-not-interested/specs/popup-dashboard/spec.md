# Spec Delta

## ADDED Requirements

### Requirement: Lista de canais sugeridos para desinscrição no popup
O sistema SHALL exibir no popup da extensão uma seção dedicada listando os canais que atingiram 3 ou mais vídeos diferentes marcados como "Sem interesse", com botões para "Desinscrever" ou "Manter canal".

#### Scenario: Exibir sugestões no popup quando existirem canais elegíveis
- **WHEN** o usuário abre o popup da extensão e há um ou mais canais com pelo menos 3 vídeos distintos marcados como "Sem interesse"
- **THEN** o popup exibe a seção de sugestões listando o nome de cada canal, a contagem de vídeos sem interesse e os botões "Desinscrever" e "Manter canal"

#### Scenario: Manter canal pelo popup
- **WHEN** o usuário clica em "Manter canal" em um item da lista de sugestões no popup
- **THEN** o sistema zera o registro de desinteresse daquele canal no armazenamento local e remove o canal da lista tanto no popup quanto na barra superior do feed

#### Scenario: Desinscrever canal pelo popup
- **WHEN** o usuário clica em "Desinscrever" em um item da lista de sugestões no popup
- **THEN** o sistema aciona o cancelamento da inscrição na aba ativa do YouTube (ou registra o canal como desinscrito com fallback), remove o canal da lista de sugestões e oculta seus cards no feed
