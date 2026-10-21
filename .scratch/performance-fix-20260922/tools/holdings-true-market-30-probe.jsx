// 07 三十檔真行情觀察：只掛正式 useHoldingPrices（合成 id），不掛 App／本體儲存流程。
// 清單於 07 執行前凍結（01 只固定了合成三十檔）；結果僅稱觀察值，不作 40% 門檻判定。
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '/components/portfolio/useHoldingPrices.ts';

const params = new URLSearchParams(location.search);
const variant = params.get('variant');
const captureOrigin = params.get('capture') || 'http://127.0.0.1:4196';
const sourceId = params.get('sourceId') || 'unknown';
if (!['before', 'after'].includes(variant)) throw new Error('variant 只允許 before / after');

export const THIRTY_SYMBOLS = [
  '2330.TW', '2317.TW', '2454.TW', '2308.TW', '0050.TW', '2382.TW', '2412.TW', '2881.TW',
  '2882.TW', '2891.TW', '2303.TW', '3711.TW', '2002.TW', '1301.TW', '2603.TW',
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'GOOGL', 'META', 'AVGO', 'JPM', 'V',
  'NFLX', 'AMD', 'COST', 'KO', 'SPY',
];
const symbols = THIRTY_SYMBOLS;
const twSymbols = symbols.filter(symbol => symbol.endsWith('.TW'));
const fxSymbol = 'USDTWD=X';
const expectedRequests = symbols.length + 1 + twSymbols.length;
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));
for (const symbol of [...symbols, fxSymbol]) {
  try { sessionStorage.removeItem(`quote_cache_v1:latest|${symbol}`); } catch { /* cold 仍由請求數驗證 */ }
}

const run = window.__holdingsTrueMarket30 = {
  schemaVersion: 1,
  variant,
  sourceId,
  mode: 'cold',
  origin: location.origin,
  startedAt: new Date().toISOString(),
  symbols,
  requests: [],
  visible: {},
  pageErrors: [],
  capture: null,
};
run.t = performance.now();
let activeHttp = 0;
let httpPeak = 0;
const nativeFetch = window.fetch.bind(window);
const kindOf = url => url.pathname === '/api/finmind'
  ? 'name'
  : (url.searchParams.get('symbol') === fxSymbol ? 'fx' : 'quote');

window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw, location.origin);
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const record = {
    kind: kindOf(url),
    symbol: url.searchParams.get('symbol') || url.searchParams.get('data_id'),
    url: url.pathname + url.search,
    startMs: performance.now() - run.t,
  };
  run.requests.push(record);
  activeHttp++;
  httpPeak = Math.max(httpPeak, activeHttp);
  record.activeAtStart = activeHttp;
  try {
    const response = await nativeFetch(input, init);
    record.status = response.status;
    record.headersMs = performance.now() - run.t;
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      record.bodyMs = performance.now() - run.t;
      activeHttp--;
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
    activeHttp--;
    throw error;
  }
};

window.addEventListener('error', event => run.pageErrors.push(event.message));
window.addEventListener('unhandledrejection', event => run.pageErrors.push(String(event.reason)));

const validPrice = price => price && !price.loading && !price.error && price.price > 0;

function Probe() {
  const [items, setItems] = useState([]);
  const { prices, usdTwdRate } = useHoldingPrices(items);
  const pricesRef = useRef(prices);
  const rateRef = useRef(usdTwdRate);
  pricesRef.current = prices;
  rateRef.current = usdTwdRate;

  const snapshot = () => {
    const now = performance.now() - run.t;
    for (const symbol of symbols) {
      if (validPrice(pricesRef.current[symbol]) && run.visible[symbol] === undefined) run.visible[symbol] = now;
    }
    if (rateRef.current > 0 && run.fxVisibleMs === undefined) run.fxVisibleMs = now;
    const times = Object.values(run.visible);
    if (times.length && run.firstValidQuoteMs === undefined) run.firstValidQuoteMs = Math.min(...times);
    if (times.length === symbols.length && Number.isFinite(run.fxVisibleMs) && run.allValidQuotesFxMs === undefined) {
      run.allValidQuotesFxMs = Math.max(Math.max(...times), run.fxVisibleMs);
    }
  };

  useLayoutEffect(snapshot, [prices, usdTwdRate]);

  useEffect(() => {
    let cancelled = false;
    setItems(symbols.map((symbol, index) => ({ id: `true-market-30-${index}`, symbol })));
    void (async () => {
      const deadline = performance.now() + 180000;
      while (!cancelled && performance.now() < deadline) {
        snapshot();
        const allSettled = symbols.every(symbol => {
          const price = pricesRef.current[symbol];
          return price && !price.loading;
        });
        if (allSettled && rateRef.current > 0 && run.requests.length >= expectedRequests && activeHttp === 0) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (cancelled) return;
      snapshot();
      run.finishedAt = new Date().toISOString();
      run.requestCount = run.requests.length;
      run.requestCountByKind = {
        quote: run.requests.filter(request => request.kind === 'quote').length,
        fx: run.requests.filter(request => request.kind === 'fx').length,
        name: run.requests.filter(request => request.kind === 'name').length,
      };
      run.httpPeak = httpPeak;
      run.successCount = symbols.filter(symbol => validPrice(pricesRef.current[symbol])).length;
      run.errorSymbols = symbols.filter(symbol => pricesRef.current[symbol]?.error);
      run.nameSuccessCount = twSymbols.filter(symbol => {
        const name = pricesRef.current[symbol]?.name;
        return !!name && name !== symbol;
      }).length;
      run.http429 = run.requests.filter(request => request.status === 429).length;
      run.httpNon200 = run.requests.filter(request => request.status !== 200).length;
      run.coreUnchanged = coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]);
      run.timedOut = performance.now() >= deadline;
      run.pass = !run.timedOut
        && run.successCount === symbols.length
        && rateRef.current > 0
        && run.requestCount === expectedRequests
        && run.httpPeak <= 3
        && run.requests.every(request => request.status === 200 && Number.isFinite(request.bodyMs))
        && run.coreUnchanged
        && run.pageErrors.length === 0;
      const response = await nativeFetch(`${captureOrigin}/capture?name=holdings30-${variant}.json`, {
        method: 'POST',
        body: JSON.stringify(run),
      });
      run.capture = { status: response.status, body: await response.text() };
      document.title = `三十檔真行情 ${variant} ${run.pass && response.status === 201 ? 'PASS' : 'FAIL'}`;
    })();
    return () => { cancelled = true; };
  }, []);

  return <main>
    <h1>三十檔真行情觀察：{variant}</h1>
    <p>正式 useHoldingPrices；十五台股＋十五美股；真 Yahoo／FinMind 上游；cold only；僅觀察值。</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<Probe />);
