// 驗證只執行專案既有工具；保存 UTF-8 輸出與固定比較點，不讀環境秘密。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const mode = process.argv[2];
const commands = {
  before: ['scripts/run-gate.mjs'],
  gate: ['scripts/run-gate.mjs'],
  types: ['node_modules/typescript/bin/tsc', '--noEmit'],
  build: ['node_modules/vite/bin/vite.js', 'build'],
  red: ['node_modules/vitest/vitest.mjs', 'run', 'services/yahoo.revalidation.test.ts'],
  tests: ['node_modules/vitest/vitest.mjs', 'run', 'services/yahoo.revalidation.test.ts'],
  'edge-red': ['node_modules/vitest/vitest.mjs', 'run', 'services/yahoo.revalidation.test.ts'],
  'market-before': ['scripts/benchmark-market-data.mjs'],
  market: ['scripts/benchmark-market-data.mjs'],
  'market-repeat': ['scripts/benchmark-market-data.mjs'],
  bundle: ['scripts/measure-initial-bundle.mjs', '--skip-build', '--json'],
};
const hash = file => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
const save = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const git = args => {
  const out = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr);
  return out.stdout.trim();
};
if (mode === 'inventory') {
  const files = git(['ls-files']).split('\n').filter(p => /\.test\.tsx?$|\.snap$/.test(p) || ['package.json', 'package-lock.json'].includes(p));
  save('before.json', { commit: git(['rev-parse', 'HEAD']), statusAfterClaim: git(['status', '--short']), hashes: Object.fromEntries(files.map(file => [file, hash(file)])) });
  console.log(`已保存 ${files.length} 個既有測試、snapshot 與依賴檔案雜湊。`);
} else if (mode === 'verify') {
  const before = JSON.parse(readFileSync(path.join(evidence, 'before.json'), 'utf8'));
  const changed = Object.entries(before.hashes).filter(([file, expected]) => hash(file) !== expected).map(([file]) => file);
  const result = { checked: Object.keys(before.hashes).length, changed };
  save('unchanged.json', result);
  console.log(JSON.stringify(result));
  process.exitCode = changed.length ? 1 : 0;
} else {
  if (!commands[mode]) throw new Error('請指定 inventory、verify 或既有驗證命令。');
  const out = spawnSync(process.execPath, commands[mode], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const output = [out.stdout || '', out.stderr || '', `exit_code=${out.status}`].join('\n');
  writeFileSync(path.join(evidence, `${mode}.txt`), output);
  if ((mode.startsWith('market') || mode === 'bundle') && out.status === 0) save(`${mode}.json`, JSON.parse(out.stdout));
  console.log(output);
  process.exitCode = out.status ?? 1;
}
