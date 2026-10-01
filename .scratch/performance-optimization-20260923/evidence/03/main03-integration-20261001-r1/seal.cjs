// 整合前後核對工作區與提交位元組；文件／raw 採 append-only，沒有清理他人檔案。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const candidate = path.join(root, '.scratch/integration03-isolated-20261001-r1');
const phase = process.argv[2];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const git = (cwd, args) => cp.execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
const write = (name, data) => fs.writeFileSync(path.join(__dirname, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const allowed = ['.scratch/performance-optimization-20260923/evidence/03/', '.scratch/performance-optimization-20260923/issues/03-daily-dev-entry.md'];
const modified = git(root, ['diff', '--name-only', '-z']).toString().split('\0').filter(Boolean)
  .filter(file => !allowed.some(prefix => file.startsWith(prefix))).sort();
const files = modified.map(file => ({ path: file, sha256: fs.existsSync(path.join(root, file)) ? hash(fs.readFileSync(path.join(root, file))) : 'MISSING' }));
if (phase === 'before') {
  write('preservation-before.json', { head: git(root, ['rev-parse', 'HEAD']).toString().trim(),
    main: git(root, ['rev-parse', 'main']).toString().trim(), files });
} else if (phase === 'after') {
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'preservation-before.json')));
  const drift = before.files.filter(item => !files.some(current => current.path === item.path && current.sha256 === item.sha256));
  write('preservation-after.json', { head: git(root, ['rev-parse', 'HEAD']).toString().trim(),
    main: git(root, ['rev-parse', 'main']).toString().trim(), files, drift,
    newUnrelatedPaths: files.filter(item => !before.files.some(old => old.path === item.path)),
    pass: !drift.length && git(root, ['rev-parse', 'HEAD']).toString().trim() === before.head });
  if (drift.length) throw new Error(`他人工作檔漂移 ${drift.length} 檔，請查核`);
} else if (phase === 'candidate') {
  const base = 'bf7599c53b0dcee2a5a814f3e62133c67844309a';
  const head = git(candidate, ['rev-parse', 'HEAD']).toString().trim();
  const selected = git(candidate, ['diff', '--name-only', '-z', base, head]).toString().split('\0').filter(Boolean);
  const rows = selected.map(file => ({ path: file, blobSha256: hash(git(candidate, ['show', `${head}:${file}`])),
    worktreeSha256: hash(fs.readFileSync(path.join(candidate, file))) }));
  const unaffected = ['package.json', 'package-lock.json', 'App.tsx', 'components/Portfolio/Portfolio.tsx', 'services/gemini.ts', 'services/_shared/geminiCache.ts'];
  write('candidate-fixed-point.json', { base, head, tree: git(candidate, ['rev-parse', 'HEAD^{tree}']).toString().trim(),
    files: rows, unaffected: unaffected.filter(file => fs.existsSync(path.join(candidate, file))).map(file => ({ path: file,
      unchanged: git(candidate, ['show', `${base}:${file}`]).equals(git(candidate, ['show', `${head}:${file}`])) })) });
  fs.writeFileSync(path.join(__dirname, 'candidate-final.patch'), git(candidate, ['diff', '--binary', '--full-index', base, head]), { flag: 'wx' });
} else throw new Error('未知 seal 階段');
console.log(JSON.stringify({ phase, unrelatedModified: files.length }));
