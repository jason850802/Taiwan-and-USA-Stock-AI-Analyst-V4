// UTF-8讀取量測結果，只輸出完成數及真正失敗；不修改原始證據。
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('./', import.meta.url));
const part = process.argv[2] || '.';
if (!/^(\.|replay-0[2-5]|keyboard)$/.test(part)) throw new Error('未知結果目錄');
const files = readdirSync(path.join(dir, part)).filter(name => /\.json$/.test(name) && /(?:green-|after-|profile-|app-|stream-)/.test(name));
const rows = files.map(name => {
  const r = JSON.parse(readFileSync(path.join(dir, part, name), 'utf8'));
  const viewport = r.integrationBrowser?.viewport || r.viewport || {};
  return { name, passed: r.passed, error: r.error || null, width: viewport.width, height: viewport.height,
    overflow: typeof viewport.scrollWidth === 'number' ? viewport.scrollWidth - viewport.width : null,
    errors: r.integrationBrowser?.errors?.length ?? r.errors?.length ?? r.uncaught?.length ?? null };
});
console.log(JSON.stringify({ part, files: rows.length, passed: rows.filter(r => r.passed).length,
  failed: rows.filter(r => r.passed === false), dimensions: [...new Set(rows.map(r => `${r.width}x${r.height}`))],
  appOverflow: rows.filter(r => r.overflow > 1 && !r.name.includes('profile')), errors: rows.filter(r => r.errors > 0), names: rows.map(r => r.name) }, null, 2));
