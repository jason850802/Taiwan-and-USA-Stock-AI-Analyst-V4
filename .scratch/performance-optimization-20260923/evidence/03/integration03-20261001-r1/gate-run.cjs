// 精確 main 候選的單次機械 gate；不啟服務，不呼叫真市場或 AI。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const isolated = manifest.isolated;
const dependenciesRoot = path.join(root, 'node_modules');
const temporaryEnv = path.join(isolated, '.env');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => cp.execFileSync('git', args, { cwd: isolated });
const write = (name, value) => fs.writeFileSync(path.join(__dirname, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
if (git(['rev-parse', 'HEAD']).toString().trim() !== manifest.candidateCommit) throw new Error('候選 commit 漂移');
for (const file of manifest.files) {
  if (hash(fs.readFileSync(path.join(isolated, file.path))) !== file.sha256) throw new Error(`來源漂移：${file.path}`);
}
if (fs.existsSync(temporaryEnv)) throw new Error('已有 env，拒絕覆寫');
if (!fs.statSync(dependenciesRoot).isDirectory()) throw new Error('既有依賴目錄不存在');
// E 槽不支援 junction；Node/npm 按一般祖先路徑解析既有 node_modules，不安裝或修改它。
const dependencies = ['typescript', 'vite', 'vitest'].map(name => ({ name, resolved: require.resolve(name, { paths: [isolated] }), version: JSON.parse(fs.readFileSync(path.join(dependenciesRoot, name, 'package.json'), 'utf8')).version }));
for (const dependency of dependencies) if (!dependency.resolved.startsWith(dependenciesRoot)) throw new Error('非預期依賴解析');
const sourceFiles = git(['ls-files', '-z', '--', 'api', 'components', 'hooks', 'services', 'utils', 'scripts', 'types.ts', 'App.tsx', 'package.json', 'package-lock.json', 'vite.config.ts', 'vercel.json', '.vercelignore', '.scratch/performance-optimization-20260923/tools']).toString('utf8').split('\0').filter(Boolean).map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(isolated, file))) }));
write('gate-source-before.json', { candidateCommit: manifest.candidateCommit, sourceMain: manifest.sourceMain, patchSha256: manifest.patchSha256, fileCount: sourceFiles.length, files: sourceFiles });
let exitCode = null;
let signal = null;
let error = null;
const log = fs.openSync(path.join(__dirname, 'gate-20261001-r1.txt'), 'wx');
try {
  fs.copyFileSync(path.join(root, '.env'), temporaryEnv, fs.constants.COPYFILE_EXCL);
  const result = cp.spawnSync(process.execPath, ['scripts/run-gate.mjs', '--require-env'], { cwd: isolated, stdio: ['ignore', log, log], windowsHide: true, timeout: 15 * 60 * 1000 });
  exitCode = result.status;
  signal = result.signal;
  error = result.error ? { code: result.error.code, message: result.error.message } : null;
} finally {
  fs.closeSync(log);
  if (fs.existsSync(temporaryEnv)) fs.unlinkSync(temporaryEnv);
}
const drift = sourceFiles.filter(file => hash(fs.readFileSync(path.join(isolated, file.path))) !== file.sha256);
write('gate-source-after.json', { candidateCommit: manifest.candidateCommit, fileCount: sourceFiles.length, drift, files: sourceFiles });
write('gate-result.json', { candidateCommit: manifest.candidateCommit, sourceMain: manifest.sourceMain, patchSha256: manifest.patchSha256, exitCode, signal, error, sourceDrift: drift, envRemoved: !fs.existsSync(temporaryEnv), dependenciesRoot, dependencies, junctionCreated: false, noPackageInstall: true, noRuntime: true, noDeployment: true, pass: exitCode === 0 && drift.length === 0 });
console.log(JSON.stringify({ exitCode, sourceDrift: drift.length, envRemoved: !fs.existsSync(temporaryEnv), junctionCreated: false }));
process.exitCode = exitCode === 0 && drift.length === 0 ? 0 : 1;
