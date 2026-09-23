import fs from 'node:fs';
import path from 'node:path';

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
const bundleDir = path.resolve(required('--bundle-dir'));
const expectedVariant = required('--variant');
const output = valueOf('--output') ? path.resolve(valueOf('--output')) : null;
if (output && fs.existsSync(output)) throw new Error(`validator 輸出已存在，拒絕覆寫：${output}`);
const failures = [];
const routes = ['/api/yahoo/chart', '/api/finmind'];
const startDirs = fs.readdirSync(bundleDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^start-\d+$/.test(entry.name))
  .map(entry => path.join(bundleDir, entry.name))
  .sort();
if (startDirs.length < 2) failures.push('獨立 start 少於 2');
const starts = [];
for (const startDir of startDirs) {
  const identityPath = path.join(startDir, 'identity.json');
  const statusPath = path.join(startDir, 'status.json');
  const rawPath = path.join(startDir, 'raw.json');
  for (const file of [identityPath, statusPath, rawPath]) {
    if (!fs.existsSync(file)) failures.push(`${path.basename(startDir)} 缺 ${path.basename(file)}`);
  }
  if (![identityPath, statusPath, rawPath].every(fs.existsSync)) continue;
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  if (identity.variant !== expectedVariant) failures.push(`${identity.serviceStartId}: variant=${identity.variant}`);
  if (!status.success) failures.push(`${identity.serviceStartId}: status 非成功 ${status.failure ?? ''}`);
  if (status.probeExitCode !== 0) failures.push(`${identity.serviceStartId}: probe exit=${status.probeExitCode}`);
  if (raw.serviceStartId !== identity.serviceStartId) failures.push(`${identity.serviceStartId}: raw serviceStartId 不一致`);
  for (const service of ['vite', 'vercel']) {
    const info = identity.services?.[service];
    if (!Number.isInteger(info?.spawnPid) || !Number.isInteger(info?.listenerPid)) failures.push(`${identity.serviceStartId}: ${service} PID 缺失`);
    else if (info.spawnPid !== info.listenerPid) failures.push(`${identity.serviceStartId}: ${service} listener PID 非 owned spawn PID`);
    if (!Number.isInteger(info?.port)) failures.push(`${identity.serviceStartId}: ${service} port 缺失`);
    if (!Array.isArray(info?.command) || info.command.length < 2) failures.push(`${identity.serviceStartId}: ${service} command 缺失`);
  }
  if (!identity.source?.head || !identity.source?.baseManifestSha256) failures.push(`${identity.serviceStartId}: source identity 缺失`);
  if (!identity.config?.vercelignoreSha256 || !identity.config?.viteConfigSha256) failures.push(`${identity.serviceStartId}: config hash 缺失`);
  if (!identity.runtime?.nodeVersion || !identity.runtime?.vercelVersion || !identity.runtime?.viteVersion) failures.push(`${identity.serviceStartId}: runtime version 缺失`);
  if (!identity.tools || Object.keys(identity.tools).length < 6) failures.push(`${identity.serviceStartId}: tool hashes 缺失`);

  const rows = raw.rows ?? [];
  for (const row of rows) {
    if (row.status !== 204) failures.push(`${identity.serviceStartId}: ${row.route} status=${row.status}`);
    if (row.error) failures.push(`${identity.serviceStartId}: ${row.route} error=${row.error}`);
    if (row.serviceStartId !== identity.serviceStartId) failures.push(`${identity.serviceStartId}: row serviceStartId 不一致`);
  }
  for (const route of routes) {
    const subset = rows.filter(row => row.route === route);
    const cold = subset.filter(row => row.phase === 'cold');
    const warm = subset.filter(row => row.phase === 'warm');
    if (cold.length !== 1) failures.push(`${identity.serviceStartId}: ${route} cold=${cold.length}，應為 1`);
    if (warm.length < 5) failures.push(`${identity.serviceStartId}: ${route} warm=${warm.length}，少於 5`);
    const ids = warm.map(row => row.pairId);
    if (ids.some(id => !id)) failures.push(`${identity.serviceStartId}: ${route} warm 缺 pairId`);
    if (new Set(ids).size !== ids.length) failures.push(`${identity.serviceStartId}: ${route} warm pairId 重複`);
  }
  const warmRows = rows.filter(row => row.phase === 'warm');
  const pairOrder = [];
  for (let index = 0; index < warmRows.length; index += 2) {
    const pair = warmRows.slice(index, index + 2);
    if (pair.length !== 2 || pair[0].pairId !== pair[1].pairId || pair[0].route === pair[1].route) {
      failures.push(`${identity.serviceStartId}: warm rows 不是連續 matched pair`);
      break;
    }
    pairOrder.push(pair[0].route);
  }
  for (let index = 1; index < pairOrder.length; index++) {
    if (pairOrder[index] === pairOrder[index - 1]) failures.push(`${identity.serviceStartId}: warm pair 起始 route 未交錯`);
  }
  const yahooIds = new Set(rows.filter(row => row.phase === 'warm' && row.route === routes[0]).map(row => row.pairId));
  const finmindIds = new Set(rows.filter(row => row.phase === 'warm' && row.route === routes[1]).map(row => row.pairId));
  if (yahooIds.size !== finmindIds.size || [...yahooIds].some(id => !finmindIds.has(id))) failures.push(`${identity.serviceStartId}: Yahoo/FinMind pairId 集合不一致`);
  starts.push({ identity, status, raw });
}

