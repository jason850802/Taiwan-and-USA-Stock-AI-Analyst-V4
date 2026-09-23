#!/usr/bin/env node
// 01 票判定器：只讀 evidence/01/<run-id>/ 的 raw 與 trace，重算分段、檢查完整性、對凍結目標判紅。
// exit 0＝有效且達標；1＝有效但未達標（判紅）；2＝run 無效或證據不完整。
// 摘要檔名綁定本判定器內容雜湊（summary-<sha>.json／.md）：同版重播只比對不覆寫；
// 判定器修正後另寫新版摘要，raw 與舊版摘要都保留。
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const PLAN_DIR = path.resolve(TOOLS, '..');
export const ROOT = path.resolve(PLAN_DIR, '..', '..');
export const EVIDENCE_ROOT = path.join(PLAN_DIR, 'evidence', '01');
export const VERIFIER_SHA = createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);

// 凍結目標（PLAN 第 3 節；01 票凍結，C 票判定沿用，不得在看候選成績後調低）。
export const TARGETS = Object.freeze({
  optionsWarmMedianMs: 150,
  optionsEachWarmMaxMs: 500,
  fixedGetLocalMedianMs: 200,
});

// 驗收協定第 3 節第 5 點：跳過長駐分支的必要條件。
export const SKIP_RULE = Object.freeze({
  dispatchMaxMs: 500,
  dispatchMaxShare: 0.2,
  handshakeMaxMs: 100,
  handshakeMaxShare: 0.1,
});

export const round = value => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function stats(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { n: 0, min: null, median: null, max: null };
  return {
    n: finite.length,
    min: round(Math.min(...finite)),
    median: round(median(finite)),
    max: round(Math.max(...finite)),
  };
}

// trace/<start 標籤>/<role>-<pid>.jsonl；src＝start 標籤。
// Windows 會在同一次 start 內重用 PID：先後兩個子程序寫進同一檔。同 PID 的程序不會同時存在、
// appendFileSync 依序落檔，所以依主執行緒的 child.boot（ipc 非 false）切成程序實例 inst。
export function readTraceDir(traceDir) {
  const events = [];
  if (!fs.existsSync(traceDir)) return events;
  for (const src of fs.readdirSync(traceDir).sort()) {
    const srcDir = path.join(traceDir, src);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    for (const name of fs.readdirSync(srcDir).sort()) {
      const match = name.match(/^(parent|child)-(\d+)\.jsonl$/);
      if (!match) continue;
      const lines = fs.readFileSync(path.join(srcDir, name), 'utf8').split('\n').filter(Boolean);
      let instance = 0;
      for (const [index, line] of lines.entries()) {
        const ev = JSON.parse(line);
        if (match[1] === 'child' && ev.ev === 'child.boot' && ev.ipc !== false && index > 0) instance += 1;
        events.push({ src, role: match[1], inst: `${src}/${name}#${instance}`, ...ev });
      }
    }
  }
  return events;
}

const findEv = (list, predicate) => list.find(predicate) ?? null;
const span = (from, to) => (from && to ? to.t - from.t : null);
// fork() 在負載下同步耗時可達上百 ms，子程序時鐘此時已起算；父程序區間一律從 fork 呼叫開始算。
const forkStartOf = fork => (fork ? { ...fork, t: fork.t - (fork.forkCallMs ?? 0) } : null);

