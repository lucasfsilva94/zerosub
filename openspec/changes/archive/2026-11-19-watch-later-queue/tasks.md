# Tasks

## 1. Estado Base, Badge Inteligente e Extração de Metadados

- [x] 1.1 Atualizar `background.js` para incluir `watchLaterVideos: []` em `DEFAULT_STATE`, atualizar `updateActionBadge(pendingCount, enabled, watchLaterCount)` com prioridade vermelho (`pendingCount > 0`) → azul `#1a73e8` (`pendingCount === 0 && watchLaterCount > 0`) → vazio, e escutar mudanças de `watchLaterVideos` no `chrome.storage.onChanged` e `onInstalled`.
- [x] 1.2 Estender `extractVideosFromYtData` em `content/injector.js` para extrair também `title` e `durationText` (nos renderers clássicos e em `lockupViewModel`) e atualizar `inspectCardElement` em `content/content.js` com fallbacks DOM + `thumbnailUrl` determinística (`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`).

## 2. Lógica Pura e Integração da Fila "Ver depois" no Feed

- [x] 2.1 Implementar em `content/content.js` as funções puras `upsertWatchLaterVideo`, `removeWatchLaterVideo`, `removeChannelFromWatchLater` e `getWatchLaterIdSet`, atualizar `evaluateCardVisibility` para ocultar vídeos de `watchLaterVideos` (`reason: 'watch-later'`) separadamente de `dismissedVideos`, garantir preservação em `resetFeedToNow()`, limpar itens do canal em `handleConfirmedUnsubscribe()` e remover automaticamente da fila em `setupWatchProgressTracker()` ao atingir `>= 90%`.
- [x] 2.2 Refatorar `ensureCardActionBar` em `content/content.js` e os estilos em `content/styles.css` para o layout em **grade 2×2** com os 4 botões (`✓ Visto`, `🕒 Ver depois`, `✕ Sem interesse`, `Desinscrever`), incluindo as variáveis de cor azul para "Ver depois" nos temas Claro e Escuro.
- [x] 2.3 Adicionar o botão `Ver depois (N)` na barra superior (`#zerosub-top-toolbar`), o painel expansível `#zerosub-watch-later-panel` (com assinatura `data-zerosub-render-key`, cards com thumbnail, título clicável, duração, canal e ações `Visto`, `Sem interesse` e `Desinscrever` em 2 cliques), atualizar `isZeroSubOwnedNode` e incluir o lembrete/atalho de "Ver depois" no banner de estado vazio Inbox Zero (`ensureEmptyStateBanner`).

## 3. Sincronização da Lista e Contador no Popup Dashboard

- [x] 3.1 Atualizar `popup/popup.html` e `popup/popup.css` para exibir os contadores lado a lado (**Na fila** e **Ver depois**) e a seção dedicada `#watch-later-section` com lista rolável de cards compactos (thumbnail, título clicável, canal e ações `Visto`, `Sem interesse` e `Desinscrever`).
- [x] 3.2 Atualizar `popup/popup.js` com helpers de manipulação de `watchLaterVideos` (`markWatchLaterAsSeenInStorage`, `markWatchLaterNotInterestedInStorage`, `removeChannelFromWatchLaterInStorage`), renderização sincronizada com `chrome.storage.onChanged` e confirmação em 2 cliques no botão "Desinscrever" (delegando via `ZEROSUB_UNSUBSCRIBE_CHANNEL` para a aba do YouTube com fallback local).

## 4. Testes Automatizados e Validação Final

- [x] 4.1 Adicionar testes unitários e de integração em `tests/zerosub.test.js` cobrindo `DEFAULT_STATE` + badge azul de "Ver depois" em `background.js`, extração de `title`/`durationText` em `injector.js`, helpers de `watchLaterVideos`, ocultação `watch-later` em `evaluateCardVisibility`, preservação em reset/restore, remoção por canal, layout 2×2 em `styles.css` e ações de "Ver depois" no `popup.js`.
- [x] 4.2 Executar a suíte completa (`node --test tests/zerosub.test.js`) garantindo que todos os testes novos e existentes passam sem regressões.
