# Spec Delta

## MODIFIED Requirements

### Requirement: Redefinição manual do marco zero
O sistema SHALL permitir ao usuário redefinir o `installTimestamp` para o momento atual através da ação "Zerar Feed Agora" no topo do feed ou no popup, gravando também os identificadores dos vídeos do topo como âncoras de corte (`baselineAnchorIds`) para impedir o retorno de vídeos antigos.

#### Scenario: Acionar Zerar Feed Agora
- **WHEN** o usuário aciona "Zerar Feed Agora"
- **THEN** o sistema atualiza `installTimestamp` para `Date.now()`, registra os vídeos atuais do topo em `baselineAnchorIds` e oculta imediatamente todos os vídeos existentes no feed

## ADDED Requirements

### Requirement: Corte cronológico e bloqueio de carregamento infinito de vídeos antigos
O sistema SHALL interromper a exibição de todos os cards abaixo do primeiro vídeo pertencente a `baselineAnchorIds` ou com data de publicação anterior a `installTimestamp` no Modo ZeroSub, ocultando o sentinela de paginação infinita do YouTube para evitar o carregamento contínuo de vídeos antigos.

#### Scenario: Atingir o ponto de corte no feed de inscrições
- **WHEN** o usuário está em `/feed/subscriptions` com o Modo ZeroSub ativo e o feed alcança um vídeo em `baselineAnchorIds` ou publicado antes de `installTimestamp`
- **THEN** o sistema oculta esse card, todos os cards posicionados abaixo dele e o elemento de paginação infinita (`ytd-continuation-item-renderer`), exibindo apenas vídeos mais novos posicionados acima do corte

#### Scenario: Reexibir paginação ao alternar para Mostrar todos
- **WHEN** o usuário desativa o Modo ZeroSub alternando para "Mostrar todos"
- **THEN** o sistema remove o bloqueio do elemento de paginação infinita e reexibe o feed completo do YouTube

### Requirement: Estado vazio Inbox Zero com verificação manual de novos vídeos
O sistema SHALL exibir um painel de estado vazio "Inbox Zero" na página `/feed/subscriptions` quando não houver vídeos pendentes no Modo ZeroSub, oferecendo um botão "Verificar novos vídeos" além do comportamento normal ao recarregar a página.

#### Scenario: Fila completamente zerada no Modo ZeroSub
- **WHEN** todos os vídeos da fila são dispensados ou o usuário aciona "Zerar Feed Agora" e restam zero vídeos pendentes
- **THEN** o sistema exibe o banner de estado vazio Inbox Zero informando o horário do marco zero e disponibilizando o botão "Verificar novos vídeos"

#### Scenario: Acionar Verificar novos vídeos
- **WHEN** o usuário clica em "Verificar novos vídeos" no banner de estado vazio
- **THEN** o sistema recarrega a aba de inscrições para buscar novos vídeos publicados acima do marco zero