// 單一 trace 的分段：父程序與子程序各用自己的時鐘，只輸出區間；跨程序只列未歸屬差額。
export function segmentTrace(sample, events) {
  const trace = sample.trace;
  const parentEvents = events.filter(ev => ev.role === 'parent' && ev.trace === trace);
  const recv = findEv(parentEvents, ev => ev.ev === 'parent.recv');
  const fork = findEv(parentEvents, ev => ev.ev === 'parent.fork');
  const childReady = findEv(parentEvents, ev => ev.ev === 'parent.childReady');
  const proxyReq = findEv(parentEvents, ev => ev.ev === 'parent.proxyReq');
  const proxyRes = findEv(parentEvents, ev => ev.ev === 'parent.proxyRes');
  const parentHead = findEv(parentEvents, ev => ev.ev === 'parent.writeHead');
  const missing = [];
  for (const [name, ev] of Object.entries({ recv, fork, childReady, proxyReq, proxyRes, parentHead })) {
    if (!ev) missing.push(`parent.${name}`);
  }
  const childPid = fork?.childPid ?? null;
  const src = recv?.src ?? null;
  // 以「收到本 trace 的子程序實例」連結啟動事件，且該實例 PID 必須等於父程序 fork 出的 PID。
  const servedBy = events.find(ev => ev.role === 'child' && ev.ev === 'child.recv' && ev.trace === trace && ev.src === src);
  if (servedBy && childPid !== null && servedBy.pid !== childPid) missing.push('child.pidMatchesFork');
  const inst = servedBy?.inst ?? null;
  const childEvents = inst ? events.filter(ev => ev.inst === inst) : [];
  // 舊版探針會在 tsx loader worker 再記一筆無 IPC 的 boot；一律取主執行緒（有 IPC）那筆。
  const boots = childEvents.filter(ev => ev.ev === 'child.boot');
  const boot = boots.find(ev => ev.ipc !== false) ?? null;
  const listen1 = findEv(childEvents, ev => ev.ev === 'child.listening' && ev.seq === 1);
  const listen2 = findEv(childEvents, ev => ev.ev === 'child.listening' && ev.seq === 2);
  const ready = findEv(childEvents, ev => ev.ev === 'child.ready');
  const devRecv = findEv(childEvents, ev => ev.ev === 'child.recv' && ev.layer === 'devProxy' && ev.trace === trace);
  const handlerRecv = findEv(childEvents, ev => ev.ev === 'child.recv' && ev.layer === 'handler' && ev.trace === trace);
  const handlerHead = findEv(childEvents, ev => ev.ev === 'child.writeHead' && ev.layer === 'handler' && ev.trace === trace);
  const devHead = findEv(childEvents, ev => ev.ev === 'child.writeHead' && ev.layer === 'devProxy' && ev.trace === trace);
  for (const [name, ev] of Object.entries({ boot, listen1, listen2, ready, devRecv, handlerRecv, handlerHead, devHead })) {
    if (!ev) missing.push(`child.${name}`);
  }

  const fetchStarts = childEvents.filter(ev => ev.ev === 'child.fetchStart' && ev.trace === trace);
  const outbound = fetchStarts.map(start => {
    const headers = findEv(childEvents, ev => ev.ev === 'child.fetchHeaders' && ev.seq === start.seq);
    const body = findEv(childEvents, ev => ev.ev === 'child.fetchBody' && ev.seq === start.seq);
    const error = findEv(childEvents, ev => ev.ev === 'child.fetchError' && ev.seq === start.seq);
    const blocked = findEv(childEvents, ev => ev.ev === 'child.fetchBlocked' && ev.seq === start.seq);
    return {
      kind: start.kind,
      symbol: start.symbol ?? null,
      dataset: start.dataset ?? null,
      status: headers?.status ?? null,
      fixture: headers?.fixture ?? null,
      fixtureWaitMs: headers?.fixtureWaitMs ?? null,
      headersMs: span(start, headers),
      bodyEndMs: span(start, body),
      error: error?.name ?? null,
      blocked: Boolean(blocked),
      startT: start.t,
      endT: (body ?? headers ?? start).t,
    };
  });
  const lastOut = outbound.length ? outbound.reduce((a, b) => (a.endT > b.endT ? a : b)) : null;
  const cookie = outbound.find(o => o.kind === 'yahoo-cookie');
  const crumb = outbound.find(o => o.kind === 'yahoo-crumb');
  const chart = outbound.find(o => o.kind === 'yahoo-chart');

  const clientTtfb = sample.headersMs - sample.startMs;
  const parentTotal = span(recv, parentHead);
  const childService = span(devRecv, devHead);
  const forkStart = forkStartOf(fork);
  return {
    trace,
    src,
    childPid,
    childInstance: inst,
    missing,
    workerBootEvents: boots.filter(ev => ev.ipc === false).length,
    parent: {
      preForkMs: span(recv, forkStart),
      forkCallMs: fork?.forkCallMs ?? null,
      forkToChildReadyMs: span(forkStart, childReady),
      readyToProxyMs: span(childReady, proxyReq),
      proxyRoundTripMs: span(proxyReq, proxyRes),
      proxyResToClientHeadMs: span(proxyRes, parentHead),
      totalMs: parentTotal,
    },
    child: {
      bootToPreloadMs: boot ? boot.t : null,
      preloadToDevServerMs: span(boot, listen1),
      devServerToHandlerLoadedMs: span(listen1, listen2),
      handlerLoadedToReadyMs: span(listen2, ready),
      startupSinceTimeOriginMs: ready ? ready.t : null,
      devProxyToHandlerMs: span(devRecv, handlerRecv),
      handlerBeforeFirstOutboundMs: fetchStarts.length ? span(handlerRecv, fetchStarts[0]) : null,
      handlerAfterLastOutboundMs: lastOut && handlerHead ? handlerHead.t - lastOut.endT : null,
      handlerTotalMs: span(handlerRecv, handlerHead),
      handlerHeadToDevHeadMs: span(handlerHead, devHead),
      serviceTotalMs: childService,
    },
    outbound: outbound.map(({ startT, endT, ...rest }) => rest),
    handshake: {
      ownHandshake: Boolean(cookie && crumb),
      cookieMs: cookie?.bodyEndMs ?? cookie?.headersMs ?? null,
      crumbMs: crumb?.bodyEndMs ?? crumb?.headersMs ?? null,
      cookieToCrumbEndMs: cookie && crumb ? (crumb.bodyEndMs ?? crumb.headersMs) + (crumb.startT - cookie.startT) : null,
      chartMs: chart?.bodyEndMs ?? chart?.headersMs ?? null,
    },
    fixtureWaitTotalMs: outbound.reduce((sum, o) => sum + (o.fixtureWaitMs ?? 0), 0),
    unattributed: {
      clientTtfbMinusParentMs: parentTotal === null ? null : clientTtfb - parentTotal,
      proxyRoundTripMinusChildServiceMs: span(proxyReq, proxyRes) !== null && childService !== null
        ? span(proxyReq, proxyRes) - childService
        : null,
      forkToReadyMinusChildStartupMs: span(forkStart, childReady) !== null && ready ? span(forkStart, childReady) - ready.t : null,
    },
  };
}

