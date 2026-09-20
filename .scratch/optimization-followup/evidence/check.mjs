// 逐票執行既有檢查並保存證據；輸出摘要，完整 UTF-8 紀錄各自留檔。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [ticket, mode, ...extra] = process.argv.slice(2);
if (!/^(0[5-9]|1[0-2])$/.test(ticket || '')) throw new Error('票號必須為 05～12');
const dir = path.join(root, '.scratch/optimization-followup/evidence', ticket);
mkdirSync(dir, { recursive: true });
const hash = p => createHash('sha256').update(readFileSync(path.join(root, p))).digest('hex');
const save = (name, value) => writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const git = args => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
};
if (mode === 'inventory') {
  const paths = git(['ls-files']).split('\n').filter(p => /\.test\.tsx?$|\.snap$/.test(p) || ['package.json', 'package-lock.json'].includes(p));
  save('before.json', { baseline: git(['rev-parse', 'HEAD']), status: git(['status', '--short']), node: process.version, hashes: Object.fromEntries(paths.map(p => [p, hash(p)])) });
  console.log(JSON.stringify({ ticket, protectedFiles: paths.length }));
} else if (mode === 'verify') {
  const before = JSON.parse(readFileSync(path.join(dir, 'before.json'), 'utf8'));
  const changed = Object.entries(before.hashes).filter(([p, h]) => hash(p) !== h).map(([p]) => p);
  const packageDiff = git(['diff', 'ade5dca1e7106c90430efc35b50ba4adaaae8b42', '--', 'package.json', 'package-lock.json']);
  const result = { checked: Object.keys(before.hashes).length, changed, packageDiff };
  save('unchanged.json', result);
  console.log(JSON.stringify(result));
  process.exitCode = changed.length || packageDiff ? 1 : 0;
} else {
  const commands = {
    before: ['scripts/run-gate.mjs'], gate: ['scripts/run-gate.mjs'],
    types: ['node_modules/typescript/bin/tsc', '--noEmit'],
    build: ['node_modules/vite/bin/vite.js', 'build'],
    tests: ['node_modules/vitest/vitest.mjs', 'run', ...extra],
    red: ['node_modules/vitest/vitest.mjs', 'run', ...extra],
    bundle: ['scripts/measure-initial-bundle.mjs', '--skip-build', '--json'],
    market: ['scripts/benchmark-market-data.mjs'], audit: ['scripts/audit-source-usage.mjs'],
  };
  if (!commands[mode]) throw new Error('未知驗證模式');
  const run = spawnSync(process.execPath, commands[mode], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = [run.stdout || '', run.stderr || '', `exit_code=${run.status}`].join('\n').split('\n').map(s => s.trimEnd()).join('\n');
  writeFileSync(path.join(dir, `${mode}.txt`), output + '\n');
  if (['bundle', 'market', 'audit'].includes(mode) && run.status === 0) save(`${mode}.json`, JSON.parse(run.stdout));
  console.log(output.split('\n').filter(s => /Test Files|Tests |exit_code|GATE|passed|failed|totalRawKb|totalGzipKb|乾淨|降級|error TS/.test(s)).join('\n'));
  if (run.status !== 0) console.log(output.slice(-12000));
  process.exitCode = run.status ?? 1;
}
