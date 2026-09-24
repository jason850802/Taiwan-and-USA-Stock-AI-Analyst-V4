#!/usr/bin/env node
// 02 票工具自測：長駐池（假 builder）、探針純函式、假 CLI、假限流、判定器長駐模式、對等比對與重載驗證的判差能力。
// 只寫系統暫存目錄，不起服務、不打網路。秘密掃描的單元測試用注入的假清單；唯一讀真證據的是 01 正式基準
// 重算（其秘密掃描會拿主工作區 .env 的值比對證據，只回報命中鍵名、不輸出值）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { findRunDir, identityProblems, persistentProblems, scanSecrets, segmentTrace, verifyRun } from './verify-b1-breakdown.mjs';
import { realBudget } from './b1-breakdown.mjs';
import { ENTRIES, createFixtureControl, persistentReport, probeEnv } from './service-kit.mjs';
import { cancelOutcome, compareCase, normalizeHandlerSnapshot, normalizeResponseHeaders } from './c-parity.mjs';
import { STEPS, sameOutcome, streamCompleted } from './c-reload.mjs';

const require = createRequire(import.meta.url);
const { LOG, createChangeFilter, createPersistentPool, fingerprint, isVercelDevParent, loopbackPort } = require('./persistent-functions.cjs');
const preload = require('./trace-preload.cjs');
const results = [];
const check = (name, condition) => results.push({ name, pass: Boolean(condition) });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'perf02-selftest-'));

// ---------- 1. 長駐池（假 builder） ----------
function fakeBuilder() {
  const children = new Map();
  let nextPid = 100;
  const calls = [];
  const shutdowns = [];
  const original = async opts => {
    calls.push(opts.entrypoint);
    if (opts.fail) throw new Error('啟動失敗');
    if (opts.returnNull) return null;
    await sleep(5);
    const pid = nextPid++;
    const child = new EventEmitter();
    const record = { child, exited: false };
    child.once('exit', () => { record.exited = true; });
    children.set(pid, record);
    return { port: 5000 + pid, pid, shutdown: async () => { shutdowns.push(pid); } };
  };
  return { original, lookupChild: pid => children.get(pid), children, calls, shutdowns };
}
const opts = (entrypoint, env = { A: '1' }, extra = {}) => ({ entrypoint, workPath: '/w', config: {}, meta: { env, buildEnv: {}, requestPath: `/r${Math.random()}` }, ...extra });

{
  const fb = fakeBuilder();
  const lines = [];
  const pool = createPersistentPool({ original: fb.original, lookupChild: fb.lookupChild, log: line => lines.push(line), graceMs: 10 });
  const first = await pool.startDevServer(opts('api/a.ts'));
  const second = await pool.startDevServer(opts('api/a.ts'));
  check('同路由同設定重用同一子程序', first.pid === second.pid && fb.calls.length === 1);
  check('回傳 persistent: true', first.persistent === true && second.persistent === true);
  check('requestPath 不同不影響重用（指紋不含請求路徑）', fingerprint(opts('api/a.ts')) === fingerprint(opts('api/a.ts')));
  check('log 以集中標記開頭（接手、啟動）', lines[0] === LOG.takenOver && LOG.spawnPattern.test(lines[1]));

  const [x, y, z] = await Promise.all([1, 2, 3].map(() => pool.startDevServer(opts('api/b.ts'))));
  check('同時三個請求只啟動一次（共用啟動中的 promise）', x.pid === y.pid && y.pid === z.pid && fb.calls.filter(e => e === 'api/b.ts').length === 1);

  const changedEnv = await pool.startDevServer(opts('api/a.ts', { A: '2' }));
  check('環境變更時換新子程序', changedEnv.pid !== first.pid && fb.calls.filter(e => e === 'api/a.ts').length === 2);
  await sleep(30);
  check('環境變更後舊子程序在寬限後被關閉', fb.shutdowns.includes(first.pid));

  const before = fb.calls.length;
  const retired = pool.invalidateAll('api/a.ts');
  const afterInvalidate = await pool.startDevServer(opts('api/a.ts', { A: '2' }));
  check('來源變更後全部停用、下一支請求重新啟動', retired === 2 && afterInvalidate.pid !== changedEnv.pid && fb.calls.length === before + 1);
  check('停用紀錄以集中標記開頭', lines.some(line => line.startsWith(LOG.invalidation)));
  await sleep(30);
  check('停用的子程序在寬限後被關閉', fb.shutdowns.includes(changedEnv.pid) && fb.shutdowns.includes(x.pid));

  fb.lookupChild(afterInvalidate.pid).child.emit('exit', 1, null);
  const respawned = await pool.startDevServer(opts('api/a.ts', { A: '2' }));
  check('子程序結束後下一支請求重新啟動', respawned.pid !== afterInvalidate.pid);
  const shutdownsBefore = fb.shutdowns.length;
  await afterInvalidate.shutdown();
  check('已結束子程序的 shutdown 不呼叫底層（避免對重用 PID 下手）', fb.shutdowns.length === shutdownsBefore);

  let threw = false;
  try {
    await pool.startDevServer(opts('api/fail.ts', { A: '1' }, { fail: true }));
  } catch {
    threw = true;
  }
  const retry = await pool.startDevServer(opts('api/fail.ts'));
  check('啟動失敗不快取，下一支請求重試', threw && retry.pid > 0);
  const nullResult = await pool.startDevServer(opts('api/null.ts', { A: '1' }, { returnNull: true }));
  const callsAfterNull = fb.calls.filter(e => e === 'api/null.ts').length;
  const afterNull = await pool.startDevServer(opts('api/null.ts'));
  check('builder 回 null 時照原樣回傳，且下一支請求會重新呼叫 builder（不快取 null）',
    nullResult === null && callsAfterNull === 1 && fb.calls.filter(e => e === 'api/null.ts').length === 2 && afterNull.pid > 0);
}