const ttfb = sample => sample.headersMs - sample.startMs;

function secretValues() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return [];
  return fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .map(line => line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map(([, key, value]) => ({ key, value: value.trim().replace(/^['"]|['"]$/g, '') }))
    .filter(entry => entry.value.length >= 6);
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// 證據不得含 .env 值、crumb／token 查詢或 cookie 值；只回報命中的鍵名與檔案數，不回報值。
export function scanSecrets(dir, secrets = secretValues()) {
  const hits = [];
  for (const file of listFiles(dir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { key, value } of secrets) {
      if (text.includes(value)) hits.push({ file: path.basename(file), key });
    }
    if (/[?&](crumb|token)=/i.test(text)) hits.push({ file: path.basename(file), key: 'query-credential' });
    if (/"cookie"\s*:/i.test(text) || /set-cookie/i.test(text)) hits.push({ file: path.basename(file), key: 'cookie-field' });
  }
  return hits;
}

function checkIdentity(raw, problems) {
  const id = raw.identity;
  if (!id) {
    problems.push('缺 identity');
    return;
  }
  if (!id.product?.equalsHead) problems.push('產品樹與 HEAD 不一致');
  if (!id.product?.equalsBaselineCommit) problems.push('產品樹與 30dfdb2 產品內容不一致');
  if (id.product?.untracked?.length) problems.push(`產品目錄有未追蹤檔：${id.product.untracked.length}`);
  const ports = [];
  for (const start of raw.starts ?? []) {
    for (const svc of start.services ?? []) {
      ports.push(svc.port);
      if (svc.ownedPid !== svc.listenerPid) problems.push(`${start.label}/${svc.name} listener PID 非 owned（${svc.ownedPid}≠${svc.listenerPid}）`);
      if (!svc.ready) problems.push(`${start.label}/${svc.name} 未就緒`);
      if (!svc.stopped) problems.push(`${start.label}/${svc.name} 未確認停止`);
    }
  }
  if (new Set(ports).size !== ports.length) problems.push('服務埠重複使用');
  // 服務前後核對身分：run 結束時重算的 HEAD、產品樹與工具雜湊必須和開始時相同。
  const after = raw.identityAfter;
  if (!after) {
    problems.push('缺 identityAfter（結束時身分未核對）');
  } else {
    if (after.head !== id.git?.head) problems.push('run 期間 HEAD 改變');
    if (after.productSha256 !== id.product?.aggregateSha256) problems.push('run 期間產品樹改變');
    if (JSON.stringify(after.tools) !== JSON.stringify(id.tools)) problems.push('run 期間工具檔改變');
  }
}

function summarizeOptions(raw, events, problems) {
  const out = {};
  const samples = raw.samples.filter(s => s.phase === 'options');
  for (const s of samples) {
    if (s.status !== 204) problems.push(`OPTIONS 非 204：${s.trace} status=${s.status}`);
  }
  const groups = {};
  for (const s of samples) {
    const key = `${s.traced ? 'traced' : 'plain'}|${s.path}|${s.routeKey}|${s.temp}`;
    (groups[key] ??= []).push(ttfb(s));
  }
  for (const [key, values] of Object.entries(groups)) out[key] = stats(values);

  // 直連樣本的 TTFB：traced 決定是否注入探針，temp 是 cold／warm。
  const directTtfb = (traced, routeKey, temp) => samples
    .filter(s => s.traced === traced && s.path === 'direct' && s.routeKey === routeKey && s.temp === temp)
    .map(ttfb);
  // 正式成績：未注入探針的 plain start、直連；每路由 warm 中位數與每筆上限。
  const verdict = {};
  for (const routeKey of ['yahoo-chart', 'finmind']) {
    const warm = directTtfb(false, routeKey, 'warm');
    const cold = directTtfb(false, routeKey, 'cold');
    const warmMedian = median(warm);
    const warmMax = warm.length ? Math.max(...warm) : null;
    verdict[routeKey] = {
      warm: stats(warm),
      cold: stats(cold),
      medianPass: warmMedian !== null && warmMedian <= TARGETS.optionsWarmMedianMs,
      eachPass: warmMax !== null && warmMax <= TARGETS.optionsEachWarmMaxMs,
    };
  }
  // OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight，經 Vite 的 OPTIONS 不到後端。
  // 探針開銷：traced 與 plain 的直連 warm 中位數差（不同 start，僅作量級參考）。
  const overhead = {};
  for (const routeKey of ['yahoo-chart', 'finmind']) {
    const plain = median(directTtfb(false, routeKey, 'warm'));
    const traced = median(directTtfb(true, routeKey, 'warm'));
    overhead[routeKey] = round(traced !== null && plain !== null ? traced - plain : null);
  }
  const tracedSegments = samples.filter(s => s.traced).map(s => segmentTrace(s, events));
  for (const seg of tracedSegments) {
    if (seg.missing.length) problems.push(`OPTIONS trace 缺事件 ${seg.trace}：${seg.missing.join(',')}`);
  }
  const tracedBreakdown = {
    parentTotal: stats(tracedSegments.map(x => x.parent.totalMs)),
    parentForkToChildReady: stats(tracedSegments.map(x => x.parent.forkToChildReadyMs)),
    childPreloadToDevServer: stats(tracedSegments.map(x => x.child.preloadToDevServerMs)),
    childHandlerTotal: stats(tracedSegments.map(x => x.child.handlerTotalMs)),
  };
  return { groups: out, verdict, traceOverheadMs: overhead, tracedBreakdown, tracedSegments };
}

function summarizeFixed(raw, events, problems) {
  const samples = raw.samples.filter(s => s.phase === 'fixed');
  const segments = samples.map(s => ({ sample: s, seg: segmentTrace(s, events) }));
  const bodyHash = {};
  for (const { sample, seg } of segments) {
    if (sample.status !== 200) problems.push(`固定 GET 非 200：${sample.trace} status=${sample.status}`);
    if (sample.kind !== 'finmind' && !(sample.price > 0)) problems.push(`固定 GET 無有效價格：${sample.trace}`);
    if (seg.missing.length) problems.push(`固定 GET trace 缺事件 ${sample.trace}：${seg.missing.join(',')}`);
    const expectKinds = sample.kind === 'finmind' ? ['finmind'] : ['yahoo-cookie', 'yahoo-crumb', 'yahoo-chart'];
    const kinds = seg.outbound.map(o => o.kind);
    if (JSON.stringify(kinds) !== JSON.stringify(expectKinds)) problems.push(`固定 GET outbound 不符 ${sample.trace}：${kinds.join(',')}`);
    if (seg.outbound.some(o => o.fixture !== true || o.blocked)) problems.push(`固定 GET 出現非固定 outbound：${sample.trace}`);
    const key = `${sample.kind}|${sample.symbol}`;
    (bodyHash[key] ??= new Set()).add(sample.bodySha256);
  }
  for (const [key, hashes] of Object.entries(bodyHash)) {
    if (hashes.size !== 1) problems.push(`固定輸出不一致：${key} 有 ${hashes.size} 種 body`);
  }
  const local = sample => ttfb(sample.sample) - sample.seg.fixtureWaitTotalMs;
  const isProxy = x => x.sample.path === 'proxy';
  const quoteSingles = segments.filter(x => x.sample.group === 'single' && x.sample.kind === 'quote' && !isProxy(x));
  const quoteProxySingles = segments.filter(x => x.sample.group === 'single' && x.sample.kind === 'quote' && isProxy(x));
  const finmindSingles = segments.filter(x => x.sample.group === 'single' && x.sample.kind === 'finmind');
  const batchItems = segments.filter(x => x.sample.group === 'batch');
  const quoteLocalMedian = median(quoteSingles.map(local));
  const pick = (list, fn) => stats(list.map(fn));
  const breakdown = list => ({
    clientTtfb: pick(list, x => ttfb(x.sample)),
    localCost: pick(list, local),
    fixtureWait: pick(list, x => x.seg.fixtureWaitTotalMs),
    parentPreFork: pick(list, x => x.seg.parent.preForkMs),
    parentForkCall: pick(list, x => x.seg.parent.forkCallMs),
    parentForkToChildReady: pick(list, x => x.seg.parent.forkToChildReadyMs),
    parentReadyToProxy: pick(list, x => x.seg.parent.readyToProxyMs),
    parentProxyRoundTrip: pick(list, x => x.seg.parent.proxyRoundTripMs),
    childBootToPreload: pick(list, x => x.seg.child.bootToPreloadMs),
    childPreloadToDevServer: pick(list, x => x.seg.child.preloadToDevServerMs),
    childDevServerToHandlerLoaded: pick(list, x => x.seg.child.devServerToHandlerLoadedMs),
    childHandlerTotal: pick(list, x => x.seg.child.handlerTotalMs),
    childHandlerBeforeFirstOutbound: pick(list, x => x.seg.child.handlerBeforeFirstOutboundMs),
    childServiceTotal: pick(list, x => x.seg.child.serviceTotalMs),
    unattributedClientVsParent: pick(list, x => x.seg.unattributed.clientTtfbMinusParentMs),
    unattributedForkToReadyVsChildStartup: pick(list, x => x.seg.unattributed.forkToReadyMinusChildStartupMs),
  });
  const batches = {};
  for (const x of batchItems) (batches[x.sample.batchId] ??= []).push(x.sample);
  const batchSummary = Object.values(batches).map(items => ({
    batchId: items[0].batchId,
    firstValidQuoteMs: round(Math.min(...items.filter(i => i.kind === 'quote' && i.price > 0).map(i => i.bodyMs))),
    allValidQuotesFxMs: round(Math.max(...items.map(i => i.bodyMs))),
    peak: Math.max(...items.map(i => i.activeAtStart)),
  }));
  // Vite 代理一跳：client TTFB 減父程序 recv→writeHead 的未歸屬差額，經代理與直連的中位數差。
  const unattributed = list => list.map(x => x.seg.unattributed.clientTtfbMinusParentMs);
  const proxyHopMs = median(unattributed(quoteProxySingles)) !== null && median(unattributed(quoteSingles)) !== null
    ? median(unattributed(quoteProxySingles)) - median(unattributed(quoteSingles))
    : null;
  return {
    verdict: {
      quoteLocalCost: stats(quoteSingles.map(local)),
      medianPass: quoteLocalMedian !== null && quoteLocalMedian <= TARGETS.fixedGetLocalMedianMs,
    },
    singleQuote: breakdown(quoteSingles),
    singleQuoteViaVite: breakdown(quoteProxySingles),
    viteProxyHopMedianMs: round(proxyHopMs),
    singleFinMind: breakdown(finmindSingles),
    batchItems: breakdown(batchItems),
    batches: {
      firstValidQuoteMs: stats(batchSummary.map(b => b.firstValidQuoteMs)),
      allValidQuotesFxMs: stats(batchSummary.map(b => b.allValidQuotesFxMs)),
      peakMax: batchSummary.length ? Math.max(...batchSummary.map(b => b.peak)) : null,
      list: batchSummary,
    },
    // PID 會被 Windows 重用，身分以子程序實例（start＋檔案＋boot 序）判定。
    distinctChildPerRequest: new Set(segments.map(x => x.seg.childInstance)).size === segments.length,
  };
}

function summarizeReal(raw, events, problems) {
  const samples = raw.samples.filter(s => s.phase === 'real');
  const segments = samples.map(s => ({ sample: s, seg: segmentTrace(s, events) }));
  for (const { sample, seg } of segments) {
    if (seg.missing.length) problems.push(`真行情 trace 缺事件 ${sample.trace}：${seg.missing.join(',')}`);
    if (seg.outbound.some(o => o.fixture === true)) problems.push(`真行情混入固定回應：${sample.trace}`);
  }
  const quotes = segments.filter(x => x.sample.kind !== 'finmind');
  const outboundCounts = {};
  for (const { seg } of segments) for (const o of seg.outbound) outboundCounts[o.kind] = (outboundCounts[o.kind] ?? 0) + 1;
  const outboundTotal = Object.values(outboundCounts).reduce((a, b) => a + b, 0);
  // handler 內重試會把上游 429／5xx 藏在 200 後面，直接從 trace 計數。
  const upstreamErrors = segments.flatMap(x => x.seg.outbound)
    .filter(o => o.error || o.status === 429 || o.status >= 500).length;
  const budget = raw.budget ?? {};
  if (budget.outboundWorst !== undefined && outboundTotal > budget.outboundWorst) {
    problems.push(`真上游 outbound ${outboundTotal} 超過最壞預算 ${budget.outboundWorst}`);
  }
  const pick = (list, fn) => stats(list.map(fn));
  const batchItems = samples.filter(s => s.group === 'batch');
  const batchSize = (raw.protocol?.quoteSymbols?.length ?? 0) + 1;
  const validBatch = batchItems.length === batchSize && batchItems.every(s => s.status === 200 && s.price > 0);
  return {
    statuses: samples.map(s => ({ trace: s.trace, kind: s.kind, symbol: s.symbol, status: s.status })),
    halted: raw.halted ?? null,
    outboundCounts,
    outboundTotal,
    upstreamErrors,
    budget,
    quote: {
      clientTtfb: pick(quotes, x => ttfb(x.sample)),
      parentPreFork: pick(quotes, x => x.seg.parent.preForkMs),
      parentForkCall: pick(quotes, x => x.seg.parent.forkCallMs),
      parentForkToChildReady: pick(quotes, x => x.seg.parent.forkToChildReadyMs),
      parentReadyToProxy: pick(quotes, x => x.seg.parent.readyToProxyMs),
      childBootToPreload: pick(quotes, x => x.seg.child.bootToPreloadMs),
      childPreloadToDevServer: pick(quotes, x => x.seg.child.preloadToDevServerMs),
      childDevServerToHandlerLoaded: pick(quotes, x => x.seg.child.devServerToHandlerLoadedMs),
      childHandlerBeforeFirstOutbound: pick(quotes, x => x.seg.child.handlerBeforeFirstOutboundMs),
      yahooCookie: pick(quotes, x => x.seg.handshake.cookieMs),
      yahooCrumb: pick(quotes, x => x.seg.handshake.crumbMs),
      yahooCookieToCrumbEnd: pick(quotes, x => x.seg.handshake.cookieToCrumbEndMs),
      yahooChart: pick(quotes, x => x.seg.handshake.chartMs),
      childHandlerAfterLastOutbound: pick(quotes, x => x.seg.child.handlerAfterLastOutboundMs),
      childHandlerTotal: pick(quotes, x => x.seg.child.handlerTotalMs),
      childServiceTotal: pick(quotes, x => x.seg.child.serviceTotalMs),
      unattributedClientVsParent: pick(quotes, x => x.seg.unattributed.clientTtfbMinusParentMs),
      clientBody: pick(quotes, x => x.sample.bodyMs - x.sample.headersMs),
      realDispatch: pick(quotes, x => x.seg.parent.preForkMs + x.seg.parent.forkToChildReadyMs + x.seg.parent.readyToProxyMs),
      ownHandshakeCount: quotes.filter(x => x.seg.handshake.ownHandshake).length,
      quoteCount: quotes.length,
      distinctChildInstances: new Set(quotes.map(x => x.seg.childInstance)).size,
    },
    finmind: segments.filter(x => x.sample.kind === 'finmind').map(x => ({
      clientTtfb: round(ttfb(x.sample)),
      outboundMs: round(x.seg.outbound[0]?.bodyEndMs ?? null),
      status: x.sample.status,
    })),
    batch: validBatch ? {
      firstValidQuoteMs: round(Math.min(...batchItems.filter(s => s.kind === 'quote').map(s => s.bodyMs))),
      allValidQuotesFxMs: round(Math.max(...batchItems.map(s => s.bodyMs))),
      peak: Math.max(...batchItems.map(s => s.activeAtStart)),
      waves: batchItems.map(s => ({ symbol: s.symbol, queueWaitMs: round(s.startMs), ttfbMs: round(ttfb(s)), endMs: round(s.bodyMs) })),
    } : null,
  };
}

// 依驗收協定 3.5 的條件決定下一票是否驗證長駐分支；兩個因素分開報，不合併歸因。
export function decide({ dispatchMs, singleWaitMs, handshakeShared, handshakeMs }) {
  const dispatchSmall = dispatchMs !== null && singleWaitMs
    && dispatchMs < SKIP_RULE.dispatchMaxMs && dispatchMs < SKIP_RULE.dispatchMaxShare * singleWaitMs;
  const handshakeSmall = handshakeShared
    || (handshakeMs !== null && singleWaitMs && handshakeMs < SKIP_RULE.handshakeMaxMs && handshakeMs < SKIP_RULE.handshakeMaxShare * singleWaitMs);
  const skip = Boolean(dispatchSmall && handshakeSmall);
  return {
    dispatchMs: round(dispatchMs),
    singleWaitMs: round(singleWaitMs),
    dispatchShare: dispatchMs !== null && singleWaitMs ? Math.round((dispatchMs / singleWaitMs) * 1000) / 1000 : null,
    handshakeShared,
    handshakeMs: round(handshakeMs),
    handshakeShare: handshakeMs !== null && singleWaitMs ? Math.round((handshakeMs / singleWaitMs) * 1000) / 1000 : null,
    dispatchSmall: Boolean(dispatchSmall),
    handshakeSmall: Boolean(handshakeSmall),
    skipPersistentBranch: skip,
    next: skip ? '以證據否證長駐分支，轉向已定位的上游／前端段' : '驗證同 handler 長駐本機原型（02）',
  };
}

export function verifyRun(runDir, { secrets } = {}) {
  const problems = [];
  const rawPath = path.join(runDir, 'raw.json');
  if (!fs.existsSync(rawPath)) return { problems: ['缺 raw.json'], thresholdPass: false };
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const events = readTraceDir(path.join(runDir, 'trace'));
  checkIdentity(raw, problems);
  if (raw.aborted) problems.push(`run 中止：${raw.aborted}`);
  if (raw.protocol?.only) problems.push(`只跑部分 start（工具 smoke，不作成績）：${raw.protocol.only.join(',')}`);
  const summary = { runId: raw.runId, mode: raw.mode, verifierSha: VERIFIER_SHA, sourceHead: raw.identity?.git?.head ?? null };
  if (raw.mode === 'fixed') {
    summary.options = summarizeOptions(raw, events, problems);
    summary.fixed = summarizeFixed(raw, events, problems);
    const opt = summary.options.verdict;
    summary.thresholdPass = Boolean(opt['yahoo-chart'].medianPass && opt['yahoo-chart'].eachPass
      && opt.finmind.medianPass && opt.finmind.eachPass && summary.fixed.verdict.medianPass);
  } else if (raw.mode === 'real') {
    summary.real = summarizeReal(raw, events, problems);
    summary.thresholdPass = null;
  } else {
    problems.push(`未知 mode：${raw.mode}`);
  }
  const leaks = scanSecrets(runDir, secrets);
  if (leaks.length) problems.push(`證據疑似含秘密：${leaks.map(l => `${l.file}:${l.key}`).join(',')}`);
  summary.problems = problems;
  return summary;
}

// 固定 run 與真行情 run 合併出選路決定。
export function decideFromRuns(fixedSummary, realSummary) {
  const dispatchMs = fixedSummary.fixed?.verdict?.quoteLocalCost?.median ?? null;
  const singleWaitMs = realSummary.real?.quote?.clientTtfb?.median ?? null;
  const quote = realSummary.real?.quote;
  const handshakeShared = quote ? quote.ownHandshakeCount === 0 : false;
  const handshakeMs = quote?.yahooCookieToCrumbEnd?.median ?? null;
  const decision = decide({ dispatchMs, singleWaitMs, handshakeShared, handshakeMs });
  // 分子取無並行的固定上游本機成本（保守）；另列真上游三槽並行下量到的派送，供對照。
  const realDispatchMs = quote?.realDispatch?.median ?? null;
  return {
    ...decision,
    realDispatchMs: round(realDispatchMs),
    realDispatchShare: realDispatchMs !== null && singleWaitMs ? Math.round((realDispatchMs / singleWaitMs) * 1000) / 1000 : null,
  };
}

function renderMarkdown(summary) {
  const lines = [`# ${summary.runId}（${summary.mode}）判定摘要`, '', `由 verify-b1-breakdown.mjs（內容雜湊 ${summary.verifierSha}）自 raw 重算；請勿手改。`, ''];
  lines.push(`- HEAD：\`${summary.sourceHead}\``);
  lines.push(`- problems：${summary.problems.length ? summary.problems.join('；') : '無'}`);
  lines.push(`- thresholdPass：${summary.thresholdPass}`);
  const fmt = s => (s && s.n ? `${s.min}／${s.median}／${s.max}（n=${s.n}）` : '—');
  if (summary.options) {
    lines.push('', '## 空 OPTIONS（plain 直連，min／median／max ms）', '', '| 路由 | cold | warm | median≤150 | 每筆≤500 |', '|---|---|---|---|---|');
    for (const [routeKey, v] of Object.entries(summary.options.verdict)) {
      lines.push(`| ${routeKey} | ${fmt(v.cold)} | ${fmt(v.warm)} | ${v.medianPass ? 'PASS' : 'FAIL'} | ${v.eachPass ? 'PASS' : 'FAIL'} |`);
    }
    lines.push('', '- OPTIONS 只量直連：Vite 的 CORS middleware 會在代理前自行回 preflight。');
    const b = summary.options.tracedBreakdown;
    lines.push(`- traced OPTIONS 分段：父程序總時間 ${fmt(b.parentTotal)}；fork→子程序就緒 ${fmt(b.parentForkToChildReady)}；子程序模組圖載入 ${fmt(b.childPreloadToDevServer)}；handler 內 ${fmt(b.childHandlerTotal)}`);
    lines.push(`- 探針開銷（traced−plain warm 中位數差，跨 start 量級參考）：${JSON.stringify(summary.options.traceOverheadMs)}`);
  }
  if (summary.fixed) {
    const f = summary.fixed;
    lines.push('', '## 固定上游 GET（min／median／max ms）', '', '| 區段 | 單支報價（直連） | 單支報價（經 Vite） | 單支 FinMind | 批次內報價 |', '|---|---|---|---|---|');
    for (const key of Object.keys(f.singleQuote)) {
      lines.push(`| ${key} | ${fmt(f.singleQuote[key])} | ${fmt(f.singleQuoteViaVite[key])} | ${fmt(f.singleFinMind[key])} | ${fmt(f.batchItems[key])} |`);
    }
    lines.push('', `- 本機成本（TTFB−固定等待）中位數≤200：${f.verdict.medianPass ? 'PASS' : 'FAIL'}（${fmt(f.verdict.quoteLocalCost)}）`);
    lines.push(`- Vite 代理一跳（經 Vite 與直連的未歸屬差額中位數差）：${f.viteProxyHopMedianMs ?? '—'} ms`);
    lines.push(`- 十檔＋FX 三槽批次：首價 ${fmt(f.batches.firstValidQuoteMs)}；全價＋FX ${fmt(f.batches.allValidQuotesFxMs)}；peak ${f.batches.peakMax}`);
    lines.push(`- 每請求獨立子程序：${f.distinctChildPerRequest}`);
  }
  if (summary.real) {
    const r = summary.real;
    lines.push('', '## 真行情小批（min／median／max ms）', '', '| 區段 | 報價 |', '|---|---|');
    for (const [key, value] of Object.entries(r.quote)) {
      if (value && typeof value === 'object') lines.push(`| ${key} | ${fmt(value)} |`);
    }
    lines.push('', `- 自行握手的報價：${r.quote.ownHandshakeCount}/${r.quote.quoteCount}；獨立子程序實例數：${r.quote.distinctChildInstances}`);
    lines.push(`- outbound 計數：${JSON.stringify(r.outboundCounts)}，合計 ${r.outboundTotal}；預算 ${JSON.stringify(r.budget)}`);
    lines.push(`- 上游 429／5xx／連線錯誤（trace 計數，含被 handler 重試隱藏者）：${r.upstreamErrors}`);
    lines.push(`- halted：${r.halted ?? '無'}`);
    if (r.batch) lines.push(`- 十檔＋FX 三槽批次：首價 ${r.batch.firstValidQuoteMs}；全價＋FX ${r.batch.allValidQuotesFxMs}；peak ${r.batch.peak}`);
    lines.push(`- FinMind：${JSON.stringify(r.finmind)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function writeOnceOrCompare(file, content, problems) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content);
    return 'written';
  }
  if (fs.readFileSync(file, 'utf8') !== content) {
    problems.push(`重算結果與既有 ${path.basename(file)} 不同（未覆寫）`);
    return 'mismatch';
  }
  return 'unchanged';
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return args;
}

function runIdDir(runId) {
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,60}$/.test(runId)) throw new Error(`run-id 不合法：${runId}`);
  return path.join(EVIDENCE_ROOT, runId);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args['fixed-run'] && args['real-run']) {
    const fixed = verifyRun(runIdDir(args['fixed-run']));
    const real = verifyRun(runIdDir(args['real-run']));
    const problems = [...fixed.problems.map(p => `fixed:${p}`), ...real.problems.map(p => `real:${p}`)];
    const decision = decideFromRuns(fixed, real);
    const content = `${JSON.stringify({ fixedRun: args['fixed-run'], realRun: args['real-run'], verifierSha: VERIFIER_SHA, decision, problems }, null, 2)}\n`;
    const file = path.join(EVIDENCE_ROOT, `decision-${args['fixed-run']}--${args['real-run']}-${VERIFIER_SHA}.json`);
    const status = writeOnceOrCompare(file, content, problems);
    console.log(JSON.stringify({ decision, problems, file: path.relative(ROOT, file), status }, null, 2));
    return problems.length ? 2 : 0;
  }
  const runDir = runIdDir(args['run-id']);
  const summary = verifyRun(runDir);
  const json = `${JSON.stringify(summary, null, 2)}\n`;
  const status = [
    writeOnceOrCompare(path.join(runDir, `summary-${VERIFIER_SHA}.json`), json, summary.problems),
    writeOnceOrCompare(path.join(runDir, `summary-${VERIFIER_SHA}.md`), renderMarkdown(summary), summary.problems),
  ];
  console.log(JSON.stringify({ runId: summary.runId, mode: summary.mode, problems: summary.problems, thresholdPass: summary.thresholdPass, summaryFiles: status }, null, 2));
  if (summary.problems.length) return 2;
  if (summary.thresholdPass === false) return 1;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
