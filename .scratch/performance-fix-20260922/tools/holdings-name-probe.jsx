import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useHoldingPrices } from '/components/portfolio/useHoldingPrices.ts';

const symbols = ['1101.TW', '1216.TW', '1301.TW', '2002.TW'];
const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];
const originalCore = coreKeys.map(key => localStorage.getItem(key));
const nativeFetch = window.fetch.bind(window);
const pendingNames = [];
const state = window.__holdingsNameBlocking = {
  startedAt: new Date().toISOString(),
  yahooStarted: [],
  nameStarted: [],
  nameReleased: false,
  verdict: null,
  errors: [],
};

const chartResponse = symbol => ({
  chart: {
    error: null,
    result: [{
      meta: {
        symbol,
        currency: 'TWD',
        exchangeTimezoneName: 'Asia/Taipei',
        regularMarketPrice: 100,
        shortName: symbol,
      },
      timestamp: [Date.parse('2026-09-22T05:30:00Z') / 1000],
      indicators: { quote: [{ open: [99], high: [101], low: [98], close: [100], volume: [1000] }] },
    }],
  },
});

window.fetch = async (...args) => {
  const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.origin);
  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol') || '';
    state.yahooStarted.push(symbol);
    return new Response(JSON.stringify(chartResponse(symbol)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/api/finmind' && url.searchParams.get('dataset') === 'TaiwanStockInfo') {
    const symbol = url.searchParams.get('data_id') || '';
    state.nameStarted.push(symbol);
    return new Promise(resolve => pendingNames.push(() => resolve(new Response(JSON.stringify({
      msg: 'success',
      data: [{ stock_id: symbol.replace(/\.(TW|TWO)$/i, ''), stock_name: `名稱-${symbol}` }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
  }
  return nativeFetch(...args);
};

window.addEventListener('error', event => state.errors.push(event.message));
window.addEventListener('unhandledrejection', event => state.errors.push(String(event.reason)));

function Probe() {
  const [items, setItems] = useState([]);
  const { prices } = useHoldingPrices(items);

  useLayoutEffect(() => {
    setItems(symbols.map((symbol, index) => ({ id: `probe-${index}`, symbol })));
  }, []);

  useEffect(() => {
    if (state.verdict || state.nameStarted.length === 0) return;
    const firstThreeVisible = symbols.slice(0, 3).every(symbol => {
      const value = prices[symbol];
      return !!value && value.price > 0 && value.loading === false && value.error === false;
    });
    const fourthStarted = state.yahooStarted.includes(symbols[3]);
    if (!firstThreeVisible || !fourthStarted) return;

    const coreUnchanged = coreKeys.every((key, index) => localStorage.getItem(key) === originalCore[index]);
    state.verdict = {
      pass: firstThreeVisible && fourthStarted && state.nameStarted.length > 0 && !state.nameReleased && coreUnchanged,
      firstThreeVisible,
      fourthStarted,
      pendingNameCount: state.nameStarted.length,
      namesStillPending: !state.nameReleased,
      coreUnchanged,
      prices: Object.fromEntries(symbols.map(symbol => [symbol, prices[symbol] || null])),
    };
    document.title = state.verdict.pass ? '名稱阻塞 PASS' : '名稱阻塞 FAIL';
    setTimeout(() => {
      state.nameReleased = true;
      pendingNames.splice(0).forEach(release => release());
    }, 0);
  }, [prices]);

  return <main>
    <h1>名稱阻塞驗收</h1>
    <p id="status">{state.verdict ? (state.verdict.pass ? 'PASS' : 'FAIL') : 'RUNNING'}</p>
  </main>;
}

createRoot(document.getElementById('root')).render(<Probe />);