{
  // 啟動中被停用：等啟動完成後仍要在寬限後關閉，不留閒置子程序。
  const fb = fakeBuilder();
  const pool = createPersistentPool({ original: fb.original, lookupChild: fb.lookupChild, log: () => {}, graceMs: 10 });
  const pending = pool.startDevServer(opts('api/slow.ts'));
  pool.invalidateAll('api/slow.ts');
  const result = await pending;
  await sleep(40);
  check('啟動中被停用的子程序完成後仍被關閉', fb.shutdowns.includes(result.pid));
}

{
  // 停用時仍有轉送中的請求（例如長串流）：寬限過後也要等請求結束才關，不切斷串流。
  const fb = fakeBuilder();
  let busy = 1;
  const pool = createPersistentPool({ original: fb.original, lookupChild: fb.lookupChild, inflight: () => busy, log: () => {}, graceMs: 10, pollMs: 5, maxWaitMs: 5000 });
  const streaming = await pool.startDevServer(opts('api/stream.ts'));
  pool.invalidateAll('api/_lib/x.ts');
  await sleep(80);
  check('停用後仍有轉送中請求時不關閉', !fb.shutdowns.includes(streaming.pid));
  busy = 0;
  await sleep(40);
  check('轉送中請求結束後才關閉', fb.shutdowns.includes(streaming.pid));
}

{
  // 等待有上限：請求一直不結束時，到上限仍關閉並留下警告。
  const fb = fakeBuilder();
  const lines = [];
  const pool = createPersistentPool({ original: fb.original, lookupChild: fb.lookupChild, inflight: () => 1, log: line => lines.push(line), graceMs: 5, pollMs: 5, maxWaitMs: 40 });
  const stuck = await pool.startDevServer(opts('api/hang.ts'));
  pool.invalidateAll('api/x.ts');
  await sleep(150);
  check('等待上限到仍關閉並記逾時警告', fb.shutdowns.includes(stuck.pid) && lines.some(line => line.startsWith(LOG.retireTimeout)) && lines.some(line => line.startsWith(LOG.retire)));
}

check('只在 vercel dev 父程序啟用', isVercelDevParent(['node', 'C:/x/vercel/dist/vc.js', 'dev'], {}) === true
  && isVercelDevParent(['node', 'C:/x/vercel/dist/vc.js', 'dev'], { VERCEL_DEV_ENTRYPOINT: 'api/a.ts' }) === false
  && isVercelDevParent(['node', 'C:/x/vite/bin/vite.js'], {}) === false);

// http-proxy 的 outgoing 由 url.parse 組成：host 帶埠、hostname 不帶（02 smoke 實測時原型漏算的寫法）。
check('轉送目標：host 帶埠的寫法也認得', loopbackPort({ host: '127.0.0.1:61234', hostname: '127.0.0.1', port: '61234' }) === 61234
  && loopbackPort({ host: '127.0.0.1:61234', port: '61234' }) === 61234
  && loopbackPort({ hostname: 'localhost', port: 5000 }) === 5000);
check('轉送目標：外部主機與缺埠不算', loopbackPort({ host: 'query2.finance.yahoo.com', port: 443 }) === null
  && loopbackPort({ hostname: '127.0.0.1' }) === null && loopbackPort(null) === null);

