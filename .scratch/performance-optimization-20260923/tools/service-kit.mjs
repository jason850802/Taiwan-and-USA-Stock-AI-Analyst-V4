// 01／02 票量測工具共用：安全起停 vercel dev、證明 listener 是自己的、記錄身分、認領 run-id、發請求。
// B1 runner（b1-breakdown）、候選對等比對（c-parity）與重載驗證（c-reload）共用同一套，不各寫一份；
// 各工具的量測協定與判定不放這裡。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_BASE, PLAN_DIR, ROOT, assertRunId, round } from './verify-b1-breakdown.mjs';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RUNTIME_ROOT = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923');
const VERCEL_PKG = path.join(process.env.APPDATA, 'npm', 'node_modules', 'vercel');
const VERCEL_VC = path.join(VERCEL_PKG, 'dist', 'vc.js');
export const PRELOAD = path.join(TOOLS, 'trace-preload.cjs');
export const PERSISTENT = path.join(TOOLS, 'persistent-functions.cjs');
// 原型的 log 標記與會影響函式的根目錄設定檔；在工具程序裡 require 不會啟用原型（只在 vercel dev 父程序安裝）。
export const { LOG: PERSISTENT_LOG, ROOT_WATCH_FILES: FUNCTION_ROOT_FILES } = require('./persistent-functions.cjs');
// 兩個入口：B1＝日常 vercel dev（綁全部介面）；C＝同一個 vercel dev 加長駐原型（只綁 127.0.0.1）。
// ticket 是證據預設放哪一票；command 只作身分紀錄。
export const ENTRIES = Object.freeze({
  b1: Object.freeze({
    ticket: '01',
    persistent: false,
    listen: port => String(port),
    command: 'node <APPDATA>/npm/node_modules/vercel/dist/vc.js dev --listen <port>',
  }),
  c: Object.freeze({
    ticket: '02',
    persistent: true,
    listen: port => `127.0.0.1:${port}`,
    command: 'NODE_OPTIONS=--require <runtime>/persistent-functions.cjs node <APPDATA>/npm/node_modules/vercel/dist/vc.js dev --listen 127.0.0.1:<port>',
  }),
});
// vercel CLI 沒有登入時會自動開瀏覽器授權頁並等待；工具一看到就中止，絕不代為登入。
const LOGIN_PROMPT = /No existing credentials|Starting login flow|oauth\/device/;
export const BASELINE_COMMIT = '30dfdb2';
export const READY_TIMEOUT_MS = 90_000;
// 產品清單排除文件／代理目錄；prompts/ 只有一份提示詞文件（程式不 import，現為 skip-worktree 實體缺檔）。
const EXCLUDED_PREFIXES = ['.scratch/', '.planning/', '.agents/', '.claude/', '.codex/', 'docs/', 'prompts/'];
// handler 需要讀的後端變數：只記是否存在，不記值。
const RELEVANT_ENV_KEYS = ['ALLOWED_ORIGIN', 'PROXY_SHARED_SECRET', 'FINMIND_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'LLM_PROVIDER'];
// run 前後都算雜湊的工具檔：任何一支在 run 期間被改，判定器即判 run 無效。
const TOOL_FILES = ['trace-preload.cjs', 'persistent-functions.cjs', 'service-kit.mjs', 'b1-breakdown.mjs', 'verify-b1-breakdown.mjs', 'b1-vite-proxy.config.mjs', 'c-parity.mjs', 'c-reload.mjs'];
const PLAN_FILES = ['PLAN.md', 'spec.md', 'acceptance.md', 'issues/01-baseline-and-critical-path.md', 'issues/02-persistent-api-prototype.md'];

// 小型回應（固定上游內容、錯誤 JSON）另存全文的上限。
const KEEP_TEXT_BYTES = 4096;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
// NODE_OPTIONS 的雙引號內反斜線會被當跳脫字元，路徑一律改正斜線；證據裡的路徑也用同一寫法。
export const forwardSlashes = file => file.split(path.sep).join('/');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const fileSha = file => sha256(fs.readFileSync(file));

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

export const isProductPath = p => !EXCLUDED_PREFIXES.some(prefix => p.startsWith(prefix));

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

export const toolHashes = () => Object.fromEntries(TOOL_FILES.map(name => [name, fileSha(path.join(TOOLS, name))]));

function firstExisting(candidates) {
  return candidates.find(file => fs.existsSync(file)) ?? null;
}

export function toolVersions() {
  const tsxPkg = firstExisting([
    path.join(VERCEL_PKG, 'node_modules', '@vercel', 'node', 'node_modules', 'tsx', 'package.json'),
    path.join(VERCEL_PKG, 'node_modules', 'tsx', 'package.json'),
  ]);
  return {
    node: process.version,
    vercel: readJson(path.join(VERCEL_PKG, 'package.json')).version,
    vercelNode: readJson(path.join(VERCEL_PKG, 'node_modules', '@vercel', 'node', 'package.json')).version,
    tsx: tsxPkg ? readJson(tsxPkg).version : null,
    vite: readJson(path.join(ROOT, 'node_modules', 'vite', 'package.json')).version,
  };
}

export function identity(entry) {
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
    entry,
    command: ENTRIES[entry].command,
    dailyEquivalent: '日常為 npx vercel dev --listen 3001；npx 解析到同一全域 vc.js，本 run 省去 npx 包裝層以讓 owned PID＝listener PID',
    versions: toolVersions(),
    tools: toolHashes(),
    plan: Object.fromEntries(PLAN_FILES.map(name => [name, fileSha(path.join(PLAN_DIR, name))])),
    envFile: {
      present: fs.existsSync(envFile),
      relevantKeysPresent: Object.fromEntries(RELEVANT_ENV_KEYS.map(key => [key, envKeyNames.includes(key)])),
      copies: 0,
    },
  };
}

