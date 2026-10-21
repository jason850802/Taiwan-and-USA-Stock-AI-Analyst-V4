// 重算既有檔案指紋；只在本案輸出根保存檢查結果。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.join(root, '.scratch/reacceptance-fixes/evidence');
const [baselineArg, outputArg, ticket] = process.argv.slice(2);
if (!baselineArg || !outputArg || !['01', '02'].includes(ticket)) {
  throw new Error('用法：node .scratch/reacceptance-fixes/check-protection.mjs <protection.json> <輸出.json> <01或02>');
}
const within = (parent, file) => {
  const rel = path.relative(parent, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const baselinePath = path.resolve(root, baselineArg), outputPath = path.resolve(root, outputArg);
if (!within(evidence, baselinePath) || !within(evidence, outputPath) || baselinePath === outputPath) throw new Error('檢查輸入與輸出須在本案evidence，且不得覆寫起點');
if (existsSync(outputPath)) throw new Error('保護檢查結果已存在，請使用新的明確檔名');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const sha = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
const mismatches = hashes => Object.entries(hashes).flatMap(([file, expected]) => {
  if (!existsSync(path.join(root, file))) return [{ file, reason: 'missing', expected }];
  const actual = sha(file);
  return actual === expected ? [] : [{ file, expected, actual }];
});
const p1Tools = new Set(['replay-server.mjs', 'integration-bootstrap.js', 'verify-replays.mjs', 'summarize-queue.mjs', 'seal-results.mjs', 'README.md']
  .map(file => `.scratch/optimization-followup/evidence/12/${file}`));
const s1Products = new Set(['components/portfolio/useHealthCheck.ts', 'components/portfolio/HoldingsTable.tsx', 'components/Portfolio.tsx']);
const changed = mismatches(baseline.trackedHashes);
const result = {
  schema: 1, checkedAt: new Date().toISOString(), baseline: baselineArg, baselineHead: baseline.head,
  currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
  baselineSha256: createHash('sha256').update(readFileSync(baselinePath)).digest('hex'),
  baselineTestFiles: Object.keys(baseline.baselineTests).length,
  historicalFiles: Object.keys(baseline.historicalHashes).length,
  testMismatches: mismatches(baseline.baselineTests), packageMismatches: mismatches(baseline.packages),
  historyMismatches: mismatches(baseline.historicalHashes), changed,
  unexpectedChanges: changed.filter(({ file }) => !p1Tools.has(file) && !(ticket === '02' && s1Products.has(file))),
};
result.passed = ['testMismatches', 'packageMismatches', 'historyMismatches', 'unexpectedChanges'].every(key => result[key].length === 0);
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ file: outputArg, passed: result.passed, changed: changed.map(row => row.file),
  protectedTestsAndSnapshots: result.baselineTestFiles, historicalFiles: result.historicalFiles,
  unexpectedChanges: result.unexpectedChanges.map(row => row.file) }));
if (!result.passed) process.exitCode = 1;
