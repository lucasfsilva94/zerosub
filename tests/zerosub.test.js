const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_STATE,
  buildInitialStatePatch,
  ensureInitialState,
  updateActionBadge
} = require('../background.js');

const {
  extractVideosFromYtData,
  generateSapisidHashHeader,
  performInnerTubeUnsubscribe
} = require('../content/injector.js');

const {
  NOT_INTERESTED_THRESHOLD,
  parseRelativeTime,
  extractVideoIdFromHref,
  isScheduledLiveText,
  evaluateCardVisibility,
  evaluateFeedItems,
  isZeroSubOwnedNode,
  isElementNativelyHidden,
  isCardEligibleForFeed,
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
} = require('../content/content.js');

const {
  resetZeroSubQueue,
  restoreDismissedVideos,
  formatBaselineTimestamp,
  getPopupSuggestions,
  keepChannelInStorage,
  markWatchLaterAsSeenInStorage,
  markWatchLaterNotInterestedInStorage,
  removeChannelFromWatchLaterInStorage,
  createPopupTwoStepConfirmation
} = require('../popup/popup.js');

test('1.1 manifest.json é um JSON Manifest V3 válido com scripts e permissões exigidos', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.host_permissions.includes('*://*.youtube.com/*'));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup/popup.html');

  const mainScript = manifest.content_scripts.find((cs) => cs.world === 'MAIN');
  const isolatedScript = manifest.content_scripts.find((cs) => cs.world === 'ISOLATED');

  assert.ok(mainScript, 'Deve registrar content script no MAIN world');
  assert.ok(mainScript.js.includes('content/injector.js'));
  assert.ok(isolatedScript, 'Deve registrar content script no ISOLATED world');
  assert.ok(isolatedScript.js.includes('content/content.js'));
  assert.ok(isolatedScript.css.includes('content/styles.css'));
});

test('1.2 buildInitialStatePatch e ensureInitialState inicializam installTimestamp na primeira instalação e preservam na atualização', async () => {
  const fixedNow = 1763436000000;
  const patchFirstInstall = buildInitialStatePatch({}, fixedNow);

  assert.equal(patchFirstInstall.installTimestamp, fixedNow);
  assert.equal(patchFirstInstall.zeroSubEnabled, true);
  assert.equal(patchFirstInstall.hideShorts, true);
  assert.equal(patchFirstInstall.hideScheduledLives, true);
  assert.equal(patchFirstInstall.autoMarkWatched, true);
  assert.deepEqual(patchFirstInstall.dismissedVideos, []);
  assert.deepEqual(patchFirstInstall.unsubscribedChannels, []);
  assert.equal(patchFirstInstall.pendingCount, 0);

  // Simula storage mock
  let store = {};
  const mockStorage = {
    async get(keys) {
      const res = {};
      for (const k of keys) {
        if (store[k] !== undefined) res[k] = store[k];
      }
      return res;
    },
    async set(obj) {
      store = { ...store, ...obj };
    }
  };

  await ensureInitialState(mockStorage, fixedNow);
  assert.equal(store.installTimestamp, fixedNow);

  // Simula atualização da extensão com dados pré-existentes
  store.dismissedVideos = ['vid_123'];
  store.zeroSubEnabled = false;
  const laterNow = fixedNow + 999999;

  await ensureInitialState(mockStorage, laterNow);
  assert.equal(store.installTimestamp, fixedNow, 'Não deve sobrescrever installTimestamp existente');
  assert.deepEqual(store.dismissedVideos, ['vid_123'], 'Não deve limpar dismissedVideos existentes');
  assert.equal(store.zeroSubEnabled, false, 'Não deve sobrescrever zeroSubEnabled existente');
});

