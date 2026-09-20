// 使用真實服務及快取程式，僅在 fetch／Storage 邊界注入合成資料和故障。
import { getStockData, getLatestPrice } from '../../../../services/yahoo';
import { getTwFundamentals } from '../../../../services/finmind';
import { readQuoteCache, writeQuoteCache, writeMemoryAlias } from '../../../../services/quoteCache';
import { chart, finmind } from '../07/fixtures.mjs';
import limits from '../07/capacity-decision.json';

const probe = window.__cacheProbe;
const params = new URL(location.href).searchParams;
const count = Number(params.get('n') || 30);
const sample = Number(params.get('sample') || 0);
const scenario = params.get('scenario') || 'profile';
if (![30, 100].includes(count) || !Number.isInteger(sample) || sample < 0 || sample > 6) throw new Error('量測參數錯誤');
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Asia/Taipei') throw new Error('本組量測要求瀏覽器時區 Asia/Taipei');
const status = text => { document.getElementById('status').textContent = text; };
const assert = (value, message) => { if (!value) throw new Error(message); };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(probe.stringify(value))))].map(x => x.toString(16).padStart(2, '0')).join('');
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const sizes = { '1d': 2500, '1wk': 520, '60m': 1600 };
const chartRequests = () => probe.metrics.requests.filter(request => request.path === '/api/yahoo/chart').length;
const boundedSnapshot = () => {
  const retained = probe.snapshot();
  for (const kind of ['quote', 'fundamentals']) {
    const memory = retained[kind];
    const budget = limits[kind];
    const stored = retained.persisted[kind];
    assert(memory.estimatedPayloadBytes + memory.estimatedKeyBytes <= budget.memoryBytes, `${kind} 記憶體估值超標`);
    assert(memory.keys <= (budget.memoryKeys || budget.memoryEntries), `${kind} key 索引超標`);
    assert(memory.uniquePayloads <= (budget.memoryPayloads || budget.memoryEntries), `${kind} payload 超標`);
    assert(memory.largestPayloadBytes <= budget.maxEntryBytes && memory.unmeasurable === 0, `${kind} 長期保留超大或無法序列化資料`);
    assert(stored.bytes + stored.keyBytes <= budget.sessionBytes && stored.keys <= budget.sessionKeys, `${kind} 持久化容量超標`);
    assert(stored.largestPayloadBytes <= budget.maxSessionEntryBytes, `${kind} 持久化單項超標`);
    const index = retained.indexes[kind], sessionIndex = retained.indexes[`${kind}Session`];
    assert(index.entries === memory.uniquePayloads, `${kind} LRU 與主 Map 不一致`);
    assert((index.orphanPayloads || index.orphanKeys || 0) === 0 && (index.unindexedPayloads || index.unindexedKeys || 0) === 0, `${kind} 索引仍持有孤立資料`);
    if (kind === 'quote') assert(index.staleKeys === 0 && index.indexedKeys === memory.keys, '行情別名索引未同步移除');
    assert(sessionIndex.entries <= budget.sessionKeys && sessionIndex.orphanKeys === 0, `${kind} session 索引超標或孤立`);
  }
  return retained;
};
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin) throw new Error('禁止量測外連');
  if (!url.pathname.startsWith('/api/')) return probe.nativeFetch(input, init);
  probe.metrics.requests.push({ path: url.pathname, symbol: url.searchParams.get('symbol'), interval: url.searchParams.get('interval'), range: url.searchParams.get('range'), dataset: url.searchParams.get('dataset') });
  let value;
  if (url.pathname === '/api/yahoo/chart') {
    const symbol = url.searchParams.get('symbol');
    const interval = url.searchParams.get('interval');
    const bars = symbol === 'OVERSIZE' ? 20000 : url.searchParams.get('range') === '5d' ? 5 : sizes[interval] || 64;
    value = chart(symbol, interval, bars);
  } else if (url.pathname === '/api/finmind') value = { msg: 'success', data: finmind(url.searchParams.get('dataset'), url.searchParams.get('data_id')) };
  else throw new Error(`未定義量測 API：${url.pathname}`);
  return new Response(probe.stringify(value), { headers: { 'Content-Type': 'application/json' } });
};

