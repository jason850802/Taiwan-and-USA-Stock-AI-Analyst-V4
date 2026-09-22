import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '/components/portfolio/useHoldingPrices.ts';

const symbols = ['777701.TW', '777702.TW', '777703.TW', '777704.TW'];
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));
const quoteStarts = [];
const pendingNames = new Map();
const unexpectedRequests = [];
const pageErrors = [];
let namesReleased = false;
let observationStarted = false;
let observe = null;

window.addEventListener('error', event => pageErrors.push(event.message));
window.addEventListener('unhandledrejection', event => pageErrors.push(String(event.reason)));

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const chartResponse = symbol => {
  const price = 101 + Math.max(symbols.indexOf(symbol), 0);
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          regularMarketPrice: price,
          longName: `Yahoo ${symbol}`,
          shortName: symbol,
          exchangeTimezoneName: 'Asia/Taipei',
        },
        timestamp: [1780000000],
        indicators: { quote: [{ close: [price] }] },
      }],
    },
  };
};

const maybeObserve = () => {
  if (observationStarted || quoteStarts.length < 3 || pendingNames.size < 1) return;
  observationStarted = true;
  void (async () => {
    await nextFrame();
    await nextFrame();
    observe?.();
  })();
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async input => {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw, location.origin);
  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol');
    quoteStarts.push(symbol);
    maybeObserve();
    return new Response(JSON.stringify(chartResponse(symbol)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/api/finmind' && url.searchParams.get('dataset') === 'TaiwanStockInfo') {
    const stockId = url.searchParams.get('data_id');
    const wait = deferred();
    pendingNames.set(stockId, wait);
    maybeObserve();
    await wait.promise;
    pendingNames.delete(stockId);
    return new Response(JSON.stringify({
      msg: 'success',
      data: [{ stock_id: stockId, stock_name: `測試名稱 ${stockId}` }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.pathname.startsWith('/api/')) {
    unexpectedRequests.push(url.pathname + url.search);
    throw new Error(`未預期 API：${url.pathname}`);
  }
  return nativeFetch(input);
};

function Harness() {
  const [items, setItems] = useState([]);
  const [display, setDisplay] = useState('等待正式 hook');
  const { prices } = useHoldingPrices(items);
  const pricesRef = useRef(prices);
  pricesRef.current = prices;

  useLayoutEffect(() => {
    observe = () => {
      const result = {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        symbols,
        namesReleased,
        pendingNames: [...pendingNames.keys()],
        quoteStarts: [...quoteStarts],
        visiblePrices: Object.fromEntries(symbols.map(symbol => [symbol, pricesRef.current[symbol] ?? null])),
        coreUnchanged: coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]),
        unexpectedRequests: [...unexpectedRequests],
        pageErrors: [...pageErrors],
      };
      window.__holdingsNameBlocking = result;
      const firstThreeVisible = symbols.slice(0, 3).every(symbol => {
        const state = result.visiblePrices[symbol];
        return state && state.price > 0 && state.loading === false && state.error === false;
      });
      result.pass = !result.namesReleased && result.pendingNames.length > 0
        && firstThreeVisible && result.quoteStarts.includes(symbols[3])
        && result.coreUnchanged && result.unexpectedRequests.length === 0 && result.pageErrors.length === 0;
      setDisplay(JSON.stringify(result, null, 2));
      document.title = result.pass ? '名稱阻塞 PASS' : '名稱阻塞 FAIL';
      namesReleased = true;
      for (const wait of pendingNames.values()) wait.resolve();
    };
    return () => { observe = null; };
  }, []);

  useEffect(() => {
    setItems(symbols.map((symbol, index) => ({ id: `perf-${index}`, symbol })));
    const timeout = window.setTimeout(() => {
      if (window.__holdingsNameBlocking) return;
      pageErrors.push('觀察點 2000ms 內未建立');
      observationStarted = true;
      observe?.();
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, []);

  return <main>
    <h1>庫存名稱阻塞紅燈</h1>
    <p>正式 useHoldingPrices；Yahoo 固定完成，中文名稱保持 pending；不呼叫真上游。</p>
    <pre id="result">{display}</pre>
  </main>;
}

createRoot(document.getElementById('root')).render(<Harness />);