{
  // 變更過濾：只改存取時間（大小、修改時間不變）不算；改內容、刪除、新增都算。
  const files = new Map([['a.ts', { size: 10, mtimeMs: 1 }], ['dir', { size: 0, mtimeMs: 1, dir: true }]]);
  const statSync = file => {
    const entry = files.get(file);
    if (!entry) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { size: entry.size, mtimeMs: entry.mtimeMs, isDirectory: () => Boolean(entry.dir) };
  };
  const filter = createChangeFilter(statSync);
  filter.remember('a.ts');
  filter.remember('dir');
  const accessOnly = filter.changed('a.ts');
  files.set('a.ts', { size: 12, mtimeMs: 2 });
  const edited = filter.changed('a.ts');
  const editedAgainSameState = filter.changed('a.ts');
  files.delete('a.ts');
  const deleted = filter.changed('a.ts');
  files.set('b.ts', { size: 1, mtimeMs: 3 });
  const created = filter.changed('b.ts');
  check('變更過濾：只讀檔（存取時間）不算變更', accessOnly === false && filter.changed('dir') === false);
  check('變更過濾：改內容、刪除、新增都算變更，同一狀態不重複觸發', edited && !editedAgainSameState && deleted && created);
}

{
  // 量測工具從 vercel dev log 讀原型紀錄：標記取自原型本身。
  const logFile = path.join(tmpRoot, 'vercel.log');
  fs.writeFileSync(logFile, [
    `${LOG.enabled}（vercel 55.0.0、@vercel/node 5.8.23）`,
    LOG.takenOver,
    `${LOG.spawn} api/yahoo/chart.ts pid=${process.pid} generation=0`,
    `${LOG.invalidation}（api/_lib/yahoo.ts），停用 1 個子程序；generation=1`,
    `${LOG.retire} api/yahoo/chart.ts pid=${process.pid}（來源已變更）`,
  ].join('\n'));
  const report = persistentReport(logFile);
  check('log 報告解析啟用／接手／啟動／停用／關閉', report.enabled && report.takenOver && report.spawns.length === 1
    && report.invalidations === 1 && report.retirements === 1 && report.outsideForks === 0);
  check('命令列不是 dev-server 的 PID 不算殘留', report.orphans.length === 0);
}