// run 結束時的身分重核：HEAD、產品樹與工具雜湊，由判定器與開始時比對。
export function identityAfter() {
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    productSha256: productManifest().aggregateSha256,
    tools: toolHashes(),
  };
}

// 本 run 的證據與 runtime 目錄：run-id 全案唯一，任何票用過或 runtime 已存在都拒絕，不覆寫舊證據。
export function claimRun({ ticket, runId }) {
  assertRunId(runId);
  if (!/^\d{2}$/.test(ticket ?? '')) throw new Error('票號需為兩位數');
  const runtimeDir = path.join(RUNTIME_ROOT, runId);
  const usedElsewhere = fs.existsSync(EVIDENCE_BASE)
    && fs.readdirSync(EVIDENCE_BASE).some(dir => fs.existsSync(path.join(EVIDENCE_BASE, dir, runId)));
  if (usedElsewhere || fs.existsSync(runtimeDir)) throw new Error(`run-id 已使用過，拒絕覆寫：${runId}`);
  const evidenceDir = path.join(EVIDENCE_BASE, ticket, runId);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  return { evidenceDir, runtimeDir };
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

export function serviceEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS' || key.startsWith('PERF01_')) delete env[key];
  }
  return { ...env, ...extra };
}

export async function startService({ name, argv, env, port, readyPattern, logFile, abortPattern = null, cwd = ROOT }) {
  if (listenerPids(port).length) throw new Error(`埠 ${port} 已被占用，拒絕啟動`);
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, argv, { cwd, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  const svc = { name, port, ownedPid: child.pid, listenerPid: null, listenerPids: [], ready: false, readyMs: null, stopped: false, exit: null };
  child.once('exit', (code, signal) => { svc.exit = { code, signal }; });
  const t0 = performance.now();
  while (performance.now() - t0 < READY_TIMEOUT_MS && !svc.exit) {
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    if (abortPattern && abortPattern.test(log)) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
      svc.aborted = 'vercel CLI 要求登入（已中止，未代為登入）';
      break;
    }
    if (readyPattern.test(log)) {
      const pids = listenerPids(port);
      if (pids.length) {
        svc.listenerPids = pids;
        svc.listenerPid = pids.length === 1 ? pids[0] : null;
        svc.ready = true;
        svc.readyMs = Math.round((performance.now() - t0) * 1000) / 1000;
        break;
      }
    }
    await sleep(250);
  }
  return svc;
}

