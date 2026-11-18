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

    async function refreshUI() {
      const data = await chrome.storage.local.get([
        'installTimestamp',
        'zeroSubEnabled',
        'hideShorts',
        'hideScheduledLives',
        'autoMarkWatched',
        'dismissedVideos',
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
      formatBaselineTimestamp
    };
  } else if (rootScope) {
    rootScope.ZeroSubPopup = {
      resetZeroSubQueue,
      restoreDismissedVideos,
      formatBaselineTimestamp
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