// ---------- 2. 探針純函式 ----------
check('claude.exe 路徑判定為 claude CLI', preload.looksLikeClaude('C:\\Users\\x\\AppData\\Roaming\\Claude\\claude-code\\2.1.280\\claude.exe', ['-p']));
check('CLI 參數組合判定為 claude CLI', preload.looksLikeClaude('C:/any/other.exe', ['-p', '--output-format', 'stream-json']));
check('一般 spawn 不誤判', !preload.looksLikeClaude('C:/esbuild/esbuild.exe', ['--service=0.25.12']) && !preload.looksLikeClaude(process.execPath, ['script.js']));
check('本機位址判定', ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1', undefined].every(host => preload.isLoopbackHost(host)));
check('外部主機不是本機', !preload.isLoopbackHost('query2.finance.yahoo.com') && !preload.isLoopbackHost('10.0.0.5'));
{
  const consumed = new Map();
  const control = { version: 'v1', script: { 'yahoo-chart': [{ status: 401 }, { status: 429 }] } };
  const steps = [1, 2, 3].map(() => preload.pickScriptStep(control, consumed, 'yahoo-chart'));
  check('腳本依序消耗、用完回 null', steps[0].status === 401 && steps[1].status === 429 && steps[2] === null);
  check('換 version 重新計數', preload.pickScriptStep({ ...control, version: 'v2' }, consumed, 'yahoo-chart').status === 401);
}
{
  const consumed = new Map();
  const control = { version: 'v1', script: { 'yahoo-chart:AMZN': [{ status: 401, delayMs: 1500 }] } };
  const amzn = [1, 2].map(() => preload.pickScriptStep(control, consumed, 'yahoo-chart', 'AMZN'));
  const msft = preload.pickScriptStep(control, consumed, 'yahoo-chart', 'MSFT');
  check('symbol 專屬腳本只給該 symbol、各自計數', amzn[0].status === 401 && amzn[0].delayMs === 1500 && amzn[1] === null && msft === null);
}
{
  const snap = preload.snapshotHeaders({ host: 'h', 'x-proxy-secret': 'TOP-SECRET', cookie: 'A=1', 'x-forwarded-for': '127.0.0.1' });
  check('header 快照只記秘密類是否存在、不記值', !JSON.stringify(snap).includes('TOP-SECRET') && !JSON.stringify(snap).includes('A=1')
    && snap.sensitivePresent.includes('x-proxy-secret') && snap.values['x-forwarded-for'] === '127.0.0.1');
}
{
  const noCookie = preload.fixtureResponse({ kind: 'yahoo-cookie' }, { body: 'noCookie' });
  const okCookie = preload.fixtureResponse({ kind: 'yahoo-cookie' }, null);
  check('固定上游 cookie 變體', noCookie.headers.getSetCookie().length === 0 && okCookie.headers.getSetCookie().length === 1);
  const notFound = await preload.fixtureResponse({ kind: 'yahoo-chart', symbol: 'ZZZZ' }, { body: 'notFound' }).json();
  const chart500 = preload.fixtureResponse({ kind: 'yahoo-chart', symbol: 'AAPL' }, { status: 500 });
  check('固定上游 chart 變體（Not Found／500）', notFound.chart.error.code === 'Not Found' && chart500.status === 500);
  const limit = await preload.fixtureResponse({ kind: 'finmind', dataset: 'TaiwanStockInfo' }, { status: 402, body: 'limit' }).json();
  check('固定上游 FinMind 額度用盡', /upper limit/i.test(limit.msg));
}
{
  // 假 Upstash：auto-pipelining 的 /pipeline 回陣列、每個指令一筆；單一指令回物件；故障回 HTTP 500。
  const cls = preload.classifyUrl('https://perf02-fixture.upstash.io/pipeline');
  check('Upstash pipeline 分類為限流', cls.kind === 'ratelimit' && cls.pipeline === true
    && preload.classifyUrl('https://perf02-fixture.upstash.io').pipeline === false);
  check('Upstash 指令數：pipeline 兩個、單一指令一個', preload.countRedisCommands(JSON.stringify([['evalsha', 'a'], ['evalsha', 'b']])) === 2
    && preload.countRedisCommands(JSON.stringify(['evalsha', 'a'])) === 1);
  const ok = await preload.fixtureResponse(cls, null, { commands: 2 }).json();
  const over = await preload.fixtureResponse(cls, { remaining: -1 }, { commands: 1 }).json();
  const single = await preload.fixtureResponse({ kind: 'ratelimit', pipeline: false }, null).json();
  const down = preload.fixtureResponse(cls, { status: 500 }, { commands: 1 });
  check('假限流：放行／超限／單一指令／故障', ok.length === 2 && ok[1].result[0] === 59 && over[0].result[0] === -1
    && single.result[0] === 59 && down.status === 500);
}

// ---------- 3. 假 CLI ----------
const runCli = async (args, ai) => {
  const events = [];
  const cli = preload.createFakeCli({ args, ai, record: (ev, data) => events.push({ ev, ...data }) });
  let out = '';
  let err = '';
  let spawnError = null;
  cli.stdout.setEncoding('utf8');
  cli.stdout.on('data', chunk => { out += chunk; });
  cli.stderr.on('data', chunk => { err += chunk; });
  cli.on('error', error => { spawnError = error; });
  cli.stdin.write('提示詞');
  cli.stdin.end();
  const [code] = await new Promise(resolve => cli.once('close', (...closeArgs) => resolve(closeArgs)));
  return { code, out, err: String(err), spawnError, events, cli };
};
const STREAM_ARGS = ['-p', '--output-format', 'stream-json'];
const parseLines = out => out.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
{
  const { code, out, events } = await runCli(STREAM_ARGS, { deltas: 3, intervalMs: 5 });
  const lines = parseLines(out);
  check('假 CLI 串流：三段 delta＋result 後正常結束', code === 0 && lines.length === 4 && lines[0].type === 'stream_event' && lines[3].type === 'result');
  check('假 CLI 只記提示詞長度', events.some(e => e.ev === 'child.fakeCli.stdin' && e.promptBytes > 0) && !JSON.stringify(events).includes('提示詞'));
}
{
  const events = [];
  const cli = preload.createFakeCli({ args: STREAM_ARGS, ai: { deltas: 5, intervalMs: 20 }, record: (ev, data) => events.push({ ev, ...data }) });
  cli.stdout.resume();
  await sleep(50);
  cli.kill();
  const [code, signal] = await new Promise(resolve => cli.once('close', (...args) => resolve(args)));
  const kill = events.find(e => e.ev === 'child.fakeCli.kill');
  check('假 CLI 被 kill：記下已送出段數、不再送 result', code === null && signal === 'SIGTERM' && kill && kill.emitted < 5 && !events.some(e => e.ev === 'child.fakeCli.done'));
}
{
  const { out } = await runCli(['-p', '--output-format', 'json'], { deltas: 2, intervalMs: 5 });
  const json = JSON.parse(out);
  check('假 CLI 非串流：單一 JSON result', json.type === 'result' && json.is_error === false && typeof json.result === 'string');
}
{
  const isError = await runCli(STREAM_ARGS, { deltas: 1, intervalMs: 5, mode: 'isError' });
  const lines = parseLines(isError.out);
  check('假 CLI isError：片段後 result 帶 is_error、exit 1', isError.code === 1 && lines.length === 2 && lines[1].is_error === true);
  const auth = await runCli(['-p', '--output-format', 'json'], { deltas: 0, intervalMs: 5, mode: 'authError' });
  check('假 CLI authError：result 帶登入失敗訊息', JSON.parse(auth.out).is_error === true && JSON.parse(auth.out).result.includes('Failed to authenticate'));
  const noResult = await runCli(STREAM_ARGS, { deltas: 2, intervalMs: 5, mode: 'noResult' });
  check('假 CLI noResult：只有片段、沒有 result、stderr 有訊息', noResult.code === 1 && parseLines(noResult.out).every(line => line.type === 'stream_event')
    && noResult.err.length > 0);
  const spawnError = await runCli(STREAM_ARGS, { mode: 'spawnError' });
  check('假 CLI spawnError：先 error（ENOENT）再 close、沒有輸出', spawnError.spawnError?.code === 'ENOENT' && spawnError.out === ''
    && spawnError.events.some(e => e.ev === 'child.fakeCli.error'));
}

// ---------- 4. 秘密掃描與預算 ----------
{
  const dir = path.join(tmpRoot, 'scan');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify({ totals: { cookie: 1, crumb: 1, chart: 13 } }));
  check('握手次數欄位（"cookie": 1）不算外洩', scanSecrets(dir, []).length === 0);
  fs.writeFileSync(path.join(dir, 'leak.json'), JSON.stringify({ cookie: 'A1=abc' }));
  check('cookie 字串值仍判外洩', scanSecrets(dir, []).some(hit => hit.key === 'cookie-field'));
}
check('候選真上游預算：只含一次共用握手', realBudget('c').yahooOutboundNormal === 15 && realBudget('b1').yahooOutboundNormal === 39);