test('2.1 extractVideosFromYtData extrai videoId, channelId, publishedTimeText, isShort e isUpcoming de payloads do YouTube', () => {
  const samplePayload = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    {
                      richItemRenderer: {
                        content: {
                          videoRenderer: {
                            videoId: 'abc123video',
                            publishedTimeText: { simpleText: 'há 2 horas' },
                            ownerText: {
                              runs: [
                                {
                                  text: 'Canal Exemplo',
                                  navigationEndpoint: {
                                    browseEndpoint: {
                                      browseId: 'UC_CANAL_EXEMPLO_1',
                                      canonicalBaseUrl: '/@canalexemplo'
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      }
                    },
                    {
                      richItemRenderer: {
                        content: {
                          videoRenderer: {
                            videoId: 'live_upcoming_99',
                            upcomingEventData: {
                              startTime: '1763500000'
                            },
                            shortBylineText: {
                              runs: [
                                {
                                  text: 'Canal Live',
                                  navigationEndpoint: {
                                    browseEndpoint: {
                                      browseId: 'UC_CANAL_LIVE_2'
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      }
                    },
                    {
                      richSectionRenderer: {
                        content: {
                          reelShelfRenderer: {
                            items: [
                              {
                                reelItemRenderer: {
                                  videoId: 'short_xyz'
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        ]
      }
    }
  };

  const extracted = extractVideosFromYtData(samplePayload);
  assert.equal(extracted.length, 3);

  const regularVideo = extracted.find((v) => v.videoId === 'abc123video');
  assert.ok(regularVideo);
  assert.equal(regularVideo.channelId, 'UC_CANAL_EXEMPLO_1');
  assert.equal(regularVideo.channelHandle, '/@canalexemplo');
  assert.equal(regularVideo.publishedTimeText, 'há 2 horas');
  assert.equal(regularVideo.isShort, false);
  assert.equal(regularVideo.isUpcoming, false);

  const upcomingVideo = extracted.find((v) => v.videoId === 'live_upcoming_99');
  assert.ok(upcomingVideo);
  assert.equal(upcomingVideo.channelId, 'UC_CANAL_LIVE_2');
  assert.equal(upcomingVideo.isUpcoming, true);
  assert.equal(upcomingVideo.upcomingStartTime, 1763500000 * 1000);

  const shortVideo = extracted.find((v) => v.videoId === 'short_xyz');
  assert.ok(shortVideo);
  assert.equal(shortVideo.isShort, true);
});

test('2.2 generateSapisidHashHeader e performInnerTubeUnsubscribe geram SAPISIDHASH válido e tratam sucesso e erro', async () => {
  const header = await generateSapisidHashHeader(
    'TEST_SAPISID_VALUE',
    'https://www.youtube.com',
    1700000000000
  );
  assert.match(header, /^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);

  let capturedUrl = '';
  let capturedInit = null;

  const mockYtcfg = {
    get(key) {
      if (key === 'INNERTUBE_API_KEY') return 'AIzaSyTestKey';
      if (key === 'INNERTUBE_CONTEXT') return { client: { clientName: 'WEB', clientVersion: '2.2026' } };
      return null;
    }
  };

  const successResult = await performInnerTubeUnsubscribe({
    channelId: 'UC_TEST_999',
    cookieString: 'PREF=f6=400; SAPISID=MY_SECRET_SAPISID; SID=123',
    origin: 'https://www.youtube.com',
    ytcfgObj: mockYtcfg,
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200 };
    }
  });

  assert.equal(successResult.ok, true);
  assert.equal(successResult.channelId, 'UC_TEST_999');
  assert.ok(capturedUrl.includes('/youtubei/v1/subscription/unsubscribe?key=AIzaSyTestKey'));
  assert.match(capturedInit.headers.Authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  assert.deepEqual(JSON.parse(capturedInit.body).channelIds, ['UC_TEST_999']);

  // Caso de falha HTTP 401
  const failResult = await performInnerTubeUnsubscribe({
    channelId: 'UC_TEST_999',
    cookieString: 'SAPISID=MY_SECRET_SAPISID',
    origin: 'https://www.youtube.com',
    ytcfgObj: mockYtcfg,
    fetchImpl: async () => ({ ok: false, status: 401 })
  });
  assert.equal(failResult.ok, false);
  assert.equal(failResult.status, 401);
});

test('3.1 parseRelativeTime converte expressões em PT-BR e EN-US corretamente e detecta lives agendadas', () => {
  const refNow = 1763436000000;
  const minMs = 60 * 1000;
  const hourMs = 60 * minMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;

  // PT-BR
  assert.equal(parseRelativeTime('há 15 minutos', refNow), refNow - 15 * minMs);
  assert.equal(parseRelativeTime('há 2 horas', refNow), refNow - 2 * hourMs);
  assert.equal(parseRelativeTime('Transmitido há 3 dias', refNow), refNow - 3 * dayMs);
  assert.equal(parseRelativeTime('há 1 semana', refNow), refNow - 1 * weekMs);
  assert.equal(parseRelativeTime('agora mesmo', refNow), refNow - 5000);

  // EN-US
  assert.equal(parseRelativeTime('15 minutes ago', refNow), refNow - 15 * minMs);
  assert.equal(parseRelativeTime('2 hours ago', refNow), refNow - 2 * hourMs);
  assert.equal(parseRelativeTime('Streamed 3 days ago', refNow), refNow - 3 * dayMs);
  assert.equal(parseRelativeTime('1 week ago', refNow), refNow - 1 * weekMs);
  assert.equal(parseRelativeTime('just now', refNow), refNow - 5000);

  // Extração de videoId e detecção de lives agendadas
  assert.equal(extractVideoIdFromHref('/watch?v=dQw4w9WgXcQ&t=1s'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoIdFromHref('/shorts/abcDEF12345'), 'abcDEF12345');
  assert.equal(isScheduledLiveText('Programado para 20/11/2026'), true);
  assert.equal(isScheduledLiveText('Scheduled for tomorrow'), true);
  assert.equal(isScheduledLiveText('há 2 horas'), false);
});

test('3.2 evaluateCardVisibility aplica filtros de installTimestamp, Modo ZeroSub, dismissedVideos, Shorts e lives agendadas', () => {
  const baseline = 1763436000000;
  const baseState = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(['vid_dismissed']),
    unsubscribedChannels: new Set(['UC_BLOCKED'])
  };

  // Vídeo antigo (antes do installTimestamp) -> oculto
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_old',
        publishedTimestamp: baseline - 60000,
        isShort: false,
        isUpcoming: false
      },
      baseState
    ),
    { hidden: true, reason: 'before-baseline' }
  );

  // Vídeo novo (após installTimestamp) -> visível
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_new',
        publishedTimestamp: baseline + 60000,
        isShort: false,
        isUpcoming: false
      },
      baseState
    ),
    { hidden: false, reason: null }
  );

  // Vídeo marcado como visto -> oculto
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_dismissed',
        publishedTimestamp: baseline + 60000,
        isShort: false,
        isUpcoming: false
      },
      baseState
    ),
    { hidden: true, reason: 'dismissed' }
  );

  // Short com hideShorts=true -> oculto
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_short',
        publishedTimestamp: baseline + 60000,
        isShort: true,
        isUpcoming: false
      },
      baseState
    ),
    { hidden: true, reason: 'short' }
  );

  // Live agendada com hideScheduledLives=true -> oculto
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_upcoming',
        publishedTimestamp: null,
        isShort: false,
        isUpcoming: true,
        isLiveNow: false
      },
      baseState
    ),
    { hidden: true, reason: 'scheduled-live' }
  );

  // Modo Mostrar Todos (zeroSubEnabled = false) -> reexibe vídeos antigos e dispensados
  assert.deepEqual(
    evaluateCardVisibility(
      {
        videoId: 'vid_old',
        publishedTimestamp: baseline - 999999,
        isShort: true,
        isUpcoming: true
      },
      { ...baseState, zeroSubEnabled: false }
    ),
    { hidden: false, reason: null }
  );
});

test('3.3 shouldAutoMarkWatched e appendDismissedVideo marcam vídeo ao atingir >=90% da duração', () => {
  assert.equal(shouldAutoMarkWatched(89, 100), false);
  assert.equal(shouldAutoMarkWatched(90, 100), true);
  assert.equal(shouldAutoMarkWatched(95, 100), true);
  assert.equal(shouldAutoMarkWatched(10, 0), false);

  const list1 = appendDismissedVideo(['v1', 'v2'], 'v3');
  assert.deepEqual(list1, ['v1', 'v2', 'v3']);

  // Não duplica IDs já existentes
  const list2 = appendDismissedVideo(list1, 'v1');
  assert.deepEqual(list2, ['v2', 'v3', 'v1']);
});

test('4.1 e 4.2 createTwoStepConfirmation exige dois cliques e reseta após timeout, e styles.css contém seletores exigidos', async () => {
  let stateText = 'Desinscrever';
  let confirmedCount = 0;

  const controller = createTwoStepConfirmation({
    timeoutMs: 50,
    onEnterConfirm() {
      stateText = 'Confirmar?';
    },
    onReset() {
      stateText = 'Desinscrever';
    },
    onConfirmed() {
      confirmedCount++;
    }
  });

  // 1º clique -> entra em "Confirmar?" sem confirmar ainda
  assert.equal(controller.trigger(), 'confirming');
  assert.equal(stateText, 'Confirmar?');
  assert.equal(confirmedCount, 0);

  // Espera expirar o timeout de 50ms -> volta para "Desinscrever"
  await new Promise((r) => setTimeout(r, 75));
  assert.equal(stateText, 'Desinscrever');
  assert.equal(controller.isConfirming(), false);

  // Dois cliques consecutivos dentro da janela -> confirma desinscrição
  assert.equal(controller.trigger(), 'confirming');
  assert.equal(controller.trigger(), 'confirmed');
  assert.equal(confirmedCount, 1);

  // Verifica que content/styles.css existe e suporta html[dark], .zerosub-hidden e .zerosub-card-actions
  const cssContent = fs.readFileSync(path.join(__dirname, '..', 'content', 'styles.css'), 'utf8');
  assert.ok(cssContent.includes('html[dark]'));
  assert.ok(cssContent.includes('.zerosub-hidden'));
  assert.ok(cssContent.includes('.zerosub-card-actions'));
  assert.ok(cssContent.includes('.zerosub-card-dismissing'));
});

test('5.1 popup/popup.html, popup.css e popup.js possuem os controles exigidos e atualizam chrome.storage.local', async () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
  assert.ok(popupHtml.includes('id="pending-count"'));
  assert.ok(popupHtml.includes('id="btn-reset-now"'));
  assert.ok(popupHtml.includes('id="btn-restore-hidden"'));
  assert.ok(popupHtml.includes('id="toggle-zerosub-enabled"'));
  assert.ok(popupHtml.includes('id="toggle-hide-shorts"'));
  assert.ok(popupHtml.includes('id="toggle-hide-lives"'));
  assert.ok(popupHtml.includes('id="toggle-auto-watched"'));

  let store = {
    installTimestamp: 1000,
    pendingCount: 15,
    zeroSubEnabled: false,
    dismissedVideos: ['v1', 'v2']
  };

  const mockStorage = {
    async set(obj) {
      store = { ...store, ...obj };
    }
  };

  const newNow = 1763439999000;
  await resetZeroSubQueue(mockStorage, newNow);
  assert.equal(store.installTimestamp, newNow);
  assert.equal(store.pendingCount, 0);
  assert.equal(store.zeroSubEnabled, true);

  await restoreDismissedVideos(mockStorage);
  assert.deepEqual(store.dismissedVideos, []);
  assert.ok(formatBaselineTimestamp(newNow).length >= 5);
});

