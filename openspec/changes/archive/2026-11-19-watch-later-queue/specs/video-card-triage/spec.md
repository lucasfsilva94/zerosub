# Spec Delta

## MODIFIED Requirements

### Requirement: Injeção de barra de ações nos cards de vídeo
O sistema SHALL exibir uma barra de ações em grade 2×2 posicionada como rodapé dedicado abaixo das informações de cada card de vídeo visível em `/feed/subscriptions`, fora da área da thumbnail e dos overlays de pré-visualização, contendo na primeira linha os botões "Visto" e "Ver depois" e na segunda linha os botões "Sem interesse" e "Desinscrever", com delimitação visual clara por card.

#### Scenario: Renderização de card visível no feed
- **WHEN** um card de vídeo é exibido na página `/feed/subscriptions`
- **THEN** o sistema anexa uma única barra de ações em grade 2×2 abaixo dos metadados do vídeo, com os botões "Visto", "Ver depois", "Sem interesse" e "Desinscrever" visíveis acima de overlays, sem truncamento excessivo, estilizados conforme o tema claro ou escuro do YouTube e visualmente associados ao card correspondente

### Requirement: Marcação automática como visto ao assistir vídeo
O sistema SHALL marcar automaticamente um vídeo como visto quando o usuário assistir a pelo menos 90% da duração total do vídeo e a opção de marcação automática estiver ativa, removendo-o também de `watchLaterVideos` caso esteja salvo nessa lista.

#### Scenario: Reprodução atinge 90% da duração
- **WHEN** o usuário assiste a um vídeo no YouTube e o progresso de reprodução atinge ou ultrapassa 90% da duração do vídeo
- **THEN** o sistema registra o `videoId` em `dismissedVideos` e remove o `videoId` de `watchLaterVideos` (se presente), para que o vídeo não apareça mais pendente nem na fila principal nem em "Ver depois"

### Requirement: Cancelamento de inscrição do canal direto pelo card
O sistema SHALL cancelar a inscrição do canal no YouTube, ocultar todos os cards daquele canal no feed imediatamente e remover todos os vídeos daquele canal presentes em `watchLaterVideos` após o usuário confirmar a ação de desinscrição.

#### Scenario: Confirmação de desinscrição bem-sucedida
- **WHEN** o usuário clica no botão no estado "Confirmar?"
- **THEN** o sistema executa o cancelamento da inscrição do canal no YouTube, oculta imediatamente todos os cards pertencentes àquele canal na tela e remove todos os vídeos do canal que estavam salvos em `watchLaterVideos`

#### Scenario: Falha na requisição direta de desinscrição
- **WHEN** a requisição interna de desinscrição falha ou não possui os tokens necessários
- **THEN** o sistema aciona o fluxo de fallback automatizado na interface do YouTube para concluir o cancelamento ou notifica o erro claramente ao usuário
