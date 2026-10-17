import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('缺少 fixture 匯出 JSON 路徑');
const file = path.resolve(input);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const failures = [];

if (data.schemaVersion !== 1) failures.push('schemaVersion 必須為 1');
if (!Array.isArray(data.symbols) || data.symbols.length < 4) failures.push('symbols 至少需要四檔');
if (data.namesReleased !== false) failures.push('觀察點不得先釋放名稱');
if (!Array.isArray(data.pendingNames) || data.pendingNames.length === 0) failures.push('名稱必須仍有 pending');
if (!Array.isArray(data.quoteStarts)) failures.push('缺 quoteStarts');
else if (Array.isArray(data.symbols) && data.symbols.some(symbol => !data.quoteStarts.includes(symbol))) failures.push('後續價格工作尚未全部起跑');

const observed = Array.isArray(data.symbols) ? data.symbols.slice(0, 3) : [];
for (const symbol of observed) {
  const row = data.visiblePrices?.[symbol];
  if (!row || !Number.isFinite(row.price) || row.price <= 0 || row.loading !== false || row.error !== false) {
    failures.push(`${symbol} 尚未顯示有效價格`);
  }
}
if (data.coreUnchanged !== true) failures.push('本體五鍵不是逐值一致');
if (!Array.isArray(data.unexpectedRequests) || data.unexpectedRequests.length !== 0) failures.push('存在非預期請求');
if (!Array.isArray(data.pageErrors) || data.pageErrors.length !== 0) failures.push('存在頁面錯誤');

const result = { pass: failures.length === 0, failures };
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
