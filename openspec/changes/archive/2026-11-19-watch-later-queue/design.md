# Design

## Context

Consulte `proposal.md` para a motivação e `specs/` para os requisitos comportamentais.
Na arquitetura atual do ZeroSub:
1. `content/injector.js` (MAIN world) extrai `videoId`, `channelId`, `channelHandle`, `channelName`, `publishedTimeText`, `isShort`, `isUpcoming`, `isLive` dos payloads do YouTube (`ytInitialData` e `/youtubei/v1/browse`), mas ainda não extrai `title` nem `durationText`.
2. `content/content.js` (ISOLATED world) mantém `dismissedVideos` (Set de `videoId`), `unsubscribedChannels`, `baselineAnchorIds` e `notInterestedByChannel`, injetando uma barra `.zerosub-card-actions` em linha única (3 botões) por card e um painel expansível `#zerosub-suggestions-panel` abaixo da barra superior `#zerosub-top-toolbar`.
3. `background.js` gerencia `DEFAULT_STATE` e `updateActionBadge(pendingCount, zeroSubEnabled)` para o ícone da extensão.
4. `popup/popup.html` + `popup/popup.js` exibem o contador de pendentes, ações de reset/restauração, seção de sugestões e toggles.

## Goals / Non-Goals

**Goals:**
- Permitir guardar qualquer vídeo do feed em uma fila local **"Ver depois"** (`watchLaterVideos`), limpando-o imediatamente da fila principal sem misturá-lo com `dismissedVideos`.
- Comportar confortavelmente 4 botões em cada card do feed via **grade 2×2** (`Visto` + `Ver depois`; `Sem interesse` + `Desinscrever`).
- Sincronizar em tempo real a lista e os contadores de "Ver depois" entre: barra superior + painel expansível no `/feed/subscriptions`, banner de estado vazio Inbox Zero, Popup Dashboard e badge azul de lembrete no ícone da extensão.
- Reutilizar integralmente a lógica existente de `dismissedVideos`, `notInterestedByChannel` (threshold de 3 vídeos) e InnerTube unsubscribe + fallback para as ações dentro do "Ver depois", além da auto-remoção ao atingir `>= 90%` em `/watch`.

**Non-Goals:**
- Sincronizar com a playlist nativa "Assistir mais tarde" (`WL`) do YouTube via API privada (evita acoplamento com tokens de playlist e mantém a fila de triagem do ZeroSub separada do backlog nativo do usuário).
- Reordenar manualmente itens por drag-and-drop na lista "Ver depois" nesta primeira entrega (ordenação cronológica inversa por `savedAt` — mais recentemente salvo no topo).

## Decisions

### 1. Modelo de Dados de `watchLaterVideos` em `chrome.storage.local`
- **Decisão**:
  - Adicionar `watchLaterVideos: []` em `DEFAULT_STATE` (`background.js`), preservando dados existentes em atualizações.
  - Cada item armazenado tem formato plano e compacto (~350 bytes):
    ```json
    {
      "videoId": "dQw4w9WgXcQ",
      "title": "Título do Vídeo",
      "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      "durationText": "12:34",
      "channelId": "UC_abc123",
      "channelHandle": "/@canal",
      "channelKey": "UC_abc123",
      "channelName": "Nome do Canal",
      "publishedTimestamp": 1763590000000,
      "savedAt": 1763593600000
    }
    ```
  - Funções puras exportadas em `content/content.js` (e espelhadas/reutilizadas em `popup/popup.js` onde aplicável):
    - `upsertWatchLaterVideo(currentList, videoInfo, now, maxItems = 500)`: deduplica por `videoId`, atualiza `savedAt`, posiciona o mais recente no topo e limita o tamanho máximo (500 itens, < 250 KB no storage).
    - `removeWatchLaterVideo(currentList, videoId)`: remove um item pelo `videoId`.
    - `removeChannelFromWatchLater(currentList, { channelKey, channelId, channelHandle })`: remove todos os vídeos pertencentes a um canal desinscrito.
- **Extração de `title`, `thumbnailUrl` e `durationText`**:
  - Em `content/injector.js` (`extractVideosFromYtData`), extrair também `title` (`videoRenderer.title` ou `lockup.metadata.lockupMetadataViewModel.title`) e `durationText` (`videoRenderer.lengthText` ou overlay de tempo do `lockupViewModel`).
  - Em `content/content.js` (`inspectCardElement`), ler `title` do DOM (`a#video-title`, `#video-title`, `a.yt-lockup-metadata-view-model__title`, `h3 a`, fallback para cache ou `Vídeo ${videoId}`), `durationText` (`ytd-thumbnail-overlay-time-status-renderer`, `badge-shape .yt-badge-shape__text` com padrão `\d+:\d+`) e gerar `thumbnailUrl` determinística `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` (evita falhas de `src` vazio por lazy-loading de `<img>` do YouTube).
- **Alternativas consideradas**:
  - *Armazenar apenas `videoId` e tentar re-extrair do DOM*: Inviável porque após o corte cronológico ou dias depois, o vídeo não existe mais no DOM de `/feed/subscriptions`.

### 2. Separação entre `watchLaterVideos` e `dismissedVideos`
- **Decisão**:
  - Em `evaluateCardVisibility(cardMeta, state)`, aceitar `state.watchLaterVideos` (Set de `videoId`, array de strings ou array de objetos `{ videoId }`) e ocultar com `{ hidden: true, reason: 'watch-later' }` quando `zeroSubEnabled === true`.
  - Em `resetFeedToNow()`, ao varrer os cards do topo, **não** adicionar a `dismissedVideos` nem apagar itens que já estejam em `watchLaterVideos`; apenas atualizar `installTimestamp` e `baselineAnchorIds`.
  - Em `setupWatchProgressTracker()` (`/watch` com `>= 90%`), verificar se `currentVideoId` está em `watchLaterVideos` (mesmo que já estivesse ou não em `dismissedVideos`): se estiver, removê-lo de `watchLaterVideos` e gravar junto com `dismissedVideos` em uma única escrita de `chrome.storage.local.set(...)`.
