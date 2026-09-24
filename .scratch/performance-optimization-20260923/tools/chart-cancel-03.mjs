#!/usr/bin/env node
// 03 票固定資料取消驗證：A 中止後 chart 不再完成；同時的 B 不受影響。
// 用法：node .scratch/performance-optimization-20260923/tools/chart-cancel-03.mjs <新 run-id> <未占用埠> [chart|cookie|shared-cookie]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSISTENT, PRELOAD, claimRun, copyTrace, createFixtureControl, fileSha,
  persistentReport, probeEnv, sendRequest, sleep, startVercelDev, stopService, waitForTraceEvent,
} from './service-kit.mjs';

const [runId, portText, phase = 'chart'] = process.argv.slice(2);
const port = Number(portText);
if (!runId || !Number.isInteger(port) || port < 1024 || port > 65535
  || !['chart', 'cookie', 'shared-cookie'].includes(phase)) {
  throw new Error('需要 <新 run-id> <未占用埠> [chart|cookie|shared-cookie]');
}

const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const traceDir = path.join(runtimeDir, 'trace');
const controlPath = path.join(runtimeDir, 'fixture.json');
const logFile = path.join(runtimeDir, 'vercel.log');
fs.mkdirSync(traceDir, { recursive: true });
createFixtureControl(controlPath, { script: phase === 'chart'
  ? { 'yahoo-chart:AMZN': [{ delayMs: 3000 }] }
  : { 'yahoo-cookie': [{ delayMs: 3000 }] } }).set();
const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const raw = {
  runId, port, phase, createdAt: new Date().toISOString(),
  source: {
    runnerSha256: fileSha(scriptFile), persistentSha256: fileSha(PERSISTENT),
    preloadSha256: fileSha(PRELOAD),
    chartSha256: fileSha(path.join(root, 'api/yahoo/chart.ts')),
    yahooSha256: fileSha(path.join(root, 'api/_lib/yahoo.ts')),
  },
  reachedTarget: false, a: null, b: null, events: [], errors: [], service: null,
};
let svc;
try {
  svc = await startVercelDev({
    label: '03/chart-cancel', port, runtimeDir, logFile,
    requires: [PERSISTENT, PRELOAD],
    env: probeEnv({ traceDir, fixture: { delayMs: 20, controlPath } }),
    onStarted: started => { svc = started; },
  });
  const abortRef = {};
  const firstTrace = `${runId}-a`;
  const secondTrace = `${runId}-b`;
  const first = sendRequest({ port, route: '/api/yahoo/chart?symbol=AMZN&interval=1d&range=5d', trace: firstTrace, abortRef });
  const targetKind = phase === 'chart' ? 'yahoo-chart' : 'yahoo-cookie';
  raw.reachedTarget = await waitForTraceEvent(traceDir, event => event.trace === firstTrace
    && event.ev === 'child.fetchStart' && event.kind === targetKind);
  if (!raw.reachedTarget) throw new Error(`A 未進入 ${targetKind} 上游，無法驗證取消`);
  const second = phase === 'cookie' ? null : sendRequest({ port,
    route: '/api/yahoo/chart?symbol=NVDA&interval=1d&range=5d', trace: secondTrace });
  await sleep(phase === 'shared-cookie' ? 300 : 100);
  abortRef.abort?.();
  raw.a = await first;
  if (second) raw.b = await second;
  await sleep(3500);
} catch (error) {
  raw.errors.push(error instanceof Error ? error.message : String(error));
} finally {
  if (svc) {
    await stopService(svc);
    raw.service = { ownedPid: svc.ownedPid, listenerPid: svc.listenerPid, stopped: svc.stopped };
  }
  raw.traceFiles = copyTrace(traceDir, path.join(evidenceDir, 'trace'));
  raw.persistent = persistentReport(logFile);
  for (const name of fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))) {
    for (const line of fs.readFileSync(path.join(traceDir, name), 'utf8').split(/\r?\n/).filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.trace === `${runId}-a` || event.trace === `${runId}-b`) {
        raw.events.push({ trace: event.trace, ev: event.ev, kind: event.kind ?? null, name: event.name ?? null, layer: event.layer ?? null });
      }
    }
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}

const aEvents = raw.events.filter(event => event.trace === `${runId}-a`);
const bEvents = raw.events.filter(event => event.trace === `${runId}-b`);
const pass = raw.errors.length === 0 && raw.reachedTarget && raw.a?.aborted === true
  && (phase === 'cookie' || raw.b?.status === 200) && raw.service?.stopped === true
  && aEvents.some(event => event.ev === 'child.aborted' && event.layer === 'handler')
  && (phase === 'chart' || !aEvents.some(event => event.ev === 'child.fetchStart' && event.kind === 'yahoo-chart'))
  && (phase === 'chart'
    ? aEvents.some(event => event.ev === 'child.fetchError' && event.kind === 'yahoo-chart')
      && !aEvents.some(event => event.ev === 'child.fetchHeaders' && event.kind === 'yahoo-chart')
    : phase === 'cookie'
      ? aEvents.some(event => event.ev === 'child.fetchError' && event.kind === 'yahoo-cookie')
        && !aEvents.some(event => event.ev === 'child.fetchHeaders' && event.kind === 'yahoo-cookie')
      : aEvents.some(event => event.ev === 'child.fetchHeaders' && event.kind === 'yahoo-cookie')
        && !bEvents.some(event => event.ev === 'child.fetchStart' && event.kind === 'yahoo-cookie'))
  && (phase === 'cookie' || bEvents.some(event => event.ev === 'child.fetchHeaders' && event.kind === 'yahoo-chart'));
console.log(JSON.stringify({ runId, phase, pass, reachedTarget: raw.reachedTarget, firstAborted: raw.a?.aborted,
  secondStatus: raw.b?.status, first: aEvents, second: bEvents, errors: raw.errors }, null, 2));
process.exitCode = pass ? 0 : 1;
