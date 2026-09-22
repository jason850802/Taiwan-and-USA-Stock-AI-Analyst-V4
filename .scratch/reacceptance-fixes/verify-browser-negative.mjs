// 重核真瀏覽器觀測對應的原raw與重啟後空收件；不生成成功案例或改動既有證據。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { atomicJson, json, loadManifest, options, relative, runDirectory, safeOutput, sha } from './tools/replay-contract.mjs';

const args = options(process.argv.slice(2), ['observation', 'output']);
assert.ok(args.observation && args.output, '指定 --observation <觀測.json> --output <新結果.json>');
const observationFile = safeOutput(args.observation), observation = json(observationFile);
assert.equal(observation.schema, 'p1-native-browser-negative-observation-v1');
const context = loadManifest(observation.manifest);
const oldDirectory = runDirectory(context, '03', observation.oldRunId);
const newDirectory = runDirectory(context, '03', observation.newRunId);
assert.notEqual(observation.oldRunId, observation.newRunId);
assert.equal(observation.initialHtmlRunId, observation.oldRunId);
// 逐欄綁定同頁重送觀測，避免手動轉存混入另一輪或另一案例。
assert.equal(observation.originalPassed, true);
assert.equal(observation.duplicate.schema, 'p1-native-browser-duplicate-observation-v1');
assert.equal(observation.duplicate.manifest, observation.manifest);
assert.equal(observation.duplicate.originalRunId, observation.oldRunId);
assert.equal(observation.duplicate.originalFile, observation.originalFile);
assert.equal(observation.duplicate.originalRawSha256, observation.originalRawSha256);
assert.equal(observation.duplicate.originalPassed, observation.originalPassed);
assert.equal(observation.pageTimeOrigin, observation.duplicate.pageTimeOrigin);
assert.ok(Number.isFinite(observation.childPageTimeOrigin), '缺子頁初載timeOrigin');
assert.equal(observation.childPageTimeOrigin, observation.duplicate.childPageTimeOrigin);
assert.equal(observation.lateMetadata?.runId, observation.newRunId);
assert.equal(observation.lateMetadata?.group, '03');
assert.equal(observation.lateMetadata?.batchId, context.manifest.definition.batchId);
assert.equal(observation.lateMetadata?.definitionSha256, context.manifest.definitionSha256);
assert.equal(observation.duplicate.status, 409);
assert.match(observation.duplicate.body, /重複送出/);
assert.equal(observation.delayedBootstrap.status, 410);
assert.ok(observation.delayedBootstrap.path.includes(observation.oldRunId));
assert.equal(observation.upload.status, 409);
assert.match(observation.upload.body, /runId.*過期/);
const oldFile = safeOutput(path.join(oldDirectory, 'raw', observation.originalFile));
const oldBytes = readFileSync(oldFile), oldRaw = JSON.parse(oldBytes);
assert.equal(oldRaw.passed, true);
assert.equal(oldRaw.integration.runId, observation.oldRunId);
assert.equal(sha(oldBytes), observation.originalRawSha256);
const oldState = json(safeOutput(path.join(oldDirectory, 'state.json')));
assert.equal(oldState.cases[observation.originalFile].sha256, sha(oldBytes));
const newStateFile = safeOutput(path.join(newDirectory, 'state.json')), newState = json(newStateFile);
assert.equal(newState.runId, observation.newRunId);
assert.deepEqual(newState.cases, {});
assert.equal(newState.status, 'collecting');
assert.deepEqual(readdirSync(safeOutput(path.join(newDirectory, 'raw'))), []);
const startups = Object.fromEntries([['old', oldDirectory], ['new', newDirectory]].map(([label, directory]) => {
  const file = safeOutput(path.join(directory, 'startup.json'));
  return [label, { file: relative(file), sha256: sha(readFileSync(file)), binding: json(file).binding }];
}));
const result = { schema: 'p1-native-browser-negative-verification-v1', checkedAt: new Date().toISOString(),
  observation: relative(observationFile), observationSha256: sha(readFileSync(observationFile)),
  manifest: relative(context.file), manifestSha256: context.manifestSha256, startups,
  oldRaw: { file: relative(oldFile), sha256: sha(oldBytes), passed: oldRaw.passed },
  newState: { file: relative(newStateFile), sha256: sha(readFileSync(newStateFile)), rawCount: 0 },
  checks: { duplicateIdentityLinked: true, samePageAcrossRestart: true, sameChildPageAcrossRestart: true, sameManifestRestart: true, duplicateRejected: true, oldBootstrapRejected: true,
    lateMetadataDidNotChangePageIdentity: true, oldPageUploadRejected: true, originalRawPreserved: true, noNewRaw: true },
  passed: true };
atomicJson(args.output, result, true);
console.log(JSON.stringify({ output: args.output, passed: true, checks: Object.keys(result.checks).length, newRawCount: 0 }));