test('6.1 background.js inicializa baselineAnchorIds e notInterestedByChannel sem sobrescrever existentes', () => {
  const patch = buildInitialStatePatch({}, 1763590000000);
  assert.deepEqual(patch.baselineAnchorIds, []);
  assert.deepEqual(patch.notInterestedByChannel, {});

  const existing = {
    installTimestamp: 1000,
    baselineAnchorIds: ['anchor_1'],
    notInterestedByChannel: { UC1: { videoIds: ['v1'] } }
  };
  const updatePatch = buildInitialStatePatch(existing, 2000);
  assert.equal(updatePatch.baselineAnchorIds, undefined);
  assert.equal(updatePatch.notInterestedByChannel, undefined);
});

test('6.2 evaluateFeedItems aplica corte cronológico por baselineAnchorIds e oculta continuation para impedir vídeos antigos', () => {
  const baseline = 1763590000000;
  const state = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(),
    unsubscribedChannels: new Set(),
    baselineAnchorIds: new Set(['vid_anchor'])
  };

  const feed = [
    { videoId: 'vid_new_1', publishedTimestamp: baseline + 120000, isShort: false, isUpcoming: false },
    { videoId: 'vid_anchor', publishedTimestamp: baseline + 10000, isShort: false, isUpcoming: false },
    // Card abaixo do corte mesmo sem publishedTimestamp deve ser ocultado!
    { videoId: 'vid_old_no_ts', publishedTimestamp: null, isShort: false, isUpcoming: false }
  ];

  const result = evaluateFeedItems(feed, state);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.cutoffReached, true);
  assert.equal(result.shouldHideContinuation, true);
  assert.deepEqual(result.decisions[0], { hidden: false, reason: null });
  assert.deepEqual(result.decisions[1], { hidden: true, reason: 'baseline-anchor' });
  assert.deepEqual(result.decisions[2], { hidden: true, reason: 'after-cutoff' });

  // No modo Mostrar todos, desativa corte e reexibe continuation
  const showAll = evaluateFeedItems(feed, { ...state, zeroSubEnabled: false });
  assert.equal(showAll.visibleCount, 3);
  assert.equal(showAll.shouldHideContinuation, false);
});

