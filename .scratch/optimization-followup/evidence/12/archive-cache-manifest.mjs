// 完整保存來源集合缺漏的五頁App證據；壓力profile的實際編譯探針不在本次重跑範圍。
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('./', import.meta.url)), target = path.join(dir, 'precheck-cache-manifest');
if (existsSync(target)) throw Error('快取App來源診斷已封存，禁止覆寫');
const names = ['pressure', 'quota', 'denied', 'corrupt', 'oversize'].map(name => `app-${name}.json`)
  .concat(['verified-cache.json', 'cleanup-app-cache.json']);
const rows = names.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex') }));
mkdirSync(target);
copyFileSync(path.join(dir, 'verify-cache.mjs'), path.join(target, 'verify-cache.mjs'));
copyFileSync(path.join(dir, '../08/app-server.mjs'), path.join(target, 'app-server-before.mjs'));
for (const name of names) renameSync(path.join(dir, name), path.join(target, name));
writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ reason: '正式App來源清單漏列config；以12 wrapper綁定完整95檔及runId重新執行，14個profile與故障探針不改寫', rows }, null, 2) + '\n');
console.log(JSON.stringify({ archived: rows.length, target }));
