# Tasks

## 1. Estrutura Base da Extensão e Service Worker (Manifest V3)

- [x] 1.1 Criar `manifest.json` (Manifest V3) com permissões (`storage`), `host_permissions` para `*://*.youtube.com/*`, registro de `background.js`, popup (`popup/popup.html`) e content scripts para `MAIN` (`content/injector.js`) e `ISOLATED` (`content/content.js`, `content/styles.css`), verificando que o JSON é válido e referencia todos os caminhos esperados.
- [x] 1.2 Implementar `background.js` para inicializar `installTimestamp = Date.now()` e as configurações padrão (`zeroSubEnabled: true`, `hideShorts: true`, `hideScheduledLives: true`, `autoMarkWatched: true`, `dismissedVideos: []`, `unsubscribedChannels: []`, `pendingCount: 0`) em `chrome.runtime.onInstalled` sem sobrescrever valores já existentes em atualizações, verificando a lógica por teste automatizado ou script de validação de estado inicial.

## 2. Extração de Metadados e Ponte MAIN World (`content/injector.js`)

- [x] 2.1 Implementar em `content/injector.js` a leitura de `window.ytInitialData` e a interceptação não-intrusiva de `window.fetch` para `/youtubei/v1/browse`, extraindo `videoId`, `channelId`, `publishedTimeText`, indicadores de Shorts e lives agendadas e emitindo eventos para o `ISOLATED` world, verificando via teste unitário/script a extração em payloads de exemplo do YouTube.
- [x] 2.2 Implementar em `content/injector.js` a ação autenticada de desinscrição via endpoint interno `POST /youtubei/v1/subscription/unsubscribe` utilizando `SAPISIDHASH` (SHA-1 via Web Crypto API) e `INNERTUBE_API_KEY` do `ytcfg`, retornando status de sucesso ou erro para `content.js`, verificando a geração do header `SAPISIDHASH` e o tratamento de erro/fallback com teste automatizado.

## 3. Filtragem do Feed, Parser de Data e Navegação SPA (`content/content.js` & `content/styles.css`)

- [x] 3.1 Implementar o parser bilíngue (PT-BR e EN-US) de tempo relativo (`há X minutos/horas/dias/semanas/meses/anos`, `X minutes/hours/days/weeks/months/years ago`, `Transmitido há...`, `Streamed...`) e detecção de Shorts e lives agendadas, verificando com suíte de testes automatizados (`node --test`) cobrindo expressões em português e inglês.
- [x] 3.2 Implementar em `content/content.js` o gerenciamento de ciclo de vida SPA (`yt-navigate-finish` e `MutationObserver` sobre `ytd-browse[page-subtype="subscriptions"]`), a barra de controle discreta no topo do feed ("Modo ZeroSub / Mostrar todos", contador e botão "Zerar Feed Agora") e a lógica de ocultação de cards por `installTimestamp`, `dismissedVideos`, Shorts e lives agendadas, verificando que mudanças em `chrome.storage.onChanged` atualizam os cards imediatamente.
- [x] 3.3 Implementar o monitoramento de progresso de vídeo em páginas `/watch` (`timeupdate` em `video.html5-main-video`) para adicionar automaticamente o `videoId` a `dismissedVideos` ao atingir >=90% da duração quando `autoMarkWatched` estiver ativo, verificando o comportamento com teste de simulação de progresso.

## 4. Triagem por Card de Vídeo e Estilização (`content/content.js` & `content/styles.css`)

- [x] 4.1 Implementar a injeção idempotente da barra de ações em cada card visível (`ytd-rich-item-renderer` e `ytd-grid-video-renderer`) com os botões "Marcar como Visto" (transição suave de saída + persistência em `dismissedVideos`) e "Desinscrever" (confirmação em duas etapas "Confirmar?" com timeout de 4s + ocultação imediata de todos os cards do canal na tela + fallback UI caso a API interna falhe), verificando a transição de estados dos botões e remoção dos cards.
- [x] 4.2 Criar `content/styles.css` com suporte nativo aos temas claro e escuro do YouTube (`html[dark]`), estilizando a barra superior do ZeroSub, a barra de ações nos cards, os estados de hover/confirmação e a animação suave de colapso ao marcar um vídeo como visto, verificando a ausência de quebras de layout na grade do YouTube.

## 5. Dashboard do Popup (`popup/`) e Documentação

- [x] 5.1 Criar `popup/popup.html`, `popup/popup.css` e `popup/popup.js` exibindo o contador de vídeos pendentes na fila, botão "Zerar tudo agora", botão "Restaurar vídeos ocultos" e toggles sincronizados (`zeroSubEnabled`, `hideShorts`, `hideScheduledLives`, `autoMarkWatched`), verificando que todas as ações atualizam `chrome.storage.local` e refletem na aba ativa.
- [x] 5.2 Atualizar `README.md` com instruções de instalação em modo desenvolvedor no Chrome (`chrome://extensions`), arquitetura do projeto e guia de uso, verificando que toda a estrutura de arquivos e testes passa sem erros.
