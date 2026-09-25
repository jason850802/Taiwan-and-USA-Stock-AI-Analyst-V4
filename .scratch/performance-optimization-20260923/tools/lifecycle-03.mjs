#!/usr/bin/env node
// 03 票：日常入口生命週期的原始紀錄——連續兩次啟停、前／後端埠衝突、後端／前端／監督程序失敗後的恢復。
//
// 用法（repo 根目錄）：
//   node .scratch/performance-optimization-20260923/tools/lifecycle-03.mjs <新 run-id>
//   開發期冒煙（不算正式、證據只留 runtime）：再加 --smoke --front-port <埠> --api-port <埠>
//
// 正式 run 用日常命令原樣（daily-dev.mjs start，不帶測試旗標＝使用者平常的 3000／3001、真 .env 只給後端）。
// 只送兩種請求：前端首頁 GET（HTML）與同源代理的 OPTIONS（守門在 CORS 之後直接回 204，不碰上游）；
// 不打行情、不執行 AI。服務期間沿用 port-guard 的哨兵與外部用戶端監看，一有外部用戶端就停服務並判無效。
// 每個情境寫下命令、結束碼、輸出（不含控制 token）、owned PID／建立時間、listener 與停止後殘留檢查；
// 殘留檢查涵蓋就緒時監督程序底下的整棵子孫樹（含 vercel 內部開發伺服器與 esbuild），結束時清掉仍存活者並記錄。
// exit 0＝全部情境符合預期；1＝有情境不符；2＝run 無效。
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sleep, toolVersions } from './service-kit.mjs';
import { ROOT, parseArgs, scanSecrets } from './verify-b1-breakdown.mjs';
import { listenerRows, nodeProcesses, processTable, runSentinel, scriptOf, startForeignMonitor } from './port-guard-03.mjs';

const require = createRequire(import.meta.url);
const { LOG: PERSISTENT_LOG } = require('./persistent-functions.cjs');

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const DAILY = path.join(TOOLS, 'daily-dev.mjs');
const RUNTIME_ROOT = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923');
const DAILY_RUNTIME = path.join(RUNTIME_ROOT, 'daily');
const STATE_FILE = path.join(DAILY_RUNTIME, 'state.json');
const CONFLICT_MESSAGE = '指定埠已有 listener；不接管其他服務。';
const STALE_MESSAGE = '控制管道失聯';
const NO_SERVICE_MESSAGE = '沒有可確認的本案日常服務';
let FRONT_PORT = 3000;
let API_PORT = 3001;

const nowIso = () => new Date().toISOString();
const stripAnsi = text => text.replace(/\u001b\[[0-9;]*m/g, '');
const portArgs = () => (FRONT_PORT === 3000 && API_PORT === 3001 ? []
  : ['--front-port', String(FRONT_PORT), '--api-port', String(API_PORT)]);
const commandText = action => ['node', '.scratch/performance-optimization-20260923/tools/daily-dev.mjs', action,
  ...(['start'].includes(action) ? portArgs() : [])].join(' ');

// 日常命令原樣：不帶任何本案測試旗標或預載，與使用者平常的環境相同。
function dailyEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_OPTIONS' || /^PERF0[13]_/.test(key)) delete env[key];
  }
  return env;
}

const execText = (file, args, options = {}) => new Promise(resolve => {
  const started = performance.now();
  execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...options },
    (error, stdout, stderr) => {
      resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout).trim(), stderr: String(stderr).trim(), ms: Math.round(performance.now() - started) });
    });
});

// stop／status／recover：輸出只有 running／front／apiPort／pids／stopped 等欄位，不含 token；保險起見仍濾掉。
async function daily(action) {
  const result = await execText(process.execPath, [DAILY, action], { cwd: ROOT, env: dailyEnv() });
  const clean = text => text.split(/\r?\n/).filter(line => line && !/token|pipe/i.test(line));
  return { command: commandText(action), status: result.status, stdout: clean(result.stdout), stderr: clean(result.stderr), ms: result.ms };
}

