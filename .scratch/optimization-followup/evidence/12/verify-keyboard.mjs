// 原10檢查逐筆焦點／可信鍵盤；12另要求完整來源集合、工具與同一次啟站，防漏檔和混入舊結果。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const expected = [...new Set([...JSON.parse(readFileSync(path.join(dir, 'audit.json'), 'utf8')).files.map(row => row.path), 'vite.config.ts'])].sort();
const startup = JSON.parse(readFileSync(path.join(dir, 'keyboard/startup.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, message) => { if (!ok) throw Error(message); };
assert(JSON.stringify(startup.sourceFiles) === JSON.stringify(expected), '鍵盤啟動來源清單不符');
execFileSync(process.execPath, [path.join(dir, '../10/verify-evidence.mjs'), '12'], { cwd: root, stdio: 'inherit' });
const verified = JSON.parse(readFileSync(path.join(dir, 'keyboard/verified-evidence.json'), 'utf8'));
for (const row of verified.cases) {
  const raw = JSON.parse(readFileSync(path.join(dir, 'keyboard', row.name + '.json'), 'utf8'));
  assert(JSON.stringify(Object.keys(raw.sourceHashes).sort()) === JSON.stringify(expected), `鍵盤來源集合不全：${row.name}`);
  assert(raw.integrationRunId === startup.runId, `鍵盤混入不同執行：${row.name}`);
  for (const [file, hash] of Object.entries(startup.tools)) {
    assert(raw.integrationTools?.[file] === hash && sha(readFileSync(path.join(dir, file))) === hash, `鍵盤工具漂移：${file}`);
  }
}
console.log(JSON.stringify({ allPassed: true, cases: verified.cases.length, auditedProducts: expected.length - 1, withBuildConfig: expected.length, runId: startup.runId }));
