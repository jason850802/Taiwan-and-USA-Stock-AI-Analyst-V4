// S1 最終封存只接受呼叫端明確列出的 run／gate／review，不搜尋 latest 或其他 passed 檔。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRun, inputs, sha, root, relative } from './s1-run.mjs';

const [hookArg, formalArg, gateArg, bundleArg, negativeArg, standardsArg, specArg] = process.argv.slice(2);
if (![hookArg, formalArg, gateArg, bundleArg, negativeArg, standardsArg, specArg].every(Boolean)) {
  throw new Error('用法：node s1-seal.mjs <hook> <formal> <gate> <bundle> <negative> <standards> <spec>');
}
const evidenceRoot = path.join(root, '.scratch/reacceptance-fixes/evidence/02');
const resolveEvidence = value => {
  const file = path.resolve(root, value), rel = path.relative(evidenceRoot, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(':')) throw new Error('封存輸入超出 S1 evidence');
  return file;
};
const readJson = value => JSON.parse(readFileSync(resolveEvidence(value), 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: null, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
const baseCommit = inputs().baseCommit;
const hook = verifyRun(relative(resolveEvidence(hookArg)));
const formal = verifyRun(relative(resolveEvidence(formalArg)));
if (hook.group !== 'hook' || formal.group !== 'formal' || hook.count !== 27 || formal.count !== 2) throw new Error('S1 run 組別或案例數不符');

const gateFile = resolveEvidence(gateArg), gate = readJson(gateArg);
if (gate.schema !== 1 || gate.exitCode !== 0 || gate.signal !== null || gate.fullGate !== true || gate.secretScanDegraded !== false) throw new Error('S1 final gate 未完整通過');
if (JSON.stringify(gate.command) !== JSON.stringify(['node', 'scripts/run-gate.mjs'])) throw new Error('S1 gate 命令不符');
for (const [field, file] of [['runnerSha256', '.scratch/reacceptance-fixes/run-check.mjs'], ['entrypointSha256', 'scripts/run-gate.mjs']]) {
  if (gate[field] !== sha(readFileSync(path.join(root, file)))) throw new Error(`S1 gate ${field} 漂移`);
}
const gateLog = resolveEvidence(gate.log), gateBytes = readFileSync(gateLog);
if (sha(gateBytes) !== gate.logSha256) throw new Error('S1 gate log 雜湊不符');
const gateText = gateBytes.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
if (!gateText.includes('GATE 全綠') || gateText.includes('金鑰掃描降級')) throw new Error('S1 gate 缺全綠或掃描降級');

const tracked = git(['ls-tree', '-r', '--name-only', baseCommit]).toString('utf8').trim().split('\n');
const testFiles = tracked.filter(file => !file.startsWith('.') && (/\.(test|spec)\.[^.]+$/.test(file) || file.endsWith('.snap'))).sort();
const currentTestHashes = Object.fromEntries(testFiles.map(file => [file, sha(readFileSync(path.join(root, file)))]));
const baseTestHashes = Object.fromEntries(testFiles.map(file => [file, sha(git(['show', `${baseCommit}:${file}`]))]));
if (JSON.stringify(currentTestHashes) !== JSON.stringify(baseTestHashes)) throw new Error('原 test／snapshot 有變動');
const expectedTests = testFiles.filter(file => !file.endsWith('.snap'));
const entries = [...gateText.matchAll(/^\s*[✓✔]\s+(.+?)\s+\((\d+) tests?\)/gm)]
  .map(match => ({ file: match[1].replaceAll('\\', '/'), tests: Number(match[2]) }));
const rootEntries = entries.filter(row => expectedTests.includes(row.file)).sort((a, b) => a.file.localeCompare(b.file));
if (JSON.stringify(rootEntries.map(row => row.file)) !== JSON.stringify(expectedTests)) throw new Error('gate 原測試集合不完整');
if (rootEntries.length !== 47 || rootEntries.reduce((sum, row) => sum + row.tests, 0) !== 805) throw new Error('原 47 檔／805 項母體不符');
if (gate.testFiles !== entries.length || gate.tests !== entries.reduce((sum, row) => sum + row.tests, 0)) throw new Error('gate 逐檔與總數不符');

const packageHashes = {};
for (const file of ['package.json', 'package-lock.json']) {
  const current = sha(readFileSync(path.join(root, file))), base = sha(git(['show', `${baseCommit}:${file}`]));
  if (current !== base) throw new Error(`${file} 有變動`);
  packageHashes[file] = current;
}
const bundleFile = resolveEvidence(bundleArg), bundle = readJson(bundleArg);
if (bundle.schema !== 1 || bundle.exitCode !== 0 || bundle.signal !== null || !bundle.measurement) throw new Error('首屏量測未完成');
if (JSON.stringify(bundle.command) !== JSON.stringify(['node', 'scripts/measure-initial-bundle.mjs', '--skip-build', '--json'])) throw new Error('首屏量測命令不符');
if (bundle.buildIndexSha256 !== inputs().buildHashes['dist/index.html']) throw new Error('首屏量測與正式 build 不同');

const negativeFile = resolveEvidence(negativeArg), negative = readJson(negativeArg);
if (negative.schema !== 's1-negative-v1' || negative.passed !== true || negative.checks?.length !== 9) throw new Error('S1 協定反例不完整');
const review = value => {
  const file = resolveEvidence(value), text = readFileSync(file, 'utf8');
  for (const marker of ['FINAL: PASS', 'OPEN: 0', 'NEW: 0']) if (!text.includes(marker)) throw new Error(`最終覆核缺標記：${marker}`);
  return { file: relative(file), sha256: sha(readFileSync(file)) };
};
const reviews = { standards: review(standardsArg), spec: review(specArg) };
const seal = {
  schema: 's1-seal-v1', scope: 'S1-health-input-invalidation', allPassed: true,
  createdAt: new Date().toISOString(), baseCommit, inputs: inputs(), runs: { hook, formal },
  gate: { file: relative(gateFile), sha256: sha(readFileSync(gateFile)), log: relative(gateLog), logSha256: sha(gateBytes),
    totalFiles: gate.testFiles, totalTests: gate.tests, rootFiles: 47, rootTests: 805,
    historicalCopyFiles: gate.testFiles - 47, historicalCopyTests: gate.tests - 805, secretScanDegraded: false },
  bundle: { file: relative(bundleFile), sha256: sha(readFileSync(bundleFile)), measurement: bundle.measurement,
    buildIndexSha256: bundle.buildIndexSha256 },
  protection: { packageHashes, originalTestHashes: currentTestHashes },
  negative: { file: relative(negativeFile), sha256: sha(readFileSync(negativeFile)), count: negative.checks.length },
  reviews,
};
const directory = path.join(evidenceRoot, 'seals', randomUUID());
mkdirSync(directory, { recursive: true });
const output = path.join(directory, 'seal.json');
writeFileSync(output, JSON.stringify(seal, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: relative(output), sha256: sha(readFileSync(output)), allPassed: true,
  hookCases: hook.count, formalCases: formal.count, gateTests: gate.tests }, null, 2));
