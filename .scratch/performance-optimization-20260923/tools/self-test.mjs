#!/usr/bin/env node
// 01 票工具自測：以合成 raw／trace 注入故障，確認判定器會判紅或判無效，而不是只檢查程式沒拋錯。
// 只寫入系統暫存目錄，不碰 evidence、不讀真 .env（秘密清單以假值注入）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { decide, readTraceDir, segmentTrace, verifyRun, writeOnceOrCompare, TARGETS } from './verify-b1-breakdown.mjs';
import { realBudget, upstreamTrouble } from './b1-breakdown.mjs';

const require = createRequire(import.meta.url);
const { classifyUrl, routeOf } = require('./trace-preload.cjs');
const FAKE_SECRETS = [{ key: 'FAKE_KEY', value: 'perf01-fake-secret-value' }];
const results = [];
const check = (name, condition) => results.push({ name, pass: Boolean(condition) });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'perf01-selftest-'));
let pidSeq = 20000;
// 同一 start 內 PID 重用：開啟後每兩個子程序共用一個 PID（先後出現、寫進同一檔）。
let reuseWithinStart = false;
let reuseCounter = 0;
// 每筆 trace 預期的子程序啟動區間（preload→dev server listening），用來逐筆驗證沒有串到別的程序。
const expectedPreload = new Map();

// 為一筆 traced 樣本產生父／子程序事件；durations 可覆寫，drop 可移除指定事件以注入缺口。
function traceEvents(sample, { dispatchMs, outbound, drop = [] }) {
  // 共用 PID 的兩個程序刻意給不同啟動時間：串錯實例時逐筆比對會失敗。
  const variant = reuseWithinStart ? (reuseCounter % 2) * 10 : 0;
  const childPid = reuseWithinStart ? 30000 + Math.floor(reuseCounter++ / 2) : pidSeq++;
  const trace = sample.trace;
  const startup = dispatchMs + variant;
  expectedPreload.set(trace, startup * 0.9);
  const parent = [
    { ev: 'parent.recv', t: 0, trace, layer: 'entry' },
    { ev: 'parent.fork', t: 20, trace, childPid, forkCallMs: 7 },
    { ev: 'parent.childReady', t: 20 + startup, trace, childPid },
    { ev: 'parent.proxyReq', t: 21 + startup, trace },
  ];
  const child = [
    { ev: 'child.boot', t: 20, ipc: true },
    { ev: 'child.listening', t: 20 + startup * 0.9, seq: 1 },
    { ev: 'child.listening', t: 20 + startup * 0.95, seq: 2 },
    { ev: 'child.ready', t: 20 + startup * 0.96 },
    { ev: 'child.recv', t: 1000, trace, layer: 'devProxy' },
    { ev: 'child.recv', t: 1001, trace, layer: 'handler' },
  ];
  let t = 1002;
  outbound.forEach((o, i) => {
    child.push({ ev: 'child.fetchStart', t, trace, seq: i + 1, kind: o.kind, symbol: o.symbol ?? null });
    child.push({ ev: 'child.fetchHeaders', t: t + o.ms, trace, seq: i + 1, status: o.status ?? 200, fixture: o.fixture, fixtureWaitMs: o.fixture ? o.ms : undefined });
    child.push({ ev: 'child.fetchBody', t: t + o.ms + 1, trace, seq: i + 1 });
    t += o.ms + 1;
  });
  child.push({ ev: 'child.writeHead', t: t + 1, trace, layer: 'handler', status: sample.status });
  child.push({ ev: 'child.writeHead', t: t + 2, trace, layer: 'devProxy', status: sample.status });
  const service = t + 2 - 1000;
  parent.push({ ev: 'parent.proxyRes', t: 21 + startup + service + 1, trace });
  parent.push({ ev: 'parent.writeHead', t: 22 + startup + service + 1, trace, status: sample.status });
  return {
    parent: parent.filter(e => !drop.includes(e.ev)),
    child: child.filter(e => !drop.includes(e.ev)).map(e => ({ ...e, pid: childPid })),
    childPid,
    parentTotal: 22 + startup + service + 1,
  };
}

