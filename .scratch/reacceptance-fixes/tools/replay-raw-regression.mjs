// 真fresh raw的負向副本矩陣；保留原ID及bytes，不將歷史成功重新標成新驗收。
import nodeAssert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, evidence, tools12, options, requiredManifest, safeOutput, atomicJson, sha, canonical, json, verifyManifest, relative } from './replay-contract.mjs';

const args = options(process.argv.slice(2), ['manifest', 'gate', 'stale-raw', 'origin']);
const context = requiredManifest(args);
nodeAssert.ok(args.gate && args['stale-raw'], '須指定 --gate <最終真gate.json> --stale-raw <另一真run的03成功raw>');
const verified = verifyManifest(context);
const staleFile = safeOutput(args['stale-raw']), staleBytes = readFileSync(staleFile), stale = JSON.parse(staleBytes);
nodeAssert.equal(stale.passed, true, '舊輪種子必須為真成功raw');
nodeAssert.equal(stale.integration?.schema, 'p1-replay-v1', '舊輪種子必須保留真runId，不可從歷史補標');
nodeAssert.equal(stale.integration.group, '03');
nodeAssert.equal(stale.replayCase?.file, 'desktop-green-stale-return.json', '請使用同案例同尺寸的舊run種子，避免其他身分差異掩蓋run檢查');
nodeAssert.notEqual(stale.integration.runId, verified.groups['03'].runId);
const directory = safeOutput(`${evidence}/raw-negative-${randomUUID()}`); mkdirSync(directory);
const tree = folder => readdirSync(folder).flatMap(name => {
  const file = path.join(folder, name), info = lstatSync(file);
  nodeAssert.equal(info.isSymbolicLink(), false, '證據不能穿越連結');
  return info.isDirectory() ? tree(file) : [file];
});
const originals = Object.fromEntries([...tree(context.directory), staleFile, safeOutput(args.gate)].map(file => [file, sha(readFileSync(file))]));
const rows = [];
let sequence = 0;
function clone(name) {
  const target = safeOutput(path.join(directory, `${String(++sequence).padStart(2, '0')}-${name}`));
  cpSync(context.directory, target, { recursive: true, errorOnExist: true, force: false });
  return { directory: target, manifest: path.join(target, 'manifest.json') };
}
function rawFile(copy, group, name) {
  const row = verified.groups[group].cases.find(item => path.basename(item.file) === name);
  nodeAssert.ok(row, `找不到原始案例：${group}/${name}`);
  return safeOutput(path.join(copy.directory, row.file));
}
function mutate(file, callback) { const value = json(file); callback(value); atomicJson(file, value); }
function invoke(entry, copy, extra = []) {
  const argv = [`${tools12}/${entry}`, '--manifest', copy.manifest, ...extra];
  const call = spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  nodeAssert.equal(call.error, undefined);
  return { command: [process.execPath, ...argv], cwd: root, exitCode: call.status, signal: call.signal, stdout: call.stdout, stderr: call.stderr };
}
function verifier(copy) { return invoke('verify-replays.mjs', copy); }
function seal(copy) { return invoke('seal-results.mjs', copy, ['--gate', safeOutput(args.gate)]); }
function rejected(result, pattern) { nodeAssert.notEqual(result.exitCode, 0); nodeAssert.match(result.stderr, pattern); }
async function test(id, name, callback) {
  try { rows.push({ id, name, passed: true, ...await callback() }); }
  catch (error) { rows.push({ id, name, passed: false, error: error.stack || error.message }); }
}
const desktop = 'desktop-green-stale-return.json', narrow = 'narrow-green-stale-return.json';
await test('P01', '完整真raw副本：verifier、queue、seal均可通過', () => {
  const copy = clone('complete');
  const calls = [verifier(copy), invoke('summarize-queue.mjs', copy), seal(copy)];
  calls.forEach(call => nodeAssert.equal(call.exitCode, 0, call.stderr));
  return { manifest: relative(copy.manifest), calls, rawFiles: Object.values(verified.groups).reduce((sum, group) => sum + group.cases.length, 0) };
});
await test('P02', '缺本輪一案，另目錄仍保留同名真成功raw', () => {
  const copy = clone('missing-with-residue'), file = rawFile(copy, '03', desktop);
  const leftover = safeOutput(path.join(copy.directory, 'previous-success')); mkdirSync(leftover);
  const residue = path.join(leftover, desktop); renameSync(file, residue);
  const state = path.join(copy.directory, 'runs', '03', verified.groups['03'].runId, 'state.json');
  mutate(state, value => { delete value.cases[desktop]; value.status = 'collecting'; });
  const call = verifier(copy); rejected(call, /執行尚未完整成功/);
  nodeAssert.equal(existsSync(residue), true);
  return { calls: [call], retainedSuccess: relative(residue), retainedSha256: sha(readFileSync(residue)), collected: 11, expected: 12 };
});
await test('P03', '另一真run成功raw原bytes放入指定輪，身分不符即拒絕', () => {
  const copy = clone('old-run'), target = rawFile(copy, '03', desktop);
  copyFileSync(staleFile, target);
  const call = verifier(copy); rejected(call, /raw執行／來源／工具／build不符/);
  nodeAssert.equal(sha(readFileSync(target)), sha(staleBytes));
  return { calls: [call], originalStaleRaw: relative(staleFile), staleRunId: stale.integration.runId, selectedRunId: verified.groups['03'].runId, copiedBytesIdentical: true };
});
await test('P04', '05前版真raw不能代替後版同sample', () => {
  const copy = clone('before-after');
  copyFileSync(rawFile(copy, '05-before', 'before-load-1-0.json'), rawFile(copy, '05-after', 'after-load-1-0.json'));
  const call = verifier(copy); rejected(call, /raw執行／來源／工具／build不符/); return { calls: [call] };
});
await test('P04', '窄版真raw不能代替桌面案', () => {
  const copy = clone('wrong-size'); copyFileSync(rawFile(copy, '03', narrow), rawFile(copy, '03', desktop));
  const call = verifier(copy); rejected(call, /raw案例身分不符/); return { calls: [call] };
});
for (const [id, name, mutation, pattern] of [
  ['P06', 'missing-run-id', value => { delete value.integration.runId; }, /raw執行／來源／工具／build不符/],
  ['P06', 'unknown-schema', value => { value.integration.schema = 'unknown-future-schema'; }, /raw執行／來源／工具／build不符/],
  ['P06', 'unknown-case', value => { value.replayCase.payloadName = 'green-not-an-expected-case'; }, /raw案例身分不符/],
  ['P07', 'missing-source-hash', value => { delete value.integration.sourceHashes['App.tsx']; }, /raw執行／來源／工具／build不符/],
  ['P07', 'missing-tool-hash', value => { delete value.integration.toolHashes[`${tools12}/replay-server.mjs`]; }, /raw執行／來源／工具／build不符/],
  ['P07', 'missing-build-hash', value => { delete value.integration.buildHashes['dist/index.html']; }, /raw執行／來源／工具／build不符/],
  ['P07', 'changed-source-hash', value => { value.integration.sourceHashes['App.tsx'] = '0'.repeat(64); }, /raw執行／來源／工具／build不符/],
  ...['index.css', 'postcss.config.js', 'tailwind.config.js'].map(file =>
    ['P07', `missing-${file.replaceAll('.', '-')}`, value => { delete value.integration.sourceHashes[file]; }, /raw執行／來源／工具／build不符/]),
  ...[context.manifest.definition.inputs.esbuildRuntime.binary, context.manifest.definition.inputs.esbuildRuntime.nativePackageJson,
    '.scratch/reacceptance-fixes/run-check.mjs', 'scripts/run-gate.mjs'].map((file, index) =>
    ['P07', `missing-runtime-tool-${index}`, value => { delete value.integration.toolHashes[file]; }, /raw執行／來源／工具／build不符/]),
]) await test(id, name, () => {
  const copy = clone(name); mutate(rawFile(copy, '03', desktop), mutation);
  const call = verifier(copy); rejected(call, pattern); return { calls: [call] };
});
for (const group of ['04', '05-before', '05-after']) for (const mutation of ['missing', 'drift']) await test('P07', `${group}真正建置產物${mutation}拒絕`, () => {
  const copy = clone(`${group}-artifact-${mutation}`);
  const file = safeOutput(path.join(copy.directory, 'runs', group, verified.groups[group].runId, 'artifacts', 'holdings.js'));
  const beforeSha256 = sha(readFileSync(file));
  if (mutation === 'missing') renameSync(file, path.join(copy.directory, 'withheld-holdings.js'));
  else writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from(' ')]));
  const calls = [verifier(copy), ...(group.startsWith('05') ? [invoke('summarize-queue.mjs', copy)] : []), seal(copy)];
  calls.forEach(call => rejected(call, /建置產物/));
  return { calls, artifact: relative(file), beforeSha256, afterSha256: existsSync(file) ? sha(readFileSync(file)) : null };
});
await test('P07', 'raw缺少當輪harness產物hash拒絕', () => {
  const copy = clone('missing-raw-artifact-hash');
  mutate(rawFile(copy, '05-before', 'before-load-1-0.json'), value => { delete value.integration.artifactHashes['holdings.js']; });
  const calls = [verifier(copy), invoke('summarize-queue.mjs', copy), seal(copy)];
  calls.forEach(call => rejected(call, /raw執行／來源／工具／build不符/));
  return { calls };
});
await test('P09', '半份raw JSON不可產生PASS', () => {
  const copy = clone('partial-json'); writeFileSync(rawFile(copy, '03', desktop), '{"integration":', 'utf8');
  const call = verifier(copy); rejected(call, /JSON|position|property|Unexpected|Expected/i); return { calls: [call] };
});
await test('P09', '選擇中的路徑穿越runId不可讀取外部', () => {
  const copy = clone('path-traversal'); mutate(copy.manifest, value => { value.selected['03'].runId = '../../outside'; });
  const call = verifier(copy); rejected(call, /組別／runId無效/); return { calls: [call] };
});
await test('P09', 'raw目錄多出未知case不可倒推完整性', () => {
  const copy = clone('unexpected-file'), file = rawFile(copy, '03', desktop);
  copyFileSync(file, path.join(path.dirname(file), 'unknown-case.json'));
  const call = verifier(copy); rejected(call, /raw預期檔案集合不符/); return { calls: [call] };
});
await test('P10', 'verifier舊摘要不能封存本manifest', () => {
  const copy = clone('old-verifier-summary'); mutate(path.join(copy.directory, 'verified-replays.json'), value => { value.manifestRevision--; });
  const call = seal(copy); rejected(call, /分組摘要版本／run／raw不符/); return { calls: [call] };
});
await test('P10', 'queue舊摘要不能封存本manifest', () => {
  const copy = clone('old-queue-summary'); mutate(path.join(copy.directory, 'queue-summary.json'), value => { value.manifestRevision--; });
  const call = seal(copy); rejected(call, /05摘要版本／run／raw不符/); return { calls: [call] };
});
await test('P10', 'verifier通過後raw僅加空白，seal仍須核出SHA改變', () => {
  const copy = clone('raw-changed-after-verify'), file = rawFile(copy, '03', desktop);
  const original = readFileSync(file); writeFileSync(file, Buffer.concat([original, Buffer.from(' ')]));
  const call = seal(copy); rejected(call, /raw／receipt雜湊不符/);
  return { calls: [call], beforeSha256: sha(original), afterSha256: sha(readFileSync(file)), semanticJsonUnchanged: canonical(JSON.parse(original)) === canonical(json(file)) };
});
await test('P11', '同run未完成→補齊真raw：驗證狀態回放', () => {
  const copy = clone('same-run-completion'), file = rawFile(copy, '03', desktop);
  const state = path.join(copy.directory, 'runs', '03', verified.groups['03'].runId, 'state.json'), originalState = readFileSync(state);
  const saved = path.join(copy.directory, 'unreceived-case.json'); renameSync(file, saved);
  mutate(state, value => { delete value.cases[desktop]; value.status = 'collecting'; });
  const before = verifier(copy); rejected(before, /執行尚未完整成功/);
  renameSync(saved, file); writeFileSync(state, originalState);
  const after = verifier(copy); nodeAssert.equal(after.exitCode, 0, after.stderr);
  return { calls: [before, after], runId: verified.groups['03'].runId, limit: '這是驗證器狀態回放；真活站補案及重啟由prime的P11／P05證據覆蓋。' };
});

