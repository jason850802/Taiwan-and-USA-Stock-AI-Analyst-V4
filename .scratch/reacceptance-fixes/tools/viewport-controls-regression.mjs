// 執行真控制函式，使用標準Response驗成功／失敗body只能消費一次；非browser raw。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { atomicJson, sha } from './replay-contract.mjs';
const source = readFileSync(new URL('../viewport-controls.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function captureAcceptedRaw()');
const end = source.indexOf('async function retryAcceptedCase()', start);
assert.ok(start >= 0 && end > start);
const config = { rawPath: '/fixture', rawFile: 'desktop-manual-market.json', runId: 'unit-only' };
const raw = { passed: true, integration: { runId: config.runId }, replayCase: { file: config.rawFile } };
const hash = sha(Buffer.from(JSON.stringify(raw)));
const invoke = new Function('fetch', 'config', 'assert', `let originalRaw, originalRawSha256; ${source.slice(start, end)} return captureAcceptedRaw();`);
const rows = [];
for (const scenario of ['success', 'http-failure']) {
  try {
    const response = new Response(scenario === 'success' ? JSON.stringify(raw) : 'fixture rejected', {
      status: scenario === 'success' ? 200 : 409, headers: { 'X-Replay-Raw-Sha256': hash },
    });
    const promise = invoke(async () => response, config, (ok, message) => { if (!ok) throw new Error(message); });
    if (scenario === 'success') assert.deepEqual(await promise, { file: config.rawFile, sha256: hash, passed: true, runId: config.runId });
    else await assert.rejects(promise, /409 fixture rejected/);
    rows.push({ scenario, passed: true });
  } catch (error) { rows.push({ scenario, passed: false, error: String(error.stack) }); }
}
const file = `.scratch/reacceptance-fixes/evidence/01/checks/viewport-response-${randomUUID()}.json`;
atomicJson(file, { at: new Date().toISOString(), sourceSha256: sha(Buffer.from(source)), rows, passed: rows.every(row => row.passed) }, true);
console.log(JSON.stringify({ file, rows }));
if (rows.some(row => !row.passed)) process.exitCode = 1;
