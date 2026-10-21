import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const runId = valueOf('--run-id', 'true-market-paired-20260923-v1');
const outputName = valueOf('--output-name', 'summary.json');
const beforeSourceId = valueOf('--before-source-id', '444d6b1');
const afterSourceId = valueOf('--after-source-id', 'working-tree');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');
if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(outputName)) throw new Error('output-name 無效');
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(toolDir, `../evidence/05/${runId}`);

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const raws = [];
for (let pair = 1; pair <= 3; pair++) {
  for (const variant of ['before', 'after']) {
    const file = path.join(evidenceDir, `${variant}-pair-${pair}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    raws.push({ variant, pair, file, data });
  }
}

const problems = [];
for (const raw of raws) {
  const { data, variant, pair } = raw;
  if (data.schemaVersion !== 1 || data.variant !== variant || data.pair !== pair || data.mode !== 'cold') problems.push(`${variant} pair ${pair}: identity`);
  const expectedSourceId = variant === 'before' ? beforeSourceId : afterSourceId;
  if (data.sourceId !== expectedSourceId) problems.push(`${variant} pair ${pair}: sourceId`);
  if (!data.pass || data.timedOut) problems.push(`${variant} pair ${pair}: run failed`);
  if (data.requestCount !== 16 || data.requestCountByKind?.quote !== 10 || data.requestCountByKind?.fx !== 1 || data.requestCountByKind?.name !== 5) problems.push(`${variant} pair ${pair}: request count`);
  if (data.successCount !== 10 || !Number.isFinite(data.firstValidQuoteMs) || !Number.isFinite(data.allValidQuotesFxMs)) problems.push(`${variant} pair ${pair}: valid quote metrics`);
  if (data.httpPeak !== 3) problems.push(`${variant} pair ${pair}: http peak`);
  if (!data.coreUnchanged || data.pageErrors?.length) problems.push(`${variant} pair ${pair}: core/page errors`);
  if (!data.requests?.every(request => request.status === 200 && Number.isFinite(request.bodyMs))) problems.push(`${variant} pair ${pair}: upstream status/body`);
}

const summarize = variant => {
  const subset = raws.filter(raw => raw.variant === variant).map(raw => raw.data);
  const first = subset.map(data => data.firstValidQuoteMs);
  const all = subset.map(data => data.allValidQuotesFxMs);
  return {
    firstValidQuoteMs: { median: median(first), min: Math.min(...first), max: Math.max(...first), values: first },
    allValidQuotesFxMs: { median: median(all), min: Math.min(...all), max: Math.max(...all), values: all },
    successCounts: subset.map(data => data.successCount),
    requestCounts: subset.map(data => data.requestCount),
    httpPeaks: subset.map(data => data.httpPeak),
    nameSuccessCounts: subset.map(data => data.nameSuccessCount),
  };
};

const before = summarize('before');
const after = summarize('after');
const improvement = {
  firstValidQuotePct: (before.firstValidQuoteMs.median - after.firstValidQuoteMs.median) / before.firstValidQuoteMs.median * 100,
  allValidQuotesFxPct: (before.allValidQuotesFxMs.median - after.allValidQuotesFxMs.median) / before.allValidQuotesFxMs.median * 100,
};
const thresholdPass = improvement.firstValidQuotePct >= 40 && improvement.allValidQuotesFxPct >= 40
  && after.successCounts.every(count => count === 10);
const payload = {
  schemaVersion: 1,
  runId,
  protocol: '3 interleaved cold before/after paired batches; five TW + five US; true Yahoo/FinMind upstream',
  before,
  after,
  improvement,
  thresholdPass,
  problems,
  pass: problems.length === 0 && thresholdPass,
};
const output = path.join(evidenceDir, outputName);
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
if (fs.existsSync(output)) {
  if (fs.readFileSync(output, 'utf8').trimEnd() !== serialized.trimEnd()) throw new Error(`既有摘要不同，拒絕覆寫：${output}`);
} else {
  fs.writeFileSync(output, serialized, { flag: 'wx' });
}
console.log(JSON.stringify(payload, null, 2));
if (!payload.pass) process.exitCode = 1;
