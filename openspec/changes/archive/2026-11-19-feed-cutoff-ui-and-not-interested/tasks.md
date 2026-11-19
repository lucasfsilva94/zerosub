# Tasks

## 1. Estado Base, Corte Cronológico e Bloqueio de Histórico Antigo

- [x] 1.1 Atualizar `background.js` para incluir `baselineAnchorIds: []` e `notInterestedByChannel: {}` em `DEFAULT_STATE` sem sobrescrever dados existentes em atualizações, verificando via `node --test tests/zerosub.test.js`.
- [x] 1.2 Implementar em `content/content.js` o corte cronológico com `baselineAnchorIds` (capturando os IDs do topo em `resetFeedToNow()`, ocultando todos os cards abaixo do primeiro card de corte e ocultando `ytd-continuation-item-renderer` no Modo ZeroSub) e o banner de estado vazio Inbox Zero com botão "Verificar novos vídeos", verificando a lógica de corte com testes unitários em `tests/zerosub.test.js`.

## 2. Novo Layout de Rodapé nos Cards e Ação "Não tenho interesse"

- [x] 2.1 Refatorar `ensureCardActionBar` em `content/content.js` e as regras de layout em `content/styles.css` para posicionar a barra de ações em linha única fora da thumbnail/overlays (como rodapé dedicado abaixo dos metadados com contorno visual claro por card), adicionando o botão "Sem interesse" ao lado de "Visto" e "Desinscrever", verificando via testes que os seletores e classes esperados existem em `content/styles.css`.
- [x] 2.2 Implementar em `content/content.js` o rastreamento deduplicado por canal (`recordNotInterestedVideo`, `getUnsubscribeSuggestions`, `keepSuggestedChannel`) disparando sugestão de desinscrição ao atingir 3 vídeos diferentes do mesmo canal, além do botão/painel expansível de sugestões no topo do feed com ações "Desinscrever" e "Manter canal", verificando deduplicação, threshold de 3 vídeos e limpeza do canal com `node --test tests/zerosub.test.js`.

## 3. Sincronização de Sugestões no Popup e Documentação

- [x] 3.1 Atualizar `popup/popup.html`, `popup/popup.css` e `popup/popup.js` para exibir a seção sincronizada de "Sugestões para Desinscrever" (canais com >=3 vídeos diferentes marcados como "Sem interesse") com ações "Desinscrever" (via mensagem para a aba do YouTube ou fallback) e "Manter canal", além de listener `ZEROSUB_UNSUBSCRIBE_CHANNEL` em `content/content.js`, verificando via testes automatizados em `tests/zerosub.test.js`.
- [x] 3.2 Executar a suíte completa (`node --test tests/zerosub.test.js`) e confirmar que todos os testes novos e existentes passam sem regressões.
