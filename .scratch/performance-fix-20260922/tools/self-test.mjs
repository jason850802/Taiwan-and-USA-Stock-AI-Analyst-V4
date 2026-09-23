import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '../../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'performance-fix-selftest-'));
const cases = [];
const optionRoutes = ['/api/yahoo/chart', '/api/finmind'];
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

  const makeRows = ({ status = 204, omitFinmind = false, totalMs = 1700, warmPairsPerStart = 5 } = {}) => {
    const rows = [];
    for (const start of ['start-a', 'start-b']) {
      for (const route of optionRoutes) {
        if (!omitFinmind || route !== '/api/finmind') rows.push({ route, status, totalMs: totalMs + 100, phase: 'cold', serviceStartId: start });
      }
      for (let round = 0; round < warmPairsPerStart; round++) {
        for (const route of optionRoutes) {
          if (!omitFinmind || route !== '/api/finmind') {
            rows.push({ route, status, totalMs: totalMs + round, phase: 'warm', serviceStartId: start, pairId: `${start}-pair-${round}` });
          }
        }
      }
    }
    return { rows };
  };
  const writeRows = (name, data) => {
    const file = path.join(temp, name);
    fs.writeFileSync(file, JSON.stringify(data));
    return file;
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

  const splitWarm = makeRows();
  splitWarm.rows = splitWarm.rows.filter(row => {
    if (row.phase !== 'warm') return true;
    const round = Number(row.pairId.split('-').at(-1));
    return row.serviceStartId === 'start-a' ? round < 3 : round >= 3;
  });
  const splitWarmFile = writeRows('split-warm.json', splitWarm);
  run('warm 不可跨服務啟動湊足五組', 'compare-options.mjs', ['--before', before, '--candidate', splitWarmFile, '--reference', reference], 1);

  const mismatchedPair = makeRows();
  const mismatchedRow = mismatchedPair.rows.find(row => row.phase === 'warm' && row.serviceStartId === 'start-a' && row.route === '/api/finmind' && row.pairId === 'start-a-pair-4');
  mismatchedRow.pairId = 'start-a-finmind-only';
  const mismatchedPairFile = writeRows('mismatched-pair.json', mismatchedPair);
  run('warm pairId 跨路由不一致判紅', 'compare-options.mjs', ['--before', before, '--candidate', mismatchedPairFile, '--reference', reference], 1);

  const missingPair = makeRows({ warmPairsPerStart: 6 });
  missingPair.rows = missingPair.rows.filter(row => !(
    row.phase === 'warm'
    && row.serviceStartId === 'start-a'
    && row.route === '/api/finmind'
    && row.pairId === 'start-a-pair-5'
  ));
  const missingPairFile = writeRows('missing-pair.json', missingPair);
  run('warm pairId 缺跨路由對應判紅', 'compare-options.mjs', ['--before', before, '--candidate', missingPairFile, '--reference', reference], 1);

  const duplicatePair = makeRows({ warmPairsPerStart: 6 });
  const duplicateRow = duplicatePair.rows.find(row => row.phase === 'warm' && row.serviceStartId === 'start-a' && row.route === '/api/yahoo/chart' && row.pairId === 'start-a-pair-5');
  duplicateRow.pairId = 'start-a-pair-4';
  const duplicatePairFile = writeRows('duplicate-pair.json', duplicatePair);
  run('warm pairId 同 route 重複判紅', 'compare-options.mjs', ['--before', before, '--candidate', duplicatePairFile, '--reference', reference], 1);

  const weightedRows = (yahooCount, finmindCount) => ({
    rows: [
      ...Array.from({ length: yahooCount }, () => ({ route: '/api/yahoo/chart', status: 204, totalMs: 100 })),
      ...Array.from({ length: finmindCount }, () => ({ route: '/api/finmind', status: 204, totalMs: 1000 })),
    ],
  });
  const overallBefore = writeRows('overall-before.json', weightedRows(9, 1));
  const overallCandidate = writeRows('overall-candidate.json', weightedRows(1, 9));
  const overallReference = writeRows('overall-reference.json', weightedRows(9, 1));
  run('overall 僅摘要不作額外門檻', 'compare-options.mjs', [
    '--before', overallBefore,
    '--candidate', overallCandidate,
    '--reference', overallReference,
    '--protocol', 'threshold-only',
  ], 0);

  const makeFormalStartRows = start => {
    const rows = [
      { route: '/api/yahoo/chart', status: 204, error: null, totalMs: 1200, phase: 'cold', serviceStartId: start, pairId: null },
      { route: '/api/finmind', status: 204, error: null, totalMs: 1200, phase: 'cold', serviceStartId: start, pairId: null },
    ];
    for (let round = 1; round <= 5; round++) {
      const pairId = `${start}-warm-${round}`;
      const order = round % 2 === 1 ? optionRoutes : [...optionRoutes].reverse();
      for (const route of order) rows.push({ route, status: 204, error: null, totalMs: 1100 + round, phase: 'warm', serviceStartId: start, pairId });
    }
    return rows;
  };
  const makeFormalBundle = (name, { duplicatePid = false, omitSecondIdentity = false, alteredMerged = false } = {}) => {
    const bundle = path.join(temp, name);
    fs.mkdirSync(bundle, { recursive: true });
    const allRows = [];
    const ids = ['formal-start-a', 'formal-start-b'];
    ids.forEach((id, index) => {
      const dir = path.join(bundle, `start-${index + 1}`);
      fs.mkdirSync(dir, { recursive: true });
      const rows = makeFormalStartRows(id);
      allRows.push(...rows);
      fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify({ schemaVersion: 1, serviceStartId: id, rows }));
      fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ success: true, probeExitCode: 0 }));
      if (!(omitSecondIdentity && index === 1)) {
        const vercelPid = duplicatePid && index === 1 ? 1001 : 1001 + index;
        const identity = {
          variant: 'e2', serviceStartId: id,
          source: { head: 'fixture-head', baseManifestSha256: 'fixture-manifest' },
          config: { vercelignoreSha256: 'fixture-vercel', viteConfigSha256: 'fixture-vite' },
          runtime: { nodeVersion: 'v1', vercelVersion: '1', viteVersion: '1' },
          tools: Object.fromEntries(Array.from({ length: 6 }, (_, toolIndex) => [`tool-${toolIndex}`, `hash-${toolIndex}`])),
          services: {
            vercel: { spawnPid: vercelPid, listenerPid: vercelPid, port: 5101 + index, command: ['node', 'vercel'] },
            vite: { spawnPid: 2001 + index, listenerPid: 2001 + index, port: 5201 + index, command: ['node', 'vite'] },
          },
        };
        fs.writeFileSync(path.join(dir, 'identity.json'), JSON.stringify(identity));
      }
    });
    const inputs = ids.map((_, index) => path.join(bundle, `start-${index + 1}`, 'raw.json'));
    const mergedRows = allRows.map(row => ({ ...row }));
    if (alteredMerged) mergedRows[0].totalMs += 1;
    fs.writeFileSync(path.join(bundle, 'merged.json'), JSON.stringify({ inputs, serviceStartIds: ids, rows: mergedRows }));
    return bundle;
  };
  const validFormalBundle = makeFormalBundle('formal-v2-good');
  run('formal v2 identity bundle 通過', 'validate-options-formal-v2.mjs', ['--bundle-dir', validFormalBundle, '--variant', 'e2'], 0);
  const duplicatePidBundle = makeFormalBundle('formal-v2-duplicate-pid', { duplicatePid: true });
  run('formal v2 重複 actual PID 判紅', 'validate-options-formal-v2.mjs', ['--bundle-dir', duplicatePidBundle, '--variant', 'e2'], 1);
  const missingIdentityBundle = makeFormalBundle('formal-v2-missing-identity', { omitSecondIdentity: true });
  run('formal v2 缺 start identity 判紅', 'validate-options-formal-v2.mjs', ['--bundle-dir', missingIdentityBundle, '--variant', 'e2'], 1);
  const alteredMergedBundle = makeFormalBundle('formal-v2-altered-merged', { alteredMerged: true });
  run('formal merged 同列數但內容與 raw 不符判紅', 'validate-options-formal-v2.mjs', ['--bundle-dir', alteredMergedBundle, '--variant', 'e2'], 1);

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
