#!/usr/bin/env node
// 03 票日常入口固定上游成本：從 Vite 同源頁面埠送請求，逐支保留原始時間。
// 用法：node .scratch/performance-optimization-20260923/tools/daily-cost-03.mjs <新 run-id> <前端埠>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { claimRun, fileSha, toolVersions } from './service-kit.mjs';

const [runId, portText] = process.argv.slice(2);
const port = Number(portText);
if (!runId || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('需要 <新 run-id> <前端埠>');
}
const { evidenceDir } = claimRun({ ticket: '03', runId });
const scriptFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptFile), '..', '..', '..');
const origin = `http://localhost:${port}`;
const stateFile = path.join(process.env.LOCALAPPDATA, 'Temp', 'perf-opt-20260923', 'daily', 'state.json');
function ownedState() {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.frontPort !== port || !state.token || !Array.isArray(state.children)) {
    throw new Error('日常入口狀態與受測前端埠不符');
  }
  return state;
}
const beforeState = ownedState();
const cases = [
  { name: 'OPTIONS', method: 'OPTIONS', route: '/api/yahoo/chart?symbol=AAPL&interval=1d&range=5d', expected: 204 },
  { name: '固定 GET', method: 'GET', route: '/api/yahoo/chart?symbol=AAPL&interval=1d&range=5d', expected: 200 },
];
const raw = {
  runId, createdAt: new Date().toISOString(), origin, cwd: root,
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  versions: toolVersions(), cacheMode: '固定資料、無瀏覽器快取',
  source: {
    runnerSha256: fileSha(scriptFile),
    launcherSha256: fileSha(path.join(path.dirname(scriptFile), 'daily-dev.mjs')),
    proxySha256: fileSha(path.join(root, 'vite.config.ts')),
    chartSha256: fileSha(path.join(root, 'api/yahoo/chart.ts')),
    persistentSha256: fileSha(path.join(path.dirname(scriptFile), 'persistent-functions.cjs')),
    preloadSha256: fileSha(path.join(path.dirname(scriptFile), 'trace-preload.cjs')),
    yahooSha256: fileSha(path.join(root, 'api/_lib/yahoo.ts')),
    guardSha256: fileSha(path.join(root, 'api/_lib/guard.ts')),
    ratelimitSha256: fileSha(path.join(root, 'api/_lib/ratelimit.ts')),
  },
  launcher: {
    frontPort: beforeState.frontPort, apiPort: beforeState.apiPort,
    supervisorPid: beforeState.supervisorPid,
    children: beforeState.children.map(child => ({ pid: child.pid, creationDate: child.creationDate })),
    sameStateBeforeAfter: false,
  },
  cases: [], errors: [],
};
for (const testCase of cases) {
  const samples = [];
  try {
    for (let i = -1; i < 20; i++) {
      const start = performance.now();
      const response = await fetch(origin + testCase.route, {
        method: testCase.method, headers: { Origin: origin }, cache: 'no-store',
      });
      await response.arrayBuffer();
      if (i >= 0) samples.push({ index: i + 1, status: response.status,
        ms: Math.round((performance.now() - start) * 1000) / 1000 });
    }
  } catch (error) {
    raw.errors.push(`${testCase.name}：${error instanceof Error ? error.message : String(error)}`);
  }
  const times = samples.map(sample => sample.ms).sort((a, b) => a - b);
  const median = times.length === 20 ? (times[9] + times[10]) / 2 : null;
  raw.cases.push({ ...testCase, samples, medianMs: median, maxMs: times.at(-1) ?? null });
}
try {
  const afterState = ownedState();
  raw.launcher.sameStateBeforeAfter = afterState.token === beforeState.token
    && JSON.stringify(afterState.children) === JSON.stringify(beforeState.children);
} catch (error) {
  raw.errors.push(`日常入口身分：${error instanceof Error ? error.message : String(error)}`);
}
raw.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(evidenceDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
const pass = raw.errors.length === 0 && raw.launcher.sameStateBeforeAfter
  && raw.cases.every(item => item.samples.length === 20
  && item.samples.every(sample => sample.status === item.expected)
  && item.medianMs <= 150 && item.maxMs <= 500);
console.log(JSON.stringify({ runId, pass, cases: raw.cases.map(({ name, medianMs, maxMs, samples }) =>
  ({ name, medianMs, maxMs, success: samples.filter(sample => sample.status === (name === 'OPTIONS' ? 204 : 200)).length })) }, null, 2));
process.exitCode = pass ? 0 : 1;
