import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '/components/portfolio/useHoldingPrices.ts';

const params = new URLSearchParams(location.search);
const variant = params.get('variant');
const pair = Number(params.get('pair'));
const captureOrigin = params.get('capture') || 'http://127.0.0.1:4193';
const sourceId = params.get('sourceId') || 'unknown';
if (!['before', 'after'].includes(variant)) throw new Error('variant 只允許 before / after');
if (![1, 2, 3].includes(pair)) throw new Error('pair 只允許 1 / 2 / 3');

const symbols = ['2330.TW', '2317.TW', '2454.TW', '2308.TW', '0050.TW', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA'];
const twSymbols = symbols.filter(symbol => symbol.endsWith('.TW'));
const fxSymbol = 'USDTWD=X';
const expectedRequests = 16;
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));
for (const symbol of [...symbols, fxSymbol]) {
  try { sessionStorage.removeItem(`quote_cache_v1:latest|${symbol}`); } catch { /* formal cold 仍由 request count 驗證 */ }
}

const run = window.__holdingsTrueMarket = {
  schemaVersion: 1,
  variant,
  pair,
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
        if (property === 'json') {
          return async () => {
            try { return await target.json(); } finally { finalize(); }
          };
        }
        if (property === 'text') {
          return async () => {
            try { return await target.text(); } finally { finalize(); }
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
      const price = pricesRef.current[symbol];
      if (price && !price.loading && !price.error && price.price > 0 && run.visible[symbol] === undefined) {
        run.visible[symbol] = now;
      }
    }
    if (rateRef.current > 0 && run.fxVisibleMs === undefined) run.fxVisibleMs = now;
    const visibleTimes = Object.values(run.visible);
    if (visibleTimes.length && run.firstValidQuoteMs === undefined) run.firstValidQuoteMs = Math.min(...visibleTimes);
    if (visibleTimes.length === symbols.length && Number.isFinite(run.fxVisibleMs) && run.allValidQuotesFxMs === undefined) {
      run.allValidQuotesFxMs = Math.max(Math.max(...visibleTimes), run.fxVisibleMs);
    }
  };

  useLayoutEffect(snapshot, [prices, usdTwdRate]);

  useEffect(() => {
    let cancelled = false;
    setItems(symbols.map((symbol, index) => ({ id: `true-market-${index}`, symbol })));
    void (async () => {
      const deadline = performance.now() + 90000;
      while (!cancelled && performance.now() < deadline) {
        snapshot();
        const allValid = symbols.every(symbol => {
          const price = pricesRef.current[symbol];
          return price && !price.loading && !price.error && price.price > 0;
        });
        if (allValid && rateRef.current > 0 && run.requests.length >= expectedRequests && activeHttp === 0) break;
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
      run.successCount = symbols.filter(symbol => {
        const price = pricesRef.current[symbol];
        return price && !price.loading && !price.error && price.price > 0;
      }).length;
      run.nameSuccessCount = twSymbols.filter(symbol => {
        const name = pricesRef.current[symbol]?.name;
        return !!name && name !== symbol;
      }).length;
      run.coreUnchanged = coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]);
      run.timedOut = performance.now() >= deadline;
      run.pass = !run.timedOut
        && run.successCount === symbols.length
        && rateRef.current > 0
        && run.requestCount === expectedRequests
        && run.requestCountByKind.quote === 10
        && run.requestCountByKind.fx === 1
        && run.requestCountByKind.name === 5
        && run.requests.every(request => request.status === 200 && Number.isFinite(request.bodyMs))
        && Number.isFinite(run.firstValidQuoteMs)
        && Number.isFinite(run.allValidQuotesFxMs)
        && run.coreUnchanged
        && run.pageErrors.length === 0;
      const response = await nativeFetch(`${captureOrigin}/capture?name=${variant}-pair-${pair}.json`, {
        method: 'POST',
        body: JSON.stringify(run),
      });
      run.capture = { status: response.status, body: await response.text() };
      document.title = `真行情 ${variant} P${pair} ${run.pass && response.status === 201 ? 'PASS' : 'FAIL'}`;
    })();
    return () => { cancelled = true; };
  }, []);

  return <main>
    <h1>真行情十檔 formal：{variant} pair {pair}</h1>
    <p>正式 useHoldingPrices；五台股＋五美股；真 Yahoo/FinMind upstream；cold only。</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<Probe />);
