#!/usr/bin/env node
// 03 票日常入口：同一個監督程序起停 Vercel 函式與 Vite，只接管自己啟動的程序。
// 用法：node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start|stop|status|recover
//
// 孤兒防護：vercel dev 經 cmd.exe 殼啟動的內部開發伺服器（Vite＋esbuild）不在 Node 為子程序建立的
// job object 裡，vercel 或監督程序異常結束時會存活並監聽 0.0.0.0。因此：
// 1. 就緒後把監督程序底下整棵子孫樹（PID＋建立時間）寫進狀態檔；任何停止路徑都依它清到底。
// 2. 另起脫離 job 的看門程序（本腳本的 __watchdog 模式），以 stdin 管道感知監督程序；監督程序沒送出
//    停止訊息就消失時，核對身分後清掉整棵樹再結束。
// 3. 看門程序也失效時，start 依狀態檔的樹發現殘留就拒絕另起，由 recover 核對後清理。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const root = path.resolve(scriptDir, '..', '..', '..');
const runtimeDir = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily');
const stateFile = path.join(runtimeDir, 'state.json');
const vercelScript = path.join(process.env.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js');
const viteScript = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const persistentFile = path.join(scriptDir, 'persistent-functions.cjs');
const traceFile = path.join(scriptDir, 'trace-preload.cjs');
const WATCHDOG_MODE = '__watchdog';
const timeoutMs = 90_000;
const cleanupWaitMs = 8000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const frontendSystemEnv = new Set([
  'appdata', 'comspec', 'home', 'homedrive', 'homepath', 'localappdata',
  'path', 'pathext', 'systemroot', 'temp', 'tmp', 'userprofile', 'windir',
]);

function frontendEnvironment(apiPort, envDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    frontendSystemEnv.has(key.toLowerCase()) || /^VITE_/i.test(key)));
  env.LOCAL_API_ORIGIN = `http://127.0.0.1:${apiPort}`;
  env.LOCAL_FRONTEND_ENV_DIR = envDir;
  return env;
}

function listenerPids(port) {
  // localhost 在 Windows 可能解析成 ::1；netstat -p TCP 只列 IPv4，會漏掉前端 listener。
  const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (match && Number(match[1]) === port) pids.add(Number(match[2]));
  }
  return [...pids];
}

function processIdentity(pid) {
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}'; if ($p) { $p | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress }`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return JSON.parse(result.stdout);
}

function matchesIdentity(identity, expected) {
  const command = identity?.CommandLine?.toLowerCase() ?? '';
  const script = expected?.script?.toLowerCase() ?? '';
  const scriptMatches = expected?.supervisor
    ? command.includes(path.basename(script))
    : command.includes(script);
  return Boolean(identity && expected?.pid === identity.ProcessId
    && expected.creationDate && identity.CreationDate === expected.creationDate
    && script && scriptMatches);
}

// ── 程序樹：一次讀全部程序的父子關係與建立時間 ──
function processTable() {
  const command = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress';
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const list = JSON.parse(result.stdout);
  return new Map((Array.isArray(list) ? list : [list]).map(row => [row.ProcessId, row]));
}

const creationMs = value => Number(/-?\d+/.exec(String(value ?? ''))?.[0] ?? Number.NaN);

// 某程序底下的整棵子孫樹，只記 PID、父 PID、程序名與建立時間。Windows 的父 PID 在父程序結束後不會清掉，
// PID 又會被重用，所以子程序的建立時間必須不早於父程序，才算這棵樹的成員；監督程序與看門程序自己跑的
// 短命查詢（powershell）也不列入。
export function descendantsOf(table, rootPid, excluded = []) {
  const skip = new Set(excluded);
  const out = [];
  const seen = new Set([rootPid]);
  const walk = (parent, parentMs) => {
    for (const row of table.values()) {
      if (row.ParentProcessId !== parent || seen.has(row.ProcessId) || skip.has(row.ProcessId)) continue;
      const ms = creationMs(row.CreationDate);
      if (!(ms >= parentMs)) continue;
      if ((parent === process.pid || parent === rootPid) && row.Name === 'powershell.exe') continue;
      seen.add(row.ProcessId);
      out.push({ pid: row.ProcessId, parentPid: parent, name: row.Name, creationDate: row.CreationDate });
      walk(row.ProcessId, ms);
    }
  };
  walk(rootPid, creationMs(table.get(rootPid)?.CreationDate));
  return out;
}