async function runProfile() {
  const symbols = Array.from({ length: count }, (_, i) => i % 2 ? `PROFILE${i}` : String(700000 + i));
  const outputHashes = new Map();
  const rounds = [];
  for (let round = 0; round < 3; round++) {
    const callTimes = [];
    const requestsBefore = probe.metrics.requests.length;
    const chartsBefore = chartRequests();
    let hits = 0, callsWithoutAnyFetch = 0;
    for (const symbol of symbols) {
      for (const interval of Object.keys(sizes)) {
        const beforeRequests = probe.metrics.requests.length;
        const start = performance.now();
        const result = await getStockData(symbol, interval);
        callTimes.push(performance.now() - start);
        const madeRequests = probe.metrics.requests.slice(beforeRequests);
        if (madeRequests.length === 0) callsWithoutAnyFetch++;
        if (!madeRequests.some(request => request.path === '/api/yahoo/chart')) hits++;
        const key = `${symbol}|${interval}`;
        const checksum = await hash(result);
        if (outputHashes.has(key)) assert(checksum === outputHashes.get(key), `輸出改變：${key}`);
        else outputHashes.set(key, checksum);
      }
      await pause();
    }
    rounds.push({ round, calls: count * 3, hits, hitRate: hits / (count * 3), callsWithoutAnyFetch,
      chartRequests: chartRequests() - chartsBefore, requests: probe.metrics.requests.length - requestsBefore,
      serviceMs: callTimes.reduce((sum, time) => sum + time, 0), worstCallMs: Math.max(...callTimes), retained: boundedSnapshot() });
    status(`${count} 檔第 ${round + 1} 輪完成`);
  }
  for (const symbol of symbols) await getLatestPrice(symbol);
  await getLatestPrice('USDTWD=X');
  const withLatestPrices = boundedSnapshot();
  // 在固定日期內重訪最後十檔三週期，與下一段基本面跨日成本分開。
  for (const symbol of symbols.slice(-10)) for (const interval of Object.keys(sizes)) await getStockData(symbol, interval);
  const beforeRecent = probe.metrics.requests.length;
  const chartsBeforeRecent = chartRequests();
  for (const symbol of symbols.slice(-10)) for (const interval of Object.keys(sizes)) await getStockData(symbol, interval);
  const recentWorkset = { stocks: 10, calls: 30, requests: probe.metrics.requests.length - beforeRecent, chartRequests: chartRequests() - chartsBeforeRecent };
  assert(recentWorkset.chartRequests === 0, '近期十檔三週期第二次重訪仍重抓');
  const recentRetained = boundedSnapshot();
  const fundamentals = [];
  for (const day of ['2026-09-20T04:00:00Z', '2026-09-21T04:00:00Z']) {
    probe.setNow(day);
    const beforeRequests = probe.metrics.requests.length;
    let hits = 0;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < count; i++) {
        const before = probe.metrics.requests.length;
        const result = await getTwFundamentals(String(700000 + i));
        assert(result.stockId === String(700000 + i) && result.valuation?.per === 15, '基本面內容不正確');
        if (probe.metrics.requests.length === before) hits++;
      }
      await pause();
    }
    const retained = boundedSnapshot();
    assert(retained.fundamentals.dates.length === 1 && retained.fundamentals.dates[0] === day.slice(0, 10), '基本面舊日期未清理');
    assert(hits === count * 2, '當日一百檔基本面工作集未全部重用');
    fundamentals.push({ day, calls: count * 3, hits, requests: probe.metrics.requests.length - beforeRequests, retained });
  }
  return { rounds, withLatestPrices, fundamentals, recentWorkset, recentRetained,
    outputsIdentical: true, outputDigest: await hash([...outputHashes]), finalRetained: boundedSnapshot() };
}

