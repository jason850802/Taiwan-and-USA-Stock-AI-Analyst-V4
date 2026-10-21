#!/usr/bin/env node
// 01 票：B1 日常入口（主工作區 `vercel dev --listen <port>`）等待分解 runner；02 票起也量候選 C。
//
// 用法（repo 根目錄執行）：
//   node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode fixed --port-base <未占用埠>
//   node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode real --port-base <未占用埠>
// 加 --entry c 改量 02 票候選（同一 vercel dev＋tools/persistent-functions.cjs 長駐原型，只綁 127.0.0.1）；
// 候選 fixed run 以 --baseline-run（預設 b1-fixed-20260923-r3）計算相對改善。
// --ticket 指定證據放哪一票（預設 B1＝01、候選＝02）；02 重量 B1 基準時用 --ticket 02。
//
// fixed：四次獨立啟動，不打真上游。
//   A／C（plain，未注入探針）：空 OPTIONS 正式樣本（直連 vercel dev）。
//   B／D（探針＋固定上游，另起 Vite 代理）：OPTIONS 分段；每輪直連與經 Vite 的單支報價、
//   單支 FinMind、十檔＋FX 三槽批次，共 --rounds 輪。
// real：一次啟動（探針、真上游）：台股／美股報價與 FinMind 名稱各一支方向確認，再跑十檔＋FX 三槽批次；
//   429、5xx、連線失敗或逾時即停止後續起跑。
// 結束後停止本 run 自己 spawn 的程序樹並呼叫判定器；exit code 同判定器（fixed：0 達標／1 判紅；
// real 沒有效能門檻：0 有效；兩種模式 2＝無效），並寫入 evidence 的 runner-result.json。
// 快速失敗：產品樹不等於 30dfdb2、listener PID 不是本 run spawn 的程序、上游出現 429／5xx／連線錯誤，
// 都立即停止後續起跑。
// 不修改全域 CLI、不複製 .env（vercel dev 直接讀主工作區 .env）；主工作區只寫本票 evidence 目錄；
// runtime 與 log 放 %LOCALAPPDATA%\Temp。服務起停、身分與 run-id 認領見 service-kit.mjs。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_COMMIT, ENTRIES, PERSISTENT, PRELOAD, READY_TIMEOUT_MS,
  assertOwnedListener, claimRun, copyTrace, fileSha, identity, identityAfter, persistentReport,
  probeEnv, serviceEnv, sha256, startService, startVercelDev, stopService,
} from './service-kit.mjs';
import { ROOT, parseArgs, main as verifyMain } from './verify-b1-breakdown.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const DEFAULT_BASELINE_RUN = 'b1-fixed-20260923-r3';
const VITE_CONFIG = path.join(TOOLS, 'b1-vite-proxy.config.mjs');
const QUOTE_SYMBOLS = ['2317.TW', '2330.TW', '2454.TW', '2308.TW', '0050.TW', 'AAPL', 'NVDA', 'MSFT', 'AMZN', 'TSLA'];
const FX_SYMBOL = 'USDTWD=X';
const FINMIND_NAME_ROUTE = '/api/finmind?dataset=TaiwanStockInfo&data_id=2330';
const OPTIONS_ROUTES = {
  'yahoo-chart': '/api/yahoo/chart?symbol=2330.TW&interval=1d&range=5d',
  finmind: FINMIND_NAME_ROUTE,
};
const SLOTS = 3;
// 真上游模式的請求組成與預算：每支 Yahoo 報價正常 3 支 outbound（cookie、crumb、chart），
// 最壞各再重試一次共 6 支；FinMind handler 不重試。
const REAL_DIRECTION_QUOTES = ['2330.TW', 'AAPL'];
const YAHOO_OUTBOUND_NORMAL = 3;
const YAHOO_OUTBOUND_WORST = 6;
const CLIENT_TIMEOUT_MS = 45_000;
const quoteRoute = symbol => `/api/yahoo/chart?${new URLSearchParams({ symbol, interval: '1d', range: '5d' })}`;
// client 端時間一律取到 0.001 ms。
const round3 = value => Math.round(value * 1000) / 1000;

