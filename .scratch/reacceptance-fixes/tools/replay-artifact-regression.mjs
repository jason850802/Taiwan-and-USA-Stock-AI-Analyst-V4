// 動態產物的契約回歸：只有明標單元資料，不啟站、不編譯產品、不製造成功raw。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as contract from './replay-contract.mjs';

const { root, evidence, safeOutput, atomicJson, sha, relative, options } = contract;
const args = options(process.argv.slice(2), ['phase']);
assert(['red', 'green'].includes(args.phase), '請指定 --phase red|green');
const directory = safeOutput(`${evidence}/artifacts-${args.phase}-${randomUUID()}`); mkdirSync(directory);
const rows = [], inputs = contract.fingerprints();
const expected = { '02': [], '03': [], '04': ['holdings.js'], '05-before': ['holdings.js'], '05-after': ['holdings.js'] };
const unitBytes = Buffer.from('export const protocolOnly = "不是產品bundle或browser證據";\n');
const unitHash = sha(unitBytes);
function check(name, action) {
  try { rows.push({ name, passed: true, observation: action() ?? null }); }
  catch (error) { rows.push({ name, passed: false, error: String(error.stack || error) }); }
}
function fixture(group, mode = 'good') {
  const runId = randomUUID(), folder = path.join(directory, randomUUID()); mkdirSync(folder);
  const context = { directory: folder, manifest: { definitionSha256: '0'.repeat(64), definition: {
    batchId: randomUUID(), inputs, expected: contract.expectedCases(), expectedArtifacts: expected,
  } } };
  const artifacts = safeOutput(path.join(folder, 'runs', group, runId, 'artifacts')); mkdirSync(artifacts, { recursive: true });
  const declared = {};
  if (expected[group].length) {
    declared['holdings.js'] = unitHash;
    if (mode !== 'missing-file') writeFileSync(path.join(artifacts, 'holdings.js'), mode === 'drift' ? Buffer.concat([unitBytes, Buffer.from(' ')]) : unitBytes, { flag: 'wx' });
    if (mode === 'missing-hash') delete declared['holdings.js'];
    if (mode === 'extra-file') writeFileSync(path.join(artifacts, 'extra.js'), unitBytes, { flag: 'wx' });
  }
  return { context, group, runId, declared };
}
check('各組明確列實際產物集合', () => {
  assert.equal(typeof contract.expectedBuildArtifacts, 'function');
  assert.deepEqual(contract.expectedBuildArtifacts(), expected);
});
for (const group of Object.keys(expected)) check(`正確產物集合可重算：${group}`, () => {
  assert.equal(typeof contract.verifyRunArtifacts, 'function');
  const unit = fixture(group);
  const verified = contract.verifyRunArtifacts(unit.context, group, unit.runId, unit.declared);
  assert.deepEqual(verified.artifactHashes, unit.declared);
});
for (const group of ['04', '05-before', '05-after']) for (const mode of ['missing-hash', 'missing-file', 'drift', 'extra-file']) check(`${group}/${mode}拒絕`, () => {
  assert.equal(typeof contract.verifyRunArtifacts, 'function');
  const unit = fixture(group, mode);
  assert.throws(() => contract.verifyRunArtifacts(unit.context, group, unit.runId, unit.declared), /建置產物/);
});
check('初載binding保存該run精確產物hash', () => {
  const unit = fixture('05-before');
  assert.deepEqual(contract.bindingFor(unit.context, unit.group, unit.runId, unit.declared).artifactHashes, unit.declared);
});
check('重複保存不得覆寫第一次編譯的bytes', () => {
  const unit = fixture('04'), nextRun = randomUUID();
  const replay = contract.prepareRun(unit.context, '04', nextRun);
  assert.equal(typeof replay.captureArtifact, 'function');
  replay.captureArtifact('holdings.js', unitBytes);
  const file = path.join(replay.directory, 'artifacts', 'holdings.js');
  assert.throws(() => replay.captureArtifact('holdings.js', Buffer.from('different')), /建置產物.*重複/);
  assert.equal(sha(readFileSync(file)), unitHash);
  assert.equal(replay.binding.artifactHashes['holdings.js'], unitHash);
});
const adapterFile = path.join(root, '.scratch/reacceptance-fixes/tools/replay-harness-adapter.mjs');
const adapter = existsSync(adapterFile) ? await import(pathToFileURL(adapterFile).href) : null;
for (const ticket of ['04', '05']) check(`原${ticket}build分支移到啟站前且仍只有一次build`, () => {
  assert.equal(typeof adapter?.adaptHarnessSource, 'function');
  const sourceFile = path.join(root, `.scratch/optimization-followup/evidence/${ticket}/fixture-server.mjs`);
  const source = readFileSync(sourceFile, 'utf8'), changed = adapter.adaptHarnessSource(source, ticket);
  assert.equal([...changed.matchAll(/\bbuild\(/g)].length, 1);
  assert.ok(changed.indexOf("replay.captureArtifact('holdings.js', bundle)") < changed.indexOf('createServer(async'));
  assert.ok(changed.includes('replay.artifactPath("holdings.js")'));
  const call = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: changed, cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(call.status, 0, call.stderr);
  return { originalSha256: sha(source), adaptedSha256: sha(changed), syntaxExitCode: call.status };
});
const report = { schema: 'p1-artifact-regression-v1', phase: args.phase, at: new Date().toISOString(), rows,
  command: [process.execPath, ...process.argv.slice(1)], checks: rows.length, failed: rows.filter(row => !row.passed).length,
  contractSha256: sha(readFileSync(path.join(root, '.scratch/reacceptance-fixes/tools/replay-contract.mjs'))),
  scope: '合成單元產物與原build分支轉接語法；沒有listen、真gate或browser PASS；HTTP真正servedbytes由prime新run另驗。' };
atomicJson(path.join(directory, 'results.json'), report, true);
console.log(JSON.stringify({ output: relative(directory), checks: report.checks, failed: report.failed, failedNames: rows.filter(row => !row.passed).map(row => row.name) }));
if (report.failed) process.exitCode = 1;