// ---------- 5. 判定器長駐模式與身分核對 ----------
{
  // 暖請求沒有 fork／childReady，不算缺事件，也不把實例啟動時間算進這支請求。
  const events = [
    { src: 's', role: 'parent', ev: 'parent.recv', t: 0, trace: 'w' },
    { src: 's', role: 'parent', ev: 'parent.proxyReq', t: 15, trace: 'w' },
    { src: 's', role: 'parent', ev: 'parent.proxyRes', t: 80, trace: 'w' },
    { src: 's', role: 'parent', ev: 'parent.writeHead', t: 81, trace: 'w' },
    ...[
      { ev: 'child.boot', t: 20, ipc: true },
      { ev: 'child.listening', t: 1700, seq: 1 },
      { ev: 'child.listening', t: 1760, seq: 2 },
      { ev: 'child.ready', t: 1761 },
      { ev: 'child.recv', t: 5000, trace: 'w', layer: 'devProxy' },
      { ev: 'child.recv', t: 5001, trace: 'w', layer: 'handler' },
      { ev: 'child.writeHead', t: 5060, trace: 'w', layer: 'handler' },
      { ev: 'child.writeHead', t: 5062, trace: 'w', layer: 'devProxy' },
    ].map(e => ({ src: 's', role: 'child', pid: 9, inst: 's/child-9.jsonl#0', ...e })),
  ];
  const warm = segmentTrace({ trace: 'w', startMs: 0, headersMs: 82 }, events, { persistent: true });
  check('長駐暖請求：不要求 fork 事件', warm.missing.length === 0 && warm.startupOnPath === false);
  check('長駐暖請求：實例啟動區間不算進這支請求', warm.child.preloadToDevServerMs === null && warm.parent.recvToProxyMs === 15);
  const strict = segmentTrace({ trace: 'w', startMs: 0, headersMs: 82 }, events, { persistent: false });
  check('B1 模式同一份資料缺 fork 仍判缺事件', strict.missing.includes('parent.fork'));
}
{
  const before = { git: { head: 'h1' }, product: { aggregateSha256: 'p1' }, tools: { a: 't1' } };
  check('身分前後一致不報問題', identityProblems(before, { head: 'h1', productSha256: 'p1', tools: { a: 't1' } }).length === 0);
  check('HEAD／產品樹／工具任何一項改變都報問題', identityProblems(before, { head: 'h2', productSha256: 'p2', tools: { a: 't2' } }).length === 3);
  check('缺結束時身分報問題', identityProblems(before, undefined).length === 1);
  check('重載驗證不比產品樹', identityProblems(before, { head: 'h1', tools: { a: 't1' } }, { product: false }).length === 0);
}
{
  // 真實 01 基準可讀：候選比較用的兩個 baseline 必須存在且有效。
  const base = verifyRun(findRunDir('b1-fixed-20260923-r3'));
  check('01 正式固定基準仍可由目前判定器重算且有效', base.problems.length === 0 && base.fixed.verdict.quoteLocalCost.median === 1836.1);
  const real = verifyRun(findRunDir('b1-real-20260923-r2'));
  check('01 正式真行情基準仍有效、每支報價都自己握手', real.problems.length === 0 && real.real.quote.ownHandshakeCount === real.real.quote.quoteCount);
}