test('6.3 recordNotInterestedVideo deduplica videoIds e sugere desinscrição ao atingir 3 vídeos diferentes do mesmo canal', () => {
  assert.equal(NOT_INTERESTED_THRESHOLD, 3);
  let map = {};

  const r1 = recordNotInterestedVideo(map, {
    channelKey: 'UC_CH1',
    channelId: 'UC_CH1',
    channelHandle: '/@ch1',
    channelName: 'Canal 1',
    videoId: 'v1'
  }, 100);
  map = r1.updatedMap;
  assert.equal(r1.count, 1);
  assert.equal(r1.reachedThreshold, false);

  // Mesmo vídeo repetido não deve incrementar contagem
  const r1Dup = recordNotInterestedVideo(map, {
    channelKey: 'UC_CH1',
    channelId: 'UC_CH1',
    channelName: 'Canal 1',
    videoId: 'v1'
  }, 150);
  map = r1Dup.updatedMap;
  assert.equal(r1Dup.count, 1);
  assert.equal(r1Dup.reachedThreshold, false);

  const r2 = recordNotInterestedVideo(map, {
    channelKey: 'UC_CH1',
    channelId: 'UC_CH1',
    channelName: 'Canal 1',
    videoId: 'v2'
  }, 200);
  map = r2.updatedMap;
  assert.equal(r2.count, 2);
  assert.equal(r2.reachedThreshold, false);
  assert.equal(getUnsubscribeSuggestions(map, []).length, 0);

  // Terceiro vídeo distinto atinge threshold de 3
  const r3 = recordNotInterestedVideo(map, {
    channelKey: 'UC_CH1',
    channelId: 'UC_CH1',
    channelName: 'Canal 1',
    videoId: 'v3'
  }, 300);
  map = r3.updatedMap;
  assert.equal(r3.count, 3);
  assert.equal(r3.reachedThreshold, true);

  const suggestions = getUnsubscribeSuggestions(map, []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].channelName, 'Canal 1');

  // Se o canal já foi desinscrito, não aparece mais nas sugestões
  assert.equal(getUnsubscribeSuggestions(map, ['UC_CH1']).length, 0);

  // Ao clicar em "Manter canal", remove o canal do mapa
  const cleaned = removeChannelFromNotInterested(map, { channelKey: 'UC_CH1' });
  assert.equal(getUnsubscribeSuggestions(cleaned, []).length, 0);
});

test('6.4 styles.css e popup suportam novo rodapé de 3 botões em linha única, Inbox Zero e seção de sugestões sincronizada', async () => {
  const cssContent = fs.readFileSync(path.join(__dirname, '..', 'content', 'styles.css'), 'utf8');
  assert.ok(cssContent.includes('.zerosub-card-managed'));
  assert.ok(cssContent.includes('.zerosub-btn-not-interested'));
  assert.ok(cssContent.includes('.zerosub-empty-state'));
  assert.ok(cssContent.includes('.zerosub-suggestions-panel'));

  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
  assert.ok(popupHtml.includes('id="suggestions-section"'));
  assert.ok(popupHtml.includes('id="suggestions-list"'));

  let store = {
    notInterestedByChannel: {
      UC_X: {
        channelKey: 'UC_X',
        channelId: 'UC_X',
        channelName: 'Canal X',
        videoIds: ['a', 'b', 'c'],
        updatedAt: 500
      }
    }
  };

  const mockStorage = {
    async get(keys) {
      const res = {};
      for (const k of keys) res[k] = store[k];
      return res;
    },
    async set(obj) {
      store = { ...store, ...obj };
    }
  };

  const suggestions = getPopupSuggestions(store.notInterestedByChannel, []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].channelKey, 'UC_X');

  await keepChannelInStorage(mockStorage, { channelKey: 'UC_X' });
  assert.equal(getPopupSuggestions(store.notInterestedByChannel, []).length, 0);
});