// 單一請求：client 自己的單調時鐘；只存狀態、大小、body 雜湊與解析出的有效值，不存 body 與 headers 值。
function call({ port, method, route, trace, origin = null }) {
  return new Promise(resolve => {
    const headers = { 'x-perf01-trace': trace };
    if (method === 'OPTIONS') {
      headers.Origin = 'http://localhost:3000';
      headers['Access-Control-Request-Method'] = 'GET';
    }
    const t0 = origin ?? performance.now();
    const startMs = performance.now() - t0;
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers, agent: false }, res => {
      const headersMs = performance.now() - t0;
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const bodyMs = performance.now() - t0;
        const body = Buffer.concat(chunks);
        resolve({
          trace,
          method,
          route,
          status: res.statusCode,
          cacheControl: res.headers['cache-control'] ?? null,
          startMs: round3(startMs),
          headersMs: round3(headersMs),
          bodyMs: round3(bodyMs),
          bytes: body.length,
          bodySha256: body.length ? sha256(body) : null,
          ...parseBody(route, res.statusCode, body),
        });
      });
    });
    req.setTimeout(CLIENT_TIMEOUT_MS, () => req.destroy(new Error('client-timeout')));
    req.on('error', error => resolve({
      trace,
      method,
      route,
      status: 0,
      error: error.message === 'client-timeout' ? 'client-timeout' : (error.code ?? 'error'),
      startMs: round3(startMs),
      headersMs: null,
      bodyMs: round3(performance.now() - t0),
    }));
    req.end();
  });
}

function parseBody(route, status, body) {
  if (status !== 200 || !body.length) return {};
  try {
    const json = JSON.parse(body.toString('utf8'));
    if (route.startsWith('/api/yahoo/chart')) {
      const result = json.chart?.result?.[0];
      const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter(v => v !== null);
      const price = closes.length ? closes[closes.length - 1] : result?.meta?.regularMarketPrice;
      return { price: Number.isFinite(price) ? price : null, metaSymbol: result?.meta?.symbol ?? null };
    }
    return { dataCount: Array.isArray(json.data) ? json.data.length : null, finmindMsg: json.msg ?? null };
  } catch {
    return { parseError: true };
  }
}

const isStopStatus = status => status === 0 || status === 429 || status >= 500;

// handler 會把第一次 401／429 重試掉再回 200，所以 client 狀態碼看不到；直接讀本 start 的子程序 trace。
export function upstreamTrouble(traceDir) {
  if (!traceDir || !fs.existsSync(traceDir)) return null;
  for (const name of fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))) {
    for (const line of fs.readFileSync(path.join(traceDir, name), 'utf8').split('\n').filter(Boolean)) {
      const ev = JSON.parse(line);
      if (ev.ev === 'child.fetchError') return `上游 ${ev.kind} 連線錯誤 ${ev.name}`;
      if (ev.ev === 'child.fetchHeaders' && (ev.status === 401 || ev.status === 429 || ev.status >= 500)) {
        return `上游 ${ev.kind} status=${ev.status}`;
      }
    }
  }
  return null;
}

// 任一條件成立就停止後續起跑：client 端 429／5xx／失敗，或 trace 裡的上游 401／429／5xx／連線錯誤。
const stopReason = (sample, traceDir) => (isStopStatus(sample.status) || sample.status !== 200
  ? `${sample.symbol ?? sample.route} status=${sample.status}`
  : upstreamTrouble(traceDir));

// App 的報價佇列：FX 優先入列，十檔依持股順序，同時最多三支在途；有槽即補。
async function runBatch({ port, tracePrefix, base, haltOn }) {
  const items = [{ kind: 'fx', symbol: FX_SYMBOL }, ...QUOTE_SYMBOLS.map(symbol => ({ kind: 'quote', symbol }))];
  const origin = performance.now();
  const results = [];
  let next = 0;
  let active = 0;
  let halted = null;
  await new Promise(done => {
    const pump = () => {
      while (!halted && active < SLOTS && next < items.length) {
        const item = items[next];
        const index = next;
        next += 1;
        active += 1;
        const activeAtStart = active;
        call({ port, method: 'GET', route: quoteRoute(item.symbol), trace: `${tracePrefix}-b${index}`, origin }).then(sample => {
          results.push({ ...base, group: 'batch', kind: item.kind, symbol: item.symbol, order: index, activeAtStart, ...sample });
          const reason = haltOn ? haltOn({ ...sample, symbol: item.symbol }) : null;
          if (reason && !halted) halted = `批次：${reason}`;
          active -= 1;
          if (active === 0 && (halted || next >= items.length)) done();
          else pump();
        });
      }
    };
    pump();
  });
  return { results: results.sort((a, b) => a.order - b.order), halted };
}