- **Benefício**: "Restaurar vídeos ocultos" (que limpa apenas `dismissedVideos`) e "Zerar Feed Agora" nunca destroem a fila de "Ver depois".

### 3. Layout Grade 2×2 nos Cards do Feed e Painel Expansível no Topo
- **Decisão**:
  - Em `content/styles.css`, alterar `.zerosub-card-actions` para `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;`.
  - Ordem dos botões no DOM do card:
    1. `✓ Visto` (`.zerosub-btn-seen`, verde)
    2. `🕒 Ver depois` (`.zerosub-btn-watch-later`, azul — novas CSS vars `--zerosub-watch-later-bg`, `--zerosub-watch-later-text`, `--zerosub-watch-later-hover` adaptadas a Light e Dark mode)
    3. `✕ Sem interesse` (`.zerosub-btn-not-interested`, laranja)
    4. `Desinscrever` (`.zerosub-btn-unsub`, neutro → vermelho `Confirmar?` em 2 cliques)
  - Na barra superior `#zerosub-top-toolbar`, adicionar o botão `#zerosub-watch-later-toggle-btn` (`Ver depois (N)`, estilizado em azul) à esquerda de `Sugestões (N)`.
  - Painel `#zerosub-watch-later-panel` renderizado logo abaixo de `#zerosub-top-toolbar` (e incluído em `isZeroSubOwnedNode` para não disparar loop no `MutationObserver`), usando uma grade responsiva (`grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`) de mini-cards com thumbnail 16:9 + badge de duração, título com link `/watch?v=...`, nome do canal e barra de 3 botões em linha única (`✓ Visto`, `✕ Sem interesse`, `Desinscrever` com confirmação em 2 cliques).
  - No banner de estado vazio `#zerosub-empty-state`, quando `watchLaterVideos.length > 0`, exibir texto informativo ("Você ainda tem N vídeo(s) salvo(s) em Ver depois") e botão `#zerosub-empty-watch-later-btn` que abre `#zerosub-watch-later-panel` e rola suavemente até ele.

### 4. Popup Dashboard e Badge Inteligente em `background.js`
- **Decisão**:
  - Em `popup/popup.html` + `popup/popup.css`:
    - Substituir o `.counter-card` único por um grid de 2 colunas `.counters-grid`: **Na fila** (`#pending-count`) e **Ver depois** (`#watch-later-count`, destaque azul).
    - Adicionar a seção `#watch-later-section` (visível quando `watchLaterVideos.length > 0`) com lista rolável (`max-height: 220px`) exibindo cada vídeo (miniatura compacta 80×45, título clicável que abre `https://www.youtube.com/watch?v=<videoId>` em nova aba, nome do canal e linha compacta com botões `✓ Visto`, `✕ Sem interesse`, `Desinscrever` com confirmação em 2 cliques via `createTwoStepConfirmation`).
    - Em `popup/popup.js`, implementar handlers sincronizados que atualizam `chrome.storage.local` (`watchLaterVideos`, `dismissedVideos`, `notInterestedByChannel`, `unsubscribedChannels`) e delegam `ZEROSUB_UNSUBSCRIBE_CHANNEL` à aba do YouTube quando disponível (com fallback local idêntico ao de Sugestões).
  - Em `background.js`:
    - Atualizar assinatura de `updateActionBadge(pendingCount, enabled = true, watchLaterCount = 0)` mantendo retrocompatibilidade para chamadas com 2 argumentos.
    - Prioridade do badge:
      1. `!enabled` → texto `'OFF'`, cor `'#717171'`
      2. `pendingCount > 0` → texto `pendingCount` (`99+`), cor `'#cc0000'`
      3. `watchLaterCount > 0` → texto `watchLaterCount` (`99+`), cor `'#1a73e8'`
      4. caso contrário → texto `''`
    - Atualizar o listener `chrome.storage.onChanged` e `onInstalled` em `background.js` para observar também mudanças em `watchLaterVideos`.

## Risks / Trade-offs

- **[Duplicação de helpers entre `content/content.js` e `popup/popup.js`]** → Mitigação: Manter funções puras pequenas e coesas com a mesma semântica (como já feito com `getPopupSuggestions` / `keepChannelInStorage`) e cobrir ambas com testes unitários em `tests/zerosub.test.js` para garantir paridade.
- **[Altura do Popup com lista longa de "Ver depois" + "Sugestões"]** → Mitigação: Aplicar `max-height` com `overflow-y: auto` na lista `#watch-later-list` e cards compactos de 2 linhas para manter o popup ágil e sem estourar a viewport do Chrome.
- **[Re-render do painel `#zerosub-watch-later-panel` interrompendo confirmação de 2 cliques em "Desinscrever"]** → Mitigação: Usar assinatura `data-zerosub-render-key` baseada na lista de `videoId`s (mesmo padrão já adotado em `renderSuggestionsPanel`) para nunca destruir/recriar os botões quando a lista não mudou.
- **[Extração de título/duração em variações do DOM do YouTube (`yt-lockup-view-model` vs `ytd-rich-grid-media`)]** → Mitigação: Combinar dados estruturados de `injector.js` (MAIN world) com múltiplos seletores DOM de fallback e thumbnail determinística `i.ytimg.com/vi/<id>/mqdefault.jpg`.
