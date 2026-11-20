# feed-baseline-filtering Specification

## Purpose

Filtra o feed de inscrições do YouTube com base em um marco zero temporal (`installTimestamp`) e critérios configuráveis de formato (Shorts e transmissões agendadas), mantendo o filtro ativo durante a navegação SPA e rolagem infinita.

## Requirements

### Requirement: Inicialização do marco zero na instalação
O sistema SHALL registrar o timestamp atual (`installTimestamp`) na primeira instalação da extensão caso nenhum valor exista previamente armazenado.

#### Scenario: Primeira instalação da extensão
- **WHEN** a extensão é instalada pela primeira vez no navegador
- **THEN** o sistema grava `installTimestamp` com o timestamp atual em milissegundos e habilita o Modo ZeroSub por padrão

#### Scenario: Atualização da extensão com marco existente
- **WHEN** a extensão é atualizada ou recarregada e `installTimestamp` já existe no armazenamento
- **THEN** o sistema preserva o `installTimestamp` existente sem sobrescrevê-lo

### Requirement: Ocultação de vídeos anteriores ao marco zero
O sistema SHALL ocultar por padrão todos os cards de vídeo na página `/feed/subscriptions` cuja data de publicação estimada seja anterior ao `installTimestamp` quando o Modo ZeroSub estiver ativo.

#### Scenario: Vídeo publicado antes do marco zero
- **WHEN** o usuário acessa `/feed/subscriptions` com o Modo ZeroSub ativo e um card possui data de publicação anterior a `installTimestamp`
- **THEN** o sistema oculta o card do feed

#### Scenario: Vídeo publicado após o marco zero
- **WHEN** o usuário acessa `/feed/subscriptions` com o Modo ZeroSub ativo e um card possui data de publicação igual ou posterior a `installTimestamp` e não foi dispensado
- **THEN** o sistema exibe o card normalmente no feed

### Requirement: Alternância entre Modo ZeroSub e Mostrar Todos
O sistema SHALL fornecer um controle de alternância no topo da página de inscrições e no popup para alternar entre "Modo ZeroSub" e "Mostrar todos".

#### Scenario: Desativar Modo ZeroSub temporariamente
- **WHEN** o usuário alterna para "Mostrar todos"
- **THEN** o sistema reexibe imediatamente os vídeos anteriores ao `installTimestamp` e os vídeos dispensados no feed original

#### Scenario: Reativar Modo ZeroSub
- **WHEN** o usuário alterna novamente para "Modo ZeroSub"
- **THEN** o sistema reaplica imediatamente os filtros de `installTimestamp`, vídeos dispensados, Shorts e lives agendadas

### Requirement: Redefinição manual do marco zero
O sistema SHALL permitir ao usuário redefinir o `installTimestamp` para o momento atual através da ação "Zerar Feed Agora" no topo do feed ou no popup, gravando também os identificadores dos vídeos do topo como âncoras de corte (`baselineAnchorIds`) para impedir o retorno de vídeos antigos, preservando intactos os vídeos salvos em `watchLaterVideos`.

#### Scenario: Acionar Zerar Feed Agora
- **WHEN** o usuário aciona "Zerar Feed Agora"
- **THEN** o sistema atualiza `installTimestamp` para `Date.now()`, registra os vídeos atuais do topo em `baselineAnchorIds`, oculta imediatamente todos os vídeos existentes no feed e preserva todos os itens atualmente armazenados em `watchLaterVideos`

### Requirement: Extração de data de publicação com fallback bilíngue
O sistema SHALL determinar o timestamp de publicação de cada vídeo a partir dos metadados internos do YouTube ou, em caso de indisponibilidade, via parsing do texto de tempo relativo em português (PT-BR) e inglês (EN-US).

#### Scenario: Extração via metadados internos
- **WHEN** os metadados do vídeo estão disponíveis nos dados internos da página ou da resposta de navegação
- **THEN** o sistema extrai o `videoId`, `channelId` e texto temporal associado para calcular o timestamp de publicação

#### Scenario: Extração via fallback de DOM em PT-BR ou EN-US
- **WHEN** os metadados internos não estão disponíveis para um card carregado dinamicamente e o DOM exibe texto como "há 2 horas" ou "3 days ago"
- **THEN** o sistema converte a expressão relativa para um timestamp estimado subtraindo o intervalo do horário atual

### Requirement: Persistência do filtro em navegação SPA e scroll infinito
O sistema SHALL detectar transições de rota SPA do YouTube e novos cards inseridos por rolagem infinita em `/feed/subscriptions`, aplicando a filtragem automaticamente.

#### Scenario: Navegação SPA para a aba de inscrições
- **WHEN** o usuário navega da página inicial do YouTube para `/feed/subscriptions` sem recarregar a aba
- **THEN** o sistema detecta a conclusão da navegação, injeta a barra de controle do topo e filtra os cards renderizados

