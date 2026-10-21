// 覆核缺口的紅綠回歸：真實來源、實際 esbuild API 的 spawn 邊界及 gate 工具身分。
// 不執行 binary／gate／HTTP；manifest fixture 沒有選案與成功 gate，不作正式驗收證據。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as contract from './replay-contract.mjs';

const { root, evidence, schema, sha, canonical, options, safeOutput, atomicJson, relative } = contract;
const args = options(process.argv.slice(2), ['phase', 'legacy-gate', 'protection', 'gate']);
assert(['red', 'green'].includes(args.phase) && args['legacy-gate'] && args.protection,
  '請指定 --phase red|green --legacy-gate <原缺SHA紀錄> --protection <原保護清單>；真新gate另可加 --gate <G>');
const directory = safeOutput(`${evidence}/fingerprint-${args.phase}-${randomUUID()}`);
mkdirSync(directory);
const rows = [];
const check = (name, callback) => {
  try { rows.push({ name, passed: true, observation: callback() ?? null }); }
  catch (error) { rows.push({ name, passed: false, error: String(error.stack || error) }); }
};
const contractFile = path.join(root, '.scratch/reacceptance-fixes/tools/replay-contract.mjs');
const originalContract = readFileSync(contractFile);
writeFileSync(path.join(directory, 'contract-source.txt'), originalContract, { flag: 'wx' });
const inputs = contract.fingerprints();
atomicJson(path.join(directory, 'fingerprints.json'), inputs, true);

// 以完整、未改 bytes 的 esbuild API 走 build()，只在真正 spawn 呼叫處截停。
// 此探針與 contract 的平台解析責任獨立，不執行 esbuild executable 或輸出 bundle。
function actualEsbuildCommand() {
  const entry = path.join(root, 'node_modules/esbuild/lib/main.js');
  const requireFromEntry = createRequire(entry), halted = new Error('只記錄 spawn，不啟動程序');
  let captured;
  const readOnlyRequire = name => {
    if (name === 'child_process') return { spawn(command, commandArgs) { captured = { command, arguments: [...commandArgs] }; throw halted; } };
    if (!['fs', 'os', 'path', 'crypto', 'tty'].includes(name)) throw new Error(`探針不提供模組：${name}`);
    if (name === 'fs') return { existsSync, readFileSync };
    return requireFromEntry(name);
  };
  readOnlyRequire.resolve = requireFromEntry.resolve;
  const sandbox = {
    require: readOnlyRequire, module: { exports: {} }, exports: {}, __filename: entry, __dirname: path.dirname(entry),
    Buffer, Uint8Array, TextEncoder, TextDecoder, console: { warn() {} },
    process: { platform: process.platform, versions: process.versions, cwd: () => root, env: { ESBUILD_WORKER_THREADS: '0' } },
  };
  const source = readFileSync(entry, 'utf8');
  vm.runInNewContext(source, sandbox, { timeout: 1000, filename: entry });
  assert.throws(() => sandbox.module.exports.build({ stdin: { contents: 'export const probe = 1;' }, write: false }), error => error === halted);
  assert(captured && path.isAbsolute(captured.command), 'API未解析native executable');
  let packageDirectory = path.dirname(captured.command);
  while (!existsSync(path.join(packageDirectory, 'package.json'))) {
    assert.notEqual(packageDirectory, path.dirname(packageDirectory), '找不到native package metadata');
    packageDirectory = path.dirname(packageDirectory);
  }
  const packageFile = path.join(packageDirectory, 'package.json');
  const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
  assert(metadata.name.startsWith('@esbuild/'), 'API未使用已安裝的native optional package');
  return { entry: relative(entry), entrySha256: sha(source), binary: relative(captured.command), binarySha256: sha(readFileSync(captured.command)),
    packageJson: relative(packageFile), packageSha256: sha(readFileSync(packageFile)), packageName: metadata.name,
    version: metadata.version, arguments: captured.arguments, launchedProcesses: 0 };
}
const runtime = actualEsbuildCommand();
atomicJson(path.join(directory, 'actual-esbuild-command.json'), runtime, true);
const protectionFile = safeOutput(args.protection), protection = JSON.parse(readFileSync(protectionFile, 'utf8'));
const sources = ['index.css', 'postcss.config.js', 'tailwind.config.js'];
const gateFiles = { runnerSha256: '.scratch/reacceptance-fixes/run-check.mjs', entrypointSha256: 'scripts/run-gate.mjs' };
const required = [['sourceHashes', sources], ['toolHashes', [runtime.binary, runtime.packageJson, ...Object.values(gateFiles)]]];
const definition = { schema, scope: 'P1-replay-109', batchId: randomUUID(), createdAt: new Date().toISOString(), inputs,
  expected: contract.expectedCases(), expectedArtifacts: contract.expectedBuildArtifacts?.(), baselineGate: { protocolOnly: true, note: '沒有執行或製造成功gate' },
  protection: { file: relative(protectionFile), sha256: sha(readFileSync(protectionFile)) } };
