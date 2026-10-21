import React from 'react';
import { createRoot } from 'react-dom/client';
import '/index.css';

const coreKeys = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
];

const twSymbols = ['2330.TW', '2317.TW', '2454.TW', '2308.TW', '0050.TW'];
const usSymbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA'];
const syntheticItems = [...twSymbols, ...usSymbols].map((symbol, index) => {
  const tw = symbol.endsWith('.TW');
  return {
    id: `acceptance-${index + 1}`,
    symbol,
    totalShares: tw ? 1000 : 10,
    avgCostPrice: tw ? 90 + index : 100 + index,
    totalCost: tw ? (90 + index) * 1000 : (100 + index) * 10 * 32,
    totalCostUSD: tw ? undefined : (100 + index) * 10,
    purchaseCurrency: tw ? 'TWD' : 'USD',
    exchangeRate: tw ? undefined : 32,
    brokerDiscount: 10,
    cashDividends: 0,
    stockDividends: 0,
    buyFee: 0,
    buyDate: '2026-01-02',
  };
});

localStorage.clear();
sessionStorage.clear();
localStorage.setItem('portfolio_items', JSON.stringify(syntheticItems));
localStorage.setItem('portfolio_transactions_v1', '[]');
localStorage.setItem('portfolio_import_log_v1', '[]');
localStorage.setItem('portfolio_realized_trades_v1', '[]');
localStorage.setItem('portfolio_snapshots_v1', '[]');
const initialCore = Object.fromEntries(coreKeys.map(key => [key, localStorage.getItem(key)]));

const requestLog = [];
const pageErrors = [];
const unhandled = [];
window.addEventListener('error', event => pageErrors.push(String(event.message || event.error)));
window.addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const startDateMs = Date.UTC(2025, 9, 1);
const dailyDates = Array.from({ length: 240 }, (_, index) => new Date(startDateMs + index * 86400000));
const dailyTimestamps = dailyDates.map(date => Math.floor(date.getTime() / 1000));
const dailyDateStrings = dailyDates.map(date => date.toISOString().slice(0, 10));

const chartPayload = (symbol, interval) => {
  const isTw = /\.TWO?$/i.test(symbol);
  const base = symbol === 'USDTWD=X' ? 32.5 : isTw ? 100 : 200;
  const count = interval === '15m' || interval === '60m' ? 80 : 240;
  const step = interval === '15m' ? 900 : interval === '60m' ? 3600 : 86400;
  const start = interval === '15m' || interval === '60m'
    ? Math.floor(Date.UTC(2026, 8, 21, 1, 0) / 1000)
    : dailyTimestamps[0];
  const timestamps = Array.from({ length: count }, (_, index) => start + index * step);
  const values = timestamps.map((_, index) => base + index * 0.05);
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          longName: isTw ? `合成台股 ${symbol.replace(/\.TW$/i, '')}` : `Synthetic ${symbol}`,
          shortName: symbol,
          currency: symbol === 'USDTWD=X' ? 'TWD' : isTw ? 'TWD' : 'USD',
          exchangeTimezoneName: isTw ? 'Asia/Taipei' : 'America/New_York',
          regularMarketPrice: values.at(-1),
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: values.map(value => value - 0.6),
            high: values.map(value => value + 1),
            low: values.map(value => value - 1),
            close: values,
            volume: values.map((_, index) => 1000000 + index * 1000),
          }],
          adjclose: [{ adjclose: values }],
        },
      }],
    },
  };
};

const finMindRows = (dataset, stockId) => {
  if (dataset === 'TaiwanStockInfo') {
    const ids = stockId ? [stockId] : twSymbols.map(symbol => symbol.replace(/\.TW$/i, ''));
    return ids.map(id => ({ stock_id: id, stock_name: `合成名稱 ${id}`, type: 'twse' }));
  }
  if (dataset === 'TaiwanStockInstitutionalInvestorsBuySell') {
    return dailyDateStrings.flatMap((date, index) => [
      { date, name: 'Foreign_Investor', buy: 2000 + index, sell: 1000 },
      { date, name: 'Investment_Trust', buy: 1000 + index, sell: 500 },
    ]);
  }
  if (dataset === 'TaiwanStockPrice') {
    return dailyDateStrings.map((date, index) => {
      const close = 100 + index * 0.05;
      return {
        stock_id: stockId,
        date,
        open: close - 0.6,
        max: close + 1,
        min: close - 1,
        close,
        Trading_Volume: 1200000 + index * 1000,
      };
    });
  }
  return [];
};

const fakeHealthReport = [
  '### 📋 持股健檢報告：【合成資料】',
  '',
  '**三、 核心決策裁定**',
  '> **操作決策：【 🔵續抱 】**',
  '',
  '```json',
  JSON.stringify({ decisions: syntheticItems.map(item => ({ symbol: item.symbol, decision: '續抱' })) }),
  '```',
].join('\n');

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, location.origin);
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  const record = {
    at: performance.now(),
    method: init.method || 'GET',
    url: url.pathname + url.search,
  };
  requestLog.push(record);
  if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol') || 'AAPL';
    const interval = url.searchParams.get('interval') || '1d';
    return json(chartPayload(symbol, interval));
  }
  if (url.pathname === '/api/yahoo/search') {
    const q = (url.searchParams.get('q') || '').toUpperCase();
    const candidates = [...twSymbols, ...usSymbols]
      .filter(symbol => symbol.includes(q) || `合成名稱 ${symbol}`.includes(q))
      .map(symbol => ({
        symbol,
        shortname: symbol.endsWith('.TW') ? `合成名稱 ${symbol.replace(/\.TW$/i, '')}` : `Synthetic ${symbol}`,
        quoteType: 'EQUITY',
        exchange: symbol.endsWith('.TW') ? 'TAI' : 'NMS',
      }));
    return json({ quotes: candidates });
  }
  if (url.pathname === '/api/finmind') {
    const dataset = url.searchParams.get('dataset') || '';
    const stockId = url.searchParams.get('data_id') || '';
    return json({ msg: 'success', data: finMindRows(dataset, stockId) });
  }
  if (url.pathname === '/api/gemini') {
    return json({ text: fakeHealthReport });
  }
  if (url.pathname === '/api/gemini-stream') {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ t: 'delta', text: fakeHealthReport }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ t: 'done', text: fakeHealthReport }) + '\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  return json({ message: `未定義合成 API：${url.pathname}` }, 404);
};

window.__appAcceptance = {
  schemaVersion: 1,
  synthetic: true,
  trueAiUsed: false,
  symbols: [...twSymbols, ...usSymbols],
  requestLog,
  pageErrors,
  unhandled,
  initialCore,
  snapshot() {
    const core = Object.fromEntries(coreKeys.map(key => [key, localStorage.getItem(key)]));
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      requestCount: requestLog.length,
      requests: requestLog.slice(),
      pageErrors: pageErrors.slice(),
      unhandled: unhandled.slice(),
      core,
      initialCore,
      portfolioItemCount: JSON.parse(localStorage.getItem('portfolio_items') || '[]').length,
      snapshotCount: JSON.parse(localStorage.getItem('portfolio_snapshots_v1') || '[]').length,
    };
  },
};

const { default: App } = await import('/App.tsx');
const { default: ErrorBoundary } = await import('/components/ErrorBoundary.tsx');
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
