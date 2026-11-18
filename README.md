<div align="center">
  <img src="icons/icon-128.png" width="96" alt="ZeroSub logo" />

  # ZeroSub
  *Transforme a aba de Inscrições do YouTube em uma fila estilo Inbox Zero com triagem rápida em cada card.*

  [![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) [![Version](https://img.shields.io/badge/Version-v1.0.0-CC0000?style=flat-square&logo=youtube&logoColor=white)](https://github.com/lucasfsilva94/ZeroSub) [![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript) [![CSS3](https://img.shields.io/badge/CSS3-Dark_%26_Light-1572B6?style=flat-square&logo=css3&logoColor=white)](content/styles.css) [![Node.js Tests](https://img.shields.io/badge/Tests-node_--test-339933?style=flat-square&logo=nodedotjs&logoColor=white)](#-testes-e-qualidade) [![OpenSpec](https://img.shields.io/badge/Workflow-OpenSpec-7C3AED?style=flat-square)](openspec/changes/zerosub-chrome-extension/proposal.md)

  [Projeto](#-projeto) • [Funcionalidades](#️-funcionalidades) • [Arquitetura](#-arquitetura-e-stack) • [Estrutura](#-estrutura-do-repositório) • [Instalação](#-instalação) • [Fluxo OpenSpec](#-fluxo-spec-driven-openspec) • [Testes](#-testes-e-qualidade)
</div>

---

## 🧩 Projeto

**ZeroSub** é uma extensão para Google Chrome (Manifest V3) que transforma a página de inscrições do YouTube (`https://www.youtube.com/feed/subscriptions`) em uma fila limpa no estilo **Inbox Zero**.

Ao instalar a extensão, um **Marco Zero (`installTimestamp`)** é definido automaticamente: todo o histórico antigo fica oculto e apenas vídeos publicados a partir daquele momento entram na sua fila, acompanhados de botões integrados em cada card para **marcar como visto** ou **cancelar a inscrição do canal** sem sair do feed.

> [!NOTE]
> Especificação técnica completa disponível em [`openspec/changes/zerosub-chrome-extension/`](openspec/changes/zerosub-chrome-extension/): [`proposal.md`](openspec/changes/zerosub-chrome-extension/proposal.md) (escopo e motivação), [`design.md`](openspec/changes/zerosub-chrome-extension/design.md) (decisões arquiteturais Dual-World e InnerTube) e [`specs/`](openspec/changes/zerosub-chrome-extension/specs/) (requisitos por capacidade).

---

## ⚙️ Funcionalidades

- **Marco Zero (`installTimestamp`):** Registra o timestamp exato na instalação e oculta automaticamente vídeos anteriores na aba `/feed/subscriptions`, preservando o marco em atualizações da extensão.
- **Triagem Rápida por Card:**
  - **Marcar como Visto (`✓ Visto`):** Remove o vídeo da fila com transição suave de colapso e persiste o `videoId` em `chrome.storage.local` (até 5.000 IDs em fila FIFO).
  - **Marcação Automática (`>90%`):** Monitora o player HTML5 em páginas `/watch` e marca automaticamente o vídeo como visto ao atingir 90% da duração.
  - **Desinscrição em 2 Cliques (`Desinscrever` -> `Confirmar?`):** Primeiro clique ativa o estado de confirmação (com reset automático em 4s). O segundo clique cancela a inscrição diretamente via API interna do YouTube (`SAPISIDHASH` + `INNERTUBE_API_KEY`) com fallback UI e oculta todos os cards daquele canal na hora.
- **Filtros de Formato:** Oculta prateleiras e cards de **YouTube Shorts** (`/shorts/`) e **transmissões ao vivo agendadas/estreias futuras**, mantendo visíveis lives em andamento ou já encerradas.
- **Barra de Controle no Topo & Popup Dashboard:**
  - Contador em tempo real de vídeos pendentes na fila (refletido também no badge do ícone da extensão).
  - Alternância instantânea entre **Modo ZeroSub** e **Mostrar todos**.
  - Botão **Zerar Feed Agora / Zerar tudo agora** para redefinir o Marco Zero para o momento atual (`Date.now()`).
  - Botão **Restaurar vídeos ocultos** para recuperar vídeos dispensados manualmente por engano.
- **Integração Nativa com a SPA do YouTube:** Suporte completo à navegação sem reload (`yt-navigate-finish`), carregamento por rolagem infinita (`MutationObserver` + interceptação de `/youtubei/v1/browse`), parser temporal bilíngue (`PT-BR` e `EN-US`) e temas Claro/Escuro (`html[dark]`).

---

## 🧱 Arquitetura e Stack

| Camada | Arquivo / Tecnologia | Papel na Extensão |
|---|---|---|
| **Service Worker (MV3)** | [`background.js`](background.js) (`chrome.runtime`, `chrome.storage`, `chrome.action`) | Inicializa o `installTimestamp` e o estado padrão de forma idempotente e atualiza o badge (`99+` / `OFF`). |
| **Content Script (`MAIN`)** | [`content/injector.js`](content/injector.js) (Web Crypto API, Fetch Hook, InnerTube) | Lê `window.ytInitialData`, intercepta lotes de `/youtubei/v1/browse` e executa `POST /youtubei/v1/subscription/unsubscribe` autenticado via `SAPISIDHASH`. |
| **Content Script (`ISOLATED`)** | [`content/content.js`](content/content.js) + [`content/styles.css`](content/styles.css) | Gerencia o DOM da SPA, aplica filtros temporais com fallback bilíngue (`PT-BR`/`EN-US`), injeta a barra superior e os botões nos cards e monitora progresso em `/watch`. |
| **Popup Dashboard** | [`popup/popup.html`](popup/popup.html), [`popup/popup.js`](popup/popup.js), [`popup/popup.css`](popup/popup.css) | Painel rápido com contador de fila, reset do Marco Zero, restauração de vídeos dispensados e toggles em tempo real. |
| **Suíte de Testes** | [`tests/zerosub.test.js`](tests/zerosub.test.js) (`node:test`, `node:assert`) | Testes automatizados zero-dependency cobrindo manifesto, storage, parser temporal, `SAPISIDHASH`, filtros e UI. |

<details>
<summary>Esquema de estado em <code>chrome.storage.local</code> e comunicação Dual-World</summary>

### Ponte `MAIN` <-> `ISOLATED` (`ZEROSUB_EVENT`)
Content scripts no mundo `ISOLATED` têm acesso seguro a `chrome.storage.local`, mas não enxergam variáveis globais da página do YouTube (`window.ytInitialData` e `window.ytcfg`). O ZeroSub opera com dois scripts coordenados via `window.postMessage`:
1. **`content/injector.js` (`MAIN` world):** extrai `videoId`, `channelId`, `publishedTimeText`, flags de Shorts/Lives e assina chamadas InnerTube com SHA-1 (`SAPISIDHASH`).
2. **`content/content.js` (`ISOLATED` world):** cruza os metadados recebidos com o parser DOM bilíngue, aplica as regras de visibilidade e sincroniza qualquer alteração entre abas e popup via `chrome.storage.onChanged`.

### Chaves Persistidas (`chrome.storage.local`)

| Chave | Tipo | Padrão | Descrição |
|---|---|---|---|
| `installTimestamp` | `number` | `Date.now()` | Timestamp (ms) do Marco Zero atual. |
| `zeroSubEnabled` | `boolean` | `true` | Ativa o filtro Inbox Zero (`false` exibe todos os vídeos). |
| `hideShorts` | `boolean` | `true` | Oculta cards e prateleiras de YouTube Shorts. |
| `hideScheduledLives` | `boolean` | `true` | Oculta lives agendadas e estreias futuras. |
| `autoMarkWatched` | `boolean` | `true` | Marca vídeos como vistos ao assistir `>= 90%` em `/watch`. |
| `dismissedVideos` | `string[]` | `[]` | Lista FIFO (máx. 5.000) de `videoId` marcados como vistos. |
| `unsubscribedChannels` | `string[]` | `[]` | Canais desinscritos na sessão para ocultação imediata no DOM. |
| `pendingCount` | `number` | `0` | Total de vídeos pendentes visíveis na fila atual. |

</details>

---

## 📁 Estrutura do Repositório

```text
zeroSub/
├── content/
│   ├── injector.js             # Content script (MAIN world): ytInitialData, interceptação /browse e InnerTube unsubscribe
│   ├── content.js              # Content script (ISOLATED world): parser PT-BR/EN-US, filtros DOM, barra superior e botões nos cards
│   └── styles.css              # Estilização adaptativa aos temas Claro e Escuro (html[dark]) do YouTube
├── icons/
│   ├── icon-16.png             # Ícone 16x16 da extensão
│   ├── icon-32.png             # Ícone 32x32 da extensão
│   ├── icon-48.png             # Ícone 48x48 da extensão
│   └── icon-128.png            # Logo oficial 128x128 da extensão
├── popup/
│   ├── popup.html              # Estrutura do Popup Dashboard
│   ├── popup.js                # Lógica reativa de contadores, reset, restauração e toggles
│   └── popup.css               # Estilos minimalistas do painel popup
├── openspec/
│   ├── config.yaml             # Configuração do fluxo Spec-Driven
│   └── changes/
│       └── zerosub-chrome-extension/
│           ├── proposal.md     # Proposta de valor, escopo e capacidades
│           ├── design.md       # Arquitetura técnica e decisões de design
│           ├── tasks.md        # Plano de implementação verificado
│           └── specs/          # Especificações detalhadas (feed-baseline-filtering, video-card-triage, popup-dashboard)
├── tests/
│   └── zerosub.test.js         # Suíte de testes unitários e de integração (Node.js Test Runner)
├── background.js               # Service Worker (Manifest V3): estado inicial e badge de pendentes
├── manifest.json               # Manifesto da extensão Chrome (MV3)
└── README.md                   # Documentação do projeto
```

---

## 🚀 Instalação

A extensão é escrita em Vanilla JavaScript/CSS sem necessidade de etapa de build, podendo ser carregada diretamente no navegador:

1. Clone este repositório:
   ```bash
   git clone https://github.com/lucasfsilva94/ZeroSub.git
   ```

2. Abra o Google Chrome e acesse na barra de endereços:
   ```text
   chrome://extensions/
   ```

3. No canto superior direito, ative a chave **Modo do desenvolvedor** (*Developer mode*).

4. Clique em **Carregar sem compactação** (*Load unpacked*).

5. Selecione a pasta raiz do projeto (`zeroSub`).

6. Acesse sua página de inscrições do YouTube ([https://www.youtube.com/feed/subscriptions](https://www.youtube.com/feed/subscriptions)) para ver o **ZeroSub** em ação.

---

## 📋 Fluxo Spec-Driven (OpenSpec)

O projeto utiliza o fluxo **Spec-Driven** com **OpenSpec**, organizando propostas, decisões arquiteturais e especificações comportamentais em [`openspec/`](openspec/):

| Especificação | Escopo |
|---|---|
| [`feed-baseline-filtering`](openspec/changes/zerosub-chrome-extension/specs/feed-baseline-filtering/spec.md) | Inicialização e redefinição do `installTimestamp`, parser bilíngue (`PT-BR`/`EN-US`), suporte a SPA/scroll infinito e filtros de Shorts e lives agendadas. |
| [`video-card-triage`](openspec/changes/zerosub-chrome-extension/specs/video-card-triage/spec.md) | Barra de ações nos cards, dispensa manual com transição suave, auto-mark ao atingir `>=90%` em `/watch` e desinscrição com confirmação em 2 cliques. |
| [`popup-dashboard`](openspec/changes/zerosub-chrome-extension/specs/popup-dashboard/spec.md) | Contador de vídeos pendentes, ações rápidas (*Zerar tudo agora*, *Restaurar vídeos ocultos*) e sincronização de toggles em tempo real. |

---

## 🧪 Testes e Qualidade

A suíte automatizada utiliza o runner nativo do Node.js (`node --test`) e valida o `manifest.json`, a inicialização idempotente do `background.js`, a extração de metadados e cálculo `SAPISIDHASH` do `injector.js`, o parser de datas relativas (`PT-BR` e `EN-US`), as regras de filtragem de cards e o funcionamento do popup.

Execute todos os testes com:

```bash
node --test tests/zerosub.test.js
```