function mergeTree(...lists) {
  const byKey = new Map();
  for (const item of lists.flat()) byKey.set(`${item.pid}|${item.creationDate}`, item);
  return [...byKey.values()];
}

// PID 與建立時間都相同才算同一個程序，避免誤殺被重用的 PID。
const aliveIn = (tree, table) => tree.filter(item => Number.isFinite(creationMs(item.creationDate))
  && table.get(item.pid)?.CreationDate === item.creationDate);

// 每次結束前重列存活成員的子孫，先核對建立時間再逐一結束；不讓 taskkill 自行擴大範圍。
// 先停父程序以阻止它繼續派生，已記下的子孫即使成為孤兒也保留身分；注入介面只供假程序表檢查。
export async function killTree(tree, { readTable = processTable, terminate = item =>
  spawnSync('taskkill', ['/PID', String(item.pid), '/F'], { encoding: 'utf8', windowsHide: true }) } = {}) {
  let known = mergeTree(tree);
  const attempted = new Set();
  const killed = [];
  while (true) {
    const table = await readTable();
    if (!table) return { killed, left: known, error: '無法讀取程序表' };
    const live = aliveIn(known, table);
    known = mergeTree(known, ...live.map(item => descendantsOf(table, item.pid)));
    const item = aliveIn(known, table).find(row => !attempted.has(`${row.pid}|${row.creationDate}`));
    if (!item) break;
    attempted.add(`${item.pid}|${item.creationDate}`);
    const result = await terminate(item);
    killed.push({ ...item, status: result.status });
  }
  const started = Date.now();
  let left = aliveIn(known, await readTable() ?? new Map(known.map(item => [item.pid, { CreationDate: item.creationDate }])));
  while (left.length && Date.now() - started < cleanupWaitMs) {
    await delay(250);
    const current = await readTable();
    if (current) left = aliveIn(left, current);
  }
  return { killed, left, error: null };
}

// ── 看門程序：監督程序消失而沒送出停止訊息時，清掉整棵樹 ──
async function runWatchdog([supervisorPidText, supervisorCreationDate, logFile]) {
  const supervisorPid = Number(supervisorPidText);
  const log = message => fs.appendFileSync(logFile, `[watchdog] ${new Date().toISOString()} ${message}\n`);
  let tree = [];
  let stopRequested = false;
  let finishing = false;
  let pollTimer = null;
  let livenessTimer = null;
  log(`已啟動，監看監督程序 pid=${supervisorPid}`);
  // 就緒前後都更新樹；停止時 killTree 還會對仍存活的成員重列子孫。
  const pollTree = () => {
    if (finishing) return;
    const table = processTable();
    if (table && table.get(supervisorPid)?.CreationDate === supervisorCreationDate) {
      tree = mergeTree(tree, descendantsOf(table, supervisorPid, [process.pid]));
    }
  };
  const finish = async reason => {
    if (finishing) return;
    finishing = true;
    clearInterval(pollTimer);
    clearInterval(livenessTimer);
    const { killed, left, error } = await killTree(tree);
    log(`${reason}：程序樹 ${tree.length} 個，清理存活 ${killed.length} 個`
      + `（${killed.map(item => `${item.name}#${item.pid}`).join('、') || '無'}），剩餘 ${left.length}${error ? `；${error}` : ''}`);
    process.exit(left.length ? 1 : 0);
  };
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'tree' && Array.isArray(message.processes)) {
        tree = mergeTree(tree, message.processes.filter(item => item.pid !== process.pid));
        log(`收到就緒程序樹 ${message.processes.length} 個（累計 ${tree.length}）`);
      } else if (message.type === 'stop') {
        stopRequested = true;
      }
    }
  });
  const onPipeClosed = () => { void finish(stopRequested ? '收到正常停止' : '監督程序失聯（管道結束）'); };
  process.stdin.on('end', onPipeClosed);
  process.stdin.on('close', onPipeClosed);
  process.stdin.on('error', onPipeClosed);
  // 後備：管道沒有結束但監督程序已不在。
  livenessTimer = setInterval(() => {
    try {
      process.kill(supervisorPid, 0);
    } catch {
      void finish(stopRequested ? '收到正常停止' : '監督程序失聯（程序已不存在）');
    }
  }, 1000);
  pollTimer = setInterval(pollTree, 2000);
  pollTree();
}