// 空 OPTIONS 只打 vercel dev 直連：經 Vite 的 preflight 會被 Vite 的 CORS middleware 先回，量不到後端。
async function optionsProtocol({ start, port, traced, samples, runId }) {
  const routeKeys = Object.keys(OPTIONS_ROUTES);
  let seq = 0;
  const one = async (routeKey, temp, roundNo) => {
    seq += 1;
    const sample = await call({ port, method: 'OPTIONS', route: OPTIONS_ROUTES[routeKey], trace: `${runId}-${start}-o${seq}` });
    samples.push({ phase: 'options', start, traced, path: 'direct', routeKey, temp, round: roundNo, ...sample });
  };
  for (const routeKey of routeKeys) await one(routeKey, 'cold', 0);
  for (let r = 1; r <= 10; r += 1) {
    for (const routeKey of (r % 2 ? routeKeys : [...routeKeys].reverse())) await one(routeKey, 'warm', r);
  }
}

// 每輪：直連單支報價、經 Vite 單支報價（日常 App 的路徑）、直連單支 FinMind、直連十檔＋FX 三槽批次。
async function fixedProtocol({ start, ports, rounds, samples, runId }) {
  for (let r = 1; r <= rounds; r += 1) {
    const base = { phase: 'fixed', start, traced: true, round: r };
    samples.push({ ...base, group: 'single', kind: 'quote', symbol: '2330.TW', path: 'direct', ...await call({ port: ports.direct, method: 'GET', route: quoteRoute('2330.TW'), trace: `${runId}-${start}-r${r}-q` }) });
    if (ports.proxy) {
      samples.push({ ...base, group: 'single', kind: 'quote', symbol: '2330.TW', path: 'proxy', ...await call({ port: ports.proxy, method: 'GET', route: quoteRoute('2330.TW'), trace: `${runId}-${start}-r${r}-qv` }) });
    }
    samples.push({ ...base, group: 'single', kind: 'finmind', symbol: '2330', path: 'direct', ...await call({ port: ports.direct, method: 'GET', route: FINMIND_NAME_ROUTE, trace: `${runId}-${start}-r${r}-f` }) });
    const batch = await runBatch({ port: ports.direct, tracePrefix: `${runId}-${start}-r${r}`, base: { ...base, path: 'direct', batchId: `${start}-r${r}` } });
    samples.push(...batch.results);
  }
}

async function realProtocol({ start, port, samples, runId, raw, traceDir }) {
  const base = { phase: 'real', start, traced: true, round: 1 };
  const direction = [
    ...REAL_DIRECTION_QUOTES.map(symbol => ({ kind: 'quote', symbol, route: quoteRoute(symbol) })),
    { kind: 'finmind', symbol: '2330', route: FINMIND_NAME_ROUTE },
  ];
  for (const [i, item] of direction.entries()) {
    const sample = await call({ port, method: 'GET', route: item.route, trace: `${runId}-${start}-d${i}` });
    samples.push({ ...base, group: 'direction', kind: item.kind, symbol: item.symbol, ...sample });
    const reason = stopReason({ ...sample, symbol: item.symbol }, traceDir);
    if (reason) {
      raw.halted = `方向確認：${reason}`;
      return;
    }
  }
  const batch = await runBatch({
    port,
    tracePrefix: `${runId}-${start}`,
    base: { ...base, batchId: `${start}-real` },
    haltOn: sample => stopReason(sample, traceDir),
  });
  samples.push(...batch.results);
  if (batch.halted) raw.halted = batch.halted;
}

