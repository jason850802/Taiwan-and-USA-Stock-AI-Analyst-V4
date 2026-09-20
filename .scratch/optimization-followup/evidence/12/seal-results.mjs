// 最終封存只接受所有分組的完整驗證結果；原始資料、工具與產品各自保留指紋。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
const assert = (ok, why) => { if (!ok) throw Error(why); };
const lineage = read('lineage.json');
assert(!lineage.byteMismatches.length && !lineage.changedOldTests.length && !lineage.packageDiff && !lineage.originalPackageDiff
  && !lineage.historyDiff && !lineage.forbiddenTesting.length, '既有成果保護失敗');
for (const [file, hash] of Object.entries(lineage.sourceHashes)) assert(sha(readFileSync(path.join(root, file))) === hash, `產品漂移：${file}`);
const replays = read('verified-replays.json'), cache = read('verified-cache.json'), stream = read('stream-summary.json');
const streamUi = read('verified-stream-ui.json'), keyboard = read('keyboard/verified-evidence.json'), health = read('verified-health.json');
const queue = read('queue-summary.json');
const queueBefore = [1,10,30].flatMap(count=>Array.from({length:7},(_,sample)=>{
  const file=`replay-05/before-load-${count}-${sample}.json`, row=read(file);
  assert(row.passed && row.source===queue.beforeBaseline && row.queueSha256===null, `排程前版本不符：${file}`);
  return {file,passed:true,sha256:sha(readFileSync(path.join(dir,file)))};
}));
assert(health.red.passed === false && health.cases.length === 6 && health.cases.every(row => row.passed)
  && health.afterSha256 === lineage.sourceHashes['components/portfolio/useHealthCheck.ts'], '健檢紅綠回歸不完整');
assert(replays.cases.length === 88 && replays.cases.every(row => row.passed), '02～05整合矩陣不完整');
assert(cache.allPassed && cache.profiles.length === 14 && cache.apps.length === 5 && cache.faultPage.passed, '快取矩陣不完整');
assert(stream.checked.length === 29 && stream.appCases === 15 && stream.checked.every(row => row.passed), '串流壓力／App矩陣不完整');
assert(streamUi.appCases === 32 && streamUi.layoutChecks === 2 && streamUi.rows.every(row => row.passed), '兩尺寸串流矩陣不完整');
const completeSourceFiles = [...new Set([...Object.keys(lineage.sourceHashes), 'vite.config.ts'])].sort();
const cacheAppRun = read('cache-app-startup.json');
for (const row of cache.apps) {
  const raw = read(row.file);
  assert(raw.integrationRunId === cacheAppRun.runId
    && JSON.stringify(Object.keys(raw.sourceHashes).sort()) === JSON.stringify(completeSourceFiles), `快取App混入不同執行或來源不全：${row.file}`);
  for (const file of completeSourceFiles) assert(raw.sourceHashes[file] === sha(readFileSync(path.join(root,file))), `快取App來源漂移：${file}`);
  for (const [file, hash] of Object.entries(cacheAppRun.tools)) assert(raw.integrationTools?.[file] === hash && sha(readFileSync(path.join(dir,file))) === hash, `快取App工具漂移：${file}`);
}
assert(keyboard.cases.length === 15 && keyboard.cases.every(row => row.passed)
  && JSON.stringify(Object.keys(keyboard.sourceHashes).sort()) === JSON.stringify(completeSourceFiles), '原生鍵盤矩陣或來源集合不完整');
const keyboardRun = read('keyboard/startup.json');
for (const row of keyboard.cases) {
  const raw = read(`keyboard/${row.name}.json`);
  assert(raw.integrationRunId === keyboardRun.runId
    && JSON.stringify(Object.keys(raw.sourceHashes).sort()) === JSON.stringify(completeSourceFiles), `鍵盤混入不同執行或缺來源：${row.name}`);
  for (const file of completeSourceFiles) assert(raw.sourceHashes[file] === sha(readFileSync(path.join(root,file))), `鍵盤來源漂移：${file}`);
  for (const [file, hash] of Object.entries(keyboardRun.tools)) assert(raw.integrationTools?.[file] === hash && sha(readFileSync(path.join(dir,file))) === hash, `鍵盤工具漂移：${file}`);
}
const rawRows = [...replays.cases, ...queueBefore, ...cache.profiles, cache.faultPage, ...cache.apps, ...stream.checked, ...streamUi.rows,
  ...keyboard.cases.map(row => ({ ...row, file: `keyboard/${row.name}.json` })), health.red, ...health.cases];
