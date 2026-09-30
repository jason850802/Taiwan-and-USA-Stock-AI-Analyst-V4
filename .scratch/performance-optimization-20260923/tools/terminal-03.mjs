// 隱藏且獨立的 Windows console，驗 Ctrl+C、關窗與切回 B1；不操作使用者終端機。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sleep } from './service-kit.mjs';
import { ROOT, scanSecrets } from './verify-b1-breakdown.mjs';
import { launcherTree, listenerRows, processTable, terminateVerifiedTree, runSentinel, startForeignMonitor } from './port-guard-03.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const daily = path.join(directory, 'daily-dev.mjs');
const helper = path.join(directory, 'console-control-03.py');
const statePath = path.join(process.env.LOCALAPPDATA, 'Temp/perf-opt-20260923/daily/state.json');
const ports = [3000, 3001];
const recorded = [];
const allowedRoots = [process.pid];
const consoles = [];
let aborted = false;
const assertActive = () => { if (aborted) throw new Error('外部用戶端事件後停止後續起跑'); };
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toUpperCase() === 'NODE_OPTIONS' || /^PERF0[13]_/.test(key)) delete env[key];
const invoke = (executable, args) => execFileSync(executable, args, { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 15000 });
const launch = async (log, executable, args) => {
  assertActive();
  const child = JSON.parse(invoke('python', [helper, 'launch', log, ROOT, executable, ...args]));
  // 一取得出生身分即保存；後續 CIM／第二個啟動失敗仍有自己的 console 可安全關閉。
  consoles.push(child);
  allowedRoots.push(child.pid);
  await observe(child);
  assertActive();
  return child;
};
const observe = async child => {
  const { pid, creationFileTime } = child;
  const table = await processTable();
  const root = table.get(pid);
  if (!root) throw new Error('測試根程序已退出');
  const legacy = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(String(root.CreationDate));
  const actualMs = legacy ? Number(legacy[1]) : Date.parse(root.CreationDate);
  const expectedMs = Number((BigInt(creationFileTime) - 116444736000000000n) / 10000n);
  if (actualMs !== expectedMs) throw new Error('CIM 根程序與啟動 FILETIME 不符，拒絕認領');
  invoke('python', [helper, 'verify', String(pid), creationFileTime]);
  const tree = [{ pid, parentPid: root.ParentProcessId, name: root.Name, creationDate: root.CreationDate }, ...launcherTree(table, pid)];
  recorded.push(...tree);
  return tree;
};
const clean = async tree => {
  const table = await processTable();
  return { stateRemoved: !fs.existsSync(statePath), ports: await Promise.all(ports.map(listenerRows)),
    alive: tree.filter(item => table.get(item.pid)?.CreationDate === item.creationDate).map(item => ({ pid: item.pid, name: item.name })) };
};
const isClean = value => value.stateRemoved && value.ports.every(rows => rows.length === 0) && value.alive.length === 0;
const waitClean = async tree => {
  let result;
  for (let i = 0; i < 20; i++) { result = await clean(tree); if (isClean(result)) return result; await sleep(500); }
  return result;
};
async function ready(log) {
  for (let i = 0; i < 240; i++) {
    assertActive();
    if (fs.readFileSync(log, 'utf8').includes('日常入口已就緒')) return true;
    await sleep(500);
  }
  return false;
}
async function http() {
  assertActive();
  const page = await fetch('http://localhost:3000/', { signal: AbortSignal.timeout(10000) });
  const html = await page.text();
  const options = await fetch('http://localhost:3000/api/yahoo/chart?symbol=AAPL', { method: 'OPTIONS', signal: AbortSignal.timeout(10000) });
  await options.arrayBuffer();
  return { page: page.status, hasRoot: html.includes('<div id="root"></div>'), options: options.status };
}
async function main() {
  const runId = process.argv[2];
  if (fs.existsSync(statePath) || (await Promise.all(ports.map(listenerRows))).some(rows => rows.length)) throw new Error('日常狀態或原埠已占用，拒絕測試');
  const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
  const files = ['terminal-03.mjs', 'console-control-03.py', 'daily-dev.mjs', 'port-guard-03.mjs', 'service-kit.mjs'];
  const head = invoke('git', ['rev-parse', 'HEAD']).trim();
  for (const file of files) {
    const committed = execFileSync('git', ['show', `${head}:.scratch/performance-optimization-20260923/tools/${file}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!committed.equals(fs.readFileSync(path.join(directory, file)))) throw new Error(`工具未提交：${file}`);
  }
  const raw = { runId, head, startedAt: new Date().toISOString(), tools: Object.fromEntries(files.map(file => [file, fileSha(path.join(directory, file))])),
    requests: '僅首頁 GET 與 OPTIONS，無 browser／帳本／行情／AI', scenarios: [], errors: [] };
  let monitor;
  let foreignCleanup;
  try {
    raw.sentinel = await runSentinel({ port: 3000, durationMs: 8000, holdMs: 3000 });
    if (raw.sentinel.events.length) throw new Error('仍有原埠分頁重連，停止驗收');
    monitor = startForeignMonitor({ port: 3000, allowedRoots: () => allowedRoots, onForeign: () => {
      aborted = true;
      raw.errors.push('原埠外部用戶端連入');
      foreignCleanup ??= terminateVerifiedTree([...recorded]).catch(error => { raw.errors.push(error.message); });
    } });
    for (const mode of ['ctrl-c', 'close-window']) {
      const log = path.join(runtimeDir, `${mode}.log`);
      const child = await launch(log, process.execPath, [daily, 'start']);
      const started = await ready(log);
      const tree = await observe(child);
      const checks = started ? await http() : null;
      const signal = JSON.parse(invoke('python', [helper, mode, String(child.pid), child.creationFileTime]));
      const final = await waitClean(tree);
      raw.scenarios.push({ mode, child, tree, http: checks, signal, final, pass: started && checks.page === 200 && checks.hasRoot && checks.options === 204 && isClean(final) });
      if (!isClean(final)) throw new Error(`${mode} 清理未完成`);
    }
    // 實際執行回復文件中的原 B1 service 命令；兩個 console 都是本工具新建。
    const b1 = [];
    for (const service of ['backend', 'frontend']) b1.push(await launch(path.join(runtimeDir, `b1-${service}.log`), 'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', path.join(ROOT, 'scripts/start-dev.ps1'), '-Service', service]));
    let checks;
    for (let i = 0; i < 120; i++) {
      assertActive();
      try { checks = await http(); if (checks.page === 200 && checks.options === 204) break; } catch { /* 等待 B1 啟動 */ }
      await sleep(500);
    }
    const tree = (await Promise.all(b1.map(child => observe(child)))).flat();
    // 正常停止這兩個測試 console，不按使用者服務的埠猜 PID。
    const signals = b1.map(child => JSON.parse(invoke('python', [helper, 'ctrl-c', String(child.pid), child.creationFileTime])));
    const final = await waitClean(tree);
    raw.scenarios.push({ mode: 'rollback-b1', command: 'powershell.exe -File scripts/start-dev.ps1 -Service backend/frontend',
      sourceSha256: fileSha(path.join(ROOT, 'scripts/start-dev.ps1')), b1, tree, http: checks, signals, final,
      pass: checks?.page === 200 && checks.hasRoot && checks.options === 204 && isClean(final) });
  } catch (error) { raw.errors.push(error.message); }
  finally {
    raw.monitor = monitor?.stop() ?? null;
    await foreignCleanup;
    if (fs.existsSync(statePath)) {
      try { invoke(process.execPath, [daily, 'stop']); } catch { try { invoke(process.execPath, [daily, 'recover']); } catch { /* 最後依已記錄身分清理 */ } }
    }
    const unique = [...new Map(recorded.map(item => [`${item.pid}|${item.creationDate}`, item])).values()];
    // 先以還存活的出生錨點擴展當下子孫；不可先關 console 而丟失祖先。
    raw.cleanup = await terminateVerifiedTree(unique);
    // CIM 初始觀察失敗等後備情境：再用精確 FILETIME 核對自己的 console。
    for (const child of consoles) {
      try {
        process.kill(child.pid, 0);
        invoke('python', [helper, 'close-window', String(child.pid), child.creationFileTime]);
      } catch { /* 已退出或 PID 重用；helper 的出生守衛會拒絕 */ }
    }
    raw.final = await clean(unique);
    raw.finishedAt = new Date().toISOString();
    raw.pass = raw.errors.length === 0 && !raw.monitor?.foreign.length && raw.scenarios.length === 3 && raw.scenarios.every(item => item.pass) && isClean(raw.final);
    fs.writeFileSync(path.join(evidenceDir, 'raw.json'), JSON.stringify(raw, null, 2) + '\n', { flag: 'wx' });
    const leaks = scanSecrets(evidenceDir);
    if (leaks.length) throw new Error('終端證據秘密掃描未過');
  }
  console.log(JSON.stringify({ runId, pass: raw.pass, scenarios: raw.scenarios.map(({ mode, pass }) => ({ mode, pass })), errors: raw.errors }));
  process.exitCode = raw.pass ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
