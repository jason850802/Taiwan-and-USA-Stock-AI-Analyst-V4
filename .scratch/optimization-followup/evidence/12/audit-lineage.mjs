// 最終來源與歷史測試保護：以Git與原始SHA清單核對，不以票面勾選取代程式證據。
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const baseline = 'ade5dca1e7106c90430efc35b50ba4adaaae8b42';
const original = '5f6b48a9e2a2077539ec8341b2dddb7d45e53d94';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const read = name => readFileSync(path.join(root, name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baselineTests = git(['ls-tree', '-r', '--name-only', baseline]).split('\n').filter(p => /\.test\.tsx?$|\.snap$/.test(p));
const changedOldTests = git(['diff', '--name-only', baseline, '--', ...baselineTests]).split('\n').filter(Boolean);
const manifest = read('.scratch/optimization-followup/evidence/01/tests-snapshots-sha256-after.txt').toString('utf8');
const byteChecks = manifest.trim().split(/\r?\n/).map(line => {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  if (!match) throw new Error('01雜湊清單格式不符');
  const file = match[2].replaceAll('\\', '/');
  return { file, original: match[1], current: sha(read(file)) };
});
const packageDiff = git(['diff', baseline, '--', 'package.json', 'package-lock.json']);
const originalPackageDiff = git(['diff', original, '--', 'package.json', 'package-lock.json']);
const audit = JSON.parse(read('.scratch/optimization-followup/evidence/12/audit.json'));
const productPaths = audit.files.map(row => row.path);
const numstat = git(['diff', '--numstat', baseline, '--', ...productPaths]);
const addedTests = git(['diff', '--diff-filter=A', '--name-only', baseline]).split('\n').filter(p => /\.test\.tsx?$/.test(p));
const forbiddenTesting = addedTests.flatMap(file => read(file).toString('utf8').split(/\r?\n/).flatMap((line, index) =>
  /\b(?:it|test|describe)\.(?:skip|todo|only)\s*\(/.test(line) ? [{ file, line: index + 1, text: line.trim() }] : []));
const commits = git(['log', '--reverse', '--format=%H %s', `${original}..HEAD`]).split('\n');
const historyDiff = git(['diff', '--name-only', baseline, '--', '.planning', '.agents', 'CORE_RULES.md', 'AGENTS.md', 'docs/optimization-2026-09-20.md']);
const result = { baseline, original, candidate: git(['rev-parse', 'HEAD']), node: process.version,
  baselineTests: baselineTests.length, originalByteChecks: byteChecks.length,
  byteMismatches: byteChecks.filter(r => r.current !== r.original), changedOldTests, packageDiff, originalPackageDiff,
  historyDiff, sourceFiles: audit.sourceFiles, reachableFiles: audit.reachableFiles,
  sourceHashes: Object.fromEntries(productPaths.map(file => [file, sha(read(file))])),
  newTestFiles: addedTests, forbiddenTesting, productNumstat: numstat, commits };
writeFileSync(path.join(dir, 'lineage.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ baselineTests: result.baselineTests, originalByteChecks: result.originalByteChecks,
  byteMismatches: result.byteMismatches.length, oldTestsChanged: changedOldTests.length, newTestFiles: addedTests.length,
  forbiddenTesting: forbiddenTesting.length, sourceFiles: result.sourceFiles, historyDiff,
  packageUnchanged: !packageDiff && !originalPackageDiff }));
if (changedOldTests.length || result.byteMismatches.length || packageDiff || originalPackageDiff || historyDiff || forbiddenTesting.length) process.exitCode = 1;
