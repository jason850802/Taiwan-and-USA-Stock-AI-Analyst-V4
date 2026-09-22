import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-fix-selftest-'));
const cases = [];
const run = (name, script, argv, expectedCode) => {
  const result = spawnSync(process.execPath, [path.join(toolDir, script), ...argv], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const actualCode = result.status ?? 1;
  const pass = actualCode === expectedCode;
  cases.push({ name, expectedCode, actualCode, pass });
  if (!pass) {
    throw new Error(`${name}: 預期 exit ${expectedCode}，實際 ${actualCode}\n${result.stderr}\n${result.stdout}`);
  }
};

try {
  const historical = path.join(repoRoot, '.scratch/performance-diagnosis-20260922/http-probes.json');
  const historicalOut = path.join(temp, 'historical-pass.json');
  run('歷史 clean 候選通過門檻方向', 'compare-options.mjs', [
    '--before', historical, '--before-port', '3001',
    '--candidate', historical, '--candidate-port', '3002',
    '--reference', historical, '--reference-port', '3002',
    '--protocol', 'threshold-only', '--output', historicalOut,
  ], 0);
  run('既有輸出拒絕覆寫', 'compare-options.mjs', [
    '--before', historical, '--before-port', '3001',
    '--candidate', historical, '--candidate-port', '3002',
    '--reference', historical, '--reference-port', '3002',
    '--protocol', 'threshold-only', '--output', historicalOut,
  ], 1);
  run('歷史慢原站作候選判紅', 'compare-options.mjs', [
    '--before', historical, '--before-port', '3001',
    '--candidate', historical, '--candidate-port', '3001',
    '--reference', historical, '--reference-port', '3002',
    '--protocol', 'threshold-only',
  ], 1);

  const makeRows = ({ status = 204, omitFinmind = false, totalMs = 1700 } = {}) => {
    const rows = [];
    for (const start of ['start-a', 'start-b']) {
      for (const route of ['/api/yahoo/chart', '/api/finmind']) {
        if (!omitFinmind || route !== '/api/finmind') rows.push({ route, status, totalMs: totalMs + 100, phase: 'cold', serviceStartId: start });
      }
    }
    for (let round = 0; round < 5; round++) {
      for (const route of ['/api/yahoo/chart', '/api/finmind']) {
        if (!omitFinmind || route !== '/api/finmind') {
          rows.push({ route, status, totalMs: totalMs + round, phase: 'warm', serviceStartId: round < 3 ? 'start-a' : 'start-b', pairId: `pair-${round}` });
        }
      }
    }
    return { rows };
  };
  const before = path.join(temp, 'before.json');
  const reference = path.join(temp, 'reference.json');
  const badStatus = path.join(temp, 'bad-status.json');
  const missingRoute = path.join(temp, 'missing-route.json');
  fs.writeFileSync(before, JSON.stringify(makeRows({ totalMs: 6000 })));
  fs.writeFileSync(reference, JSON.stringify(makeRows()));
  fs.writeFileSync(badStatus, JSON.stringify(makeRows({ status: 500 })));
  fs.writeFileSync(missingRoute, JSON.stringify(makeRows({ omitFinmind: true })));
  run('非 204 判紅', 'compare-options.mjs', ['--before', before, '--candidate', badStatus, '--reference', reference], 1);
  run('漏路由判紅', 'compare-options.mjs', ['--before', before, '--candidate', missingRoute, '--reference', reference], 1);

  const symbols = ['777701.TW', '777702.TW', '777703.TW', '777704.TW'];
  const good = path.join(temp, 'holdings-good.json');
  const bad = path.join(temp, 'holdings-bad.json');
  fs.writeFileSync(good, JSON.stringify({
    schemaVersion: 1, symbols, namesReleased: false, pendingNames: ['777701'],
    quoteStarts: symbols,
    visiblePrices: Object.fromEntries(symbols.slice(0, 3).map((symbol, index) => [symbol, { price: 101 + index, loading: false, error: false }])),
    coreUnchanged: true, unexpectedRequests: [], pageErrors: [],
  }));
  fs.writeFileSync(bad, JSON.stringify({
    schemaVersion: 1, symbols, namesReleased: false, pendingNames: ['777701', '777702', '777703'],
    quoteStarts: symbols.slice(0, 3),
    visiblePrices: Object.fromEntries(symbols.slice(0, 3).map(symbol => [symbol, { price: 0, loading: true, error: false }])),
    coreUnchanged: true, unexpectedRequests: [], pageErrors: [],
  }));
  run('名稱阻塞合成綠例', 'verify-holdings-name-blocking.mjs', [good], 0);
  run('名稱阻塞合成紅例', 'verify-holdings-name-blocking.mjs', [bad], 1);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const summary = { pass: cases.every(test => test.pass), cases };
console.log(JSON.stringify(summary, null, 2));
if (!summary.pass) process.exitCode = 1;
