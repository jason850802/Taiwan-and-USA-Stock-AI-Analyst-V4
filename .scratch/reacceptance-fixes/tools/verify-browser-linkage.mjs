// 補驗已保存的時間點觀測；只檢查身分連結，不把後續狀態偽稱為空收件。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { atomicJson, json, options, safeOutput, sha } from './replay-contract.mjs';

const args = options(process.argv.slice(2), ['observation', 'verification', 'receipt', 'output']);
assert.ok(args.observation && args.verification && args.receipt && args.output);
const observation = json(safeOutput(args.observation));
const verification = json(safeOutput(args.verification));
assert.equal(verification.passed, true);
assert.equal(verification.observation, args.observation);
assert.equal(verification.observationSha256, sha(readFileSync(safeOutput(args.observation))));
const sourceFile = fileURLToPath(new URL('../verify-browser-negative.mjs', import.meta.url));
const source = readFileSync(sourceFile, 'utf8');
const start = source.indexOf('assert.equal(observation.originalPassed, true);');
const end = source.indexOf('assert.equal(observation.pageTimeOrigin,');
assert.ok(start >= 0 && end > start);
const code = source.slice(start, end);
const validate = value => vm.runInNewContext(code, { assert, observation: value });
validate(observation);
const rawBytes = readFileSync(safeOutput(verification.oldRaw.file));
const raw = JSON.parse(rawBytes);
assert.equal(sha(rawBytes), observation.duplicate.originalRawSha256);
assert.equal(raw.integration.runId, observation.duplicate.originalRunId);
assert.equal(raw.replayCase.file, observation.duplicate.originalFile);
assert.equal(raw.passed, observation.duplicate.originalPassed);
const rows = [{ name: '真觀測與實收raw連結', passed: true }];
for (const key of ['schema', 'manifest', 'originalRunId', 'originalFile', 'originalRawSha256', 'originalPassed']) {
  const changed = structuredClone(observation);
  changed.duplicate[key] = key === 'originalPassed' ? false : '錯位反例';
  assert.throws(() => validate(changed), undefined, `${key}應拒絕`);
  rows.push({ name: `拒絕duplicate.${key}錯位`, passed: true });
}
const changed = structuredClone(observation);
changed.originalPassed = false;
assert.throws(() => validate(changed));
rows.push({ name: '拒絕頂層originalPassed錯位', passed: true });
const receipt = json(safeOutput(args.receipt));
assert.equal(receipt.passed, true);
assert.equal(receipt.runId, observation.newRunId);
assert.equal(receipt.manifest, observation.manifest);
assert.ok(Date.parse(verification.checkedAt) < Date.parse(receipt.at), '空收件核對必須早於失敗fixture');
assert.equal(receipt.toolSha256, sha(readFileSync(fileURLToPath(new URL('./verify-failed-receipt.mjs', import.meta.url)))));
const failedFile = safeOutput(receipt.original.file), failedBytes = readFileSync(failedFile), failedRaw = JSON.parse(failedBytes);
assert.equal(sha(failedBytes), receipt.original.sha256);
assert.equal(failedRaw.passed, false);
assert.equal(failedRaw.protocolOnly, true);
assert.equal(failedRaw.integration.runId, receipt.runId);
assert.deepEqual(readdirSync(path.dirname(failedFile)), [path.basename(failedFile)]);
const stateBytes = readFileSync(safeOutput(verification.newState.file)), state = JSON.parse(stateBytes);
assert.equal(sha(stateBytes), receipt.state.afterSha256);
assert.equal(receipt.state.beforeSha256, receipt.state.afterSha256);
assert.equal(state.runId, receipt.runId);
assert.equal(state.status, 'failed');
assert.deepEqual(state.cases, { [path.basename(failedFile)]: { sha256: receipt.original.sha256, passed: false } });
rows.push({ name: '原空收件先於明標失敗fixture且目前只有該份失敗raw', passed: true });
const result = { schema: 'p1-browser-linkage-verification-v1', checkedAt: new Date().toISOString(), passed: true,
  observation: args.observation, observationSha256: sha(readFileSync(safeOutput(args.observation))),
  verification: args.verification, verificationSha256: sha(readFileSync(safeOutput(args.verification))),
  receipt: args.receipt, receiptSha256: sha(readFileSync(safeOutput(args.receipt))), currentRawCount: 1, currentSuccessfulRawCount: 0,
  verifierSha256: sha(Buffer.from(source)), runnerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), rows,
  limits: '原P05空收件是既有verification保存時的事實；後續同run已執行failed-receipt，本補驗不宣稱目前仍空，也不重寫原結果。' };
atomicJson(args.output, result, true);
console.log(JSON.stringify({ output: args.output, passed: true, checks: rows.length }));
