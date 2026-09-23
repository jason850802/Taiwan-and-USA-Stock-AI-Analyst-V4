#!/usr/bin/env node
// 01 票：B1 日常入口（主工作區 `vercel dev --listen <port>`）等待分解 runner。
//
// 用法（repo 根目錄執行）：
//   node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode fixed --port-base <未占用埠>
//   node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode real --port-base <未占用埠>
//
// fixed：四次獨立啟動，不打真上游。
//   A／C（plain，未注入探針）：空 OPTIONS 正式樣本（直連 vercel dev）。
//   B／D（探針＋固定上游，另起 Vite 代理）：OPTIONS 分段；每輪直連與經 Vite 的單支報價、
//   單支 FinMind、十檔＋FX 三槽批次，共 --rounds 輪。
// real：一次啟動（探針、真上游）：台股／美股報價與 FinMind 名稱各一支方向確認，再跑十檔＋FX 三槽批次；
//   429、5xx、連線失敗或逾時即停止後續起跑。
// 結束後停止本 run 自己 spawn 的程序樹並呼叫判定器；exit code 同判定器（0 達標／1 判紅／2 無效），
// 並寫入 evidence 的 runner-result.json。
// 快速失敗：產品樹不等於 30dfdb2、listener PID 不是本 run spawn 的程序、上游出現 429／5xx／連線錯誤，
// 都立即停止後續起跑。
// 不修改全域 CLI、不複製 .env（vercel dev 直接讀主工作區 .env）；主工作區只寫本票 evidence 目錄；
// runtime 與 log 放 %LOCALAPPDATA%\Temp。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_ROOT, PLAN_DIR, ROOT, parseArgs, main as verifyMain } from './verify-b1-breakdown.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923');
const VERCEL_PKG = path.join(process.env.APPDATA, 'npm', 'node_modules', 'vercel');
const VERCEL_VC = path.join(VERCEL_PKG, 'dist', 'vc.js');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const PRELOAD = path.join(TOOLS, 'trace-preload.cjs');
const VITE_CONFIG = path.join(TOOLS, 'b1-vite-proxy.config.mjs');
const BASELINE_COMMIT = '30dfdb2';
// 產品清單排除文件／代理目錄；prompts/ 只有一份提示詞文件（程式不 import，現為 skip-worktree 實體缺檔）。
const EXCLUDED_PREFIXES = ['.scratch/', '.planning/', '.agents/', '.claude/', '.codex/', 'docs/', 'prompts/'];
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
// handler 需要讀的後端變數：只記是否存在，不記值。
const RELEVANT_ENV_KEYS = ['ALLOWED_ORIGIN', 'PROXY_SHARED_SECRET', 'FINMIND_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
const READY_TIMEOUT_MS = 90_000;
const CLIENT_TIMEOUT_MS = 45_000;
const quoteRoute = symbol => `/api/yahoo/chart?${new URLSearchParams({ symbol, interval: '1d', range: '5d' })}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const rel = value => Math.round(value * 1000) / 1000;

function gitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_CONFIG')) delete env[key];
  return env;
}

const git = (args, input) => execFileSync('git', args, {
  cwd: ROOT,
  encoding: 'utf8',
  env: gitEnv(),
  input,
  maxBuffer: 64 * 1024 * 1024,
});

function lsTree(ref) {
  const map = new Map();
  for (const entry of git(['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean)) {
    const match = entry.match(/^\d+ (\w+) ([0-9a-f]+)\t(.+)$/s);
    if (match && match[1] === 'blob') map.set(match[3], match[2]);
  }
  return map;
}

const isProductPath = p => !EXCLUDED_PREFIXES.some(prefix => p.startsWith(prefix));

// 產品樹身分：主工作區實體內容對 HEAD 與 30dfdb2 逐檔比對（含 skip-worktree 檔），不信 git status。
function productManifest() {
  const head = lsTree('HEAD');
  const baseline = lsTree(BASELINE_COMMIT);
  const paths = [...new Set([...head.keys(), ...baseline.keys()])].filter(isProductPath).sort();
  const existing = paths.filter(p => fs.existsSync(path.join(ROOT, p)));
  const hashes = git(['hash-object', '--stdin-paths'], `${existing.join('\n')}\n`).trim().split('\n');
  const worktree = new Map(existing.map((p, i) => [p, hashes[i]]));
  const differsFromHead = paths.filter(p => worktree.get(p) !== head.get(p));
  const differsFromBaseline = paths.filter(p => worktree.get(p) !== baseline.get(p));
  // 排除目錄以 pathspec 剪枝，避免鑽進舊 runtime 的深層未追蹤副本。
  const excludeSpecs = EXCLUDED_PREFIXES.map(prefix => `:(exclude)${prefix.slice(0, -1)}`);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...excludeSpecs])
    .split('\0').filter(Boolean).filter(isProductPath);
  return {
    fileCount: paths.length,
    aggregateSha256: sha256(paths.map(p => `${worktree.get(p) ?? 'MISSING'} ${p}`).join('\n')),
    missing: paths.filter(p => !worktree.has(p)),
    differsFromHead,
    differsFromBaseline,
    equalsHead: differsFromHead.length === 0,
    equalsBaselineCommit: differsFromBaseline.length === 0,
    untracked: [...new Set(untracked)],
  };
}

// 全樹隱藏狀態：git status 看不到 skip-worktree 檔的缺檔與內容差異，逐檔以實體內容對 index 比對。
function worktreeState() {
  const flagged = git(['ls-files', '-v', '-z']).split('\0').filter(entry => entry.startsWith('S '))
    .map(entry => entry.slice(2));
  const index = new Map();
  for (const entry of git(['ls-files', '-s', '-z']).split('\0').filter(Boolean)) {
    const match = entry.match(/^\d+ ([0-9a-f]+) \d\t(.+)$/s);
    if (match) index.set(match[2], match[1]);
  }
  const existing = flagged.filter(p => fs.existsSync(path.join(ROOT, p)));
  const hashes = existing.length
    ? git(['hash-object', '--stdin-paths'], `${existing.join('\n')}\n`).trim().split('\n')
    : [];
  const hiddenModified = existing.filter((p, i) => hashes[i] !== index.get(p));
  return {
    skipWorktree: flagged.length,
    skipWorktreeMissing: flagged.length - existing.length,
    hiddenModified,
    trackedModified: git(['diff', '--name-only', '-z']).split('\0').filter(Boolean),
  };
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileSha = file => sha256(fs.readFileSync(file));

const toolHashes = () => Object.fromEntries(['trace-preload.cjs', 'b1-breakdown.mjs', 'verify-b1-breakdown.mjs', 'b1-vite-proxy.config.mjs']
  .map(name => [name, fileSha(path.join(TOOLS, name))]));

function firstExisting(candidates) {
  return candidates.find(file => fs.existsSync(file)) ?? null;
}

function identity() {
  const tsxPkg = firstExisting([
    path.join(VERCEL_PKG, 'node_modules', '@vercel', 'node', 'node_modules', 'tsx', 'package.json'),
    path.join(VERCEL_PKG, 'node_modules', 'tsx', 'package.json'),
  ]);
  const envFile = path.join(ROOT, '.env');
  const envKeyNames = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/).map(line => line.match(/^([A-Z_][A-Z0-9_]*)=/)?.[1]).filter(Boolean)
    : [];
  return {
    git: {
      head: git(['rev-parse', 'HEAD']).trim(),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
      baselineCommit: git(['rev-parse', BASELINE_COMMIT]).trim(),
    },
    product: productManifest(),
    worktree: worktreeState(),
    cwd: ROOT,
    command: 'node <APPDATA>/npm/node_modules/vercel/dist/vc.js dev --listen <port>',
    dailyEquivalent: '日常為 npx vercel dev --listen 3001；npx 解析到同一全域 vc.js，本 run 省去 npx 包裝層以讓 owned PID＝listener PID',
    versions: {
      node: process.version,
      vercel: readJson(path.join(VERCEL_PKG, 'package.json')).version,
      vercelNode: readJson(path.join(VERCEL_PKG, 'node_modules', '@vercel', 'node', 'package.json')).version,
      tsx: tsxPkg ? readJson(tsxPkg).version : null,
      vite: readJson(path.join(ROOT, 'node_modules', 'vite', 'package.json')).version,
    },
    tools: toolHashes(),
    plan: Object.fromEntries(['PLAN.md', 'spec.md', 'acceptance.md', 'issues/01-baseline-and-critical-path.md']
      .map(name => [name, fileSha(path.join(PLAN_DIR, name))])),
    envFile: {
      present: fs.existsSync(envFile),
      relevantKeysPresent: Object.fromEntries(RELEVANT_ENV_KEYS.map(key => [key, envKeyNames.includes(key)])),
      copies: 0,
    },
  };
}

// run 結束時的身分重核：HEAD、產品樹與工具雜湊，由判定器與開始時比對。
function identityAfter() {
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    productSha256: productManifest().aggregateSha256,
    tools: toolHashes(),
  };
}

function listenerPids(port) {
  const output = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match && Number(match[1]) === port) pids.add(Number(match[2]));
  }
  // IPv6 行格式同為 [::]:port，已由上式涵蓋。
  return [...pids];
}

function serviceEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS' || key.startsWith('PERF01_')) delete env[key];
  }
  return { ...env, ...extra };
}

async function startService({ name, argv, env, port, readyPattern, logFile }) {
  if (listenerPids(port).length) throw new Error(`埠 ${port} 已被占用，拒絕啟動`);
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, argv, { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  const svc = { name, port, ownedPid: child.pid, listenerPid: null, listenerPids: [], ready: false, readyMs: null, stopped: false, exit: null };
  child.once('exit', (code, signal) => { svc.exit = { code, signal }; });
  const t0 = performance.now();
  while (performance.now() - t0 < READY_TIMEOUT_MS && !svc.exit) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (readyPattern.test(log)) {
      const pids = listenerPids(port);
      if (pids.length) {
        svc.listenerPids = pids;
        svc.listenerPid = pids.length === 1 ? pids[0] : null;
        svc.ready = true;
        svc.readyMs = rel(performance.now() - t0);
        break;
      }
    }
    await sleep(250);
  }
  return svc;
}

// 驗收協定 §1：listener 必須恰好是本 run spawn 的程序，否則在發任何請求前中止。
function assertOwnedListener(label, svc) {
  if (!(svc.listenerPids.length === 1 && svc.listenerPids[0] === svc.ownedPid)) {
    throw new Error(`${label}/${svc.name} listener PID ${svc.listenerPids.join(',')} 不是 owned PID ${svc.ownedPid}`);
  }
}

async function stopService(svc) {
  if (svc.ownedPid) {
    spawnSync('taskkill', ['/PID', String(svc.ownedPid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
  }
  const t0 = performance.now();
  while (performance.now() - t0 < 15_000) {
    if (!listenerPids(svc.port).length) {
      svc.stopped = true;
      return;
    }
    await sleep(250);
  }
}

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
          startMs: rel(startMs),
          headersMs: rel(headersMs),
          bodyMs: rel(bodyMs),
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
      startMs: rel(startMs),
      headersMs: null,
      bodyMs: rel(performance.now() - t0),
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
export function realBudget() {
  const yahooRequests = REAL_DIRECTION_QUOTES.length + 1 + QUOTE_SYMBOLS.length;
  const finmindOutbound = 1;
  return {
    browserApi: yahooRequests + finmindOutbound,
    yahooOutboundNormal: yahooRequests * YAHOO_OUTBOUND_NORMAL,
    yahooOutboundWorst: yahooRequests * YAHOO_OUTBOUND_WORST,
    finmindOutbound,
    outboundWorst: yahooRequests * YAHOO_OUTBOUND_WORST + finmindOutbound,
  };
}

function copyTrace(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return 0;
  fs.mkdirSync(toDir, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(fromDir)) {
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
    count += 1;
  }
  return count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args['run-id'];
  const mode = args.mode;
  const portBase = Number(args['port-base']);
  const rounds = Number(args.rounds ?? 5);
  const fixtureDelayMs = Number(args['fixture-delay-ms'] ?? 50);
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(runId ?? '')) throw new Error('需要合法 --run-id（小寫英數與連字號）');
  if (!['fixed', 'real'].includes(mode)) throw new Error('--mode 只能是 fixed 或 real');
  if (!Number.isInteger(portBase) || portBase < 1024 || portBase > 65000) throw new Error('需要 --port-base');
  const evidenceDir = path.join(EVIDENCE_ROOT, runId);
  const runtimeDir = path.join(RUNTIME_ROOT, runId);
  if (fs.existsSync(evidenceDir) || fs.existsSync(runtimeDir)) throw new Error(`run-id 已使用過，拒絕覆寫：${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });

  const preloadCopy = path.join(runtimeDir, 'trace-preload.cjs');
  fs.copyFileSync(PRELOAD, preloadCopy);
  const raw = {
    schemaVersion: 1,
    runId,
    mode,
    createdAt: new Date().toISOString(),
    identity: identity(),
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
    },
    budget: mode === 'real' ? realBudget() : { browserApi: 0, outboundWorst: 0 },
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
      const extra = {};
      if (step.traced) {
        fs.mkdirSync(traceDir);
        extra.NODE_OPTIONS = `--require "${preloadCopy.replaceAll('\\', '/')}"`;
        extra.PERF01_TRACE_DIR = traceDir;
        if (step.fixture) {
          extra.PERF01_FIXTURE = '1';
          extra.PERF01_FIXTURE_DELAY_MS = String(fixtureDelayMs);
        }
      }
      const start = { label: step.label, traced: step.traced, fixture: step.fixture, startedAt: new Date().toISOString(), services: [] };
      raw.starts.push(start);
      const vercel = await startService({
        name: 'vercel-dev',
        argv: [VERCEL_VC, 'dev', '--listen', String(step.vercelPort)],
        env: serviceEnv(extra),
        port: step.vercelPort,
        readyPattern: /Available at/,
        logFile: path.join(runtimeDir, `${step.label}-vercel.log`),
      });
      running.push(vercel);
      start.services.push(vercel);
      if (!vercel.ready) throw new Error(`${step.label} vercel dev 未在 ${READY_TIMEOUT_MS} ms 內就緒`);
      assertOwnedListener(step.label, vercel);
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
    meaning: { 0: '有效且達標', 1: '有效但未達標（判紅）', 2: 'run 無效' }[exitCode],
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
