import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../../../', import.meta.url);
const sha = p => createHash('sha256').update(readFileSync(new URL(p, root))).digest('hex');
const hookSha256 = sha('components/portfolio/useHoldingPrices.ts');
const queueSha256 = sha('components/portfolio/holdingPriceQueue.ts');
const buildIndexSha256 = sha('dist/index.html');
const names = [
  ...[1, 10, 30].flatMap(n => Array.from({ length: 7 }, (_, i) => `after-load-${n}-${i}`)),
  ...['overlap', 'remove', 'unmount', 'cache', 'duplicate', 'retry'].map(s => `green-${s}-30-0`),
  'green-app-30-0', 'manual-refresh-30',
];
const cases = names.map(name => {
  const r = JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
  return { name, passed: r.passed === true, peak: r.network.peak,
    hookMatches: r.hookSha256 === hookSha256, queueMatches: r.queueSha256 === queueSha256,
    buildMatches: r.buildIndexSha256 === buildIndexSha256,
    uncaught: r.uncaught?.length ?? null,
    consoleErrors: r.console?.filter(row => row.level === 'error').length ?? null,
    unexpectedHttpErrors: r.httpErrors?.filter(row => !row.expected).length ?? null };
});
const result = { baseline: '0366f5fb1d58d963323cc9d519f49ec87217a048', hookSha256, queueSha256, buildIndexSha256, cases };
writeFileSync(new URL('./candidate-evidence.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
const failed = cases.filter(r => !r.passed || r.peak > 3 || !r.hookMatches || !r.queueMatches || !r.buildMatches || r.uncaught !== 0 || r.consoleErrors !== 0 || r.unexpectedHttpErrors !== 0);
console.log(JSON.stringify({ checked: cases.length, failed }));
process.exitCode = failed.length ? 1 : 0;
