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
O sistema SHALL permitir ao usuário redefinir o `installTimestamp` para o momento atual através da ação "Zerar Feed Agora" no topo do feed ou no popup.

#### Scenario: Acionar Zerar Feed Agora
- **WHEN** o usuário aciona "Zerar Feed Agora"
- **THEN** o sistema atualiza `installTimestamp` para `Date.now()` e oculta imediatamente todos os vídeos publicados antes do novo timestamp

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
