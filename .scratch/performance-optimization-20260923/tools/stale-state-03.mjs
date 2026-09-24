#!/usr/bin/env node
// 03 票殘留狀態驗收：控制管道失聯且舊 listener 尚在時，不得另起服務或覆寫狀態。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha } from './service-kit.mjs';

const [runId, oldPortText, frontPortText, apiPortText] = process.argv.slice(2);
const [oldPort, frontPort, apiPort] = [oldPortText, frontPortText, apiPortText].map(Number);
if (!runId || [oldPort, frontPort, apiPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535)
  || new Set([oldPort, frontPort, apiPort]).size !== 3) {
  throw new Error('需要 <新 run-id> <舊 listener 埠> <新前端埠> <新後端埠>');
}

const scriptFile = fileURLToPath(import.meta.url);
const dailyFile = path.join(path.dirname(scriptFile), 'daily-dev.mjs');
const { evidenceDir } = claimRun({ ticket: '03', runId });
const stateFile = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily', 'state.json');
const raw = { runId, createdAt: new Date().toISOString(), ports: { oldPort, frontPort, apiPort },
  source: { runnerSha256: fileSha(scriptFile), dailySha256: fileSha(dailyFile) },
  start: null, statePreserved: false, oldListenerAlive: false, newPortsFree: false, errors: [] };
let server;
let createdState = false;
try {
  if (fs.existsSync(stateFile)) throw new Error('日常狀態檔已存在，拒絕覆寫');
  server = net.createServer(socket => socket.end('舊服務仍在'));
  await new Promise((resolve, reject) => server.listen(oldPort, '127.0.0.1', error => error ? reject(error) : resolve()));
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const state = { token: 'stale-state-03', pipe: '\\\\.\\pipe\\stock-perf03-stale-state-03',
    supervisorPid: 0, frontPort: oldPort, apiPort: oldPort + 1, children: [] };
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { flag: 'wx' });
  createdState = true;
  const result = spawnSync(process.execPath, [dailyFile, 'start', '--front-port', String(frontPort),
    '--api-port', String(apiPort)], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  raw.start = { status: result.status, stderr: result.stderr.trim(), stdout: result.stdout.trim() };
  raw.statePreserved = fs.readFileSync(stateFile, 'utf8') === `${JSON.stringify(state)}\n`;
  raw.oldListenerAlive = server.listening;
  const netstat = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
  raw.newPortsFree = !netstat.stdout.split(/\r?\n/).some(line =>
    /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+\d+\s*$/.test(line)
    && [frontPort, apiPort].includes(Number(line.match(/^\s*TCP\s+\S+:(\d+)/)[1])));
} catch (error) {
  raw.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (createdState) fs.rmSync(stateFile);
  if (server) await new Promise(resolve => server.close(resolve));
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}
const pass = raw.errors.length === 0 && raw.start?.status !== 0
  && raw.start.stderr.includes('控制管道失聯') && raw.statePreserved
  && raw.oldListenerAlive && raw.newPortsFree;
console.log(JSON.stringify({ runId, pass, ...raw }, null, 2));
process.exitCode = pass ? 0 : 1;
