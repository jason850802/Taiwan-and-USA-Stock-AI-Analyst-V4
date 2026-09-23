// 07 真行情十檔 K 線探針：只掛正式 getStockData，不掛 App／本體儲存流程。
// 依序冷抓十檔日線（量首批有效 K 線與完整歷史），再同頁回訪一輪，計算回訪新增的 chart 請求。
import { getStockData } from '/services/yahoo.ts';

const params = new URLSearchParams(location.search);
const variant = params.get('variant');
const pair = Number(params.get('pair'));
const captureOrigin = params.get('capture') || 'http://127.0.0.1:4196';
const sourceId = params.get('sourceId') || 'unknown';
if (!['before', 'after'].includes(variant)) throw new Error('variant 只允許 before / after');
if (![1, 2, 3].includes(pair)) throw new Error('pair 只允許 1 / 2 / 3');

const symbols = ['2330.TW', '2317.TW', '2454.TW', '2308.TW', '0050.TW', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA'];
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));
// 冷抓前只清本探針 origin 的行情 session 快取；模組記憶體快取隨新頁面載入重置。
for (let index = sessionStorage.length - 1; index >= 0; index--) {
  const key = sessionStorage.key(index);
  if (key?.startsWith('quote_cache_v1:')) sessionStorage.removeItem(key);
}

const run = window.__chartTrueMarket = {
  schemaVersion: 1,
  variant,
  pair,
  sourceId,
  origin: location.origin,
  startedAt: new Date().toISOString(),
  symbols,
  phase: 'cold',
  requests: [],
  cold: [],
  warm: [],
  pageErrors: [],
  capture: null,
};
run.t = performance.now();
const nativeFetch = window.fetch.bind(window);

const kindOf = url => {
  if (url.pathname === '/api/yahoo/chart') return 'chart';
  if (url.pathname === '/api/finmind') return `finmind:${url.searchParams.get('dataset') || ''}`;
  return url.pathname;
};

window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw, location.origin);
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const record = {
    phase: run.phase,
    kind: kindOf(url),
    symbol: url.searchParams.get('symbol') || url.searchParams.get('data_id'),
    range: url.searchParams.get('range'),
    url: url.pathname + url.search,
    startMs: performance.now() - run.t,
  };
  run.requests.push(record);
  try {
    const response = await nativeFetch(input, init);
    record.status = response.status;
    record.headersMs = performance.now() - run.t;
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      record.bodyMs = performance.now() - run.t;
    };
    return new Proxy(response, {
      get(target, property) {
        if (property === 'json' || property === 'text') {
          return async () => {
            try { return await target[property](); } finally { finalize(); }
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  } catch (error) {
    record.error = error?.name || String(error);
    record.bodyMs = performance.now() - run.t;
    throw error;
  }
};

window.addEventListener('error', event => run.pageErrors.push(event.message));
window.addEventListener('unhandledrejection', event => run.pageErrors.push(String(event.reason)));

const validRows = data => Array.isArray(data)
  && data.length > 0
  && data.every(row => Number.isFinite(row.close) && row.close > 0 && typeof row.date === 'string');

const measure = async (symbol, phase) => {
  const startMs = performance.now() - run.t;
  const requestsBefore = run.requests.length;
  const entry = { symbol, phase, startMs };
  let fullResolve;
  const full = new Promise(resolve => { fullResolve = resolve; });
  try {
    const first = await getStockData(symbol, '1d', {
      onRevalidated: result => {
        if (entry.fullMs !== undefined) return;
        entry.fullMs = performance.now() - run.t - startMs;
        entry.fullRows = result.data.length;
        entry.fullValid = validRows(result.data);
        fullResolve();
      },
    });
    entry.firstMs = performance.now() - run.t - startMs;
    entry.firstRows = first.data.length;
    entry.firstValid = validRows(first.data);
    entry.chipDataUnavailable = first.info?.chipDataUnavailable === true;
    // 兩段式只在冷抓且 2y 先到時補送完整歷史。本檔請求全部結束且 500 ms 內未補送，
    // 代表首批已是完整結果（10y 先到或快取命中）；補送最多再等 60 秒。
    const quietSettled = (async () => {
      const deadline = performance.now() + 60000;
      let quietSince = null;
      while (performance.now() < deadline) {
        if (entry.fullMs !== undefined) return 'revalidated';
        const open = run.requests.slice(requestsBefore).some(request => !Number.isFinite(request.bodyMs));
        if (open) quietSince = null;
        else if (quietSince === null) quietSince = performance.now();
        else if (performance.now() - quietSince >= 500) return 'no-revalidate';
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return 'timeout';
    })();
    const settled = await Promise.race([full.then(() => 'revalidated'), quietSettled]);
    if (settled === 'timeout') {
      entry.fullSource = 'timeout';
      entry.fullValid = false;
    } else if (settled === 'no-revalidate') {
      entry.fullMs = entry.firstMs;
      entry.fullRows = entry.firstRows;
      entry.fullValid = entry.firstValid;
      entry.fullSource = 'first';
    } else {
      entry.fullSource = 'revalidated';
    }
  } catch (error) {
    entry.error = error?.name ? `${error.name}: ${error.message}` : String(error);
  }
  entry.requestCount = run.requests.length - requestsBefore;
  entry.chartRequestCount = run.requests.slice(requestsBefore).filter(request => request.kind === 'chart').length;
  return entry;
};

(async () => {
  for (const symbol of symbols) run.cold.push(await measure(symbol, 'cold'));
  run.phase = 'warm';
  for (const symbol of symbols) run.warm.push(await measure(symbol, 'warm'));
  run.finishedAt = new Date().toISOString();
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  run.summary = {
    coldFirstMedianMs: median(run.cold.map(entry => entry.firstMs)),
    coldFullMedianMs: median(run.cold.map(entry => entry.fullMs)),
    coldSuccess: run.cold.filter(entry => !entry.error && entry.firstValid && entry.fullValid).length,
    coldChartRequests: run.cold.reduce((sum, entry) => sum + entry.chartRequestCount, 0),
    warmChartRequests: run.warm.reduce((sum, entry) => sum + entry.chartRequestCount, 0),
    warmRequests: run.warm.reduce((sum, entry) => sum + entry.requestCount, 0),
    warmSuccess: run.warm.filter(entry => !entry.error && entry.firstValid).length,
    httpStatusNon200: run.requests.filter(request => request.status !== 200).length,
    http429: run.requests.filter(request => request.status === 429).length,
  };
  run.coreUnchanged = coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]);
  run.pass = run.summary.coldSuccess === symbols.length
    && run.summary.warmSuccess === symbols.length
    && run.summary.warmChartRequests === 0
    && run.summary.httpStatusNon200 === 0
    && run.requests.every(request => Number.isFinite(request.bodyMs))
    && run.coreUnchanged
    && run.pageErrors.length === 0;
  const response = await nativeFetch(`${captureOrigin}/capture?name=chart-${variant}-pair-${pair}.json`, {
    method: 'POST',
    body: JSON.stringify(run),
  });
  run.capture = { status: response.status, body: await response.text() };
  document.title = `K 線真行情 ${variant} P${pair} ${run.pass && response.status === 201 ? 'PASS' : 'FAIL'}`;
  document.getElementById('root').textContent = document.title;
})();
