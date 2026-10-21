// 檢查精確證據 stage、執行提交版 gate 的秘密掃描段，另掃包含 Markdown 的所有交付檔。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const plan = '.scratch/performance-optimization-20260923/';
const prefixes = [plan + 'issues/03-daily-dev-entry.md', plan + 'evidence/03/REVIEW-20260925.md',
  plan + 'evidence/03/MAIN-INTEGRATION-20261001-r1.md', plan + 'evidence/03/main03-'];
const git = args => cp.execFileSync('git', args, { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024 });
const paths = git(['diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean);
if (!paths.length || paths.some(file => !prefixes.some(prefix => file.startsWith(prefix)))) throw new Error('stage 範圍超出本輪證據／03回填');
const files = paths.map(file => ({ path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }));
const logs = [];
let source = git(['show', '1a9269fe781f4ae5e0d432d1c22b4c77d6cc3bcd:scripts/run-gate.mjs']).toString();
source = source.slice(0, source.indexOf('\nconst STEPS =')).replace(/^#![^\n]*\n/, '')
  .replace(/^import .*;\r?$/gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(root, 'scripts/run-gate.mjs')).href));
const scanPass = vm.runInNewContext(source + '\nstepSecretScan();', {
  spawnSync: cp.spawnSync, existsSync: fs.existsSync, readdirSync: fs.readdirSync,
  readFileSync: fs.readFileSync, statSync: fs.statSync, path, fileURLToPath, URL, Buffer,
  process: { argv: ['node', 'verify-delivery', '--require-env'] },
  console: { log: value => logs.push(String(value)) },
});
const secrets = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).flatMap(line => {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!match || !/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_PAT)$/i.test(match[1])) return [];
  const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  return value.length >= 6 ? [value] : [];
});
const hits = files.filter(item => {
  const bytes = fs.readFileSync(path.join(root, item.path));
  return secrets.some(secret => bytes.includes(Buffer.from(secret)));
}).map(item => item.path);
const helpers = fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs'));
const syntax = helpers.map(name => ({ name, exitCode: cp.spawnSync(process.execPath, ['--check', path.join(__dirname, name)], { windowsHide: true }).status }));
const result = { scope: '精確證據與文件，產品gate838另存', files, count: files.length, officialSecretScanPass: scanPass,
  officialScanLogs: logs, secretValueCount: secrets.length, secretHits: hits, syntax,
  pass: scanPass && !hits.length && syntax.every(item => item.exitCode === 0) };
fs.writeFileSync(path.join(__dirname, 'delivery-check.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ files: files.length, scanPass, secretHits: hits.length, syntax: syntax.length, pass: result.pass }));
process.exitCode = result.pass ? 0 : 1;
