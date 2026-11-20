# Spec Delta

## ADDED Requirements

### Requirement: Ocultação de vídeos salvos em Ver depois na fila principal
O sistema SHALL ocultar da fila principal em `/feed/subscriptions` os cards cujo `videoId` esteja presente em `watchLaterVideos` enquanto o Modo ZeroSub estiver ativo, mantendo essa coleção separada de `dismissedVideos`.

#### Scenario: Vídeo presente em Ver depois no Modo ZeroSub
- **WHEN** o Modo ZeroSub está ativo e um card carregado em `/feed/subscriptions` possui `videoId` listado em `watchLaterVideos`
- **THEN** o sistema oculta o card da fila principal com motivo `watch-later` e não o contabiliza em `pendingCount`

#### Scenario: Alternar para Mostrar todos com vídeos em Ver depois
- **WHEN** o usuário alterna para "Mostrar todos" (`zeroSubEnabled === false`)
- **THEN** o sistema volta a exibir o feed completo normalmente sem apagar os itens armazenados em `watchLaterVideos`

## MODIFIED Requirements

### Requirement: Redefinição manual do marco zero
O sistema SHALL permitir ao usuário redefinir o `installTimestamp` para o momento atual através da ação "Zerar Feed Agora" no topo do feed ou no popup, gravando também os identificadores dos vídeos do topo como âncoras de corte (`baselineAnchorIds`) para impedir o retorno de vídeos antigos, preservando intactos os vídeos salvos em `watchLaterVideos`.

#### Scenario: Acionar Zerar Feed Agora
- **WHEN** o usuário aciona "Zerar Feed Agora"
- **THEN** o sistema atualiza `installTimestamp` para `Date.now()`, registra os vídeos atuais do topo em `baselineAnchorIds`, oculta imediatamente todos os vídeos existentes no feed e preserva todos os itens atualmente armazenados em `watchLaterVideos`

### Requirement: Estado vazio Inbox Zero com verificação manual de novos vídeos
O sistema SHALL exibir um painel de estado vazio "Inbox Zero" na página `/feed/subscriptions` quando não houver vídeos pendentes no Modo ZeroSub, oferecendo um botão "Verificar novos vídeos" e, caso existam itens em `watchLaterVideos`, um lembrete com atalho direto para abrir a lista "Ver depois".

#### Scenario: Fila completamente zerada no Modo ZeroSub
- **WHEN** todos os vídeos da fila são dispensados ou o usuário aciona "Zerar Feed Agora" e restam zero vídeos pendentes e zero itens em `watchLaterVideos`
- **THEN** o sistema exibe o banner de estado vazio Inbox Zero informando o horário do marco zero e disponibilizando o botão "Verificar novos vídeos"

#### Scenario: Fila principal zerada com vídeos pendentes em Ver depois
- **WHEN** restam zero vídeos pendentes na fila principal no Modo ZeroSub e existem um ou mais itens em `watchLaterVideos`
- **THEN** o banner de estado vazio Inbox Zero informa a quantidade de vídeos guardados em "Ver depois" e exibe um botão de atalho para abrir o painel `#zerosub-watch-later-panel`

#### Scenario: Acionar Verificar novos vídeos
- **WHEN** o usuário clica em "Verificar novos vídeos" no banner de estado vazio
- **THEN** o sistema recarrega a aba de inscrições para buscar novos vídeos publicados acima do marco zero
