/**
 * ZeroSub — MAIN World Injector (content/injector.js)
 * Roda no contexto da página (world: "MAIN") para:
 * 1. Ler window.ytInitialData e interceptar respostas de /youtubei/v1/browse
 * 2. Extrair metadados dos vídeos (videoId, channelId, publishedTimeText, isShort, isUpcoming)
 * 3. Executar desinscrição autenticada via InnerTube API (/youtubei/v1/subscription/unsubscribe) com SAPISIDHASH
 */

(function initZeroSubInjector(rootScope) {
  const MAIN_SOURCE = 'ZEROSUB_MAIN';
  const ISOLATED_SOURCE = 'ZEROSUB_ISOLATED';

  /**
   * Extrai texto simples de objetos Text do YouTube ({ simpleText } ou { runs: [{ text }] }).
   * @param {any} textObj
   * @returns {string}
   */
  function extractText(textObj) {
    if (!textObj) return '';
    if (typeof textObj === 'string') return textObj;
    if (typeof textObj.simpleText === 'string') return textObj.simpleText;
    if (Array.isArray(textObj.runs)) {
      return textObj.runs.map((r) => r.text || '').join('');
    }
    if (textObj.content && typeof textObj.content === 'string') {
      return textObj.content;
    }
    return '';
  }

  /**
   * Extrai browseId (UC...) e canonicalBaseUrl (/@handle) de um objeto byline/owner do YouTube.
   * @param {any} renderer
   * @returns {{ channelId: string, channelHandle: string, channelName: string }}
   */
  function extractChannelInfo(renderer) {
    let channelId = renderer.channelId || '';
    let channelHandle = '';
    let channelName = '';

    const bylineCandidates = [
      renderer.ownerText,
      renderer.shortBylineText,
      renderer.longBylineText
    ];

    for (const candidate of bylineCandidates) {
      if (!candidate || !Array.isArray(candidate.runs)) continue;
      for (const run of candidate.runs) {
        if (!channelName && run.text) {
          channelName = run.text;
        }
        const browseEndpoint =
          run.navigationEndpoint && run.navigationEndpoint.browseEndpoint;
        if (browseEndpoint) {
          if (!channelId && browseEndpoint.browseId) {
            channelId = browseEndpoint.browseId;
          }
          if (!channelHandle && browseEndpoint.canonicalBaseUrl) {
            channelHandle = browseEndpoint.canonicalBaseUrl;
          }
        }
      }
    }

    return { channelId, channelHandle, channelName };
  }

  /**
   * Percorre recursivamente um payload JSON do YouTube (ytInitialData ou /youtubei/v1/browse)
   * e retorna um mapa/lista de metadados de vídeos encontrados.
   *
   * @param {any} data
   * @returns {Array<{
   *   videoId: string,
   *   channelId: string,
   *   channelHandle: string,
   *   channelName: string,
   *   publishedTimeText: string,
   *   isShort: boolean,
   *   isUpcoming: boolean,
   *   isLive: boolean,
   *   upcomingStartTime: number | null
   * }>}
   */
  function extractVideosFromYtData(data) {
    const results = new Map();

    function visit(node) {
      if (!node || typeof node !== 'object') return;

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          visit(node[i]);
        }
        return;
      }

      // 1. Renderers clássicos de vídeo (videoRenderer, gridVideoRenderer, compactVideoRenderer)
      const videoRenderer =
        node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer;
      if (videoRenderer && typeof videoRenderer.videoId === 'string') {
        const videoId = videoRenderer.videoId;
        const title = extractText(videoRenderer.title).trim();
        let durationText = extractText(videoRenderer.lengthText).trim();
        const { channelId, channelHandle, channelName } = extractChannelInfo(videoRenderer);
        const publishedTimeText = extractText(videoRenderer.publishedTimeText);

        const navEndpoint = videoRenderer.navigationEndpoint || {};
        const commandUrl =
          (navEndpoint.commandMetadata &&
            navEndpoint.commandMetadata.webCommandMetadata &&
            navEndpoint.commandMetadata.webCommandMetadata.url) ||
          '';

        const isShort =
          Boolean(navEndpoint.reelWatchEndpoint) || commandUrl.includes('/shorts/');

        const upcomingData = videoRenderer.upcomingEventData;
        let isUpcoming = Boolean(upcomingData);
        let isLive = false;

        if (Array.isArray(videoRenderer.badges)) {
          for (const b of videoRenderer.badges) {
            const style =
              b.metadataBadgeRenderer && b.metadataBadgeRenderer.style;
            if (style === 'BADGE_STYLE_TYPE_LIVE_NOW') isLive = true;
          }
        }

        if (Array.isArray(videoRenderer.thumbnailOverlays)) {
          for (const overlay of videoRenderer.thumbnailOverlays) {
            const statusRenderer = overlay.thumbnailOverlayTimeStatusRenderer;
            if (statusRenderer) {
              if (statusRenderer.style === 'UPCOMING') isUpcoming = true;
              if (statusRenderer.style === 'LIVE') isLive = true;
              if (!durationText && statusRenderer.style === 'DEFAULT') {
                const candidateDuration = extractText(statusRenderer.text).trim();
                if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(candidateDuration)) {
                  durationText = candidateDuration;
                }
              }
            }
          }
        }

        const upcomingStartTime =
          upcomingData && upcomingData.startTime
            ? Number(upcomingData.startTime) * 1000
            : null;

        results.set(videoId, {
          videoId,
          title,
          durationText,
          channelId,
          channelHandle,
          channelName,
          publishedTimeText,
          isShort,
          isUpcoming,
          isLive,
          upcomingStartTime
        });
      }

      // 2. Renderers de Shorts (reelItemRenderer / shortsLockupViewModel)
      const reelRenderer = node.reelItemRenderer;
      if (reelRenderer && typeof reelRenderer.videoId === 'string') {
        const videoId = reelRenderer.videoId;
        if (!results.has(videoId)) {
          results.set(videoId, {
            videoId,
            title: extractText(reelRenderer.headline).trim(),
            durationText: '',
            channelId: '',
            channelHandle: '',
            channelName: '',
            publishedTimeText: '',
            isShort: true,
            isUpcoming: false,
            isLive: false,
            upcomingStartTime: null
          });
        }
      }

      // 3. Novo formato lockupViewModel do YouTube
      const lockup = node.lockupViewModel;
      if (lockup && typeof lockup.contentId === 'string') {
        const videoId = lockup.contentId;
        const title = extractText(
          lockup.metadata &&
            lockup.metadata.lockupMetadataViewModel &&
            lockup.metadata.lockupMetadataViewModel.title
        ).trim();
        let durationText = '';
        let publishedTimeText = '';
        let channelId = '';
        let channelHandle = '';
        let channelName = '';
        let isUpcoming = false;
        let isLive = false;

        const metadataRows =
          lockup.metadata &&
          lockup.metadata.lockupMetadataViewModel &&
          lockup.metadata.lockupMetadataViewModel.metadata &&
          lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel &&
          lockup.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;

        if (Array.isArray(metadataRows)) {
          for (const row of metadataRows) {
            if (!Array.isArray(row.metadataParts)) continue;
            for (const part of row.metadataParts) {
              const textContent = extractText(part.text);
              if (
                textContent &&
                (/(há\s+(?:\d+|um|uma|poucos)|agora mesmo|just now|a moment ago|ago\b|streamed|transmitido|estreou|programado|scheduled|estreia|premiere)/i.test(
                  textContent
                ))
              ) {
                publishedTimeText = textContent;
              }
              if (
                textContent &&
                /(programado|scheduled|estreia|premiere|em breve|upcoming)/i.test(textContent)
              ) {
                isUpcoming = true;
              }
              if (textContent && /\b(assistindo|watching)\b/i.test(textContent)) {
                isLive = true;
              }
            }
          }
        }

        const thumbOverlays =
          lockup.contentImage &&
          lockup.contentImage.thumbnailViewModel &&
          lockup.contentImage.thumbnailViewModel.overlays;
        if (Array.isArray(thumbOverlays)) {
          for (const overlay of thumbOverlays) {
            const badges =
              overlay &&
              overlay.thumbnailBottomOverlayViewModel &&
              overlay.thumbnailBottomOverlayViewModel.badges;
            if (!Array.isArray(badges)) continue;
            for (const badge of badges) {
              const vm = badge && badge.thumbnailBadgeViewModel;
              if (!vm) continue;
              const badgeText = (vm.text || '').trim();
              if (
                vm.badgeStyle === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' ||
                /^(ao vivo|live)$/i.test(badgeText)
              ) {
                isLive = true;
              } else if (!durationText && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(badgeText)) {
                durationText = badgeText;
              }
            }
          }
        }

        // Extrai channelId do avatar / decoratedAvatarViewModel se presente
        const avatarEndpoint =
          lockup.metadata &&
          lockup.metadata.lockupMetadataViewModel &&
          lockup.metadata.lockupMetadataViewModel.image &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext
            .commandContext &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext
            .commandContext.onTap &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext
            .commandContext.onTap.innertubeCommand &&
          lockup.metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext
            .commandContext.onTap.innertubeCommand.browseEndpoint;

        if (avatarEndpoint) {
          channelId = avatarEndpoint.browseId || '';
          channelHandle = avatarEndpoint.canonicalBaseUrl || '';
        }

        if (!results.has(videoId)) {
          results.set(videoId, {
            videoId,
            title,
            durationText,
            channelId,
            channelHandle,
            channelName,
            publishedTimeText,
            isShort: false,
            isUpcoming,
            isLive,
            upcomingStartTime: null
          });
        }
      }

      for (const key of Object.keys(node)) {
        const child = node[key];
        if (child && typeof child === 'object') {
          visit(child);
        }
      }
    }

    visit(data);
    return Array.from(results.values());
  }

  /**
   * Lê um cookie específico a partir de uma string document.cookie.
   * @param {string} cookieString
   * @param {string} name
   * @returns {string}
   */
  function getCookieValue(cookieString, name) {
    if (!cookieString) return '';
    const cookies = cookieString.split(';');
    for (const raw of cookies) {
      const [k, ...vParts] = raw.trim().split('=');
      if (k === name) {
        return vParts.join('=');
      }
    }
    return '';
  }

  /**
   * Gera o cabeçalho Authorization SAPISIDHASH exigido pela API InnerTube do YouTube.
   * Formato: SAPISIDHASH <timestampSec>_<sha1Hex(timestampSec + " " + sapisid + " " + origin)>
   *
   * @param {string} sapisid Valor do cookie SAPISID ou __Secure-3PAPISID
   * @param {string} [origin='https://www.youtube.com'] Origem da página
   * @param {number} [nowMs=Date.now()] Timestamp atual em ms
   * @param {SubtleCrypto} [subtleCrypto] Instância de Web Crypto API
   * @returns {Promise<string>}
   */
  async function generateSapisidHashHeader(
    sapisid,
    origin = 'https://www.youtube.com',
    nowMs = Date.now(),
    subtleCrypto = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null
  ) {
    if (!sapisid) {
      throw new Error('Cookie SAPISID ausente');
    }
    if (!subtleCrypto) {
      throw new Error('Web Crypto API indisponível');
    }

    const timestampSec = Math.floor(nowMs / 1000);
    const input = `${timestampSec} ${sapisid} ${origin}`;
    const encoder = new TextEncoder();
    const hashBuffer = await subtleCrypto.digest('SHA-1', encoder.encode(input));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha1Hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return `SAPISIDHASH ${timestampSec}_${sha1Hex}`;
  }

  /**
   * Executa a chamada autenticada ao endpoint interno /youtubei/v1/subscription/unsubscribe.
   * Caso apenas o channelHandle (ex: /@canal) seja informado e não o UC... channelId,
   * tenta primeiro resolver o browseId via /youtubei/v1/navigation/resolve_url.
   *
   * @param {{
   *   channelId?: string,
   *   channelHandle?: string,
   *   cookieString?: string,
   *   origin?: string,
   *   ytcfgObj?: { get?: (key: string) => any },
   *   fetchImpl?: typeof fetch
   * }} options
   * @returns {Promise<{ ok: boolean, channelId: string, status?: number, error?: string }>}
   */
  async function performInnerTubeUnsubscribe(options = {}) {
    const {
      channelId: initialChannelId = '',
      channelHandle = '',
      cookieString = typeof document !== 'undefined' ? document.cookie : '',
      origin = typeof location !== 'undefined' ? location.origin : 'https://www.youtube.com',
      ytcfgObj = typeof window !== 'undefined' ? window.ytcfg : null,
      fetchImpl = typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null
    } = options;

    if (!fetchImpl) {
      return { ok: false, channelId: initialChannelId, error: 'fetch indisponível' };
    }

    const sapisid =
      getCookieValue(cookieString, 'SAPISID') ||
      getCookieValue(cookieString, '__Secure-3PAPISID');

    if (!sapisid) {
      return { ok: false, channelId: initialChannelId, error: 'Sessão SAPISID não encontrada' };
    }

    const apiKey =
      ytcfgObj && typeof ytcfgObj.get === 'function'
        ? ytcfgObj.get('INNERTUBE_API_KEY')
        : '';
    const context =
      ytcfgObj && typeof ytcfgObj.get === 'function'
        ? ytcfgObj.get('INNERTUBE_CONTEXT')
        : null;
    const authUser =
      (ytcfgObj && typeof ytcfgObj.get === 'function' && ytcfgObj.get('SESSION_INDEX')) || '0';

    if (!apiKey || !context) {
      return {
        ok: false,
        channelId: initialChannelId,
        error: 'INNERTUBE_API_KEY ou INNERTUBE_CONTEXT ausente'
      };
    }

    let authHeader;
    try {
      authHeader = await generateSapisidHashHeader(sapisid, origin);
    } catch (err) {
      return {
        ok: false,
        channelId: initialChannelId,
        error: err && err.message ? err.message : 'Erro ao gerar SAPISIDHASH'
      };
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      'X-Origin': origin,
      'X-Goog-AuthUser': String(authUser)
    };

    let targetChannelId = initialChannelId;

    // Se não temos o UC... ID mas temos o handle/path do canal, resolve via navigation/resolve_url
    if (!targetChannelId && channelHandle) {
      try {
        const fullUrl = channelHandle.startsWith('http')
          ? channelHandle
          : `${origin}${channelHandle.startsWith('/') ? '' : '/'}${channelHandle}`;
        const resolveResp = await fetchImpl(
          `${origin}/youtubei/v1/navigation/resolve_url?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
          {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              context,
              url: fullUrl
            })
          }
        );
        if (resolveResp.ok) {
          const resolveData = await resolveResp.json();
          const resolvedId =
            resolveData &&
            resolveData.endpoint &&
            resolveData.endpoint.browseEndpoint &&
            resolveData.endpoint.browseEndpoint.browseId;
          if (resolvedId) {
            targetChannelId = resolvedId;
          }
        }
      } catch (_) {
        // Ignora e segue para validação abaixo
      }
    }

    if (!targetChannelId) {
      return {
        ok: false,
        channelId: '',
        error: 'channelId não pôde ser determinado para desinscrição'
      };
    }

    try {
      const response = await fetchImpl(
        `${origin}/youtubei/v1/subscription/unsubscribe?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({
            context,
            channelIds: [targetChannelId]
          })
        }
      );

      if (!response.ok) {
        return {
          ok: false,
          channelId: targetChannelId,
          status: response.status,
          error: `HTTP ${response.status}`
        };
      }

      return {
        ok: true,
        channelId: targetChannelId,
        status: response.status
      };
    } catch (err) {
      return {
        ok: false,
        channelId: targetChannelId,
        error: err && err.message ? err.message : 'Erro de rede no unsubscribe'
      };
    }
  }

  let originalFetchRef = null;

  /**
   * Consulta silenciosamente o feed de inscrições (FEsubscriptions) via InnerTube /youtubei/v1/browse
   * para detectar novos vídeos sem recarregar a página.
   *
   * @param {{
   *   cookieString?: string,
   *   origin?: string,
   *   ytcfgObj?: { get?: (key: string) => any },
   *   fetchImpl?: typeof fetch
   * }} options
   * @returns {Promise<{ ok: boolean, items: any[], status?: number, error?: string }>}
   */
  async function fetchSubscriptionsFeedMetadata(options = {}) {
    const {
      cookieString = typeof document !== 'undefined' ? document.cookie : '',
      origin = typeof location !== 'undefined' ? location.origin : 'https://www.youtube.com',
      ytcfgObj = typeof window !== 'undefined' ? window.ytcfg : null,
      fetchImpl = originalFetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
    } = options;

    if (!fetchImpl) {
      return { ok: false, items: [], error: 'fetch indisponível' };
    }

    const sapisid =
      getCookieValue(cookieString, 'SAPISID') ||
      getCookieValue(cookieString, '__Secure-3PAPISID');

    if (!sapisid) {
      return { ok: false, items: [], error: 'Sessão SAPISID não encontrada' };
    }

    const apiKey =
      ytcfgObj && typeof ytcfgObj.get === 'function'
        ? ytcfgObj.get('INNERTUBE_API_KEY')
        : '';
    const context =
      ytcfgObj && typeof ytcfgObj.get === 'function'
        ? ytcfgObj.get('INNERTUBE_CONTEXT')
        : null;
    const authUser =
      (ytcfgObj && typeof ytcfgObj.get === 'function' && ytcfgObj.get('SESSION_INDEX')) || '0';

    if (!apiKey || !context) {
      return {
        ok: false,
        items: [],
        error: 'INNERTUBE_API_KEY ou INNERTUBE_CONTEXT ausente'
      };
    }

    let authHeader;
    try {
      authHeader = await generateSapisidHashHeader(sapisid, origin);
    } catch (err) {
      return {
        ok: false,
        items: [],
        error: err && err.message ? err.message : 'Erro ao gerar SAPISIDHASH'
      };
    }

    try {
      const response = await fetchImpl(
        `${origin}/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
            'X-Origin': origin,
            'X-Goog-AuthUser': String(authUser)
          },
          body: JSON.stringify({
            context,
            browseId: 'FEsubscriptions'
          })
        }
      );

      if (!response.ok) {
        return {
          ok: false,
          items: [],
          status: response.status,
          error: `HTTP ${response.status}`
        };
      }

      const jsonData = await response.json();
      const items = extractVideosFromYtData(jsonData);
      return {
        ok: true,
        items,
        status: response.status
      };
    } catch (err) {
      return {
        ok: false,
        items: [],
        error: err && err.message ? err.message : 'Erro de rede ao consultar inscrições'
      };
    }
  }

  const cachedItemsById = new Map();

  /**
   * Emite um lote de metadados extraídos para o content script (ISOLATED world)
   * e mantém cache local para reenvio quando o content script solicita metadados iniciais.
   * @param {any[]} items
   */
  function emitMetadataBatch(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
      if (item && item.videoId) {
        cachedItemsById.set(item.videoId, item);
      }
    }
    if (typeof window === 'undefined' || typeof window.postMessage !== 'function') return;

    window.postMessage(
      {
        source: MAIN_SOURCE,
        type: 'METADATA_BATCH',
        items
      },
      '*'
    );
  }

  /**
   * Lê window.ytInitialData se presente e publica os metadados (incluindo itens já interceptados via fetch).
   */
  function scanInitialData() {
    if (typeof window === 'undefined') return;
    try {
      const merged = new Map();
      if (window.ytInitialData) {
        for (const item of extractVideosFromYtData(window.ytInitialData)) {
          if (item && item.videoId) merged.set(item.videoId, item);
        }
      }
      for (const [id, item] of cachedItemsById.entries()) {
        merged.set(id, item);
      }
      if (merged.size > 0) {
        emitMetadataBatch(Array.from(merged.values()));
      }
    } catch (err) {
      console.warn('[ZeroSub] Erro ao ler ytInitialData:', err);
    }
  }

  /**
   * Instala hooks no ambiente do navegador (window).
   */
  function setupBrowserHooks() {
    if (typeof window === 'undefined' || window.__zeroSubInjectorInstalled) return;
    window.__zeroSubInjectorInstalled = true;

    // 1. Intercepta window.fetch para capturar lotes de /youtubei/v1/browse (scroll infinito e navegação SPA)
    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch;
      originalFetchRef = originalFetch.bind(window);
      window.fetch = async function zeroSubFetchWrapper(...args) {
        const response = await originalFetch.apply(this, args);
        try {
          const reqInfo = args[0];
          const url =
            typeof reqInfo === 'string'
              ? reqInfo
              : reqInfo && typeof reqInfo.url === 'string'
                ? reqInfo.url
                : '';

          if (url.includes('/youtubei/v1/browse')) {
            const clone = response.clone();
            clone
              .json()
              .then((jsonData) => {
                const items = extractVideosFromYtData(jsonData);
                emitMetadataBatch(items);
              })
              .catch(() => {});
          }
        } catch (_) {
          // Nunca interrompe o fetch original do YouTube
        }
        return response;
      };
    }

    // 2. Escuta eventos de navegação e solicitações vindas do ISOLATED world
    window.addEventListener('yt-navigate-finish', () => {
      scanInitialData();
    });

    window.addEventListener('DOMContentLoaded', () => {
      scanInitialData();
    });

    window.addEventListener('message', async (event) => {
      if (event.source !== window || !event.data || event.data.source !== ISOLATED_SOURCE) {
        return;
      }

      const { type, requestId, channelId, channelHandle } = event.data;

      if (type === 'REQUEST_INITIAL_METADATA') {
        scanInitialData();
      } else if (type === 'UNSUBSCRIBE_CHANNEL') {
        const result = await performInnerTubeUnsubscribe({
          channelId,
          channelHandle
        });
        window.postMessage(
          {
            source: MAIN_SOURCE,
            type: 'UNSUBSCRIBE_RESULT',
            requestId,
            ...result
          },
          '*'
        );
      } else if (type === 'CHECK_NEW_VIDEOS') {
        const result = await fetchSubscriptionsFeedMetadata();
        window.postMessage(
          {
            source: MAIN_SOURCE,
            type: 'CHECK_NEW_VIDEOS_RESULT',
            requestId,
            ...result
          },
          '*'
        );
      }
    });

    // Faz uma leitura imediata caso ytInitialData já esteja carregado
    scanInitialData();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    setupBrowserHooks();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      extractText,
      extractChannelInfo,
      extractVideosFromYtData,
      getCookieValue,
      generateSapisidHashHeader,
      performInnerTubeUnsubscribe,
      fetchSubscriptionsFeedMetadata
    };
  } else if (rootScope) {
    rootScope.ZeroSubInjector = {
      extractVideosFromYtData,
      generateSapisidHashHeader,
      performInnerTubeUnsubscribe,
      fetchSubscriptionsFeedMetadata
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
