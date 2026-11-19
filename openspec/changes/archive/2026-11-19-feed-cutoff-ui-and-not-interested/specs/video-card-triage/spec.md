# Spec Delta

## MODIFIED Requirements

### Requirement: Injeção de barra de ações nos cards de vídeo
O sistema SHALL exibir uma barra de ações em linha única posicionada como rodapé dedicado abaixo das informações de cada card de vídeo visível em `/feed/subscriptions`, fora da área da thumbnail e dos overlays de pré-visualização, contendo os botões "Visto", "Sem interesse" e "Desinscrever" com delimitação visual clara por card.

#### Scenario: Renderização de card visível no feed
- **WHEN** um card de vídeo é exibido na página `/feed/subscriptions`
- **THEN** o sistema anexa uma única barra de ações em linha única abaixo dos metadados do vídeo, com os botões "Visto", "Sem interesse" e "Desinscrever" visíveis acima de overlays, estilizados conforme o tema claro ou escuro do YouTube e visualmente associados ao card correspondente

## ADDED Requirements

### Requirement: Marcar vídeo como Não tenho interesse com contagem por canal
O sistema SHALL permitir ao usuário clicar em "Sem interesse" em um card de vídeo para removê-lo da fila e registrar o `videoId` em um contador deduplicado por canal.

#### Scenario: Primeiro ou segundo vídeo marcado como Sem interesse de um canal
- **WHEN** o usuário clica em "Sem interesse" em um vídeo de um canal que possui menos de 3 vídeos distintos marcados
- **THEN** o sistema dispensa o card da fila com transição suave, adiciona o `videoId` a `dismissedVideos` e incrementa a lista de vídeos distintos sem interesse daquele canal sem duplicar o mesmo `videoId`

### Requirement: Sugestão automática de desinscrição após 3 vídeos diferentes sem interesse
O sistema SHALL incluir um canal na lista de sugestões para desinscrição assim que o usuário marcar 3 vídeos diferentes desse mesmo canal como "Sem interesse", exibindo a lista em um painel expansível no topo do feed de inscrições.

#### Scenario: Atingir 3 vídeos diferentes marcados como Sem interesse do mesmo canal
- **WHEN** o usuário marca o terceiro vídeo distinto de um mesmo canal como "Sem interesse"
- **THEN** o sistema adiciona o canal à lista de sugestões para desinscrição, atualiza o indicador na barra superior do feed e exibe uma notificação sugerindo revisar o canal

#### Scenario: Desinscrever canal pela lista de sugestões no topo do feed
- **WHEN** o usuário abre o painel de sugestões no topo do feed e clica em "Desinscrever" em um canal listado
- **THEN** o sistema cancela a inscrição do canal no YouTube, oculta todos os cards daquele canal no feed e remove o canal da lista de sugestões

#### Scenario: Manter canal pela lista de sugestões no topo do feed
- **WHEN** o usuário abre o painel de sugestões no topo do feed e clica em "Manter canal" em um canal listado
- **THEN** o sistema remove o canal da lista de sugestões e zera a contagem de vídeos sem interesse daquele canal
