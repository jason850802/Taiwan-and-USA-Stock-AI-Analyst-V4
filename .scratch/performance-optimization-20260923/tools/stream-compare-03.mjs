#!/usr/bin/env node
// P2：同份產品碼、原 Vercel 入口 B1 與長駐候選，沿用正式 App 六步操作及假 CLI。
// 用法：node tools/stream-compare-03.mjs <新 run-id> <起始備用埠>
// 依序跑 B1 桌面、候選桌面、候選窄版、B1 窄版；每臂新服務／新 origin／新 Chrome 資料目錄。
// 只保存觀察結果；不裁定新增請求分類。預設每種視窗每入口一筆串流。
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStreamViewport } from './app-03.mjs';
import { identityFields, launcherTree, listenerRows, nodeProcesses, processTable, terminateVerifiedTree } from './port-guard-03.mjs';
import { claimRun, copyTrace, fileSha, identity, identityAfter, sleep, toolVersions } from './service-kit.mjs';
import { ROOT, scanSecrets } from './verify-b1-breakdown.mjs';

const [runId, baseText] = process.argv.slice(2);
const base = Number(baseText);
if (!Number.isInteger(base) || base < 10000 || base > 65000) throw new Error('需提供未使用過的備用埠（10000～65000）');
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const names = ['stream-compare-03.mjs', 'app-03.mjs', 'port-guard-03.mjs', 'service-kit.mjs',
  'verify-b1-breakdown.mjs', 'trace-preload.cjs', 'persistent-functions.cjs'];