#### Scenario: Carregamento de novos cards via scroll infinito
- **WHEN** o usuário rola a página `/feed/subscriptions` e novos cards são adicionados ao DOM
- **THEN** o sistema avalia cada novo card e aplica as regras de visibilidade e botões de triagem imediatamente

### Requirement: Filtro configurável de YouTube Shorts
O sistema SHALL ocultar cards e seções de YouTube Shorts no feed de inscrições quando a opção de ocultar Shorts estiver habilitada.

#### Scenario: Ocultar Shorts ativado
- **WHEN** a opção de ocultar Shorts está habilitada e o feed contém prateleiras de Shorts ou cards com link `/shorts/`
- **THEN** o sistema oculta esses elementos do feed de inscrições

### Requirement: Filtro configurável de transmissões ao vivo agendadas
O sistema SHALL ocultar cards de transmissões ao vivo agendadas ou futuras no feed de inscrições quando a opção correspondente estiver habilitada, mantendo visíveis transmissões ao vivo em andamento ou encerradas.

#### Scenario: Ocultar live agendada
- **WHEN** a opção de ocultar lives agendadas está habilitada e um card indica estreia ou transmissão programada futura
- **THEN** o sistema oculta o card do feed até que a transmissão inicie ou seja concluída

### Requirement: Corte cronológico e bloqueio de carregamento infinito de vídeos antigos
O sistema SHALL interromper a exibição de todos os cards abaixo do primeiro vídeo pertencente a `baselineAnchorIds` ou com data de publicação anterior a `installTimestamp` no Modo ZeroSub, ocultando o sentinela de paginação infinita do YouTube para evitar o carregamento contínuo de vídeos antigos.

#### Scenario: Atingir o ponto de corte no feed de inscrições
- **WHEN** o usuário está em `/feed/subscriptions` com o Modo ZeroSub ativo e o feed alcança um vídeo em `baselineAnchorIds` ou publicado antes de `installTimestamp`
- **THEN** o sistema oculta esse card, todos os cards posicionados abaixo dele e o elemento de paginação infinita (`ytd-continuation-item-renderer`), exibindo apenas vídeos mais novos posicionados acima do corte

#### Scenario: Reexibir paginação ao alternar para Mostrar todos
- **WHEN** o usuário desativa o Modo ZeroSub alternando para "Mostrar todos"
- **THEN** o sistema remove o bloqueio do elemento de paginação infinita e reexibe o feed completo do YouTube

### Requirement: Estado vazio Inbox Zero com verificação manual de novos vídeos
O sistema SHALL exibir um painel de estado vazio "Inbox Zero" na página `/feed/subscriptions` quando não houver vídeos pendentes no Modo ZeroSub, oferecendo um botão "Verificar novos vídeos" e, caso existam itens em `watchLaterVideos`, um lembrete com atalho direto para abrir a lista "Ver depois".

#### Scenario: Fila completamente zerada no Modo ZeroSub
- **WHEN** todos os vídeos da fila são dispensados ou o usuário aciona "Zerar Feed Agora" e restam zero vídeos pendentes e zero itens em `watchLaterVideos`
- **THEN** o sistema exibe o banner de estado vazio Inbox Zero informando o horário do marco zero e disponibilizando o botão "Verificar novos vídeos"

#### Scenario: Fila principal zerada com vídeos pendentes em Ver depois
- **WHEN** restam zero vídeos pendentes na fila principal no Modo ZeroSub e existem um ou mais itens em `watchLaterVideos`
- **THEN** o banner de estado vazio Inbox Zero informa a quantidade de vídeos guardados em "Ver depois" e exibe um botão de atalho para abrir o painel `#zerosub-watch-later-panel`

#### Scenario: Acionar Verificar novos vídeos
- **WHEN** o usuário clica em "Verificar novos vídeos" no banner de estado vazio
- **THEN** o sistema recarrega a aba de inscrições para buscar novos vídeos publicados acima do marco zero

### Requirement: Ocultação de vídeos salvos em Ver depois na fila principal
O sistema SHALL ocultar da fila principal em `/feed/subscriptions` os cards cujo `videoId` esteja presente em `watchLaterVideos` enquanto o Modo ZeroSub estiver ativo, mantendo essa coleção separada de `dismissedVideos`.

#### Scenario: Vídeo presente em Ver depois no Modo ZeroSub
- **WHEN** o Modo ZeroSub está ativo e um card carregado em `/feed/subscriptions` possui `videoId` listado em `watchLaterVideos`
- **THEN** o sistema oculta o card da fila principal com motivo `watch-later` e não o contabiliza em `pendingCount`

#### Scenario: Alternar para Mostrar todos com vídeos em Ver depois
- **WHEN** o usuário alterna para "Mostrar todos" (`zeroSubEnabled === false`)
- **THEN** o sistema volta a exibir o feed completo normalmente sem apagar os itens armazenados em `watchLaterVideos`
