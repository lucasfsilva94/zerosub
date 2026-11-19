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
   * Inicializa a interface do popup quando executado no navegador.
   */
  async function setupPopupDOM() {
    if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) {
      return;
    }

    const pendingCountEl = document.getElementById('pending-count');
    const dismissedCountEl = document.getElementById('dismissed-count');
    const baselineLabelEl = document.getElementById('baseline-label');
    const statusMessageEl = document.getElementById('status-message');

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
        // Fallback: oculta o canal localmente e limpa a sugestão
        const data = await chrome.storage.local.get(['unsubscribedChannels']);
        const unsubSet = new Set(Array.isArray(data.unsubscribedChannels) ? data.unsubscribedChannels : []);
        if (entry.channelId) unsubSet.add(entry.channelId);
        if (entry.channelHandle) unsubSet.add(entry.channelHandle);
        if (entry.channelKey) unsubSet.add(entry.channelKey);
        await chrome.storage.local.set({ unsubscribedChannels: Array.from(unsubSet) });
        await keepChannelInStorage(chrome.storage.local, entry);
      }

      await refreshUI();
      showFeedback(`Canal "${entry.channelName || entry.channelKey}" removido!`);
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
        'unsubscribedChannels',
        'notInterestedByChannel',
        'pendingCount'
      ]);

      const count = typeof data.pendingCount === 'number' ? data.pendingCount : 0;
      const dismissedList = Array.isArray(data.dismissedVideos) ? data.dismissedVideos : [];

      pendingCountEl.textContent = String(count);
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
      keepChannelInStorage
    };
  } else if (rootScope) {
    rootScope.ZeroSubPopup = {
      resetZeroSubQueue,
      restoreDismissedVideos,
      formatBaselineTimestamp,
      getPopupSuggestions,
      keepChannelInStorage
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
