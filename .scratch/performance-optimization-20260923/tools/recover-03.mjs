#!/usr/bin/env node
// 03 票：只以本工具建立的 listener 驗證失聯復原，另驗錯誤建立時間不會殺到重用 PID。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, sleep, toolVersions } from './service-kit.mjs';

const [runId, portText] = process.argv.slice(2);
const port = Number(portText);
if (!runId || !Number.isInteger(port) || port < 1024 || port > 65534) {
  throw new Error('需要 <新 run-id> <兩個連續空埠的起點>');
}
const script = fileURLToPath(import.meta.url);
const daily = path.join(path.dirname(script), 'daily-dev.mjs');
const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const stateFile = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily', 'state.json');
const fixture = path.join(runtimeDir, 'owned-listener.mjs');
const listenerPids = () => {
  const output = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true }).stdout;
  return output.split(/\r?\n/).map(line => line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/))
    .filter(match => match && Number(match[1]) === port).map(match => Number(match[2]));
};
const identity = pid => {
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${Number(pid)}'; if ($p) { $p | Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress }`;
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 && result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const runRecover = () => spawnSync(process.execPath, [daily, 'recover'], {
  encoding: 'utf8', windowsHide: true, timeout: 20_000,
});
const raw = {
  runId, createdAt: new Date().toISOString(), port,
  source: { head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    runnerSha256: fileSha(script), dailySha256: fileSha(daily), versions: toolVersions() },
  owned: null, reusedPid: null, errors: [],
};
let child;
let token = `${runId}-owned`;
try {
  if (fs.existsSync(stateFile) || listenerPids().length) throw new Error('既有日常狀態或 listener，拒絕測試');
  fs.writeFileSync(fixture, "import net from 'node:net'; net.createServer().listen(Number(process.argv[2]), '127.0.0.1');\n");
  child = spawn(process.execPath, [fixture, String(port)], { stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 100 && listenerPids()[0] !== child.pid; i++) await sleep(100);
  const childIdentity = identity(child.pid);
  if (listenerPids()[0] !== child.pid || !childIdentity?.CreationDate) throw new Error('本工具 listener 身分不成立');
  const state = { token, pipe: `\\\\.\\pipe\\${runId}-not-listening`, supervisorPid: 0,
    frontPort: port, apiPort: port + 1,
    children: [{ pid: child.pid, script: fixture, creationDate: childIdentity.CreationDate }] };
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { flag: 'wx' });
  const result = runRecover();
  raw.owned = { pid: child.pid, creationDate: childIdentity.CreationDate,
    status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim(),
    listenerStopped: listenerPids().length === 0, stateRemoved: !fs.existsSync(stateFile) };
  if (result.status !== 0 || !raw.owned.listenerStopped || !raw.owned.stateRemoved) throw new Error('已擁有程序的復原未通過');

  token = `${runId}-reused`;
  const reused = { token, pipe: `\\\\.\\pipe\\${runId}-not-listening-2`, supervisorPid: 0,
    frontPort: port, apiPort: port + 1,
    children: [{ pid: process.pid, script, creationDate: '刻意錯誤的建立時間' }] };
  fs.writeFileSync(stateFile, `${JSON.stringify(reused)}\n`, { flag: 'wx' });
  const second = runRecover();
  raw.reusedPid = { pid: process.pid, status: second.status, stdout: second.stdout.trim(),
    stderr: second.stderr.trim(), callerAlive: Boolean(identity(process.pid)), stateRemoved: !fs.existsSync(stateFile) };
  if (second.status !== 0 || !raw.reusedPid.callerAlive || !raw.reusedPid.stateRemoved) {
    throw new Error('重用 PID 保護未通過');
  }
} catch (error) {
  raw.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (child && identity(child.pid)?.CommandLine?.includes(fixture)) child.kill();
  if (fs.existsSync(stateFile)) {
    try {
      if (JSON.parse(fs.readFileSync(stateFile, 'utf8')).token === token) fs.unlinkSync(stateFile);
    } catch { /* 保留不屬於本工具的狀態檔 */ }
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}
const pass = raw.errors.length === 0;
console.log(JSON.stringify({ runId, pass, owned: raw.owned, reusedPid: raw.reusedPid, errors: raw.errors }, null, 2));
process.exitCode = pass ? 0 : 1;
