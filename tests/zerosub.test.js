const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_STATE,
  buildInitialStatePatch,
  ensureInitialState
} = require('../background.js');

const {
  extractVideosFromYtData,
  generateSapisidHashHeader,
  performInnerTubeUnsubscribe
} = require('../content/injector.js');

const {
  parseRelativeTime,
  extractVideoIdFromHref,
  isScheduledLiveText,
  evaluateCardVisibility,
  shouldAutoMarkWatched,
  appendDismissedVideo,
  createTwoStepConfirmation
} = require('../content/content.js');

const {
  resetZeroSubQueue,
  restoreDismissedVideos,
  formatBaselineTimestamp
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



