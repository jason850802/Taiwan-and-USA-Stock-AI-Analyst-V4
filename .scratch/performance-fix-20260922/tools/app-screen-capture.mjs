// 合成 App 桌面畫面時間：只在可見面板執行，依 DOM 完成及下一個 rAF 記錄。
const variant = new URLSearchParams(location.search).get('variant') ?? 'before';
const captureOrigin = new URLSearchParams(location.search).get('capture') ?? 'http://127.0.0.1:4323';
const outputName = `screen-${variant}-desktop-full-visible-v2.json`;
const root = document.getElementById('root');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = () => Boolean(window.__appAcceptance && root?.querySelector('h3')?.textContent === 'K線圖');

const waitUntil = async (predicate, timeoutMs = 12000) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error(`等待畫面逾時：${timeoutMs} ms`);
    await sleep(20);
  }
};

const hasSymbol = symbol => [...root.querySelectorAll('p')].some(node => node.textContent?.trim() === symbol);
const selectedInterval = label => [...root.querySelectorAll('button[aria-pressed]')]
  .some(node => node.textContent?.trim() === label && node.getAttribute('aria-pressed') === 'true');
const hasChart = () => [...root.querySelectorAll('h3')].some(node => node.textContent?.trim() === 'K線圖');
const hasContext = symbol => !symbol.endsWith('.TW') || [...root.querySelectorAll('h3')]
  .some(node => node.textContent?.includes('外資買賣超'));
const noSkeleton = () => !root.textContent?.includes('載入 K 線中');
const nextPaint = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('可見面板的 rAF 逾時')), 2000);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    resolve(performance.now());
  });
});

const measure = async (label, symbol, interval, trigger) => {
  if (document.visibilityState !== 'visible') throw new Error(`${label}：面板不在前景`);
  const requestStart = window.__appAcceptance.requestLog.length;
  const started = performance.now();
  trigger();
  const complete = () => hasSymbol(symbol) && selectedInterval(interval) && hasChart() && noSkeleton();
  await waitUntil(complete);
  const dom = performance.now();
  const paint = await nextPaint();
  await waitUntil(() => complete() && hasContext(symbol));
  const context = performance.now();
  const contextPaint = await nextPaint();
  const requests = window.__appAcceptance.requestLog.slice(requestStart).map(item => item.url);
  return {
    label,
    firstVisibleMs: dom - started,
    firstPaintableMs: paint - started,
    contextMs: context - started,
    contextPaintableMs: contextPaint - started,
    chartRequests: requests.filter(url => url.startsWith('/api/yahoo/chart')).length,
    requests,
    timedOut: false,
    pageErrors: window.__appAcceptance.pageErrors.length,
  };
};

const search = symbol => {
  const input = root.querySelector('input[aria-label="股票代碼或公司名稱"]');
  if (!input) throw new Error('搜尋欄不存在');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, symbol);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
};

const changeInterval = label => {
  const button = [...root.querySelectorAll('button[aria-pressed]')]
    .find(node => node.textContent?.trim() === label);
  if (!button) throw new Error(`週期按鈕不存在：${label}`);
  button.click();
};

const run = async () => {
  await waitUntil(ready, 30000);
  if (innerWidth !== 1280 || innerHeight !== 720) throw new Error(`視窗尺寸錯誤：${innerWidth}×${innerHeight}`);
  const results = [];
  const step = async (label, symbol, interval, trigger) => {
    const result = await measure(`${variant}-${label}`, symbol, interval, trigger);
    results.push(result);
    document.title = `畫面量測 ${results.length}/14`;
    await sleep(50);
  };
  await step('search-2317-cold', '2317.TW', '日', () => search('2317'));
  await step('search-AAPL-cold', 'AAPL', '日', () => search('AAPL'));
  await step('revisit-2317-warm', '2317.TW', '日', () => search('2317'));
  for (const label of ['週', '月', '1時', '15分', '日']) {
    await step(`2317.TW-${label}`, '2317.TW', label, () => changeInterval(label));
  }
  await step('revisit-AAPL-warm', 'AAPL', '日', () => search('AAPL'));
  for (const label of ['週', '月', '1時', '15分', '日']) {
    await step(`AAPL-${label}`, 'AAPL', label, () => changeInterval(label));
  }
  const evidence = {
    schemaVersion: 1,
    kind: 'formal-app-synthetic-screen-timing',
    variant,
    source: { runtime: variant === 'before' ? '07-before-444d6b1' : '07-after-6eee87e', server: location.origin, tool: 'app-screen-capture.mjs' },
    pane: 'visible（每步檢查 visibilityState，rAF 逾時即失敗）',
    viewport: { width: innerWidth, height: innerHeight },
    timing: 'Enter keydown／週期 click 起點；DOM 達目標股票、週期、K 線且無骨架；下一個 rAF 為可繪製；籌碼副圖為台股 context',
    trueAiUsed: false,
    synthetic: true,
    results,
    pageErrors: window.__appAcceptance.pageErrors,
    unhandled: window.__appAcceptance.unhandled,
    capturedAt: new Date().toISOString(),
  };
  const output = document.createElement('pre');
  output.id = 'screen-capture-evidence';
  output.hidden = true;
  output.textContent = JSON.stringify(evidence);
  document.body.append(output);
  if (captureOrigin === 'none') {
    document.title = `畫面量測完成 ${results.length}/14`;
    return;
  }
  const response = await fetch(`${captureOrigin}/capture?name=${outputName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(evidence),
  });
  if (!response.ok) throw new Error(`保存證據失敗：HTTP ${response.status}`);
  document.title = `畫面量測完成 ${results.length}/14`;
};

run().catch(error => {
  document.title = `畫面量測失敗：${error.message}`;
  console.error(error);
});