test('6.5 evaluateFeedItems não dispara corte prematuro em lives/Shorts no topo e shouldShowEmptyState aguarda hidratação do grid', () => {
  const baseline = 1763590000000;
  const state = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(['live_now_pinned']),
    unsubscribedChannels: new Set(),
    baselineAnchorIds: new Set(['live_now_pinned', 'vid_anchor_regular'])
  };

  const feed = [
    // Live em andamento fixada no topo pelo YouTube (já estava em baselineAnchorIds)
    { videoId: 'live_now_pinned', publishedTimestamp: baseline - 3600000, isShort: false, isUpcoming: false, isLiveNow: true },
    // Short antigo no topo também não deve disparar cutoff
    { videoId: 'short_old', publishedTimestamp: baseline - 120000, isShort: true, isUpcoming: false, isLiveNow: false },
    // Vídeo novo publicado após o marco zero DEVE ficar visível!
    { videoId: 'vid_new_after_live', publishedTimestamp: baseline + 300000, isShort: false, isUpcoming: false, isLiveNow: false },
    // Primeiro vídeo regular âncora dispara o cutoff
    { videoId: 'vid_anchor_regular', publishedTimestamp: baseline - 60000, isShort: false, isUpcoming: false, isLiveNow: false },
    // Tudo abaixo do âncora regular é ocultado
    { videoId: 'vid_below_anchor', publishedTimestamp: null, isShort: false, isUpcoming: false, isLiveNow: false }
  ];

  const result = evaluateFeedItems(feed, state);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.cutoffReached, true);
  assert.deepEqual(result.decisions[0], { hidden: true, reason: 'baseline-anchor' });
  assert.deepEqual(result.decisions[1], { hidden: true, reason: 'short' });
  assert.deepEqual(result.decisions[2], { hidden: false, reason: null });
  assert.deepEqual(result.decisions[3], { hidden: true, reason: 'baseline-anchor' });
  assert.deepEqual(result.decisions[4], { hidden: true, reason: 'after-cutoff' });

  // Estado vazio só aparece quando o grid já renderizou cards (totalCards > 0)
  assert.equal(shouldShowEmptyState(true, 0, 0), false);
  assert.equal(shouldShowEmptyState(true, 0, 5), true);
  assert.equal(shouldShowEmptyState(true, 1, 5), false);
  assert.equal(shouldShowEmptyState(false, 0, 5), false);

  // isZeroSubOwnedNode identifica nós internos da UI da extensão (evitando loop no MutationObserver)
  const ownedNode = {
    nodeType: 1,
    closest: (selector) => (selector.includes('#zerosub-suggestions-panel') ? {} : null)
  };
  const externalNode = {
    nodeType: 1,
    closest: () => null
  };
  assert.equal(isZeroSubOwnedNode(ownedNode), true);
  assert.equal(isZeroSubOwnedNode(externalNode), false);
});

