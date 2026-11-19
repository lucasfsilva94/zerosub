# Design

## Context

Consulte `proposal.md` para a motivação e `specs/` para os requisitos comportamentais.
Na implementação atual (`content/content.js` e `content/styles.css`):
1. Ao ocultar cards com `display: none`, o container `ytd-rich-grid-renderer` reduz de altura e traz o `ytd-continuation-item-renderer` imediatamente para a viewport, disparando infinite scroll de vídeos antigos; além disso, cards com `publishedTimestamp === null` escapam do filtro.
2. `.zerosub-card-actions` é anexado dentro de `#dismissible`, onde overlays de pré-visualização e layouts flex/grid do YouTube (`yt-lockup-view-model` / `ytd-rich-grid-media`) podem sobrepor ou esconder os botões atrás da thumbnail.
3. Os cards hoje possuem apenas 2 ações ("Visto" e "Desinscrever"), sem sinalização intermediária de desinteresse por canal.

## Goals / Non-Goals

**Goals:**
- Garantir que "Zerar Feed Agora" zere 100% da fila de forma definitiva e impeça o YouTube de buscar páginas antigas via infinite scroll no Modo ZeroSub.
- Tornar os 3 botões de triagem (`✓ Visto`, `✕ Sem interesse`, `Desinscrever`) inequivocamente visíveis, clicáveis e associados ao respectivo card em uma única linha abaixo dos metadados.
- Rastrear desinteresse por canal (deduplicado por `videoId`) e sincronizar a lista de sugestões (`>= 3` vídeos diferentes) entre o painel expansível na barra do topo do feed e o popup da extensão.

**Non-Goals:**
- Interceptar ou bloquear chamadas de rede de paginação no `MAIN` world (ocultar `ytd-continuation-item-renderer` no DOM já impede o IntersectionObserver nativo do YouTube de disparar novas páginas, sem quebrar o botão "Mostrar todos").

## Decisions

### 1. Corte Cronológico com Âncora de Topo (`baselineAnchorIds`) + Ocultação de `ytd-continuation-item-renderer`
- **Decisão**:
  - Ao executar `resetFeedToNow()`, capturar os `videoId` dos primeiros até 30 cards atualmente no topo do feed (mesmo se já estiverem ocultos por filtros) e persistir em `baselineAnchorIds` junto com `installTimestamp = Date.now()`.
  - Em `processSubscriptionsFeed()`, percorrer os cards na ordem DOM (do topo para baixo) mantendo uma flag `cutoffReached = false`:
    - Se o `videoId` estiver em `baselineAnchorIds` OU `publishedTimestamp < installTimestamp`, marcar `cutoffReached = true` e ocultar o card.
    - Uma vez `cutoffReached === true`, **todos** os cards seguintes são ocultados automaticamente (`reason: 'after-cutoff'`), mesmo que `publishedTimestamp` seja `null`.
  - Sempre que `zeroSubEnabled` estiver ativo e (`cutoffReached === true` OU `visibleCount === 0` com `baselineAnchorIds.length > 0`), adicionar `.zerosub-hidden` em todos os `ytd-continuation-item-renderer` dentro de `ytd-browse[page-subtype="subscriptions"]`. Quando o usuário alternar para "Mostrar todos" (`zeroSubEnabled === false`), remover `.zerosub-hidden` do continuation para restaurar a rolagem normal.
  - Exibir o banner `#zerosub-empty-state` ("Tudo limpo! Nenhum vídeo novo desde ...") quando `zeroSubEnabled && visibleCount === 0`, contendo o botão **"Verificar novos vídeos"** (que aciona `window.location.reload()`).
- **Alternativas consideradas**:
  - *Bloquear `window.fetch` de `/youtubei/v1/browse` com continuation token*: Arriscado porque quebra o modo "Mostrar todos" e pode deixar o spinner do YouTube travado girando indefinidamente.