// start 會常駐成監督程序，所以另外 spawn：等到就緒或結束；expectFailure 時只等它結束。
async function startSupervisor(runtimeDir, tag, { expectFailure = false } = {}) {
  const logFile = path.join(runtimeDir, `start-${tag}.log`);
  const fd = fs.openSync(logFile, 'wx');
  const started = performance.now();
  const child = spawn(process.execPath, [DAILY, 'start', ...portArgs()], {
    cwd: ROOT, env: dailyEnv(), stdio: ['ignore', fd, fd], windowsHide: true,
  });
  fs.closeSync(fd);
  const exit = { value: null, atMs: null };
  child.once('exit', (code, signal) => { exit.value = { code, signal }; exit.atMs = Math.round(performance.now() - started); });
  const limit = expectFailure ? 30_000 : 120_000;
  let ready = false;
  while (performance.now() - started < limit) {
    ready = fs.readFileSync(logFile, 'utf8').includes('日常入口已就緒');
    if (ready || exit.value) break;
    await sleep(200);
  }
  return {
    tag, command: commandText('start'), child, exit, ready, readyMs: ready ? Math.round(performance.now() - started) : null,
    output: () => fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).filter(Boolean),
  };
}

async function waitExit(run, timeoutMs) {
  const started = performance.now();
  while (!run.exit.value && performance.now() - started < timeoutMs) await sleep(100);
  return run.exit.value;
}

function readStateView() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      token: state.token,
      view: {
        frontPort: state.frontPort, apiPort: state.apiPort,
        supervisorPid: state.supervisorPid, supervisorCreationDate: state.supervisorCreationDate,
        children: (state.children ?? []).map(({ pid, script, creationDate }) => ({ pid, script: path.basename(script), creationDate })),
      },
    };
  } catch {
    return null;
  }
}

// vercel／vite log 只取內容（檔名含控制 token，不記）；去掉色碼，並略過印出區網位址的 Network 行。
function launcherLogs(token) {
  const read = name => {
    const file = path.join(DAILY_RUNTIME, `${name}-${token}.log`);
    return fs.existsSync(file) ? stripAnsi(fs.readFileSync(file, 'utf8')).split(/\r?\n/).map(line => line.trim())
      .filter(line => line && !/Network:/.test(line)) : null;
  };
  const vercel = read('vercel');
  return {
    vercel, vite: read('vite'),
    persistent: {
      enabled: Boolean(vercel?.some(line => line.includes(PERSISTENT_LOG.enabled))),
      takenOver: Boolean(vercel?.some(line => line.includes(PERSISTENT_LOG.takenOver))),
      spawns: (vercel ?? []).map(line => line.match(PERSISTENT_LOG.spawnPattern)).filter(Boolean)
        .map(([, entrypoint, pid, generation]) => ({ entrypoint, pid: Number(pid), generation: Number(generation) })),
      outsideForks: (vercel ?? []).filter(line => line.includes(PERSISTENT_LOG.outsideFork)).length,
    },
  };
}

async function listeners() {
  return { front: await listenerRows(FRONT_PORT), api: await listenerRows(API_PORT) };
}

async function identities(view) {
  const table = await nodeProcesses();
  return [view.supervisorPid, ...view.children.map(child => child.pid)].map(pid => {
    const row = table.get(pid);
    return row ? { pid, parentPid: row.ParentProcessId, creationDate: row.CreationDate, script: scriptOf(row.CommandLine) }
      : { pid, missing: true };
  });
}

// 首頁 GET 與同源 OPTIONS：證明前端與同源代理都由這一輪服務，且不碰任何上游。
async function httpChecks() {
  const origin = `http://localhost:${FRONT_PORT}`;
  const out = {};
  try {
    const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(15_000) });
    const text = await page.text();
    out.page = { status: page.status, contentType: page.headers.get('content-type'), hasRoot: text.includes('<div id="root"></div>'),
      hasViteClient: text.includes('/@vite/client') };
  } catch (error) {
    out.page = { error: error.message };
  }
  try {
    const options = await fetch(`${origin}/api/yahoo/chart?symbol=2330.TW&interval=1d&range=5d`, {
      method: 'OPTIONS', headers: { Origin: origin }, signal: AbortSignal.timeout(15_000),
    });
    await options.arrayBuffer();
    out.options = { status: options.status };
  } catch (error) {
    out.options = { error: error.message };
  }
  return out;
}

