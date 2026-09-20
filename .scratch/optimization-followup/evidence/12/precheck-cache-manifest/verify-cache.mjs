// 12沿用08驗收規則、讀12新結果；工具指紋仍對08來源，不覆寫08歷史。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../../../', import.meta.url);
const dir = new URL('./', import.meta.url);
const toolDir = new URL('../08/', dir);
const limits = JSON.parse(readFileSync(new URL('../07/capacity-decision.json', dir), 'utf8'));
const baseline = JSON.parse(readFileSync(new URL('../07/profile-summary.json', dir), 'utf8'));
const read = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const assert = (condition, label) => { if (!condition) throw new Error(label); };
function verifySources(row, file, tools = 'instrumentationHashes') {
  assert(row.passed === true, `${file} 未通過`);
  assert(row.sourceHashes && row.sourceHashes['services/quoteCache.ts'] && row.sourceHashes['services/finmind.ts'], `${file} 無完整指紋`);
  for (const [path, expected] of Object.entries(row.sourceHashes)) assert(sha(new URL(path, root)) === expected, `${file} 原始碼漂移 ${path}`);
  for (const [path, expected] of Object.entries(row[tools])) assert(sha(new URL(path, toolDir)) === expected, `${file} 工具漂移 ${path}`);
}
function verifyBounds(retained, label) {
  for (const kind of ['quote', 'fundamentals']) {
    const memory = retained[kind], stored = retained.persisted[kind], budget = limits[kind];
    assert(memory.keys === memory.uniquePayloads + memory.aliases && memory.keys >= 0, `${label}/${kind} 計數不符`);
    assert(memory.estimatedPayloadBytes + memory.estimatedKeyBytes <= budget.memoryBytes, `${label}/${kind} memory bytes 超標`);
    assert(memory.keys <= (budget.memoryKeys || budget.memoryEntries) && memory.uniquePayloads <= (budget.memoryPayloads || budget.memoryEntries), `${label}/${kind} memory count 超標`);
    assert(memory.largestPayloadBytes <= budget.maxEntryBytes && memory.unmeasurable === 0, `${label}/${kind} 單項超標`);
    assert(stored.keys <= budget.sessionKeys && stored.bytes + stored.keyBytes <= budget.sessionBytes && stored.largestPayloadBytes <= budget.maxSessionEntryBytes, `${label}/${kind} session 超標`);
    const index = retained.indexes[kind], sessionIndex = retained.indexes[`${kind}Session`];
    assert(index.entries === memory.uniquePayloads && (index.orphanPayloads || index.orphanKeys || 0) === 0 && (index.unindexedPayloads || index.unindexedKeys || 0) === 0, `${label}/${kind} 旁邊索引持有孤立資料`);
    if (kind === 'quote') assert(index.indexedKeys === memory.keys && index.staleKeys === 0, `${label} 別名索引不同步`);
    assert(sessionIndex.entries <= budget.sessionKeys && sessionIndex.orphanKeys === 0, `${label}/${kind} session 索引超標`);
  }
}
const profiles = [];
for (const count of [30, 100]) {
  for (let sample = 0; sample < 7; sample++) {
    const file = `profile-${count}-${sample}.json`, row = read(file);
    verifySources(row, file);
    assert(row.count === count && row.sample === sample && row.metrics.errors.length === 0 && row.rounds.length === 3, `${file} 樣本/錯誤不符`);
    assert(row.outputDigest === baseline.datasets.find(data => data.count === count).outputDigest, `${file} 完整輸出與07不同`);
    row.rounds.forEach((round, i) => verifyBounds(round.retained, `${file}/round${i}`));
    [row.withLatestPrices, row.recentRetained, row.finalRetained].forEach(retained => verifyBounds(retained, file));
    row.fundamentals.forEach(day => {
      verifyBounds(day.retained, file);
      assert(day.hits === count * 2 && day.retained.fundamentals.dates.join(',') === day.day.slice(0, 10), `${file} 基本面工作集或跨日清理不符`);
    });
    assert(row.recentWorkset.chartRequests === 0, `${file} 近期工作集未命中`);
    profiles.push({ file, sha256: sha(new URL(file, dir)), passed: true, recentChartRequests: 0, fingerprint: row.probeBundleSha256 });
  }
}
assert(new Set(profiles.map(row => row.fingerprint)).size === 1, '壓力頁面編譯指紋不一致');
const faults = read('faults-30-0.json');
verifySources(faults, 'faults-30-0.json');
assert(faults.sentinelsIntact && faults.metrics.errors.length === 0 && faults.probeBundleSha256 === profiles[0].fingerprint, '故障頁面來源或sentinel不符');
const recovered = faults.findings.find(row => row.mode === 'denied-recovery');
assert(recovered && !recovered.oldValueRestored && !recovered.oldAliasRestored, '故障後權限恢復未驗證');
verifyBounds(faults.findings.find(row => row.mode === 'oversize').retained, 'oversize');
const apps = ['pressure', 'quota', 'denied', 'corrupt', 'oversize'].map(name => {
  const file = `app-${name}.json`, row = read(file);
  verifySources(row, file, 'tools');
  assert(row.errors.length === 0 && row.sentinelsIntact, `${file} 錯誤或sentinel不符`);
  assert(row.buildIndexSha256 === sha(new URL('dist/index.html', root)), `${file} 正式build漂移`);
  assert(row.requests.every(request => ['/api/yahoo/chart', '/api/finmind'].includes(request.path) && request.status === 200), `${file} 非預期API`);
  if (name === 'pressure') assert(row.readings.filter(reading => Number.isInteger(reading.round)).length === 90, '正式App三輪30檔不完整');
  if (['quota', 'denied'].includes(name)) assert(row.faults.length > 0, `${file} 未發生指定故障`);
  return { file, sha256: sha(new URL(file, dir)), passed: true, requests: row.requests.length, injectedStorageFailures: row.faults.length, errors: 0, sentinelsIntact: true };
});
const report = { ticket: '12', profiles, faultPage: { file: 'faults-30-0.json', sha256: sha(new URL('faults-30-0.json', dir)), passed: true, sentinelsIntact: true }, apps, allPassed: true };
writeFileSync(new URL('verified-cache.json', dir), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ profilePages: profiles.length, appPages: apps.length, allPassed: true }));
