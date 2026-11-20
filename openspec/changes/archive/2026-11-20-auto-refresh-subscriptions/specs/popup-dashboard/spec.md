# Spec Delta

## MODIFIED Requirements

### Requirement: Controles de configuração no popup
O sistema SHALL permitir ao usuário ativar ou desativar o Modo ZeroSub, o filtro de YouTube Shorts, o filtro de transmissões agendadas, a marcação automática ao assistir >90% e escolher o intervalo de verificação automática (`Desativado`, `5`, `10`, `15`, `30` ou `60` minutos), sincronizando as alterações em tempo real com a aba do YouTube.

#### Scenario: Alteração de toggle de configuração no popup
- **WHEN** o usuário altera qualquer opção de configuração no popup
- **THEN** o sistema persiste o novo estado no armazenamento local e atualiza imediatamente a filtragem na aba `/feed/subscriptions` aberta

#### Scenario: Alteração do intervalo de verificação automática no popup
- **WHEN** o usuário seleciona um intervalo no controle "Atualização automática" do popup (`Desativado`, `5 min`, `10 min`, `15 min`, `30 min` ou `1 hora`)
- **THEN** o sistema persiste `autoRefreshMinutes` no `chrome.storage.local` e reprograma imediatamente o temporizador na aba `/feed/subscriptions` aberta