const source = identity('b1');
// 正式對照必須與 HEAD blob 相同；不能事後提交來追認執行身分。
const binding = names.map(file => {
  const relative = `.scratch/performance-optimization-20260923/tools/${file}`;
  const blob = execFileSync('git', ['rev-parse', `HEAD:${relative}`], { cwd: ROOT, encoding: 'utf8' }).trim();
  const actual = execFileSync('git', ['hash-object', relative], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (actual !== blob) throw new Error(`工具與提交版不同：${file}`);
  return { file, blob, sha256: fileSha(path.join(toolsDir, file)) };
});
const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const raw = { runId, createdAt: new Date().toISOString(), kind: 'B1／候選 App 假 CLI 串流對照',
  classificationDecision: '待使用者裁定', source, tools: binding, versions: toolVersions(), arms: [], errors: [] };
const systemNames = new Set(['appdata', 'comspec', 'home', 'homedrive', 'homepath', 'localappdata', 'path',
  'pathext', 'systemroot', 'temp', 'tmp', 'userprofile', 'windir']);
const plan = [['b1', 'desktop'], ['c', 'desktop'], ['c', 'narrow'], ['b1', 'narrow']];
async function start(arm, name, argv, env, port, marker, dir) {
  if ((await listenerRows(port)).length) throw new Error(`備用埠 ${port} 被占用`);
  const logFile = path.join(dir, `${name}.log`);
  const fd = fs.openSync(logFile, 'wx');
  const child = spawn(process.execPath, argv, { cwd: ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true });
  fs.closeSync(fd);
  const state = { name, pid: child.pid, port, script: path.basename(argv[0]), exit: null, ready: false, tree: [] };
  arm.services.push(state);
  child.once('exit', (code, signal) => { state.exit = { code, signal }; });
  const initial = await processTable();
  const root = initial.get(child.pid);
  if (!root?.CreationDate) throw new Error(`${name} 缺程序身分`);
  state.creationDate = root.CreationDate;
  state.tree = [{ pid: child.pid, creationDate: root.CreationDate }, ...launcherTree(initial, child.pid)];
  const began = Date.now();
  while (Date.now() - began < 120_000) {
    const log = fs.readFileSync(logFile, 'utf8');
    if (state.exit || /No existing credentials|Starting login flow|oauth\/device/.test(log)) throw new Error(`${name} 提前停止或要求登入`);
    if (marker.test(log)) {
      const listeners = await listenerRows(port);
      if (listeners.length !== 1 || listeners[0].pid !== child.pid) throw new Error(`${name} listener 不屬於本輪`);
      state.listeners = listeners;
      state.ready = true;
      state.readyMs = Date.now() - began;
      const table = await processTable();
      state.tree.push(...launcherTree(table, child.pid));
      state.identity = identityFields(await nodeProcesses(), [child.pid]);
      return log;
    }
    await sleep(250);
  }
  throw new Error(`${name} 啟動逾時`);
}
try {
  for (const [index, [entry, viewportName]] of plan.entries()) {
    const frontPort = base + index * 2;
    const apiPort = frontPort + 1;
    const dir = path.join(runtimeDir, `${entry}-${viewportName}`);
    fs.mkdirSync(dir);
    const traceDir = path.join(dir, 'trace');
    const envDir = path.join(dir, 'front-env');
    fs.mkdirSync(traceDir);
    fs.mkdirSync(envDir);
    const controlPath = path.join(dir, 'control.json');
    fs.writeFileSync(controlPath, JSON.stringify({ version: 'stream-review-v1', clockOffsetMs: 0, script: {}, delayMs: {}, ai: {} }));
    const arm = { entry, viewportName, frontPort, apiPort, services: [], viewport: null, errors: [] };
    raw.arms.push(arm);
    try {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.toUpperCase() === 'NODE_OPTIONS' || /^PERF0[13]_/.test(key)) delete env[key];
      const preloads = [...(entry === 'c' ? ['persistent-functions.cjs'] : []), 'trace-preload.cjs'];
      Object.assign(env, { NODE_OPTIONS: preloads.map(file => `--require "${path.join(toolsDir, file).replaceAll('\\', '/')}"`).join(' '),
        PERF01_FIXTURE: '1', PERF01_FIXTURE_DELAY_MS: '50', PERF01_TRACE_DIR: traceDir, PERF01_FIXTURE_CONTROL: controlPath,
        PERF03_TEST_APP: '1', PERF03_TEST_CLI: '1' });
      arm.preloads = preloads;
      const log = await start(arm, 'vercel', [path.join(process.env.APPDATA, 'npm/node_modules/vercel/dist/vc.js'),
        'dev', '--listen', `127.0.0.1:${apiPort}`], env, apiPort, /Ready! Available at/, dir);
      arm.persistentEnabled = log.includes('[persistent-functions] 已啟用');
      if (arm.persistentEnabled !== (entry === 'c')) throw new Error('入口與長駐啟用狀態不符');
      const frontEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemNames.has(key.toLowerCase()) || /^VITE_/i.test(key)));
      Object.assign(frontEnv, { LOCAL_API_ORIGIN: `http://127.0.0.1:${apiPort}`, LOCAL_FRONTEND_ENV_DIR: envDir });
      await start(arm, 'vite', [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', String(frontPort), '--strictPort'],
        frontEnv, frontPort, /ready in/i, dir);
      arm.viewport = await runStreamViewport({ frontPort, name: `${entry}-${viewportName}`,
        viewport: viewportName === 'desktop' ? { width: 1280, height: 720, mobile: false } : { width: 375, height: 812, mobile: true },
        runtimeDir: dir, evidenceDir, chromePids: new Set(), abortSignal: { aborted: false } });
    } catch (error) { arm.errors.push(error.message); }
    finally {
      for (const service of [...arm.services].reverse()) service.cleanup = await terminateVerifiedTree(service.tree);
      arm.listenersAfter = { front: await listenerRows(frontPort), api: await listenerRows(apiPort) };
      arm.traceFiles = copyTrace(traceDir, path.join(evidenceDir, `${entry}-${viewportName}-trace`));
      const events = fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))
        .flatMap(file => fs.readFileSync(path.join(traceDir, file), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
      arm.traceCounts = {};
      for (const event of events) arm.traceCounts[event.ev] = (arm.traceCounts[event.ev] ?? 0) + 1;
      fs.writeFileSync(path.join(evidenceDir, `${entry}-${viewportName}.json`), `${JSON.stringify(arm, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ entry, viewportName, errors: arm.errors, streams: arm.viewport?.ops.flatMap(op => op.requests)
        .filter(req => req.route === '/api/gemini-stream'), traceCounts: arm.traceCounts }));
    }
    if (arm.errors.length || arm.services.some(service => service.cleanup.stillAlive.length)
      || arm.listenersAfter.front.length || arm.listenersAfter.api.length) throw new Error('本臂失敗或清理不完整；停止後續起跑');
  }
} catch (error) { raw.errors.push(error.message); }
finally {
  raw.after = identityAfter();
  raw.sourceStable = source.product.aggregateSha256 === raw.after.productSha256 && source.git.head === raw.after.head
    && binding.every(item => fileSha(path.join(toolsDir, item.file)) === item.sha256);
  raw.finishedAt = new Date().toISOString();
  raw.summary = raw.arms.map(arm => ({ entry: arm.entry, viewport: arm.viewportName, errors: arm.errors,
    streams: arm.viewport?.ops.filter(op => op.requests.some(req => req.route === '/api/gemini-stream')).map(op => ({
      op: op.id, ui: op.verdict.ui, keys: op.verdict.keys, console: op.verdict.console,
      requests: op.requests.filter(req => req.route === '/api/gemini-stream'),
    })) ?? [], fakeCliSpawn: arm.traceCounts?.['child.fakeCli.spawn'] ?? 0,
    fakeCliDone: arm.traceCounts?.['child.fakeCli.done'] ?? 0,
    blocked: Object.entries(arm.traceCounts ?? {}).filter(([key]) => /Blocked/.test(key)),
    profileRemoved: arm.viewport?.profileRemoved, closedCleanly: arm.viewport?.closedCleanly }));
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' });
  const leaks = scanSecrets(evidenceDir);
  console.log(JSON.stringify({ runId, sourceStable: raw.sourceStable, errors: raw.errors, leaks: leaks.length, summary: raw.summary }, null, 2));
  process.exitCode = raw.errors.length || !raw.sourceStable || leaks.length || raw.arms.length !== 4 ? 1 : 0;
}
