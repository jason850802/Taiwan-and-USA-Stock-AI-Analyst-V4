// 03 父頁原生按鈕控制；只呼叫子頁觀測函式，不輸入文字、不點按正式App。
const assert = (value, message) => { if (!value) throw new Error(message); };
const configElement = document.getElementById('p1-viewport-control-binding');
assert(configElement, '缺父頁控制身分');
const config = JSON.parse(configElement.textContent);
assert(config.schema === 'p1-viewport-control-v1' && config.group === '03', '父頁控制身分無效');
assert(new URL(import.meta.url).pathname === config.controlsPath, '父頁控制模組版本不符');

const iframe = document.getElementById('app');
const status = document.getElementById('p1-control-status');
const p08Output = document.getElementById('p1-p08-observation');
const p05Output = document.getElementById('p1-p05-observation');
const initialPageTimeOrigin = performance.timeOrigin;
let manual;
let originalRaw;
let originalRawSha256;
let duplicateObservation;
let initialChildTimeOrigin;

const show = (element, value) => { element.textContent = JSON.stringify(value, null, 2); };
const showStatus = value => show(status, { at: new Date().toISOString(), ...value });
const child = () => {
  assert(iframe.contentWindow && iframe.contentDocument?.readyState === 'complete', '正式App子頁尚未載入完成');
  return iframe.contentWindow;
};
const initialBinding = () => {
  const element = child().document.getElementById('p1-replay-binding');
  assert(element, '子頁缺初載執行身分');
  const binding = JSON.parse(element.textContent);
  assert(binding.runId === config.runId && binding.group === '03', '父子頁初載身分不一致');
  const manualHash = binding.toolHashes?.['.scratch/reacceptance-fixes/manual-market.mjs'];
  const controlsHash = binding.toolHashes?.['.scratch/reacceptance-fixes/viewport-controls.mjs'];
  assert(config.manualPath === `/__integration/${binding.runId}/${manualHash}/manual-market.mjs`
    && config.controlsPath === `/__integration/${binding.runId}/${controlsHash}/viewport-controls.mjs`, '控制工具URL／hash不符');
  return binding;
};
const rawPayload = () => {
  assert(originalRaw?.passed === true, '尚未取得本run實收成功raw');
  const { integration, integrationBrowser, replayCase, ...result } = originalRaw;
  assert(integration && integrationBrowser && replayCase, '實收raw缺完整身分');
  return { name: config.payloadName, result };
};
async function responseValue(response) {
  return { status: response.status, body: await response.text() };
}
async function loadManual() {
  if (manual) return manual;
  const view = child();
  if (!view.p1ManualMarket) {
    await new Promise((resolve, reject) => {
      const script = view.document.createElement('script');
      script.type = 'module';
      script.src = config.manualPath;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('手動觀測模組載入失敗')), { once: true });
      view.document.head.append(script);
    });
  }
  assert(view.p1ManualMarket, '手動觀測模組沒有公開控制介面');
  manual = view.p1ManualMarket;
  return manual;
}
async function captureAcceptedRaw() {
  const response = await fetch(config.rawPath, { cache: 'no-store' });
  if (!response.ok) throw new Error(`讀取本run實收raw失敗：${response.status} ${await response.text()}`);
  const hash = response.headers.get('X-Replay-Raw-Sha256');
  const raw = await response.json();
  assert(/^[a-f0-9]{64}$/.test(hash || ''), '實收raw缺SHA-256');
  assert(raw.passed === true && raw.integration?.runId === config.runId
    && raw.replayCase?.file === config.rawFile, '實收raw不是本頁成功case');
  originalRaw = raw;
  originalRawSha256 = hash;
  return { file: config.rawFile, sha256: hash, passed: raw.passed, runId: raw.integration.runId };
}
async function retryAcceptedCase() {
  assert(performance.timeOrigin === initialPageTimeOrigin, '頁面已被重載，不能作同頁重送觀測');
  assert(initialChildTimeOrigin && child().performance.timeOrigin === initialChildTimeOrigin, '正式App子頁已被重載');
  const response = await child().fetch('/__fixture/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rawPayload()),
  });
  const result = await responseValue(response);
  assert(result.status === 409 && /重複送出/.test(result.body), 'P08同case重送沒有收到預期409');
  duplicateObservation = {
    schema: 'p1-native-browser-duplicate-observation-v1',
    manifest: config.manifest,
    originalRunId: config.runId,
    originalFile: config.rawFile,
    originalRawSha256,
    originalPassed: originalRaw.passed,
    pageTimeOrigin: performance.timeOrigin,
    childPageTimeOrigin: child().performance.timeOrigin,
    ...result,
  };
  show(p08Output, duplicateObservation);
  return duplicateObservation;
}
async function observeRestart() {
  assert(duplicateObservation?.status === 409, '先在原server按P08同case重送並取得409');
  assert(performance.timeOrigin === initialPageTimeOrigin, '父頁已被重載，不能作P05同頁觀測');
  assert(initialChildTimeOrigin && child().performance.timeOrigin === initialChildTimeOrigin
    && duplicateObservation.childPageTimeOrigin === initialChildTimeOrigin, '正式App子頁不是原P08頁面');
  const binding = initialBinding();
  const metaResponse = await fetch('/__integration/meta', { cache: 'no-store' });
  assert(metaResponse.ok, `晚取meta失敗：${metaResponse.status}`);
  const lateMetadata = await metaResponse.json();
  assert(lateMetadata.runId !== config.runId, 'server尚未以同manifest重啟為新run');
  assert(lateMetadata.group === binding.group && lateMetadata.batchId === binding.batchId
    && lateMetadata.definitionSha256 === binding.definitionSha256, '重啟站不是同manifest的03組');
  const delayedBootstrap = await responseValue(await fetch(config.bootstrapPath, { cache: 'no-store' }));
  assert(delayedBootstrap.status === 410, '原bootstrap未收到410');
  const upload = await responseValue(await child().fetch('/__fixture/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rawPayload()),
  }));
  assert(upload.status === 409 && /runId.*過期/.test(upload.body), '舊頁原fetch包裝上傳未收到runId 409');
  const observation = {
    schema: 'p1-native-browser-negative-observation-v1',
    method: 'Codex CUA原生按鈕操作；父頁與正式App子頁保持不重載，server以同manifest重啟',
    manifest: config.manifest,
    pageUrl: location.href,
    browser: navigator.userAgent,
    viewport: { width: Number(iframe.width), height: Number(iframe.height) },
    oldRunId: config.runId,
    newRunId: lateMetadata.runId,
    initialHtmlRunId: binding.runId,
    originalPassed: originalRaw.passed,
    originalFile: config.rawFile,
    originalRawSha256,
    pageTimeOrigin: initialPageTimeOrigin,
    childPageTimeOrigin: initialChildTimeOrigin,
    duplicate: duplicateObservation,
    delayedBootstrap: { path: config.bootstrapPath, ...delayedBootstrap },
    upload,
    lateMetadata: { runId: lateMetadata.runId, group: lateMetadata.group, batchId: lateMetadata.batchId,
      definitionSha256: lateMetadata.definitionSha256 },
    sequence: ['原正式App手動case成功並保存實收raw', '同頁重送收到409', '停止原server',
      '同manifest啟動新run', '舊頁晚取meta看到新ID', '舊bootstrap收到410', '舊頁以原fetch包裝上傳收到409'],
    limits: '這是真瀏覽器P05與P08觀測，不計入109份矩陣；JSON由父頁pre讀取後另行保存。',
  };
  show(p05Output, observation);
  return observation;
}

