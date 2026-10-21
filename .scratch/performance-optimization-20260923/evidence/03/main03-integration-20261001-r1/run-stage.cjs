// 已提交精確候選的受控驗證；只複製本輪 env、既有 Vite 套件與 Vercel 專案識別，不安裝或部署。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const candidate = path.join(root, '.scratch/integration03-isolated-20261001-r1');
const stage = process.argv[2];
const commands = {
  gate: ['scripts/run-gate.mjs', '--require-env'],
  gate2: ['scripts/run-gate.mjs', '--require-env'],
  gate3: ['scripts/run-gate.mjs', '--require-env'],
  guard: ['.scratch/performance-optimization-20260923/tools/guard-review-03.mjs', 'main03-guard-20261001-r1'],
  life: ['.scratch/performance-optimization-20260923/tools/lifecycle-03.mjs', 'main03-life-20261001-r1'],
  life2: ['.scratch/performance-optimization-20260923/tools/lifecycle-03.mjs', 'main03-life-20261001-r2'],
  app: ['.scratch/performance-optimization-20260923/tools/app-03.mjs', 'main03-app-20261001-r1', '--viewports', 'desktop,narrow'],
  terminal: ['.scratch/performance-optimization-20260923/tools/terminal-03.mjs', 'main03-terminal-20261001-r1'],
  cancel: ['.scratch/performance-optimization-20260923/tools/cancel-03.mjs', 'main03-cancel-20261001-r1', 'c', '3411'],
  search: ['.scratch/performance-optimization-20260923/tools/route-cancel-03.mjs', 'main03-search-20261001-r1', 'search', '3412'],
  finmind: ['.scratch/performance-optimization-20260923/tools/route-cancel-03.mjs', 'main03-finmind-20261001-r1', 'finmind', '3413'],
  gemini: ['.scratch/performance-optimization-20260923/tools/route-cancel-03.mjs', 'main03-gemini-20261001-r1', 'gemini', '3414'],
  chart: ['.scratch/performance-optimization-20260923/tools/chart-cancel-03.mjs', 'main03-chart-20261001-r1', '3415'],
  guardCancel: ['.scratch/performance-optimization-20260923/tools/guard-cancel-03.mjs', 'main03-guard-cancel-20261001-r1', '3420'],
};
if (!commands[stage]) throw new Error('未知驗證階段');
const write = (name, data) => fs.writeFileSync(path.join(__dirname, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: candidate, maxBuffer: 64 * 1024 * 1024 });
const head = git(['rev-parse', 'HEAD']).toString().trim();
if (git(['status', '--porcelain=v1', '-uno']).toString().trim()) throw new Error('候選來源不乾淨');
const files = git(['ls-files', '-z', '--', 'api', 'components', 'hooks', 'services', 'utils', 'scripts', 'types.ts', 'App.tsx', 'package.json', 'package-lock.json', 'vite.config.ts', 'vercel.json', '.vercelignore', '.scratch/performance-optimization-20260923/tools'])
  .toString().split('\0').filter(Boolean).map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(candidate, file))) }));
const toolChecks = files.filter(item => item.path.startsWith('.scratch/performance-optimization-20260923/tools/'))
  .map(item => ({ ...item, blobSha256: hash(git(['show', `${head}:${item.path}`])) }));
if (toolChecks.some(item => item.sha256 !== item.blobSha256)) throw new Error('工具工作檔與提交 blob 不同');
write(`${stage}-before.json`, { head, files, toolChecks });
const envPath = path.join(candidate, '.env');
if (fs.existsSync(envPath)) throw new Error('本輪 env 已存在，拒絕覆寫');
const viteTarget = path.join(candidate, 'node_modules/vite');
if (!fs.existsSync(viteTarget)) fs.cpSync(path.join(root, 'node_modules/vite'), viteTarget, { recursive: true, errorOnExist: true, force: false });
const reactTarget = path.join(candidate, 'node_modules/@vitejs/plugin-react');
if (!fs.existsSync(reactTarget)) fs.cpSync(path.join(root, 'node_modules/@vitejs/plugin-react'), reactTarget, { recursive: true, errorOnExist: true, force: false });
const vitestTarget = path.join(candidate, 'node_modules/vitest');
if (!fs.existsSync(vitestTarget)) fs.cpSync(path.join(root, 'node_modules/vitest'), vitestTarget, { recursive: true, errorOnExist: true, force: false });
const binDir = path.join(candidate, 'node_modules/.bin');
fs.mkdirSync(binDir, { recursive: true });
for (const name of ['vite.cmd', 'vite.ps1', 'vite']) {
  const target = path.join(binDir, name);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(root, 'node_modules/.bin', name), target, fs.constants.COPYFILE_EXCL);
}
const projectPath = path.join(candidate, '.vercel/project.json');
if (!fs.existsSync(projectPath)) {
  fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  fs.copyFileSync(path.join(root, '.vercel/project.json'), projectPath, fs.constants.COPYFILE_EXCL);
}
let result;
const log = fs.openSync(path.join(__dirname, `${stage}-log.txt`), 'wx');
try {
  fs.copyFileSync(path.join(root, '.env'), envPath, fs.constants.COPYFILE_EXCL);
  result = cp.spawnSync(process.execPath, commands[stage], { cwd: candidate, windowsHide: true,
    stdio: ['ignore', log, log], timeout: 20 * 60 * 1000 });
} finally {
  fs.closeSync(log);
  if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
}
const drift = files.filter(item => hash(fs.readFileSync(path.join(candidate, item.path))) !== item.sha256);
const pass = result.status === 0 && !drift.length && git(['rev-parse', 'HEAD']).toString().trim() === head;
write(`${stage}-result.json`, { head, command: ['node', ...commands[stage]], exitCode: result.status,
  signal: result.signal, error: result.error?.message ?? null, drift, envRemoved: !fs.existsSync(envPath),
  noInstall: true, noDeployment: true, pass });
console.log(JSON.stringify({ stage, head, exitCode: result.status, pass, sourceDrift: drift.length }));
process.exitCode = pass ? 0 : 1;
