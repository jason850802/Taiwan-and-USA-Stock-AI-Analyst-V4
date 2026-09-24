#!/usr/bin/env node
// 03 票補驗：搜尋、FinMind 與非串流假 AI 在用戶端斷線後停止本次上游工作。
// 用法：node .scratch/performance-optimization-20260923/tools/route-cancel-03.mjs <新 run-id> <search|finmind|gemini> <空埠>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSISTENT, PRELOAD, claimRun, copyTrace, createFixtureControl, fileSha,
  persistentReport, probeEnv, sendRequest, sleep, startVercelDev, stopService, waitForTraceEvent,
} from './service-kit.mjs';

const [runId, routeKind, portText] = process.argv.slice(2);
const port = Number(portText);
if (!runId || !['search', 'finmind', 'gemini'].includes(routeKind)
  || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('需要 <新 run-id> <search|finmind|gemini> <空埠>');
}
const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const traceDir = path.join(runtimeDir, 'trace');
const controlPath = path.join(runtimeDir, 'fixture.json');
const logFile = path.join(runtimeDir, 'vercel.log');
fs.mkdirSync(traceDir, { recursive: true });
createFixtureControl(controlPath, routeKind === 'gemini'
  ? { ai: { deltas: 5, intervalMs: 3000 } }
  : { script: { [routeKind === 'search' ? 'yahoo-search' : 'finmind']: [{ delayMs: 3000 }] } }).set();
const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const sourceFiles = routeKind === 'search' ? ['api/yahoo/search.ts', 'api/_lib/yahoo.ts']
  : routeKind === 'finmind' ? ['api/finmind.ts'] : ['api/gemini.ts', 'api/_lib/llm.ts', 'api/_lib/http.ts'];
const raw = {
  runId, routeKind, port, createdAt: new Date().toISOString(),
  source: {
    runnerSha256: fileSha(scriptFile), persistentSha256: fileSha(PERSISTENT),
    preloadSha256: fileSha(PRELOAD),
    files: Object.fromEntries(sourceFiles.map(file => [file, fileSha(path.join(root, file))])),
  },
  reachedTarget: false, response: null, events: [], errors: [], service: null,
};
const trace = `${runId}-cancel`;
const targetKind = routeKind === 'search' ? 'yahoo-search' : routeKind;
let svc;
try {
  svc = await startVercelDev({
    label: `03/${routeKind}-cancel`, port, runtimeDir, logFile,
    requires: [PERSISTENT, PRELOAD],
    env: {
      ...probeEnv({ traceDir, fixture: { delayMs: 20, controlPath } }),
      ...(routeKind === 'gemini' ? { PERF03_TEST_CLI: '1' } : {}),
    },
    onStarted: started => { svc = started; },
  });
  const abortRef = {};
  const request = routeKind === 'gemini'
    ? sendRequest({ port, method: 'POST', route: '/api/gemini', trace, abortRef,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '取消驗收提示詞', systemInstruction: '取消驗收系統指令', mode: 'fast' }) })
    : sendRequest({ port, trace, abortRef,
      route: routeKind === 'search' ? '/api/yahoo/search?q=AAPL&quotesCount=5'
        : '/api/finmind?dataset=TaiwanStockPrice&data_id=2330&start_date=2026-09-01' });
  raw.reachedTarget = await waitForTraceEvent(traceDir, event => event.trace === trace
    && event.ev === (routeKind === 'gemini' ? 'child.fakeCli.spawn' : 'child.fetchStart')
    && (routeKind === 'gemini' || event.kind === targetKind));
  if (!raw.reachedTarget) throw new Error(`${routeKind} 未進入假上游，無法驗證取消`);
  await sleep(100);
  abortRef.abort?.();
  raw.response = await request;
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
      if (event.trace === trace) {
        raw.events.push({ ev: event.ev, kind: event.kind ?? null, name: event.name ?? null,
          layer: event.layer ?? null, emitted: event.emitted ?? null });
      }
    }
  }
  raw.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
}
const names = raw.events.map(event => event.ev);
const pass = raw.errors.length === 0 && raw.reachedTarget && raw.response?.aborted === true
  && raw.service?.stopped === true
  && raw.events.some(event => event.ev === 'child.aborted' && event.layer === 'handler')
  && (routeKind === 'gemini'
    ? names.includes('child.fakeCli.kill') && !names.includes('child.fakeCli.done')
    : raw.events.some(event => event.ev === 'child.fetchError' && event.kind === targetKind
      && event.name === 'AbortError')
      && !raw.events.some(event => event.ev === 'child.fetchHeaders' && event.kind === targetKind));
console.log(JSON.stringify({ runId, routeKind, pass, response: raw.response,
  events: raw.events, errors: raw.errors }, null, 2));
process.exitCode = pass ? 0 : 1;
