# Design

## Context

O ZeroSub é uma extensão Chrome (Manifest V3) construída do zero (greenfield) para operar sobre a interface web do YouTube (`https://www.youtube.com/*`, com foco em `/feed/subscriptions`). Consulte `proposal.md` para a motivação e `specs/` para os requisitos comportamentais.

O YouTube funciona como uma Single Page Application (Polymer/Web Components customizados como `ytd-app`, `ytd-browse`, `ytd-rich-item-renderer`, `ytd-grid-video-renderer`) onde:
1. Mudanças de rota não disparam recarregamento completo de página, mas sim eventos customizados no `document` (`yt-navigate-finish`).
2. Content scripts padrão rodam em um mundo isolado (`ISOLATED` world) com acesso ao DOM e às APIs `chrome.*`, mas sem acesso direto a variáveis globais da página como `window.ytInitialData` ou `window.ytcfg`.
3. O carregamento adicional de vídeos no feed ocorre de forma assíncrona via infinite scroll (chamadas `POST /youtubei/v1/browse`).

## Goals / Non-Goals

**Goals:**
- Arquitetura leve em Vanilla JavaScript/CSS sem necessidade de bundlers pesados ou dependências externas em runtime, permitindo carregamento direto da extensão no Chrome.
- Ponte segura entre o `MAIN` world (`content/injector.js`) e o `ISOLATED` world (`content/content.js`) para extrair metadados de vídeos (`videoId`, `channelId`, `publishedTimeText`, status de live/short) e executar ações autenticadas de desinscrição.
- Parser de tempo relativo resiliente (PT-BR e EN-US) que converta strings relativas em timestamps absolutos comparáveis com `installTimestamp`.
- Sincronização reativa de estado entre `background.js`, `content.js` e `popup.js` usando `chrome.storage.local` e `chrome.storage.onChanged`.

**Non-Goals:**
- Backend próprio, banco de dados externo ou autenticação OAuth2 fora da sessão já ativa do usuário no navegador.
- Alteração de feeds fora de `/feed/subscriptions` (como Home, Trending ou resultados de busca), exceto o monitoramento de progresso de vídeo em `/watch` para a marcação automática (>90%).

## Decisions

### 1. Comunicação Dual-World (`MAIN` + `ISOLATED`)
- **Decisão**: Registrar dois content scripts ou injetar `content/injector.js` no `world: "MAIN"` e manter `content/content.js` no `world: "ISOLATED"`, comunicando via `window.postMessage` / `CustomEvent` com namespace próprio (`ZEROSUB_EVENT`).
- **Racional**: O `ISOLATED` world tem acesso a `chrome.storage.local`, enquanto o `MAIN` world tem acesso a `window.ytInitialData`, `window.ytcfg` (para `INNERTUBE_API_KEY` e contexto do cliente) e pode interceptar `window.fetch` em `/youtubei/v1/browse` para capturar metadados dos lotes de infinite scroll.
- **Alternativas consideradas**:
  - *Apenas parsing de DOM no `ISOLATED` world*: Mais simples, mas perde acesso direto ao `channelId` confiável e aos tokens necessários para o unsubscribe direto via API interna.

### 2. Extração e Estimativa do Timestamp de Publicação
- **Decisão**: Combinar metadados extraídos do JSON (`ytInitialData` / respostas `browse`) indexados por `videoId` com um parser de DOM em `#metadata-line span` como fallback imediato. O parser suportará expressões em PT-BR (`há X segundos/minutos/horas/dias/semanas/meses/anos`, `Transmitido há...`) e EN-US (`X seconds/minutes/hours/days/weeks/months/years ago`, `Streamed X...`).
- **Racional**: O YouTube não expõe o timestamp Unix exato no card do feed; tanto o JSON do feed quanto o DOM trazem o tempo relativo (`publishedTimeText`). Converter o tempo relativo no momento da primeira observação do `videoId` e cachear o `firstSeenEstimatedTimestamp` (ou comparar com `installTimestamp` com uma margem de tolerância para arredondamento de unidades) evita que um vídeo publicado logo após o marco zero oscile de visibilidade.
- **Alternativas consideradas**:
  - *Consultar a página individual de cada vídeo (`/watch`) via fetch*: Precisão exata de segundo, porém inviável pelo volume de requisições (dezenas de vídeos por scroll) e risco de rate-limiting pelo YouTube.

