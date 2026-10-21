import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const featureRoot = path.join(root, '.scratch', 'performance-fix-20260922');
const destination = path.join(featureRoot, 'runtime', 'current');

if (fs.existsSync(destination)) throw new Error(`runtime 已存在，拒絕覆寫：${destination}`);

const excluded = /^(?:\.scratch|\.agents|\.claude|\.codex|\.planning|docs|dist|node_modules)(?:\/|$)/;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(relative => relative && !excluded.test(relative));

for (const relative of tracked) {
  const source = path.resolve(root, relative);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`追蹤來源缺檔：${relative}`);
}
fs.mkdirSync(destination, { recursive: true });

const files = [];
for (const relative of tracked) {
  const source = path.resolve(root, relative);
  const target = path.resolve(destination, relative);
  if (!target.startsWith(destination + path.sep)) throw new Error(`來源超出 runtime：${relative}`);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`追蹤來源缺檔：${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  files.push({
    path: relative.replaceAll('\\', '/'),
    sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  });
}

fs.mkdirSync(path.join(destination, '.vercel'), { recursive: true });
fs.copyFileSync(path.join(root, '.vercel', 'project.json'), path.join(destination, '.vercel', 'project.json'));

// 僅供本機 Vercel dev 使用；不讀出、不雜湊、不納入 manifest，07 清理時只刪 runtime 內的 .env 複本。
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) fs.copyFileSync(envPath, path.join(destination, '.env'));

for (const name of ['holdings-probe.html', 'holdings-probe.jsx']) {
  fs.copyFileSync(
    path.join(root, '.scratch', 'performance-diagnosis-20260922', name),
    path.join(destination, name),
  );
}

const manifestPath = path.join(featureRoot, 'evidence', '07', 'runtime-current-manifest.json');
if (fs.existsSync(manifestPath)) throw new Error(`manifest 已存在，拒絕覆寫：${manifestPath}`);
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  destination,
  copiedFiles: files.length,
  ancestorNodeModules: path.join(root, 'node_modules'),
  envCopied: fs.existsSync(envPath),
  files,
}, null, 2) + '\n');

console.log(JSON.stringify({ destination, manifestPath, copiedFiles: files.length, ancestorNodeModules: true }));