function staleProcesses(state) {
  const table = processTable();
  if (!table) throw new Error('無法讀取程序表，拒絕判斷舊服務是否仍在。');
  const listeners = [...new Set([...listenerPids(state.frontPort), ...listenerPids(state.apiPort)])];
  const supervisor = { pid: state.supervisorPid, creationDate: state.supervisorCreationDate,
    script: scriptFile, supervisor: true };
  const ownedSupervisor = matchesIdentity(processIdentity(supervisor.pid), supervisor) ? supervisor : null;
  const ownedChildren = (state.children ?? []).filter(child =>
    matchesIdentity(processIdentity(child.pid), child));
  const watchdog = state.watchdog ? { ...state.watchdog, supervisor: true } : null;
  const ownedWatchdog = watchdog && matchesIdentity(processIdentity(watchdog.pid), watchdog) ? watchdog : null;
  const ownedTree = aliveIn(state.tree ?? [], table);
  const knownPids = new Set([ownedSupervisor?.pid, ownedWatchdog?.pid, ...ownedChildren.map(child => child.pid),
    ...ownedTree.map(item => item.pid)]);
  const foreignListeners = listeners.filter(pid => !knownPids.has(pid));
  return { listeners, ownedSupervisor, ownedChildren, ownedWatchdog, ownedTree, foreignListeners };
}

const hasStale = stale => Boolean(stale.listeners.length || stale.ownedSupervisor || stale.ownedChildren.length
  || stale.ownedWatchdog || stale.ownedTree.length);

function spawnLogged(name, argv, env, runId) {
  const logFile = path.join(runtimeDir, `${name}-${runId}.log`);
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, argv, {
    cwd: root,
    env,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  fs.closeSync(fd);
  const record = { name, child, logFile, script: argv[0], identity: child.pid ? processIdentity(child.pid) : null, exited: false };
  child.once('exit', () => { record.exited = true; });
  return record;
}

async function waitReady(record, port, marker) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const log = fs.readFileSync(record.logFile, 'utf8');
    if (/No existing credentials|Starting login flow|oauth\/device/.test(log)) {
      throw new Error(`${record.name} 需要互動登入；本入口已停止。`);
    }
    if (record.exited) throw new Error(`${record.name} 提前結束，請檢查 ${record.logFile}`);
    if (marker.test(log)) {
      const listeners = listenerPids(port);
      if (listeners.length === 1 && listeners[0] === record.child.pid) {
        const current = processIdentity(record.child.pid);
        if (!record.identity?.CreationDate || current?.CreationDate !== record.identity.CreationDate
          || !current?.CommandLine?.includes(record.script)) {
          throw new Error(`${record.name} 程序身分未能確認，拒絕使用 listener。`);
        }
        return;
      }
      if (listeners.length) throw new Error(`${record.name} listener 並非本入口啟動的程序。`);
    }
    await delay(250);
  }
  throw new Error(`${record.name} 在 ${timeoutMs} ms 內未就緒，請檢查 ${record.logFile}`);
}

async function prewarmFunctions(port) {
  const routes = ['/api/yahoo/chart', '/api/yahoo/search', '/api/finmind', '/api/gemini', '/api/gemini-stream'];
  const started = Date.now();
  const outcomes = await Promise.all(routes.map(async route => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: 'OPTIONS', signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer();
    return { route, status: response.status };
  }));
  if (outcomes.some(outcome => outcome.status !== 204)) {
    throw new Error(`函式預熱失敗：${outcomes.map(outcome => `${outcome.route}=${outcome.status}`).join('、')}`);
  }
  return { routes: outcomes.length, ms: Date.now() - started };
}

