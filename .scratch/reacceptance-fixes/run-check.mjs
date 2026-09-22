// 保存實際子程序的完整輸出與退出碼；每次使用新的名稱，避免覆寫驗證紀錄。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [ticket, name, mode = 'gate'] = process.argv.slice(2);
if (!['01', '02'].includes(ticket) || !/^[a-z0-9-]+$/.test(name || '') || !['gate', 'tests', 'list', 'tsc', 'bundle'].includes(mode)) {
  throw new Error('用法：node .scratch/reacceptance-fixes/run-check.mjs <01|02> <獨立紀錄名稱> <gate|tests|list|tsc|bundle>');
}
const dir = path.join(root, '.scratch/reacceptance-fixes/evidence', ticket, 'checks');
mkdirSync(dir, { recursive: true });
const logFile = path.join(dir, `${name}.txt`), resultFile = path.join(dir, `${name}.json`);
if (existsSync(logFile) || existsSync(resultFile)) throw new Error('紀錄名稱已使用，請另取名稱');
const target = {
  gate: ['scripts/run-gate.mjs'],
  tests: ['node_modules/vitest/vitest.mjs', 'run'],
  list: ['node_modules/vitest/vitest.mjs', 'list', '--json'],
  tsc: ['node_modules/typescript/bin/tsc', '--noEmit'],
  bundle: ['scripts/measure-initial-bundle.mjs', '--skip-build', '--json'],
}[mode];
const fd = openSync(logFile, 'wx');
const startedAt = new Date().toISOString();
const runnerSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const entrypointSha256 = createHash('sha256').update(readFileSync(path.join(root, target[0]))).digest('hex');
const child = spawn(process.execPath, target, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const collect = data => { output += data.toString('utf8'); writeSync(fd, data); };
child.stdout.on('data', collect);
child.stderr.on('data', collect);
child.on('error', error => collect(Buffer.from(String(error.stack || error))));
child.on('close', (exitCode, signal) => {
  writeSync(fd, `\nexit_code=${exitCode}\nsignal=${signal ?? ''}\n`);
  closeSync(fd);
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '');
  const result = {
    schema: 1, startedAt, completedAt: new Date().toISOString(), node: process.version,
    command: ['node', ...target], exitCode, signal, runnerSha256, entrypointSha256,
    log: path.relative(root, logFile).replaceAll('\\', '/'),
    logSha256: createHash('sha256').update(readFileSync(logFile)).digest('hex'),
    tests: Number(clean.match(/Tests\s+(\d+) passed/)?.[1] || 0),
    testFiles: Number(clean.match(/Test Files\s+(\d+) passed/)?.[1] || 0),
    fullGate: clean.includes('GATE 全綠'), secretScanDegraded: clean.includes('金鑰掃描降級'),
    ...(mode === 'bundle' && exitCode === 0 ? { measurement: JSON.parse(output),
      buildIndexSha256: createHash('sha256').update(readFileSync(path.join(root, 'dist/index.html'))).digest('hex') } : {}),
  };
  writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  console.log(JSON.stringify(result));
  process.exitCode = exitCode === 0 && !signal ? 0 : 1;
});