const fixture = { schema, definition, definitionSha256: sha(canonical(definition)), revision: 0, selected: {} };
let mutationIndex = 0;
function manifestWith(change) {
  const folder = path.join(directory, `protocol-only-${mutationIndex++}`); mkdirSync(folder);
  const value = structuredClone(fixture); change(value.definition.inputs);
  value.definitionSha256 = sha(canonical(value.definition));
  const file = path.join(folder, 'manifest.json'); atomicJson(file, value, true); return file;
}
check('未選案fixture僅可讀契約，不能產生驗收PASS', () => {
  const context = contract.loadManifest(manifestWith(() => {}));
  assert.throws(() => contract.verifyManifest(context), /尚未選定完整/);
});
for (const [map, files] of required) for (const file of files) {
  check(`完整集合：${map}/${file}`, () => assert.equal(inputs[map][file], sha(readFileSync(path.join(root, file)))));
  check(`缺欄拒絕：${map}/${file}`, () => assert.throws(() => contract.loadManifest(manifestWith(value => { delete value[map][file]; })), /完整指紋/));
  check(`雜湊漂移拒絕：${map}/${file}`, () => assert.throws(() => contract.loadManifest(manifestWith(value => { value[map][file] = '0'.repeat(64); })), /完整指紋/));
  check(`同數異集合拒絕：${map}/${file}`, () => assert.throws(() => contract.loadManifest(manifestWith(value => {
    const hash = value[map][file]; delete value[map][file]; value[map][`${file}.unrelated`] = hash || '0'.repeat(64);
  })), /完整指紋/));
}
check('三來源均吻合原protection，沒有補寫保護紀錄', () => {
  const verified = sources.map(file => ({ file, sha256: sha(readFileSync(path.join(root, file))), protectedSha256: protection.trackedHashes[file] }));
  verified.forEach(row => assert.equal(row.sha256, row.protectedSha256)); return verified;
});
for (const file of sources) {
  check(`before固定來源包含：${file}`, () => assert.match(inputs.beforeSourceHashes[file] || '', /^[a-f0-9]{64}$/));
  check(`before漏欄拒絕：${file}`, () => assert.throws(() => contract.loadManifest(manifestWith(value => { delete value.beforeSourceHashes[file]; })), /完整指紋/));
}
check('runtime解析結果等於實際build API將啟動的native binary', () => {
  assert.equal(inputs.esbuildRuntime?.binary, runtime.binary);
  assert.equal(inputs.esbuildRuntime?.nativePackageJson, runtime.packageJson);
  const context = contract.loadManifest(manifestWith(() => {}));
  assert.deepEqual(contract.bindingFor(context, '04', randomUUID()).esbuildRuntime, inputs.esbuildRuntime);
  return runtime;
});
const actualGateHashes = Object.fromEntries(Object.entries(gateFiles).map(([field, file]) => [field, sha(readFileSync(path.join(root, file)))]));
check('gate工具metadata核對不等於gate成功', () => {
  assert.equal(typeof contract.gateProvenance, 'function');
  assert.deepEqual(contract.gateProvenance(actualGateHashes), actualGateHashes);
});
for (const field of Object.keys(gateFiles)) for (const mode of ['missing', 'drift']) check(`gate工具${mode}：${field}`, () => {
  assert.equal(typeof contract.gateProvenance, 'function');
  const metadata = { ...actualGateHashes };
  if (mode === 'missing') delete metadata[field]; else metadata[field] = '0'.repeat(64);
  assert.throws(() => contract.gateProvenance(metadata), /gate工具/);
});
const legacyFile = safeOutput(args['legacy-gate']);
const legacyBytes = readFileSync(legacyFile);
check('真實歷史gate缺工具SHA明確拒絕', () => {
  assert.throws(() => contract.gateDetails(legacyFile), /gate工具/);
  assert.equal(sha(readFileSync(legacyFile)), sha(legacyBytes));
  return { record: relative(legacyFile), sha256: sha(legacyBytes) };
});
for (const override of ['missing-esbuild-probe', runtime.binary]) check('ESBUILD_BINARY_PATH覆寫拒絕：' + override, () => {
  const code = `import { fingerprints } from ${JSON.stringify(pathToFileURL(contractFile).href)}; fingerprints();`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, ESBUILD_BINARY_PATH: override },
  });
  assert.equal(result.error, undefined); assert.notEqual(result.status, 0); assert.match(result.stderr, /ESBUILD_BINARY_PATH/);
  return { command: ['node', '--input-type=module', '-e', code], exitCode: result.status, stderr: result.stderr };
});
if (args.gate) {
  const gateFile = safeOutput(args.gate), original = JSON.parse(readFileSync(gateFile, 'utf8'));
  check('真新gate通過完整gateDetails', () => contract.gateDetails(gateFile));
  for (const field of Object.keys(gateFiles)) for (const mode of ['missing', 'drift']) check(`真新gate負向副本：${field}/${mode}`, () => {
    const value = structuredClone(original);
    if (mode === 'missing') delete value[field]; else value[field] = '0'.repeat(64);
    const file = path.join(directory, `invalid-gate-${field}-${mode}.json`); atomicJson(file, value, true);
    assert.throws(() => contract.gateDetails(file), /gate工具/);
  });
}
const report = { schema: 'p1-fingerprint-regression-v1', phase: args.phase, at: new Date().toISOString(), node: process.version,
  command: [process.execPath, ...process.argv.slice(1)], contractSha256: sha(originalContract), regressionSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  inputsSha256: sha(canonical(inputs)), runtime, checks: rows.length, failed: rows.filter(row => !row.passed).length, rows,
  legacyGateUnchanged: sha(readFileSync(legacyFile)) === sha(legacyBytes),
  scope: '只測完整指紋／metadata及拒絕路徑；沒有啟站、執行binary、重跑gate或製造成功raw。protocol-only fixture不能選案。' };
atomicJson(path.join(directory, 'results.json'), report, true);
console.log(JSON.stringify({ output: relative(directory), checks: report.checks, failed: report.failed, contractSha256: report.contractSha256,
  inputsSha256: report.inputsSha256, failedNames: rows.filter(row => !row.passed).map(row => row.name) }));
if (report.failed) process.exitCode = 1;
