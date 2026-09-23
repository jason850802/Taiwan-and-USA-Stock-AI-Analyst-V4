import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex === -1 || !args[outputIndex + 1]) throw new Error('缺少 --output');
const outputPath = path.resolve(args[outputIndex + 1]);
const inputPaths = args
  .filter((_, index) => index !== outputIndex && index !== outputIndex + 1)
  .map(file => path.resolve(file));
if (inputPaths.length < 2) throw new Error('至少需要兩個獨立 service start 輸入');
if (fs.existsSync(outputPath)) throw new Error(`輸出已存在，拒絕覆寫：${outputPath}`);

const inputs = inputPaths.map(file => ({ file, json: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const rows = [];
const starts = new Set();
for (const { file, json } of inputs) {
  if (!Array.isArray(json.rows)) throw new Error(`缺 rows：${file}`);
  if (!json.serviceStartId) throw new Error(`缺 serviceStartId：${file}`);
  if (starts.has(json.serviceStartId)) throw new Error(`serviceStartId 重複：${json.serviceStartId}`);
  starts.add(json.serviceStartId);
  for (const row of json.rows) {
    if (row.serviceStartId !== json.serviceStartId) throw new Error(`列與檔案 serviceStartId 不一致：${file}`);
    rows.push(row);
  }
}

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  inputs: inputPaths,
  serviceStartIds: [...starts],
  rows,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, serviceStartIds: result.serviceStartIds, rows: rows.length }, null, 2));
