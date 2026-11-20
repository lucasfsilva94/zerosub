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
  const MAX_WATCH_LATER_VIDEOS = 500;
  const MAX_BASELINE_ANCHORS = 30;
  const CONFIRM_TIMEOUT_MS = 4000;
  const NOT_INTERESTED_THRESHOLD = 3;

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

    const watchLaterSet = getWatchLaterIdSet(state.watchLaterVideos);
    if (cardMeta.videoId && watchLaterSet.has(cardMeta.videoId)) {
      return { hidden: true, reason: 'watch-later' };
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
   * Avalia uma lista ordenada de cards (do topo para baixo no feed cronológico de inscrições),
   * aplicando corte cronológico (cutoff) assim que um vídeo âncora (baselineAnchorIds) ou
   * anterior a installTimestamp é encontrado, ocultando tudo abaixo dele e sinalizando o bloqueio
   * da paginação infinita do YouTube no Modo ZeroSub.
   *
   * @param {Array<Parameters<typeof evaluateCardVisibility>[0]>} cardsMeta
   * @param {Parameters<typeof evaluateCardVisibility>[1] & { baselineAnchorIds?: Set<string> | string[] }} state
   */
  function evaluateFeedItems(cardsMeta, state) {
    const anchorSet =
      state.baselineAnchorIds instanceof Set
        ? state.baselineAnchorIds
        : new Set(state.baselineAnchorIds || []);

    let cutoffReached = false;
    let visibleCount = 0;
    const decisions = [];

    for (const cardMeta of cardsMeta) {
      const isNonChronological = Boolean(
        cardMeta.isLiveNow || cardMeta.isUpcoming || cardMeta.isShort
      );

      if (state.zeroSubEnabled) {
        if (cardMeta.videoId && anchorSet.has(cardMeta.videoId)) {
          if (!isNonChronological) {
            cutoffReached = true;
          }
          decisions.push({ hidden: true, reason: 'baseline-anchor' });
          continue;
        }

        if (cutoffReached) {
          const isExplicitlyNewer =
            typeof cardMeta.publishedTimestamp === 'number' &&
            typeof state.installTimestamp === 'number' &&
            cardMeta.publishedTimestamp >= state.installTimestamp;

          if (!isExplicitlyNewer) {
            decisions.push({ hidden: true, reason: 'after-cutoff' });
            continue;
          }
        }
      }

      const decision = evaluateCardVisibility(cardMeta, state);
      if (state.zeroSubEnabled && !isNonChronological && decision.reason === 'before-baseline') {
        cutoffReached = true;
      }

      if (!decision.hidden) {
        visibleCount++;
      }
      decisions.push(decision);
    }

    const shouldHideContinuation = Boolean(
      state.zeroSubEnabled && (cutoffReached || (visibleCount === 0 && anchorSet.size > 0))
    );

    return {
      decisions,
      visibleCount,
      cutoffReached,
      shouldHideContinuation
    };
  }

  /**
   * Verifica se um nó do DOM pertence à UI injetada pelo próprio ZeroSub,
   * evitando que mutações da extensão disparem loops infinitos no MutationObserver.
   *
   * @param {Node | null} node
   * @returns {boolean}
   */
  function isZeroSubOwnedNode(node) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(
      el.closest(
        '#zerosub-top-toolbar, #zerosub-watch-later-panel, #zerosub-suggestions-panel, #zerosub-empty-wrapper, #zerosub-toast, .zerosub-card-actions'
      )
    );
  }

  /**
   * Decide se o estado vazio "Inbox Zero" deve ser exibido.
   * Nunca oculta o grid nativo enquanto totalCards === 0 (página ainda hidratando após reload).
   *
   * @param {boolean} zeroSubEnabled
   * @param {number} visibleCount
   * @param {number} totalCards
   * @returns {boolean}
   */
  function shouldShowEmptyState(zeroSubEnabled, visibleCount, totalCards) {
    return Boolean(zeroSubEnabled && totalCards > 0 && visibleCount === 0);
  }

  /**
   * Determina o timestamp em que a fila ficou efetivamente limpa ("Inbox Zero").
   * Atualiza para `now` quando a fila transita de > 0 vídeos pendentes para 0 vídeos,
   * preservando o horário registrado em recarregamentos posteriores enquanto continuar zerada.
   *
   * @param {{
   *   zeroSubEnabled: boolean,
   *   prevPendingCount: number,
   *   nextPendingCount: number,
   *   totalCards: number,
   *   currentLastClearedAt: number | null | undefined,
   *   installTimestamp: number,
   *   now?: number
   * }} params
   * @returns {number | null}
   */
  function resolveClearedTimestamp({
    zeroSubEnabled,
    prevPendingCount,
    nextPendingCount,
    totalCards,
    currentLastClearedAt,
    installTimestamp,
    now = Date.now()
  }) {
    const existing =
      typeof currentLastClearedAt === 'number' && !Number.isNaN(currentLastClearedAt)
        ? currentLastClearedAt
        : null;

    if (!zeroSubEnabled || totalCards <= 0) {
      return existing;
    }

    if (nextPendingCount === 0 && prevPendingCount > 0) {
      return now;
    }

    return existing;
  }

  /**
   * Retorna o horário efetivo para exibição no banner "Sua fila está limpa desde ...".
   * Prioriza `lastClearedAt` quando registrado após o Marco Zero; caso contrário, usa o
   * evento mais recente entre o Marco Zero, o último item salvo em "Ver depois" e o último "Sem interesse".
   *
   * @param {{
   *   installTimestamp: number,
   *   lastClearedAt?: number | null,
   *   watchLaterVideos?: Array<{ savedAt?: number }>,
   *   notInterestedByChannel?: Record<string, { updatedAt?: number }>
   * }} state
   * @returns {number}
   */
  function getDisplayClearedTimestamp(state = {}) {
    const baseline =
      typeof state.installTimestamp === 'number' && !Number.isNaN(state.installTimestamp)
        ? state.installTimestamp
        : Date.now();

    const recorded =
      typeof state.lastClearedAt === 'number' && !Number.isNaN(state.lastClearedAt)
        ? state.lastClearedAt
        : null;

    if (recorded !== null && recorded > baseline) {
      return recorded;
    }

    let latest = recorded !== null ? Math.max(baseline, recorded) : baseline;

    if (Array.isArray(state.watchLaterVideos)) {
      for (const item of state.watchLaterVideos) {
        if (item && typeof item.savedAt === 'number' && item.savedAt > latest) {
          latest = item.savedAt;
        }
      }
    }

    if (state.notInterestedByChannel && typeof state.notInterestedByChannel === 'object') {
      for (const entry of Object.values(state.notInterestedByChannel)) {
        if (entry && typeof entry.updatedAt === 'number' && entry.updatedAt > latest) {
          latest = entry.updatedAt;
        }
      }
    }

    return latest;
  }

  /**
   * Registra um vídeo marcado como "Não tenho interesse" em um mapa deduplicado por canal.
   *
   * @param {Record<string, { channelKey: string, channelId: string, channelHandle: string, channelName: string, videoIds: string[], updatedAt: number }>} currentMap
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string, channelName?: string, videoId: string }} info
   * @param {number} [now=Date.now()]
   * @param {number} [threshold=NOT_INTERESTED_THRESHOLD]
   */
  function recordNotInterestedVideo(
    currentMap = {},
    info = {},
    now = Date.now(),
    threshold = NOT_INTERESTED_THRESHOLD
  ) {
    const key = info.channelKey || info.channelId || info.channelHandle || info.channelName || '';
    const updatedMap = { ...(currentMap || {}) };

    if (!key || !info.videoId) {
      return { updatedMap, entry: null, count: 0, reachedThreshold: false };
    }

    const prev = updatedMap[key];
    const prevIds = prev && Array.isArray(prev.videoIds) ? prev.videoIds : [];
    const prevCount = prevIds.length;
    const nextIds = prevIds.includes(info.videoId) ? [...prevIds] : [...prevIds, info.videoId];

    const entry = {
      channelKey: key,
      channelId: info.channelId || (prev && prev.channelId) || '',
      channelHandle: info.channelHandle || (prev && prev.channelHandle) || '',
      channelName: info.channelName || (prev && prev.channelName) || info.channelHandle || key,
      videoIds: nextIds,
      updatedAt: now
    };

    updatedMap[key] = entry;
    const count = nextIds.length;
    const reachedThreshold = prevCount < threshold && count >= threshold;

    return { updatedMap, entry, count, reachedThreshold };
  }

  /**
   * Retorna os canais elegíveis para sugestão de desinscrição (>= threshold vídeos distintos)
   * que ainda não foram desinscritos.
   *
   * @param {Record<string, any>} notInterestedMap
   * @param {Set<string> | string[]} unsubscribedChannels
   * @param {number} [threshold=NOT_INTERESTED_THRESHOLD]
   */
  function getUnsubscribeSuggestions(
    notInterestedMap = {},
    unsubscribedChannels = [],
    threshold = NOT_INTERESTED_THRESHOLD
  ) {
    const unsubSet =
      unsubscribedChannels instanceof Set
        ? unsubscribedChannels
        : new Set(unsubscribedChannels || []);

    return Object.values(notInterestedMap || {})
      .filter((entry) => {
        if (!entry || !Array.isArray(entry.videoIds) || entry.videoIds.length < threshold) {
          return false;
        }
        if (
          (entry.channelKey && unsubSet.has(entry.channelKey)) ||
          (entry.channelId && unsubSet.has(entry.channelId)) ||
          (entry.channelHandle && unsubSet.has(entry.channelHandle))
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /**
   * Remove um canal do mapa de desinteresse (usado ao clicar em "Manter canal" ou após "Desinscrever").
   *
   * @param {Record<string, any>} currentMap
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string }} info
   */
  function removeChannelFromNotInterested(currentMap = {}, info = {}) {
    const updatedMap = { ...(currentMap || {}) };
    for (const [k, entry] of Object.entries(updatedMap)) {
      const matches =
        (info.channelKey && (k === info.channelKey || (entry && entry.channelKey === info.channelKey))) ||
        (info.channelId && entry && entry.channelId === info.channelId) ||
        (info.channelHandle && entry && entry.channelHandle === info.channelHandle);
      if (matches) {
        delete updatedMap[k];
      }
    }
    return updatedMap;
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
   * Constrói a URL determinística de thumbnail de um vídeo do YouTube.
   * @param {string} videoId
   * @returns {string}
   */
  function buildVideoThumbnailUrl(videoId) {
    if (!videoId || typeof videoId !== 'string') return '';
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
  }

  /**
   * Extrai um Set de videoIds a partir de watchLaterVideos (Set<string>, string[] ou Array<{ videoId }>).
   * @param {Set<string> | Array<string | { videoId?: string }>} watchLaterVideos
   * @returns {Set<string>}
   */
  function getWatchLaterIdSet(watchLaterVideos) {
    if (watchLaterVideos instanceof Set) return watchLaterVideos;
    const set = new Set();
    if (!Array.isArray(watchLaterVideos)) return set;
    for (const item of watchLaterVideos) {
      if (typeof item === 'string' && item) {
        set.add(item);
      } else if (item && typeof item === 'object' && item.videoId) {
        set.add(item.videoId);
      }
    }
    return set;
  }

  /**
   * Insere ou atualiza um vídeo na fila "Ver depois", deduplicando por videoId e posicionando o mais recente no topo.
   * @param {Array<Record<string, any>>} currentList
   * @param {Record<string, any>} videoInfo
   * @param {number} [now=Date.now()]
   * @param {number} [maxItems=MAX_WATCH_LATER_VIDEOS]
   */
  function upsertWatchLaterVideo(
    currentList = [],
    videoInfo = {},
    now = Date.now(),
    maxItems = MAX_WATCH_LATER_VIDEOS
  ) {
    const safeList = Array.isArray(currentList) ? currentList : [];
    if (!videoInfo || !videoInfo.videoId) return [...safeList];

    const existing = safeList.find((item) => item && item.videoId === videoInfo.videoId);
    const rest = safeList.filter((item) => item && item.videoId !== videoInfo.videoId);

    const entry = {
      videoId: videoInfo.videoId,
      title: videoInfo.title || (existing && existing.title) || `Vídeo ${videoInfo.videoId}`,
      thumbnailUrl:
        videoInfo.thumbnailUrl ||
        (existing && existing.thumbnailUrl) ||
        buildVideoThumbnailUrl(videoInfo.videoId),
      durationText: videoInfo.durationText || (existing && existing.durationText) || '',
      channelId: videoInfo.channelId || (existing && existing.channelId) || '',
      channelHandle: videoInfo.channelHandle || (existing && existing.channelHandle) || '',
      channelKey:
        videoInfo.channelKey ||
        videoInfo.channelId ||
        videoInfo.channelHandle ||
        (existing && existing.channelKey) ||
        '',
      channelName:
        videoInfo.channelName ||
        (existing && existing.channelName) ||
        videoInfo.channelHandle ||
        videoInfo.channelKey ||
        '',
      publishedTimestamp:
        typeof videoInfo.publishedTimestamp === 'number'
          ? videoInfo.publishedTimestamp
          : existing && typeof existing.publishedTimestamp === 'number'
            ? existing.publishedTimestamp
            : null,
      savedAt: now
    };

    const next = [entry, ...rest];
    return next.length > maxItems ? next.slice(0, maxItems) : next;
  }

  /**
   * Remove um vídeo específico da lista "Ver depois" pelo videoId.
   * @param {Array<Record<string, any>>} currentList
   * @param {string} videoId
   */
  function removeWatchLaterVideo(currentList = [], videoId = '') {
    if (!Array.isArray(currentList)) return [];
    if (!videoId) return [...currentList];
    return currentList.filter((item) => item && item.videoId !== videoId);
  }

  /**
   * Remove todos os vídeos de um canal da lista "Ver depois" (usado ao desinscrever).
   * @param {Array<Record<string, any>>} currentList
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string }} info
   */
  function removeChannelFromWatchLater(currentList = [], info = {}) {
    if (!Array.isArray(currentList)) return [];
    return currentList.filter((item) => {
      if (!item) return false;
      const matches =
        (info.channelKey && item.channelKey === info.channelKey) ||
        (info.channelId && item.channelId === info.channelId) ||
        (info.channelHandle && item.channelHandle === info.channelHandle);
      return !matches;
    });
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
    lastClearedAt: null,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    autoMarkWatched: true,
    dismissedVideos: new Set(),
    watchLaterVideos: [],
    unsubscribedChannels: new Set(),
    baselineAnchorIds: new Set(),
    notInterestedByChannel: {},
    watchLaterPanelOpen: false,
    suggestionsPanelOpen: false,
    pendingCount: 0,
    loaded: false
  };

  let feedObserver = null;
  let scheduledScanFrame = null;
  let lastAutoMarkedVideoId = '';
  let lastPersistedPendingCount = null;

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
      'lastClearedAt',
      'zeroSubEnabled',
      'hideShorts',
      'hideScheduledLives',
      'autoMarkWatched',
      'dismissedVideos',
      'watchLaterVideos',
      'unsubscribedChannels',
      'baselineAnchorIds',
      'notInterestedByChannel',
      'pendingCount'
    ]);

    if (typeof data.installTimestamp === 'number') {
      runtimeState.installTimestamp = data.installTimestamp;
    } else {
      runtimeState.installTimestamp = Date.now();
      await chrome.storage.local.set({ installTimestamp: runtimeState.installTimestamp });
    }

    runtimeState.lastClearedAt =
      typeof data.lastClearedAt === 'number' && !Number.isNaN(data.lastClearedAt)
        ? data.lastClearedAt
        : null;
    runtimeState.pendingCount =
      typeof data.pendingCount === 'number' && !Number.isNaN(data.pendingCount)
        ? data.pendingCount
        : 0;

    runtimeState.zeroSubEnabled = data.zeroSubEnabled !== false;
    runtimeState.hideShorts = data.hideShorts !== false;
    runtimeState.hideScheduledLives = data.hideScheduledLives !== false;
    runtimeState.autoMarkWatched = data.autoMarkWatched !== false;
    runtimeState.dismissedVideos = new Set(
      Array.isArray(data.dismissedVideos) ? data.dismissedVideos : []
    );
    runtimeState.watchLaterVideos = Array.isArray(data.watchLaterVideos)
      ? data.watchLaterVideos
      : [];
    runtimeState.unsubscribedChannels = new Set(
      Array.isArray(data.unsubscribedChannels) ? data.unsubscribedChannels : []
    );
    runtimeState.baselineAnchorIds = new Set(
      Array.isArray(data.baselineAnchorIds) ? data.baselineAnchorIds : []
    );
    runtimeState.notInterestedByChannel =
      data.notInterestedByChannel && typeof data.notInterestedByChannel === 'object'
        ? data.notInterestedByChannel
        : {};
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

    // Texto de data/metadados no DOM (suporta layout clássico e yt-lockup-view-model / -wiz)
    const metadataSpans = Array.from(
      cardEl.querySelectorAll(
        '#metadata-line span, .yt-content-metadata-view-model__metadata-text, .yt-content-metadata-view-model-wiz__metadata-text, yt-content-metadata-view-model span, ytd-video-meta-block span'
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
    const badgeTexts = Array.from(
      cardEl.querySelectorAll(
        'ytd-badge-supported-renderer, badge-shape, .badge-shape-wiz__text, .yt-badge-shape__text'
      )
    ).map((el) => (el.textContent || '').trim());

    const hasLiveBadge = Boolean(
      (cached && cached.isLive) ||
        cardEl.querySelector(
          '[overlay-style="LIVE"], .badge-style-type-live-now, .badge-style-type-live-now-alternate, .yt-badge-shape--live, .yt-badge-shape--thumbnail-live, .badge-shape-wiz--live, .badge-shape-wiz--thumbnail-live, [aria-label="AO VIVO"], [aria-label="LIVE"]'
        ) ||
        badgeTexts.some((t) => /^(ao vivo|live)$/i.test(t)) ||
        /\b(assistindo|watching)\b/i.test(combinedDomText)
    );

    const actionAriaText = Array.from(cardEl.querySelectorAll('button[aria-label]'))
      .map((b) => b.getAttribute('aria-label') || '')
      .join(' | ');

    const hasUpcomingOverlay = Boolean(
      cardEl.querySelector('[overlay-style="UPCOMING"]') ||
        isScheduledLiveText(combinedDomText) ||
        isScheduledLiveText(actionAriaText)
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

    const channelName = (cached && cached.channelName) || domChannelName || channelHandle || channelKey;

    const titleEl = cardEl.querySelector(
      'a#video-title-link, a#video-title, #video-title, a.yt-lockup-metadata-view-model__title, a.yt-lockup-metadata-view-model-wiz__title, h3 a[href*="/watch?v="], h3'
    );
    const domTitle = titleEl
      ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim()
      : '';
    const title = domTitle || (cached && cached.title) || (videoId ? `Vídeo ${videoId}` : '');

    let durationText = (cached && cached.durationText) || '';
    if (!durationText) {
      const durationCandidates = Array.from(
        cardEl.querySelectorAll(
          'ytd-thumbnail-overlay-time-status-renderer #text, ytd-thumbnail-overlay-time-status-renderer, badge-shape .yt-badge-shape__text, .badge-shape-wiz__text'
        )
      );
      for (const el of durationCandidates) {
        const txt = (el.textContent || '').trim();
        if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(txt)) {
          durationText = txt;
          break;
        }
      }
    }

    const thumbnailUrl = buildVideoThumbnailUrl(videoId);

    return {
      videoId,
      title,
      durationText,
      thumbnailUrl,
      channelId,
      channelHandle,
      channelKey,
      channelName,
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
   * Marca um vídeo como "Não tenho interesse", dispensa o card e contabiliza por canal.
   * Ao atingir 3 vídeos distintos do mesmo canal, adiciona o canal na lista de sugestões.
   * @param {ReturnType<typeof inspectCardElement>} cardMeta
   * @param {Element} cardEl
   */
  async function markVideoNotInterested(cardMeta, cardEl) {
    if (!cardMeta || !cardMeta.videoId) return;

    await dismissVideoCard(cardMeta.videoId, cardEl);

    const { updatedMap, entry, count, reachedThreshold } = recordNotInterestedVideo(
      runtimeState.notInterestedByChannel,
      cardMeta
    );
    runtimeState.notInterestedByChannel = updatedMap;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ notInterestedByChannel: updatedMap });
    }

    updateToolbarUI();
    renderSuggestionsPanel();

    if (reachedThreshold && entry) {
      showZeroSubToast(
        `Você marcou ${count} vídeos de "${entry.channelName}" como sem interesse. Confira as Sugestões para desinscrever.`
      );
    } else if (entry && count < NOT_INTERESTED_THRESHOLD) {
      showZeroSubToast(
        `Sem interesse registrado (${count}/${NOT_INTERESTED_THRESHOLD} para sugerir desinscrição de ${entry.channelName}).`
      );
    }
  }

  /**
   * Remove um canal da lista de sugestões zerando seu histórico de desinteresse ("Manter canal").
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string, channelName?: string }} channelInfo
   */
  async function keepSuggestedChannel(channelInfo) {
    const updatedMap = removeChannelFromNotInterested(
      runtimeState.notInterestedByChannel,
      channelInfo
    );
    runtimeState.notInterestedByChannel = updatedMap;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ notInterestedByChannel: updatedMap });
    }

    updateToolbarUI();
    renderSuggestionsPanel();
    showZeroSubToast(`Canal "${channelInfo.channelName || channelInfo.channelKey}" mantido.`);
  }

  /**
   * Salva um vídeo do feed na fila "Ver depois" e remove o card da fila principal sem adicioná-lo a dismissedVideos.
   * @param {ReturnType<typeof inspectCardElement>} cardMeta
   * @param {Element} cardEl
   */
  async function saveVideoToWatchLater(cardMeta, cardEl) {
    if (!cardMeta || !cardMeta.videoId) return;

    const updatedList = upsertWatchLaterVideo(runtimeState.watchLaterVideos, cardMeta);
    runtimeState.watchLaterVideos = updatedList;

    if (cardEl) {
      cardEl.classList.add('zerosub-card-dismissing');
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ watchLaterVideos: updatedList });
    }

    setTimeout(() => {
      if (cardEl) {
        cardEl.classList.remove('zerosub-card-dismissing');
        cardEl.classList.add('zerosub-hidden');
      }
      updateFeedCounters();
      renderWatchLaterPanel();
    }, 220);

    updateToolbarUI();
    renderWatchLaterPanel();
    showZeroSubToast(`Salvo em "Ver depois" (${updatedList.length}).`);
  }

  /**
   * Marca um vídeo da lista "Ver depois" como visto (remove de watchLaterVideos e adiciona em dismissedVideos).
   * @param {Record<string, any>} item
   */
  async function markWatchLaterVideoSeen(item) {
    if (!item || !item.videoId) return;

    runtimeState.watchLaterVideos = removeWatchLaterVideo(
      runtimeState.watchLaterVideos,
      item.videoId
    );
    runtimeState.dismissedVideos.add(item.videoId);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(['dismissedVideos']);
      const updatedDismissed = appendDismissedVideo(data.dismissedVideos || [], item.videoId);
      await chrome.storage.local.set({
        watchLaterVideos: runtimeState.watchLaterVideos,
        dismissedVideos: updatedDismissed
      });
    }

    updateToolbarUI();
    renderWatchLaterPanel();
    updateFeedCounters();
    showZeroSubToast('Vídeo marcado como visto.');
  }

  /**
   * Marca um vídeo da lista "Ver depois" como "Sem interesse", atualizando dismissedVideos e notInterestedByChannel.
   * @param {Record<string, any>} item
   */
  async function markWatchLaterVideoNotInterested(item) {
    if (!item || !item.videoId) return;

    runtimeState.watchLaterVideos = removeWatchLaterVideo(
      runtimeState.watchLaterVideos,
      item.videoId
    );
    runtimeState.dismissedVideos.add(item.videoId);

    const { updatedMap, entry, count, reachedThreshold } = recordNotInterestedVideo(
      runtimeState.notInterestedByChannel,
      item
    );
    runtimeState.notInterestedByChannel = updatedMap;

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get(['dismissedVideos']);
      const updatedDismissed = appendDismissedVideo(data.dismissedVideos || [], item.videoId);
      await chrome.storage.local.set({
        watchLaterVideos: runtimeState.watchLaterVideos,
        dismissedVideos: updatedDismissed,
        notInterestedByChannel: updatedMap
      });
    }

    updateToolbarUI();
    renderWatchLaterPanel();
    renderSuggestionsPanel();
    updateFeedCounters();

    if (reachedThreshold && entry) {
      showZeroSubToast(
        `Você marcou ${count} vídeos de "${entry.channelName}" como sem interesse. Confira as Sugestões para desinscrever.`
      );
    } else if (entry && count < NOT_INTERESTED_THRESHOLD) {
      showZeroSubToast(
        `Sem interesse registrado (${count}/${NOT_INTERESTED_THRESHOLD} para sugerir desinscrição de ${entry.channelName}).`
      );
    }
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
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Cancelando...';
      buttonEl.classList.remove('zerosub-btn-confirming');
    }

    // Oculta imediatamente todos os cards desse canal na tela e limpa de sugestões e "Ver depois"
    if (channelId) runtimeState.unsubscribedChannels.add(channelId);
    if (channelHandle) runtimeState.unsubscribedChannels.add(channelHandle);
    if (channelKey) runtimeState.unsubscribedChannels.add(channelKey);

    runtimeState.notInterestedByChannel = removeChannelFromNotInterested(
      runtimeState.notInterestedByChannel,
      channelInfo
    );
    runtimeState.watchLaterVideos = removeChannelFromWatchLater(
      runtimeState.watchLaterVideos,
      channelInfo
    );

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get(['unsubscribedChannels']);
      const list = new Set(Array.isArray(stored.unsubscribedChannels) ? stored.unsubscribedChannels : []);
      if (channelId) list.add(channelId);
      if (channelHandle) list.add(channelHandle);
      if (channelKey) list.add(channelKey);
      await chrome.storage.local.set({
        unsubscribedChannels: Array.from(list),
        notInterestedByChannel: runtimeState.notInterestedByChannel,
        watchLaterVideos: runtimeState.watchLaterVideos
      });
    }

    hideAllCardsForChannel(channelKey, channelId, channelHandle);
    updateToolbarUI();
    renderWatchLaterPanel();
    renderSuggestionsPanel();
    updateFeedCounters();

    // Envia comando para o MAIN world executar o POST /youtubei/v1/subscription/unsubscribe
    const apiResult = await requestMainWorldUnsubscribe(channelId, channelHandle);
    if (!apiResult.ok) {
      // Fallback UI: tenta acionar fluxo via iframe/página do canal ou avisa no banner
      triggerUnsubscribeFallback(channelId, channelHandle);
    }
    return apiResult;
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

    // 2. Botão "Ver depois"
    const watchLaterBtn = document.createElement('button');
    watchLaterBtn.type = 'button';
    watchLaterBtn.className = 'zerosub-btn zerosub-btn-watch-later';
    watchLaterBtn.title = 'Salvar na fila Ver depois e limpar do feed';
    watchLaterBtn.innerHTML = '<span class="zerosub-icon">🕒</span><span>Ver depois</span>';

    watchLaterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const latestMeta = inspectCardElement(cardEl);
      saveVideoToWatchLater(latestMeta, cardEl);
    });

    // 3. Botão "Não tenho interesse" (Sem interesse)
    const notInterestedBtn = document.createElement('button');
    notInterestedBtn.type = 'button';
    notInterestedBtn.className = 'zerosub-btn zerosub-btn-not-interested';
    notInterestedBtn.title = 'Não tenho interesse (3 vídeos diferentes do mesmo canal sugerem desinscrição)';
    notInterestedBtn.innerHTML = '<span class="zerosub-icon">✕</span><span>Sem interesse</span>';

    notInterestedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const latestMeta = inspectCardElement(cardEl);
      markVideoNotInterested(latestMeta, cardEl);
    });

    // 4. Botão "Desinscrever" com confirmação em duas etapas
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

    // Grade 2x2: linha superior (Visto, Ver depois), linha inferior (Sem interesse, Desinscrever)
    actionBar.appendChild(markSeenBtn);
    actionBar.appendChild(watchLaterBtn);
    actionBar.appendChild(notInterestedBtn);
    actionBar.appendChild(unsubBtn);

    // Anexa diretamente no cardEl (abaixo de #content) para garantir empilhamento vertical 100% abaixo do vídeo
    cardEl.appendChild(actionBar);
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
          <button type="button" id="zerosub-watch-later-toggle-btn" class="zerosub-toolbar-btn zerosub-toolbar-btn-watch-later zerosub-hidden"></button>
          <button type="button" id="zerosub-suggestions-toggle-btn" class="zerosub-toolbar-btn zerosub-toolbar-btn-suggestions zerosub-hidden"></button>
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

      const watchLaterBtn = toolbar.querySelector('#zerosub-watch-later-toggle-btn');
      const suggestionsBtn = toolbar.querySelector('#zerosub-suggestions-toggle-btn');
      const toggleBtn = toolbar.querySelector('#zerosub-toggle-mode-btn');
      const resetBtn = toolbar.querySelector('#zerosub-reset-now-btn');

      if (watchLaterBtn) {
        watchLaterBtn.addEventListener('click', () => {
          runtimeState.watchLaterPanelOpen = !runtimeState.watchLaterPanelOpen;
          renderWatchLaterPanel();
        });
      }

      if (suggestionsBtn) {
        suggestionsBtn.addEventListener('click', () => {
          runtimeState.suggestionsPanelOpen = !runtimeState.suggestionsPanelOpen;
          renderSuggestionsPanel();
        });
      }

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
   * Renderiza o painel expansível "Ver depois" logo abaixo da barra do ZeroSub.
   * Usa data-zerosub-render-key para não destruir botões em confirmação de 2 cliques.
   */
  function renderWatchLaterPanel() {
    if (typeof document === 'undefined' || !isSubscriptionsPage()) return;
    const toolbar = document.getElementById('zerosub-top-toolbar');
    if (!toolbar || !toolbar.parentNode) return;

    const items = Array.isArray(runtimeState.watchLaterVideos) ? runtimeState.watchLaterVideos : [];
    let panel = document.getElementById('zerosub-watch-later-panel');

    if (items.length === 0 || !runtimeState.watchLaterPanelOpen) {
      if (panel) panel.remove();
      if (items.length === 0) {
        runtimeState.watchLaterPanelOpen = false;
      }
      return;
    }

    const renderKey = items
      .map((item) => `${item.videoId || ''}:${item.savedAt || 0}`)
      .join('|');

    if (panel && panel.getAttribute('data-zerosub-render-key') === renderKey) {
      return;
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'zerosub-watch-later-panel';
      panel.className = 'zerosub-watch-later-panel';
      toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
    }

    panel.setAttribute('data-zerosub-render-key', renderKey);
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'zerosub-suggestions-header';
    header.innerHTML = `
      <div>
        <div class="zerosub-suggestions-title">Ver depois (${items.length})</div>
        <div class="zerosub-suggestions-subtitle">Vídeos salvos para assistir depois — somem automaticamente ao assistir &gt;90%</div>
      </div>
    `;
    panel.appendChild(header);

    const gridEl = document.createElement('div');
    gridEl.className = 'zerosub-watch-later-grid';

    items.forEach((item) => {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`;
      const card = document.createElement('div');
      card.className = 'zerosub-wl-card';
      card.setAttribute('data-video-id', item.videoId);

      const thumbLink = document.createElement('a');
      thumbLink.className = 'zerosub-wl-thumb-link';
      thumbLink.href = watchUrl;
      thumbLink.title = item.title || 'Assistir vídeo';

      const thumbImg = document.createElement('img');
      thumbImg.className = 'zerosub-wl-thumb';
      thumbImg.src = item.thumbnailUrl || buildVideoThumbnailUrl(item.videoId);
      thumbImg.alt = item.title || 'Thumbnail do vídeo';
      thumbImg.loading = 'lazy';
      thumbLink.appendChild(thumbImg);

      if (item.durationText) {
        const durBadge = document.createElement('span');
        durBadge.className = 'zerosub-wl-duration';
        durBadge.textContent = item.durationText;
        thumbLink.appendChild(durBadge);
      }

      const meta = document.createElement('div');
      meta.className = 'zerosub-wl-meta';

      const titleLink = document.createElement('a');
      titleLink.className = 'zerosub-wl-title';
      titleLink.href = watchUrl;
      titleLink.textContent = item.title || `Vídeo ${item.videoId}`;
      titleLink.title = item.title || item.videoId;

      const channelEl = document.createElement('div');
      channelEl.className = 'zerosub-wl-channel';
      channelEl.textContent = item.channelName || item.channelHandle || item.channelKey || '';

      meta.appendChild(titleLink);
      meta.appendChild(channelEl);

      const actions = document.createElement('div');
      actions.className = 'zerosub-wl-actions';

      const seenBtn = document.createElement('button');
      seenBtn.type = 'button';
      seenBtn.className = 'zerosub-btn zerosub-btn-seen';
      seenBtn.title = 'Marcar como visto e remover de Ver depois';
      seenBtn.innerHTML = '<span class="zerosub-icon">✓</span><span>Visto</span>';
      seenBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        markWatchLaterVideoSeen(item);
      });

      const notIntBtn = document.createElement('button');
      notIntBtn.type = 'button';
      notIntBtn.className = 'zerosub-btn zerosub-btn-not-interested';
      notIntBtn.title = 'Não tenho interesse (3 vídeos diferentes sugerem desinscrição)';
      notIntBtn.innerHTML = '<span class="zerosub-icon">✕</span><span>Sem interesse</span>';
      notIntBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        markWatchLaterVideoNotInterested(item);
      });

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
          handleConfirmedUnsubscribe(item, unsubBtn);
        }
      });

      unsubBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        confirmController.trigger();
      });

      actions.appendChild(seenBtn);
      actions.appendChild(notIntBtn);
      actions.appendChild(unsubBtn);

      card.appendChild(thumbLink);
      card.appendChild(meta);
      card.appendChild(actions);
      gridEl.appendChild(card);
    });

    panel.appendChild(gridEl);
  }

  /**
   * Renderiza o painel expansível de sugestões de desinscrição logo abaixo da barra do ZeroSub.
   * Usa uma chave de assinatura para evitar destruir/recriar os botões quando a lista não mudou.
   */
  function renderSuggestionsPanel() {
    if (typeof document === 'undefined' || !isSubscriptionsPage()) return;
    const toolbar = document.getElementById('zerosub-top-toolbar');
    if (!toolbar || !toolbar.parentNode) return;

    const suggestions = getUnsubscribeSuggestions(
      runtimeState.notInterestedByChannel,
      runtimeState.unsubscribedChannels
    );

    let panel = document.getElementById('zerosub-suggestions-panel');
    if (suggestions.length === 0 || !runtimeState.suggestionsPanelOpen) {
      if (panel) panel.remove();
      if (suggestions.length === 0) {
        runtimeState.suggestionsPanelOpen = false;
      }
      return;
    }

    const renderKey = suggestions
      .map((entry) => `${entry.channelKey || ''}:${entry.channelName || ''}:${entry.videoIds.length}`)
      .join('|');

    if (panel && panel.getAttribute('data-zerosub-render-key') === renderKey) {
      return;
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'zerosub-suggestions-panel';
      panel.className = 'zerosub-suggestions-panel';
      const anchorEl = document.getElementById('zerosub-watch-later-panel') || toolbar;
      anchorEl.parentNode.insertBefore(panel, anchorEl.nextSibling);
    }

    panel.setAttribute('data-zerosub-render-key', renderKey);
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'zerosub-suggestions-header';
    header.innerHTML = `
      <div>
        <div class="zerosub-suggestions-title">Sugestões para Desinscrever (${suggestions.length})</div>
        <div class="zerosub-suggestions-subtitle">Canais com 3 ou mais vídeos marcados como "Sem interesse"</div>
      </div>
    `;
    panel.appendChild(header);

    const listEl = document.createElement('div');
    listEl.className = 'zerosub-suggestions-list';

    suggestions.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'zerosub-suggestion-item';

      const info = document.createElement('div');
      info.className = 'zerosub-suggestion-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'zerosub-suggestion-name';
      nameEl.textContent = entry.channelName || entry.channelHandle || entry.channelKey;

      const metaEl = document.createElement('span');
      metaEl.className = 'zerosub-suggestion-meta';
      metaEl.textContent = `${entry.videoIds.length} vídeos sem interesse`;

      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'zerosub-suggestion-actions';

      const keepBtn = document.createElement('button');
      keepBtn.type = 'button';
      keepBtn.className = 'zerosub-toolbar-btn';
      keepBtn.textContent = 'Manter canal';
      keepBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        keepSuggestedChannel(entry);
      });

      const unsubBtn = document.createElement('button');
      unsubBtn.type = 'button';
      unsubBtn.className = 'zerosub-toolbar-btn zerosub-toolbar-btn-primary';
      unsubBtn.textContent = 'Desinscrever';
      unsubBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleConfirmedUnsubscribe(entry, unsubBtn);
      });

      actions.appendChild(keepBtn);
      actions.appendChild(unsubBtn);

      item.appendChild(info);
      item.appendChild(actions);
      listEl.appendChild(item);
    });

    panel.appendChild(listEl);
  }

  /**
   * Retorna os cards de vídeo do feed principal (Grid clássico, Rich Grid ou Lista),
   * excluindo apenas cards dentro de prateleiras exclusivas de Shorts.
   * @param {Element} browseRoot
   * @returns {Element[]}
   */
  function queryFeedVideoCards(browseRoot) {
    if (!browseRoot) return [];
    return Array.from(
      browseRoot.querySelectorAll(
        'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer'
      )
    ).filter((card) => !card.closest('[data-zerosub-shorts-shelf="true"], ytd-reel-shelf-renderer'));
  }

  /**
   * Redefine o installTimestamp para Date.now(), registra os IDs âncora do topo (baselineAnchorIds)
   * e dispensa os vídeos atualmente renderizados na fila para garantir corte definitivo do feed.
   */
  async function resetFeedToNow() {
    const now = Date.now();
    runtimeState.installTimestamp = now;
    runtimeState.lastClearedAt = now;
    runtimeState.zeroSubEnabled = true;

    const browseRoot = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    const allCards = queryFeedVideoCards(browseRoot);
    const watchLaterIds = getWatchLaterIdSet(runtimeState.watchLaterVideos);
    const anchorIds = [];

    allCards.forEach((card) => {
      const meta = inspectCardElement(card);
      if (meta.videoId) {
        const isRegularChronological = !meta.isLiveNow && !meta.isUpcoming && !meta.isShort;
        if (
          isRegularChronological &&
          anchorIds.length < MAX_BASELINE_ANCHORS &&
          !anchorIds.includes(meta.videoId)
        ) {
          anchorIds.push(meta.videoId);
        }
        if (!watchLaterIds.has(meta.videoId)) {
          runtimeState.dismissedVideos.add(meta.videoId);
        }
      }
    });

    runtimeState.baselineAnchorIds = new Set(anchorIds);
    const dismissedArray = Array.from(runtimeState.dismissedVideos).slice(-MAX_DISMISSED_VIDEOS);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        installTimestamp: now,
        lastClearedAt: now,
        zeroSubEnabled: true,
        baselineAnchorIds: anchorIds,
        dismissedVideos: dismissedArray,
        pendingCount: 0
      });
    }

    processSubscriptionsFeed();
    showZeroSubToast('Marco Zero atualizado! Apenas vídeos novos aparecerão acima deste ponto.');
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
    const watchLaterBtn = toolbar.querySelector('#zerosub-watch-later-toggle-btn');
    const suggestionsBtn = toolbar.querySelector('#zerosub-suggestions-toggle-btn');

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

    if (watchLaterBtn) {
      const wlCount = Array.isArray(runtimeState.watchLaterVideos)
        ? runtimeState.watchLaterVideos.length
        : 0;
      if (wlCount > 0) {
        watchLaterBtn.textContent = `🕒 Ver depois (${wlCount})`;
        watchLaterBtn.classList.remove('zerosub-hidden');
      } else {
        watchLaterBtn.classList.add('zerosub-hidden');
      }
    }

    if (suggestionsBtn) {
      const suggestions = getUnsubscribeSuggestions(
        runtimeState.notInterestedByChannel,
        runtimeState.unsubscribedChannels
      );
      if (suggestions.length > 0) {
        suggestionsBtn.textContent = `Sugestões (${suggestions.length})`;
        suggestionsBtn.classList.remove('zerosub-hidden');
      } else {
        suggestionsBtn.classList.add('zerosub-hidden');
      }
    }
  }

  /**
   * Exibe ou oculta o banner de estado vazio "Inbox Zero" quando não restarem vídeos pendentes.
   * @param {Element} browseRoot
   * @param {number} visibleCount
   * @param {number} totalCards
   */
  function ensureEmptyStateBanner(browseRoot, visibleCount, totalCards = 0) {
    if (typeof document === 'undefined' || !browseRoot) return;
    let wrapper = browseRoot.querySelector('#zerosub-empty-wrapper');

    const isEmpty = shouldShowEmptyState(runtimeState.zeroSubEnabled, visibleCount, totalCards);
    browseRoot.classList.toggle('zerosub-feed-empty', isEmpty);

    if (!isEmpty) {
      if (wrapper) wrapper.remove();
      return;
    }

    const clearedTimestamp = getDisplayClearedTimestamp(runtimeState);

    const dateFormatted = new Date(clearedTimestamp).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'zerosub-empty-wrapper';
      wrapper.className = 'zerosub-empty-wrapper';

      const banner = document.createElement('div');
      banner.id = 'zerosub-empty-state';
      banner.className = 'zerosub-empty-state';
      banner.innerHTML = `
        <div class="zerosub-empty-icon">✓</div>
        <div class="zerosub-empty-title">Inbox Zero! Nenhum vídeo novo pendente</div>
        <div id="zerosub-empty-subtitle" class="zerosub-empty-subtitle"></div>
        <div class="zerosub-empty-actions">
          <button type="button" id="zerosub-empty-watch-later-btn" class="zerosub-toolbar-btn zerosub-toolbar-btn-watch-later zerosub-hidden"></button>
          <button type="button" id="zerosub-check-new-btn" class="zerosub-toolbar-btn zerosub-toolbar-btn-primary">
            Verificar novos vídeos
          </button>
          <button type="button" id="zerosub-empty-show-all-btn" class="zerosub-toolbar-btn">
            Mostrar todos
          </button>
        </div>
      `;

      wrapper.appendChild(banner);

      const anchorEl =
        document.getElementById('zerosub-suggestions-panel') ||
        document.getElementById('zerosub-watch-later-panel') ||
        document.getElementById('zerosub-top-toolbar');
      if (anchorEl && anchorEl.parentNode) {
        anchorEl.parentNode.insertBefore(wrapper, anchorEl.nextSibling);
      } else {
        browseRoot.appendChild(wrapper);
      }

      const emptyWatchLaterBtn = banner.querySelector('#zerosub-empty-watch-later-btn');
      const checkNewBtn = banner.querySelector('#zerosub-check-new-btn');
      const showAllBtn = banner.querySelector('#zerosub-empty-show-all-btn');

      if (emptyWatchLaterBtn) {
        emptyWatchLaterBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          runtimeState.watchLaterPanelOpen = true;
          renderWatchLaterPanel();
          const wlPanel = document.getElementById('zerosub-watch-later-panel');
          if (wlPanel && typeof wlPanel.scrollIntoView === 'function') {
            wlPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }

      if (checkNewBtn) {
        checkNewBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          checkNewBtn.disabled = true;
          checkNewBtn.textContent = 'Verificando...';
          window.location.reload();
        });
      }
      if (showAllBtn) {
        showAllBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          runtimeState.zeroSubEnabled = false;
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ zeroSubEnabled: false });
          }
          processSubscriptionsFeed();
        });
      }
    }

    const wlCount = Array.isArray(runtimeState.watchLaterVideos)
      ? runtimeState.watchLaterVideos.length
      : 0;
    const subtitleEl = wrapper.querySelector('#zerosub-empty-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent =
        wlCount > 0
          ? `Sua fila está limpa desde ${dateFormatted}. Você ainda tem ${wlCount} vídeo(s) salvo(s) em Ver depois.`
          : `Sua fila está limpa desde ${dateFormatted}. Vídeos antigos permanecem ocultos.`;
    }

    const emptyWatchLaterBtn = wrapper.querySelector('#zerosub-empty-watch-later-btn');
    if (emptyWatchLaterBtn) {
      if (wlCount > 0) {
        emptyWatchLaterBtn.textContent = `🕒 Abrir Ver depois (${wlCount})`;
        emptyWatchLaterBtn.classList.remove('zerosub-hidden');
      } else {
        emptyWatchLaterBtn.classList.add('zerosub-hidden');
      }
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

    // 1. Filtra seções exclusivas de Shorts (sem ocultar seções que contêm vídeos normais como "Mais recentes" / "Mais relevantes")
    const richSections = browseRoot.querySelectorAll(
      'ytd-rich-section-renderer, ytd-reel-shelf-renderer'
    );
    richSections.forEach((section) => {
      const hasRegularVideoLinks = Boolean(section.querySelector('a[href*="/watch?v="]'));
      const isShortsShelf =
        section.tagName.toLowerCase() === 'ytd-reel-shelf-renderer' ||
        Boolean(
          section.querySelector('ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer')
        ) ||
        (!hasRegularVideoLinks &&
          Boolean(section.querySelector('a[href*="/shorts/"], ytm-shorts-lockup-view-model')));

      if (isShortsShelf) {
        section.setAttribute('data-zerosub-shorts-shelf', 'true');
        const shouldHideShelf = runtimeState.zeroSubEnabled && runtimeState.hideShorts;
        section.classList.toggle('zerosub-hidden', shouldHideShelf);
      } else {
        section.removeAttribute('data-zerosub-shorts-shelf');
        section.classList.remove('zerosub-hidden');
      }
    });

    // 2. Avalia todos os cards do feed principal (Grid ou Lista), excluindo prateleiras exclusivas de Shorts
    const cards = queryFeedVideoCards(browseRoot);
    const cardsMeta = cards.map((card) => inspectCardElement(card));
    const { decisions, visibleCount, shouldHideContinuation } = evaluateFeedItems(
      cardsMeta,
      runtimeState
    );

    cards.forEach((card, index) => {
      const cardMeta = cardsMeta[index];
      const decision = decisions[index];

      if (decision.hidden) {
        card.classList.add('zerosub-hidden');
        card.classList.remove('zerosub-card-managed');
        card.setAttribute('data-zerosub-hidden-reason', decision.reason || 'filtered');
      } else {
        card.classList.remove('zerosub-hidden');
        card.classList.add('zerosub-card-managed');
        card.removeAttribute('data-zerosub-hidden-reason');
        ensureCardActionBar(card, cardMeta);
      }
    });

    // 3. Bloqueia/oculta o sentinela de paginação infinita do YouTube quando o corte foi atingido
    const continuationItems = browseRoot.querySelectorAll('ytd-continuation-item-renderer');
    continuationItems.forEach((item) => {
      item.classList.toggle('zerosub-hidden', shouldHideContinuation);
    });

    browseRoot.setAttribute('data-zerosub-total-cards', String(cards.length));
    browseRoot.setAttribute('data-zerosub-visible-cards', String(visibleCount));

    const prevPendingCount = runtimeState.pendingCount;
    const nextClearedAt = resolveClearedTimestamp({
      zeroSubEnabled: runtimeState.zeroSubEnabled,
      prevPendingCount,
      nextPendingCount: visibleCount,
      totalCards: cards.length,
      currentLastClearedAt: runtimeState.lastClearedAt,
      installTimestamp: runtimeState.installTimestamp
    });
    const clearedAtChanged = nextClearedAt !== runtimeState.lastClearedAt;
    if (clearedAtChanged) {
      runtimeState.lastClearedAt = nextClearedAt;
    }

    if (cards.length > 0) {
      runtimeState.pendingCount = visibleCount;
    }
    updateToolbarUI();
    renderWatchLaterPanel();
    renderSuggestionsPanel();
    ensureEmptyStateBanner(browseRoot, visibleCount, cards.length);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const storagePatch = {};
      if (cards.length > 0 && visibleCount !== lastPersistedPendingCount) {
        lastPersistedPendingCount = visibleCount;
        storagePatch.pendingCount = visibleCount;
      }
      if (clearedAtChanged && typeof runtimeState.lastClearedAt === 'number') {
        storagePatch.lastClearedAt = runtimeState.lastClearedAt;
      }
      if (Object.keys(storagePatch).length > 0) {
        chrome.storage.local.set(storagePatch);
      }
    }
  }

  /**
   * Atualiza o contador de vídeos visíveis na fila sem reprocessar tudo do zero.
   */
  function updateFeedCounters() {
    if (typeof document === 'undefined' || !isSubscriptionsPage()) return;
    const browseRoot = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    if (!browseRoot) return;

    const allCards = queryFeedVideoCards(browseRoot);
    const visibleCards = allCards.filter((card) => !card.classList.contains('zerosub-hidden'));

    const prevPendingCount = runtimeState.pendingCount;
    const nextClearedAt = resolveClearedTimestamp({
      zeroSubEnabled: runtimeState.zeroSubEnabled,
      prevPendingCount,
      nextPendingCount: visibleCards.length,
      totalCards: allCards.length,
      currentLastClearedAt: runtimeState.lastClearedAt,
      installTimestamp: runtimeState.installTimestamp
    });
    const clearedAtChanged = nextClearedAt !== runtimeState.lastClearedAt;
    if (clearedAtChanged) {
      runtimeState.lastClearedAt = nextClearedAt;
    }

    if (allCards.length > 0) {
      runtimeState.pendingCount = visibleCards.length;
    }
    updateToolbarUI();
    ensureEmptyStateBanner(browseRoot, visibleCards.length, allCards.length);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const storagePatch = {};
      if (allCards.length > 0 && visibleCards.length !== lastPersistedPendingCount) {
        lastPersistedPendingCount = visibleCards.length;
        storagePatch.pendingCount = visibleCards.length;
      }
      if (clearedAtChanged && typeof runtimeState.lastClearedAt === 'number') {
        storagePatch.lastClearedAt = runtimeState.lastClearedAt;
      }
      if (Object.keys(storagePatch).length > 0) {
        chrome.storage.local.set(storagePatch);
      }
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
        if (isZeroSubOwnedNode(mutation.target)) continue;
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          const hasExternalAddedNode = Array.from(mutation.addedNodes).some(
            (node) => !isZeroSubOwnedNode(node)
          );
          if (hasExternalAddedNode) {
            scheduleFeedScan();
            break;
          }
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

        const isInWatchLater = getWatchLaterIdSet(runtimeState.watchLaterVideos).has(currentVideoId);
        if (runtimeState.dismissedVideos.has(currentVideoId) && !isInWatchLater) return;

        lastAutoMarkedVideoId = currentVideoId;
        runtimeState.dismissedVideos.add(currentVideoId);
        if (isInWatchLater) {
          runtimeState.watchLaterVideos = removeWatchLaterVideo(
            runtimeState.watchLaterVideos,
            currentVideoId
          );
        }

        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          const data = await chrome.storage.local.get(['dismissedVideos', 'watchLaterVideos']);
          const updatedDismissed = appendDismissedVideo(data.dismissedVideos || [], currentVideoId);
          const payload = { dismissedVideos: updatedDismissed };
          const storedWatchLater = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos : [];
          if (getWatchLaterIdSet(storedWatchLater).has(currentVideoId)) {
            payload.watchLaterVideos = removeWatchLaterVideo(storedWatchLater, currentVideoId);
            runtimeState.watchLaterVideos = payload.watchLaterVideos;
          }
          await chrome.storage.local.set(payload);
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
        if (changes.lastClearedAt !== undefined) {
          runtimeState.lastClearedAt =
            typeof changes.lastClearedAt.newValue === 'number'
              ? changes.lastClearedAt.newValue
              : null;
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
        if (changes.watchLaterVideos !== undefined) {
          runtimeState.watchLaterVideos = Array.isArray(changes.watchLaterVideos.newValue)
            ? changes.watchLaterVideos.newValue
            : [];
          needsRescan = true;
        }
        if (changes.unsubscribedChannels !== undefined) {
          runtimeState.unsubscribedChannels = new Set(changes.unsubscribedChannels.newValue || []);
          needsRescan = true;
        }
        if (changes.baselineAnchorIds !== undefined) {
          runtimeState.baselineAnchorIds = new Set(changes.baselineAnchorIds.newValue || []);
          needsRescan = true;
        }
        if (changes.notInterestedByChannel !== undefined) {
          runtimeState.notInterestedByChannel = changes.notInterestedByChannel.newValue || {};
          if (isSubscriptionsPage()) {
            updateToolbarUI();
            renderSuggestionsPanel();
          }
        }

        if (needsRescan && isSubscriptionsPage()) {
          processSubscriptionsFeed();
        }
      });
    }

    // Escuta mensagens diretas do Popup (ex: comando "RESET_FEED_NOW" ou "UNSUBSCRIBE_CHANNEL")
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || typeof msg !== 'object') return false;
        if (msg.type === 'ZEROSUB_RESET_NOW') {
          resetFeedToNow().then(() => {
            sendResponse({ ok: true, pendingCount: runtimeState.pendingCount });
          });
          return true;
        }
        if (msg.type === 'ZEROSUB_UNSUBSCRIBE_CHANNEL' && msg.channelInfo) {
          handleConfirmedUnsubscribe(msg.channelInfo, null).then((result) => {
            sendResponse({ ok: Boolean(result && result.ok), result });
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
      NOT_INTERESTED_THRESHOLD,
      parseRelativeTime,
      extractVideoIdFromHref,
      isScheduledLiveText,
      evaluateCardVisibility,
      evaluateFeedItems,
      isZeroSubOwnedNode,
      shouldShowEmptyState,
      resolveClearedTimestamp,
      getDisplayClearedTimestamp,
      recordNotInterestedVideo,
      getUnsubscribeSuggestions,
      removeChannelFromNotInterested,
      shouldAutoMarkWatched,
      appendDismissedVideo,
      buildVideoThumbnailUrl,
      getWatchLaterIdSet,
      upsertWatchLaterVideo,
      removeWatchLaterVideo,
      removeChannelFromWatchLater,
      createTwoStepConfirmation
    };
  } else if (rootScope) {
    rootScope.ZeroSubContent = {
      NOT_INTERESTED_THRESHOLD,
      parseRelativeTime,
      extractVideoIdFromHref,
      isScheduledLiveText,
      evaluateCardVisibility,
      evaluateFeedItems,
      isZeroSubOwnedNode,
      shouldShowEmptyState,
      resolveClearedTimestamp,
      getDisplayClearedTimestamp,
      recordNotInterestedVideo,
      getUnsubscribeSuggestions,
      removeChannelFromNotInterested,
      shouldAutoMarkWatched,
      appendDismissedVideo,
      buildVideoThumbnailUrl,
      getWatchLaterIdSet,
      upsertWatchLaterVideo,
      removeWatchLaterVideo,
      removeChannelFromWatchLater,
      createTwoStepConfirmation
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