### 3. Fluxo de Desinscrição sem Sair do Feed
- **Decisão**:
  1. **Abordagem Primária (InnerTube API no `MAIN` world)**: Quando o usuário confirma em dois cliques ("Desinscrever" → "Confirmar?"), `content.js` envia uma mensagem para `injector.js` com o `channelId`. O `injector.js` calcula o header `Authorization: SAPISIDHASH <timestamp>_<sha1(timestamp + " " + SAPISID + " " + origin)>` usando `crypto.subtle.digest('SHA-1', ...)` sobre o cookie `SAPISID` / `__Secure-3PAPISID` e envia `POST /youtubei/v1/subscription/unsubscribe?key=<INNERTUBE_API_KEY>` com `{ context: ytcfg.get('INNERTUBE_CONTEXT'), channelIds: [channelId] }`.
  2. **Abordagem Fallback (UI/Iframe Oculto ou Armazenamento Local de Canais Bloqueados)**: Caso a chamada InnerTube retorne erro, acionar fallback automatizado ou registrar o canal em `unsubscribedChannels` localmente para ocultar imediatamente seus vídeos e abrir/acionar o fluxo nativo.
- **Racional**: A API interna `youtubei/v1/subscription/unsubscribe` é o mesmo endpoint que o próprio frontend do YouTube utiliza quando o usuário clica em "Cancelar inscrição", proporcionando execução instantânea (<300ms) sem recarregar ou tirar o usuário do feed.

### 4. Esquema de Dados em `chrome.storage.local`
- **Decisão**: Armazenar um estado estruturado com chaves bem definidas:
  - `installTimestamp` (`number`): Timestamp em ms do Marco Zero atual.
  - `zeroSubEnabled` (`boolean`, default `true`): Ativa/desativa o filtro Modo ZeroSub ("Mostrar todos" quando `false`).
  - `hideShorts` (`boolean`, default `true`): Oculta YouTube Shorts no feed.
  - `hideScheduledLives` (`boolean`, default `true`): Oculta lives agendadas/estreias futuras.
  - `autoMarkWatched` (`boolean`, default `true`): Marca automaticamente vídeos assistidos >90%.
  - `dismissedVideos` (`string[]`): Lista de `videoId` dispensados manualmente ou por conclusão (>90%), limitada aos últimos 5.000 IDs (FIFO) para evitar crescimento infinito do storage.
  - `unsubscribedChannels` (`string[]`): Lista de `channelId`/handles desinscritos na sessão para ocultação imediata no DOM.
  - `pendingCount` (`number`): Última contagem de cards visíveis na fila de `/feed/subscriptions` para exibição instantânea no popup.

### 5. Monitoramento de Progresso (>90%) para Auto-Mark
- **Decisão**: Em páginas `/watch`, `content.js` anexa um listener `timeupdate` (com throttle) ao elemento `<video class="html5-main-video">`. Quando `video.currentTime / video.duration >= 0.90`, extrai o parâmetro `v` da URL (`videoId`) e o adiciona a `dismissedVideos`.
- **Racional**: Utiliza diretamente o elemento de mídia HTML5 nativo do player do YouTube sem depender de polling pesado.

## Risks / Trade-offs

- **[Mudanças nos seletores DOM do YouTube]** → Mitigação: Suportar múltiplos seletores de container de card (`ytd-rich-item-renderer`, `ytd-grid-video-renderer`, `ytd-rich-grid-media`) e múltiplos seletores para link de vídeo (`a#thumbnail`, `a#video-title-link`, `a#video-title`) e canal (`ytd-channel-name a`, `a.yt-simple-endpoint[href*="/@"]`, `a[href*="/channel/"]`).
- **[Imprecisão de datas relativas ("há 1 hora" vs minutos exatos)]** → Mitigação: Quando `publishedTimeText` indicar uma unidade cuja borda seja próxima ao `installTimestamp`, registrar o timestamp calculado e priorizar a experiência previsível do botão "Zerar Feed Agora", que além de atualizar `installTimestamp = Date.now()`, também pode adicionar os `videoId` atualmente renderizados no DOM à lista `dismissedVideos` para garantir que 100% da tela fique limpa imediatamente mesmo que um vídeo recém-publicado diga "há 1 minuto".
- **[Alteração de contrato no endpoint InnerTube de Unsubscribe]** → Mitigação: Encapsular a chamada em `injector.js` com verificação de `response.ok`, ocultando os cards do canal imediatamente na UI e executando fallback caso a requisição retorne erro.
