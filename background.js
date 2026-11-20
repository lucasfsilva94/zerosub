/**
 * ZeroSub — Background Service Worker (Manifest V3)
 * Inicializa o Marco Zero (installTimestamp) e configurações padrão sem sobrescrever dados em atualizações.
 */

const DEFAULT_STATE = {
  zeroSubEnabled: true,
  hideShorts: true,
  hideScheduledLives: true,
  autoMarkWatched: true,
  dismissedVideos: [],
  watchLaterVideos: [],
  unsubscribedChannels: [],
  baselineAnchorIds: [],
  notInterestedByChannel: {},
  lastClearedAt: null,
  pendingCount: 0
};

/**
 * Calcula os campos que precisam ser inicializados no storage,
 * preservando valores já existentes em caso de atualização da extensão.
 *
 * @param {Record<string, any>} existingData Dados atualmente salvos em chrome.storage.local
 * @param {number} [now=Date.now()] Timestamp atual
 * @returns {Record<string, any>} Objeto contendo apenas as chaves que precisam ser gravadas
 */
function buildInitialStatePatch(existingData = {}, now = Date.now()) {
  const patch = {};

  if (typeof existingData.installTimestamp !== 'number' || Number.isNaN(existingData.installTimestamp)) {
    patch.installTimestamp = now;
  }

  for (const [key, defaultValue] of Object.entries(DEFAULT_STATE)) {
    if (existingData[key] === undefined) {
      if (Array.isArray(defaultValue)) {
        patch[key] = [...defaultValue];
      } else if (defaultValue && typeof defaultValue === 'object') {
        patch[key] = { ...defaultValue };
      } else {
        patch[key] = defaultValue;
      }
    }
  }

  return patch;
}

/**
 * Inicializa o estado no chrome.storage.local.
 *
 * @param {chrome.storage.StorageArea} storageArea
 * @param {number} [now=Date.now()]
 * @returns {Promise<Record<string, any>>}
 */
async function ensureInitialState(storageArea, now = Date.now()) {
  const keysToQuery = ['installTimestamp', ...Object.keys(DEFAULT_STATE)];
  const existingData = await storageArea.get(keysToQuery);
  const patch = buildInitialStatePatch(existingData, now);

  if (Object.keys(patch).length > 0) {
    await storageArea.set(patch);
  }

  return { ...existingData, ...patch };
}

/**
 * Atualiza o badge da extensão com a quantidade de vídeos pendentes
 * ou, quando a fila principal estiver zerada, com o lembrete azul de "Ver depois".
 *
 * @param {number} count
 * @param {boolean} [enabled=true]
 * @param {number} [watchLaterCount=0]
 */
function updateActionBadge(count, enabled = true, watchLaterCount = 0) {
  if (typeof chrome === 'undefined' || !chrome.action) return;

  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#717171' });
    return;
  }

  const numericCount = Number(count) || 0;
  if (numericCount > 0) {
    const text = numericCount > 99 ? '99+' : String(numericCount);
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#cc0000' });
    return;
  }

  const numericWatchLater = Number(watchLaterCount) || 0;
  if (numericWatchLater > 0) {
    const text = numericWatchLater > 99 ? '99+' : String(numericWatchLater);
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    return;
  }

  chrome.action.setBadgeText({ text: '' });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      const state = await ensureInitialState(chrome.storage.local);
      const watchLaterCount = Array.isArray(state.watchLaterVideos) ? state.watchLaterVideos.length : 0;
      updateActionBadge(state.pendingCount, state.zeroSubEnabled, watchLaterCount);
    } catch (err) {
      console.error('[ZeroSub] Falha ao inicializar estado no onInstalled:', err);
    }
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.pendingCount || changes.zeroSubEnabled || changes.watchLaterVideos) {
        chrome.storage.local.get(['pendingCount', 'zeroSubEnabled', 'watchLaterVideos']).then((data) => {
          const watchLaterCount = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos.length : 0;
          updateActionBadge(data.pendingCount, data.zeroSubEnabled !== false, watchLaterCount);
        });
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_STATE,
    buildInitialStatePatch,
    ensureInitialState,
    updateActionBadge
  };
}