const actions = {
  begin: async () => {
    const view = child();
    const stateResponse = await view.fetch('/__fixture/state', { cache: 'no-store' });
    assert(stateResponse.ok, `讀取假HTTP狀態失敗：${stateResponse.status}`);
    const state = await stateResponse.json();
    assert(Array.isArray(state.pending) && state.pending.length === 0, '先釋放上一個自動案例的pending請求');
    const resetResponse = await view.fetch('/__fixture/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(resetResponse.ok, `清除前案假HTTP計畫失敗：${resetResponse.status} ${await resetResponse.text()}`);
    const result = (await loadManual()).begin();
    initialChildTimeOrigin = child().performance.timeOrigin;
    return { ...result, childPageTimeOrigin: initialChildTimeOrigin };
  },
  'record-clear': async () => (await loadManual()).record('原生清空'),
  'record-option': async () => (await loadManual()).record('搜尋選項'),
  'record-tw': async () => (await loadManual()).record('原生方向鍵選股'),
  'record-us': async () => (await loadManual()).record('原生輸入美股'),
  'record-1wk': async () => (await loadManual()).record('週期 1wk'),
  'record-60m': async () => (await loadManual()).record('週期 60m'),
  'record-1d': async () => (await loadManual()).record('週期 1d'),
  'before-zoom': async () => (await loadManual()).beforeZoom(),
  finish: async () => ({ finish: await (await loadManual()).finish(), raw: await captureAcceptedRaw() }),
  'retry-duplicate': retryAcceptedCase,
  'observe-restart': observeRestart,
};

document.getElementById('p1-controls').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const value = await actions[button.dataset.action]();
    showStatus({ action: button.dataset.action, ok: true, value });
  } catch (error) {
    showStatus({ action: button.dataset.action, ok: false, error: String(error?.stack || error) });
  } finally {
    button.disabled = false;
  }
});

iframe.addEventListener('load', () => showStatus({ action: 'iframe-load', ok: true,
  value: { runId: initialBinding().runId, pageTimeOrigin: initialPageTimeOrigin } }), { once: true });
if (iframe.contentDocument?.readyState === 'complete') {
  showStatus({ action: 'ready', ok: true, value: { runId: initialBinding().runId, pageTimeOrigin: initialPageTimeOrigin } });
}
