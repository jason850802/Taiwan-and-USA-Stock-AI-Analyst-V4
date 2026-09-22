// 依起點的精確檔案集合核對805項母體，歷史工作區的測試副本另外列出。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = path.join(root, '.scratch/reacceptance-fixes/evidence');
const [protectionArg, checkArg, outputArg] = process.argv.slice(2);
const resolve = argument => {
  assert(typeof argument === 'string', '用法：summarize-gate.mjs <protection.json> <check.json> <新輸出.json>');
  const file = path.resolve(root, argument), relative = path.relative(evidence, file);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), '僅接受本案evidence路徑');
  return file;
};
const protection = JSON.parse(readFileSync(resolve(protectionArg), 'utf8'));
const check = JSON.parse(readFileSync(resolve(checkArg), 'utf8'));
const log = readFileSync(resolve(check.log));
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(log), check.logSha256, 'gate紀錄的原始hash不符');
assert.equal(check.exitCode, 0, 'gate沒有成功退出');
assert.equal(check.fullGate, true, 'gate未完整通過');
assert.equal(check.secretScanDegraded, false, '金鑰掃描降級');
const plain = log.toString('utf8').replace(/\u001b\[[0-9;]*m/g, '');
const allRows = [...plain.matchAll(/(?:✓|√)\s+([^\r\n]+?\.test\.[cm]?[jt]sx?)\s+\((\d+) tests?\)/g)]
  .map(match => ({ file: match[1].replaceAll('\\', '/'), tests: Number(match[2]) }));
const originalFiles = Object.keys(protection.baselineTests).filter(file => !file.endsWith('.snap')).sort();
const originalRows = allRows.filter(row => originalFiles.includes(row.file));
assert.deepEqual(originalRows.map(row => row.file).sort(), originalFiles, 'gate缺少或重複原測試檔');
assert.equal(originalRows.reduce((sum, row) => sum + row.tests, 0), 805, '原測試數量不是805');
for (const [file, hash] of Object.entries(protection.baselineTests)) {
  assert.equal(sha(readFileSync(path.join(root, file))), hash, `既有測試或snapshot改變：${file}`);
}
const addedRows = allRows.filter(row => !row.file.startsWith('.scratch/') && !originalFiles.includes(row.file));
const historicalRows = allRows.filter(row => row.file.startsWith('.scratch/'));
assert.equal(allRows.length, check.testFiles, 'gate檔案摘要未涵蓋全部執行項目');
assert.equal(allRows.reduce((sum, row) => sum + row.tests, 0), check.tests, 'gate案例數量無法對帳');
const result = {
  schema: 1, passed: true, check: checkArg, checkSha256: sha(readFileSync(resolve(checkArg))),
  log: check.log, logSha256: check.logSha256, protection: protectionArg,
  original: { files: originalRows.length, tests: 805, rows: originalRows },
  added: { files: addedRows.length, tests: addedRows.reduce((sum, row) => sum + row.tests, 0), rows: addedRows },
  historicalCopies: { files: historicalRows.length, tests: historicalRows.reduce((sum, row) => sum + row.tests, 0), rows: historicalRows },
  protectedTestsAndSnapshots: Object.keys(protection.baselineTests).length,
};
writeFileSync(resolve(outputArg), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
console.log(JSON.stringify({ passed: true, original: result.original.tests, added: result.added.tests,
  historicalCopies: result.historicalCopies.tests, file: outputArg }));