test('6.6 evaluateFeedItems exibe vídeo explicitamente novo mesmo abaixo de seção antiga ("Mais relevantes") e injector detecta live/agora mesmo em lockupViewModel', () => {
  const baseline = 1763590000000;
  const state = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(),
    unsubscribedChannels: new Set(),
    baselineAnchorIds: new Set(['vid_anchor'])
  };

  const feed = [
    // Card antigo na seção "Mais relevantes" no topo do feed
    { videoId: 'vid_relevant_old', publishedTimestamp: baseline - 86400000, isShort: false, isUpcoming: false, isLiveNow: false },
    // Vídeo novo na seção "Mais recentes" abaixo de "Mais relevantes" DEVE aparecer!
    { videoId: 'vid_new_latest', publishedTimestamp: baseline + 600000, isShort: false, isUpcoming: false, isLiveNow: false },
    // Vídeo âncora do último reset continua oculto
    { videoId: 'vid_anchor', publishedTimestamp: baseline + 1000, isShort: false, isUpcoming: false, isLiveNow: false },
    // Vídeo antigo sem timestamp abaixo do corte continua oculto
    { videoId: 'vid_old_unknown', publishedTimestamp: null, isShort: false, isUpcoming: false, isLiveNow: false }
  ];

  const result = evaluateFeedItems(feed, state);
  assert.equal(result.visibleCount, 1);
  assert.deepEqual(result.decisions[0], { hidden: true, reason: 'before-baseline' });
  assert.deepEqual(result.decisions[1], { hidden: false, reason: null });
  assert.deepEqual(result.decisions[2], { hidden: true, reason: 'baseline-anchor' });
  assert.deepEqual(result.decisions[3], { hidden: true, reason: 'after-cutoff' });

  // Verifica extração de lockupViewModel para live e "agora mesmo"
  const lockupPayload = {
    items: [
      {
        lockupViewModel: {
          contentId: 'vid_lockup_new',
          metadata: {
            lockupMetadataViewModel: {
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [
                    { metadataParts: [{ text: { content: 'agora mesmo' } }] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        lockupViewModel: {
          contentId: 'vid_lockup_live',
          contentImage: {
            thumbnailViewModel: {
              overlays: [
                {
                  thumbnailBottomOverlayViewModel: {
                    badges: [
                      {
                        thumbnailBadgeViewModel: {
                          badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE',
                          text: 'AO VIVO'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    ]
  };

  const extracted = extractVideosFromYtData(lockupPayload);
  const newItem = extracted.find((v) => v.videoId === 'vid_lockup_new');
  const liveItem = extracted.find((v) => v.videoId === 'vid_lockup_live');
  assert.equal(newItem.publishedTimeText, 'agora mesmo');
  assert.equal(liveItem.isLive, true);
});

test('7.1 background.js inicializa watchLaterVideos sem sobrescrever existentes e exibe badge azul quando fila principal está zerada', () => {
  const patch = buildInitialStatePatch({}, 1763600000000);
  assert.deepEqual(patch.watchLaterVideos, []);

  const updatePatch = buildInitialStatePatch(
    {
      installTimestamp: 1000,
      watchLaterVideos: [{ videoId: 'wl_1', title: 'Salvo' }]
    },
    2000
  );
  assert.equal(updatePatch.watchLaterVideos, undefined);

  // Testa prioridade do badge em chrome.action
  const badgeCalls = [];
  const prevChrome = global.chrome;
  global.chrome = {
    action: {
      setBadgeText(arg) {
        badgeCalls.push({ type: 'text', value: arg.text });
      },
      setBadgeBackgroundColor(arg) {
        badgeCalls.push({ type: 'color', value: arg.color });
      }
    }
  };

  try {
    // 1. Modo desligado -> OFF cinza
    badgeCalls.length = 0;
    updateActionBadge(5, false, 3);
    assert.deepEqual(badgeCalls, [
      { type: 'text', value: 'OFF' },
      { type: 'color', value: '#717171' }
    ]);

    // 2. Fila principal > 0 tem prioridade em vermelho
    badgeCalls.length = 0;
    updateActionBadge(4, true, 7);
    assert.deepEqual(badgeCalls, [
      { type: 'text', value: '4' },
      { type: 'color', value: '#cc0000' }
    ]);

    // 3. Fila principal === 0 e Ver depois > 0 -> azul de lembrete
    badgeCalls.length = 0;
    updateActionBadge(0, true, 7);
    assert.deepEqual(badgeCalls, [
      { type: 'text', value: '7' },
      { type: 'color', value: '#1a73e8' }
    ]);

    // 4. Cap 99+ para Ver depois
    badgeCalls.length = 0;
    updateActionBadge(0, true, 120);
    assert.deepEqual(badgeCalls, [
      { type: 'text', value: '99+' },
      { type: 'color', value: '#1a73e8' }
    ]);

    // 5. Tudo zerado -> badge vazio
    badgeCalls.length = 0;
    updateActionBadge(0, true, 0);
    assert.deepEqual(badgeCalls, [{ type: 'text', value: '' }]);
  } finally {
    global.chrome = prevChrome;
  }
});

test('7.2 injector.js extrai title e durationText tanto de videoRenderer clássico quanto de lockupViewModel', () => {
  const payload = {
    items: [
      {
        videoRenderer: {
          videoId: 'classic_vid_1',
          title: { runs: [{ text: 'Como usar OpenSpec' }] },
          lengthText: { simpleText: '14:22' },
          publishedTimeText: { simpleText: 'há 1 hora' }
        }
      },
      {
        lockupViewModel: {
          contentId: 'lockup_vid_2',
          metadata: {
            lockupMetadataViewModel: {
              title: { content: 'Guia Completo de Chrome MV3' }
            }
          },
          contentImage: {
            thumbnailViewModel: {
              overlays: [
                {
                  thumbnailBottomOverlayViewModel: {
                    badges: [
                      {
                        thumbnailBadgeViewModel: {
                          badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT',
                          text: '1:05:10'
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    ]
  };

  const extracted = extractVideosFromYtData(payload);
  const v1 = extracted.find((v) => v.videoId === 'classic_vid_1');
  const v2 = extracted.find((v) => v.videoId === 'lockup_vid_2');

  assert.equal(v1.title, 'Como usar OpenSpec');
  assert.equal(v1.durationText, '14:22');
  assert.equal(v2.title, 'Guia Completo de Chrome MV3');
  assert.equal(v2.durationText, '1:05:10');
});

test('7.3 helpers de watchLaterVideos, evaluateCardVisibility e isZeroSubOwnedNode operam de forma isolada de dismissedVideos', () => {
  let list = [];
  list = upsertWatchLaterVideo(
    list,
    {
      videoId: 'wl_a',
      title: 'Vídeo A',
      durationText: '10:00',
      channelId: 'UC_A',
      channelHandle: '/@canala',
      channelKey: 'UC_A',
      channelName: 'Canal A'
    },
    1000
  );
  list = upsertWatchLaterVideo(
    list,
    {
      videoId: 'wl_b',
      title: 'Vídeo B',
      channelId: 'UC_B',
      channelKey: 'UC_B',
      channelName: 'Canal B'
    },
    2000
  );

  // Mais recente fica no topo e gera thumbnail determinística
  assert.equal(list.length, 2);
  assert.equal(list[0].videoId, 'wl_b');
  assert.equal(list[0].thumbnailUrl, buildVideoThumbnailUrl('wl_b'));

  // Re-inserir wl_a deduplica e move para o topo preservando metadados ausentes
  list = upsertWatchLaterVideo(list, { videoId: 'wl_a' }, 3000);
  assert.equal(list.length, 2);
  assert.equal(list[0].videoId, 'wl_a');
  assert.equal(list[0].title, 'Vídeo A');
  assert.equal(list[0].durationText, '10:00');

  const idSet = getWatchLaterIdSet(list);
  assert.equal(idSet.has('wl_a'), true);
  assert.equal(idSet.has('wl_b'), true);

  // evaluateCardVisibility oculta vídeo em Ver depois no Modo ZeroSub com reason 'watch-later'
  const baseline = 1763600000000;
  const state = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(),
    watchLaterVideos: list,
    unsubscribedChannels: new Set()
  };

  assert.deepEqual(
    evaluateCardVisibility(
      { videoId: 'wl_a', publishedTimestamp: baseline + 5000, isShort: false, isUpcoming: false },
      state
    ),
    { hidden: true, reason: 'watch-later' }
  );

  // No modo Mostrar todos, volta a exibir no feed
  assert.deepEqual(
    evaluateCardVisibility(
      { videoId: 'wl_a', publishedTimestamp: baseline + 5000, isShort: false, isUpcoming: false },
      { ...state, zeroSubEnabled: false }
    ),
    { hidden: false, reason: null }
  );

  // Remoção por videoId e por canal
  const withoutB = removeWatchLaterVideo(list, 'wl_b');
  assert.deepEqual(withoutB.map((v) => v.videoId), ['wl_a']);

  const withoutChannelA = removeChannelFromWatchLater(list, { channelId: 'UC_A' });
  assert.deepEqual(withoutChannelA.map((v) => v.videoId), ['wl_b']);

  // Painel Ver depois reconhecido como nó interno do ZeroSub (não dispara MutationObserver)
  const wlPanelNode = {
    nodeType: 1,
    closest: (selector) => (selector.includes('#zerosub-watch-later-panel') ? {} : null)
  };
  assert.equal(isZeroSubOwnedNode(wlPanelNode), true);
});

test('7.4 styles.css (grade 2x2 e painel Ver depois) e popup (contadores e ações de Ver depois) funcionam de ponta a ponta', async () => {
  const cssContent = fs.readFileSync(path.join(__dirname, '..', 'content', 'styles.css'), 'utf8');
  assert.ok(cssContent.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(cssContent.includes('.zerosub-btn-watch-later'));
  assert.ok(cssContent.includes('.zerosub-watch-later-panel'));
  assert.ok(cssContent.includes('--zerosub-watch-later-bg'));

  const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.html'), 'utf8');
  assert.ok(popupHtml.includes('id="watch-later-count"'));
  assert.ok(popupHtml.includes('id="watch-later-section"'));
  assert.ok(popupHtml.includes('id="watch-later-badge"'));
  assert.ok(popupHtml.includes('id="watch-later-list"'));

  let store = {
    watchLaterVideos: [
      { videoId: 'v1', title: 'Vídeo 1', channelKey: 'UC_1', channelId: 'UC_1', channelName: 'Canal 1' },
      { videoId: 'v2', title: 'Vídeo 2', channelKey: 'UC_1', channelId: 'UC_1', channelName: 'Canal 1' },
      { videoId: 'v3', title: 'Vídeo 3', channelKey: 'UC_2', channelId: 'UC_2', channelName: 'Canal 2' }
    ],
    dismissedVideos: [],
    notInterestedByChannel: {
      UC_1: {
        channelKey: 'UC_1',
        channelId: 'UC_1',
        channelName: 'Canal 1',
        videoIds: ['old_1', 'old_2'],
        updatedAt: 100
      }
    }
  };

  const mockStorage = {
    async get(keys) {
      const res = {};
      for (const k of keys) res[k] = store[k];
      return res;
    },
    async set(obj) {
      store = { ...store, ...obj };
    }
  };

  // Restaurar vídeos ocultos e zerar fila preservam watchLaterVideos
  await restoreDismissedVideos(mockStorage);
  await resetZeroSubQueue(mockStorage, 9999);
  assert.equal(store.watchLaterVideos.length, 3);

  // 1. Marcar v3 como Visto pelo popup
  await markWatchLaterAsSeenInStorage(mockStorage, 'v3');
  assert.deepEqual(store.watchLaterVideos.map((v) => v.videoId), ['v1', 'v2']);
  assert.ok(store.dismissedVideos.includes('v3'));

  // 2. Marcar v1 como Sem interesse pelo popup -> 3º vídeo de UC_1 atinge threshold de sugestão!
  const notIntRes = await markWatchLaterNotInterestedInStorage(
    mockStorage,
    store.watchLaterVideos[0],
    500
  );
  assert.equal(notIntRes.reachedThreshold, true);
  assert.equal(notIntRes.count, 3);
  assert.deepEqual(store.watchLaterVideos.map((v) => v.videoId), ['v2']);
  assert.ok(store.dismissedVideos.includes('v1'));
  assert.equal(getPopupSuggestions(store.notInterestedByChannel, []).length, 1);

  // 3. Remover canal UC_1 de watchLaterVideos ao desinscrever
  await removeChannelFromWatchLaterInStorage(mockStorage, { channelId: 'UC_1' });
  assert.equal(store.watchLaterVideos.length, 0);

  // 4. Confirmação em 2 cliques no popup
  let confirmed = 0;
  const ctrl = createPopupTwoStepConfirmation({
    timeoutMs: 50,
    onConfirmed() {
      confirmed++;
    }
  });
  assert.equal(ctrl.trigger(), 'confirming');
  assert.equal(confirmed, 0);
  assert.equal(ctrl.trigger(), 'confirmed');
  assert.equal(confirmed, 1);
});

test('7.5 resolveClearedTimestamp registra o horário real em que a fila zera via triagem sem sobrescrever em reloads', () => {
  const baseline = 1763595120000; // 20:32
  const clearedNow = 1763599140000; // 21:39
  const reloadLater = 1763599500000; // 21:45

  // 1. Fila tinha 1 vídeo e o usuário limpou agora (1 -> 0): registra 21:39
  const t1 = resolveClearedTimestamp({
    zeroSubEnabled: true,
    prevPendingCount: 1,
    nextPendingCount: 0,
    totalCards: 10,
    currentLastClearedAt: null,
    installTimestamp: baseline,
    now: clearedNow
  });
  assert.equal(t1, clearedNow);

  // 2. Recarrega a página às 21:45 com a fila ainda zerada (0 -> 0): mantém 21:39
  const t2 = resolveClearedTimestamp({
    zeroSubEnabled: true,
    prevPendingCount: 0,
    nextPendingCount: 0,
    totalCards: 10,
    currentLastClearedAt: t1,
    installTimestamp: baseline,
    now: reloadLater
  });
  assert.equal(t2, clearedNow);

  // 3. Enquanto o grid ainda não hidratou (totalCards === 0): preserva valor atual
  const t3 = resolveClearedTimestamp({
    zeroSubEnabled: true,
    prevPendingCount: 2,
    nextPendingCount: 0,
    totalCards: 0,
    currentLastClearedAt: baseline,
    installTimestamp: baseline,
    now: reloadLater
  });
  assert.equal(t3, baseline);

  // 4. Se chegou vídeo novo (0 -> 1) e depois usuário limpou novamente às 21:45 (1 -> 0): atualiza para 21:45
  const t4 = resolveClearedTimestamp({
    zeroSubEnabled: true,
    prevPendingCount: 1,
    nextPendingCount: 0,
    totalCards: 10,
    currentLastClearedAt: clearedNow,
    installTimestamp: baseline,
    now: reloadLater
  });
  assert.equal(t4, reloadLater);

  // 5. getDisplayClearedTimestamp recupera o horário real do último item salvo em Ver depois
  //    mesmo quando lastClearedAt ainda estava nulo ou igual ao Marco Zero antigo
  assert.equal(
    getDisplayClearedTimestamp({
      installTimestamp: baseline,
      lastClearedAt: baseline,
      watchLaterVideos: [{ videoId: 'wl_1', savedAt: clearedNow }],
      notInterestedByChannel: {}
    }),
    clearedNow
  );
});

test('7.6 cards fantasmas (sem videoId, ocultos nativamente pelo YouTube ou aninhados) não inflam pendingCount nem bloqueiam Inbox Zero', () => {
  const baseline = 1763600000000;
  const state = {
    installTimestamp: baseline,
    zeroSubEnabled: true,
    hideShorts: true,
    hideScheduledLives: true,
    dismissedVideos: new Set(),
    watchLaterVideos: [],
    unsubscribedChannels: new Set()
  };

  // Card sem videoId (ex: post/skeleton/slot vazio) deve ser ocultado/ignorado no Modo ZeroSub
  assert.deepEqual(
    evaluateCardVisibility(
      { videoId: '', publishedTimestamp: null, isShort: false, isUpcoming: false },
      state
    ),
    { hidden: true, reason: 'no-video-id' }
  );

  const browseRoot = { tagName: 'YTD-BROWSE' };
  const grid = { tagName: 'YTD-RICH-GRID-RENDERER', parentElement: browseRoot };

  const makeEl = (overrides = {}) => ({
    nodeType: 1,
    tagName: 'YTD-RICH-ITEM-RENDERER',
    hidden: false,
    style: {},
    classList: { contains: () => false },
    hasAttribute: () => false,
    closest: () => null,
    querySelector: (sel) => (sel.includes('/watch?v=') ? {} : null),
    parentElement: grid,
    ...overrides
  });

  // 1. Card normal visível com link de vídeo -> elegível
  const validCard = makeEl();
  assert.equal(isCardEligibleForFeed(validCard, browseRoot), true);

  // 2. Card oculto nativamente pelo YouTube ([hidden]) -> NÃO elegível
  const hiddenCard = makeEl({
    hidden: true,
    hasAttribute: (attr) => attr === 'hidden'
  });
  assert.equal(isElementNativelyHidden(hiddenCard, browseRoot), true);
  assert.equal(isCardEligibleForFeed(hiddenCard, browseRoot), false);

  // 3. Card dentro de ancestral oculto pelo YouTube (ex: shelf colapsada) -> NÃO elegível
  const hiddenParent = makeEl({
    tagName: 'DIV',
    hasAttribute: (attr) => attr === 'hidden',
    parentElement: grid
  });
  const cardInHiddenParent = makeEl({ parentElement: hiddenParent });
  assert.equal(isCardEligibleForFeed(cardInHiddenParent, browseRoot), false);

  // 4. Card vazio / community post sem link de vídeo -> NÃO elegível
  const ghostCard = makeEl({ querySelector: () => null });
  assert.equal(isCardEligibleForFeed(ghostCard, browseRoot), false);

  // 5. Card aninhado dentro de outro card -> NÃO elegível
  const nestedParent = { closest: () => ({}) };
  const nestedCard = makeEl({ parentElement: nestedParent });
  assert.equal(isCardEligibleForFeed(nestedCard, browseRoot), false);

  // 6. Card dentro de prateleira de Shorts -> NÃO elegível
  const shortsShelfCard = makeEl({
    closest: (sel) => (sel.includes('ytd-rich-shelf-renderer[is-shorts]') ? {} : null)
  });
  assert.equal(isCardEligibleForFeed(shortsShelfCard, browseRoot), false);
});