const unique = (values, label) => {
  const valid = values.filter(value => value !== undefined && value !== null);
  if (new Set(valid).size !== valid.length) failures.push(`${label} 在 starts 間重複`);
};
unique(starts.map(start => start.identity.serviceStartId), 'serviceStartId');
unique(starts.map(start => start.identity.services?.vercel?.spawnPid), 'Vercel PID');
unique(starts.map(start => start.identity.services?.vercel?.port), 'Vercel port');
unique(starts.map(start => start.identity.services?.vite?.spawnPid), 'Vite PID');
unique(starts.map(start => start.identity.services?.vite?.port), 'Vite port');
for (const field of [
  ['source head', start => start.identity.source?.head],
  ['base source manifest', start => start.identity.source?.baseManifestSha256],
  ['vercel config hash', start => start.identity.config?.vercelignoreSha256],
  ['vite config hash', start => start.identity.config?.viteConfigSha256],
  ['Node version', start => start.identity.runtime?.nodeVersion],
  ['Vercel version', start => start.identity.runtime?.vercelVersion],
  ['Vite version', start => start.identity.runtime?.viteVersion],
  ['tool hashes', start => JSON.stringify(start.identity.tools)],
]) {
  const values = starts.map(field[1]);
  if (new Set(values).size > 1) failures.push(`${field[0]} 在 starts 間不一致`);
}

const mergedPath = path.join(bundleDir, 'merged.json');
if (!fs.existsSync(mergedPath)) failures.push('缺 merged.json');
else {
  const merged = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
  const expectedIds = starts.map(start => start.identity.serviceStartId).sort();
  const mergedIds = [...(merged.serviceStartIds ?? [])].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(mergedIds)) failures.push('merged serviceStartIds 與 start identities 不一致');
  const expectedRows = starts.flatMap(start => start.raw.rows);
  if (JSON.stringify(merged.rows ?? []) !== JSON.stringify(expectedRows)) {
    failures.push('merged rows 與逐次 raw 內容或順序不一致');
  }
  const expectedInputs = starts.map(start => path.join(bundleDir, `start-${starts.indexOf(start) + 1}`, 'raw.json'));
  if (JSON.stringify((merged.inputs ?? []).map(input => path.resolve(input))) !== JSON.stringify(expectedInputs)) {
    failures.push('merged inputs 與逐次 raw 路徑不一致');
  }
}

const result = {
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  variant: expectedVariant,
  startCount: starts.length,
  serviceStartIds: starts.map(start => start.identity.serviceStartId),
  rowCount: starts.reduce((sum, start) => sum + start.raw.rows.length, 0),
  failures: [...new Set(failures)],
};
result.pass = result.failures.length === 0;
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