// 就緒後監督程序底下的整棵程序樹（所有子孫，含 vercel 經 cmd 殼啟動的內部 Vite 與 esbuild），
// 只記 PID、程序名與建立時間；停止或崩潰後逐一核對是否仍存活。
const allDescendants = [];
async function descendantsOf(rootPid) {
  const table = await processTable();
  const out = [];
  const walk = parent => {
    for (const row of table.values()) {
      if (row.ParentProcessId !== parent || row.ProcessId === parent) continue;
      out.push({ pid: row.ProcessId, parentPid: parent, name: row.Name, creationDate: row.CreationDate });
      walk(row.ProcessId);
    }
  };
  walk(rootPid);
  allDescendants.push(...out);
  return out;
}

// 停止後檢查：狀態檔、兩埠 listener、監督程序與子程序（PID＋建立時間）、函式子程序（dev-server.mjs），
// 以及就緒時記下的整棵子孫樹（PID＋建立時間仍相同即為殘留）。
async function stoppedCheck(view, spawns, descendants = []) {
  await sleep(500);
  const table = await nodeProcesses();
  const everything = await processTable();
  const owned = view ? [{ pid: view.supervisorPid, creationDate: view.supervisorCreationDate }, ...view.children] : [];
  return {
    stateRemoved: !fs.existsSync(STATE_FILE),
    listeners: await listeners(),
    aliveLauncher: owned.filter(item => table.get(item.pid)?.CreationDate === item.creationDate).map(item => item.pid),
    aliveFunctions: (spawns ?? []).filter(item => /dev-server\.mjs/i.test(table.get(item.pid)?.CommandLine ?? '')).map(item => item.pid),
    aliveDescendants: descendants.filter(item => everything.get(item.pid)?.CreationDate === item.creationDate)
      .map(({ pid, name }) => ({ pid, name })),
  };
}
const isClean = check => check.stateRemoved && !check.listeners.front.length && !check.listeners.api.length
  && !check.aliveLauncher.length && !check.aliveFunctions.length && !check.aliveDescendants.length;

// ── 情境 ──
async function cycle(runtimeDir, tag) {
  const record = { scenario: tag, startedAt: nowIso(), steps: {} };
  const run = await startSupervisor(runtimeDir, tag);
  record.steps.start = { command: run.command, ready: run.ready, readyMs: run.readyMs, exit: run.exit.value, output: run.output() };
  const state = readStateView();
  record.steps.state = state?.view ?? null;
  if (run.ready && state) {
    record.steps.identities = await identities(state.view);
    record.steps.listeners = await listeners();
    record.steps.status = await daily('status');
    record.steps.http = await httpChecks();
    record.steps.descendants = await descendantsOf(state.view.supervisorPid);
  }
  const logs = state ? launcherLogs(state.token) : null;
  record.steps.logs = logs ? { vercel: logs.vercel, vite: logs.vite } : null;
  record.steps.persistent = logs?.persistent ?? null;
  record.steps.stop = await daily('stop');
  record.steps.supervisorExit = { value: await waitExit(run, 15_000), atMs: run.exit.atMs };
  record.steps.afterStop = await stoppedCheck(state?.view, logs?.persistent.spawns, record.steps.descendants ?? []);
  const vite = state?.view.children.find(child => child.script === 'vite.js');
  const vercel = state?.view.children.find(child => child.script === 'vc.js');
  const statusJson = (() => { try { return JSON.parse(record.steps.status?.stdout.join('\n') ?? ''); } catch { return null; } })();
  const stopJson = (() => { try { return JSON.parse(record.steps.stop.stdout.join('\n')); } catch { return null; } })();
  record.checks = {
    '就緒並寫出本輪狀態': run.ready && Boolean(state),
    '狀態埠＝受測埠': state?.view.frontPort === FRONT_PORT && state?.view.apiPort === API_PORT,
    '程序身分：監督程序 daily-dev.mjs，子程序 vc.js／vite.js': Boolean(record.steps.identities?.[0]?.script === 'daily-dev.mjs'
      && vite && vercel && record.steps.identities?.every(item => !item.missing)
      && record.steps.identities.slice(1).map(item => item.script).sort().join() === 'vc.js,vite.js'),
    '前端 listener 全是本輪 Vite': Boolean(record.steps.listeners?.front.length && record.steps.listeners.front.every(row => row.pid === vite?.pid)),
    '後端 listener 全是本輪 vercel': Boolean(record.steps.listeners?.api.length && record.steps.listeners.api.every(row => row.pid === vercel?.pid)),
    'status 回報執行中': record.steps.status?.status === 0 && statusJson?.running === true,
    '首頁 200 且是 Vite 開發頁': record.steps.http?.page?.status === 200 && record.steps.http.page.hasRoot && record.steps.http.page.hasViteClient,
    '同源 OPTIONS 204（不碰上游）': record.steps.http?.options?.status === 204,
    '長駐候選啟用並接手、五條函式預熱': Boolean(logs?.persistent.enabled && logs.persistent.takenOver
      && logs.persistent.spawns.length === 5 && !logs.persistent.outsideForks),
    'stop 回報 stopped': record.steps.stop.status === 0 && stopJson?.stopped === true,
    '監督程序自行結束': Boolean(record.steps.supervisorExit.value),
    '停止後無狀態、無 listener、整棵子孫樹無殘留': isClean(record.steps.afterStop),
  };
  record.pass = Object.values(record.checks).every(Boolean);
  return record;
}

