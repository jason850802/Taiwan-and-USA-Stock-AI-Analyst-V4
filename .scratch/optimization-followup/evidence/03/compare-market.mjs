// 回退調查：同程序交替量固定基準與目前版本，避免把跨時段系統負載當成程式差異。
// 基準原始碼只從 git 讀入 Vite 虛擬模組，不覆寫工作區，也不觸網。
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const baseline = 'c27c4beea4a999f3dc20f2dd109690821379602c';
const beforeSource = execFileSync('git', ['show', `${baseline}:services/yahoo.ts`], { cwd: root, encoding: 'utf8' });
const afterSource = readFileSync(path.join(root, 'services/yahoo.ts'), 'utf8');
const virtualId = path.join(root, 'services/yahoo-before-03.ts').replaceAll('\\', '/');
const OriginalDate = Date;
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalTz = process.env.TZ;
const now = Date.parse('2026-09-20T04:00:00Z');
process.env.TZ = 'UTC';
globalThis.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0 } });
const hash = value => createHash('sha256').update(value).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let server;
try {
  // 此工具只載入 SSR 行情模組，不啟動無關的瀏覽器依賴掃描。
  server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', plugins: [{
    name: 'ticket-03-baseline', enforce: 'pre',
    resolveId(id) { if (id === '/services/yahoo-before-03.ts') return virtualId; },
    load(id) { if (id === virtualId) return beforeSource; },
  }] });
  const before = (await server.ssrLoadModule('/services/yahoo-before-03.ts')).getStockData;
  const after = (await server.ssrLoadModule('/services/yahoo.ts')).getStockData;
  const cases = [['AAPL', '1d', 2500, 'America/New_York'], ['2330.TW', '1d', 2500, 'Asia/Taipei'], ['AAPL', '1wk', 520, 'America/New_York'], ['AAPL', '60m', 1600, 'America/New_York']];
  const results = [];
  for (const [symbol, interval, count, timezone] of cases) {
    const step = interval === '60m' ? 3600 : interval === '1wk' ? 7 * 86400 : 86400;
    const timestamps = Array.from({ length: count }, (_, i) => 1420209000 + i * step);
    const close = timestamps.map((_, i) => 100 + i / 10 + Math.sin(i));
    const response = { chart: { error: null, result: [{
      meta: { symbol, currency: timezone === 'Asia/Taipei' ? 'TWD' : 'USD', exchangeTimezoneName: timezone, regularMarketPrice: close.at(-1) },
      timestamp: timestamps,
      indicators: { quote: [{ open: close.map(n => n - 1), high: close.map(n => n + 2), low: close.map(n => n - 2), close, volume: close.map(() => 1000000) }] },
    }] } };
    globalThis.fetch = async input => ({ ok: true, json: async () => String(input).includes('/api/yahoo/chart') ? response : { msg: 'success', data: [] } });
    await before(symbol, interval, { forceRefresh: true });
    await after(symbol, interval, { forceRefresh: true });
    const timings = { before: [], after: [] };
    const hashes = { before: new Set(), after: new Set() };
    for (let run = 0; run < 5; run += 1) {
      const order = run % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]];
      for (const [label, load] of order) {
        const start = performance.now();
        const result = await load(symbol, interval, { forceRefresh: true });
        timings[label].push(Number((performance.now() - start).toFixed(3)));
        hashes[label].add(hash(JSON.stringify(result)));
      }
    }
    const beforeMs = median(timings.before);
    const afterMs = median(timings.after);
    const outputEqual = hashes.before.size === 1 && hashes.after.size === 1 && [...hashes.before][0] === [...hashes.after][0];
    if (!outputEqual) throw new Error(`${symbol}/${interval} 基準與候選輸出不一致`);
    results.push({ symbol, interval, inputBars: count, timings, beforeMs, afterMs, changePct: Number(((afterMs / beforeMs - 1) * 100).toFixed(2)), outputEqual, sha256: [...hashes.after][0] });
  }
  const output = { baseline, sourceHashes: { before: hash(beforeSource), after: hash(afterSource) }, environment: { node: process.version, timezone: process.env.TZ, fixedNow: new Date().toISOString(), cacheMode: 'forceRefresh + empty sessionStorage', fakeDelayMs: 0 }, method: '同程序；各版本每組先暖機一次，五輪交替先後取中位數；只用於暖態回退調查，非冷啟動比較', results };
  writeFileSync(new URL('./market-paired.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally {
  await server?.close();
  globalThis.Date = OriginalDate;
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage); else delete globalThis.sessionStorage;
  if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
}
