import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valueOf = name => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
const required = name => {
  const value = valueOf(name);
  if (!value) throw new Error(`缺少 ${name}`);
  return path.resolve(value);
};
const portOf = name => valueOf(name) === null ? null : Number(valueOf(name));
const routes = ['/api/yahoo/chart', '/api/finmind'];
const protocol = valueOf('--protocol') || 'formal';
if (!['formal', 'threshold-only'].includes(protocol)) throw new Error('protocol 無效');

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const loadRows = (label, file, port) => {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(json.rows)) throw new Error(`${label} 缺 rows`);
  const ports = [...new Set(json.rows.map(row => row.port).filter(Number.isFinite))];
  if (port === null && ports.length > 1) throw new Error(`${label} 有多個 port，需指定 selector`);
  const selected = json.rows.filter(row => port === null || row.port === port);
  if (!selected.length) throw new Error(`${label} 無樣本`);
  return selected.map(row => ({
    route: row.route,
    status: row.status,
    error: row.error ?? null,
    totalMs: row.totalMs,
    phase: row.phase ?? (Number.isFinite(row.round) && row.round === 0 ? 'cold' : 'warm'),
    serviceStartId: row.serviceStartId ?? (Number.isFinite(row.port) ? `legacy-port-${row.port}` : 'legacy'),
    pairId: row.pairId ?? (Number.isFinite(row.round) ? `legacy-round-${row.round}` : null),
  }));
};

const failures = [];
const validate = (label, rows) => {
  for (const route of routes) {
    const subset = rows.filter(row => row.route === route);
    if (!subset.length) failures.push(`${label}: 缺少 ${route}`);
    for (const row of subset) {
      if (row.status !== 204) failures.push(`${label}: ${route} status=${row.status ?? 'missing'}`);
      if (row.error) failures.push(`${label}: ${route} error=${row.error}`);
      if (!Number.isFinite(row.totalMs) || row.totalMs < 0) failures.push(`${label}: ${route} totalMs 無效`);
    }
  }
  if (protocol === 'formal') {
    const starts = [...new Set(rows.map(row => row.serviceStartId))];
    if (starts.length < 2) failures.push(`${label}: 獨立服務啟動少於 2`);
    for (const start of starts) {
      const pairIdsByRoute = {};
      for (const route of routes) {
        const subset = rows.filter(row => row.serviceStartId === start && row.route === route);
        if (!subset.some(row => row.phase === 'cold')) {
          failures.push(`${label}: ${start} 的 ${route} 缺 cold`);
        }
        const warm = subset.filter(row => row.phase === 'warm');
        if (warm.length < 5) failures.push(`${label}: ${start} 的 ${route} warm 少於 5`);
        if (warm.some(row => !row.pairId)) failures.push(`${label}: ${start} 的 ${route} warm 缺 pairId`);
        const pairIds = warm.map(row => row.pairId).filter(Boolean);
        const uniquePairIds = new Set(pairIds);
        if (uniquePairIds.size !== pairIds.length) {
          failures.push(`${label}: ${start} 的 ${route} warm pairId 重複`);
        }
        pairIdsByRoute[route] = uniquePairIds;
      }
      const yahooPairIds = pairIdsByRoute['/api/yahoo/chart'];
      const finmindPairIds = pairIdsByRoute['/api/finmind'];
      if (
        yahooPairIds.size !== finmindPairIds.size
        || [...yahooPairIds].some(pairId => !finmindPairIds.has(pairId))
      ) {
        failures.push(`${label}: ${start} 的 warm pairId 未在 Yahoo/FinMind 一對一匹配`);
      }
    }
  }
};

const summarize = rows => {
  const byRoute = {};
  for (const route of routes) {
    const all = rows.filter(row => row.route === route);
    const warm = all.filter(row => row.phase === 'warm');
    const use = warm.length ? warm : all;
    byRoute[route] = {
      sampleCount: all.length,
      coldCount: all.filter(row => row.phase === 'cold').length,
      warmCount: warm.length,
      medianMs: use.length ? median(use.map(row => row.totalMs)) : null,
      minMs: use.length ? Math.min(...use.map(row => row.totalMs)) : null,
      maxMs: use.length ? Math.max(...use.map(row => row.totalMs)) : null,
    };
  }
  const warm = rows.filter(row => row.phase === 'warm' && routes.includes(row.route));
  const use = warm.length ? warm : rows.filter(row => routes.includes(row.route));
  return {
    byRoute,
    overall: {
      sampleCount: use.length,
      medianMs: use.length ? median(use.map(row => row.totalMs)) : null,
      minMs: use.length ? Math.min(...use.map(row => row.totalMs)) : null,
      maxMs: use.length ? Math.max(...use.map(row => row.totalMs)) : null,
    },
  };
};

const inputs = {
  before: { file: required('--before'), port: portOf('--before-port') },
  candidate: { file: required('--candidate'), port: portOf('--candidate-port') },
  reference: { file: required('--reference'), port: portOf('--reference-port') },
};
const rows = Object.fromEntries(Object.entries(inputs).map(([label, input]) => [label, loadRows(label, input.file, input.port)]));
for (const [label, value] of Object.entries(rows)) validate(label, value);
const summaries = Object.fromEntries(Object.entries(rows).map(([label, value]) => [label, summarize(value)]));

const checks = {};
for (const route of routes) {
  const get = (label) => summaries[label].byRoute[route];
  const before = get('before');
  const candidate = get('candidate');
  const reference = get('reference');
  if (![before.medianMs, candidate.medianMs, reference.medianMs].every(Number.isFinite)) {
    failures.push(`${route}: 缺中位數`);
    continue;
  }
  const referenceLimitMs = reference.medianMs * 1.25 + 250;
  const slowReproduced = before.medianMs > referenceLimitMs;
  const reductionFraction = 1 - candidate.medianMs / before.medianMs;
  const referencePass = candidate.medianMs <= referenceLimitMs;
  const reductionPass = !slowReproduced || reductionFraction >= 0.5;
  checks[route] = {
    beforeMedianMs: before.medianMs,
    candidateMedianMs: candidate.medianMs,
    referenceMedianMs: reference.medianMs,
    referenceLimitMs,
    slowReproduced,
    reductionFraction,
    referencePass,
    reductionPass,
    pass: referencePass && reductionPass,
  };
  if (!referencePass) failures.push(`${route}: candidate 超過精簡對照門檻`);
  if (!reductionPass) failures.push(`${route}: 慢速已重現但 candidate 未降低至少 50%`);
}

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  protocol,
  summaries,
  checks,
  failures: [...new Set(failures)],
};
result.pass = result.failures.length === 0 && Object.values(checks).every(check => check.pass);

const output = valueOf('--output');
if (output) {
  const outputPath = path.resolve(output);
  if (fs.existsSync(outputPath)) throw new Error(`比較輸出已存在，拒絕覆寫：${outputPath}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
