// 固定假行情量測：不觸網、不讀使用者庫存；雜湊用來比較最佳化前後輸出。
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const FIXED_NOW = Date.parse('2026-09-20T04:00:00Z');
const FIXED_TZ = 'UTC';
const MEASURED_RUNS = 5;
const WARMUP_RUNS = 1;
const FAKE_DELAY_MS = 0;

const originalTz = process.env.TZ;
process.env.TZ = FIXED_TZ;
// 此工具只以 SSR 載入行情服務；不啟動前端相依掃描，避免關站時的掃描競態污染 JSON 輸出。
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const OriginalDate = globalThis.Date;
class FixedDate extends OriginalDate {
  constructor(...args) {
    super(...(args.length === 0 ? [FIXED_NOW] : args));
  }

  static now() {
    return FIXED_NOW;
  }
}
globalThis.Date = FixedDate;
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0,
} });

function chart(symbol, interval, count, timezone) {
  const step = interval === '60m' ? 3600 : interval === '1wk' ? 7 * 86400 : 86400;
  const timestamps = Array.from({ length: count }, (_, i) => 1420209000 + i * step);
  const close = timestamps.map((_, i) => 100 + i / 10 + Math.sin(i));
  return { chart: { error: null, result: [{
    meta: { symbol, currency: timezone === 'Asia/Taipei' ? 'TWD' : 'USD', exchangeTimezoneName: timezone, regularMarketPrice: close.at(-1) },
    timestamp: timestamps,
    indicators: { quote: [{ open: close.map(n => n - 1), high: close.map(n => n + 2), low: close.map(n => n - 2), close, volume: close.map(() => 1000000) }] },
  }] } };
}

const cases = [
  ['AAPL', '1d', 2500, 'America/New_York'],
  ['2330.TW', '1d', 2500, 'Asia/Taipei'],
  ['AAPL', '1wk', 520, 'America/New_York'],
  ['AAPL', '60m', 1600, 'America/New_York'],
];

try {
  const [coldSymbol, coldInterval, coldCount, coldTimezone] = cases[0];
  const coldResponse = chart(coldSymbol, coldInterval, coldCount, coldTimezone);
  globalThis.fetch = async input => ({ ok: true, json: async () => String(input).includes('/api/yahoo/chart') ? coldResponse : { msg: 'success', data: [] } });
  const coldStart = performance.now();
  const { getStockData } = await server.ssrLoadModule('/services/yahoo.ts');
  await getStockData(coldSymbol, coldInterval, { forceRefresh: true });
  const coldStartMs = Number((performance.now() - coldStart).toFixed(2));
  const results = [];
  for (const [symbol, interval, count, timezone] of cases) {
    const response = chart(symbol, interval, count, timezone);
    globalThis.fetch = async input => ({ ok: true, json: async () => String(input).includes('/api/yahoo/chart') ? response : { msg: 'success', data: [] } });
    for (let i = 0; i < WARMUP_RUNS; i += 1) {
      await getStockData(symbol, interval, { forceRefresh: true });
    }
    const durations = [];
    let result;
    for (let i = 0; i < MEASURED_RUNS; i += 1) {
      const start = performance.now();
      result = await getStockData(symbol, interval, { forceRefresh: true });
      durations.push(performance.now() - start);
    }
    results.push({ symbol, interval, inputBars: count, outputBars: result.data.length,
      medianMs: Number(durations.sort((a, b) => a - b)[2].toFixed(2)),
      sha256: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    });
  }
  console.log(JSON.stringify({
    environment: {
      node: process.version,
      timezone: FIXED_TZ,
      fixedNow: new Date(FIXED_NOW).toISOString(),
      cacheMode: 'forceRefresh + empty sessionStorage',
      fakeNetworkDelayMs: FAKE_DELAY_MS,
    },
    coldStartMs,
    warmupRuns: WARMUP_RUNS,
    measuredRuns: MEASURED_RUNS,
    results,
  }, null, 2));
} finally {
  globalThis.Date = OriginalDate;
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
  else delete globalThis.sessionStorage;
  await server.close();
}