async function portConflict(runtimeDir, which) {
  const tag = `conflict-${which}`;
  const port = which === 'front' ? FRONT_PORT : API_PORT;
  const otherPort = which === 'front' ? API_PORT : FRONT_PORT;
  const record = { scenario: tag, startedAt: nowIso(), occupiedPort: port, steps: {} };
  const server = http.createServer((req, res) => { res.end('占用測試'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try {
    record.steps.holder = { pid: process.pid, listeners: await listenerRows(port) };
    const run = await startSupervisor(runtimeDir, tag, { expectFailure: true });
    if (run.ready) {
      record.steps.unexpectedStop = await daily('stop');
      await waitExit(run, 15_000);
    }
    record.steps.start = { command: run.command, ready: run.ready, exit: run.exit.value, output: run.output() };
    record.steps.holderStillServing = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) })
      .then(response => response.text()).catch(error => `錯誤：${error.message}`);
    record.steps.otherPortListeners = await listenerRows(otherPort);
    record.steps.stateExists = fs.existsSync(STATE_FILE);
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
  }
  record.steps.afterClose = await listenerRows(port);
  record.checks = {
    '啟動被拒且沒有就緒': record.steps.start.ready === false && record.steps.start.exit?.code === 1,
    '訊息為不接管其他服務': record.steps.start.output.some(line => line.includes(CONFLICT_MESSAGE)),
    '占用中的服務仍正常回應': record.steps.holderStillServing === '占用測試',
    '另一個埠沒有被啟動': record.steps.otherPortListeners.length === 0,
    '沒有寫出狀態檔': record.steps.stateExists === false,
    '測試占用結束後該埠已釋放': record.steps.afterClose.length === 0,
  };
  record.pass = Object.values(record.checks).every(Boolean);
  return record;
}

// 某個子程序崩潰：監督程序必須自行停掉另一個子程序、清狀態並結束；之後重新啟動要能恢復。
async function childCrash(runtimeDir, which) {
  const tag = `crash-${which}`;
  const record = { scenario: tag, startedAt: nowIso(), steps: {} };
  const run = await startSupervisor(runtimeDir, tag);
  const state = readStateView();
  record.steps.start = { command: run.command, ready: run.ready, readyMs: run.readyMs, output: run.output() };
  record.steps.state = state?.view ?? null;
  const target = state?.view.children.find(child => child.script === (which === 'vercel' ? 'vc.js' : 'vite.js'));
  const table = await nodeProcesses();
  record.steps.target = target ? { pid: target.pid, script: target.script,
    identityVerified: table.get(target.pid)?.CreationDate === target.creationDate } : null;
  const logs = state ? launcherLogs(state.token) : null;
  record.steps.descendants = state ? await descendantsOf(state.view.supervisorPid) : [];
  if (record.steps.target?.identityVerified) {
    const killStarted = performance.now();
    const kill = await execText('taskkill', ['/PID', String(target.pid), '/T', '/F']);
    record.steps.kill = { command: `taskkill /PID ${target.pid} /T /F`, status: kill.status };
    const exitValue = await waitExit(run, 20_000);
    record.steps.supervisorExit = { value: exitValue, msAfterKill: exitValue ? Math.round(performance.now() - killStarted) : null,
      output: run.output() };
  }
  record.steps.afterCrash = await stoppedCheck(state?.view, logs?.persistent.spawns, record.steps.descendants);
  if (!isClean(record.steps.afterCrash) && fs.existsSync(STATE_FILE)) record.steps.cleanupStop = await daily('stop');
  record.recovery = await cycle(runtimeDir, `${tag}-recover`);
  record.checks = {
    '崩潰前已就緒': run.ready && Boolean(state),
    '只對核對過身分的子程序下手': record.steps.target?.identityVerified === true,
    '監督程序在 20 秒內自行結束': Boolean(record.steps.supervisorExit?.value),
    '崩潰後無狀態、無 listener、整棵子孫樹無殘留': isClean(record.steps.afterCrash),
    '重新啟動並停止均正常': record.recovery.pass,
  };
  record.pass = Object.values(record.checks).every(Boolean);
  return record;
}

