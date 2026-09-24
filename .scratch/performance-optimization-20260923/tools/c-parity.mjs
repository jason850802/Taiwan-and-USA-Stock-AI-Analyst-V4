#!/usr/bin/env node
// 02 票：B1（vercel dev）與候選 C（vercel dev＋長駐原型）的 API 對等比對。
//
// 用法（repo 根目錄執行）：
//   node .scratch/performance-optimization-20260923/tools/c-parity.mjs --run-id <新代號> --port-base <連續 6 個未占用埠起點>
//   node .scratch/performance-optimization-20260923/tools/c-parity.mjs --verify <run-id>   （只重算判定）
//
// 同一份產品原始碼、同一份 .env、同一份固定上游控制檔；每個案例依序打 B1 與 C，比對狀態碼、正規化後的
// 回應 header、body、handler 實際收到的 header（guard／限流的輸入）與上游呼叫形狀。握手次數是長駐的
// 預期差異，另行對帳。三組設定：default（本機 .env 原樣）、secret（程序環境加測試用共享密鑰）、
// ratelimit（程序環境指向假 Upstash，驗限流放行／超限／故障 fail-open 與長駐後的本機封鎖）。
// 不打真上游（固定上游＋網路層封鎖）、不啟動真 AI（假 CLI）；證據寫 evidence/02/<run-id>/。
// exit 0＝全部等價（含已知差異符合預期）且對帳通過；1＝有非預期差異；2＝run 無效。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSISTENT, PRELOAD, claimRun, copyTrace, createFixtureControl, identity, identityAfter, persistentReport,
  probeEnv, sendRequest, sha256, sleep, startVercelDev, stopService, waitForTraceEvent,
} from './service-kit.mjs';
import {
  EVIDENCE_BASE, VERIFIER_SHA, identityProblems, parseArgs, persistentProblems, readTraceDir, scanSecrets, writeOnceOrCompare,
} from './verify-b1-breakdown.mjs';

const BASE_TICKET = '02';
const CANDIDATE_03_SOURCES = [
  'api/_lib/clientAbort.ts', 'api/_lib/http.cancel.test.ts', 'api/_lib/http.ts',
  'api/_lib/llm.ts', 'api/_lib/yahoo.handshake.test.ts', 'api/_lib/yahoo.ts',
  'api/finmind.ts', 'api/gemini-stream.test.ts', 'api/gemini-stream.ts',
  'api/gemini.ts', 'api/yahoo/chart.ts', 'api/yahoo/search.ts', 'vite.config.ts',
];
const candidateSourceHashes = () => Object.fromEntries(CANDIDATE_03_SOURCES.map(file =>
  [file, sha256(fs.readFileSync(path.join(process.cwd(), file)))]));
