#!/usr/bin/env node
// 03 票日常入口：同一個監督程序起停 Vercel 函式與 Vite，只接管自己啟動的程序。
// 用法：node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start|stop|status|recover
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..', '..');
const runtimeDir = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily');
const stateFile = path.join(runtimeDir, 'state.json');
const vercelScript = path.join(process.env.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js');
const viteScript = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const persistentFile = path.join(scriptDir, 'persistent-functions.cjs');
const traceFile = path.join(scriptDir, 'trace-preload.cjs');
const timeoutMs = 90_000;
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

function staleProcesses(state) {
  const listeners = [...new Set([...listenerPids(state.frontPort), ...listenerPids(state.apiPort)])];
  const supervisor = { pid: state.supervisorPid, creationDate: state.supervisorCreationDate,
    script: fileURLToPath(import.meta.url), supervisor: true };
  const ownedSupervisor = matchesIdentity(processIdentity(supervisor.pid), supervisor) ? supervisor : null;
  const ownedChildren = (state.children ?? []).filter(child =>
    matchesIdentity(processIdentity(child.pid), child));
  const knownPids = new Set([ownedSupervisor?.pid, ...ownedChildren.map(child => child.pid)]);
  const foreignListeners = listeners.filter(pid => !knownPids.has(pid));
  return { listeners, ownedSupervisor, ownedChildren, foreignListeners };
}

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
  const record = { name, child, logFile, script: argv[0], identity: null, exited: false };
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
        record.identity = processIdentity(record.child.pid);
        if (!record.identity?.CommandLine?.includes(record.script)) {
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
    if (!current || !current.CommandLine?.includes(record.script)) continue;
    if (record.identity && current.CreationDate !== record.identity.CreationDate) continue;
    spawnSync('taskkill', ['/PID', String(record.child.pid), '/T', '/F'], {
      encoding: 'utf8', windowsHide: true,
    });
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
    for (const owned of [...stale.ownedChildren, stale.ownedSupervisor].filter(Boolean)) {
      const identity = processIdentity(owned.pid);
      if (!matchesIdentity(identity, owned)) continue;
      spawnSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], {
        encoding: 'utf8', windowsHide: true,
      });
    }
    for (let i = 0; i < 100; i++) {
      const after = staleProcesses(previous);
      if (!after.listeners.length && !after.ownedSupervisor && !after.ownedChildren.length) {
        fs.renameSync(stateFile, `${stateFile}.recovered-${Date.now()}`);
        console.log(JSON.stringify({ recovered: true, stopped: true,
          pids: [...stale.ownedChildren.map(child => child.pid), stale.ownedSupervisor?.pid].filter(Boolean) }));
        return;
      }
      await delay(100);
    }
    throw new Error('已要求清理，但舊 listener 或原程序仍存在；狀態檔保留。');
  }
  if (action !== 'start') {
    const answer = await contact(previous, action);
    if (!answer) throw new Error('沒有可確認的本案日常服務；若 state.json 殘留，先查程序身分。');
    if (action === 'stop') {
      const started = Date.now();
      while (Date.now() - started < 15_000) {
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
    const stale = staleProcesses(previous);
    if (stale.listeners.length || stale.ownedSupervisor || stale.ownedChildren.length) {
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
  let server;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stopOwned(records);
    await new Promise(resolve => server?.close(resolve) ?? resolve());
    const state = readState();
    if (state?.token === token) fs.rmSync(stateFile);
    process.exitCode = 0;
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  try {
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
      supervisorCreationDate: processIdentity(process.pid)?.CreationDate,
      frontPort, apiPort,
      children: records.map(record => ({
        pid: record.child.pid, script: record.script,
        creationDate: record.identity?.CreationDate,
      })),
    };
    fs.writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state)}\n`, { flag: 'wx' });
    fs.renameSync(`${stateFile}.tmp`, stateFile);
    console.log(`日常入口已就緒：http://localhost:${frontPort}；後端 ${apiPort}；程序 ${records.map(record => record.child.pid).join('、')}`);
    console.log(`正式函式預熱 ${prewarm.routes} 條皆 204，耗時 ${prewarm.ms} ms。`);
    console.log(`停止：node .scratch/performance-optimization-20260923/tools/daily-dev.mjs stop`);
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