// 合成一個 fixed run：plain A／C 只有 OPTIONS；traced B／D 有 OPTIONS 與固定 GET。
function buildFixedRun(name, { optionsMs, dispatchMs, fixtureMs = 50, inject = {} }) {
  const dir = path.join(tmpRoot, name);
  const traceRoot = path.join(dir, 'trace');
  fs.mkdirSync(traceRoot, { recursive: true });
  const samples = [];
  const traceFiles = {};
  const addTrace = (label, events) => {
    const bucket = (traceFiles[label] ??= { parent: [], children: {} });
    bucket.parent.push(...events.parent);
    (bucket.children[events.childPid] ??= []).push(...events.child);
  };
  let seq = 0;
  const pushOptions = (label, traced, pathName, routeKey, temp, round) => {
    seq += 1;
    const trace = `${name}-${label}-o${seq}`;
    const status = inject.optionsStatus && seq === 3 ? inject.optionsStatus : 204;
    const sample = { phase: 'options', start: label, traced, path: pathName, routeKey, temp, round, trace, method: 'OPTIONS', status, startMs: 0 };
    if (traced) {
      const events = traceEvents(sample, { dispatchMs: optionsMs, outbound: [] });
      addTrace(label, events);
      sample.headersMs = events.parentTotal + 1;
    } else {
      sample.headersMs = optionsMs + (pathName === 'proxy' ? 3 : 0);
    }
    sample.bodyMs = sample.headersMs + 0.2;
    samples.push(sample);
  };
  for (const [label, traced] of [['A-plain', false], ['B-trace-fixture', true], ['C-plain', false], ['D-trace-fixture', true]]) {
    // 讓 B、D 兩個 start 從同一 PID 序號起算，模擬 Windows 跨 start 重用 PID。
    if (inject.reusePids && traced) pidSeq = 20000;
    for (const routeKey of ['yahoo-chart', 'finmind']) pushOptions(label, traced, 'direct', routeKey, 'cold', 0);
    for (let r = 1; r <= 10; r += 1) {
      for (const routeKey of ['yahoo-chart', 'finmind']) pushOptions(label, traced, 'direct', routeKey, 'warm', r);
    }
    if (!traced) continue;
    for (let r = 1; r <= 5; r += 1) {
      const items = [
        { group: 'single', kind: 'quote', symbol: '2330.TW', path: 'direct' },
        { group: 'single', kind: 'quote', symbol: '2330.TW', path: 'proxy' },
        { group: 'single', kind: 'finmind', symbol: '2330', path: 'direct' },
        { group: 'batch', kind: 'fx', symbol: 'USDTWD=X' },
        { group: 'batch', kind: 'quote', symbol: 'AAPL' },
      ];
      items.forEach((item, i) => {
        seq += 1;
        const trace = `${name}-${label}-r${r}-${i}`;
        const outbound = item.kind === 'finmind'
          ? [{ kind: 'finmind', ms: fixtureMs, fixture: true }]
          : [{ kind: 'yahoo-cookie', ms: fixtureMs, fixture: true }, { kind: 'yahoo-crumb', ms: fixtureMs, fixture: true }, { kind: 'yahoo-chart', symbol: item.symbol, ms: fixtureMs, fixture: !inject.realOutbound }];
        const sample = {
          phase: 'fixed', start: label, traced: true, round: r, ...item, trace, method: 'GET', status: 200,
          startMs: 0, price: item.kind === 'finmind' ? undefined : 100,
          bodySha256: inject.bodyDrift && r === 3 && item.symbol === 'AAPL' ? 'drift' : `hash-${item.symbol}`,
          batchId: item.group === 'batch' ? `${label}-r${r}` : undefined, activeAtStart: item.group === 'batch' ? 2 : undefined,
        };
        const drop = inject.dropEvent && r === 2 && i === 0 && label === 'B-trace-fixture' ? [inject.dropEvent] : [];
        const events = traceEvents(sample, { dispatchMs, outbound, drop });
        addTrace(label, events);
        // 經 Vite 的樣本在 client 端多 5 ms，供驗證代理一跳的差額算法。
        sample.headersMs = events.parentTotal + 1 + (item.path === 'proxy' ? 5 : 0);
        sample.bodyMs = sample.headersMs + 1;
        samples.push(sample);
      });
    }
  }
  for (const [label, bucket] of Object.entries(traceFiles)) {
    const dirLabel = path.join(traceRoot, label);
    fs.mkdirSync(dirLabel, { recursive: true });
    fs.writeFileSync(path.join(dirLabel, 'parent-1.jsonl'), bucket.parent.map(e => JSON.stringify({ ...e, pid: 1 })).join('\n'));
    for (const [pid, events] of Object.entries(bucket.children)) {
      fs.writeFileSync(path.join(dirLabel, `child-${pid}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'));
    }
  }
  const services = label => [{ name: 'vercel-dev', port: 5000 + label.charCodeAt(0), ownedPid: 1, listenerPid: inject.pidMismatch && label === 'C-plain' ? 2 : 1, ready: true, stopped: true }];
  const raw = {
    schemaVersion: 1, runId: name, mode: 'fixed',
    identity: { git: { head: 'synthetic' }, product: { equalsHead: true, equalsBaselineCommit: true, untracked: [] } },
    protocol: {}, starts: ['A-plain', 'B-trace-fixture', 'C-plain', 'D-trace-fixture'].map(label => ({ label, services: services(label) })),
    samples, halted: null, aborted: null,
    identityAfter: { head: inject.headDrift ? 'drifted' : 'synthetic' },
  };
  fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(raw, null, 2));
  if (inject.leak === 'secret') fs.writeFileSync(path.join(traceRoot, 'B-trace-fixture', 'note.txt'), `x ${FAKE_SECRETS[0].value} y`);
  if (inject.leak === 'crumb') fs.writeFileSync(path.join(traceRoot, 'B-trace-fixture', 'note.txt'), 'GET /v8/finance/chart/AAPL?crumb=abc');
  return dir;
}

const verify = dir => verifyRun(dir, { secrets: FAKE_SECRETS });

// 1. 達標的快速合成 run：有效且 thresholdPass=true（exit 0 路徑）。
const fast = verify(buildFixedRun('fast', { optionsMs: 40, dispatchMs: 60, fixtureMs: 50 }));
check('快速合成 run 無 problems', fast.problems.length === 0);
check('快速合成 run 達標', fast.thresholdPass === true);

// 2. 與 B1 同量級的慢 run：有效但判紅（exit 1 路徑）。
const slow = verify(buildFixedRun('slow', { optionsMs: 1800, dispatchMs: 2000 }));
check('慢速合成 run 無 problems', slow.problems.length === 0);
check('慢速合成 run 判紅', slow.thresholdPass === false);
check('慢速 OPTIONS 中位數判 FAIL', slow.options.verdict['yahoo-chart'].medianPass === false);
check('慢速固定 GET 本機成本判 FAIL', slow.fixed.verdict.medianPass === false);
check('本機成本已扣除固定等待', Math.abs(slow.fixed.verdict.quoteLocalCost.median - (slow.fixed.singleQuote.clientTtfb.median - 150)) < 1);
check('代理一跳＝經 Vite 與直連的未歸屬差額中位數差', slow.fixed.viteProxyHopMedianMs === 5);
check('父程序 fork→ready 從 fork 呼叫開始算', slow.fixed.singleQuote.parentForkToChildReady.median === 2007);
check('每請求獨立子程序', slow.fixed.distinctChildPerRequest === true);
const reuse = verify(buildFixedRun('reuse', { optionsMs: 40, dispatchMs: 60, inject: { reusePids: true } }));
check('跨 start 的 PID 重用不誤判為共用子程序', reuse.problems.length === 0 && reuse.fixed.distinctChildPerRequest === true);
reuseWithinStart = true;
const withinDir = buildFixedRun('reuse-within', { optionsMs: 40, dispatchMs: 60 });
const within = verify(withinDir);
reuseWithinStart = false;
// 變異測試：把實例切分拿掉（退回只看 PID 的舊連結方式），同一份資料必須出現對錯程序的分段。
{
  const events = readTraceDir(path.join(withinDir, 'trace')).map(ev => ({ ...ev, inst: ev.inst.replace(/#\d+$/, '') }));
  const samples = JSON.parse(fs.readFileSync(path.join(withinDir, 'raw.json'), 'utf8')).samples.filter(s => s.phase === 'options' && s.traced);
  const wrong = samples.map(s => segmentTrace(s, events)).filter(seg => Math.abs(seg.child.preloadToDevServerMs - expectedPreload.get(seg.trace)) >= 0.01);
  check('變異版（只看 PID 連結）在同一份資料上會串錯程序', wrong.length > 0);
}
check('同 start 內 PID 重用：切成獨立實例', within.problems.length === 0 && within.fixed.distinctChildPerRequest === true);
check('同 start 內 PID 重用：確實有 PID 被兩個程序共用', new Set(within.options.tracedSegments.map(x => x.childPid)).size < within.options.tracedSegments.length);
check('同 start 內 PID 重用：每筆啟動分段都對到自己的程序', within.options.tracedSegments.every(x => Math.abs(x.child.preloadToDevServerMs - expectedPreload.get(x.trace)) < 0.01));

// 3. 邊界：OPTIONS 中位數剛好等於門檻算 PASS，每筆上限超出則 FAIL。
const edge = verify(buildFixedRun('edge', { optionsMs: TARGETS.optionsWarmMedianMs, dispatchMs: 30, fixtureMs: 50 }));
check('OPTIONS 中位數等於門檻判 PASS', edge.options.verdict.finmind.medianPass === true);

// 4～9. 故障注入：每種都必須成為 problems（exit 2 路徑）。
const injected = [
  ['OPTIONS 非 204', { optionsStatus: 500 }, /OPTIONS 非 204/],
  ['listener PID 不符', { pidMismatch: true }, /listener PID 非 owned/],
  ['trace 缺 childReady', { dropEvent: 'parent.childReady' }, /trace 缺事件/],
  ['trace 缺子程序 ready', { dropEvent: 'child.ready' }, /trace 缺事件/],
  ['固定輸出漂移', { bodyDrift: true }, /固定輸出不一致/],
  ['固定模式混入真 outbound', { realOutbound: true }, /非固定 outbound/],
  ['證據含 .env 值', { leak: 'secret' }, /疑似含秘密/],
  ['證據含 crumb 查詢', { leak: 'crumb' }, /疑似含秘密/],
  ['run 期間 HEAD 改變', { headDrift: true }, /HEAD 改變/],
];
for (const [index, [name, inject, pattern]] of injected.entries()) {
  const out = verify(buildFixedRun(`inject-${index}`, { optionsMs: 40, dispatchMs: 60, inject }));
  check(`注入「${name}」被判無效`, out.problems.some(p => pattern.test(p)));
}

// 10. 真行情 run：outbound 超過最壞預算判無效。
{
  const dir = path.join(tmpRoot, 'real-over-budget');
  fs.mkdirSync(path.join(dir, 'trace', 'R-trace-real'), { recursive: true });
  const sample = { phase: 'real', start: 'R-trace-real', group: 'direction', kind: 'quote', symbol: 'AAPL', trace: 'real-1', status: 200, startMs: 0, price: 1 };
  const events = traceEvents(sample, { dispatchMs: 2000, outbound: [{ kind: 'yahoo-cookie', ms: 300 }, { kind: 'yahoo-crumb', ms: 300 }, { kind: 'yahoo-chart', ms: 400, status: 429 }] });
  sample.headersMs = events.parentTotal + 1;
  sample.bodyMs = sample.headersMs + 1;
  fs.writeFileSync(path.join(dir, 'trace', 'R-trace-real', 'parent-1.jsonl'), events.parent.map(e => JSON.stringify({ ...e, pid: 1 })).join('\n'));
  fs.writeFileSync(path.join(dir, 'trace', 'R-trace-real', `child-${events.childPid}.jsonl`), events.child.map(e => JSON.stringify(e)).join('\n'));
  const raw = {
    runId: 'real-over-budget', mode: 'real',
    identity: { git: { head: 'synthetic' }, product: { equalsHead: true, equalsBaselineCommit: true, untracked: [] } },
    protocol: {}, budget: { outboundWorst: 2 }, starts: [{ label: 'R-trace-real', services: [{ name: 'vercel-dev', port: 1, ownedPid: 1, listenerPid: 1, ready: true, stopped: true }] }],
    samples: [sample],
    identityAfter: { head: 'synthetic' },
  };
  fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify(raw));
  const out = verify(dir);
  check('真上游 outbound 超預算判無效', out.problems.some(p => /超過最壞預算/.test(p)));
  check('真上游自行握手被計數', out.real.quote.ownHandshakeCount === 1);
  check('握手區間＝cookie 起到 crumb 結束', out.real.quote.yahooCookieToCrumbEnd.median === 602);
  check('被 handler 重試隱藏的上游 429 由 trace 計數', out.real.upstreamErrors === 1);
  check('runner 讀 trace 發現上游 429 即停', /status=429/.test(upstreamTrouble(path.join(dir, 'trace', 'R-trace-real')) ?? ''));
}

// 11. 選路規則：驗收協定 3.5 的兩條件都成立才跳過長駐分支。
check('派送 2.2 秒且各自握手 → 驗證長駐', decide({ dispatchMs: 2200, singleWaitMs: 4100, handshakeShared: false, handshakeMs: 600 }).skipPersistentBranch === false);
check('派送小且握手已共享 → 跳過', decide({ dispatchMs: 100, singleWaitMs: 4000, handshakeShared: true, handshakeMs: null }).skipPersistentBranch === true);
check('派送小且握手 <100 ms 且 <10% → 跳過', decide({ dispatchMs: 100, singleWaitMs: 4000, handshakeShared: false, handshakeMs: 90 }).skipPersistentBranch === true);
check('派送 <500 但 ≥20% → 驗證長駐', decide({ dispatchMs: 450, singleWaitMs: 2000, handshakeShared: true, handshakeMs: null }).skipPersistentBranch === false);
check('派送小但握手 ≥100 ms → 驗證長駐', decide({ dispatchMs: 100, singleWaitMs: 4000, handshakeShared: false, handshakeMs: 150 }).skipPersistentBranch === false);
check('缺真行情總等待 → 不得跳過', decide({ dispatchMs: 100, singleWaitMs: null, handshakeShared: true, handshakeMs: null }).skipPersistentBranch === false);

// 12. runner 的真上游預算由請求組成推導，且乾淨 trace 不會觸發停止。
{
  const budget = realBudget();
  check('真上游預算推導：14 支 API、正常 39、最壞 78＋1', budget.browserApi === 14 && budget.yahooOutboundNormal === 39 && budget.outboundWorst === 79);
  const cleanDir = path.join(tmpRoot, 'clean-trace');
  fs.mkdirSync(cleanDir, { recursive: true });
  fs.writeFileSync(path.join(cleanDir, 'child-1.jsonl'), JSON.stringify({ ev: 'child.fetchHeaders', kind: 'yahoo-chart', status: 200 }));
  check('上游全 200 時不停止', upstreamTrouble(cleanDir) === null);
  fs.writeFileSync(path.join(cleanDir, 'child-2.jsonl'), JSON.stringify({ ev: 'child.fetchError', kind: 'yahoo-cookie', name: 'TimeoutError' }));
  check('上游連線錯誤即停止', /TimeoutError/.test(upstreamTrouble(cleanDir) ?? ''));
}

// 13. 探針分類：不得把 crumb、token、cookie 帶進記錄。
const chart = classifyUrl('https://query2.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=5d&crumb=SECRET');
check('chart 分類只留 symbol／interval／range', chart.kind === 'yahoo-chart' && chart.symbol === '2330.TW' && !JSON.stringify(chart).includes('SECRET'));
check('crumb 分類', classifyUrl('https://query2.finance.yahoo.com/v1/test/getcrumb').kind === 'yahoo-crumb');
check('cookie 分類', classifyUrl('https://fc.yahoo.com').kind === 'yahoo-cookie');
const finmind = classifyUrl('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=2330&token=SECRET');
check('FinMind 分類不含 token', finmind.kind === 'finmind' && finmind.dataset === 'TaiwanStockInfo' && !JSON.stringify(finmind).includes('SECRET'));
check('限流服務分類', classifyUrl('https://abc.upstash.io/pipeline').kind === 'ratelimit');
check('瀏覽器路由去除未列參數', routeOf('/api/finmind?dataset=X&token=SECRET&data_id=2330') === '/api/finmind?dataset=X&data_id=2330');

// 14. 摘要只寫一次：重算結果不同時不覆寫、改記 problem。
{
  const file = path.join(tmpRoot, 'once.json');
  const problems = [];
  writeOnceOrCompare(file, 'a', problems);
  writeOnceOrCompare(file, 'a', problems);
  writeOnceOrCompare(file, 'b', problems);
  check('摘要不覆寫且差異記為 problem', fs.readFileSync(file, 'utf8') === 'a' && problems.length === 1);
}

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
// 全部通過就清掉暫存；有失敗時保留，方便檢查。
if (failed.length) {
  console.log(`\n${results.length - failed.length}/${results.length} 通過；暫存保留在 ${tmpRoot}`);
} else {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`\n${results.length}/${results.length} 通過`);
}
process.exitCode = failed.length ? 1 : 0;