// 測試用共享密鑰與假 Upstash 憑證（皆非真秘密）：只用來驗守門與限流；證據只記「有沒有帶」。
const TEST_SHARED_SECRET = 'perf02-parity-test-secret';
const RATELIMIT_ENV = { UPSTASH_REDIS_REST_URL: 'https://perf02-fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'perf02-fixture-token' };
const FIXTURE_DELAY_MS = 20;
const TTL_JUMP_MS = 600_001;
const DEFAULT_AI = { deltas: 5, intervalMs: 300 };
const quote = symbol => `/api/yahoo/chart?${new URLSearchParams({ symbol, interval: '1d', range: '5d' })}`;
const aiBody = { prompt: '對等測試提示詞', systemInstruction: '對等測試系統指令', mode: 'fast' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ALLOWED_ORIGIN = 'http://localhost:3000';
// 握手案例用的三檔（台股兩檔＋美股一檔），併發時共用同一個握手世代。
const HANDSHAKE_TRIO = ['2317.TW', '2454.TW', 'TSLA'];
const aiStream = (id, ai) => ({ id, method: 'POST', path: '/api/gemini-stream', headers: JSON_HEADERS, body: JSON.stringify(aiBody), ai: true, stream: true, control: { ai } });

// 案例：control＝本案例的固定上游腳本；jumpClock 推進假時鐘（讓候選換新握手世代）。
export const CONTRACT_CASES = [
  { id: 'options-chart-allowed', method: 'OPTIONS', path: quote('2330.TW'), headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' } },
  { id: 'options-chart-evil-origin', method: 'OPTIONS', path: quote('2330.TW'), headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' } },
  { id: 'options-finmind', method: 'OPTIONS', path: '/api/finmind?dataset=TaiwanStockInfo&data_id=2330', headers: { Origin: ALLOWED_ORIGIN } },
  { id: 'options-gemini-stream', method: 'OPTIONS', path: '/api/gemini-stream', headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' } },
  { id: 'get-chart-referer-allowed', path: quote('2330.TW'), headers: { Referer: `${ALLOWED_ORIGIN}/` } },
  { id: 'get-chart-no-origin', path: quote('AAPL') },
  { id: 'get-chart-evil-origin', path: quote('2330.TW'), headers: { Origin: 'http://evil.example' } },
  { id: 'get-chart-evil-referer', path: quote('2330.TW'), headers: { Referer: 'http://evil.example/page' } },
  { id: 'get-chart-bad-range', path: '/api/yahoo/chart?symbol=2330.TW&interval=1d&range=1y' },
  { id: 'get-chart-missing-symbol', path: '/api/yahoo/chart?interval=1d&range=5d' },
  { id: 'get-chart-repeated-symbol', path: '/api/yahoo/chart?symbol=2330.TW&symbol=AAPL&interval=1d&range=5d' },
  { id: 'get-chart-encoded-fx', path: '/api/yahoo/chart?symbol=USDTWD%3DX&interval=1d&range=5d' },
  { id: 'get-chart-lowercase', path: quote('aapl') },
  { id: 'post-chart', method: 'POST', path: quote('2330.TW'), headers: JSON_HEADERS, body: '{}' },
  { id: 'get-chart-upstream-401-once', path: quote('MSFT'), control: { script: { 'yahoo-chart': [{ status: 401 }] } } },
  { id: 'get-chart-upstream-429-twice', path: quote('MSFT'), control: { script: { 'yahoo-chart': [{ status: 429 }, { status: 429 }] } } },
  { id: 'get-chart-upstream-500', path: quote('MSFT'), control: { script: { 'yahoo-chart': [{ status: 500 }] } } },
  { id: 'get-chart-not-found', path: quote('ZZZZ'), control: { script: { 'yahoo-chart': [{ body: 'notFound' }] } } },
  { id: 'get-chart-cookie-missing', path: quote('MSFT'), jumpClock: true, control: { script: { 'yahoo-cookie': [{ body: 'noCookie' }, { body: 'noCookie' }] } } },
  { id: 'get-chart-timeout', path: quote('NVDA'), control: { script: { 'yahoo-chart': [{ delayMs: 8600 }] } }, timeoutMs: 20_000 },
  { id: 'get-finmind-ok', path: '/api/finmind?dataset=TaiwanStockInfo&data_id=2330' },
  { id: 'get-finmind-bad-dataset', path: '/api/finmind?dataset=NotADataset' },
  { id: 'get-finmind-bad-date', path: '/api/finmind?dataset=TaiwanStockPrice&data_id=2330&start_date=2026-02-30' },
  { id: 'get-finmind-limit', path: '/api/finmind?dataset=TaiwanStockInfo&data_id=2330', control: { script: { finmind: [{ status: 402, body: 'limit' }] } } },
  { id: 'get-finmind-500', path: '/api/finmind?dataset=TaiwanStockInfo&data_id=2330', control: { script: { finmind: [{ status: 500 }] } } },
  { id: 'get-search-ok', path: '/api/yahoo/search?q=2330' },
  { id: 'unknown-route', path: '/api/nope' },
  { id: 'private-lib-route', path: '/api/_lib/guard' },
  { id: 'ts-extension-route', path: '/api/finmind.ts?dataset=TaiwanStockInfo&data_id=2330' },
  { id: 'trailing-slash-route', path: '/api/finmind/?dataset=TaiwanStockInfo&data_id=2330' },
  { id: 'get-gemini', path: '/api/gemini' },
  { id: 'post-gemini-bad-body', method: 'POST', path: '/api/gemini', headers: JSON_HEADERS, body: '{}' },
  { id: 'post-gemini-bad-json', method: 'POST', path: '/api/gemini', headers: JSON_HEADERS, body: '{not json' },
  { id: 'post-gemini-fake-cli', method: 'POST', path: '/api/gemini', headers: JSON_HEADERS, body: JSON.stringify(aiBody), ai: true },
  { id: 'post-gemini-is-error', method: 'POST', path: '/api/gemini', headers: JSON_HEADERS, body: JSON.stringify(aiBody), ai: true, control: { ai: { deltas: 1, intervalMs: 100, mode: 'isError' } } },
  // 即時 flush：假 CLI 每 300 ms 一段，首行要明顯早於末行。
  { ...aiStream('post-gemini-stream-fake-cli', DEFAULT_AI), flushCheck: true },
  // SSE 失敗出口：已寫出片段後才失敗 → 200＋error 行；還沒寫就失敗 → 對應狀態碼的 JSON。
  aiStream('post-gemini-stream-is-error-mid', { deltas: 2, intervalMs: 100, mode: 'isError' }),
  aiStream('post-gemini-stream-is-error-first', { deltas: 0, intervalMs: 100, mode: 'isError' }),
  aiStream('post-gemini-stream-auth-error', { deltas: 0, intervalMs: 100, mode: 'authError' }),
  aiStream('post-gemini-stream-no-result', { deltas: 2, intervalMs: 100, mode: 'noResult' }),
  aiStream('post-gemini-stream-spawn-error', { deltas: 0, intervalMs: 100, mode: 'spawnError' }),
  { ...aiStream('post-gemini-stream-cancel', DEFAULT_AI), abortAfterLines: 1, settleMs: 3000 },
  {
    id: 'post-gemini-large-body', method: 'POST', path: '/api/gemini', headers: JSON_HEADERS,
    body: JSON.stringify({ ...aiBody, prompt: 'x'.repeat(5 * 1024 * 1024) }), ai: true,
  },
  { id: 'concurrent-isolation', concurrent: ['2330.TW', 'AAPL', 'USDTWD=X'].map(symbol => ({ path: quote(symbol), symbol })) },
  // 握手：候選同一世代只握手一次，B1 每支都握手；回應本身必須一致。
  { id: 'hs-pending-join', jumpClock: true, concurrent: HANDSHAKE_TRIO.map(symbol => ({ path: quote(symbol), symbol })), handshake: { cookie: 1, crumb: 1, chart: 3 } },
  { id: 'hs-hot-hit', path: quote('2308.TW'), handshake: { cookie: 0, crumb: 0, chart: 1 } },
  { id: 'hs-ttl-expiry', jumpClock: true, path: quote('0050.TW'), handshake: { cookie: 1, crumb: 1, chart: 1 } },
  // 世代：三支同時握手後各自第一次 chart 都 401，只有第一支換新世代，其餘沿用 → 候選整組重握手一次（共 2 次）。
  {
    id: 'hs-concurrent-401', jumpClock: true,
    control: { script: Object.fromEntries(HANDSHAKE_TRIO.map(symbol => [`yahoo-chart:${symbol}`, [{ status: 401 }]])) },
    concurrent: HANDSHAKE_TRIO.map(symbol => ({ path: quote(symbol), symbol })), handshake: { cookie: 2, crumb: 2, chart: 6 },
  },
  // 遲到的 401 不能清掉新世代：A 的 chart 慢 1.5 秒才回 401；期間 B 的 401 已換新世代並重握手成功；
  // A 重試沿用新世代、不再握手，之後 Z 也熱命中。候選整組握手 2 次；遲到的 401 若清掉新世代會變 3 次。
  {
    id: 'hs-stale-generation-401', jumpClock: true,
    control: { script: { 'yahoo-chart:AMZN': [{ status: 401, delayMs: 1500 }], 'yahoo-chart:NVDA': [{ status: 401 }] } },
    staleGeneration: { slow: 'AMZN', fast: 'NVDA', after: 'MSFT' }, handshake: { cookie: 2, crumb: 2, chart: 5 },
  },
  // 先發的 A 進到 handler、開始握手（cookie 延遲 3 秒）後才送 B（候選會加入同一個 pending），再過 200 ms
  // 取消 A。取消時機以 trace 看到 A 進 handler 為準，兩個入口才公平（B1 子程序要先啟動約 2 秒）。
  // B 必須成功；候選整組只握手一次；A 被取消後的殘留上游工作，候選不得多於 B1。
  {
    id: 'hs-cancel-isolation', jumpClock: true, control: { script: { 'yahoo-cookie': [{ delayMs: 3000 }] } },
    cancelPair: { first: quote('AMZN'), second: quote('NVDA'), abortAfterHandlerMs: 200 }, settleMs: 4000,
    handshake: { cookie: 1, crumb: 1 },
  },
];

export const SECRET_CASES = [
  { id: 'secret-missing', path: quote('2330.TW') },
  { id: 'secret-wrong', path: quote('2330.TW'), headers: { 'X-Proxy-Secret': 'wrong-secret-value' } },
  { id: 'secret-correct', path: quote('2330.TW'), headers: { 'X-Proxy-Secret': TEST_SHARED_SECRET } },
  { id: 'secret-options-short-circuit', method: 'OPTIONS', path: quote('2330.TW'), headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' } },
];

export const RATELIMIT_CASES = [
  { id: 'rl-under', path: quote('2330.TW') },
  // AI 路由有兩個限流器：同一輪的兩個指令會合併成一次 pipeline。
  aiStream('rl-ai-under', DEFAULT_AI),
  { id: 'rl-unavailable', path: quote('2330.TW'), control: { script: { ratelimit: [{ status: 500 }] } } },
  // 超限前把假時鐘推到新一分鐘窗的起點：超限與下一案例一定落在同一個限流窗內。
  { id: 'rl-over', alignWindowMs: 60_000, path: quote('2330.TW'), control: { script: { ratelimit: [{ remaining: -1 }] } } },
  // 已知差異：同一窗內候選的長駐限流器沿用本機封鎖（不再問 Upstash、直接 429）；B1 每請求新程序會再問
  // 一次（假 Upstash 此時有額度 → 200）。與正式部署暖實例的行為一致，兩邊各自須符合預期形狀。
  { id: 'rl-after-block', path: quote('2330.TW'), knownDifference: 'ephemeral-block' },
];

// 回應 header 正規化：去掉每次都不同的 date；x-vercel-id 只核對格式；服務埠換成 <port>。
export function normalizeResponseHeaders(headers = {}, port) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key === 'date' || key === 'keep-alive') continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    out[key] = key === 'x-vercel-id' ? (/^dev1::/.test(text) ? '<dev1-id>' : text) : text.replaceAll(String(port), '<port>');
  }
  return out;
}

// handler 端 header 快照正規化：值裡的服務埠換成 <port>，trace 值不比。
export function normalizeHandlerSnapshot(snapshot, port) {
  if (!snapshot) return null;
  const values = Object.fromEntries(Object.entries(snapshot.values ?? {}).map(([key, value]) => [key, String(value).replaceAll(String(port), '<port>')]));
  return { names: snapshot.names, values, sensitivePresent: snapshot.sensitivePresent ?? [] };
}

// 一支請求在 trace 裡的樣子：handler 收到的 header、outbound 形狀、假 CLI 事件、中斷標記。
export function requestView(events, trace) {
  const mine = events.filter(ev => ev.trace === trace);
  const snapshot = mine.find(ev => ev.ev === 'child.reqHeaders') ?? null;
  const starts = mine.filter(ev => ev.ev === 'child.fetchStart');
  const outbound = starts.map(start => {
    const head = mine.find(ev => ev.ev === 'child.fetchHeaders' && ev.seq === start.seq && ev.pid === start.pid);
    const error = mine.find(ev => ev.ev === 'child.fetchError' && ev.seq === start.seq && ev.pid === start.pid);
    return { kind: start.kind, status: head?.status ?? null, error: error?.name ?? null };
  });
  const fake = mine.filter(ev => ev.ev.startsWith('child.fakeCli.'));
  return {
    snapshot: snapshot ? { names: snapshot.names, values: snapshot.values, sensitivePresent: snapshot.sensitivePresent } : null,
    outbound,
    fakeCli: {
      spawned: fake.filter(ev => ev.ev === 'child.fakeCli.spawn').length,
      deltas: fake.filter(ev => ev.ev === 'child.fakeCli.delta').length,
      done: fake.some(ev => ev.ev === 'child.fakeCli.done'),
      killedAfter: fake.find(ev => ev.ev === 'child.fakeCli.kill')?.emitted ?? null,
    },
    blocked: mine.filter(ev => ['child.aiBlocked', 'child.netBlocked', 'child.fetchBlocked'].includes(ev.ev)).map(ev => ev.ev),
    childAborted: mine.some(ev => ev.ev === 'child.aborted'),
  };
}

const countKind = (outbound, kind) => outbound.filter(o => o.kind === kind).length;
const handshakeCounts = outbound => ({
  cookie: countKind(outbound, 'yahoo-cookie'),
  crumb: countKind(outbound, 'yahoo-crumb'),
  chart: countKind(outbound, 'yahoo-chart'),
});
// 非握手的 outbound 形狀（chart／finmind／search／限流與狀態）：兩個入口必須一致。
const coreOutbound = outbound => outbound.filter(o => o.kind !== 'yahoo-cookie' && o.kind !== 'yahoo-crumb');

// 串流取消的實際結果：假 CLI 被 kill、跑完、或整個程序先結束（沒有 done 也沒有 kill）。
export function cancelOutcome(view) {
  if (view.fakeCli.killedAfter !== null) return `provider-killed-after-${view.fakeCli.killedAfter}`;
  if (view.fakeCli.done) return 'provider-completed';
  return `process-ended-after-${view.fakeCli.deltas}`;
}

// 已知差異「長駐限流器的本機封鎖」：B1 照常問 Upstash 並放行；候選在同一窗內直接 429、不再打任何上游。
// 若假時鐘剛好跨窗，候選也會放行，此時兩邊必須完全相同。
function checkEphemeralBlock(b1, c) {
  const diffs = [];
  const shape = (response, view) => ({ status: response.status, ratelimitCalls: countKind(view.outbound, 'ratelimit'), outbound: view.outbound.length });
  const sb = shape(b1.response, b1.view);
  const sc = shape(c.response, c.view);
  if (!(sb.status === 200 && sb.ratelimitCalls === 1)) diffs.push(`B1 應照常問限流並放行：${JSON.stringify(sb)}`);
  const blockedLocally = sc.status === 429 && sc.outbound === 0;
  const windowRolled = sc.status === 200 && b1.response.bodySha256 === c.response.bodySha256 && sc.ratelimitCalls === 1;
  if (!blockedLocally && !windowRolled) diffs.push(`候選應在本機封鎖（429、無 outbound）或跨窗後與 B1 相同：${JSON.stringify(sc)}`);
  return { diffs, knownDifference: { kind: 'ephemeral-block', b1: sb, c: sc, observed: blockedLocally ? 'blocked-locally' : (windowRolled ? 'window-rolled' : 'unexpected') } };
}

// 單一案例的比對；expectedHandshake 只約束候選，B1 的握手次數只記錄。
export function compareCase(spec, b1, c) {
  if (spec.knownDifference === 'ephemeral-block') {
    const { diffs, knownDifference } = checkEphemeralBlock(b1, c);
    return { id: spec.id, equal: diffs.length === 0, diffs, handshake: null, knownDifference };
  }
  const diffs = [];
  const multi = Array.isArray(b1.responses);
  const pairs = multi ? b1.responses.map((response, i) => [response, c.responses[i]]) : [[b1.response, c.response]];
  for (const [rb, rc] of pairs) {
    if (rb.status !== rc.status) diffs.push(`status ${rb.status}≠${rc.status}`);
    const hb = JSON.stringify(normalizeResponseHeaders(rb.headers, b1.port));
    const hc = JSON.stringify(normalizeResponseHeaders(rc.headers, c.port));
    if (!spec.abortAfterLines && hb !== hc) diffs.push(`response headers ${hb} ≠ ${hc}`);
    if (spec.stream) {
      const lb = JSON.stringify(rb.lines.map(line => line.text));
      const lc = JSON.stringify(rc.lines.map(line => line.text));
      if (lb !== lc) diffs.push(`stream lines ${lb} ≠ ${lc}`);
    }
    if (!spec.abortAfterLines && rb.bodySha256 !== rc.bodySha256) diffs.push(`body ${rb.bodySha256}≠${rc.bodySha256}`);
  }
  const viewsB = multi ? b1.views : [b1.view];
  const viewsC = multi ? c.views : [c.view];
  viewsB.forEach((vb, i) => {
    const vc = viewsC[i];
    const sb = JSON.stringify(normalizeHandlerSnapshot(vb.snapshot, b1.port));
    const sc = JSON.stringify(normalizeHandlerSnapshot(vc.snapshot, c.port));
    if (sb !== sc) diffs.push(`handler headers ${sb} ≠ ${sc}`);
    const ob = JSON.stringify(coreOutbound(vb.outbound));
    const oc = JSON.stringify(coreOutbound(vc.outbound));
    if (ob !== oc) diffs.push(`outbound ${ob} ≠ ${oc}`);
    if (vb.blocked.length || vc.blocked.length) diffs.push(`出現封鎖事件 B1=${vb.blocked} C=${vc.blocked}`);
    if (spec.ai && (vb.fakeCli.spawned !== 1 || vc.fakeCli.spawned !== 1)) diffs.push(`假 CLI 啟動次數 B1=${vb.fakeCli.spawned} C=${vc.fakeCli.spawned}`);
    if (!spec.ai && (vb.fakeCli.spawned || vc.fakeCli.spawned)) diffs.push('非 AI 案例出現 CLI 啟動');
  });
  // 握手對帳涵蓋被取消的請求：加入 pending 的請求自己的 trace 裡沒有 cookie／crumb。
  const allB = [...viewsB, ...(b1.extraViews ?? [])];
  const allC = [...viewsC, ...(c.extraViews ?? [])];
  const handshake = {
    b1: handshakeCounts(allB.flatMap(v => v.outbound)),
    c: handshakeCounts(allC.flatMap(v => v.outbound)),
  };
  if (spec.handshake) {
    for (const [kind, expected] of Object.entries(spec.handshake)) {
      if (handshake.c[kind] !== expected) diffs.push(`候選握手對帳 ${kind}=${handshake.c[kind]}（預期 ${expected}）`);
    }
  }
  const extra = {};
  if (spec.cancelPair) {
    if (!b1.reachedHandler || !c.reachedHandler) diffs.push(`取消案例的 A 未進 handler（B1 ${b1.reachedHandler}、候選 ${c.reachedHandler}），取消時機不公平`);
    // 被取消的 A 之後仍做了多少上游工作：候選不得多於 B1。
    const residual = views => views.reduce((sum, v) => sum + coreOutbound(v.outbound).length, 0);
    extra.residual = { b1: residual(b1.extraViews ?? []), c: residual(c.extraViews ?? []) };
    if (extra.residual.c > extra.residual.b1) diffs.push(`取消後殘留工作多於 B1：B1 ${extra.residual.b1}、候選 ${extra.residual.c}`);
  }
  if (spec.staleGeneration && (!b1.sequenced || !c.sequenced)) {
    diffs.push(`世代案例的 B 沒有在 A 的慢速 chart 進行中送出（B1 ${b1.sequenced}、候選 ${c.sequenced}）`);
  }
  if (spec.abortAfterLines) {
    extra.cancel = { b1: cancelOutcome(b1.view), c: cancelOutcome(c.view) };
    // 取消後的上游工作：候選不得比 B1 留下更多（B1 若提早停止而候選跑完，就是退化）。
    const worse = extra.cancel.b1 !== 'provider-completed' && extra.cancel.c === 'provider-completed';
    if (worse) diffs.push(`取消退化：B1 ${extra.cancel.b1}，候選 ${extra.cancel.c}`);
  }
  if (spec.flushCheck) {
    const timing = response => ({ firstLineMs: response.lines[0]?.t ?? null, lastLineMs: response.lines.at(-1)?.t ?? null });
    extra.streamTiming = { b1: timing(b1.response), c: timing(c.response) };
    // 即時 flush：首行要明顯早於最後一行（假 CLI 每 300 ms 一段，共 5 段）。
    for (const [name, { firstLineMs, lastLineMs }] of [['B1', extra.streamTiming.b1], ['C', extra.streamTiming.c]]) {
      if (firstLineMs === null || lastLineMs === null || lastLineMs - firstLineMs < 600) diffs.push(`${name} 串流沒有逐段送達（首行 ${firstLineMs}、末行 ${lastLineMs}）`);
    }
  }
  const symbols = expectedSymbols(spec);
  if (symbols) {
    for (const [name, side] of [['B1', b1], ['C', c]]) {
      side.responses.forEach((response, i) => {
        if (response.status === 200 && response.metaSymbol !== symbols[i].toUpperCase()) diffs.push(`${name} 串台：${symbols[i]} 收到 ${response.metaSymbol}`);
      });
    }
  }
  return { id: spec.id, equal: diffs.length === 0, diffs, handshake, ...extra };
}

// 多請求案例每支回應應屬於哪個 symbol（用來抓併發串台）。
function expectedSymbols(spec) {
  if (spec.concurrent) return spec.concurrent.map(item => item.symbol);
  if (spec.staleGeneration) return [spec.staleGeneration.slow, spec.staleGeneration.fast, spec.staleGeneration.after];
  return null;
}

function metaSymbolOf(response) {
  try {
    return JSON.parse(response.bodyText ?? '').chart?.result?.[0]?.meta?.symbol ?? null;
  } catch {
    return null;
  }
}

async function runCase(spec, side, ctx) {
  const trace = n => `${ctx.runId}-${side.label}-${spec.id}${n === undefined ? '' : `-${n}`}`;
  const send = (route, t, extra = {}) => sendRequest({ port: side.port, route, trace: t, ...extra });
  if (spec.concurrent) {
    const responses = await Promise.all(spec.concurrent.map((item, i) => send(item.path, trace(i))));
    responses.forEach(response => { response.metaSymbol = metaSymbolOf(response); });
    return { responses, traces: responses.map((_, i) => trace(i)) };
  }
  if (spec.staleGeneration) {
    const { slow, fast, after } = spec.staleGeneration;
    const a = send(quote(slow), trace('a'));
    // A 的慢速 chart 已送出才送 B：B 的 401 一定在 A 的 401 回來之前發生。
    const sequenced = await waitForTraceEvent(side.traceDir, ev => ev.trace === trace('a') && ev.ev === 'child.fetchStart' && ev.kind === 'yahoo-chart');
    const rb = await send(quote(fast), trace('b'));
    const ra = await a;
    const rz = await send(quote(after), trace('z'));
    const responses = [ra, rb, rz];
    responses.forEach(response => { response.metaSymbol = metaSymbolOf(response); });
    return { responses, traces: [trace('a'), trace('b'), trace('z')], sequenced };
  }
  if (spec.cancelPair) {
    const { first, second, abortAfterHandlerMs } = spec.cancelPair;
    const abortRef = {};
    const a = send(first, trace('a'), { abortRef });
    const reachedHandler = await waitForTraceEvent(side.traceDir, ev => ev.trace === trace('a') && ev.ev === 'child.recv' && ev.layer === 'handler');
    const b = send(second, trace('b'));
    await sleep(abortAfterHandlerMs);
    abortRef.abort?.();
    const [ra, rb] = await Promise.all([a, b]);
    rb.metaSymbol = metaSymbolOf(rb);
    if (spec.settleMs) await sleep(spec.settleMs);
    return { response: rb, first: ra, reachedHandler, traces: [trace('b')], extraTraces: [trace('a')] };
  }
  const response = await send(spec.path, trace(), {
    method: spec.method, headers: spec.headers, body: spec.body ?? null,
    stream: Boolean(spec.stream), abortAfterLines: spec.abortAfterLines ?? 0, timeoutMs: spec.timeoutMs,
  });
  if (spec.settleMs) await sleep(spec.settleMs);
  return { response, traces: [trace()] };
}

async function startPair({ config, ports, runtimeDir, controlPath, env, running }) {
  const services = {};
  for (const [label, port, requires] of [
    ['b1', ports.b1, [PRELOAD]],
    ['c', ports.c, [PERSISTENT, PRELOAD]],
  ]) {
    const traceDir = path.join(runtimeDir, `${config}-${label}-trace`);
    fs.mkdirSync(traceDir, { recursive: true });
    const logFile = path.join(runtimeDir, `${config}-${label}-vercel.log`);
    const record = { label, port, svc: null, traceDir, logFile };
    services[label] = record;
    // 兩邊都只綁 127.0.0.1：比對只變動「長駐」一個因素（日常 B1 綁全介面時，handler 看到的 IP
    // 會是 ::ffff:127.0.0.1 寫法；那是綁定位址的差異，另於報告記錄）。
    await startVercelDev({
      label: `${config}/${label}`,
      port,
      runtimeDir,
      logFile,
      requires,
      env: { ...env, ...probeEnv({ traceDir, fixture: { delayMs: FIXTURE_DELAY_MS, controlPath } }) },
      onStarted: svc => {
        record.svc = svc;
        running.push(svc);
      },
    });
  }
  return services;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const ticket = args['candidate-03'] ? '03' : BASE_TICKET;
  const runId = args['run-id'];
  const portBase = Number(args['port-base']);
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65000) throw new Error('需要 --port-base');
  const { evidenceDir, runtimeDir } = claimRun({ ticket, runId });
  const controlPath = path.join(runtimeDir, 'control.json');
  const control = createFixtureControl(controlPath, { script: {}, delayMs: {}, ai: DEFAULT_AI });
  // 假時鐘只往前推：TTL 案例跳過 10 分鐘，限流案例對齊到新的一分鐘窗。
  let clockOffsetMs = 0;
  const setControl = (extra = {}) => control.set({ clockOffsetMs, ...extra });
  setControl();

  const raw = {
    schemaVersion: 1,
    runId,
    ticket,
    kind: 'parity',
    createdAt: new Date().toISOString(),
    identity: { ...identity('c'), parityTool: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      candidateSources: ticket === '03' ? candidateSourceHashes() : null },
    protocol: { bind: '127.0.0.1', fixtureDelayMs: FIXTURE_DELAY_MS, ttlJumpMs: TTL_JUMP_MS, ai: DEFAULT_AI, verifierSha: VERIFIER_SHA },
    configs: [],
    aborted: null,
  };
  const running = [];
  try {
    const product = raw.identity.product;
    if (ticket === '02' && (!product.equalsBaselineCommit || product.untracked.length)) {
      throw new Error('產品樹不等於 30dfdb2，拒絕比對');
    }
    if (ticket === '03' && (product.missing.length || product.untracked.length)) {
      throw new Error('03 候選產品樹有缺檔或未追蹤產品檔，拒絕比對');
    }
    const plan = [
      { config: 'default', ports: { b1: portBase, c: portBase + 1 }, env: {}, cases: CONTRACT_CASES },
      { config: 'secret', ports: { b1: portBase + 2, c: portBase + 3 }, env: { PROXY_SHARED_SECRET: TEST_SHARED_SECRET }, cases: SECRET_CASES },
      { config: 'ratelimit', ports: { b1: portBase + 4, c: portBase + 5 }, env: RATELIMIT_ENV, cases: RATELIMIT_CASES },
    ];
    for (const step of plan) {
      const configRecord = { config: step.config, services: [], cases: [] };
      raw.configs.push(configRecord);
      const services = await startPair({ config: step.config, ports: step.ports, runtimeDir, controlPath, env: step.env, running });
      for (const spec of step.cases) {
        if (spec.jumpClock) clockOffsetMs += TTL_JUMP_MS;
        if (spec.alignWindowMs) {
          // 假時鐘移到下一個窗起點後 1 秒（只往前推）；B1 與候選讀同一份控制檔，時鐘一致。
          const fakeNow = Date.now() + clockOffsetMs;
          clockOffsetMs += spec.alignWindowMs - (fakeNow % spec.alignWindowMs) + 1000;
        }
        setControl(spec.control ?? {});
        const b1 = await runCase(spec, services.b1, { runId: `${runId}-${step.config}` });
        setControl(spec.control ?? {});
        const c = await runCase(spec, services.c, { runId: `${runId}-${step.config}` });
        configRecord.cases.push({ id: spec.id, b1, c });
      }
      setControl();
      for (const s of Object.values(services)) {
        await stopService(s.svc);
        if (s.label === 'c') configRecord.persistent = persistentReport(s.logFile);
        copyTrace(s.traceDir, path.join(evidenceDir, 'trace', `${step.config}-${s.label}`));
      }
      // 停止後才記錄服務狀態（含 stopped 旗標）。
      configRecord.services = Object.values(services).map(s => ({ label: s.label, ...s.svc }));
      running.length = 0;
    }
  } catch (error) {
    raw.aborted = error.message;
  } finally {
    for (const svc of running) await stopService(svc);
    raw.identityAfter = identityAfter();
    if (ticket === '03') raw.identityAfter.candidateSources = candidateSourceHashes();
    raw.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }
  return verifyParity(evidenceDir);
}

// 判定：只讀 raw＋trace 重算每個案例的比對，寫一次摘要（綁本工具與判定器雜湊）。
export function verifyParity(evidenceDir, { secrets } = {}) {
  const raw = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'raw.json'), 'utf8'));
  const events = readTraceDir(path.join(evidenceDir, 'trace'));
  const problems = [];
  if (raw.aborted) problems.push(`run 中止：${raw.aborted}`);
  problems.push(...identityProblems(raw.identity, raw.identityAfter));
  if (raw.ticket === '03' && JSON.stringify(raw.identity.candidateSources) !== JSON.stringify(raw.identityAfter.candidateSources)) {
    problems.push('03 候選來源在執行期間改變');
  }
  const specs = new Map([...CONTRACT_CASES, ...SECRET_CASES, ...RATELIMIT_CASES].map(spec => [spec.id, spec]));
  const results = [];
  for (const config of raw.configs) {
    const ports = Object.fromEntries(config.services.map(s => [s.label, s.port]));
    for (const svc of config.services) {
      if (svc.ownedPid !== svc.listenerPid) problems.push(`${config.config}/${svc.label} listener PID 非 owned`);
      if (!svc.stopped) problems.push(`${config.config}/${svc.label} 未確認停止`);
    }
    problems.push(...persistentProblems(config.persistent, config.config));
    for (const record of config.cases) {
      const spec = specs.get(record.id);
      if (!spec) {
        problems.push(`未知案例 ${record.id}`);
        continue;
      }
      const side = (label, data) => {
        const scoped = events.filter(ev => ev.src === `${config.config}-${label}`);
        return {
          port: ports[label],
          response: data.response,
          responses: data.responses,
          view: data.traces?.length === 1 && !data.responses ? requestView(scoped, data.traces[0]) : null,
          views: data.traces?.map(trace => requestView(scoped, trace)) ?? [],
          extraViews: data.extraTraces?.map(trace => requestView(scoped, trace)) ?? [],
          reachedHandler: data.reachedHandler,
          sequenced: data.sequenced,
        };
      };
      results.push({ config: config.config, ...compareCase(spec, side('b1', record.b1), side('c', record.c)) });
    }
  }
  const leaks = scanSecrets(evidenceDir, secrets);
  if (leaks.length) problems.push(`證據疑似含秘密：${leaks.map(l => `${l.file}:${l.key}`).join(',')}`);
  const mismatches = results.filter(r => !r.equal);
  const summary = {
    runId: raw.runId,
    toolSha: raw.identity?.parityTool ?? null,
    cases: results.length,
    equal: results.length - mismatches.length,
    mismatches: mismatches.map(r => ({ config: r.config, id: r.id, diffs: r.diffs })),
    knownDifferences: results.filter(r => r.knownDifference).map(r => ({ config: r.config, id: r.id, ...r.knownDifference })),
    cancel: results.filter(r => r.cancel).map(r => ({ config: r.config, id: r.id, ...r.cancel, residual: r.residual ?? null })),
    streamTiming: results.filter(r => r.streamTiming).map(r => ({ config: r.config, id: r.id, ...r.streamTiming })),
    handshake: results.filter(r => r.handshake && (r.id.startsWith('hs-') || /upstream|cookie|timeout/.test(r.id))).map(r => ({ config: r.config, id: r.id, ...r.handshake })),
    results,
    problems,
  };
  const toolSha = sha256(fs.readFileSync(fileURLToPath(import.meta.url))).slice(0, 12);
  writeOnceOrCompare(path.join(evidenceDir, `parity-summary-${toolSha}-${VERIFIER_SHA}.json`), `${JSON.stringify(summary, null, 2)}\n`, problems);
  console.log(JSON.stringify({ runId: summary.runId, cases: summary.cases, equal: summary.equal, mismatches: summary.mismatches, knownDifferences: summary.knownDifferences, cancel: summary.cancel, problems }, null, 2));
  if (problems.length) return 2;
  return mismatches.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const run = args.verify ? Promise.resolve(verifyParity(path.join(EVIDENCE_BASE, args['candidate-03'] ? '03' : BASE_TICKET, args.verify))) : main();
  run.then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
