// 避免 Windows 換行過濾改寫 raw：只重新認領本輪已明列的 stage，使用原位元組建立 blob。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const git = (args, input) => cp.execFileSync('git', args, { cwd: root, input,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const files = git(['diff', '--cached', '--name-only', '-z']).toString().split('\0').filter(Boolean);
const prefix = '.scratch/performance-optimization-20260923/';
if (!files.length || files.some(file => !(file === prefix + 'issues/03-daily-dev-entry.md'
  || file === prefix + 'evidence/03/REVIEW-20260925.md' || file === prefix + 'evidence/03/MAIN-INTEGRATION-20261001-r1.md'
  || file.startsWith(prefix + 'evidence/03/main03-')))) throw new Error('範圍超出本輪精確 stage');
const rows = files.map(file => {
  const data = fs.readFileSync(path.join(root, file));
  return { path: file, blob: git(['hash-object', '-w', '--stdin'], data).toString().trim(),
    sha256: crypto.createHash('sha256').update(data).digest('hex') };
});
git(['update-index', '-z', '--index-info'], Buffer.from(rows.map(item => `100644 ${item.blob}\t${item.path}\0`).join('')));
const differs = rows.filter(item => crypto.createHash('sha256').update(git(['show', `:${item.path}`])).digest('hex') !== item.sha256);
fs.writeFileSync(path.join(__dirname, 'exact-stage.json'), JSON.stringify({ rows, differs, pass: !differs.length }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ exactFiles: rows.length, differs: differs.length }));
process.exitCode = differs.length ? 1 : 0;
