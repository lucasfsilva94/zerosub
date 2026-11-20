# watch-later-queue Specification

## Purpose
TBD - created by archiving change watch-later-queue. Update Purpose after archive.

## Requirements

### Requirement: Salvar vídeo na fila Ver depois a partir do feed
O sistema SHALL permitir ao usuário clicar no botão "Ver depois" de um card em `/feed/subscriptions` para salvar um snapshot de metadados do vídeo em `watchLaterVideos` (deduplicado por `videoId`), removendo o card da fila principal com transição suave sem adicioná-lo a `dismissedVideos`.

#### Scenario: Clicar em Ver depois em um card do feed
- **WHEN** o usuário clica no botão "Ver depois" em um card de vídeo no feed `/feed/subscriptions`
- **THEN** o sistema persiste os metadados do vídeo (`videoId`, `title`, `thumbnailUrl`, `durationText`, `channelId`, `channelHandle`, `channelKey`, `channelName`, `publishedTimestamp`, `savedAt`) em `watchLaterVideos` sem duplicar o mesmo `videoId`, anima e oculta o card do feed principal e incrementa o contador de "Ver depois"

#### Scenario: Preservação ao restaurar vídeos ocultos ou zerar o feed
- **WHEN** o usuário aciona "Restaurar vídeos ocultos" ou "Zerar Feed Agora"
- **THEN** os vídeos salvos em `watchLaterVideos` permanecem preservados na lista "Ver depois" e continuam ocultos da fila principal enquanto o Modo ZeroSub estiver ativo

### Requirement: Painel expansível e contador de Ver depois no topo do feed
O sistema SHALL exibir um botão com contador `Ver depois (N)` na barra superior do ZeroSub em `/feed/subscriptions` que alterna um painel expansível listando os vídeos salvos com thumbnail, título clicável para assistir, duração (quando disponível), nome do canal e botões de ação "Visto", "Sem interesse" e "Desinscrever".

#### Scenario: Abrir painel Ver depois na barra superior do feed
- **WHEN** existem um ou mais vídeos salvos em `watchLaterVideos` e o usuário clica em `Ver depois (N)` na barra superior do feed
- **THEN** o sistema expande o painel `#zerosub-watch-later-panel` exibindo cada vídeo salvo com link direto para `/watch?v=<videoId>` e os botões "Visto", "Sem interesse" e "Desinscrever"

#### Scenario: Ocultar botão e painel quando não há itens salvos
- **WHEN** o último vídeo é removido de `watchLaterVideos`
- **THEN** o sistema fecha automaticamente o painel `#zerosub-watch-later-panel` e atualiza/oculta o indicador de contador na barra superior

### Requirement: Ações de triagem nos itens da fila Ver depois
O sistema SHALL disponibilizar em cada vídeo listado em "Ver depois" (tanto no feed quanto no popup) as ações "Visto", "Sem interesse" e "Desinscrever" (com confirmação rápida em duas etapas), mantendo o estado sincronizado entre feed e popup.

#### Scenario: Marcar vídeo de Ver depois como Visto
- **WHEN** o usuário clica em "Visto" em um vídeo da lista "Ver depois"
- **THEN** o sistema remove o vídeo de `watchLaterVideos`, adiciona o `videoId` a `dismissedVideos` e atualiza os contadores no feed, no popup e no badge

#### Scenario: Marcar vídeo de Ver depois como Sem interesse
- **WHEN** o usuário clica em "Sem interesse" em um vídeo da lista "Ver depois"
- **THEN** o sistema remove o vídeo de `watchLaterVideos`, adiciona o `videoId` a `dismissedVideos` e registra o `videoId` no contador deduplicado por canal (`notInterestedByChannel`), incluindo o canal em Sugestões caso atinja 3 vídeos distintos

#### Scenario: Desinscrever canal a partir de um vídeo em Ver depois
- **WHEN** o usuário clica duas vezes em "Desinscrever" -> "Confirmar?" em um vídeo da lista "Ver depois"
- **THEN** o sistema cancela a inscrição do canal via InnerTube (ou fallback), adiciona o canal a `unsubscribedChannels`, remove todos os vídeos desse canal tanto do feed quanto de `watchLaterVideos` e limpa eventuais entradas do canal em `notInterestedByChannel`

### Requirement: Remoção automática de Ver depois ao assistir vídeo
O sistema SHALL remover automaticamente um vídeo de `watchLaterVideos` quando o usuário assistir a pelo menos 90% da duração em `/watch` e a opção de marcação automática estiver ativa.

#### Scenario: Vídeo salvo em Ver depois atinge 90% de reprodução
- **WHEN** o usuário assiste a um vídeo presente em `watchLaterVideos` e o progresso de reprodução atinge ou ultrapassa 90% da duração total com `autoMarkWatched` ativo
- **THEN** o sistema remove o `videoId` de `watchLaterVideos`, registra o `videoId` em `dismissedVideos` e atualiza o contador de "Ver depois" e o badge da extensão

### Requirement: Badge de lembrete no ícone da extensão para Ver depois
O sistema SHALL exibir no badge do ícone da extensão a contagem de vídeos em `watchLaterVideos` na cor azul (`#1a73e8`) quando o Modo ZeroSub estiver ativo, a fila principal estiver zerada (`pendingCount === 0`) e houver ao menos um vídeo salvo em "Ver depois".

#### Scenario: Fila principal com vídeos pendentes tem prioridade no badge
- **WHEN** o Modo ZeroSub está ativo e `pendingCount > 0`, mesmo existindo itens em `watchLaterVideos`
- **THEN** o badge da extensão exibe `pendingCount` (com limite `99+`) na cor vermelha (`#cc0000`)

#### Scenario: Fila principal zerada com vídeos salvos em Ver depois
- **WHEN** o Modo ZeroSub está ativo, `pendingCount === 0` e `watchLaterVideos.length > 0`
- **THEN** o badge da extensão exibe a quantidade de itens em `watchLaterVideos` (com limite `99+`) na cor azul (`#1a73e8`)

#### Scenario: Fila principal e Ver depois vazios
- **WHEN** o Modo ZeroSub está ativo, `pendingCount === 0` e `watchLaterVideos.length === 0`
- **THEN** o badge da extensão permanece vazio
