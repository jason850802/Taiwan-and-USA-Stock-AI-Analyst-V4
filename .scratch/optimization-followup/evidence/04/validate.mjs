// 僅執行既有工具；保存 UTF-8 輸出、起點與金融／測試檔案雜湊。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const hash = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
const save = (file, value) => writeFileSync(path.join(evidence, file), JSON.stringify(value, null, 2) + '\n');
const git = args => {
  const out = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr);
  return out.stdout.trim();
};
const mode = process.argv[2];
const commands = {
  before: ['scripts/run-gate.mjs'], gate: ['scripts/run-gate.mjs'],
  types: ['node_modules/typescript/bin/tsc', '--noEmit'],
  bundle: ['scripts/measure-initial-bundle.mjs', '--skip-build', '--json'],
};
if (mode === 'inventory') {
  const files = git(['ls-files']).split('\n').filter(p => /\.test\.tsx?$|\.snap$/.test(p) || [
    'package.json', 'package-lock.json', 'services/yahoo.ts', 'services/quoteCache.ts',
    'components/portfolio/useDailySnapshot.ts', 'utils/portfolioHistory.ts',
    'utils/portfolioHistoryStore.ts', 'utils/portfolioFees.ts', 'utils/fx.ts',
  ].includes(p));
  save('before.json', { commit: git(['rev-parse', 'HEAD']), statusAfterClaim: git(['status', '--short']), hashes: Object.fromEntries(files.map(file => [file, hash(file)])) });
  console.log(`已保存 ${files.length} 檔雜湊。`);
} else if (mode === 'verify') {
  const before = JSON.parse(readFileSync(path.join(evidence, 'before.json'), 'utf8'));
  const changed = Object.entries(before.hashes).filter(([file, value]) => hash(file) !== value).map(([file]) => file);
  const result = { checked: Object.keys(before.hashes).length, changed };
  save('unchanged.json', result);
  console.log(JSON.stringify(result));
  process.exitCode = changed.length ? 1 : 0;
} else {
  if (!commands[mode]) throw new Error('請指定 inventory、verify、before、gate、types 或 bundle。');
  const out = spawnSync(process.execPath, commands[mode], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = [out.stdout || '', out.stderr || '', `exit_code=${out.status}`].join('\n');
  writeFileSync(path.join(evidence, `${mode}.txt`), output);
  if (mode === 'bundle' && out.status === 0) save('bundle.json', JSON.parse(out.stdout));
  console.log(output);
  process.exitCode = out.status ?? 1;
}
