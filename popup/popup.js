/**
 * ZeroSub — Popup Controller (popup/popup.js)
 * Gerencia o dashboard rápido da extensão:
 * - Contador de vídeos pendentes na fila
 * - Botão "Zerar tudo agora" (redefine installTimestamp = Date.now())
 * - Botão "Restaurar vídeos ocultos" (limpa dismissedVideos)
 * - Toggles de configuração sincronizados com chrome.storage.local
 */

(function initZeroSubPopup(rootScope) {
  /**
   * Executa a ação "Zerar tudo agora" no storage.
   * @param {chrome.storage.StorageArea} storageArea
   * @param {number} [now=Date.now()]
   * @returns {Promise<{ installTimestamp: number, pendingCount: number, zeroSubEnabled: boolean }>}
   */
  async function resetZeroSubQueue(storageArea, now = Date.now()) {
    const payload = {
      installTimestamp: now,
      lastClearedAt: now,
      pendingCount: 0,
      zeroSubEnabled: true
    };
    await storageArea.set(payload);
    return payload;
  }

  /**
   * Executa a ação "Restaurar vídeos ocultos" limpando dismissedVideos no storage.
   * @param {chrome.storage.StorageArea} storageArea
   * @returns {Promise<{ dismissedVideos: string[] }>}
   */
  async function restoreDismissedVideos(storageArea) {
    const payload = {
      dismissedVideos: []
    };
    await storageArea.set(payload);
    return payload;
  }

  /**
   * Formata o timestamp do Marco Zero para exibição compacta no cabeçalho do popup.
   * @param {number} timestampMs
   * @returns {string}
   */
  function formatBaselineTimestamp(timestampMs) {
    if (typeof timestampMs !== 'number' || Number.isNaN(timestampMs)) return '--';
    return new Date(timestampMs).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Retorna os canais elegíveis para sugestão de desinscrição (>= 3 vídeos distintos sem interesse).
   * @param {Record<string, any>} notInterestedByChannel
   * @param {string[]} unsubscribedChannels
   * @param {number} [threshold=3]
   */
  function getPopupSuggestions(notInterestedByChannel = {}, unsubscribedChannels = [], threshold = 3) {
    const unsubSet = new Set(Array.isArray(unsubscribedChannels) ? unsubscribedChannels : []);
    return Object.values(notInterestedByChannel || {})
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
   * Remove um canal de notInterestedByChannel no storage ("Manter canal").
   * @param {chrome.storage.StorageArea} storageArea
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string }} channelInfo
   */
  async function keepChannelInStorage(storageArea, channelInfo) {
    const data = await storageArea.get(['notInterestedByChannel']);
    const updatedMap = { ...(data.notInterestedByChannel || {}) };

    for (const [k, entry] of Object.entries(updatedMap)) {
      const matches =
        (channelInfo.channelKey && (k === channelInfo.channelKey || (entry && entry.channelKey === channelInfo.channelKey))) ||
        (channelInfo.channelId && entry && entry.channelId === channelInfo.channelId) ||
        (channelInfo.channelHandle && entry && entry.channelHandle === channelInfo.channelHandle);
      if (matches) {
        delete updatedMap[k];
      }
    }

    await storageArea.set({ notInterestedByChannel: updatedMap });
    return updatedMap;
  }

  /**
   * Marca um vídeo de "Ver depois" como visto no storage (remove de watchLaterVideos e adiciona em dismissedVideos).
   * @param {chrome.storage.StorageArea} storageArea
   * @param {string} videoId
   */
  async function markWatchLaterAsSeenInStorage(storageArea, videoId) {
    const data = await storageArea.get(['watchLaterVideos', 'dismissedVideos']);
    const currentWl = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos : [];
    const currentDismissed = Array.isArray(data.dismissedVideos) ? data.dismissedVideos : [];

    const watchLaterVideos = currentWl.filter((item) => item && item.videoId !== videoId);
    const dismissedVideos = videoId
      ? [...currentDismissed.filter((id) => id !== videoId), videoId].slice(-5000)
      : currentDismissed;

    await storageArea.set({ watchLaterVideos, dismissedVideos });
    return { watchLaterVideos, dismissedVideos };
  }

  /**
   * Marca um vídeo de "Ver depois" como "Sem interesse" no storage.
   * Remove de watchLaterVideos, adiciona em dismissedVideos e registra em notInterestedByChannel.
   * @param {chrome.storage.StorageArea} storageArea
   * @param {Record<string, any>} videoInfo
   * @param {number} [now=Date.now()]
   * @param {number} [threshold=3]
   */
  async function markWatchLaterNotInterestedInStorage(
    storageArea,
    videoInfo = {},
    now = Date.now(),
    threshold = 3
  ) {
    const data = await storageArea.get([
      'watchLaterVideos',
      'dismissedVideos',
      'notInterestedByChannel'
    ]);
    const currentWl = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos : [];
    const currentDismissed = Array.isArray(data.dismissedVideos) ? data.dismissedVideos : [];
    const currentMap =
      data.notInterestedByChannel && typeof data.notInterestedByChannel === 'object'
        ? { ...data.notInterestedByChannel }
        : {};

    const videoId = videoInfo.videoId || '';
    const watchLaterVideos = currentWl.filter((item) => item && item.videoId !== videoId);
    const dismissedVideos = videoId
      ? [...currentDismissed.filter((id) => id !== videoId), videoId].slice(-5000)
      : currentDismissed;

    const key =
      videoInfo.channelKey ||
      videoInfo.channelId ||
      videoInfo.channelHandle ||
      videoInfo.channelName ||
      '';
    let reachedThreshold = false;
    let count = 0;

    if (key && videoId) {
      const prev = currentMap[key];
      const prevIds = prev && Array.isArray(prev.videoIds) ? prev.videoIds : [];
      const prevCount = prevIds.length;
      const nextIds = prevIds.includes(videoId) ? [...prevIds] : [...prevIds, videoId];
      count = nextIds.length;
      reachedThreshold = prevCount < threshold && count >= threshold;
      currentMap[key] = {
        channelKey: key,
        channelId: videoInfo.channelId || (prev && prev.channelId) || '',
        channelHandle: videoInfo.channelHandle || (prev && prev.channelHandle) || '',
        channelName: videoInfo.channelName || (prev && prev.channelName) || videoInfo.channelHandle || key,
        videoIds: nextIds,
        updatedAt: now
      };
    }

    await storageArea.set({
      watchLaterVideos,
      dismissedVideos,
      notInterestedByChannel: currentMap
    });
    return {
      watchLaterVideos,
      dismissedVideos,
      notInterestedByChannel: currentMap,
      count,
      reachedThreshold
    };
  }

  /**
   * Remove todos os vídeos de um canal de watchLaterVideos no storage.
   * @param {chrome.storage.StorageArea} storageArea
   * @param {{ channelKey?: string, channelId?: string, channelHandle?: string }} channelInfo
   */
  async function removeChannelFromWatchLaterInStorage(storageArea, channelInfo = {}) {
    const data = await storageArea.get(['watchLaterVideos']);
    const currentWl = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos : [];
    const watchLaterVideos = currentWl.filter((item) => {
      if (!item) return false;
      const matches =
        (channelInfo.channelKey && item.channelKey === channelInfo.channelKey) ||
        (channelInfo.channelId && item.channelId === channelInfo.channelId) ||
        (channelInfo.channelHandle && item.channelHandle === channelInfo.channelHandle);
      return !matches;
    });
    await storageArea.set({ watchLaterVideos });
    return watchLaterVideos;
  }

  /**
   * Controlador de confirmação em 2 cliques para o botão "Desinscrever" no popup.
   */
  function createPopupTwoStepConfirmation(callbacks) {
    const timeoutMs = callbacks.timeoutMs || 4000;
    let confirming = false;
    let timerId = null;

    return {
      trigger() {
        if (!confirming) {
          confirming = true;
          if (typeof callbacks.onEnterConfirm === 'function') callbacks.onEnterConfirm();
          timerId = setTimeout(() => {
            timerId = null;
            confirming = false;
            if (typeof callbacks.onReset === 'function') callbacks.onReset();
          }, timeoutMs);
          return 'confirming';
        }
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        confirming = false;
        if (typeof callbacks.onConfirmed === 'function') callbacks.onConfirmed();
        return 'confirmed';
      }
    };
  }

  /**
   * Inicializa a interface do popup quando executado no navegador.
   */
  async function setupPopupDOM() {
    if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    const pendingCountEl = document.getElementById('pending-count');
    const watchLaterCountEl = document.getElementById('watch-later-count');
    const dismissedCountEl = document.getElementById('dismissed-count');
    const baselineLabelEl = document.getElementById('baseline-label');
    const statusMessageEl = document.getElementById('status-message');

    const watchLaterSectionEl = document.getElementById('watch-later-section');
    const watchLaterBadgeEl = document.getElementById('watch-later-badge');
    const watchLaterListEl = document.getElementById('watch-later-list');

    const suggestionsSectionEl = document.getElementById('suggestions-section');
    const suggestionsBadgeEl = document.getElementById('suggestions-badge');
    const suggestionsListEl = document.getElementById('suggestions-list');

    const btnResetNow = document.getElementById('btn-reset-now');
    const btnRestoreHidden = document.getElementById('btn-restore-hidden');

    const toggleEnabled = document.getElementById('toggle-zerosub-enabled');
    const toggleHideShorts = document.getElementById('toggle-hide-shorts');
    const toggleHideLives = document.getElementById('toggle-hide-lives');
    const toggleAutoWatched = document.getElementById('toggle-auto-watched');

    if (!pendingCountEl || !btnResetNow) return;

    function showFeedback(text) {
      if (!statusMessageEl) return;
      statusMessageEl.textContent = text;
      setTimeout(() => {
        if (statusMessageEl.textContent === text) {
          statusMessageEl.textContent = '';
        }
      }, 2500);
    }

    async function triggerPopupUnsubscribe(entry) {
      let sentToYouTubeTab = false;

      if (chrome.tabs && chrome.tabs.query) {
        const tabs = await new Promise((resolve) => {
          chrome.tabs.query({ url: '*://*.youtube.com/*' }, (found) => resolve(found || []));
        });

        const targetTab =
          tabs.find((t) => t.url && t.url.includes('/feed/subscriptions')) || tabs[0];

        if (targetTab && targetTab.id) {
          sentToYouTubeTab = await new Promise((resolve) => {
            chrome.tabs.sendMessage(
              targetTab.id,
              { type: 'ZEROSUB_UNSUBSCRIBE_CHANNEL', channelInfo: entry },
              (resp) => {
                if (chrome.runtime.lastError) {
                  resolve(false);
                } else {
                  resolve(Boolean(resp && resp.ok));
                }
              }
            );
          });
        }
      }

      if (!sentToYouTubeTab) {
        // Fallback: oculta o canal localmente, limpa sugestões e "Ver depois"
        const data = await chrome.storage.local.get(['unsubscribedChannels']);
        const unsubSet = new Set(Array.isArray(data.unsubscribedChannels) ? data.unsubscribedChannels : []);
        if (entry.channelId) unsubSet.add(entry.channelId);
        if (entry.channelHandle) unsubSet.add(entry.channelHandle);
        if (entry.channelKey) unsubSet.add(entry.channelKey);
        await chrome.storage.local.set({ unsubscribedChannels: Array.from(unsubSet) });
        await keepChannelInStorage(chrome.storage.local, entry);
        await removeChannelFromWatchLaterInStorage(chrome.storage.local, entry);
      }

      await refreshUI();
      showFeedback(`Canal "${entry.channelName || entry.channelKey}" removido!`);
    }

    function renderWatchLater(items) {
      if (!watchLaterSectionEl || !watchLaterListEl) return;
      const safeItems = Array.isArray(items) ? items : [];

      if (safeItems.length === 0) {
        watchLaterSectionEl.hidden = true;
        watchLaterListEl.innerHTML = '';
        watchLaterListEl.removeAttribute('data-render-key');
        return;
      }

      watchLaterSectionEl.hidden = false;
      if (watchLaterBadgeEl) {
        watchLaterBadgeEl.textContent = String(safeItems.length);
      }

      const renderKey = safeItems
        .map((item) => `${item.videoId || ''}:${item.savedAt || 0}`)
        .join('|');
      if (watchLaterListEl.getAttribute('data-render-key') === renderKey) {
        return;
      }
      watchLaterListEl.setAttribute('data-render-key', renderKey);
      watchLaterListEl.innerHTML = '';

      safeItems.forEach((item) => {
        const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId)}`;
        const row = document.createElement('div');
        row.className = 'wl-item';

        const top = document.createElement('div');
        top.className = 'wl-item-top';

        const thumbLink = document.createElement('a');
        thumbLink.className = 'wl-thumb-link';
        thumbLink.href = watchUrl;
        thumbLink.target = '_blank';
        thumbLink.rel = 'noopener noreferrer';

        const thumbImg = document.createElement('img');
        thumbImg.className = 'wl-thumb';
        thumbImg.src =
          item.thumbnailUrl ||
          `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/mqdefault.jpg`;
        thumbImg.alt = item.title || 'Thumbnail do vídeo';
        thumbLink.appendChild(thumbImg);

        if (item.durationText) {
          const durEl = document.createElement('span');
          durEl.className = 'wl-duration';
          durEl.textContent = item.durationText;
          thumbLink.appendChild(durEl);
        }

        const meta = document.createElement('div');
        meta.className = 'wl-meta';

        const titleLink = document.createElement('a');
        titleLink.className = 'wl-title';
        titleLink.href = watchUrl;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        titleLink.textContent = item.title || `Vídeo ${item.videoId}`;
        titleLink.title = item.title || item.videoId;

        const channelEl = document.createElement('span');
        channelEl.className = 'wl-channel';
        channelEl.textContent = item.channelName || item.channelHandle || item.channelKey || '';

        meta.appendChild(titleLink);
        meta.appendChild(channelEl);

        top.appendChild(thumbLink);
        top.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'wl-actions';

        const seenBtn = document.createElement('button');
        seenBtn.type = 'button';
        seenBtn.className = 'btn-mini btn-mini-seen';
        seenBtn.textContent = '✓ Visto';
        seenBtn.addEventListener('click', async () => {
          await markWatchLaterAsSeenInStorage(chrome.storage.local, item.videoId);
          await refreshUI();
          showFeedback('Vídeo marcado como visto!');
        });

        const notIntBtn = document.createElement('button');
        notIntBtn.type = 'button';
        notIntBtn.className = 'btn-mini btn-mini-not-int';
        notIntBtn.textContent = '✕ Sem interesse';
        notIntBtn.addEventListener('click', async () => {
          const res = await markWatchLaterNotInterestedInStorage(chrome.storage.local, item);
          await refreshUI();
          showFeedback(
            res.reachedThreshold
              ? 'Canal adicionado às Sugestões para desinscrever!'
              : 'Sem interesse registrado'
          );
        });

        const unsubBtn = document.createElement('button');
        unsubBtn.type = 'button';
        unsubBtn.className = 'btn-mini btn-mini-unsub-neutral';
        unsubBtn.textContent = 'Desinscrever';

        const confirmCtrl = createPopupTwoStepConfirmation({
          timeoutMs: 4000,
          onEnterConfirm() {
            unsubBtn.textContent = 'Confirmar?';
            unsubBtn.classList.add('btn-mini-confirming');
          },
          onReset() {
            unsubBtn.textContent = 'Desinscrever';
            unsubBtn.classList.remove('btn-mini-confirming');
          },
          async onConfirmed() {
            unsubBtn.disabled = true;
            unsubBtn.textContent = 'Cancelando...';
            await triggerPopupUnsubscribe(item);
          }
        });

        unsubBtn.addEventListener('click', () => {
          confirmCtrl.trigger();
        });

        actions.appendChild(seenBtn);
        actions.appendChild(notIntBtn);
        actions.appendChild(unsubBtn);

        row.appendChild(top);
        row.appendChild(actions);
        watchLaterListEl.appendChild(row);
      });
    }

    function renderSuggestions(suggestions) {
      if (!suggestionsSectionEl || !suggestionsListEl) return;

      if (!suggestions || suggestions.length === 0) {
        suggestionsSectionEl.hidden = true;
        suggestionsListEl.innerHTML = '';
        return;
      }

      suggestionsSectionEl.hidden = false;
      if (suggestionsBadgeEl) {
        suggestionsBadgeEl.textContent = String(suggestions.length);
      }

      suggestionsListEl.innerHTML = '';
      suggestions.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'suggestion-row';

        const info = document.createElement('div');
        info.className = 'suggestion-info';

        const nameEl = document.createElement('span');
        nameEl.className = 'suggestion-name';
        nameEl.textContent = entry.channelName || entry.channelHandle || entry.channelKey;

        const countEl = document.createElement('span');
        countEl.className = 'suggestion-count';
        countEl.textContent = `${entry.videoIds.length} vídeos sem interesse`;

        info.appendChild(nameEl);
        info.appendChild(countEl);

        const actions = document.createElement('div');
        actions.className = 'suggestion-actions';

        const keepBtn = document.createElement('button');
        keepBtn.type = 'button';
        keepBtn.className = 'btn-mini btn-mini-keep';
        keepBtn.textContent = 'Manter';
        keepBtn.title = 'Manter canal e zerar contador';
        keepBtn.addEventListener('click', async () => {
          await keepChannelInStorage(chrome.storage.local, entry);
          await refreshUI();
          showFeedback('Canal mantido');
        });

        const unsubBtn = document.createElement('button');
        unsubBtn.type = 'button';
        unsubBtn.className = 'btn-mini btn-mini-unsub';
        unsubBtn.textContent = 'Desinscrever';
        unsubBtn.addEventListener('click', async () => {
          unsubBtn.disabled = true;
          await triggerPopupUnsubscribe(entry);
        });

        actions.appendChild(keepBtn);
        actions.appendChild(unsubBtn);

        row.appendChild(info);
        row.appendChild(actions);
        suggestionsListEl.appendChild(row);
      });
    }

    async function refreshUI() {
      const data = await chrome.storage.local.get([
        'installTimestamp',
        'zeroSubEnabled',
        'hideShorts',
        'hideScheduledLives',
        'autoMarkWatched',
        'dismissedVideos',
        'watchLaterVideos',
        'unsubscribedChannels',
        'notInterestedByChannel',
        'pendingCount'
      ]);

      const count = typeof data.pendingCount === 'number' ? data.pendingCount : 0;
      const dismissedList = Array.isArray(data.dismissedVideos) ? data.dismissedVideos : [];
      const watchLaterList = Array.isArray(data.watchLaterVideos) ? data.watchLaterVideos : [];

      pendingCountEl.textContent = String(count);
      if (watchLaterCountEl) {
        watchLaterCountEl.textContent = String(watchLaterList.length);
      }
      if (dismissedCountEl) {
        dismissedCountEl.textContent = String(dismissedList.length);
      }
      if (baselineLabelEl) {
        baselineLabelEl.textContent = `Desde ${formatBaselineTimestamp(data.installTimestamp)}`;
      }

      if (toggleEnabled) toggleEnabled.checked = data.zeroSubEnabled !== false;
      if (toggleHideShorts) toggleHideShorts.checked = data.hideShorts !== false;
      if (toggleHideLives) toggleHideLives.checked = data.hideScheduledLives !== false;
      if (toggleAutoWatched) toggleAutoWatched.checked = data.autoMarkWatched !== false;

      renderWatchLater(watchLaterList);

      const suggestions = getPopupSuggestions(
        data.notInterestedByChannel,
        data.unsubscribedChannels
      );
      renderSuggestions(suggestions);
    }

    // Tenta consultar a aba ativa caso seja /feed/subscriptions para obter contagem em tempo real
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs && tabs[0];
        if (activeTab && activeTab.id && activeTab.url && activeTab.url.includes('youtube.com/feed/subscriptions')) {
          chrome.tabs.sendMessage(
            activeTab.id,
            { type: 'ZEROSUB_GET_PENDING_COUNT' },
            (resp) => {
              if (!chrome.runtime.lastError && resp && typeof resp.pendingCount === 'number') {
                pendingCountEl.textContent = String(resp.pendingCount);
              }
            }
          );
        }
      });
    }

    btnResetNow.addEventListener('click', async () => {
      await resetZeroSubQueue(chrome.storage.local);

      if (chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({ url: '*://*.youtube.com/feed/subscriptions*' }, (tabs) => {
          (tabs || []).forEach((tab) => {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { type: 'ZEROSUB_RESET_NOW' }, () => {
                void chrome.runtime.lastError;
              });
            }
          });
        });
      }

      await refreshUI();
      showFeedback('Fila zerada com sucesso!');
    });

    btnRestoreHidden.addEventListener('click', async () => {
      await restoreDismissedVideos(chrome.storage.local);
      await refreshUI();
      showFeedback('Vídeos ocultos restaurados!');
    });

    const bindToggle = (inputEl, storageKey) => {
      if (!inputEl) return;
      inputEl.addEventListener('change', async () => {
        await chrome.storage.local.set({ [storageKey]: inputEl.checked });
        await refreshUI();
        showFeedback('Configuração salva');
      });
    };

    bindToggle(toggleEnabled, 'zeroSubEnabled');
    bindToggle(toggleHideShorts, 'hideShorts');
    bindToggle(toggleHideLives, 'hideScheduledLives');
    bindToggle(toggleAutoWatched, 'autoMarkWatched');

    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((_changes, areaName) => {
        if (areaName === 'local') {
          refreshUI();
        }
      });
    }

    await refreshUI();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupPopupDOM);
    } else {
      setupPopupDOM();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      resetZeroSubQueue,
      restoreDismissedVideos,
      formatBaselineTimestamp,
      getPopupSuggestions,
      keepChannelInStorage,
      markWatchLaterAsSeenInStorage,
      markWatchLaterNotInterestedInStorage,
      removeChannelFromWatchLaterInStorage,
      createPopupTwoStepConfirmation
    };
  } else if (rootScope) {
    rootScope.ZeroSubPopup = {
      resetZeroSubQueue,
      restoreDismissedVideos,
      formatBaselineTimestamp,
      getPopupSuggestions,
      keepChannelInStorage,
      markWatchLaterAsSeenInStorage,
      markWatchLaterNotInterestedInStorage,
      removeChannelFromWatchLaterInStorage,
      createPopupTwoStepConfirmation
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
