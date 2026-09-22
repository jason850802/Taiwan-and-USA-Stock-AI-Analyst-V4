import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('用法：node verify-holdings-name-blocking.mjs <fixture-result.json>');
const result = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
const failures = [];

if (result.schemaVersion !== 1) failures.push('schemaVersion 必須為 1');
if (!Array.isArray(result.symbols) || result.symbols.length < 4) failures.push('symbols 至少需要 4 檔');
if (result.namesReleased !== false) failures.push('觀察點必須在名稱釋放前');
if (!Array.isArray(result.pendingNames) || result.pendingNames.length < 1) failures.push('名稱必須仍 pending');
if (!Array.isArray(result.quoteStarts)) failures.push('缺 quoteStarts');
if (result.coreUnchanged !== true) failures.push('本體資料五鍵有變動或未核對');
if (result.unexpectedRequests?.length) failures.push('出現未預期 API');
if (result.pageErrors?.length) failures.push('頁面有非預期錯誤');

if (Array.isArray(result.symbols) && result.symbols.length >= 4) {
  for (const symbol of result.symbols.slice(0, 3)) {
    const price = result.visiblePrices?.[symbol];
    if (!price) failures.push(`${symbol}: 缺可見價格`);
    else {
      if (!Number.isFinite(price.price) || price.price <= 0) failures.push(`${symbol}: 價格無效`);
      if (price.loading !== false) failures.push(`${symbol}: 名稱 pending 時仍 loading`);
      if (price.error !== false) failures.push(`${symbol}: 有效價格被標成 error`);
    }
  }
  if (!result.quoteStarts?.includes(result.symbols[3])) failures.push(`${result.symbols[3]}: 後續價格工作未起跑`);
}

const verdict = { pass: failures.length === 0, failures };
console.log(JSON.stringify(verdict, null, 2));
if (!verdict.pass) process.exitCode = 1;
