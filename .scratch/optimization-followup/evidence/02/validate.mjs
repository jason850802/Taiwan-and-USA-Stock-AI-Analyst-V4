// 保留 UTF-8 原始驗證輸出，避免 PowerShell 5.1 重新編碼中文。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const mode = process.argv[2];
const commands = {
  before: ['node', ['scripts/run-gate.mjs']],
  gate: ['node', ['scripts/run-gate.mjs']],
  types: ['node', ['node_modules/typescript/bin/tsc', '--noEmit']],
  build: ['node', ['node_modules/vite/bin/vite.js', 'build']],
  bundle: ['node', ['scripts/measure-initial-bundle.mjs', '--skip-build', '--json']],
  'cache-red': ['node', ['node_modules/vitest/vitest.mjs', 'run', 'services/finmind.loading.test.ts']],
  'cache-green': ['node', ['node_modules/vitest/vitest.mjs', 'run', 'services/finmind.loading.test.ts']],
};
if (mode === 'inventory') {
  const git = args => {
    const out = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (out.status !== 0) throw new Error(out.stderr);
    return out.stdout.trim();
  };
  const files = git(['ls-files']).split('\n').filter(p => /\.test\.tsx?$|\.snap$/.test(p) || ['package.json', 'package-lock.json'].includes(p));
  const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
  writeFileSync(path.join(evidence, 'before.json'), JSON.stringify({ commit: git(['rev-parse', 'HEAD']), status: git(['status', '--short']), hashes }, null, 2) + '\n');
  console.log(`已保存固定基準與 ${files.length} 個既有測試／依賴檔案雜湊。`);
} else if (mode === 'verify') {
  const before = JSON.parse(readFileSync(path.join(evidence, 'before.json'), 'utf8'));
  const changed = Object.entries(before.hashes).filter(([file, hash]) => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex') !== hash).map(([file]) => file);
  const result = { checked: Object.keys(before.hashes).length, changed };
  writeFileSync(path.join(evidence, 'unchanged.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  process.exitCode = changed.length ? 1 : 0;
} else {
  if (!commands[mode]) throw new Error('用法：node validate.mjs inventory|before|gate|types|build|bundle|verify');
  const [command, args] = commands[mode];
  const out = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  const output = [out.stdout || '', out.stderr || '', `exit_code=${out.status}`].join('\n');
  writeFileSync(path.join(evidence, `${mode}.txt`), output);
  console.log(output);
  process.exitCode = out.status ?? 1;
}