async function stopOwned(records) {
  for (const record of [...records].reverse()) {
    if (!record.child.pid || record.exited) continue;
    const current = processIdentity(record.child.pid);
    if (!record.identity?.CreationDate || !current?.CommandLine?.includes(record.script)) continue;
    if (current.CreationDate !== record.identity.CreationDate) continue;
    await killTree([{ pid: record.child.pid, creationDate: current.CreationDate }]);
  }
}

function commandArgs() {
  const [action, ...rest] = process.argv.slice(2);
  if (!['start', 'stop', 'status', 'recover'].includes(action)) {
    throw new Error('用法：daily-dev.mjs start|stop|status|recover [--front-port 3000 --api-port 3001]');
  }
  const options = { frontPort: 3000, apiPort: 3001 };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = Number(rest[i + 1]);
    if (!['--front-port', '--api-port'].includes(key) || !Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`無效參數：${key ?? ''}`);
    }
    options[key === '--front-port' ? 'frontPort' : 'apiPort'] = value;
  }
  if (options.frontPort === options.apiPort) throw new Error('前後端埠不可相同');
  return { action, ...options };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}

async function contact(state, action) {
  if (!state?.pipe || !state?.token) return null;
  return new Promise(resolve => {
    const socket = net.createConnection(state.pipe);
    let text = '';
    const timer = setTimeout(() => socket.destroy(), 3000);
    socket.on('connect', () => socket.write(`${JSON.stringify({ token: state.token, action })}\n`));
    socket.on('data', chunk => { text += chunk.toString('utf8'); });
    socket.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(text)); } catch { resolve(null); }
    });
    socket.on('error', () => { clearTimeout(timer); resolve(null); });
    socket.on('close', () => { clearTimeout(timer); resolve(null); });
  });
}

