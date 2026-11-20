# Design

## Context

Consulte `proposal.md` para a motivação e `specs/` para os requisitos comportamentais.
Na arquitetura atual do ZeroSub:
1. `content/injector.js` (MAIN world) já possui `generateSapisidHashHeader`, `getCookieValue`, acesso a `window.ytcfg` (`INNERTUBE_API_KEY`, `INNERTUBE_CONTEXT`, `SESSION_INDEX`) e `extractVideosFromYtData()`.
2. `content/content.js` (ISOLATED world) já se comunica via `window.postMessage` com `injector.js` (padrão `requestId` com timeout, como em `UNSUBSCRIBE_CHANNEL` / `UNSUBSCRIBE_RESULT`) e centraliza todas as regras de filtragem em `evaluateFeedItems()`.
3. `popup/popup.html` e `popup/popup.js` já sincronizam preferências em tempo real com `content/content.js` via `chrome.storage.local` e `chrome.storage.onChanged`.

## Goals / Non-Goals

**Goals:**
- Verificar periodicamente se existem vídeos novos no feed `/feed/subscriptions` sem recarregar a página à toa quando não há novidades.
- Oferecer intervalos configuráveis no Popup: `Desativado (0)`, `5`, `10`, `15`, `30` e `60` minutos (padrão `10`).
- Nunca interromper o usuário durante triagem ativa, confirmação de desinscrição ou navegação dentro dos painéis expansíveis (`Ver depois` / `Sugestões`).
- Manter zero novas permissões no `manifest.json` e 100% da lógica de decisão testável em funções puras.

**Non-Goals:**
- Executar polling em background quando nenhuma aba `/feed/subscriptions` está aberta (exigiria permissões extras `alarms` + `cookies` e replicação de sessão InnerTube fora da página).

## Decisions

### 1. Chave de Configuração `autoRefreshMinutes`
- **Decisão**:
  - Adicionar `autoRefreshMinutes: 10` em `DEFAULT_STATE` (`background.js`), com lista de valores válidos `[0, 5, 10, 15, 30, 60]` (onde `0` = Desativado).
  - Função pura `normalizeAutoRefreshMinutes(value)` em `content/content.js` e `popup/popup.js` garante fallback seguro para `10` se `undefined` e `0` se negativo/inválido.

### 2. Consulta Silenciosa InnerTube em `content/injector.js`
- **Decisão**:
  - Extrair um helper interno (ou reutilizar lógica de headers SAPISIDHASH) para `fetchSubscriptionsFeedMetadata(options)` que faz `POST ${origin}/youtubei/v1/browse?key=${apiKey}&prettyPrint=false` com corpo `{ context, browseId: 'FEsubscriptions' }`, `credentials: 'include'` e headers `Authorization: SAPISIDHASH ...`, `X-Origin`, `X-Goog-AuthUser`.
  - Ao receber resposta `ok`, aplica `extractVideosFromYtData(jsonData)` e retorna `{ ok: true, items }`. Em falha (rede, HTTP não-2xx, cookie/ytcfg ausente), retorna `{ ok: false, items: [], error }`.
  - No listener `window.addEventListener('message')` do `injector.js`, responder a `type: 'CHECK_NEW_VIDEOS'` emitindo `type: 'CHECK_NEW_VIDEOS_RESULT'` com o mesmo `requestId`.

