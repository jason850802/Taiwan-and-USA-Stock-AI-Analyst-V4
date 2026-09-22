// S1 專項協定反例：真 HTTP 拒絕與唯讀副本 verifier 拒絕分開保存。
import { cpSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRun, root, relative, sha } from './s1-run.mjs';
import { canonical } from '../../../tools/replay-contract.mjs';

const [hookArg, formalArg] = process.argv.slice(2);
if (!hookArg || !formalArg) throw new Error('用法：node s1-negative.mjs <hook manifest> <formal manifest>');
const read = file => JSON.parse(readFileSync(path.resolve(root, file), 'utf8'));
const hookFile = path.resolve(root, hookArg), formalFile = path.resolve(root, formalArg);
const hook = read(hookArg), formal = read(formalArg);
const firstName = hook.expected[0];
const firstRaw = read(path.join(path.dirname(hookArg), `${firstName}.json`));
const checks = [];
const expectStatus = async (name, url, value, status) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const body = await response.text();
  if (response.status !== status) throw new Error(`${name} 預期 ${status}，實際 ${response.status}：${body}`);
  checks.push({ name, kind: 'http', expectedStatus: status, actualStatus: response.status, body });
};
const expectReject = (name, mutate) => {
  const directory = path.join(root, '.scratch/reacceptance-fixes/evidence/02/negative', randomUUID(), name);
  mkdirSync(path.dirname(directory), { recursive: true });
  cpSync(path.dirname(hookFile), directory, { recursive: true, errorOnExist: true });
  mutate(directory);
  let message = '';
  try { verifyRun(relative(path.join(directory, 'manifest.json'))); } catch (error) { message = error.message; }
  if (!message) throw new Error(`${name} 沒有被 verifier 拒絕`);
  checks.push({ name, kind: 'verifier', rejected: true, message, copy: relative(directory) });
};

await expectStatus('duplicate-hook-result', 'http://127.0.0.1:4184/result', firstRaw, 409);
await expectStatus('wrong-page-binding', 'http://127.0.0.1:4184/result', {
  ...firstRaw, binding: { ...firstRaw.binding, runId: randomUUID() },
}, 400);
await expectStatus('unknown-case', 'http://127.0.0.1:4184/result', {
  binding: hook.binding, name: 'unknown-case', result: { passed: true, requests: [] },
}, 400);
const stale = await fetch(`http://127.0.0.1:4184/__s1/${randomUUID()}/bad/health-input-cases.mjs`);
if (stale.status !== 410) throw new Error(`過期工具 URL 預期410，實際${stale.status}`);
checks.push({ name: 'stale-version-url', kind: 'http', expectedStatus: 410, actualStatus: stale.status, body: await stale.text() });
const formalRaw = read(path.join(path.dirname(formalArg), 'desktop.json'));
await expectStatus('duplicate-formal-result', 'http://127.0.0.1:4185/__result', formalRaw, 409);

expectReject('tampered-raw-binding', directory => {
  const file = path.join(directory, `${firstName}.json`), raw = JSON.parse(readFileSync(file, 'utf8'));
  raw.binding.runId = randomUUID();
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
});
expectReject('missing-raw', directory => unlinkSync(path.join(directory, `${firstName}.json`)));
expectReject('tampered-input-hash', directory => {
  const file = path.join(directory, 'manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8'));
  const key = Object.keys(manifest.binding.inputs.sourceHashes)[0];
  manifest.binding.inputs.sourceHashes[key] = '0'.repeat(64);
  manifest.bindingSha256 = sha(canonical(manifest.binding));
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
});
expectReject('unexpected-file', directory => writeFileSync(path.join(directory, 'extra.json'), '{}\n'));

const outputDirectory = path.join(root, '.scratch/reacceptance-fixes/evidence/02/negative', randomUUID(), 'result');
mkdirSync(outputDirectory, { recursive: true });
const result = { schema: 's1-negative-v1', passed: checks.length === 9, createdAt: new Date().toISOString(),
  manifests: { hook: relative(hookFile), formal: relative(formalFile) }, checks };
const output = path.join(outputDirectory, 'negative.json');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, output: relative(output) }, null, 2));
if (!result.passed) process.exitCode = 1;
