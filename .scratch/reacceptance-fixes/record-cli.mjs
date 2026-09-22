// 保存本案Node入口的真子程序結果；負向退出碼與回歸本身是否成功分開記錄。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [ticket, label, expected, entry, ...argv] = process.argv.slice(2);
assert.ok(['01', '02'].includes(ticket) && /^[a-z0-9-]+$/.test(label || ''), '指定票號及獨立紀錄名稱');
assert.ok(['zero', 'nonzero'].includes(expected), '預期退出碼使用zero或nonzero');
assert.ok(entry && !entry.includes('..') && !path.isAbsolute(entry)
  && /^\.scratch\/(reacceptance-fixes|optimization-followup)\/.+\.mjs$/.test(entry), '只執行本案相關的明確Node入口');
const directory = path.join(root, '.scratch/reacceptance-fixes/evidence', ticket, 'checks');
mkdirSync(directory, { recursive: true });
const file = path.join(directory, `${label}.json`);
assert.equal(existsSync(file), false, '紀錄名稱已使用');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const startedAt = new Date().toISOString();
const execution = spawnSync(process.execPath, [entry, ...argv], {
  cwd: root, windowsHide: true, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
});
const passed = !execution.error && execution.signal === null
  && (expected === 'zero' ? execution.status === 0 : execution.status !== null && execution.status !== 0);
const record = { schema: 'reacceptance-cli-check-v1', startedAt, completedAt: new Date().toISOString(),
  command: [process.execPath, entry, ...argv], cwd: root, node: process.version,
  runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), entrypointSha256: hash(readFileSync(path.join(root, entry))),
  expected, exitCode: execution.status, signal: execution.signal, error: execution.error?.message ?? null,
  stdout: execution.stdout, stderr: execution.stderr, passed };
writeFileSync(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
console.log(JSON.stringify({ record: path.relative(root, file).replaceAll('\\', '/'), exitCode: execution.status, passed,
  stdout: execution.stdout, stderr: execution.stderr }));
if (!passed) process.exitCode = 1;