// 監督程序本身被強制結束：記錄子程序是否一併結束；之後 status 要誠實回報失聯，再次啟動要能處理殘留狀態。
async function supervisorCrash(runtimeDir) {
  const tag = 'crash-supervisor';
  const record = { scenario: tag, startedAt: nowIso(), steps: {} };
  const run = await startSupervisor(runtimeDir, tag);
  const state = readStateView();
  record.steps.start = { command: run.command, ready: run.ready, readyMs: run.readyMs, output: run.output() };
  record.steps.state = state?.view ?? null;
  const logs = state ? launcherLogs(state.token) : null;
  record.steps.descendants = state ? await descendantsOf(state.view.supervisorPid) : [];
  const table = await nodeProcesses();
  const verified = Boolean(state && table.get(state.view.supervisorPid)?.CreationDate === state.view.supervisorCreationDate);
  record.steps.identityVerified = verified;
  if (verified) {
    const kill = await execText('taskkill', ['/PID', String(state.view.supervisorPid), '/F']);
    record.steps.kill = { command: `taskkill /PID ${state.view.supervisorPid} /F（不含 /T，只殺監督程序）`, status: kill.status };
    record.steps.supervisorExit = await waitExit(run, 10_000);
    await sleep(1500);
  }
  record.steps.afterCrash = await stoppedCheck(state?.view, logs?.persistent.spawns, record.steps.descendants);
  record.steps.stateLeft = fs.existsSync(STATE_FILE);
  record.steps.status = await daily('status');
  const survivors = record.steps.afterCrash.aliveLauncher.length || record.steps.afterCrash.aliveFunctions.length
    || record.steps.afterCrash.listeners.front.length || record.steps.afterCrash.listeners.api.length;
  if (survivors) {
    const refused = await startSupervisor(runtimeDir, `${tag}-refused`, { expectFailure: true });
    if (refused.ready) {
      record.steps.unexpectedStop = await daily('stop');
      await waitExit(refused, 15_000);
    }
    record.steps.startWhileStale = { ready: refused.ready, exit: refused.exit.value, output: refused.output() };
    record.steps.recover = await daily('recover');
    record.steps.afterRecover = await stoppedCheck(state?.view, logs?.persistent.spawns, record.steps.descendants);
  }
  const staleBefore = new Set(fs.readdirSync(DAILY_RUNTIME).filter(name => name.startsWith('state.json.')));
  record.recovery = await cycle(runtimeDir, `${tag}-recover`);
  record.steps.renamedStateFiles = fs.readdirSync(DAILY_RUNTIME)
    .filter(name => name.startsWith('state.json.') && !staleBefore.has(name)).map(name => name.replace(/\d+$/, '<時間戳>'));
  // 下次正常啟停之後，崩潰那棵舊樹是否仍有存活者（啟動器不知道它們，不會自動清）。
  record.steps.oldTreeAfterRecovery = (await stoppedCheck(null, [], record.steps.descendants)).aliveDescendants;
  record.checks = {
    '崩潰前已就緒且只殺核對過的監督程序': run.ready && verified,
    '監督程序已結束': Boolean(record.steps.supervisorExit),
    'status 誠實回報失聯（非 0 且說明沒有可確認的服務）': record.steps.status.status !== 0
      && record.steps.status.stderr.some(line => line.includes(NO_SERVICE_MESSAGE)),
    ...(survivors ? {
      '子程序仍在時拒絕另起並指向 recover': record.steps.startWhileStale.ready === false
        && record.steps.startWhileStale.output.some(line => line.includes(STALE_MESSAGE)),
      'recover 清掉核對過的殘留': record.steps.recover.status === 0 && isClean(record.steps.afterRecover),
    } : {
      '子程序隨監督程序一併結束（無 listener、無殘留）': !record.steps.afterCrash.listeners.front.length
        && !record.steps.afterCrash.listeners.api.length && !record.steps.afterCrash.aliveLauncher.length
        && !record.steps.afterCrash.aliveFunctions.length,
      '殘留狀態檔由下次啟動核對後改名保存': record.steps.stateLeft === true
        && record.steps.renamedStateFiles.some(name => name.startsWith('state.json.stale-')),
    }),
    '崩潰後整棵子孫樹無殘留（含 vercel 內部開發伺服器）': !(survivors ? record.steps.afterRecover : record.steps.afterCrash)
      .aliveDescendants.length,
    '下次啟停之後舊樹也無殘留': !record.steps.oldTreeAfterRecovery.length,
    '之後重新啟動並停止均正常': record.recovery.pass,
  };
  record.pass = Object.values(record.checks).every(Boolean);
  return record;
}

