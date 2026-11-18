# Proposal

## Why

O feed padrão de inscrições do YouTube (`https://www.youtube.com/feed/subscriptions`) acumula centenas de vídeos antigos e não assistidos, gerando sobrecarga visual e dificultando o acompanhamento de conteúdos recentes. O ZeroSub transforma a página de inscrições em uma fila estilo "Inbox Zero", exibindo apenas vídeos novos publicados a partir da ativação da extensão e permitindo triagem rápida diretamente em cada card.

## What Changes

- Criação da extensão Google Chrome (Manifest V3) **ZeroSub** voltada para `https://www.youtube.com/feed/subscriptions`.
- **Marco Zero (Baseline Timestamp)**: Registro automático de `installTimestamp` na instalação (`chrome.runtime.onInstalled`), ocultando vídeos publicados antes desse marco e permitindo alternar entre "Mostrar todos / Modo ZeroSub" ou redefinir o marco via "Zerar Feed Agora".
- **Triagem por Card de Vídeo**: Injeção de barra de ações rápida nos cards de vídeo (`ytd-rich-item-renderer` e `ytd-grid-video-renderer`) com botões para:
  - **Marcar como Visto (Check / Archive)**: Dispensa o vídeo com transição suave, persiste `videoId` em `dismissedVideos` no `chrome.storage.local` e suporta marcação automática opcional ao assistir >90% do vídeo.
  - **Desinscrever (Unsubscribe)**: Fluxo com confirmação rápida em dois cliques ("Confirmar?") que cancela a inscrição do canal sem sair do feed e oculta imediatamente todos os vídeos daquele canal na tela.
- **Filtros de Shorts e Lives**: Opções configuráveis para ocultar YouTube Shorts e transmissões ao vivo agendadas/futuras do feed de inscrições.
- **Dashboard no Popup**: Interface minimalista exibindo contador de vídeos pendentes na fila atual, ações rápidas ("Zerar tudo agora", "Restaurar vídeos ocultos") e toggles de configuração.
- **Suporte à Arquitetura SPA do YouTube**: Detecção de navegação via `yt-navigate-finish` e `MutationObserver` para infinite scroll, aliada à extração de metadados via `MAIN` world (`ytInitialData` / interceptação de `/youtubei/v1/browse`) com fallback para parser de tempo relativo no DOM (PT-BR e EN-US).

## Capabilities

### New Capabilities
- `feed-baseline-filtering`: Gerenciamento do marco zero (`installTimestamp`), extração de data de publicação (via dados internos do YouTube e fallback DOM), ocultação de vídeos anteriores ao marco, alternância de visualização ("Modo ZeroSub" / "Mostrar todos") e filtros de Shorts e lives agendadas no feed de inscrições.
- `video-card-triage`: Controles integrados em cada card de vídeo para dispensar vídeos ("Marcar como Visto" manual e automático ao assistir >90%) e cancelar inscrição do canal ("Desinscrever" com confirmação rápida e remoção imediata dos cards do canal).
- `popup-dashboard`: Painel popup da extensão com contador de vídeos na fila, botões de ação rápida ("Zerar tudo agora" e "Restaurar vídeos ocultos") e controles de configuração persistidos em `chrome.storage.local`.

### Modified Capabilities

## Impact

- **Código e Estrutura**: Novo projeto de extensão Chrome Manifest V3 (`manifest.json`, `background.js`, `content/injector.js`, `content/content.js`, `content/styles.css`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`).
- **APIs e Permissões**: Uso de `chrome.storage.local` e `chrome.runtime` (permissão `storage`, host permissions para `*://*.youtube.com/*`).
- **Integração com YouTube Web (SPA)**: Interação com o DOM do YouTube (`ytd-browse[page-subtype="subscriptions"]`, `ytd-rich-item-renderer`, `ytd-grid-video-renderer`), leitura de `ytInitialData` / tokens `SAPISIDHASH` e `INNERTUBE_API_KEY` no `MAIN` world e chamadas ao endpoint interno `/youtubei/v1/subscription/unsubscribe` com fallback UI.
