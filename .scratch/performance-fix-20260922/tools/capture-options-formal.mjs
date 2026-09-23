import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const valueOf = name => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const required = name => {
  const value = valueOf(name);
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
};

const baseUrl = new URL(required('--base-url'));
const serviceStartId = required('--service-start-id');
const outputPath = path.resolve(required('--output'));
const timeoutMs = Number(valueOf('--timeout-ms') || 60_000);
const warmPairs = Number(valueOf('--warm-pairs') || 5);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('--timeout-ms 必須是正數');
if (!Number.isInteger(warmPairs) || warmPairs < 5) throw new Error('--warm-pairs 至少為 5');
if (fs.existsSync(outputPath)) throw new Error(`輸出已存在，拒絕覆寫：${outputPath}`);

const routes = ['/api/yahoo/chart', '/api/finmind'];
const rows = [];

const probe = async (route, phase, pairId = null) => {
  const url = new URL(route, baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let status = null;
  let error = null;
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      signal: controller.signal,
      headers: { Origin: 'http://localhost:3000' },
    });
    status = response.status;
    await response.arrayBuffer();
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
  } finally {
    clearTimeout(timeout);
  }
  const totalMs = performance.now() - started;
  const row = {
    route,
    status,
    error,
    totalMs,
    phase,
    serviceStartId,
    pairId,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  return row;
};

let failed = false;
for (const route of routes) {
  const row = await probe(route, 'cold');
  if (row.status !== 204 || row.error) { failed = true; break; }
}
for (let round = 1; round <= warmPairs && !failed; round++) {
  const pairId = `${serviceStartId}-warm-${round}`;
  const order = round % 2 === 1 ? routes : [...routes].reverse();
  for (const route of order) {
    const row = await probe(route, 'warm', pairId);
    if (row.status !== 204 || row.error) { failed = true; break; }
  }
}

const result = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  baseUrl: baseUrl.href,
  serviceStartId,
  timeoutMs,
  warmPairs,
  rows,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');

if (failed || rows.some(row => row.status !== 204 || row.error)) process.exitCode = 1;
