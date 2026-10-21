import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '/components/portfolio/useHoldingPrices.ts';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') || 10);
if (![10, 30].includes(count)) throw new Error('count 只允許 10 或 30');
const forceRounds = Number(params.get('rounds') || 5);
if (!Number.isInteger(forceRounds) || forceRounds < 1 || forceRounds > 10) throw new Error('rounds 只允許 1 到 10');
const fixedUpstreamOrigin = params.get('upstream') || 'http://127.0.0.1:4176';

const twCount = count / 2;
const twSymbols = Array.from({ length: twCount }, (_, index) => `${777701 + index}.TW`);
const usSymbols = Array.from({ length: count - twCount }, (_, index) => `PERF${String(index + 1).padStart(2, '0')}`);
const symbols = [...twSymbols, ...usSymbols];
const fxSymbol = 'USDTWD=X';
const expectedRequestCount = count + twCount + 1;
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));

for (const symbol of [...symbols, fxSymbol]) {
  try { sessionStorage.removeItem(`quote_cache_v1:latest|${symbol}`); } catch { /* 測試快取清理失敗即退化成原狀 */ }
}

const diag = window.__holdingsBatch = {
  schemaVersion: 2,
  count,
  symbols,
  queueLimit: 3,
  forceRounds,
  upstream: { origin: fixedUpstreamOrigin, headersDelayMs: 35, bodyDelayMs: 45 },
  startedAt: new Date().toISOString(),
  runs: [],
  pageErrors: [],
};
let activeRun = null;
let activeHttp = 0;
let peakHttp = 0;
const nativeFetch = window.fetch.bind(window);
window.__captureHoldingsBatch = async name => {
  const response = await nativeFetch(`${fixedUpstreamOrigin}/capture?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(diag),
  });
  return { status: response.status, body: await response.text() };
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

window.addEventListener('error', event => diag.pageErrors.push(event.message));
window.addEventListener('unhandledrejection', event => diag.pageErrors.push(String(event.reason)));

const syntheticResponse = async (url, requestRecord) => {
  activeHttp++;
  peakHttp = Math.max(peakHttp, activeHttp);
  requestRecord.activeAtStart = activeHttp;
  const isName = url.pathname === '/api/finmind';
  const symbol = url.searchParams.get('symbol');
  const stockId = url.searchParams.get('data_id');
  const index = symbols.indexOf(symbol);
  const price = symbol === fxSymbol ? 32.5 : 100 + Math.max(index, 0);
  const target = isName
    ? `${fixedUpstreamOrigin}/finmind?stockId=${encodeURIComponent(stockId)}`
    : `${fixedUpstreamOrigin}/yahoo?symbol=${encodeURIComponent(symbol)}&price=${encodeURIComponent(price)}`;
  try {
    const response = await nativeFetch(target, { cache: 'no-store' });
    requestRecord.headersMs = performance.now() - activeRun.t;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        try {
          const payload = await response.json();
          requestRecord.bodyMs = performance.now() - activeRun.t;
          return payload;
        } finally {
          activeHttp--;
        }
      },
    };
  } catch (error) {
    activeHttp--;
    throw error;
  }
};

window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw, location.origin);
  if (!activeRun || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  if (url.pathname !== '/api/yahoo/chart' && url.pathname !== '/api/finmind') {
    activeRun.unexpectedRequests.push(url.pathname + url.search);
    throw new Error(`未預期 API：${url.pathname}`);
  }
  const record = {
    url: url.pathname + url.search,
    kind: url.pathname === '/api/finmind' ? 'name' : (url.searchParams.get('symbol') === fxSymbol ? 'fx' : 'quote'),
    symbol: url.searchParams.get('symbol') || url.searchParams.get('data_id'),
    startMs: performance.now() - activeRun.t,
  };
  activeRun.requests.push(record);
  return syntheticResponse(url, record);
};

const beginRun = (mode, round = null) => {
  peakHttp = activeHttp;
  activeRun = {
    mode,
    t: performance.now(),
    at: new Date().toISOString(),
    requests: [],
    visible: {},
    namesVisible: {},
    fxVisibleMs: null,
    batchDispatchMs: null,
    round,
    unexpectedRequests: [],
  };
  diag.runs.push(activeRun);
  return activeRun;
};

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function Probe() {
  const [items, setItems] = useState([]);
  const [display, setDisplay] = useState('等待量測');
  const { prices, usdTwdRate, fetchAllPrices } = useHoldingPrices(items);
  const pricesRef = useRef(prices);
  const rateRef = useRef(usdTwdRate);
  pricesRef.current = prices;
  rateRef.current = usdTwdRate;

  const snapshotVisible = run => {
    const now = performance.now() - run.t;
    for (const symbol of symbols) {
      const price = pricesRef.current[symbol];
      const bodyDone = run.mode === 'warm' || run.requests.some(request => (
        request.kind === 'quote' && request.symbol === symbol && Number.isFinite(request.bodyMs)
      ));
      if (bodyDone && price && !price.loading && !price.error && price.price > 0 && run.visible[symbol] === undefined) {
        run.visible[symbol] = now;
      }
    }
    for (const symbol of twSymbols) {
      const name = pricesRef.current[symbol]?.name;
      const stockId = symbol.replace(/\.TW$/, '');
      const bodyDone = run.mode === 'warm' || run.requests.some(request => (
        request.kind === 'name' && request.symbol === stockId && Number.isFinite(request.bodyMs)
      ));
      if (bodyDone && name?.startsWith('測試名稱 ') && run.namesVisible[symbol] === undefined) {
        run.namesVisible[symbol] = now;
      }
    }
    const fxBodyDone = run.mode === 'warm' || run.requests.some(request => request.kind === 'fx' && Number.isFinite(request.bodyMs));
    if (fxBodyDone && rateRef.current > 0 && run.fxVisibleMs === null) run.fxVisibleMs = now;
  };

  const ready = run => {
    snapshotVisible(run);
    const expectedNetworkStarted = run.mode === 'warm' || run.requests.length >= expectedRequestCount;
    const allPrices = symbols.every(symbol => {
      const price = pricesRef.current[symbol];
      return price && !price.loading && !price.error && price.price > 0;
    });
    const allNames = twSymbols.every(symbol => pricesRef.current[symbol]?.name?.startsWith('測試名稱 '));
    return expectedNetworkStarted && allPrices && allNames && rateRef.current > 0 && activeHttp === 0;
  };

  const finishRun = run => {
    snapshotVisible(run);
    const quoteRequests = run.requests.filter(request => request.kind === 'quote');
    const primaryRequests = run.requests.filter(request => request.kind === 'quote' || request.kind === 'fx');
    const quoteStarts = quoteRequests.map(request => request.startMs);
    const firstPrimaryStartMs = primaryRequests.length ? Math.min(...primaryRequests.map(request => request.startMs)) : null;
    const primaryQueueWaits = primaryRequests.map(request => request.startMs - firstPrimaryStartMs);
    const primaryDispatchWaits = primaryRequests.map(request => request.startMs - run.batchDispatchMs);
    for (const request of primaryRequests) {
      request.queueWaitFromFirstPrimaryMs = request.startMs - firstPrimaryStartMs;
      request.queueWaitFromDispatchMs = request.startMs - run.batchDispatchMs;
    }
    const visibleValues = Object.values(run.visible);
    const nameVisibleValues = Object.values(run.namesVisible);
    run.firstValidQuoteMs = visibleValues.length ? Math.min(...visibleValues) : null;
    run.allValidQuotesMs = visibleValues.length === symbols.length ? Math.max(...visibleValues) : null;
    run.fxBodyCompleteMs = run.requests.findLast?.(request => request.kind === 'fx')?.bodyMs ?? null;
    run.allValidQuotesFxMs = Number.isFinite(run.allValidQuotesMs) && Number.isFinite(run.fxVisibleMs)
      ? Math.max(run.allValidQuotesMs, run.fxVisibleMs)
      : null;
    const nameBodies = run.requests.filter(request => request.kind === 'name').map(request => request.bodyMs).filter(Number.isFinite);
    run.allNamesBodyCompleteMs = nameBodies.length === twSymbols.length ? Math.max(...nameBodies) : null;
    run.allNamesVisibleMs = nameVisibleValues.length === twSymbols.length ? Math.max(...nameVisibleValues) : null;
    run.requestCount = run.requests.length;
    run.requestCountByKind = {
      quote: quoteRequests.length,
      fx: run.requests.filter(request => request.kind === 'fx').length,
      name: run.requests.filter(request => request.kind === 'name').length,
    };
    run.expectedRequestCount = run.mode === 'warm' ? 0 : expectedRequestCount;
    run.requestCountExact = run.requestCount === run.expectedRequestCount;
    run.httpPeak = peakHttp;
    run.quoteStartMedianMs = quoteStarts.length ? median(quoteStarts) : null;
    run.quoteStartMaxMs = quoteStarts.length ? Math.max(...quoteStarts) : null;
    run.quoteFxQueueWaitMedianMs = primaryQueueWaits.length ? median(primaryQueueWaits) : null;
    run.quoteFxQueueWaitMaxMs = primaryQueueWaits.length ? Math.max(...primaryQueueWaits) : null;
    run.quoteFxDispatchWaitMedianMs = primaryDispatchWaits.length ? median(primaryDispatchWaits) : null;
    run.quoteFxDispatchWaitMaxMs = primaryDispatchWaits.length ? Math.max(...primaryDispatchWaits) : null;
    run.successCount = symbols.filter(symbol => {
      const price = pricesRef.current[symbol];
      return price && !price.loading && !price.error && price.price > 0;
    }).length;
    run.coreUnchanged = coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]);
    const timingComplete = run.mode === 'warm' || (
      Number.isFinite(run.firstValidQuoteMs)
      && Number.isFinite(run.allValidQuotesFxMs)
      && Number.isFinite(run.allNamesVisibleMs)
      && run.requestCountExact
    );
    run.pass = run.successCount === symbols.length && rateRef.current > 0 && timingComplete
      && run.coreUnchanged && run.unexpectedRequests.length === 0 && diag.pageErrors.length === 0;
    run.finishedAt = new Date().toISOString();
  };

  const waitUntilReady = async (run, timeoutMs = 10000) => {
    const deadline = performance.now() + timeoutMs;
    while (!cancelledRef.current && !ready(run) && performance.now() < deadline) await sleep(20);
    run.timedOut = !ready(run);
    return !run.timedOut;
  };

  const cancelledRef = useRef(false);

  useLayoutEffect(() => {
    if (activeRun) snapshotVisible(activeRun);
  }, [prices, usdTwdRate]);

  useEffect(() => {
    let cancelled = false;
    cancelledRef.current = false;
    void (async () => {
      const cold = beginRun('cold');
      cold.batchDispatchMs = performance.now() - cold.t;
      setItems(symbols.map((symbol, index) => ({
        id: `perf-${index}`,
        symbol,
        avgCostPrice: 1,
        totalShares: 1,
        totalCost: 1,
        brokerDiscount: 10,
        cashDividends: 0,
        stockDividends: 0,
      })));
      await waitUntilReady(cold);
      if (cancelled) return;
      finishRun(cold);

      const warm = beginRun('warm');
      warm.batchDispatchMs = performance.now() - warm.t;
      fetchAllPrices();
      await nextFrame();
      await nextFrame();
      snapshotVisible(warm);
      finishRun(warm);

      for (let round = 1; round <= forceRounds; round++) {
        const force = beginRun('force', round);
        force.batchDispatchMs = performance.now() - force.t;
        fetchAllPrices({ force: true });
        await waitUntilReady(force);
        if (cancelled) return;
        finishRun(force);
      }

      activeRun = null;
      diag.pass = diag.runs.every(run => run.pass);
      diag.finishedAt = new Date().toISOString();
      setDisplay(JSON.stringify(diag, null, 2));
      document.title = diag.pass ? `庫存批次 ${count} PASS` : `庫存批次 ${count} FAIL`;
    })();
    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, []);

  return <main>
    <h1>庫存批次量測：{count} 檔</h1>
    <p>正式 useHoldingPrices + 固定 Yahoo/FinMind 回應；記錄 cold / warm / force。</p>
    <pre id="result">{display}</pre>
  </main>;
}

createRoot(document.getElementById('root')).render(<Probe />);
