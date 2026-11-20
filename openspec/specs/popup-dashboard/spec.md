# popup-dashboard Specification

## Purpose

Fornece um painel rápido no popup da extensão para acompanhar a quantidade de vídeos pendentes na fila de inscrições, redefinir o marco zero, restaurar vídeos dispensados e ajustar as preferências de filtragem.

## Requirements

### Requirement: Exibição de contador de vídeos pendentes
O sistema SHALL exibir no popup da extensão o número atualizado de vídeos pendentes visíveis na fila atual de inscrições ao lado do contador de vídeos salvos em "Ver depois".

#### Scenario: Abertura do popup com fila ativa
- **WHEN** o usuário abre o popup da extensão enquanto possui vídeos pendentes no feed de inscrições e/ou vídeos salvos em `watchLaterVideos`
- **THEN** o popup apresenta o contador de vídeos pendentes na fila atual e o contador correspondente à quantidade de vídeos salvos em "Ver depois"

### Requirement: Ação de zerar fila pelo popup
O sistema SHALL disponibilizar no popup o botão "Zerar tudo agora" que atualiza `installTimestamp` para o momento atual e zera a fila pendente.

#### Scenario: Clicar em Zerar tudo agora no popup
- **WHEN** o usuário clica em "Zerar tudo agora" no popup da extensão
- **THEN** o sistema define `installTimestamp` para `Date.now()`, atualiza o contador de pendentes para zero e notifica as abas abertas de `/feed/subscriptions` para ocultarem os vídeos anteriores

### Requirement: Restauração de vídeos ocultados manualmente
O sistema SHALL disponibilizar no popup o botão "Restaurar vídeos ocultos" para limpar a lista `dismissedVideos` e reexibir no feed os vídeos que foram marcados como vistos por engano.

#### Scenario: Clicar em Restaurar vídeos ocultos
- **WHEN** o usuário clica em "Restaurar vídeos ocultos" no popup da extensão
- **THEN** o sistema limpa a coleção `dismissedVideos` no armazenamento e reexibe imediatamente no feed os vídeos posteriores a `installTimestamp` que haviam sido dispensados

### Requirement: Controles de configuração no popup
O sistema SHALL permitir ao usuário ativar ou desativar o Modo ZeroSub, o filtro de YouTube Shorts, o filtro de transmissões agendadas e a marcação automática ao assistir >90%, sincronizando as alterações em tempo real com a aba do YouTube.

#### Scenario: Alteração de toggle de configuração no popup
- **WHEN** o usuário altera qualquer opção de configuração no popup
- **THEN** o sistema persiste o novo estado no armazenamento local e atualiza imediatamente a filtragem na aba `/feed/subscriptions` aberta

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