// 驗收協定 §1：listener 必須恰好是本 run spawn 的程序，否則在發任何請求前中止。
export function assertOwnedListener(label, svc) {
  if (!(svc.listenerPids.length === 1 && svc.listenerPids[0] === svc.ownedPid)) {
    throw new Error(`${label}/${svc.name} listener PID ${svc.listenerPids.join(',')} 不是 owned PID ${svc.ownedPid}`);
  }
}

// 探針的環境變數：traceDir 開啟計時探針；fixture 另開固定上游（delayMs＝預設固定等待、controlPath＝可選的控制檔）。
export function probeEnv({ traceDir, fixture = null }) {
  const env = { PERF01_TRACE_DIR: traceDir };
  if (fixture) {
    env.PERF01_FIXTURE = '1';
    env.PERF01_FIXTURE_DELAY_MS = String(fixture.delayMs);
    if (fixture.controlPath) env.PERF01_FIXTURE_CONTROL = fixture.controlPath;
  }
  return env;
}

// 固定上游控制檔：每次 set 換一個 version（探針依 version 重新計算腳本步驟），先寫暫存檔再改名，
// 服務端不會讀到寫一半的內容。defaults 之後才套 extra，所以案例可覆蓋任何欄位。
export function createFixtureControl(controlPath, defaults) {
  let version = 0;
  return {
    set(extra = {}) {
      version += 1;
      const tmp = `${controlPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ...defaults, version: `v${version}`, ...extra }));
      fs.renameSync(tmp, controlPath);
    },
  };
}

// 起一個 vercel dev：requires 依序以 --require 注入（先複製到 runtime，服務載入的是複本）。
// 程序一起來就交給 onStarted 登記（檢查失敗時呼叫端的 finally 仍停得到它），再檢查就緒、
// listener 是自己的、注入原型時 log 有啟用標記。
export async function startVercelDev({ label, port, listen = `127.0.0.1:${port}`, runtimeDir, logFile, requires = [], env = {}, cwd = ROOT, onStarted }) {
  const copies = requires.map(file => {
    const copy = path.join(runtimeDir, path.basename(file));
    if (!fs.existsSync(copy)) fs.copyFileSync(file, copy);
    return copy;
  });
  const extra = { ...env };
  if (copies.length) extra.NODE_OPTIONS = copies.map(copy => `--require "${forwardSlashes(copy)}"`).join(' ');
  const svc = await startService({
    name: 'vercel-dev',
    argv: [VERCEL_VC, 'dev', '--listen', listen],
    env: serviceEnv(extra),
    port,
    readyPattern: /Available at/,
    abortPattern: LOGIN_PROMPT,
    logFile,
    cwd,
  });
  onStarted?.(svc);
  if (svc.aborted) throw new Error(`${label} ${svc.aborted}`);
  if (!svc.ready) throw new Error(`${label} vercel dev 未在 ${READY_TIMEOUT_MS} ms 內就緒`);
  assertOwnedListener(label, svc);
  const persistent = requires.some(file => path.basename(file) === path.basename(PERSISTENT));
  if (persistent && !fs.readFileSync(logFile, 'utf8').includes(PERSISTENT_LOG.enabled)) {
    throw new Error(`${label} 長駐原型沒有啟用，拒絕把結果當候選`);
  }
  return svc;
}

export async function stopService(svc) {
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

// 停止後確認原型啟動過的子程序都已結束：PID 仍在且命令列是 dev-server.mjs 才算殘留。
function isLiveDevServer(pid) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', windowsHide: true });
    return /dev-server\.mjs/i.test(out);
  } catch {
    return false;
  }
}

// 從 vercel dev log 讀原型的啟用／接手／啟動／停用紀錄（標記取自原型本身），並做殘留子程序檢查。
export function persistentReport(logFile) {
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split(/\r?\n/) : [];
  const spawns = lines.map(line => line.match(PERSISTENT_LOG.spawnPattern))
    .filter(Boolean)
    .map(([, entrypoint, pid, generation]) => ({ entrypoint, pid: Number(pid), generation: Number(generation) }));
  return {
    enabled: lines.some(line => line.includes(PERSISTENT_LOG.enabled)),
    takenOver: lines.some(line => line.includes(PERSISTENT_LOG.takenOver)),
    spawns,
    invalidations: lines.filter(line => line.includes(PERSISTENT_LOG.invalidation)).length,
    retirements: lines.filter(line => line.includes(PERSISTENT_LOG.retire)).length,
    outsideForks: lines.filter(line => line.includes(PERSISTENT_LOG.outsideFork)).length,
    orphans: spawns.filter(spawnRecord => isLiveDevServer(spawnRecord.pid)).map(spawnRecord => spawnRecord.pid),
  };
}

export function copyTrace(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return 0;
  fs.mkdirSync(toDir, { recursive: true });
  let count = 0;
  for (const name of fs.readdirSync(fromDir)) {
    fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
    count += 1;
  }
  return count;
}

// 單一請求（client 單調時鐘）：body 只存雜湊，小型回應另存全文（固定上游內容，無秘密）；
// stream 逐行記錄到達時間；abortAfterLines 或 abortRef.abort() 模擬用戶端取消。
export function sendRequest({
  port, method = 'GET', route, headers = {}, body = null, stream = false,
  abortAfterLines = 0, abortRef = null, timeoutMs = 30_000, trace,
}) {
  return new Promise(resolve => {
    const started = performance.now();
    const lines = [];
    let buffer = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve({ trace, method, route, totalMs: round(performance.now() - started), ...result });
    };
    const req = http.request({
      host: '127.0.0.1', port, method, path: route, agent: false,
      headers: { 'x-perf01-trace': trace, ...(body !== null ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers },
    }, res => {
      const ttfbMs = round(performance.now() - started);
      const chunks = [];
      res.on('data', chunk => {
        chunks.push(chunk);
        if (!stream) return;
        buffer += chunk.toString('utf8');
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part) continue;
          lines.push({ t: round(performance.now() - started), text: part });
          if (abortAfterLines && lines.length >= abortAfterLines) {
            req.destroy();
            finish({ status: res.statusCode, headers: res.headers, ttfbMs, lines, aborted: true });
            return;
          }
        }
      });
      res.on('end', () => {
        const all = Buffer.concat(chunks);
        const text = all.length <= KEEP_TEXT_BYTES ? all.toString('utf8') : null;
        finish({ status: res.statusCode, headers: res.headers, ttfbMs, bytes: all.length, bodySha256: all.length ? sha256(all) : null, bodyText: text, lines });
      });
      res.on('error', error => finish({ status: res.statusCode, headers: res.headers, ttfbMs, error: error.code ?? error.message, lines }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('client-timeout')));
    req.on('error', error => finish({ status: 0, error: error.message === 'client-timeout' ? 'client-timeout' : (error.code ?? error.message), lines }));
    if (abortRef) {
      abortRef.abort = () => {
        req.destroy();
        finish({ status: 0, aborted: true, lines });
      };
    }
    if (body !== null) req.write(body);
    req.end();
  });
}

// 輪詢某個服務的子程序 trace，直到出現符合條件的事件（用來把取消、錯開送出等時機對齊兩個入口）。
export async function waitForTraceEvent(traceDir, predicate, timeoutMs = 15_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    for (const name of fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))) {
      const lines = fs.readFileSync(path.join(traceDir, name), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue; // 寫到一半的最後一行
        }
        if (predicate(ev)) return true;
      }
    }
    await sleep(25);
  }
  return false;
}