async function runFaults() {
  const findings = [];
  for (const mode of ['quota', 'denied']) {
    probe.setStorageMode(mode);
    const symbol = `FAULT${mode.toUpperCase()}`;
    const quote = await getStockData(symbol, '1d', { forceRefresh: true });
    const fundamentals = await getTwFundamentals(mode === 'quota' ? '799001' : '799002', { force: true });
    assert(quote.data.length === 2500 && fundamentals.valuation?.per === 15, `${mode} 妨礙正常結果`);
    findings.push({ mode, bars: quote.data.length, price: quote.data.at(-1).close, per: fundamentals.valuation.per });
    probe.setStorageMode('normal');
  }
  probe.seed('quote_cache_v1:CORRUPT|1d', '{broken');
  assert(readQuoteCache('CORRUPT|1d') === null, '壞 JSON 沒有退化為 miss');
  const recovered = await getStockData('CORRUPT', '1d');
  probe.seed('tw_fund_799003_2026-09-20', '{broken');
  assert((await getTwFundamentals('799003')).valuation?.per === 15, '基本面壞 JSON 沒有恢復');
  findings.push({ mode: 'corrupt', recoveredBars: recovered.data.length });
  const circular = { cachedAt: Date.now(), shortTtlOnly: false, result: { info: { symbol: 'CYCLE' }, data: [] } };
  circular.result.loop = circular;
  writeQuoteCache('CYCLE|1d', circular);
  assert(readQuoteCache('CYCLE|1d') === null, '循環資料被長期保留');
  findings.push({ mode: 'serialization', returnedWithoutThrow: true });
  const old = { cachedAt: Date.now(), shortTtlOnly: false, result: { id: 'stale-before-denial' } };
  writeQuoteCache('DENIED-RECOVERY|1d', old);
  writeMemoryAlias('DENIED-RECOVERY.TW|1d', old);
  probe.setStorageMode('denied');
  writeQuoteCache('DENIED-RECOVERY|1d', circular);
  probe.setStorageMode('normal');
  const restored = readQuoteCache('DENIED-RECOVERY|1d');
  const restoredAlias = readQuoteCache('DENIED-RECOVERY.TW|1d');
  assert(restored === null && restoredAlias === null, '儲存權限恢復後舊資料復活');
  findings.push({ mode: 'denied-recovery', oldValueRestored: restored !== null, oldAliasRestored: restoredAlias !== null });
  const large = await getStockData('OVERSIZE', '1d', { forceRefresh: true });
  document.getElementById('readings').textContent = probe.stringify({ symbol: large.info.symbol, bars: large.data.length, price: large.data.at(-1).close });
  assert(large.data.length === 20000 && Number.isFinite(large.data.at(-1).close), '超大資料無法回傳／呈現');
  assert(readQuoteCache('OVERSIZE|1d') === null, '超大 entry 被長期保留');
  findings.push({ mode: 'oversize', bars: large.data.length, price: large.data.at(-1).close, retained: boundedSnapshot() });
  return { findings, sentinelsIntact: probe.sentinelsIntact() };
}

(async () => {
  const start = performance.now();
  let result;
  try {
    const data = scenario === 'faults' ? await runFaults() : await runProfile();
    assert(probe.sentinelsIntact(), '無關 sentinel 被修改');
    result = { passed: true, ...data };
  } catch (error) { result = { passed: false, error: String(error.stack || error) }; }
  await pause();
  probe.stop();
  Object.assign(result, { count, sample, scenario, wallMs: performance.now() - start, initialModuleReadyMs: start,
    browser: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
    environment: { clockStart: '2026-09-20T04:00:00Z', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, fakeNetworkDelayMs: 0,
      network: '瀏覽器 fetch 邊界同步回應合成資料；請求數為服務 fetch 次數，不是外網 HTTP',
      bytes: '唯一物件序列化 UTF-16 長度加 key 長度代理值；不是實際 heap' }, metrics: probe.metrics });
  const saved = await probe.nativeFetch('/__fixture/result', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: probe.stringify({ name: `${scenario}-${count}-${sample}`, result }) });
  if (!saved.ok) throw new Error('量測結果保存失敗');
  status(`${count}／${sample}：${result.passed ? 'PASS' : 'FAIL'}`);
  document.title = `快取 ${scenario} ${count}/${sample}: ${result.passed ? 'PASS' : 'FAIL'}`;
  if (result.passed && params.get('auto') === '1' && scenario === 'profile') {
    if (sample < 6) location.search = `?n=${count}&sample=${sample + 1}&auto=1`;
    else if (count === 30) location.search = '?n=100&sample=0&auto=1';
    else location.search = '?n=30&sample=0&scenario=faults';
  }
})();
