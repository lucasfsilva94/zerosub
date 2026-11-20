# video-card-triage Specification

## Purpose

Proporciona controles de triagem rápida diretamente em cada card de vídeo visível no feed de inscrições para marcar vídeos como vistos (manual ou automaticamente) e cancelar a inscrição de canais sem sair da página.

## Requirements

### Requirement: Injeção de barra de ações nos cards de vídeo
O sistema SHALL exibir uma barra de ações em grade 2×2 posicionada como rodapé dedicado abaixo das informações de cada card de vídeo visível em `/feed/subscriptions`, fora da área da thumbnail e dos overlays de pré-visualização, contendo na primeira linha os botões "Visto" e "Ver depois" e na segunda linha os botões "Sem interesse" e "Desinscrever", com delimitação visual clara por card.

#### Scenario: Renderização de card visível no feed
- **WHEN** um card de vídeo é exibido na página `/feed/subscriptions`
- **THEN** o sistema anexa uma única barra de ações em grade 2×2 abaixo dos metadados do vídeo, com os botões "Visto", "Ver depois", "Sem interesse" e "Desinscrever" visíveis acima de overlays, sem truncamento excessivo, estilizados conforme o tema claro ou escuro do YouTube e visualmente associados ao card correspondente

### Requirement: Dispensar vídeo manualmente como visto
O sistema SHALL salvar o `videoId` na lista `dismissedVideos` e remover o card do feed com uma transição visual suave quando o usuário clicar em "Marcar como Visto".

#### Scenario: Clicar em Marcar como Visto
- **WHEN** o usuário clica no botão "Marcar como Visto" de um card de vídeo
- **THEN** o sistema adiciona o `videoId` a `dismissedVideos`, executa uma transição suave de saída e oculta o card do feed

#### Scenario: Recarregar página após marcar vídeo como visto
- **WHEN** o usuário recarrega `/feed/subscriptions` após dispensar um vídeo
- **THEN** o vídeo cujo `videoId` consta em `dismissedVideos` permanece oculto enquanto o Modo ZeroSub estiver ativo

### Requirement: Marcação automática como visto ao assistir vídeo
O sistema SHALL marcar automaticamente um vídeo como visto quando o usuário assistir a pelo menos 90% da duração total do vídeo e a opção de marcação automática estiver ativa, removendo-o também de `watchLaterVideos` caso esteja salvo nessa lista.

#### Scenario: Reprodução atinge 90% da duração
- **WHEN** o usuário assiste a um vídeo no YouTube e o progresso de reprodução atinge ou ultrapassa 90% da duração do vídeo
- **THEN** o sistema registra o `videoId` em `dismissedVideos` e remove o `videoId` de `watchLaterVideos` (se presente), para que o vídeo não apareça mais pendente nem na fila principal nem em "Ver depois"

### Requirement: Confirmação rápida em duas etapas para desinscrever
O sistema SHALL exigir uma confirmação rápida no próprio botão "Desinscrever" antes de efetivar o cancelamento da inscrição do canal.

#### Scenario: Primeiro clique em Desinscrever
- **WHEN** o usuário clica uma vez no botão "Desinscrever" de um card
- **THEN** o botão altera seu estado visual para "Confirmar?" por alguns segundos sem cancelar a inscrição imediatamente

#### Scenario: Expiração do estado de confirmação sem segundo clique
- **WHEN** o botão está no estado "Confirmar?" e o usuário não clica novamente dentro de 4 segundos
- **THEN** o botão retorna automaticamente ao estado inicial "Desinscrever"

### Requirement: Cancelamento de inscrição do canal direto pelo card
O sistema SHALL cancelar a inscrição do canal no YouTube, ocultar todos os cards daquele canal no feed imediatamente e remover todos os vídeos daquele canal presentes em `watchLaterVideos` após o usuário confirmar a ação de desinscrição.

#### Scenario: Confirmação de desinscrição bem-sucedida
- **WHEN** o usuário clica no botão no estado "Confirmar?"
- **THEN** o sistema executa o cancelamento da inscrição do canal no YouTube, oculta imediatamente todos os cards pertencentes àquele canal na tela e remove todos os vídeos do canal que estavam salvos em `watchLaterVideos`

#### Scenario: Falha na requisição direta de desinscrição
- **WHEN** a requisição interna de desinscrição falha ou não possui os tokens necessários
- **THEN** o sistema aciona o fluxo de fallback automatizado na interface do YouTube para concluir o cancelamento ou notifica o erro claramente ao usuário

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
