#!/usr/bin/env node
// 03 票限流等待取消驗收：斷線發生在 guard 尚未返回時，不得再啟動行情或 AI 上游。
// 用法：node .scratch/performance-optimization-20260923/tools/guard-cancel-03.mjs <新 run-id> <五個連續空埠的起點>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSISTENT, PRELOAD, claimRun, copyTrace, createFixtureControl, fileSha,
  persistentReport, probeEnv, sendRequest, sleep, startVercelDev, stopService, waitForTraceEvent,
} from './service-kit.mjs';

const [runId, portText] = process.argv.slice(2);
const portBase = Number(portText);
if (!runId || !Number.isInteger(portBase) || portBase < 1024 || portBase > 65531) {
  throw new Error('需要 <新 run-id> <五個連續空埠的起點>');
}
const { evidenceDir, runtimeDir } = claimRun({ ticket: '03', runId });
const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const cases = [
  { name: 'chart', route: '/api/yahoo/chart?symbol=AMZN&interval=1d&range=5d' },
  { name: 'search', route: '/api/yahoo/search?q=AAPL&quotesCount=5' },
  { name: 'finmind', route: '/api/finmind?dataset=TaiwanStockPrice&data_id=2330&start_date=2026-09-01' },
  { name: 'gemini', route: '/api/gemini', method: 'POST' },
  { name: 'stream', route: '/api/gemini-stream', method: 'POST' },
];
const raw = {
  runId, portBase, createdAt: new Date().toISOString(),
  source: {
    runnerSha256: fileSha(scriptFile), persistentSha256: fileSha(PERSISTENT),
    preloadSha256: fileSha(PRELOAD),
    handlers: Object.fromEntries([
      'api/yahoo/chart.ts', 'api/yahoo/search.ts', 'api/finmind.ts', 'api/gemini.ts',
      'api/gemini-stream.ts',
    ].map(file => [file, fileSha(path.join(root, file))])),
  },
  cases: [], finishedAt: null,
};
for (const [index, testCase] of cases.entries()) {
  const port = portBase + index;
  const caseDir = path.join(runtimeDir, testCase.name);
  const traceDir = path.join(caseDir, 'trace');
  const controlPath = path.join(caseDir, 'fixture.json');
  const logFile = path.join(caseDir, 'vercel.log');
  fs.mkdirSync(traceDir, { recursive: true });
  createFixtureControl(controlPath, { script: { ratelimit: [{ delayMs: 3000 }] } }).set();
  const trace = `${runId}-${testCase.name}`;
  const item = { name: testCase.name, port, reachedGuard: false, response: null,
    events: [], errors: [], service: null, persistent: null };
  let svc;
  try {
    svc = await startVercelDev({
      label: `03/guard-${testCase.name}`, port, runtimeDir: caseDir, logFile,
      requires: [PERSISTENT, PRELOAD],
      env: {
        ...probeEnv({ traceDir, fixture: { delayMs: 20, controlPath } }),
        UPSTASH_REDIS_REST_URL: 'https://perf03-fixture.upstash.io',
        UPSTASH_REDIS_REST_TOKEN: 'perf03-fixture-token',
        PERF03_TEST_CLI: '1',
      },
      onStarted: started => { svc = started; },
    });
    const abortRef = {};
    const request = sendRequest({ port, route: testCase.route, method: testCase.method ?? 'GET',
      trace, abortRef, ...(testCase.method === 'POST' ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '取消驗收提示詞', systemInstruction: '取消驗收系統指令', mode: 'fast' }),
      } : {}) });
    item.reachedGuard = await waitForTraceEvent(traceDir, event => event.trace === trace
      && event.ev === 'child.fetchStart' && event.kind === 'ratelimit');
    if (!item.reachedGuard) throw new Error('限流假上游未開始，無法驗證 guard 階段取消');
    await sleep(100);
    abortRef.abort?.();
    item.response = await request;
    await sleep(3500);
  } catch (error) {
    item.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (svc) {
      await stopService(svc);
      item.service = { ownedPid: svc.ownedPid, listenerPid: svc.listenerPid, stopped: svc.stopped };
    }
    item.traceFiles = copyTrace(traceDir, path.join(evidenceDir, testCase.name, 'trace'));
    item.persistent = persistentReport(logFile);
    for (const name of fs.readdirSync(traceDir).filter(file => file.startsWith('child-'))) {
      for (const line of fs.readFileSync(path.join(traceDir, name), 'utf8').split(/\r?\n/).filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.trace === trace) {
          item.events.push({ ev: event.ev, kind: event.kind ?? null,
            layer: event.layer ?? null, name: event.name ?? null });
        }
      }
    }
    item.pass = item.errors.length === 0 && item.reachedGuard && item.response?.aborted === true
      && item.service?.stopped === true
      && item.events.some(event => event.ev === 'child.aborted' && event.layer === 'handler')
      && !item.events.some(event => event.ev === 'child.fakeCli.spawn'
        || (event.ev === 'child.fetchStart' && event.kind !== 'ratelimit'));
    raw.cases.push(item);
  }
}
raw.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
const pass = raw.cases.length === cases.length && raw.cases.every(item => item.pass);
console.log(JSON.stringify({ runId, pass, cases: raw.cases.map(item => ({
  name: item.name, pass: item.pass, reachedGuard: item.reachedGuard,
  aborted: item.response?.aborted, errors: item.errors,
})) }, null, 2));
process.exitCode = pass ? 0 : 1;
