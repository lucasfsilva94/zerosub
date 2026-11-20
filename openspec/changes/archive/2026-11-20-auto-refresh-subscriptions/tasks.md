# Tasks

## 1. Estado Base e Consulta Silenciosa InnerTube

- [x] 1.1 Atualizar `background.js` para incluir `autoRefreshMinutes: 10` em `DEFAULT_STATE` sem sobrescrever preferência existente em atualizações.
- [x] 1.2 Implementar `fetchSubscriptionsFeedMetadata` em `content/injector.js` (POST autenticado para `/youtubei/v1/browse` com `browseId: 'FEsubscriptions'`, reutilizando `SAPISIDHASH` e `extractVideosFromYtData`) e responder à mensagem `CHECK_NEW_VIDEOS` com `CHECK_NEW_VIDEOS_RESULT`.

## 2. Temporizador Inteligente e Feedback Não-Intrusivo no Feed

- [x] 2.1 Implementar em `content/content.js` as funções puras `normalizeAutoRefreshMinutes`, `evaluateRemoteNewVideos` e `decideAutoRefreshAction`, além do bridge `requestMainWorldFeedCheck` e do ciclo `setupAutoRefreshTimer()` (ativo apenas em `/feed/subscriptions` no Modo ZeroSub quando `autoRefreshMinutes > 0`, reagindo a `chrome.storage.onChanged` e `yt-navigate-finish`).
- [x] 2.2 Adicionar em `content/content.js` e `content/styles.css` o botão discreto `+N novo(s) • Atualizar` (`#zerosub-new-videos-btn`) na barra superior quando novos vídeos forem detectados com o usuário ocupado e o status discreto de verificação automática (`#zerosub-empty-auto-refresh-status`) no banner Inbox Zero.

## 3. Seletor de Intervalo no Popup Dashboard

- [x] 3.1 Atualizar `popup/popup.html`, `popup/popup.css` e `popup/popup.js` para incluir o seletor `#select-auto-refresh` (`Desativado`, `5 min`, `10 min`, `15 min`, `30 min`, `1 hora`) na seção Configurações, sincronizando `autoRefreshMinutes` em tempo real com `chrome.storage.local`.

## 4. Testes Automatizados e Validação Final

- [x] 4.1 Adicionar testes unitários em `tests/zerosub.test.js` cobrindo `autoRefreshMinutes` em `background.js`, `fetchSubscriptionsFeedMetadata` em `injector.js`, `normalizeAutoRefreshMinutes` / `evaluateRemoteNewVideos` / `decideAutoRefreshAction` em `content.js` e o controle `#select-auto-refresh` no `popup`.
- [x] 4.2 Executar a suíte completa (`node --test tests/zerosub.test.js`) garantindo que todos os testes novos e existentes passam sem regressões.
