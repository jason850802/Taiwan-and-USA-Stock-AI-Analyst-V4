// 保存來源清單缺漏的整組原始證據；只移動12目錄內明確列出的檔案。
import { readFileSync, writeFileSync, copyFileSync, renameSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('./', import.meta.url));
const target = path.join(dir, 'precheck-stream-manifest');
if (existsSync(target)) throw Error('來源清單診斷已封存，禁止覆寫');
const summary = JSON.parse(readFileSync(path.join(dir, 'stream-summary.json'), 'utf8'));
const names = [...summary.checked.map(row => row.file), 'stream-summary.json', 'stream-startup.json',
  'app-healthguard-desktop-0.json', 'app-healthguard-narrow-0.json',
  ...['desktop', 'narrow'].flatMap(size => readdirSync(path.join(dir, `stream-ui-${size}`)).map(file => `stream-ui-${size}/${file}`))];
if (new Set(names).size !== names.length) throw Error('封存清單重複');
for (const name of names) {
  const from = path.resolve(dir, name), to = path.resolve(target, name);
  if (!from.startsWith(path.resolve(dir) + path.sep) || !to.startsWith(target + path.sep) || !statSync(from).isFile()) throw Error(`封存路徑不符：${name}`);
}
mkdirSync(target);
for (const file of ['stream-server.mjs', 'stream-layout.mjs', 'health-app.js', 'verify-stream-ui.mjs']) copyFileSync(path.join(dir, file), path.join(target, file));
const rows = names.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex') }));
for (const name of names) {
  mkdirSync(path.dirname(path.join(target, name)), { recursive: true });
  renameSync(path.join(dir, name), path.join(target, name));
}
writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ reason: '09清單漏列config/twFeeRates.ts；12改以94個可達產品加vite建置設定完整綁定後重跑，不補蓋舊證據', rows }, null, 2) + '\n');
console.log(JSON.stringify({ archived: rows.length, target }));
