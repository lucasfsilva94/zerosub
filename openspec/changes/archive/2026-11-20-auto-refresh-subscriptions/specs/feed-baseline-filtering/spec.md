# Spec Delta

## MODIFIED Requirements

### Requirement: Estado vazio Inbox Zero com verificação manual de novos vídeos
O sistema SHALL exibir um painel de estado vazio "Inbox Zero" na página `/feed/subscriptions` quando não houver vídeos pendentes no Modo ZeroSub, oferecendo um botão "Verificar novos vídeos", um lembrete com atalho para "Ver depois" quando houver itens salvos e o status da verificação automática configurada (intervalo e horário da última verificação).

#### Scenario: Fila completamente zerada no Modo ZeroSub
- **WHEN** todos os vídeos da fila são dispensados ou o usuário aciona "Zerar Feed Agora" e restam zero vídeos pendentes e zero itens em `watchLaterVideos`
- **THEN** o sistema exibe o banner de estado vazio Inbox Zero informando o horário em que a fila foi limpa, o status da verificação automática configurada e disponibilizando o botão "Verificar novos vídeos"

#### Scenario: Fila principal zerada com vídeos pendentes em Ver depois
- **WHEN** restam zero vídeos pendentes na fila principal no Modo ZeroSub e existem um ou mais itens em `watchLaterVideos`
- **THEN** o banner de estado vazio Inbox Zero informa a quantidade de vídeos guardados em "Ver depois" e exibe um botão de atalho para abrir o painel `#zerosub-watch-later-panel`

#### Scenario: Acionar Verificar novos vídeos
- **WHEN** o usuário clica em "Verificar novos vídeos" no banner de estado vazio
- **THEN** o sistema recarrega a aba de inscrições para buscar novos vídeos publicados acima do marco zero

## ADDED Requirements

### Requirement: Verificação automática periódica e silenciosa de novos vídeos
O sistema SHALL verificar periodicamente por novos vídeos na aba `/feed/subscriptions` conforme o intervalo configurado em `autoRefreshMinutes` (quando maior que zero e o Modo ZeroSub estiver ativo) via consulta silenciosa InnerTube (`FEsubscriptions`), sem recarregar a página quando não houver novidades.

#### Scenario: Intervalo disparado sem novos vídeos disponíveis
- **WHEN** o temporizador de verificação automática dispara em `/feed/subscriptions` e a consulta silenciosa não encontra nenhum vídeo novo elegível
- **THEN** o sistema não recarrega a página e atualiza apenas o indicador discreto do horário da última verificação

#### Scenario: Novos vídeos encontrados com fila zerada e sem painéis abertos
- **WHEN** a verificação automática encontra um ou mais vídeos novos elegíveis enquanto a fila está em Inbox Zero (`pendingCount === 0`) e nenhum painel (`Ver depois`, `Sugestões`) ou confirmação ativa está aberto
- **THEN** o sistema recarrega automaticamente a aba `/feed/subscriptions` para exibir os novos vídeos na fila

#### Scenario: Novos vídeos encontrados enquanto o usuário está interagindo
- **WHEN** a verificação automática encontra um ou mais vídeos novos elegíveis enquanto há vídeos pendentes na fila ou algum painel (`Ver depois`, `Sugestões`) está aberto
- **THEN** o sistema não recarrega a página automaticamente, exibe na barra superior um botão `+N novo(s) • Atualizar` para carregamento manual e atualiza o badge da extensão com o total pendente

#### Scenario: Verificação automática desativada
- **WHEN** `autoRefreshMinutes` está configurado como `0` (Desativado)
- **THEN** o sistema não agenda nem executa verificações automáticas periódicas