// 只向明確指定的目前假站送必須被拒絕的POST，不啟站、不修改正常case。
if (args.origin) {
  nodeAssert.match(args.origin, /^http:\/\/127\.0\.0\.1:417[6-9]$/);
  const metaResponse = await fetch(`${args.origin}/__integration/meta`), meta = await metaResponse.json();
  const selected = verified.groups[meta.group];
  nodeAssert.ok(selected && selected.runId === meta.runId, 'HTTP站不是本manifest明確選定的run');
  const seed = json(path.join(context.directory, selected.cases[0].file));
  nodeAssert.equal(canonical(seed.integration), canonical(meta));
  const post = async (runId, payload) => {
    const response = await fetch(`${args.origin}/__fixture/result`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Replay-Run': runId }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    return { method: 'POST', url: `${args.origin}/__fixture/result`, status: response.status, body: await response.text() };
  };
  await test('P08', '真HTTP重複case明確409，原raw不變', async () => {
    const response = await post(meta.runId, { name: seed.replayCase.payloadName, result: seed });
    nodeAssert.equal(response.status, 409); nodeAssert.match(response.body, /重複送出/); return { http: response };
  });
  await test('P09', '真HTTP半份JSON不寫成功檔', async () => {
    const response = await post(meta.runId, '{"result":'); nodeAssert.equal(response.status, 400); return { http: response };
  });
  if (meta.group === '03') await test('P05', '真HTTP拒絕另一真03輪ID及舊bootstrap版本', async () => {
    const response = await post(stale.integration.runId, { name: stale.replayCase.payloadName, result: stale });
    nodeAssert.equal(response.status, 409); nodeAssert.match(response.body, /runId.*過期/);
    const url = `${args.origin}/__integration/${stale.integration.runId}/${stale.integration.toolHashes[`${tools12}/integration-bootstrap.js`]}.js`;
    const script = await fetch(url); nodeAssert.equal(script.status, 410);
    return { http: response, bootstrap: { url, status: script.status, body: await script.text() }, limit: 'HTTP重送與舊版本下載；真正舊browser頁面跨restart另外由prime驗證。' };
  });
}
const changedOriginals = Object.entries(originals).filter(([file, hash]) => !existsSync(file) || sha(readFileSync(file)) !== hash).map(([file]) => relative(file));
const report = { schema: 'p1-raw-negative-v1', manifest: relative(context.file), manifestSha256: context.manifestSha256,
  staleRaw: relative(staleFile), staleSha256: sha(staleBytes), node: process.version, rows, originalFilesChecked: Object.keys(originals).length, changedOriginals,
  passed: rows.every(row => row.passed) && changedOriginals.length === 0,
  limits: '所有副本保留原批次／runId，故障注入只為觀察拒絕。這些副本不計109案新browser。HTTP欄位只於指定origin時執行；P05真browser與P11真活站另列。' };
atomicJson(path.join(directory, 'results.json'), report, true);
console.log(JSON.stringify({ output: relative(directory), checks: rows.length, passed: report.passed, changedOriginals }));
if (!report.passed) { console.error(JSON.stringify(rows.filter(row => !row.passed))); process.exitCode = 1; }
