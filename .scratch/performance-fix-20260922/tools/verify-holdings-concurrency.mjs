import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};
const runId = valueOf('--run-id', 'fixed-three-slot-20260923-v1');
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(runId)) throw new Error('run-id 無效');
const evidenceDir = path.resolve(toolDir, `../evidence/05/${runId}`);
const summaryFile = path.join(evidenceDir, 'summary.json');

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const summarize = count => {
  const data = JSON.parse(fs.readFileSync(path.join(evidenceDir, `holdings-${count}.json`), 'utf8'));
  const force = data.runs.filter(run => run.mode === 'force');
  const expectedRequests = count + count / 2 + 1;
  const problems = [];
  if (data.schemaVersion !== 2 || data.queueLimit !== 3 || data.count !== count) problems.push('identity mismatch');
  if (force.length !== 5) problems.push(`force rounds ${force.length}`);
  for (const run of force) {
    if (!run.pass) problems.push(`round ${run.round} failed`);
    if (run.requestCount !== expectedRequests || !run.requestCountExact) problems.push(`round ${run.round} request mismatch`);
    if (run.httpPeak !== 3) problems.push(`round ${run.round} peak ${run.httpPeak}`);
    const primary = run.requests.filter(request => request.kind === 'quote' || request.kind === 'fx');
    const fxStartRank = primary.findIndex(request => request.kind === 'fx') + 1;
    if (fxStartRank < 1 || fxStartRank > 3) problems.push(`round ${run.round} FX start rank ${fxStartRank || 'missing'}`);
    for (const field of ['firstValidQuoteMs', 'allValidQuotesFxMs', 'quoteFxDispatchWaitMedianMs', 'quoteFxDispatchWaitMaxMs', 'allNamesVisibleMs']) {
      if (!Number.isFinite(run[field])) problems.push(`round ${run.round} missing ${field}`);
    }
    if (!run.coreUnchanged || run.unexpectedRequests.length) problems.push(`round ${run.round} side effect/unexpected request`);
  }
  if (data.pageErrors.length) problems.push(`page errors ${data.pageErrors.length}`);
  const values = field => force.map(run => run[field]);
  return {
    count,
    expectedRequests,
    forceRounds: force.length,
    mediansMs: {
      firstValidQuote: median(values('firstValidQuoteMs')),
      allValidQuotesFx: median(values('allValidQuotesFxMs')),
      queueWait: median(values('quoteFxDispatchWaitMedianMs')),
      queueWaitMax: median(values('quoteFxDispatchWaitMaxMs')),
      allNamesVisible: median(values('allNamesVisibleMs')),
    },
    rangesMs: Object.fromEntries([
      ['firstValidQuote', values('firstValidQuoteMs')],
      ['allValidQuotesFx', values('allValidQuotesFxMs')],
      ['queueWait', values('quoteFxDispatchWaitMedianMs')],
      ['queueWaitMax', values('quoteFxDispatchWaitMaxMs')],
      ['allNamesVisible', values('allNamesVisibleMs')],
    ].map(([key, values]) => [key, [Math.min(...values), Math.max(...values)]])),
    httpPeaks: values('httpPeak'),
    fxStartRanks: force.map(run => {
      const primary = run.requests.filter(request => request.kind === 'quote' || request.kind === 'fx');
      return primary.findIndex(request => request.kind === 'fx') + 1;
    }),
    requestCounts: values('requestCount'),
    problems,
    pass: problems.length === 0,
  };
};

const summaries = [summarize(10), summarize(30)];
const payload = { schemaVersion: 2, runId, summaries, pass: summaries.every(summary => summary.pass) };
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
if (fs.existsSync(summaryFile)) {
  if (fs.readFileSync(summaryFile, 'utf8').trimEnd() !== serialized.trimEnd()) throw new Error(`既有摘要不同，拒絕覆寫：${summaryFile}`);
} else {
  fs.writeFileSync(summaryFile, serialized, { flag: 'wx' });
}
console.log(JSON.stringify(payload, null, 2));
if (!payload.pass) process.exitCode = 1;
