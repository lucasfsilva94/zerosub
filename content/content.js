/**
 * ZeroSub — Content Script (ISOLATED world)
 * Responsável por:
 * - Filtrar o feed https://www.youtube.com/feed/subscriptions com base em installTimestamp
 * - Parser bilíngue (PT-BR / EN-US) de datas relativas do YouTube + metadados do MAIN world
 * - Ocultar YouTube Shorts e lives agendadas conforme configuração
 * - Injetar barra de controle no topo do feed ("Modo ZeroSub / Mostrar todos" e "Zerar Feed Agora")
 * - Injetar barra de ações rápida em cada card ("Marcar como Visto" e "Desinscrever" com confirmação em 2 cliques)
 * - Monitorar páginas /watch para marcar vídeos assistidos (>=90%) automaticamente como vistos
 */

(function initZeroSubContent(rootScope) {
  const MAIN_SOURCE = 'ZEROSUB_MAIN';
  const ISOLATED_SOURCE = 'ZEROSUB_ISOLATED';
  const MAX_DISMISSED_VIDEOS = 5000;
  const CONFIRM_TIMEOUT_MS = 4000;

  const UNIT_TO_MS = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };

  /**
   * Converte uma string de tempo relativo do YouTube (PT-BR ou EN-US) em um timestamp estimado (ms).
   * Exemplos suportados:
   * - "há 2 horas", "Transmitido há 3 dias", "há 1 minuto", "há poucos segundos", "agora mesmo"
   * - "2 hours ago", "Streamed 3 days ago", "1 minute ago", "just now", "a moment ago"
   *
   * @param {string} rawText Texto exibido no metadado do vídeo
   * @param {number} [nowMs=Date.now()] Timestamp de referência
   * @returns {number | null} Timestamp estimado de publicação em ms, ou null se não reconhecido
   */
  function parseRelativeTime(rawText, nowMs = Date.now()) {
    if (!rawText || typeof rawText !== 'string') return null;

    const normalized = rawText
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    if (!normalized) return null;

    // Expressões de publicação imediata ("agora mesmo", "há poucos segundos", "just now", "a moment ago")
    if (
      /\b(agora mesmo|ha poucos segundos|neste instante|just now|a moment ago|seconds ago)\b/.test(
        normalized
      ) &&
      !/\d+/.test(normalized)
    ) {
      return nowMs - 5000;
    }

    // Padrão PT-BR: "há X <unidade>" ou "transmitido há X <unidade>"
    const ptMatch = normalized.match(
      /(?:ha\s+)?(\d+|um|uma)\s*(segundo|segundos|seg|minuto|minutos|min|hora|horas|h|dia|dias|semana|semanas|mes|meses|ano|anos)\b/
    );
    if (ptMatch && (normalized.includes('ha ') || normalized.startsWith('ha'))) {
      const rawAmount = ptMatch[1];
      const amount = rawAmount === 'um' || rawAmount === 'uma' ? 1 : parseInt(rawAmount, 10);
      const unitRaw = ptMatch[2];
      const unitKey = mapUnitToKey(unitRaw);
      if (unitKey && !Number.isNaN(amount)) {
        return nowMs - amount * UNIT_TO_MS[unitKey];
      }
    }

    // Padrão EN-US: "X <unit> ago" ou "Streamed X <unit> ago"
    const enMatch = normalized.match(
      /(\d+|a|an)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|year|years)\s+ago\b/
    );
    if (enMatch) {
      const rawAmount = enMatch[1];
      const amount = rawAmount === 'a' || rawAmount === 'an' ? 1 : parseInt(rawAmount, 10);
      const unitRaw = enMatch[2];
      const unitKey = mapUnitToKey(unitRaw);
      if (unitKey && !Number.isNaN(amount)) {
        return nowMs - amount * UNIT_TO_MS[unitKey];
      }
    }

    return null;
  }

  /**
   * Mapeia nome de unidade em PT ou EN para chave canônica em UNIT_TO_MS.
   * @param {string} unit
   * @returns {keyof typeof UNIT_TO_MS | null}
   */
  function mapUnitToKey(unit) {
    switch (unit) {
      case 'segundo':
      case 'segundos':
      case 'seg':
      case 'second':
      case 'seconds':
      case 'sec':
      case 'secs':
        return 'second';
      case 'minuto':
      case 'minutos':
      case 'min':
      case 'mins':
      case 'minute':
      case 'minutes':
        return 'minute';
      case 'hora':
      case 'horas':
      case 'h':
      case 'hr':
      case 'hrs':
      case 'hour':
      case 'hours':
        return 'hour';
      case 'dia':
      case 'dias':
      case 'day':
      case 'days':
        return 'day';
      case 'semana':
      case 'semanas':
      case 'week':
      case 'weeks':
        return 'week';
      case 'mes':
      case 'meses':
      case 'month':
      case 'months':
        return 'month';
      case 'ano':
      case 'anos':
      case 'year':
      case 'years':
        return 'year';
      default:
        return null;
    }
  }

  /**
   * Extrai o videoId de uma URL ou href do YouTube (/watch?v=ID ou /shorts/ID).
   * @param {string} href
   * @returns {string}
   */
  function extractVideoIdFromHref(href) {
    if (!href || typeof href !== 'string') return '';
    const shortsMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
    if (shortsMatch) return shortsMatch[1];

    const watchMatch = href.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
    if (watchMatch) return watchMatch[1];

    return '';
  }

  /**
   * Detecta se um texto ou metadado indica transmissão ao vivo agendada/futura (Upcoming / Premiere).
   * @param {string} text
   * @returns {boolean}
   */
  function isScheduledLiveText(text) {
    if (!text || typeof text !== 'string') return false;
    const normalized = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return /\b(programado para|scheduled for|estreia em|premieres|premiere|em breve|upcoming|definir lembrete|set reminder|notify me|notificar-me)\b/.test(
      normalized
    );
  }

  /**
   * Decide se um card de vídeo deve ficar oculto ou visível com base no estado atual do ZeroSub.
   *
   * @param {{
   *   videoId: string,
   *   channelKey?: string,
   *   channelId?: string,
   *   channelHandle?: string,
   *   publishedTimestamp: number | null,
   *   isShort: boolean,
   *   isUpcoming: boolean,
   *   isLiveNow?: boolean
   * }} cardMeta
   * @param {{
   *   installTimestamp: number,
   *   zeroSubEnabled: boolean,
   *   hideShorts: boolean,
   *   hideScheduledLives: boolean,
   *   dismissedVideos: Set<string> | string[],
   *   unsubscribedChannels: Set<string> | string[]
   * }} state
   * @returns {{ hidden: boolean, reason: string | null }}
   */
  function evaluateCardVisibility(cardMeta, state) {
    const unsubSet =
      state.unsubscribedChannels instanceof Set
        ? state.unsubscribedChannels
        : new Set(state.unsubscribedChannels || []);

    // Canais recém-desinscritos permanecem ocultos imediatamente na tela
    if (
      (cardMeta.channelId && unsubSet.has(cardMeta.channelId)) ||
      (cardMeta.channelHandle && unsubSet.has(cardMeta.channelHandle)) ||
      (cardMeta.channelKey && unsubSet.has(cardMeta.channelKey))
    ) {
      return { hidden: true, reason: 'unsubscribed-channel' };
    }

    // Quando o usuário alterna para "Mostrar todos" (zeroSubEnabled === false), exibe tudo
    if (!state.zeroSubEnabled) {
      return { hidden: false, reason: null };
    }

    const dismissedSet =
      state.dismissedVideos instanceof Set
        ? state.dismissedVideos
        : new Set(state.dismissedVideos || []);

    if (cardMeta.videoId && dismissedSet.has(cardMeta.videoId)) {
      return { hidden: true, reason: 'dismissed' };
    }

    if (state.hideShorts && cardMeta.isShort) {
      return { hidden: true, reason: 'short' };
    }

    if (state.hideScheduledLives && cardMeta.isUpcoming && !cardMeta.isLiveNow) {
      return { hidden: true, reason: 'scheduled-live' };
    }

    if (
      typeof cardMeta.publishedTimestamp === 'number' &&
      typeof state.installTimestamp === 'number' &&
      cardMeta.publishedTimestamp < state.installTimestamp
    ) {
      return { hidden: true, reason: 'before-baseline' };
    }

    return { hidden: false, reason: null };
  }

  /**
   * Verifica se o progresso de reprodução atingiu >= 90% para marcação automática como visto.
   *
   * @param {number} currentTime Segundos atuais
   * @param {number} duration Duração total em segundos
   * @returns {boolean}
   */
  function shouldAutoMarkWatched(currentTime, duration) {
    if (
      typeof currentTime !== 'number' ||
      typeof duration !== 'number' ||
      Number.isNaN(currentTime) ||
      Number.isNaN(duration) ||
      duration <= 0
    ) {
      return false;
    }
    return currentTime / duration >= 0.9;
  }

  /**
   * Adiciona um videoId à lista de vídeos dispensados mantendo o limite FIFO.
   *
   * @param {string[]} currentList
   * @param {string} videoId
   * @param {number} [maxItems=MAX_DISMISSED_VIDEOS]
   * @returns {string[]}
   */
  function appendDismissedVideo(currentList, videoId, maxItems = MAX_DISMISSED_VIDEOS) {
    if (!videoId) return Array.isArray(currentList) ? [...currentList] : [];
    const list = Array.isArray(currentList) ? currentList.filter((id) => id !== videoId) : [];
    list.push(videoId);
    if (list.length > maxItems) {
      return list.slice(list.length - maxItems);
    }
    return list;
  }

  /**
   * Cria um controlador de confirmação em 2 cliques para o botão "Desinscrever".
   * No 1º clique entra no estado "Confirmar?" por 4 segundos; no 2º clique confirma a ação.
   *
   * @param {{
   *   onEnterConfirm?: () => void,
   *   onReset?: () => void,
   *   onConfirmed: () => void,
   *   timeoutMs?: number
   * }} callbacks
   */
  function createTwoStepConfirmation(callbacks) {
    const timeoutMs = callbacks.timeoutMs || CONFIRM_TIMEOUT_MS;
    let confirming = false;
    let timerId = null;

    function reset() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      confirming = false;
      if (typeof callbacks.onReset === 'function') {
        callbacks.onReset();
      }
    }

    function trigger() {
      if (!confirming) {
        confirming = true;
        if (typeof callbacks.onEnterConfirm === 'function') {
          callbacks.onEnterConfirm();
        }
        timerId = setTimeout(() => {
          timerId = null;
          confirming = false;
          if (typeof callbacks.onReset === 'function') {
            callbacks.onReset();
          }
        }, timeoutMs);
        return 'confirming';
      }

      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      confirming = false;
      if (typeof callbacks.onConfirmed === 'function') {
        callbacks.onConfirmed();
      }
      return 'confirmed';
    }

    return {
      trigger,
      reset,
      isConfirming: () => confirming
    };
  }

  // =========================================================================
  // Execução no DOM do YouTube (quando rodando no navegador)
  // =========================================================================

  const metadataCache = new Map(); // videoId -> metadata from MAIN world + firstSeenTimestamp
  const pendingUnsubscribeCallbacks = new Map(); // requestId -> resolve

  const runtimeState = {
    installTimestamp: Date.now(),
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    autoMarkWatched: true,
    dismissedVideos: new Set(),
    unsubscribedChannels: new Set(),
    pendingCount: 0,
    loaded: false
  };

  let feedObserver = null;
  let scheduledScanFrame = null;
  let lastAutoMarkedVideoId = '';

  /**
   * Carrega o estado salvo em chrome.storage.local.
   */
  async function loadStateFromStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      runtimeState.loaded = true;
      return;
    }

    const data = await chrome.storage.local.get([
      'installTimestamp',
      'zeroSubEnabled',
      'hideShorts',
      'hideScheduledLives',
      'autoMarkWatched',
      'dismissedVideos',
      'unsubscribedChannels',
      'pendingCount'
    ]);

    if (typeof data.installTimestamp === 'number') {
      runtimeState.installTimestamp = data.installTimestamp;
    } else {
      runtimeState.installTimestamp = Date.now();
      await chrome.storage.local.set({ installTimestamp: runtimeState.installTimestamp });
    }

    runtimeState.zeroSubEnabled = data.zeroSubEnabled !== false;
    runtimeState.hideShorts = data.hideShorts !== false;
    runtimeState.hideScheduledLives = data.hideScheduledLives !== false;
    runtimeState.autoMarkWatched = data.autoMarkWatched !== false;
    runtimeState.dismissedVideos = new Set(
      Array.isArray(data.dismissedVideos) ? data.dismissedVideos : []
    );
    runtimeState.unsubscribedChannels = new Set(
      Array.isArray(data.unsubscribedChannels) ? data.unsubscribedChannels : []
    );
    runtimeState.loaded = true;
  }

  /**
   * Verifica se a página atual é /feed/subscriptions.
   * @returns {boolean}
   */
  function isSubscriptionsPage() {
    if (typeof location === 'undefined') return false;
    return location.pathname.startsWith('/feed/subscriptions');
  }

  /**
   * Verifica se a página atual é /watch.
   * @returns {boolean}
   */
  function isWatchPage() {
    if (typeof location === 'undefined') return false;
    return location.pathname.startsWith('/watch');
  }

  /**
   * Extrai metadados de um elemento de card de vídeo do DOM, combinando com o cache do MAIN world.
   * @param {Element} cardEl
   */
  function inspectCardElement(cardEl) {
    const linkEl = cardEl.querySelector(
      'a#thumbnail[href], a#video-title-link[href], a#video-title[href], a.yt-lockup-view-model__content-image[href], a[href*="/watch?v="], a[href*="/shorts/"]'
    );
    const href = linkEl ? linkEl.getAttribute('href') || '' : '';
    const videoId = extractVideoIdFromHref(href) || cardEl.getAttribute('data-zerosub-video-id') || '';

    if (videoId) {
      cardEl.setAttribute('data-zerosub-video-id', videoId);
    }

    const cached = videoId ? metadataCache.get(videoId) : null;

    // Canal a partir do DOM ou cache
    const channelLinkEl = cardEl.querySelector(
      'ytd-channel-name a[href], #channel-name a[href], a.yt-simple-endpoint[href^="/@"], a.yt-simple-endpoint[href^="/channel/"], a[href^="/@"], a[href^="/channel/"]'
    );
    const domChannelHref = channelLinkEl ? channelLinkEl.getAttribute('href') || '' : '';
    const domChannelName = channelLinkEl ? (channelLinkEl.textContent || '').trim() : '';

    let channelId = (cached && cached.channelId) || '';
    let channelHandle = (cached && cached.channelHandle) || '';

    if (!channelId && domChannelHref.startsWith('/channel/')) {
      channelId = domChannelHref.replace('/channel/', '').split(/[/?#]/)[0];
    }
    if (!channelHandle && domChannelHref) {
      channelHandle = domChannelHref.split(/[?#]/)[0];
    }

    const channelKey = channelId || channelHandle || domChannelName || '';
    if (channelKey) {
      cardEl.setAttribute('data-zerosub-channel-key', channelKey);
    }

    // Texto de data/metadados no DOM
    const metadataSpans = Array.from(
      cardEl.querySelectorAll(
        '#metadata-line span, .yt-content-metadata-view-model__metadata-text, ytd-video-meta-block span'
      )
    );
    const metadataTexts = metadataSpans.map((s) => (s.textContent || '').trim()).filter(Boolean);
    const combinedDomText = metadataTexts.join(' | ');

    // Detecta Shorts
    const isShort =
      Boolean(cached && cached.isShort) ||
      href.includes('/shorts/') ||
      Boolean(cardEl.querySelector('a[href*="/shorts/"], [overlay-style="SHORTS"], ytd-reel-item-renderer, ytm-shorts-lockup-view-model'));

    // Detecta Live em andamento vs Live agendada/futura
    const hasLiveBadge = Boolean(
      (cached && cached.isLive) ||
        cardEl.querySelector(
          '[overlay-style="LIVE"], .badge-style-type-live-now, .badge-style-type-live-now-alternate'
        )
    );

    const hasUpcomingOverlay = Boolean(
      cardEl.querySelector(
        '[overlay-style="UPCOMING"], ytd-toggle-button-renderer[is-icon-button]'
      ) || isScheduledLiveText(combinedDomText)
    );

    const isUpcoming = Boolean((cached && cached.isUpcoming) || hasUpcomingOverlay);

    // Calcula e memoriza o publishedTimestamp para não oscilar com o passar do tempo na sessão
    let publishedTimestamp = cached && typeof cached.estimatedTimestamp === 'number'
      ? cached.estimatedTimestamp
      : null;

    if (publishedTimestamp === null) {
      const candidateTexts = [];
      if (cached && cached.publishedTimeText) {
        candidateTexts.push(cached.publishedTimeText);
      }
      candidateTexts.push(...metadataTexts);

      for (const txt of candidateTexts) {
        const parsed = parseRelativeTime(txt);
        if (parsed !== null) {
          publishedTimestamp = parsed;
          break;
        }
      }

      if (publishedTimestamp !== null && videoId) {
        metadataCache.set(videoId, {
          ...(cached || { videoId }),
          channelId,
          channelHandle,
          isShort,
          isUpcoming,
          isLive: hasLiveBadge,
          estimatedTimestamp: publishedTimestamp
        });
      }
    }

    return {
      videoId,
      channelId,
      channelHandle,
      channelKey,
      publishedTimestamp,
      isShort,
      isUpcoming,
      isLiveNow: hasLiveBadge
    };
  }

  /**
   * Dispensa manualmente um vídeo ("Marcar como Visto") com animação suave.
   * @param {string} videoId
   * @param {Element} cardEl
   */
  async function dismissVideoCard(videoId, cardEl) {
    if (!videoId) return;

    runtimeState.dismissedVideos.add(videoId);
    cardEl.classList.add('zerosub-card-dismissing');

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(['dismissedVideos']);
      const updated = appendDismissedVideo(data.dismissedVideos || [], videoId);
      await chrome.storage.local.set({ dismissedVideos: updated });
    }

    setTimeout(() => {
      cardEl.classList.remove('zerosub-card-dismissing');
      cardEl.classList.add('zerosub-hidden');
      updateFeedCounters();
    }, 220);
  }

  /**
   * Solicita ao MAIN world (injector.js) o cancelamento da inscrição via InnerTube API.
   * Caso falhe, executa fallback UI abrindo/acionando o canal ou notificando o usuário.
   *
   * @param {{ channelId: string, channelHandle: string, channelKey: string }} channelInfo
   * @param {HTMLElement} buttonEl
   */
  async function handleConfirmedUnsubscribe(channelInfo, buttonEl) {
    const { channelId, channelHandle, channelKey } = channelInfo;
    buttonEl.disabled = true;
    buttonEl.textContent = 'Cancelando...';
    buttonEl.classList.remove('zerosub-btn-confirming');

    // Oculta imediatamente todos os cards desse canal na tela
    if (channelId) runtimeState.unsubscribedChannels.add(channelId);
    if (channelHandle) runtimeState.unsubscribedChannels.add(channelHandle);
    if (channelKey) runtimeState.unsubscribedChannels.add(channelKey);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get(['unsubscribedChannels']);
      const list = new Set(Array.isArray(stored.unsubscribedChannels) ? stored.unsubscribedChannels : []);
      if (channelId) list.add(channelId);
      if (channelHandle) list.add(channelHandle);
      if (channelKey) list.add(channelKey);
      await chrome.storage.local.set({ unsubscribedChannels: Array.from(list) });
    }

    hideAllCardsForChannel(channelKey, channelId, channelHandle);

    // Envia comando para o MAIN world executar o POST /youtubei/v1/subscription/unsubscribe
    const apiResult = await requestMainWorldUnsubscribe(channelId, channelHandle);
    if (!apiResult.ok) {
      // Fallback UI: tenta acionar fluxo via iframe/página do canal ou avisa no banner
      triggerUnsubscribeFallback(channelId, channelHandle);
    }
  }

  /**
   * Envia mensagem ao MAIN world e aguarda resposta com timeout de 5 segundos.
   * @param {string} channelId
   * @param {string} channelHandle
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  function requestMainWorldUnsubscribe(channelId, channelHandle) {
    return new Promise((resolve) => {
      const requestId = `unsub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        pendingUnsubscribeCallbacks.delete(requestId);
        resolve({ ok: false, error: 'Timeout na resposta do MAIN world' });
      }, 5000);

      pendingUnsubscribeCallbacks.set(requestId, (result) => {
        clearTimeout(timer);
        pendingUnsubscribeCallbacks.delete(requestId);
        resolve(result);
      });

      window.postMessage(
        {
          source: ISOLATED_SOURCE,
          type: 'UNSUBSCRIBE_CHANNEL',
          requestId,
          channelId,
          channelHandle
        },
        '*'
      );
    });
  }

  /**
   * Fallback UI quando a requisição direta InnerTube não puder ser concluída.
   * Abre a página do canal em uma aba/janela auxiliar com parâmetro para confirmar ou exibe toast com link direto.
   * @param {string} channelId
   * @param {string} channelHandle
   */
  function triggerUnsubscribeFallback(channelId, channelHandle) {
    const channelUrl = channelHandle
      ? `https://www.youtube.com${channelHandle.startsWith('/') ? '' : '/'}${channelHandle}`
      : channelId
        ? `https://www.youtube.com/channel/${channelId}`
        : '';

    showZeroSubToast(
      channelUrl
        ? 'Vídeos do canal ocultados. Finalize a desinscrição na página do canal se necessário.'
        : 'Vídeos do canal ocultados do feed.',
      channelUrl
    );
  }

  /**
   * Oculta com transição suave todos os cards pertencentes ao canal informado.
   * @param {string} channelKey
   * @param {string} channelId
   * @param {string} channelHandle
   */
  function hideAllCardsForChannel(channelKey, channelId, channelHandle) {
    if (typeof document === 'undefined') return;
    const cards = document.querySelectorAll(
      'ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer, ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer'
    );

    cards.forEach((card) => {
      const meta = inspectCardElement(card);
      const matches =
        (channelKey && meta.channelKey === channelKey) ||
        (channelId && meta.channelId === channelId) ||
        (channelHandle && meta.channelHandle === channelHandle);

      if (matches) {
        card.classList.add('zerosub-card-dismissing');
        setTimeout(() => {
          card.classList.remove('zerosub-card-dismissing');
          card.classList.add('zerosub-hidden');
          updateFeedCounters();
        }, 220);
      }
    });
  }

  /**
   * Injeta de forma idempotente a barra de ações rápida ("Marcar como Visto" e "Desinscrever") no card.
   * @param {Element} cardEl
   * @param {ReturnType<typeof inspectCardElement>} cardMeta
   */
  function ensureCardActionBar(cardEl, cardMeta) {
    let actionBar = cardEl.querySelector('.zerosub-card-actions');
    if (actionBar) {
      if (cardMeta.videoId) {
        actionBar.setAttribute('data-video-id', cardMeta.videoId);
      }
      return;
    }

    actionBar = document.createElement('div');
    actionBar.className = 'zerosub-card-actions';
    if (cardMeta.videoId) {
      actionBar.setAttribute('data-video-id', cardMeta.videoId);
    }

    // 1. Botão "Marcar como Visto"
    const markSeenBtn = document.createElement('button');
    markSeenBtn.type = 'button';
    markSeenBtn.className = 'zerosub-btn zerosub-btn-seen';
    markSeenBtn.title = 'Marcar vídeo como visto e remover da fila';
    markSeenBtn.innerHTML = '<span class="zerosub-icon">✓</span><span>Visto</span>';

    markSeenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const latestMeta = inspectCardElement(cardEl);
      dismissVideoCard(latestMeta.videoId, cardEl);
    });

    // 2. Botão "Desinscrever" com confirmação em duas etapas
    const unsubBtn = document.createElement('button');
    unsubBtn.type = 'button';
    unsubBtn.className = 'zerosub-btn zerosub-btn-unsub';
    unsubBtn.title = 'Cancelar inscrição deste canal (clique duas vezes para confirmar)';
    unsubBtn.textContent = 'Desinscrever';

    const confirmController = createTwoStepConfirmation({
      timeoutMs: CONFIRM_TIMEOUT_MS,
      onEnterConfirm() {
        unsubBtn.textContent = 'Confirmar?';
        unsubBtn.classList.add('zerosub-btn-confirming');
      },
      onReset() {
        unsubBtn.textContent = 'Desinscrever';
        unsubBtn.classList.remove('zerosub-btn-confirming');
      },
      onConfirmed() {
        const latestMeta = inspectCardElement(cardEl);
        handleConfirmedUnsubscribe(latestMeta, unsubBtn);
      }
    });

    unsubBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      confirmController.trigger();
    });

    actionBar.appendChild(markSeenBtn);
    actionBar.appendChild(unsubBtn);

    const detailsContainer =
      cardEl.querySelector('#dismissible') ||
      cardEl.querySelector('ytd-rich-grid-media') ||
      cardEl.querySelector('.yt-lockup-view-model') ||
      cardEl;

    detailsContainer.appendChild(actionBar);
  }

  /**
   * Injeta ou atualiza a barra de controle discreta do ZeroSub no topo da página de inscrições.
   */
  function ensureTopToolbar() {
    if (typeof document === 'undefined' || !isSubscriptionsPage()) return;

    const browseContainer = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    if (!browseContainer) return;

    let toolbar = browseContainer.querySelector('#zerosub-top-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'zerosub-top-toolbar';
      toolbar.className = 'zerosub-toolbar';

      toolbar.innerHTML = `
        <div class="zerosub-toolbar-left">
          <span class="zerosub-badge-logo">ZeroSub</span>
          <span id="zerosub-toolbar-status" class="zerosub-toolbar-status"></span>
        </div>
        <div class="zerosub-toolbar-actions">
          <button type="button" id="zerosub-toggle-mode-btn" class="zerosub-toolbar-btn"></button>
          <button type="button" id="zerosub-reset-now-btn" class="zerosub-toolbar-btn zerosub-toolbar-btn-primary">
            Zerar Feed Agora
          </button>
        </div>
      `;

      const targetParent =
        browseContainer.querySelector('#primary') ||
        browseContainer.querySelector('ytd-two-column-browse-results-renderer') ||
        browseContainer;

      targetParent.insertBefore(toolbar, targetParent.firstChild);

      const toggleBtn = toolbar.querySelector('#zerosub-toggle-mode-btn');
      const resetBtn = toolbar.querySelector('#zerosub-reset-now-btn');

      toggleBtn.addEventListener('click', async () => {
        const nextMode = !runtimeState.zeroSubEnabled;
        runtimeState.zeroSubEnabled = nextMode;
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ zeroSubEnabled: nextMode });
        }
        processSubscriptionsFeed();
      });

      resetBtn.addEventListener('click', async () => {
        await resetFeedToNow();
      });
    }

    updateToolbarUI();
  }

  /**
   * Redefine o installTimestamp para Date.now() e dispensa os vídeos atualmente renderizados na fila
   * para garantir que o feed fique 100% zerado imediatamente.
   */
  async function resetFeedToNow() {
    const now = Date.now();
    runtimeState.installTimestamp = now;
    runtimeState.zeroSubEnabled = true;

    // Também adiciona os vídeos atualmente visíveis em dismissedVideos para evitar imprecisão de arredondamento ("há 1 minuto")
    const visibleCards = document.querySelectorAll(
      'ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:not(.zerosub-hidden), ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer:not(.zerosub-hidden)'
    );
    visibleCards.forEach((card) => {
      const meta = inspectCardElement(card);
      if (meta.videoId) {
        runtimeState.dismissedVideos.add(meta.videoId);
      }
    });

    const dismissedArray = Array.from(runtimeState.dismissedVideos).slice(-MAX_DISMISSED_VIDEOS);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        installTimestamp: now,
        zeroSubEnabled: true,
        dismissedVideos: dismissedArray,
        pendingCount: 0
      });
    }

    processSubscriptionsFeed();
    showZeroSubToast('Marco Zero atualizado! Fila de inscrições zerada.');
  }

  /**
   * Atualiza os textos da barra superior no feed de inscrições.
   */
  function updateToolbarUI() {
    if (typeof document === 'undefined') return;
    const toolbar = document.getElementById('zerosub-top-toolbar');
    if (!toolbar) return;

    const statusEl = toolbar.querySelector('#zerosub-toolbar-status');
    const toggleBtn = toolbar.querySelector('#zerosub-toggle-mode-btn');

    const dateFormatted = new Date(runtimeState.installTimestamp).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (statusEl) {
      if (runtimeState.zeroSubEnabled) {
        statusEl.textContent = `${runtimeState.pendingCount} vídeo(s) na fila • Desde ${dateFormatted}`;
      } else {
        statusEl.textContent = `Modo Mostrar Todos ativo (histórico completo visível)`;
      }
    }

    if (toggleBtn) {
      toggleBtn.textContent = runtimeState.zeroSubEnabled
        ? 'Mostrar todos'
        : 'Ativar Modo ZeroSub';
      toggleBtn.classList.toggle('zerosub-mode-off', !runtimeState.zeroSubEnabled);
    }
  }

  /**
   * Exibe uma notificação discreta (toast) no canto inferior da tela.
   * @param {string} message
   * @param {string} [actionUrl]
   */
  function showZeroSubToast(message, actionUrl = '') {
    if (typeof document === 'undefined') return;
    let existing = document.getElementById('zerosub-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'zerosub-toast';
    toast.className = 'zerosub-toast';

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (actionUrl) {
      const link = document.createElement('a');
      link.href = actionUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'zerosub-toast-link';
      link.textContent = 'Abrir canal';
      toast.appendChild(link);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4500);
  }

  /**
   * Processa as prateleiras de Shorts (ytd-rich-section-renderer / ytd-reel-shelf-renderer)
   * e todos os cards de vídeo da página de inscrições.
   */
  function processSubscriptionsFeed() {
    if (typeof document === 'undefined' || !isSubscriptionsPage() || !runtimeState.loaded) {
      return;
    }

    ensureTopToolbar();

    const browseRoot = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    if (!browseRoot) return;

    // 1. Filtra seções inteiras de Shorts (prateleiras de Shorts no feed de inscrições)
    const richSections = browseRoot.querySelectorAll(
      'ytd-rich-section-renderer, ytd-reel-shelf-renderer'
    );
    richSections.forEach((section) => {
      const isShortsShelf =
        section.tagName.toLowerCase() === 'ytd-reel-shelf-renderer' ||
        Boolean(
          section.querySelector(
            'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, a[href*="/shorts/"]'
          )
        );

      if (isShortsShelf) {
        const shouldHideShelf = runtimeState.zeroSubEnabled && runtimeState.hideShorts;
        section.classList.toggle('zerosub-hidden', shouldHideShelf);
      }
    });

    // 2. Avalia cada card de vídeo individual
    const cards = browseRoot.querySelectorAll('ytd-rich-item-renderer, ytd-grid-video-renderer');
    let visibleCount = 0;

    cards.forEach((card) => {
      const cardMeta = inspectCardElement(card);
      const decision = evaluateCardVisibility(cardMeta, runtimeState);

      if (decision.hidden) {
        card.classList.add('zerosub-hidden');
        card.setAttribute('data-zerosub-hidden-reason', decision.reason || 'filtered');
      } else {
        card.classList.remove('zerosub-hidden');
        card.removeAttribute('data-zerosub-hidden-reason');
        ensureCardActionBar(card, cardMeta);
        visibleCount++;
      }
    });

    runtimeState.pendingCount = visibleCount;
    updateToolbarUI();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ pendingCount: visibleCount });
    }
  }

  /**
   * Atualiza o contador de vídeos visíveis na fila sem reprocessar tudo do zero.
   */
  function updateFeedCounters() {
    if (typeof document === 'undefined' || !isSubscriptionsPage()) return;
    const browseRoot = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    if (!browseRoot) return;

    const visibleCards = browseRoot.querySelectorAll(
      'ytd-rich-item-renderer:not(.zerosub-hidden), ytd-grid-video-renderer:not(.zerosub-hidden)'
    );
    runtimeState.pendingCount = visibleCards.length;
    updateToolbarUI();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ pendingCount: visibleCards.length });
    }
  }

  /**
   * Agenda uma varredura do feed usando requestAnimationFrame para agrupar mutações do DOM.
   */
  function scheduleFeedScan() {
    if (scheduledScanFrame !== null) return;
    const scheduler =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 50);

    scheduledScanFrame = scheduler(() => {
      scheduledScanFrame = null;
      processSubscriptionsFeed();
    });
  }

  /**
   * Configura o MutationObserver sobre o container de inscrições ou o ytd-app.
   */
  function setupMutationObserver() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    if (feedObserver) {
      feedObserver.disconnect();
    }

    const target =
      document.querySelector('ytd-browse[page-subtype="subscriptions"]') ||
      document.querySelector('ytd-app') ||
      document.body;

    if (!target) return;

    feedObserver = new MutationObserver((mutations) => {
      if (!isSubscriptionsPage()) return;
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          scheduleFeedScan();
          break;
        }
      }
    });

    feedObserver.observe(target, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Monitora o player de vídeo em páginas /watch para marcar automaticamente como visto ao atingir >=90%.
   */
  function setupWatchProgressTracker() {
    if (typeof document === 'undefined' || !isWatchPage()) return;

    const videoEl = document.querySelector('video.html5-main-video, video');
    if (!videoEl || videoEl.__zeroSubTrackerAttached) return;
    videoEl.__zeroSubTrackerAttached = true;

    videoEl.addEventListener('timeupdate', async () => {
      if (!runtimeState.autoMarkWatched || !isWatchPage()) return;

      if (shouldAutoMarkWatched(videoEl.currentTime, videoEl.duration)) {
        const currentVideoId = extractVideoIdFromHref(location.href);
        if (!currentVideoId || currentVideoId === lastAutoMarkedVideoId) return;
        if (runtimeState.dismissedVideos.has(currentVideoId)) return;

        lastAutoMarkedVideoId = currentVideoId;
        runtimeState.dismissedVideos.add(currentVideoId);

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const data = await chrome.storage.local.get(['dismissedVideos']);
          const updated = appendDismissedVideo(data.dismissedVideos || [], currentVideoId);
          await chrome.storage.local.set({ dismissedVideos: updated });
        }
      }
    });
  }

  /**
   * Inicializa listeners de navegação SPA, mensagens do MAIN world e alterações do chrome.storage.
   */
  async function startBrowserLifecycle() {
    await loadStateFromStorage();

    // Escuta mensagens vindas do content/injector.js (MAIN world)
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data || event.data.source !== MAIN_SOURCE) {
        return;
      }

      const { type, items, requestId } = event.data;

      if (type === 'METADATA_BATCH' && Array.isArray(items)) {
        for (const item of items) {
          if (!item || !item.videoId) continue;
          const prev = metadataCache.get(item.videoId) || {};
          const parsedTime = item.publishedTimeText
            ? parseRelativeTime(item.publishedTimeText)
            : null;

          metadataCache.set(item.videoId, {
            ...prev,
            ...item,
            estimatedTimestamp:
              typeof prev.estimatedTimestamp === 'number'
                ? prev.estimatedTimestamp
                : parsedTime
          });
        }
        if (isSubscriptionsPage()) {
          scheduleFeedScan();
        }
      } else if (type === 'UNSUBSCRIBE_RESULT' && requestId) {
        const resolver = pendingUnsubscribeCallbacks.get(requestId);
        if (resolver) {
          resolver(event.data);
        }
      }
    });

    // Escuta alterações nas configurações ou ações disparadas pelo Popup
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        let needsRescan = false;

        if (changes.installTimestamp && typeof changes.installTimestamp.newValue === 'number') {
          runtimeState.installTimestamp = changes.installTimestamp.newValue;
          needsRescan = true;
        }
        if (changes.zeroSubEnabled !== undefined) {
          runtimeState.zeroSubEnabled = changes.zeroSubEnabled.newValue !== false;
          needsRescan = true;
        }
        if (changes.hideShorts !== undefined) {
          runtimeState.hideShorts = changes.hideShorts.newValue !== false;
          needsRescan = true;
        }
        if (changes.hideScheduledLives !== undefined) {
          runtimeState.hideScheduledLives = changes.hideScheduledLives.newValue !== false;
          needsRescan = true;
        }
        if (changes.autoMarkWatched !== undefined) {
          runtimeState.autoMarkWatched = changes.autoMarkWatched.newValue !== false;
        }
        if (changes.dismissedVideos !== undefined) {
          runtimeState.dismissedVideos = new Set(changes.dismissedVideos.newValue || []);
          needsRescan = true;
        }
        if (changes.unsubscribedChannels !== undefined) {
          runtimeState.unsubscribedChannels = new Set(changes.unsubscribedChannels.newValue || []);
          needsRescan = true;
        }

        if (needsRescan && isSubscriptionsPage()) {
          processSubscriptionsFeed();
        }
      });
    }

    // Escuta mensagens diretas do Popup (ex: comando "RESET_FEED_NOW")
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || typeof msg !== 'object') return false;
        if (msg.type === 'ZEROSUB_RESET_NOW') {
          resetFeedToNow().then(() => {
            sendResponse({ ok: true, pendingCount: runtimeState.pendingCount });
          });
          return true;
        }
        if (msg.type === 'ZEROSUB_GET_PENDING_COUNT') {
          sendResponse({ ok: true, pendingCount: runtimeState.pendingCount });
          return false;
        }
        return false;
      });
    }

    // Eventos de navegação SPA do YouTube
    document.addEventListener('yt-navigate-finish', () => {
      window.postMessage({ source: ISOLATED_SOURCE, type: 'REQUEST_INITIAL_METADATA' }, '*');
      setupMutationObserver();
      if (isSubscriptionsPage()) {
        scheduleFeedScan();
      } else if (isWatchPage()) {
        setupWatchProgressTracker();
      }
    });

    // Inicialização na carga atual
    window.postMessage({ source: ISOLATED_SOURCE, type: 'REQUEST_INITIAL_METADATA' }, '*');
    setupMutationObserver();
    if (isSubscriptionsPage()) {
      processSubscriptionsFeed();
    } else if (isWatchPage()) {
      setupWatchProgressTracker();
    }
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    startBrowserLifecycle();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseRelativeTime,
      extractVideoIdFromHref,
      isScheduledLiveText,
      evaluateCardVisibility,
      shouldAutoMarkWatched,
      appendDismissedVideo,
      createTwoStepConfirmation
    };
  } else if (rootScope) {
    rootScope.ZeroSubContent = {
      parseRelativeTime,
      extractVideoIdFromHref,
      isScheduledLiveText,
      evaluateCardVisibility,
      shouldAutoMarkWatched,
      appendDismissedVideo,
      createTwoStepConfirmation
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