async function main() {
  const { action, frontPort, apiPort } = commandArgs();
  fs.mkdirSync(runtimeDir, { recursive: true });
  const previous = readState();
  if (action === 'recover') {
    if (!previous) throw new Error('沒有可復原的本案狀態檔。');
    if (await contact(previous, 'status')) throw new Error('本案監督程序仍可聯絡；請使用 stop。');
    const stale = staleProcesses(previous);
    if (stale.foreignListeners.length) throw new Error('舊埠由未驗證程序占用，拒絕清理。');
    // 先停看門程序（避免兩邊同時清理），再依狀態檔的程序樹清殘留，最後清子程序與監督程序；都先核對身分。
    if (stale.ownedWatchdog && matchesIdentity(processIdentity(stale.ownedWatchdog.pid), stale.ownedWatchdog)) {
      await killTree([stale.ownedWatchdog]);
    }
    const treeCleanup = await killTree(previous.tree ?? []);
    for (const owned of [...stale.ownedChildren, stale.ownedSupervisor].filter(Boolean)) {
      const identity = processIdentity(owned.pid);
      if (!matchesIdentity(identity, owned)) continue;
      await killTree([owned]);
    }
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      if (!hasStale(staleProcesses(previous))) {
        fs.renameSync(stateFile, `${stateFile}.recovered-${Date.now()}`);
        console.log(JSON.stringify({ recovered: true, stopped: true,
          pids: [...stale.ownedChildren.map(child => child.pid), stale.ownedSupervisor?.pid, stale.ownedWatchdog?.pid].filter(Boolean),
          treeCleaned: treeCleanup.killed.map(item => item.pid) }));
        return;
      }
      await delay(250);
    }
    throw new Error('已要求清理，但舊 listener 或原程序仍存在；狀態檔保留。');
  }
  if (action !== 'start') {
    const answer = await contact(previous, action);
    if (!answer) throw new Error('沒有可確認的本案日常服務；若 state.json 殘留，先查程序身分。');
    if (action === 'stop') {
      const started = Date.now();
      while (Date.now() - started < 30_000) {
        if (!fs.existsSync(stateFile) && !listenerPids(previous.frontPort).length
          && !listenerPids(previous.apiPort).length) {
          console.log(JSON.stringify({ ...answer, running: false, stopped: true }, null, 2));
          return;
        }
        await delay(100);
      }
      throw new Error('已要求停止，但未能確認 listener 與狀態檔清除。');
    }
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  if (previous && await contact(previous, 'status')) throw new Error('本案日常入口已在執行。');
  if (fs.existsSync(stateFile) && !previous) throw new Error('舊狀態檔無法解析，拒絕覆寫。');
  if (previous) {
    if (hasStale(staleProcesses(previous))) {
      throw new Error('舊狀態的控制管道失聯，但程序或 listener 仍存在；請先使用 recover 核對並清理。');
    }
    fs.renameSync(stateFile, `${stateFile}.stale-${Date.now()}`);
  }
  if (listenerPids(frontPort).length || listenerPids(apiPort).length) {
    throw new Error('指定埠已有 listener；不接管其他服務。');
  }
  if (!fs.existsSync(vercelScript) || !fs.existsSync(viteScript) || !fs.existsSync(persistentFile)) {
    throw new Error('Vercel、Vite 或長駐工具缺檔。');
  }
  const fixedTest = process.env.PERF03_FIXED_TEST === '1';
  if (fixedTest && (!fs.existsSync(traceFile) || process.env.PERF01_FIXTURE !== '1'
    || !process.env.PERF01_TRACE_DIR || !process.env.PERF01_FIXTURE_CONTROL)) {
    throw new Error('固定資料測試缺少探針或受控環境路徑。');
  }

  const records = [];
  const token = randomUUID();
  const pipe = `\\\\.\\pipe\\stock-perf03-${process.pid}-${token}`;
  const supervisorCreationDate = processIdentity(process.pid)?.CreationDate;
  if (!supervisorCreationDate) throw new Error('無法確認監督程序身分。');
  let server;
  let stopping = false;
  let tree = [];
  let watchdog = null;
  let watchdogRecord = null;
  let watchdogExited = false;
  const stopWatchdog = async () => {
    if (!watchdog || watchdogExited) return;
    try { watchdog.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`); } catch { /* 看門程序已結束 */ }
    const started = Date.now();
    while (!watchdogExited && Date.now() - started < 15_000) await delay(100);
    if (!watchdogExited && watchdogRecord && matchesIdentity(processIdentity(watchdog.pid), watchdogRecord)) {
      await killTree([watchdogRecord]);
    }
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // 仍在的子孫先補記，再與就緒時的樹合併：子程序已崩潰時，逃出 job 的孫程序只能從就緒時的樹找回。
    const table = processTable();
    if (table) tree = mergeTree(tree, descendantsOf(table, process.pid, [watchdog?.pid].filter(Boolean)));
    await stopOwned(records);
    const cleanup = await killTree(tree);
    if (cleanup.left.length || cleanup.error) {
      console.error(`仍有程序未能確認結束：${cleanup.left.map(item => `${item.name}#${item.pid}`).join('、')}${cleanup.error ? `（${cleanup.error}）` : ''}`);
    }
    await stopWatchdog();
    await new Promise(resolve => server?.close(resolve) ?? resolve());
    const state = readState();
    if (state?.token === token) fs.rmSync(stateFile);
    process.exitCode = 0;
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGHUP', () => { void shutdown(); });   // 關閉終端機視窗
  try {
    // 看門程序先於服務啟動：服務啟動途中監督程序就崩潰，也有人收拾。
    const watchdogLog = path.join(runtimeDir, `watchdog-${token}.log`);
    const watchdogFd = fs.openSync(watchdogLog, 'a');
    watchdog = spawn(process.execPath, [scriptFile, WATCHDOG_MODE, String(process.pid), supervisorCreationDate, watchdogLog], {
      cwd: root, detached: true, stdio: ['pipe', watchdogFd, watchdogFd], windowsHide: true,
    });
    fs.closeSync(watchdogFd);
    watchdog.once('exit', () => { watchdogExited = true; });
    watchdog.once('error', () => { watchdogExited = true; });
    watchdog.stdin.on('error', () => { /* 看門程序已結束時寫入失敗，由 exit 事件處理 */ });
    const watchdogIdentity = watchdog.pid ? processIdentity(watchdog.pid) : null;
    if (!watchdogIdentity?.CommandLine?.includes(WATCHDOG_MODE)) throw new Error('看門程序未能啟動，拒絕啟動日常入口。');
    watchdogRecord = { pid: watchdog.pid, creationDate: watchdogIdentity.CreationDate, script: scriptFile };

    const preloads = [persistentFile, ...(fixedTest ? [traceFile] : [])];
    const backend = spawnLogged('vercel', [vercelScript, 'dev', '--listen', `127.0.0.1:${apiPort}`], {
      ...process.env,
      NODE_OPTIONS: preloads.map(file => `--require "${file.replaceAll('\\', '/')}"`).join(' '),
    }, token);
    records.push(backend);
    backend.child.once('exit', () => { if (!stopping) void shutdown(); });
    await waitReady(backend, apiPort, /Ready! Available at/);
    if (!fs.readFileSync(backend.logFile, 'utf8').includes('[persistent-functions] 已啟用')) {
      throw new Error('長駐候選沒有啟用，拒絕把一般 Vercel dev 當成本入口。');
    }
    const prewarm = await prewarmFunctions(apiPort);

    const frontendEnvDir = path.join(runtimeDir, `front-env-${token}`);
    fs.mkdirSync(frontendEnvDir, { recursive: false });
    const frontendEnv = frontendEnvironment(apiPort, frontendEnvDir);
    const frontend = spawnLogged('vite', [viteScript, '--host', 'localhost', '--port', String(frontPort), '--strictPort'], frontendEnv, token);
    records.push(frontend);
    frontend.child.once('exit', () => { if (!stopping) void shutdown(); });
    await waitReady(frontend, frontPort, /ready in/i);

    // 就緒程序樹：寫進狀態檔並交給看門程序；記不下來就不宣告就緒。
    const table = processTable();
    if (table) tree = descendantsOf(table, process.pid, [watchdog.pid]);
    if (!records.every(record => tree.some(item => item.pid === record.child.pid))) {
      throw new Error('無法記錄完整程序樹，拒絕宣告就緒。');
    }
    if (watchdogExited) throw new Error('看門程序已提前結束，拒絕宣告就緒。');
    watchdog.stdin.write(`${JSON.stringify({ type: 'tree', processes: tree })}\n`);

    server = net.createServer(socket => {
      let input = '';
      socket.on('data', chunk => {
        input += chunk.toString('utf8');
        if (input.length > 2048) return socket.destroy();
        if (!input.includes('\n')) return;
        let request;
        try { request = JSON.parse(input.split('\n')[0]); } catch { return socket.destroy(); }
        if (request.token !== token) return socket.destroy();
        socket.end(JSON.stringify({
          running: !stopping && records.every(record => !record.exited),
          front: `http://localhost:${frontPort}`,
          apiPort,
          pids: records.map(record => record.child.pid),
        }));
        if (request.action === 'stop') setImmediate(() => { void shutdown(); });
      });
    });
    await new Promise((resolve, reject) => server.listen(pipe, error => error ? reject(error) : resolve()));
    const state = {
      token, pipe, supervisorPid: process.pid,
      supervisorCreationDate,
      frontPort, apiPort,
      children: records.map(record => ({
        pid: record.child.pid, script: record.script,
        creationDate: record.identity?.CreationDate,
      })),
      watchdog: watchdogRecord,
      tree,
    };
    fs.writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state)}\n`, { flag: 'wx' });
    fs.renameSync(`${stateFile}.tmp`, stateFile);
    console.log(`日常入口已就緒：http://localhost:${frontPort}；後端 ${apiPort}；程序 ${records.map(record => record.child.pid).join('、')}`);
    console.log(`正式函式預熱 ${prewarm.routes} 條皆 204，耗時 ${prewarm.ms} ms。`);
    console.log(`程序樹 ${tree.length} 個已記錄；看門程序 ${watchdog.pid}。`);
    console.log(`停止：node .scratch/performance-optimization-20260923/tools/daily-dev.mjs stop`);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === scriptFile;
if (isMain && process.argv[2] === WATCHDOG_MODE) {
  runWatchdog(process.argv.slice(3)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
} else if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
