import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const required = (name: string) => {
  const value = valueOf(name);
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
};

const root = path.resolve(required('--root'));
const outputPath = path.resolve(required('--output'));
if (fs.existsSync(outputPath)) throw new Error(`輸出已存在，拒絕覆寫：${outputPath}`);
if (!fs.existsSync(path.join(root, 'services/yahoo.ts'))) throw new Error(`找不到 yahoo.ts：${root}`);

const storage = new Map<string, string>();
const storageLike = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storageLike });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storageLike });

type RequestRecord = {
  path: string;
  dataset?: string | null;
  symbol?: string | null;
  interval?: string | null;
  range?: string | null;
};
const requestLog: RequestRecord[] = [];

const intervalSeconds: Record<string, number> = {
  '15m': 15 * 60,
  '60m': 60 * 60,
  '1d': 24 * 60 * 60,
  '1wk': 7 * 24 * 60 * 60,
  '1mo': 30 * 24 * 60 * 60,
};
const chartPayload = (symbol: string, interval: string) => {
  const count = 8;
  const step = intervalSeconds[interval] || intervalSeconds['1d'];
  const base = Date.parse('2026-01-02T05:00:00Z') / 1000;
  const marketOffset = symbol.endsWith('.TW') ? 0 : 50;
  const closes = Array.from({ length: count }, (_, index) => 100 + marketOffset + index);
  const timestamps = closes.map((_, index) => base + index * step);
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          currency: symbol.endsWith('.TW') ? 'TWD' : 'USD',
          exchangeTimezoneName: symbol.endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York',
          regularMarketPrice: closes.at(-1),
          longName: symbol.endsWith('.TW') ? 'Yahoo 測試台股' : 'Yahoo Test US',
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: closes.map(value => value - 1),
            high: closes.map(value => value + 2),
            low: closes.map(value => value - 2),
            close: closes,
            volume: closes.map((_, index) => 1000 + index),
          }],
        },
      }],
    },
  };
};

const twDates = Array.from({ length: 8 }, (_, index) => {
  const date = new Date(Date.parse('2026-01-02T00:00:00Z') + index * 86400000);
  return date.toISOString().slice(0, 10);
});
const finmindRows = (dataset: string | null, stockId: string | null) => {
  if (dataset === 'TaiwanStockInfo') {
    return [{ stock_id: stockId, stock_name: `固定名稱 ${stockId}` }];
  }
  if (dataset === 'TaiwanStockInstitutionalInvestorsBuySell') {
    return twDates.flatMap((date, index) => [
      { date, name: 'Foreign_Investor', buy: 200 + index, sell: 100 },
      { date, name: 'Investment_Trust', buy: 80 + index, sell: 30 },
    ]);
  }
  if (dataset === 'TaiwanStockPrice') {
    return twDates.map((date, index) => ({
      date,
      Trading_Volume: 5000 + index,
      open: 99 + index,
      max: 102 + index,
      min: 98 + index,
      close: 100 + index,
    }));
  }
  return [];
};

globalThis.fetch = (async (input: string | URL | Request) => {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw, 'http://fixture');
  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol')!;
    const interval = url.searchParams.get('interval')!;
    requestLog.push({ path: url.pathname, symbol, interval, range: url.searchParams.get('range') });
    return new Response(JSON.stringify(chartPayload(symbol, interval)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/api/finmind') {
    const dataset = url.searchParams.get('dataset');
    const stockId = url.searchParams.get('data_id');
    requestLog.push({ path: url.pathname, dataset, symbol: stockId });
    return new Response(JSON.stringify({ msg: 'success', data: finmindRows(dataset, stockId) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`未定義固定請求：${url.pathname}`);
}) as typeof fetch;

const moduleUrl = pathToFileURL(path.join(root, 'services/yahoo.ts')).href;
const { getStockData } = await import(moduleUrl) as typeof import('../../../services/yahoo');
const intervals = ['1d', '1wk', '1mo', '60m', '15m'] as const;
const markets = [
  { market: 'TW', symbolBase: '7777' },
  { market: 'US', symbolBase: 'PERF' },
] as const;
const scenarios = [];

for (const market of markets) {
  for (let index = 0; index < intervals.length; index++) {
    const interval = intervals[index];
    const symbol = market.market === 'TW'
      ? `${market.symbolBase}${index + 1}.TW`
      : `${market.symbolBase}${index + 1}`;
    const requestStart = requestLog.length;
    const started = performance.now();
    const result = await getStockData(symbol, interval, { forceRefresh: true });
    const durationMs = performance.now() - started;
    const canonical = JSON.stringify(result);
    scenarios.push({
      market: market.market,
      symbol,
      interval,
      durationMs,
      requestCount: requestLog.length - requestStart,
      requests: requestLog.slice(requestStart),
      dataPoints: result.data.length,
      lastDate: result.data.at(-1)?.date ?? null,
      lastClose: result.data.at(-1)?.close ?? null,
      infoName: result.info.name,
      sha256: crypto.createHash('sha256').update(canonical).digest('hex'),
    });
  }
}

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  root,
  scenarios,
  combinedSha256: crypto.createHash('sha256')
    .update(scenarios.map(scenario => `${scenario.market}|${scenario.interval}|${scenario.sha256}`).join('\n'))
    .digest('hex'),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, combinedSha256: result.combinedSha256, scenarios: scenarios.length }, null, 2));
