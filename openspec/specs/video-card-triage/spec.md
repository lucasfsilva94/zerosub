# video-card-triage Specification

## Purpose

Proporciona controles de triagem rápida diretamente em cada card de vídeo visível no feed de inscrições para marcar vídeos como vistos (manual ou automaticamente) e cancelar a inscrição de canais sem sair da página.

## Requirements

### Requirement: Injeção de barra de ações nos cards de vídeo
O sistema SHALL exibir uma barra de ações integrada em cada card de vídeo visível na página `/feed/subscriptions` contendo os botões "Marcar como Visto" e "Desinscrever".

#### Scenario: Renderização de card visível no feed
- **WHEN** um card de vídeo é exibido na página `/feed/subscriptions`
- **THEN** o sistema anexa uma única barra de ações ao card com os botões "Marcar como Visto" e "Desinscrever" estilizados conforme o tema claro ou escuro do YouTube

### Requirement: Dispensar vídeo manualmente como visto
O sistema SHALL salvar o `videoId` na lista `dismissedVideos` e remover o card do feed com uma transição visual suave quando o usuário clicar em "Marcar como Visto".

#### Scenario: Clicar em Marcar como Visto
- **WHEN** o usuário clica no botão "Marcar como Visto" de um card de vídeo
- **THEN** o sistema adiciona o `videoId` a `dismissedVideos`, executa uma transição suave de saída e oculta o card do feed

#### Scenario: Recarregar página após marcar vídeo como visto
- **WHEN** o usuário recarrega `/feed/subscriptions` após dispensar um vídeo
- **THEN** o vídeo cujo `videoId` consta em `dismissedVideos` permanece oculto enquanto o Modo ZeroSub estiver ativo

### Requirement: Marcação automática como visto ao assistir vídeo
O sistema SHALL marcar automaticamente um vídeo como visto quando o usuário assistir a pelo menos 90% da duração total do vídeo e a opção de marcação automática estiver ativa.

#### Scenario: Reprodução atinge 90% da duração
- **WHEN** o usuário assiste a um vídeo no YouTube e o progresso de reprodução atinge ou ultrapassa 90% da duração do vídeo
- **THEN** o sistema registra o `videoId` em `dismissedVideos` para que o vídeo não apareça mais pendente no feed de inscrições

### Requirement: Confirmação rápida em duas etapas para desinscrever
O sistema SHALL exigir uma confirmação rápida no próprio botão "Desinscrever" antes de efetivar o cancelamento da inscrição do canal.

#### Scenario: Primeiro clique em Desinscrever
- **WHEN** o usuário clica uma vez no botão "Desinscrever" de um card
- **THEN** o botão altera seu estado visual para "Confirmar?" por alguns segundos sem cancelar a inscrição imediatamente

#### Scenario: Expiração do estado de confirmação sem segundo clique
- **WHEN** o botão está no estado "Confirmar?" e o usuário não clica novamente dentro de 4 segundos
- **THEN** o botão retorna automaticamente ao estado inicial "Desinscrever"

### Requirement: Cancelamento de inscrição do canal direto pelo card
O sistema SHALL cancelar a inscrição do canal no YouTube e ocultar todos os cards daquele canal no feed imediatamente após o usuário confirmar a ação de desinscrição.

#### Scenario: Confirmação de desinscrição bem-sucedida
- **WHEN** o usuário clica no botão no estado "Confirmar?"
- **THEN** o sistema executa o cancelamento da inscrição do canal no YouTube e oculta imediatamente todos os cards pertencentes àquele canal na tela

#### Scenario: Falha na requisição direta de desinscrição
- **WHEN** a requisição interna de desinscrição falha ou não possui os tokens necessários
- **THEN** o sistema aciona o fluxo de fallback automatizado na interface do YouTube para concluir o cancelamento ou notifica o erro claramente ao usuário
