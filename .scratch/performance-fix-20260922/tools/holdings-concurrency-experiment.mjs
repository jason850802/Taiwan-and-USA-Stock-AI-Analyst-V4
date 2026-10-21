import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(toolDir, '../evidence/05/concurrency-experiment-20260923-v1');
const outputFile = path.join(outputDir, 'results.json');
const limits = [3, 4, 6];
const counts = [10, 30];
const scenarios = ['normal', '429', 'error'];
const requestDurationMs = 80;

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const outcomeFor = (scenario, job) => {
  if (scenario === '429' && job.kind === 'quote' && job.symbol === 'PERF03') return '429';
  if (scenario === 'error' && job.kind === 'quote' && job.symbol === '777705.TW') return 'error';
  return 'ok';
};

const simulate = (count, limit, scenario) => {
  const twCount = count / 2;
  const twSymbols = Array.from({ length: twCount }, (_, index) => `${777701 + index}.TW`);
  const usSymbols = Array.from({ length: count - twCount }, (_, index) => `PERF${String(index + 1).padStart(2, '0')}`);
  const queue = [
    ...twSymbols.map(symbol => ({ kind: 'quote', symbol, enqueuedMs: 0 })),
    ...usSymbols.map(symbol => ({ kind: 'quote', symbol, enqueuedMs: 0 })),
    { kind: 'fx', symbol: 'USDTWD=X', enqueuedMs: 0 },
  ];
  const active = [];
  const completed = [];
  let now = 0;
  let peak = 0;

  const pump = () => {
    while (active.length < limit && queue.length) {
      const job = queue.shift();
      active.push({
        ...job,
        startMs: now,
        completeMs: now + requestDurationMs,
        outcome: outcomeFor(scenario, job),
      });
      peak = Math.max(peak, active.length);
    }
  };

  pump();
  while (active.length) {
    now = Math.min(...active.map(job => job.completeMs));
    const finishing = active.filter(job => job.completeMs === now);
    for (const job of finishing) {
      active.splice(active.indexOf(job), 1);
      completed.push(job);
      if (job.kind === 'quote' && job.symbol.endsWith('.TW') && job.outcome === 'ok') {
        queue.push({ kind: 'name', symbol: job.symbol.replace(/\.TW$/, ''), enqueuedMs: now });
      }
      pump();
    }
  }

  const primary = completed.filter(job => job.kind === 'quote' || job.kind === 'fx');
  const quotes = primary.filter(job => job.kind === 'quote');
  const successfulQuotes = quotes.filter(job => job.outcome === 'ok');
  const names = completed.filter(job => job.kind === 'name');
  const errors = completed.filter(job => job.outcome !== 'ok');
  const queueWaits = primary.map(job => job.startMs - job.enqueuedMs);
  const allPrimaryValid = errors.every(job => job.kind === 'name');
  return {
    count,
    limit,
    scenario,
    requestDurationMs,
    requestCount: completed.length,
    requestCountByKind: {
      quote: quotes.length,
      fx: primary.filter(job => job.kind === 'fx').length,
      name: names.length,
    },
    httpPeak: peak,
    firstValidQuoteMs: Math.min(...successfulQuotes.map(job => job.completeMs)),
    allValidQuotesFxMs: allPrimaryValid ? Math.max(...primary.map(job => job.completeMs)) : null,
    allPrimarySettledMs: Math.max(...primary.map(job => job.completeMs)),
    allNamesCompleteMs: names.length ? Math.max(...names.map(job => job.completeMs)) : null,
    primaryQueueWaitMedianMs: median(queueWaits),
    primaryQueueWaitMaxMs: Math.max(...queueWaits),
    errorCount: errors.length,
    errors: errors.map(job => ({ kind: job.kind, symbol: job.symbol, outcome: job.outcome })),
  };
};

const results = counts.flatMap(count => limits.flatMap(limit => scenarios.map(scenario => simulate(count, limit, scenario))));
const payload = {
  schemaVersion: 1,
  model: 'deterministic discrete-event simulation of holdingPriceQueue semantics; product default remains 3',
  requestDurationMs,
  results,
};

fs.mkdirSync(outputDir, { recursive: true });
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
if (fs.existsSync(outputFile)) {
  if (fs.readFileSync(outputFile, 'utf8').trimEnd() !== serialized.trimEnd()) throw new Error(`既有實驗結果不同，拒絕覆寫：${outputFile}`);
} else {
  fs.writeFileSync(outputFile, serialized, { flag: 'wx' });
}
console.log(JSON.stringify(payload, null, 2));