async function main() {
  const runId = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  const smoke = args.smoke === true;
  if (!smoke && (args['front-port'] || args['api-port'])) throw new Error('正式 run 固定 3000／3001；改埠只限 --smoke');
  if (smoke) {
    FRONT_PORT = Number(args['front-port']);
    API_PORT = Number(args['api-port']);
    if (![FRONT_PORT, API_PORT].every(port => Number.isInteger(port) && port > 1024 && port < 65535) || FRONT_PORT === 3000) {
      throw new Error('冒煙需指定 3000 以外的 --front-port 與 --api-port');
    }
  }
  if (fs.existsSync(STATE_FILE)) throw new Error('日常入口狀態檔已存在，拒絕執行');
  for (const port of [FRONT_PORT, API_PORT]) {
    if ((await listenerRows(port)).length) throw new Error(`埠 ${port} 已有 listener，不接管`);
  }
  let evidenceDir;
  let runtimeDir;
  if (smoke) {
    if (!/^life03-smoke-[a-z0-9-]+$/.test(runId ?? '')) throw new Error('冒煙 run-id 需以 life03-smoke- 開頭');
    runtimeDir = path.join(RUNTIME_ROOT, runId);
    if (fs.existsSync(runtimeDir)) throw new Error(`run-id 已使用過：${runId}`);
    evidenceDir = path.join(runtimeDir, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
  } else {
    ({ evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId }));
  }
  const git = (...gitArgs) => new Promise(resolve => execFile('git', gitArgs, { cwd: ROOT, encoding: 'utf8' },
    (error, stdout) => resolve(error ? null : stdout.trim())));
  const raw = {
    runId, kind: smoke ? 'lifecycle-smoke（開發期冒煙，非正式）' : 'lifecycle-daily-entry', formal: !smoke,
    createdAt: nowIso(), ports: { front: FRONT_PORT, api: API_PORT }, cwd: ROOT.split(path.sep).join('/'),
    git: { head: await git('rev-parse', 'HEAD'), branch: await git('rev-parse', '--abbrev-ref', 'HEAD') },
    versions: toolVersions(),
    tools: Object.fromEntries(['lifecycle-03.mjs', 'port-guard-03.mjs', 'daily-dev.mjs', 'persistent-functions.cjs', 'service-kit.mjs']
      .map(file => [file, fileSha(path.join(TOOLS, file))])),
    env: '日常命令原樣：移除 NODE_OPTIONS 與所有 PERF01_／PERF03_ 測試變數；.env 由 vercel dev 照常只給後端',
    requests: '只送前端首頁 GET 與同源 OPTIONS；不打行情、不執行 AI',
    sentinel: null, monitor: null, scenarios: [], errors: [], finalCheck: null,
  };
  const aborted = { value: false };
  let monitor = null;
  try {
    raw.sentinel = await runSentinel({ port: FRONT_PORT, durationMs: 8000, holdMs: 3000 });
    monitor = startForeignMonitor({
      port: FRONT_PORT,
      allowedRoots: () => [process.pid],
      onForeign: record => {
        aborted.value = true;
        raw.errors.push(`外部用戶端連進 ${FRONT_PORT}：PID ${record.pid}（${record.name ?? '未知'}）；中止並停止服務`);
        void daily('stop');
      },
    });
    const plan = [
      () => cycle(runtimeDir, 'cycle-1'),
      () => cycle(runtimeDir, 'cycle-2'),
      () => portConflict(runtimeDir, 'front'),
      () => portConflict(runtimeDir, 'api'),
      () => childCrash(runtimeDir, 'vercel'),
      () => childCrash(runtimeDir, 'vite'),
      () => supervisorCrash(runtimeDir),
    ];
    for (const step of plan) {
      if (aborted.value) break;
      const record = await step();
      raw.scenarios.push(record);
      console.log(`${record.scenario}：${record.pass ? 'PASS' : 'FAIL'}`);
    }
  } catch (error) {
    raw.errors.push(error.message);
  } finally {
    raw.monitor = monitor?.stop() ?? null;
    if (fs.existsSync(STATE_FILE)) {
      raw.finalStop = await daily('stop');
      if (raw.finalStop.status !== 0) raw.finalRecover = await daily('recover');
    }
    // 本輪記錄過的子孫樹若仍有存活者（例如監督程序崩潰後沒被一併結束的程序），核對 PID＋建立時間後清掉並記錄；
    // 情境判定已在前面寫定，這裡只負責不把測試殘留留在使用者的機器上。
    const recorded = [...new Map(allDescendants.map(item => [item.pid, item])).values()];
    const beforeCleanup = await processTable();
    const leftovers = recorded.filter(item => beforeCleanup.get(item.pid)?.CreationDate === item.creationDate);
    raw.leftoverCleanup = { found: leftovers.map(({ pid, name, parentPid }) => ({ pid, name, parentPid })), killed: [] };
    for (const item of leftovers) {
      if ((await processTable()).get(item.pid)?.CreationDate !== item.creationDate) continue;   // 已隨上一棵樹結束
      const result = await execText('taskkill', ['/PID', String(item.pid), '/T', '/F']);
      raw.leftoverCleanup.killed.push({ pid: item.pid, name: item.name, status: result.status });
    }
    const afterCleanup = await processTable();
    raw.leftoverCleanup.stillAlive = leftovers.filter(item => afterCleanup.get(item.pid)?.CreationDate === item.creationDate)
      .map(item => item.pid);
    raw.finalCheck = { stateExists: fs.existsSync(STATE_FILE), listeners: await listeners() };
    raw.finishedAt = nowIso();
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
  }

  const problems = [...raw.errors];
  if (raw.monitor?.foreign?.length) problems.push(`監看紀錄：${JSON.stringify(raw.monitor.foreign)}`);
  if (raw.finalCheck.stateExists || raw.finalCheck.listeners.front.length || raw.finalCheck.listeners.api.length) {
    problems.push('結束時仍有狀態檔或 listener');
  }
  if (raw.scenarios.length !== 7) problems.push(`情境數 ${raw.scenarios.length}/7`);
  if (raw.leftoverCleanup?.stillAlive?.length) problems.push(`測試殘留程序清不掉：${raw.leftoverCleanup.stillAlive.join(',')}`);
  const leaks = scanSecrets(evidenceDir);
  if (leaks.length) problems.push(`證據疑似含秘密：${leaks.map(hit => `${hit.file}:${hit.key}`).join(',')}`);
  const failed = raw.scenarios.filter(record => !record.pass).map(record => ({
    scenario: record.scenario,
    failedChecks: Object.entries(record.checks).filter(([, ok]) => !ok).map(([label]) => label),
    recoveryFailed: record.recovery && !record.recovery.pass
      ? Object.entries(record.recovery.checks).filter(([, ok]) => !ok).map(([label]) => label) : undefined,
  }));
  const summary = {
    runId, formal: raw.formal, ports: raw.ports, problems, failed,
    scenarios: raw.scenarios.map(record => `${record.scenario}:${record.pass ? 'PASS' : 'FAIL'}`),
    sentinel: { events: raw.sentinel?.events?.length ?? null, neutralized: raw.sentinel?.visibleTabsNeutralized ?? null },
    monitor: { checks: raw.monitor?.checks ?? null, foreign: raw.monitor?.foreign?.length ?? null },
    leftoverCleanup: raw.leftoverCleanup ?? null,
  };
  const toolSha = fileSha(fileURLToPath(import.meta.url)).slice(0, 12);
  fs.writeFileSync(path.join(evidenceDir, `lifecycle-summary-${toolSha}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(summary, null, 2));
  if (problems.length) return 2;
  return failed.length ? 1 : 0;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