// ---------- 6. 對等比對的判差能力 ----------
{
  const baseHeaders = { date: 'x', 'x-vercel-id': 'dev1::dev1::abc', 'content-type': 'application/json', 'x-deploy': 'http://127.0.0.1:4631' };
  const norm = normalizeResponseHeaders(baseHeaders, 4631);
  check('回應 header 正規化：去 date、x-vercel-id 只核格式、埠換 <port>', !('date' in norm) && norm['x-vercel-id'] === '<dev1-id>' && norm['x-deploy'] === 'http://127.0.0.1:<port>');
  const snap = normalizeHandlerSnapshot({ names: ['host'], values: { host: '127.0.0.1:4632' }, sensitivePresent: [] }, 4632);
  check('handler header 正規化：埠換 <port>', snap.values.host === '127.0.0.1:<port>');

  const view = (overrides = {}) => ({ snapshot: { names: ['host'], values: { host: '127.0.0.1:1' }, sensitivePresent: [] }, outbound: [{ kind: 'yahoo-chart', status: 200 }], fakeCli: { spawned: 0, deltas: 0, done: false, killedAfter: null }, blocked: [], ...overrides });
  const side = (port, response, v = view()) => ({ port, response, view: v, views: [v], extraViews: [] });
  const ok = { status: 200, headers: { 'content-type': 'application/json' }, bodySha256: 'h1', lines: [] };
  check('完全相同判等價', compareCase({ id: 'x' }, side(1, ok), side(1, ok)).equal);
  check('狀態碼不同判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, { ...ok, status: 502 })).equal);
  check('body 不同判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, { ...ok, bodySha256: 'h2' })).equal);
  check('handler header 不同判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, ok, view({ snapshot: { names: ['host'], values: { host: 'evil' }, sensitivePresent: [] } }))).equal);
  check('核心 outbound 不同判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, ok, view({ outbound: [{ kind: 'yahoo-chart', status: 401 }] }))).equal);
  const handshakeB1 = view({ outbound: [{ kind: 'yahoo-cookie' }, { kind: 'yahoo-crumb' }, { kind: 'yahoo-chart', status: 200 }] });
  check('握手次數是預期差異（B1 握手、候選熱命中）', compareCase({ id: 'x', handshake: { cookie: 0, crumb: 0, chart: 1 } }, side(1, ok, handshakeB1), side(1, ok)).equal);
  check('候選握手次數不符預期判差異', !compareCase({ id: 'x', handshake: { cookie: 0, crumb: 0, chart: 1 } }, side(1, ok, handshakeB1), side(1, ok, handshakeB1)).equal);
  check('非 AI 案例出現 CLI 啟動判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, ok, view({ fakeCli: { spawned: 1, deltas: 0, done: true, killedAfter: null } }))).equal);
  check('出現封鎖事件判差異', !compareCase({ id: 'x' }, side(1, ok), side(1, ok, view({ blocked: ['child.netBlocked'] }))).equal);

  const cliView = fakeCli => view({ outbound: [], fakeCli });
  const cancelSpec = { id: 'c', ai: true, stream: true, abortAfterLines: 1 };
  const streamResp = { status: 200, headers: {}, lines: [{ t: 300, text: 'a' }] };
  check('取消結果判讀', cancelOutcome(cliView({ spawned: 1, deltas: 2, done: false, killedAfter: 1 })) === 'provider-killed-after-1'
    && cancelOutcome(cliView({ spawned: 1, deltas: 5, done: true, killedAfter: null })) === 'provider-completed'
    && cancelOutcome(cliView({ spawned: 1, deltas: 2, done: false, killedAfter: null })) === 'process-ended-after-2');
  check('B1 取消即停、候選跑完判退化', !compareCase(cancelSpec,
    side(1, streamResp, cliView({ spawned: 1, deltas: 1, done: false, killedAfter: 1 })),
    side(1, streamResp, cliView({ spawned: 1, deltas: 5, done: true, killedAfter: null }))).equal);
  check('兩邊都跑完不算退化', compareCase(cancelSpec,
    side(1, streamResp, cliView({ spawned: 1, deltas: 5, done: true, killedAfter: null })),
    side(1, streamResp, cliView({ spawned: 1, deltas: 5, done: true, killedAfter: null }))).equal);

  const streamSpec = { id: 's', ai: true, stream: true, flushCheck: true };
  const lines = [{ t: 300, text: 'a' }, { t: 1500, text: 'b' }];
  const flat = [{ t: 1500, text: 'a' }, { t: 1500, text: 'b' }];
  const aiView = cliView({ spawned: 1, deltas: 5, done: true, killedAfter: null });
  const streamOk = { status: 200, headers: {}, bodySha256: 'sb', lines };
  check('串流逐段送達判通過', compareCase(streamSpec, side(1, streamOk, aiView), side(1, streamOk, aiView)).equal);
  check('串流一次到齊判差異（沒有即時 flush）', !compareCase(streamSpec, side(1, streamOk, aiView), side(1, { ...streamOk, lines: flat }, aiView)).equal);
  check('串流內容相同但 body 不同判差異', !compareCase({ id: 's2', ai: true, stream: true }, side(1, streamOk, aiView), side(1, { ...streamOk, bodySha256: 'other' }, aiView)).equal);

  const multiSide = (symbols, extra = {}) => ({ port: 1, responses: symbols.map(s => ({ ...ok, metaSymbol: s })), views: symbols.map(() => view()), extraViews: [], ...extra });
  const concurrentSpec = { id: 'k', concurrent: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }] };
  check('併發回應各自對應 symbol 判通過', compareCase(concurrentSpec, multiSide(['AAPL', 'MSFT']), multiSide(['AAPL', 'MSFT'])).equal);
  check('併發串台判差異', !compareCase(concurrentSpec, multiSide(['AAPL', 'MSFT']), multiSide(['MSFT', 'MSFT'])).equal);
  const staleSpec = { id: 'g', staleGeneration: { slow: 'AMZN', fast: 'NVDA', after: 'MSFT' } };
  const staleSymbols = ['AMZN', 'NVDA', 'MSFT'];
  check('世代案例：順序成立且各自對應 symbol 判通過', compareCase(staleSpec, multiSide(staleSymbols, { sequenced: true }), multiSide(staleSymbols, { sequenced: true })).equal);
  check('世代案例：B 沒在 A 進行中送出判差異', !compareCase(staleSpec, multiSide(staleSymbols, { sequenced: true }), multiSide(staleSymbols, { sequenced: false })).equal);

  // 已知差異：長駐限流器在同一窗內沿用本機封鎖。
  const rlSpec = { id: 'rl', knownDifference: 'ephemeral-block' };
  const b1Asked = side(1, ok, view({ outbound: [{ kind: 'ratelimit', status: 200 }, { kind: 'yahoo-cookie' }, { kind: 'yahoo-crumb' }, { kind: 'yahoo-chart', status: 200 }] }));
  const blocked = compareCase(rlSpec, b1Asked, side(1, { ...ok, status: 429, bodySha256: 'rl' }, view({ outbound: [] })));
  check('已知差異：候選本機封鎖（429、無 outbound）判符合', blocked.equal && blocked.knownDifference.observed === 'blocked-locally');
  const rolled = compareCase(rlSpec, b1Asked, side(1, ok, view({ outbound: [{ kind: 'ratelimit', status: 200 }, { kind: 'yahoo-chart', status: 200 }] })));
  check('已知差異：跨窗後兩邊相同也判符合', rolled.equal && rolled.knownDifference.observed === 'window-rolled');
  const askedAgain = compareCase(rlSpec, b1Asked, side(1, { ...ok, status: 429, bodySha256: 'rl' }, view({ outbound: [{ kind: 'ratelimit', status: 200 }] })));
  check('已知差異：候選 429 卻又問了 Upstash 判差異', !askedAgain.equal);
}

// ---------- 7. 重載驗證的串流完成判定 ----------
{
  const line = obj => ({ t: 1, text: JSON.stringify(obj) });
  const full = { status: 200, lines: [line({ t: 'delta', text: 'a' }), line({ t: 'delta', text: 'b' }), line({ t: 'done', text: 'ab' })] };
  check('串流完整：片段數相符且最後是 done', streamCompleted(full, 2));
  check('串流被切斷：沒有 done 判未完成', !streamCompleted({ status: 200, lines: full.lines.slice(0, 2) }, 2));
  check('串流片段數不符判未完成', !streamCompleted(full, 3));
}
{
  // 步驟表的條件：判定器從 raw 重算，改檔步驟的預期不能只靠「兩邊相同」。
  const step = id => STEPS.find(s => s.id === id);
  const view = (status, bodyText = null) => ({ status, bodyText });
  check('重載步驟表：加密鑰那步要兩邊都 403', step('env-add-secret').checks([{ b1: view(403), c: view(403) }])['兩邊都因缺密鑰拒絕'] === true
    && step('env-add-secret').checks([{ b1: view(403), c: view(200) }])['兩邊都因缺密鑰拒絕'] === false);
  check('重載步驟表：改訊息那步要兩邊都拿到新訊息', step('edit-lib-message').checks([{ b1: view(400, 'x（重載測試）'), c: view(400, 'x') }])['兩邊都拿到新訊息'] === false);
  const line = obj => ({ t: 1, text: JSON.stringify(obj) });
  const full = { status: 200, lines: [...Array.from({ length: 25 }, (_, i) => line({ t: 'delta', text: String(i) })), line({ t: 'done', text: '' })] };
  const cut = { status: 200, lines: full.lines.slice(0, 17) };
  const streamChecks = (c, observed) => step('edit-during-stream').checks([{ b1: full, c }], observed);
  check('重載步驟表：候選串流被切斷、或改碼時機沒對上，都判不成立', streamChecks(cut, { editedAfterSecondDelta: true })['候選串流沒有被停用流程切斷'] === false
    && streamChecks(full, {})['改碼發生在串流進行中（候選已收到第 2 段）'] === false
    && Object.values(streamChecks(full, { editedAfterSecondDelta: true })).every(Boolean));
  check('重載比對：串流逐行內容不同判不一致', !sameOutcome({ status: 200, lines: [{ text: 'a' }] }, { status: 200, lines: [{ text: 'b' }] })
    && sameOutcome({ status: 200, lines: [{ text: 'a' }] }, { status: 200, lines: [{ text: 'a' }] }));
}

// ---------- 8. 共用小工具與原型報告檢查 ----------
{
  const fixtureEnv = probeEnv({ traceDir: 'T', fixture: { delayMs: 20, controlPath: 'C' } });
  const traceOnly = probeEnv({ traceDir: 'T' });
  check('探針環境：固定上游的變數一起出現；只開探針時只有 trace 目錄', fixtureEnv.PERF01_TRACE_DIR === 'T' && fixtureEnv.PERF01_FIXTURE === '1'
    && fixtureEnv.PERF01_FIXTURE_DELAY_MS === '20' && fixtureEnv.PERF01_FIXTURE_CONTROL === 'C' && Object.keys(traceOnly).join() === 'PERF01_TRACE_DIR');
  const controlPath = path.join(tmpRoot, 'control.json');
  const control = createFixtureControl(controlPath, { script: {}, ai: { deltas: 5 } });
  control.set();
  const first = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
  control.set({ ai: { deltas: 1 } });
  const second = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
  check('控制檔：每次 set 換 version、案例可覆蓋預設、不留暫存檔', first.version !== second.version && first.ai.deltas === 5
    && second.ai.deltas === 1 && !fs.existsSync(`${controlPath}.tmp`));
  check('入口設定：B1 綁全介面、候選只綁 127.0.0.1 且長駐', ENTRIES.b1.listen(4000) === '4000' && ENTRIES.c.listen(4000) === '127.0.0.1:4000'
    && !ENTRIES.b1.persistent && ENTRIES.c.persistent);
  const healthy = { enabled: true, takenOver: true, outsideForks: 0, orphans: [] };
  check('原型報告檢查：正常無問題；未接手、有旁路子程序、有殘留、缺報告都報', persistentProblems(healthy, 'x').length === 0
    && persistentProblems({ ...healthy, takenOver: false }, 'x').length === 1
    && persistentProblems({ ...healthy, outsideForks: 1 }, 'x').length === 1
    && persistentProblems({ ...healthy, orphans: [5] }, 'x').length === 1
    && persistentProblems(undefined, 'x').length === 1);
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
