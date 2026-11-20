# Proposal

## Why

Na triagem diária do feed `/feed/subscriptions`, frequentemente surgem vídeos que o usuário tem interesse real em assistir, mas não consegue ver naquele momento. Hoje as únicas opções são deixar o vídeo parado acumulando na fila principal (quebrando a sensação de Inbox Zero) ou dispensá-lo como "Visto" / "Sem interesse" (perdendo o vídeo). Falta um botão dedicado de **"Ver depois"** que limpe o vídeo da fila principal e o guarde em um espaço próprio do ZeroSub com contador visível e as mesmas ações de triagem (`Visto`, `Sem interesse` e `Desinscrever`).

## What Changes

- **Novo Botão "Ver depois" e Grade 2×2 nos Cards do Feed**:
  - A barra de ações no rodapé de cada card em `/feed/subscriptions` passa de 1 linha (3 botões) para uma **grade 2×2** com 4 botões legíveis e bem distribuídos dentro da largura do card: linha superior com **`✓ Visto`** e **`🕒 Ver depois`** (ações positivas); linha inferior com **`✕ Sem interesse`** e **`Desinscrever`** (ações negativas).
  - Clicar em **"Ver depois"** salva um snapshot leve do vídeo (`videoId`, `title`, `thumbnailUrl`, `durationText`, `channelId`, `channelHandle`, `channelKey`, `channelName`, `publishedTimestamp`, `savedAt`) em `watchLaterVideos` no `chrome.storage.local` e remove o card do feed com transição suave.
- **Fila "Ver depois" com Contador e Ações no Feed e no Popup (Sincronizados)**:
  - **Barra superior do feed (`/feed/subscriptions`)**: novo botão com contador **`Ver depois (N)`** que expande/recolhe o painel `#zerosub-watch-later-panel` exibindo os vídeos salvos (thumbnail, título clicável para assistir, duração, canal) com os botões **`✓ Visto`**, **`✕ Sem interesse`** e **`Desinscrever`** (confirmação em 2 cliques).
  - **Estado vazio Inbox Zero**: quando a fila principal zerar mas houver itens em `watchLaterVideos`, o banner de Inbox Zero exibe um lembrete da quantidade salva e um atalho direto para abrir o painel "Ver depois".
  - **Popup Dashboard (`popup/popup.html`)**: passa a exibir contadores lado a lado (**Na fila** e **Ver depois**) e uma seção dedicada listando os vídeos salvos em "Ver depois" com link para assistir e ações **`Visto`**, **`Sem interesse`** e **`Desinscrever`**, tudo sincronizado em tempo real via `chrome.storage.local`.
- **Badge Inteligente no Ícone da Extensão**:
  - Quando a fila principal estiver em `0` (`pendingCount === 0`) e o Modo ZeroSub estiver ativo, mas existirem vídeos em `watchLaterVideos`, o badge do ícone da extensão exibe a contagem de "Ver depois" em **azul (`#1a73e8`)** como lembrete visual (enquanto `pendingCount > 0` mantém prioridade em vermelho `#cc0000`).
- **Integrações e Consistência Automática**:
  - Vídeos em `watchLaterVideos` são ocultados da fila principal separadamente de `dismissedVideos` — portanto, **"Zerar Feed Agora"** e **"Restaurar vídeos ocultos"** preservam a lista "Ver depois" intacta.
  - Assistir `>= 90%` de um vídeo salvo em "Ver depois" (`autoMarkWatched` em `/watch`) remove automaticamente o vídeo de `watchLaterVideos` e registra o `videoId` em `dismissedVideos`.
  - Marcar **"Sem interesse"** em um item de "Ver depois" alimenta o mesmo contador deduplicado por canal (`notInterestedByChannel`, threshold de 3 vídeos para Sugestões).
  - Confirmar **"Desinscrever"** em qualquer superfície (feed, Sugestões ou "Ver depois") cancela a inscrição via InnerTube (com fallback) e remove todos os vídeos daquele canal também de `watchLaterVideos`.

## Capabilities

### New Capabilities
- `watch-later-queue`: Gerencia a lista local "Ver depois" do ZeroSub (armazenamento com metadados, painel expansível no topo do feed com contador e ações `Visto`/`Sem interesse`/`Desinscrever`, remoção automática ao assistir `>= 90%`, limpeza ao desinscrever e badge azul de lembrete no ícone da extensão).

### Modified Capabilities
- `video-card-triage`: Atualiza o rodapé dos cards no feed para grade 2×2 com 4 botões (`Visto`, `Ver depois`, `Sem interesse`, `Desinscrever`), remove vídeos de `watchLaterVideos` na marcação automática (`>= 90%`) e limpa vídeos do canal em `watchLaterVideos` ao desinscrever.
- `feed-baseline-filtering`: Oculta da fila principal os vídeos presentes em `watchLaterVideos` de forma independente de `dismissedVideos`, preserva `watchLaterVideos` em "Zerar Feed Agora" e exibe atalho/lembrete de "Ver depois" no banner de estado vazio Inbox Zero.
- `popup-dashboard`: Exibe o contador de vídeos em "Ver depois" ao lado do contador de pendentes e adiciona uma seção dedicada no popup listando os vídeos salvos com link para assistir e ações `Visto`, `Sem interesse` e `Desinscrever`.

## Impact

- **Arquivos modificados**: `background.js`, `content/injector.js`, `content/content.js`, `content/styles.css`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `tests/zerosub.test.js`.
- **Storage (`chrome.storage.local`)**: Nova chave `watchLaterVideos` (`Array<{ videoId, title, thumbnailUrl, durationText, channelId, channelHandle, channelKey, channelName, publishedTimestamp, savedAt }>`).
- **Sem novas permissões**: Reutiliza apenas `storage` e `tabs` já presentes em `manifest.json`.
