#!/usr/bin/env node
// 03 票取消紅綠燈：只用固定假 AI，證明用戶端斷線會停止函式內的 provider。
// 用法：node .scratch/performance-optimization-20260923/tools/cancel-03.mjs <新 run-id> <b1|c> <未占用埠>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSISTENT, PRELOAD, claimRun, copyTrace, createFixtureControl, fileSha,
  persistentReport, probeEnv, sendRequest, sleep, startVercelDev, stopService,
} from './service-kit.mjs';

const [runId, entry, portText] = process.argv.slice(2);
const port = Number(portText);
if (!runId || !['b1', 'c'].includes(entry) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('需要 <新 run-id> <b1|c> <未占用埠>');
}

const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const traceDir = path.join(runtimeDir, 'trace');
const controlPath = path.join(runtimeDir, 'fixture.json');
const logFile = path.join(runtimeDir, 'vercel.log');
fs.mkdirSync(traceDir, { recursive: true });
createFixtureControl(controlPath, { ai: { deltas: 5, intervalMs: 300 } }).set();
const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const raw = {
  runId, entry, port,
  createdAt: new Date().toISOString(),
  source: {
    head: null,
    scriptSha256: fileSha(scriptFile),
    persistentSha256: fileSha(PERSISTENT),
    preloadSha256: fileSha(PRELOAD),
    streamSha256: fileSha(path.join(root, 'api/gemini-stream.ts')),
  },
  response: null,
  events: [],
  service: null,
  errors: [],
};
let svc;
try {
  const { execFileSync } = await import('node:child_process');
  raw.source.head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  svc = await startVercelDev({
    label: `03/${entry}`,
    port,
    runtimeDir,
    logFile,
    requires: entry === 'c' ? [PERSISTENT, PRELOAD] : [PRELOAD],
    env: {
      ...probeEnv({ traceDir, fixture: { delayMs: 20, controlPath } }),
      LLM_PROVIDER: 'claude-cli',
      PERF03_TEST_CLI: '1',
    },
    onStarted: started => { svc = started; },
  });
  raw.response = await sendRequest({
    port,
    method: 'POST',
    route: '/api/gemini-stream',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '取消驗收提示詞', systemInstruction: '取消驗收系統指令', mode: 'fast' }),
    stream: true,
    abortAfterLines: 1,
    trace: `${runId}-${entry}-cancel`,
  });
  await sleep(2100);
} catch (error) {
  raw.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (svc) {
    await stopService(svc);
    raw.service = { ownedPid: svc.ownedPid, listenerPid: svc.listenerPid, stopped: svc.stopped };
  }
  raw.traceFiles = copyTrace(traceDir, path.join(evidenceDir, 'trace'));
  if (entry === 'c') raw.persistent = persistentReport(logFile);
  for (const name of fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))) {
    for (const line of fs.readFileSync(path.join(traceDir, name), 'utf8').split(/\r?\n/).filter(Boolean)) {
      const ev = JSON.parse(line);
      if (ev.trace === `${runId}-${entry}-cancel`) {
        raw.events.push({ ev: ev.ev, layer: ev.layer ?? null, emitted: ev.emitted ?? null });
      }
    }
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}

const names = raw.events.map(ev => ev.ev);
const pass = raw.errors.length === 0
  && raw.response?.aborted === true
  && raw.response?.lines?.length === 1
  && raw.service?.stopped === true
  && names.includes('child.fakeCli.kill')
  && !names.includes('child.fakeCli.done')
  && raw.events.some(ev => ev.ev === 'child.aborted' && ev.layer === 'devProxy')
  && raw.events.some(ev => ev.ev === 'child.aborted' && ev.layer === 'handler');
console.log(JSON.stringify({ runId, entry, pass, response: raw.response, events: raw.events, errors: raw.errors }, null, 2));
process.exitCode = pass ? 0 : 1;
