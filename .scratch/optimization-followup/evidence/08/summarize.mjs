// 由原始樣本產生資源／耗時摘要；缺樣本、失敗或來源漂移即退出，不挑有利結果。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const ticket = process.argv[2] || '08';
if (!['08', '12'].includes(ticket)) throw new Error('輸出票號錯誤');
const dir = path.join(root, '.scratch/optimization-followup/evidence', ticket);
const read = name => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rounded = number => Number(number.toFixed(3));
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, median: rounded(sorted[Math.floor(sorted.length / 2)] || 0),
    worst: rounded(sorted.at(-1) || 0), total: rounded(values.reduce((sum, value) => sum + value, 0)) };
};
const operation = values => ({ ...stats(values.map(row => row.ms)), failures: values.filter(row => !row.ok).length });
const verify = row => {
  if (!row.passed || row.metrics.errors.length) throw new Error(`案例失敗：${row.count}/${row.sample} ${row.error || row.metrics.errors}`);
  for (const [file, expected] of Object.entries(row.sourceHashes)) {
    if (sha(readFileSync(path.join(root, file))) !== expected) throw new Error(`原始碼已改變：${file}`);
  }
  for (const [file, expected] of Object.entries(row.instrumentationHashes)) {
    if (sha(readFileSync(new URL(`./${file}`, import.meta.url))) !== expected) throw new Error(`量測工具已改變：${file}`);
  }
};
const datasets = [30, 100].map(count => {
  const all = Array.from({ length: 7 }, (_, sample) => read(`profile-${count}-${sample}.json`));
  all.forEach(verify);
  if (new Set(all.map(row => row.outputDigest)).size !== 1) throw new Error('同資料集輸出雜湊不一致');
  const samples = all.map(row => ({ sample: row.sample, wallMs: row.wallMs, initialModuleReadyMs: row.initialModuleReadyMs,
    firstRoundServiceMs: row.rounds[0].serviceMs, roundChartRequests: row.rounds.map(round => round.chartRequests),
    roundServiceMs: row.rounds.map(round => round.serviceMs), totalRoundServiceMs: row.rounds.reduce((sum, round) => sum + round.serviceMs, 0),
    roundHitRates: row.rounds.map(round => round.hitRate), roundAllFetches: row.rounds.map(round => round.requests),
    retained: row.withLatestPrices, fundamentals: row.fundamentals.map(day => ({ day: day.day, hits: day.hits,
      requests: day.requests, retained: day.retained.fundamentals, persisted: day.retained.persisted.fundamentals })),
    recentWorkset: row.recentWorkset,
    conversion: stats(row.metrics.conversion.map(operation => operation.ms)),
    serialization: operation(row.metrics.serialization.filter(operation => operation.kind === 'quote')),
    storage: operation(row.metrics.storage.filter(operation => operation.kind === 'quote')),
    fundamentalSerialization: operation(row.metrics.serialization.filter(operation => operation.kind === 'fundamentals')),
    fundamentalStorage: operation(row.metrics.storage.filter(operation => operation.kind === 'fundamentals')),
    longTasksObserved: row.metrics.longTasks.length,
  }));
  const measured = samples.slice(2);
  return { count, cold: samples[0], warmup: samples[1], measured,
    firstRoundServiceMs: stats(measured.map(row => row.firstRoundServiceMs)),
    roundServiceMs: [0, 1, 2].map(round => stats(measured.map(row => row.roundServiceMs[round]))),
    totalRoundServiceMs: stats(measured.map(row => row.totalRoundServiceMs)),
    wallMs: stats(measured.map(row => row.wallMs)),
    quoteConversionTotalMs: stats(measured.map(row => row.conversion.total)),
    quoteSerializationTotalMs: stats(measured.map(row => row.serialization.total)),
    quoteStorageTotalMs: stats(measured.map(row => row.storage.total)),
    quoteSerializationWorstOperationMs: stats(measured.map(row => row.serialization.worst)),
    quoteStorageWorstOperationMs: stats(measured.map(row => row.storage.worst)),
    resources: measured[0].retained, fundamentals: measured[0].fundamentals, recentWorkset: measured[0].recentWorkset,
    roundHitRates: measured.map(row => row.roundHitRates), roundChartRequests: measured.map(row => row.roundChartRequests),
    outputDigest: all[0].outputDigest,
  };
});
const faults = read('faults-30-0.json');
verify(faults);
if (!faults.sentinelsIntact) throw new Error('sentinel 被改變');
const report = { ticket, sourceHashes: faults.sourceHashes, instrumentationHashes: faults.instrumentationHashes,
  browser: faults.browser, node: faults.node, environment: faults.environment,
  method: 'sample0 冷啟動另列，sample1 暖機排除，sample2～6 五次中位數與最差值；每頁三輪切換與基本面跨日',
  datasets, faults: faults.findings, allPassed: true,
};
const before = JSON.parse(readFileSync(new URL('../07/profile-summary.json', import.meta.url), 'utf8'));
report.comparison = datasets.map(after => {
  const prior = before.datasets.find(item => item.count === after.count);
  if (prior.outputDigest !== after.outputDigest) throw new Error('07/08 完整輸出不一致');
  // 原07摘要沒有第二、三輪耗時；直接讀保存的五份正式樣本，不修改歷史證據。
  const priorSamples = Array.from({ length: 5 }, (_, i) => JSON.parse(readFileSync(new URL(`../07/profile-${after.count}-${i + 2}.json`, import.meta.url), 'utf8')));
  if (priorSamples.some(row => !row.passed || row.outputDigest !== after.outputDigest)) throw new Error('07原始樣本未通過或資料不符');
  const priorRounds = [0, 1, 2].map(round => stats(priorSamples.map(row => row.rounds[round].serviceMs)));
  const priorTotal = stats(priorSamples.map(row => row.rounds.reduce((sum, round) => sum + round.serviceMs, 0)));
  const memoryBytes = retained => retained.quote.estimatedPayloadBytes + retained.quote.estimatedKeyBytes;
  return { count: after.count, outputEqual: true,
    before: { bytes: memoryBytes(prior.resources), firstRoundMs: prior.firstRoundServiceMs.median, roundServiceMs: priorRounds,
      totalRoundServiceMs: priorTotal, wallMs: stats(priorSamples.map(row => row.wallMs)), hitRates: prior.roundHitRates, chartRequests: prior.roundChartRequests },
    after: { bytes: memoryBytes(after.resources), firstRoundMs: after.firstRoundServiceMs.median, roundServiceMs: after.roundServiceMs,
      totalRoundServiceMs: after.totalRoundServiceMs, wallMs: after.wallMs, hitRates: after.roundHitRates, chartRequests: after.roundChartRequests },
    recentWorkset: after.recentWorkset };
});
writeFileSync(path.join(dir, 'profile-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ allPassed: true, datasets: datasets.map(row => ({ count: row.count,
  resources: row.resources, firstRoundServiceMs: row.firstRoundServiceMs,
  conversionTotalMs: row.quoteConversionTotalMs, serializationTotalMs: row.quoteSerializationTotalMs,
  storageTotalMs: row.quoteStorageTotalMs, worstStorageMs: row.quoteStorageWorstOperationMs,
  worstSerializationMs: row.quoteSerializationWorstOperationMs, recentWorkset: row.recentWorkset,
  fundamentals: row.fundamentals, hitRates: row.roundHitRates,
})), faults: faults.findings }, null, 2));
