// OPTIONS formal v6 編排：交錯執行 E0／E1／E2／clean 各兩次獨立啟動。
// 每個 variant 一旦有 start 失敗就依 fail-fast 停止該 variant，不重跑、不追加樣本。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const runId = process.argv[2];
if (!runId || !/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');
const tools = path.join(root, '.scratch', 'performance-fix-20260922', 'tools');
const ev = (ticket, ...rest) => path.join(root, '.scratch', 'performance-fix-20260922', 'evidence', ticket, runId, ...rest);
const bundleOf = variant => (variant === 'e0' ? ev('01', variant) : ev('02', variant));

const plan = [
  ['e0', 1, 3031, 4231], ['e1', 1, 3032, 4232], ['e2', 1, 3033, 4233], ['clean', 1, 3034, 4234],
  ['e0', 2, 3035, 4235], ['e1', 2, 3036, 4236], ['e2', 2, 3037, 4237], ['clean', 2, 3038, 4238],
];
const failedVariants = new Set();
const log = [];
for (const [variant, n, vercelPort, vitePort] of plan) {
  if (failedVariants.has(variant)) {
    log.push({ variant, start: n, skipped: 'variant 已 fail-fast 停止' });
    continue;
  }
  const outputDir = path.join(bundleOf(variant), `start-${n}`);
  const startedAt = new Date().toISOString();
  const r = spawnSync(process.execPath, [
    path.join(tools, 'run-options-formal-start-v2.mjs'),
    '--run-id', runId,
    '--variant', variant,
    '--service-start-id', `${variant}-${runId}-start-${n}`,
    '--vercel-port', String(vercelPort),
    '--vite-port', String(vitePort),
    '--output-dir', outputDir,
  ], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const entry = { variant, start: n, vercelPort, vitePort, startedAt, finishedAt: new Date().toISOString(), exitCode: r.status, stderr: (r.stderr || '').trim().slice(-400) };
  log.push(entry);
  console.log(JSON.stringify(entry));
  if (r.status !== 0) failedVariants.add(variant);
}
fs.writeFileSync(path.join(ev('01'), 'orchestration-log.json'), JSON.stringify({ runId, plan, log }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ failedVariants: [...failedVariants] }));
if (failedVariants.size > 0) process.exitCode = 1;
