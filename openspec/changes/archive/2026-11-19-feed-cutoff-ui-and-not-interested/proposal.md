# Proposal

## Why

Na prática diária no feed `/feed/subscriptions`, três pontos prejudicam a experiência de Inbox Zero do ZeroSub: (1) ao clicar em "Zerar Feed Agora", o YouTube dispara paginação infinita trazendo vídeos cada vez mais antigos, impedindo que a fila permaneça limpa; (2) os botões de ação nos cards podem ficar mal posicionados ou encobertos pela thumbnail/overlays, dificultando o clique e a associação visual ao vídeo; e (3) falta uma forma gradual de sinalizar desinteresse por vídeos de um canal para receber sugestões de desinscrição automática quando o padrão se repetir.

## What Changes

- **Corte Real do Feed ("Inbox Zero") e Bloqueio de Histórico Antigo**:
  - Ao acionar "Zerar Feed Agora", o sistema registra tanto o `installTimestamp` quanto os IDs âncora do topo (`baselineAnchorIds`).
  - O processamento do feed aplica um corte cronológico: ao atingir um vídeo da âncora ou anterior ao `installTimestamp`, oculta todos os cards abaixo desse ponto e bloqueia/oculta o sentinela de paginação (`ytd-continuation-item-renderer`) para impedir que o YouTube carregue vídeos antigos em loop.
  - Quando a fila estiver zerada (`0` vídeos novos), exibe um banner de estado vazio **Inbox Zero** com botão **"Verificar novos vídeos"** (além de continuar funcionando normalmente ao recarregar a página com F5).
- **Novo Posicionamento e Layout da Barra de Ações nos Cards**:
  - Os botões de triagem passam a ser renderizados em **uma única linha** em um rodapé dedicado abaixo das informações do vídeo (fora da área da thumbnail e dos overlays de hover), com separação visual clara por card indicando exatamente a qual vídeo pertencem.
- **Nova Ação "Não tenho interesse" e Sugestões de Desinscrição (3 vídeos diferentes)**:
  - Adição do botão **"Sem interesse"** na barra de ações de cada card (ao lado de `✓ Visto` e `Desinscrever`).
  - Ao clicar em "Sem interesse", o vídeo é dispensado da fila e registrado no contador do canal (deduplicado por `videoId` para contabilizar apenas vídeos diferentes).
  - Ao atingir **3 vídeos diferentes** do mesmo canal, o canal entra automaticamente na lista de **Sugestões para Desinscrever**, exibida tanto em um **painel expansível na barra do ZeroSub no topo do feed** quanto em uma **seção dedicada no Popup**, com opções para **"Desinscrever"** ou **"Manter canal"**.

## Capabilities

### New Capabilities

### Modified Capabilities
- `feed-baseline-filtering`: Adiciona âncora de topo (`baselineAnchorIds`) para corte cronológico do feed, bloqueio de paginação infinita de histórico antigo no Modo ZeroSub e exibição do banner de estado vazio Inbox Zero com botão "Verificar novos vídeos".
- `video-card-triage`: Reposiciona a barra de ações para um rodapé dedicado de linha única abaixo dos metadados do card (fora da thumbnail/overlays), adiciona o botão "Não tenho interesse" com contagem deduplicada por canal e exibe painel expansível de sugestões de desinscrição no topo do feed ao atingir 3 vídeos diferentes do mesmo canal.
- `popup-dashboard`: Exibe a lista sincronizada de canais sugeridos para desinscrição (atingidos 3 vídeos diferentes marcados como "Não tenho interesse") com ações diretas para desinscrever ou manter/ignorar o canal.

## Impact

- **Arquivos modificados**: `background.js`, `content/content.js`, `content/styles.css`, `popup/popup.html`, `popup/popup.js`, `popup/popup.css`, `tests/zerosub.test.js`.
- **Storage (`chrome.storage.local`)**: Novas chaves `baselineAnchorIds` (`string[]`), `notInterestedByChannel` (`Record<string, { channelId, channelHandle, channelName, videoIds: string[] }>`), e `ignoredSuggestionChannels` (`string[]`) ou reset de contagem ao clicar em "Manter canal".