### 3. Decisão Não-Intrusiva de Atualização em `content/content.js`
- **Decisão**:
  - Função pura `evaluateRemoteNewVideos(remoteItems, knownDomVideoIds, state, nowMs)`:
    - Converte cada item remoto para `cardMeta` usando `parseRelativeTime(item.publishedTimeText, nowMs)`.
    - Executa `evaluateFeedItems(cardsMeta, state)` com o estado atual do ZeroSub (`installTimestamp`, `baselineAnchorIds`, `dismissedVideos`, `watchLaterVideos`, `unsubscribedChannels`, `hideShorts`, `hideScheduledLives`).
    - Calcula `totalRemotePending = result.visibleCount` e `newlyArrivedCount` (quantidade de itens visíveis cujo `videoId` ainda não está em `knownDomVideoIds`).
  - Função pura `decideAutoRefreshAction({ remoteCheckOk, newlyArrivedCount, currentPendingCount, watchLaterPanelOpen, suggestionsPanelOpen, hasActiveConfirmation })`:
    - `isBusy = currentPendingCount > 0 || watchLaterPanelOpen || suggestionsPanelOpen || hasActiveConfirmation`.
    - Se `!remoteCheckOk`: retorna `{ action: isBusy ? 'none' : 'reload-fallback', newCount: 0 }`.
    - Se `newlyArrivedCount <= 0`: retorna `{ action: 'none', newCount: 0 }`.
    - Se `newlyArrivedCount > 0 && !isBusy`: retorna `{ action: 'auto-reload', newCount: newlyArrivedCount }`.
    - Se `newlyArrivedCount > 0 && isBusy`: retorna `{ action: 'notify-banner', newCount: newlyArrivedCount }`.
  - **Comportamento no DOM**:
    - `auto-reload` / `reload-fallback`: atualiza `pendingCount` (quando conhecido) e aciona `window.location.reload()`.
    - `notify-banner`: exibe na barra superior `#zerosub-top-toolbar` o botão `#zerosub-new-videos-btn` (`+N novo(s) • Atualizar`, em destaque verde/azul) que ao clicar recarrega a aba; atualiza `pendingCount` no `chrome.storage.local` para `currentPendingCount + newlyArrivedCount` acendendo imediatamente o badge vermelho do ícone.
    - `none`: registra `runtimeState.lastAutoCheckAt = Date.now()` e atualiza o texto discreto `#zerosub-empty-auto-refresh-status` no banner Inbox Zero (`Verificação automática a cada X min • Última às HH:MM`).
  - **Ciclo do Timer (`setupAutoRefreshTimer`)**:
    - Sempre limpa o `setInterval` anterior antes de criar novo.
    - Só cria `setInterval` se `isSubscriptionsPage() && runtimeState.zeroSubEnabled && runtimeState.autoRefreshMinutes > 0`.
    - Reage imediatamente a `chrome.storage.onChanged` (`autoRefreshMinutes`, `zeroSubEnabled`) e `yt-navigate-finish`.

### 4. Seletor de Intervalo no Popup Dashboard
- **Decisão**:
  - Adicionar em `popup/popup.html` (dentro de `.settings-section`) uma linha `.select-row` com `<select id="select-auto-refresh">` contendo as opções `0`, `5`, `10`, `15`, `30`, `60`.
  - Estilizar `.select-row` e `.select-input` em `popup/popup.css` seguindo o tema dark minimalista existente.
  - Em `popup/popup.js`, vincular `change` para salvar `{ autoRefreshMinutes: Number(selectEl.value) }` em `chrome.storage.local` e sincronizar em `refreshUI()`.

## Risks / Trade-offs

- **[Throttling de timers em abas em segundo plano no Chrome]** → Mitigação: Chrome limita `setInterval` de abas em background para no mínimo 1 minuto; como nosso menor intervalo é 5 minutos, o disparo ocorre no horário esperado sem exigir `chrome.alarms`.
- **[Formato de resposta do `FEsubscriptions` variar ou retornar erro temporário]** → Mitigação: `extractVideosFromYtData` já suporta renderers clássicos e `lockupViewModel`; em erro HTTP/rede, o fallback só recarrega quando a fila está vazia e ociosa, nunca interrompendo o usuário.
- **[Re-disparo concorrente de verificações]** → Mitigação: Flag `autoRefreshInFlight` impede requisições sobrepostas caso uma checagem anterior ainda esteja pendente.
