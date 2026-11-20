# Spec Delta

## MODIFIED Requirements

### Requirement: Exibição de contador de vídeos pendentes
O sistema SHALL exibir no popup da extensão o número atualizado de vídeos pendentes visíveis na fila atual de inscrições ao lado do contador de vídeos salvos em "Ver depois".

#### Scenario: Abertura do popup com fila ativa
- **WHEN** o usuário abre o popup da extensão enquanto possui vídeos pendentes no feed de inscrições e/ou vídeos salvos em `watchLaterVideos`
- **THEN** o popup apresenta o contador de vídeos pendentes na fila atual e o contador correspondente à quantidade de vídeos salvos em "Ver depois"

## ADDED Requirements

### Requirement: Lista de vídeos salvos em Ver depois no popup
O sistema SHALL exibir no popup da extensão uma seção dedicada listando os vídeos armazenados em `watchLaterVideos` (quando houver ao menos um item), com thumbnail, título clicável para abrir o vídeo no YouTube, nome do canal e botões "Visto", "Sem interesse" e "Desinscrever" (com confirmação em duas etapas).

#### Scenario: Exibir lista Ver depois no popup quando existirem vídeos salvos
- **WHEN** o usuário abre o popup da extensão e `watchLaterVideos` contém um ou mais itens
- **THEN** o popup exibe a seção "Ver depois" com badge numérico e lista rolável contendo cada vídeo salvo com link para assistir e os botões "Visto", "Sem interesse" e "Desinscrever"

#### Scenario: Marcar vídeo como Visto pelo popup
- **WHEN** o usuário clica em "Visto" em um item da lista "Ver depois" no popup
- **THEN** o sistema remove o vídeo de `watchLaterVideos`, adiciona o `videoId` a `dismissedVideos` e atualiza em tempo real tanto o popup quanto a aba `/feed/subscriptions`

#### Scenario: Marcar vídeo como Sem interesse pelo popup
- **WHEN** o usuário clica em "Sem interesse" em um item da lista "Ver depois" no popup
- **THEN** o sistema remove o vídeo de `watchLaterVideos`, adiciona o `videoId` a `dismissedVideos` e incrementa `notInterestedByChannel` para o canal (atualizando Sugestões caso atinja 3 vídeos distintos)

#### Scenario: Desinscrever canal pelo popup a partir de Ver depois
- **WHEN** o usuário confirma a desinscrição em duas etapas ("Desinscrever" -> "Confirmar?") em um item da lista "Ver depois" no popup
- **THEN** o sistema aciona o cancelamento da inscrição na aba ativa do YouTube (ou registra o canal como desinscrito com fallback), remove todos os vídeos daquele canal de `watchLaterVideos` e atualiza o popup e o feed
