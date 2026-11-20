# Proposal

## Why

Quando o usuário limpa a fila de inscrições e atinge o estado **Inbox Zero**, novos vídeos publicados posteriormente só aparecem se o usuário recarregar a página manualmente ou clicar no botão **"Verificar novos vídeos"**. Permitir uma verificação periódica configurável elimina essa ação repetitiva sem interromper o usuário com recarregamentos desnecessários quando não há novidades ou quando ele está interagindo com a fila ou com o painel "Ver depois".

## What Changes

- **Verificação Silenciosa Periódica no Feed (`/feed/subscriptions`)**:
  - `content/injector.js` (MAIN world) ganha uma consulta autenticada silenciosa ao endpoint InnerTube `/youtubei/v1/browse` (`browseId: "FEsubscriptions"`) reaproveitando `SAPISIDHASH` e `extractVideosFromYtData()`.
  - `content/content.js` agenda a checagem periódica conforme `autoRefreshMinutes` enquanto a aba `/feed/subscriptions` estiver aberta no Modo ZeroSub, avaliando os itens retornados com as mesmas regras do feed (`installTimestamp`, `baselineAnchorIds`, `dismissedVideos`, `watchLaterVideos`, Shorts e lives).
  - **Quando não há vídeos novos**: a aba **não** recarrega — apenas atualiza discretamente o horário da última verificação no banner Inbox Zero.
  - **Quando há vídeos novos**:
    - Se a fila estiver vazia (`pendingCount === 0`) e nenhum painel (`Ver depois`, `Sugestões`) nem confirmação ativa estiver aberta, a aba recarrega automaticamente para exibir os novos vídeos.
    - Caso o usuário esteja triando vídeos ou com algum painel aberto, a aba **não** é recarregada de surpresa: exibe na barra superior um botão chamativo e discreto **`+N novo(s) • Atualizar`** e já atualiza o badge vermelho da extensão.
  - **Fallback seguro**: se a consulta silenciosa falhar, realiza reload apenas quando a fila estiver vazia e sem painéis abertos.
- **Seletor de Intervalo no Popup Dashboard**:
  - Novo controle na seção **Configurações** do Popup (`#select-auto-refresh`) permitindo escolher entre **Desativado (0)**, **5 min**, **10 min** (padrão), **15 min**, **30 min** e **1 hora (60 min)**, sincronizado em tempo real com a aba `/feed/subscriptions`.
- **Indicador de Status no Banner Inbox Zero**:
  - O estado vazio **Inbox Zero** passa a informar o intervalo de verificação automática ativo e o horário da última checagem silenciosa.

## Capabilities

### New Capabilities

### Modified Capabilities
- `feed-baseline-filtering`: Adiciona verificação periódica silenciosa de novos vídeos em `/feed/subscriptions` via InnerTube (`FEsubscriptions`), recarregamento automático apenas quando há novidades em Inbox Zero ocioso, aviso de novos vídeos na barra superior quando o usuário está interagindo e indicador de intervalo/última verificação no banner Inbox Zero.
- `popup-dashboard`: Adiciona o seletor de intervalo de verificação automática (`Desativado`, `5`, `10`, `15`, `30`, `60` minutos) na seção de Configurações do Popup, persistido em `autoRefreshMinutes` no `chrome.storage.local` e sincronizado em tempo real.

## Impact

- **Arquivos modificados**: `background.js`, `content/injector.js`, `content/content.js`, `content/styles.css`, `popup/popup.html`, `popup/popup.css`, `popup/popup.js`, `tests/zerosub.test.js`.
- **Storage (`chrome.storage.local`)**: Nova chave `autoRefreshMinutes` (`number`, padrão `10`).
- **Sem novas permissões**: Mantém apenas `storage` e `tabs` já presentes em `manifest.json`.