### 2. Posicionamento Seguro e Destaque Visual dos Cards
- **Decisão**:
  - Anexar `.zerosub-card-actions` como último elemento do card (`ytd-rich-item-renderer` ou `ytd-grid-video-renderer` diretamente, ou no container `#content` abaixo de `ytd-rich-grid-media` / `yt-lockup-view-model`), garantindo `display: flex; flex-direction: column;` no card wrapper visível (`.zerosub-card-managed`).
  - Aplicar contorno/cartão sutil (`border: 1px solid var(--zerosub-border); border-radius: 12px; padding: 8px;`) no card gerenciado para deixar visualmente claro qual barra pertence a qual vídeo, com `position: relative; z-index: 3;` na barra de ações e layout de linha única (`flex-wrap: nowrap`) com 3 botões proporcionais (`✓ Visto`, `✕ Sem interesse`, `Desinscrever`).
- **Alternativas consideradas**:
  - *Overlay flutuante sobre a thumbnail*: Conflita com o preview de vídeo no hover do YouTube e cobre informações da capa.

### 3. Modelo de Dados e Fluxo de "Não tenho interesse" -> Sugestões de Desinscrição
- **Decisão**:
  - Persistir em `chrome.storage.local` a chave `notInterestedByChannel`:
    ```json
    {
      "UC_abc123": {
        "channelKey": "UC_abc123",
        "channelId": "UC_abc123",
        "channelHandle": "/@canal",
        "channelName": "Nome do Canal",
        "videoIds": ["vid1", "vid2", "vid3"],
        "updatedAt": 1763590000000
      }
    }
    ```
  - Função pura `recordNotInterestedVideo(map, { channelKey, channelId, channelHandle, channelName, videoId })` deduplica `videoIds` por canal e retorna `{ updatedMap, count, reachedThreshold }` (`threshold = 3`).
  - Função pura `getUnsubscribeSuggestions(map, unsubscribedChannels, threshold = 3)` retorna a lista ordenada de canais com `videoIds.length >= 3` que ainda não estão em `unsubscribedChannels`.
  - **Sincronização UI**:
    - Na barra superior do feed (`#zerosub-top-toolbar`), exibir botão/pill `Sugestões (N)` quando `N > 0`, que alterna a visibilidade de um painel expansível `#zerosub-suggestions-panel` logo abaixo da barra com cada canal e os botões **"Desinscrever"** e **"Manter canal"**.
    - No Popup (`popup/popup.html` + `popup/popup.js`), renderizar a seção `#suggestions-section` (visível quando `N > 0`) consumindo o mesmo `notInterestedByChannel` do `chrome.storage.local`, enviando mensagem `ZEROSUB_UNSUBSCRIBE_CHANNEL` para a aba do YouTube ao clicar em "Desinscrever" (ou registrando em `unsubscribedChannels` + removendo de `notInterestedByChannel` caso não haja aba aberta) e removendo a entrada ao clicar em "Manter canal".

## Risks / Trade-offs

- **[Feed inicial sem âncora logo após instalar pela primeira vez]** → Mitigação: Mesmo antes do primeiro "Zerar Feed Agora", o corte cronológico já é acionado assim que o primeiro vídeo com `publishedTimestamp < installTimestamp` é encontrado, ocultando tudo abaixo e o `ytd-continuation-item-renderer`.
- **[Espaço horizontal em telas mais estreitas para 3 botões em uma única linha]** → Mitigação: Usar rótulos concisos (`✓ Visto`, `✕ Sem interesse`, `Desinscrever`), `font-size: 11px`, `padding: 5px 8px`, `white-space: nowrap` e `min-width: 0` com `overflow: hidden; text-overflow: ellipsis;` para nunca estourar a largura do card.
- **[Desinscrever pelo Popup quando não há aba do YouTube aberta]** → Mitigação: Se houver aba `*://*.youtube.com/*` aberta, o popup envia mensagem para executar o InnerTube unsubscribe; se não houver, oculta o canal localmente (`unsubscribedChannels`) e abre a URL do canal em nova aba ou informa o usuário.