for (const row of rawRows) assert(sha(readFileSync(path.join(dir, row.file))) === row.sha256, `原始證據漂移：${row.file}`);
const streamRun = read('stream-startup.json');
for (const row of stream.checked) {
  const data = read(row.file);
  if (!data.profile) {
    assert(JSON.stringify(Object.keys(data.sourceHashes).sort()) === JSON.stringify(completeSourceFiles), `串流App來源集合不全：${row.file}`);
    for (const file of completeSourceFiles) assert(data.sourceHashes[file] === sha(readFileSync(path.join(root,file))), `串流App來源漂移：${file}`);
  }
  assert(data.integrationRunId === streamRun.runId, `串流樣本混入其他執行：${row.file}`);
  for (const [file, hash] of Object.entries(streamRun.tools)) {
    assert(data.integrationTools?.[file] === hash && sha(readFileSync(path.join(dir,file))) === hash, `串流整合工具漂移：${row.file}/${file}`);
  }
}
const gate = readFileSync(path.join(dir, 'gate.txt'), 'utf8');
assert(/Test Files\s+47 passed/.test(gate) && /Tests\s+805 passed/.test(gate) && gate.includes('exit_code=0') && gate.includes('GATE 全綠'), '最終gate未完整通過');
const bundle = read('bundle.json'), market = read('market.json');
const initial = JSON.parse(readFileSync(new URL('../01/bundle-baseline.json', import.meta.url), 'utf8'));
assert(bundle.totalRawKb <= initial.totalRawKb * 1.05 && bundle.totalGzipKb <= initial.totalGzipKb * 1.05, '首屏超過5%調查門檻');
const baselineMarket = JSON.parse(readFileSync(new URL('../01/market-baseline.json', import.meta.url), 'utf8'));
market.results.forEach((row, index) => assert(row.sha256 === baselineMarket.results[index].sha256 && row.outputBars === baselineMarket.results[index].outputBars, '四行情輸出改變'));
const cleanupFiles = ['replay-02','replay-03','replay-04','replay-05','profile-cache','app-cache','stream','keyboard','health-guard'].map(part => `cleanup-${part}.json`);
cleanupFiles.forEach(file => { const row = read(file); assert(row.processAbsent && row.portClosed, `假站未清理：${file}`); });
const verifications = ['lineage.json','verified-replays.json','verified-cache.json','stream-summary.json','verified-stream-ui.json',
  'keyboard/verified-evidence.json','keyboard/startup.json','cache-app-startup.json','verified-health.json','queue-summary.json','profile-summary.json','stream-startup.json','gate.txt','bundle.json','market.json',...cleanupFiles];
const result = {
  candidateParent: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim(),
  sourceHashes: lineage.sourceHashes, buildIndexSha256: sha(readFileSync(path.join(root,'dist/index.html'))),
  gate: { files:47, tests:805 }, oldTestsUnchanged:lineage.baselineTests, byteChecks:lineage.originalByteChecks,
  groups: { replays:88, queueBeforeSamples:21, cacheProfilePages:14, cacheFaultPages:1, cacheAppPages:5, streamProfilePages:14,
    streamHostAppCases:15, streamSizedAppCases:32, streamLayoutChecks:2, keyboardCases:15,
    trustedKeyboardEvents:keyboard.cases.reduce((sum,row)=>sum+row.nativeKeys,0) },
  verifiedRawFiles:rawRows.length, verifications:Object.fromEntries(verifications.map(file=>[file,sha(readFileSync(path.join(dir,file)))])),
  note:'不同測試宿主、效能樣本、正式App及原生鍵盤分開計數。每組工具已先獨立驗證，precheck資料不計最終通過。',
};
writeFileSync(path.join(dir,'final-seal.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ allPassed:true, sourceFiles:Object.keys(result.sourceHashes).length, ...result.groups }));