// 真上游預算由請求組成推導：方向確認報價＋FX＋十檔，各自 Yahoo outbound 正常／最壞；另加 1 支 FinMind。
// 長駐入口的正常值只含一次共用握手（cookie＋crumb）；最壞值沿用 B1 的逐請求重做上界。
export function realBudget(entry = 'b1') {
  const yahooRequests = REAL_DIRECTION_QUOTES.length + 1 + QUOTE_SYMBOLS.length;
  const finmindOutbound = 1;
  return {
    browserApi: yahooRequests + finmindOutbound,
    yahooOutboundNormal: ENTRIES[entry].persistent ? 2 + yahooRequests : yahooRequests * YAHOO_OUTBOUND_NORMAL,
    yahooOutboundWorst: yahooRequests * YAHOO_OUTBOUND_WORST,
    finmindOutbound,
    outboundWorst: yahooRequests * YAHOO_OUTBOUND_WORST + finmindOutbound,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args['run-id'];
  const mode = args.mode;
  const portBase = Number(args['port-base']);
  const rounds = Number(args.rounds ?? 5);
  const fixtureDelayMs = Number(args['fixture-delay-ms'] ?? 50);
  const entry = args.entry ?? 'b1';
  const profile = ENTRIES[entry];
  if (!profile) throw new Error(`--entry 只能是 ${Object.keys(ENTRIES).join(' 或 ')}`);
  if (!['fixed', 'real'].includes(mode)) throw new Error('--mode 只能是 fixed 或 real');
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65000) throw new Error('需要 --port-base');
  const baselineRun = profile.persistent && mode === 'fixed' ? (args['baseline-run'] ?? DEFAULT_BASELINE_RUN) : null;
  // 證據放 evidence/<票號>/<run-id>（預設依入口：B1＝01、候選＝02）；run-id 全案唯一，任何票用過都拒絕。
  const { evidenceDir, runtimeDir } = claimRun({ ticket: args.ticket ?? profile.ticket, runId });

  // 注入檔先複製到 runtime：服務載入的與證據記錄雜湊的是同一份複本。
  const preloadCopy = path.join(runtimeDir, 'trace-preload.cjs');
  fs.copyFileSync(PRELOAD, preloadCopy);
  const persistentCopy = profile.persistent ? path.join(runtimeDir, 'persistent-functions.cjs') : null;
  if (persistentCopy) fs.copyFileSync(PERSISTENT, persistentCopy);
  const raw = {
    schemaVersion: 1,
    runId,
    mode,
    createdAt: new Date().toISOString(),
    identity: identity(entry),
    protocol: {
      optionsRoutes: OPTIONS_ROUTES,
      quoteSymbols: QUOTE_SYMBOLS,
      fxSymbol: FX_SYMBOL,
      slots: SLOTS,
      rounds: mode === 'fixed' ? rounds : 1,
      fixtureDelayMs: mode === 'fixed' ? fixtureDelayMs : null,
      readyTimeoutMs: READY_TIMEOUT_MS,
      clientTimeoutMs: CLIENT_TIMEOUT_MS,
      clock: '各程序 performance.now()；client 樣本以各自請求（或批次）起點為 0',
      preloadCopySha256: fileSha(preloadCopy),
      persistentCopySha256: persistentCopy ? fileSha(persistentCopy) : null,
      baselineRun,
    },
    budget: mode === 'real' ? realBudget(entry) : { browserApi: 0, outboundWorst: 0 },
    starts: [],
    samples: [],
    halted: null,
    aborted: null,
  };

  const fullPlan = mode === 'fixed'
    ? [
      { label: 'A-plain', traced: false, fixture: false, proxy: false, vercelPort: portBase },
      { label: 'B-trace-fixture', traced: true, fixture: true, proxy: true, vercelPort: portBase + 1, vitePort: portBase + 2 },
      { label: 'C-plain', traced: false, fixture: false, proxy: false, vercelPort: portBase + 3 },
      { label: 'D-trace-fixture', traced: true, fixture: true, proxy: true, vercelPort: portBase + 4, vitePort: portBase + 5 },
    ]
    : [{ label: 'R-trace-real', traced: true, fixture: false, proxy: false, vercelPort: portBase }];
  // --only 只供工具 smoke：產出的 run 缺 start，判定器不會給正式成績。
  const only = args.only ? new Set(args.only.split(',')) : null;
  const plan = only ? fullPlan.filter(step => only.has(step.label)) : fullPlan;
  if (!plan.length) throw new Error('--only 沒有對應的 start');
  raw.protocol.only = only ? [...only] : null;

  const running = [];
  const stopAll = async () => {
    for (const svc of running.splice(0).reverse()) await stopService(svc);
  };
  process.once('SIGINT', () => { raw.aborted = 'SIGINT'; });

  try {
    // B1＝30dfdb2 產品內容：主工作區產品樹不一致或有未追蹤產品檔時，在起服務與打上游前中止。
    const product = raw.identity.product;
    if (!product.equalsBaselineCommit || product.untracked.length) {
      throw new Error(`產品樹不等於 ${BASELINE_COMMIT}（差異 ${product.differsFromBaseline.length}、未追蹤 ${product.untracked.length}），拒絕量 B1`);
    }
    for (const step of plan) {
      if (raw.aborted) break;
      const traceDir = path.join(runtimeDir, `${step.label}-trace`);
      // 候選：每個 start（含未注入探針的 plain）都載入長駐原型；探針排在原型之後。
      const requires = persistentCopy ? [persistentCopy] : [];
      if (step.traced) {
        fs.mkdirSync(traceDir);
        requires.push(preloadCopy);
      }
      const env = step.traced ? probeEnv({ traceDir, fixture: step.fixture ? { delayMs: fixtureDelayMs } : null }) : {};
      const start = { label: step.label, traced: step.traced, fixture: step.fixture, startedAt: new Date().toISOString(), services: [] };
      raw.starts.push(start);
      const vercelLog = path.join(runtimeDir, `${step.label}-vercel.log`);
      await startVercelDev({
        label: step.label,
        port: step.vercelPort,
        // B1 沿用日常形狀（--listen <port>）；候選只綁 127.0.0.1。
        listen: profile.listen(step.vercelPort),
        runtimeDir,
        logFile: vercelLog,
        requires,
        env,
        onStarted: svc => {
          running.push(svc);
          start.services.push(svc);
        },
      });
      const ports = { direct: step.vercelPort, proxy: null };
      if (step.proxy) {
        const vite = await startService({
          name: 'vite-proxy',
          argv: [VITE_BIN, '--config', VITE_CONFIG, '--port', String(step.vitePort), '--strictPort'],
          env: serviceEnv({ PERF01_BACKEND_PORT: String(step.vercelPort), PERF01_VITE_CACHE_DIR: path.join(runtimeDir, `${step.label}-vite-cache`) }),
          port: step.vitePort,
          readyPattern: /Local:|ready in/i,
          logFile: path.join(runtimeDir, `${step.label}-vite.log`),
        });
        running.push(vite);
        start.services.push(vite);
        if (!vite.ready) throw new Error(`${step.label} vite 代理未就緒`);
        assertOwnedListener(step.label, vite);
        ports.proxy = step.vitePort;
      }
      if (mode === 'fixed') {
        await optionsProtocol({ start: step.label, port: ports.direct, traced: step.traced, samples: raw.samples, runId });
        if (step.fixture) await fixedProtocol({ start: step.label, ports, rounds, samples: raw.samples, runId });
      } else {
        await realProtocol({ start: step.label, port: step.vercelPort, samples: raw.samples, runId, raw, traceDir });
      }
      start.finishedAt = new Date().toISOString();
      await stopAll();
      if (profile.persistent) start.persistent = persistentReport(vercelLog);
      if (step.traced) start.traceFiles = copyTrace(traceDir, path.join(evidenceDir, 'trace', step.label));
    }
  } catch (error) {
    raw.aborted = error.message;
  } finally {
    await stopAll();
    for (const step of plan) {
      const traceDir = path.join(runtimeDir, `${step.label}-trace`);
      const start = raw.starts.find(s => s.label === step.label);
      if (start && step.traced && start.traceFiles === undefined) {
        start.traceFiles = copyTrace(traceDir, path.join(evidenceDir, 'trace', step.label));
      }
    }
    raw.identityAfter = identityAfter();
    raw.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }
  const exitCode = verifyMain(['--run-id', runId]);
  fs.writeFileSync(path.join(evidenceDir, 'runner-result.json'), `${JSON.stringify({
    runId,
    mode,
    exitCode,
    meaning: mode === 'real'
      ? { 0: '有效（真上游模式不設效能門檻）', 2: 'run 無效' }[exitCode]
      : { 0: '有效且達標', 1: '有效但未達標（判紅）', 2: 'run 無效' }[exitCode],
    finishedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return exitCode;
}

// 只在直接執行時啟動；被自測 import 時只提供純函式。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
