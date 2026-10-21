// P1結構／頁面協定的CLI回歸；沒有製造成功browser raw，也不啟fixture站。
import nodeAssert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { root, evidence, tools12, options, requiredManifest, expectedCases, bindingFor, safeOutput, atomicJson, sha, canonical, loadManifest, verifyManifest } from './replay-contract.mjs';

const args = options(process.argv.slice(2), ['manifest']);
const context = requiredManifest(args), directory = safeOutput(`${evidence}/protocol-check-${randomUUID()}`);
mkdirSync(directory);
const rows = [];
async function test(id, name, callback) {
  try { await callback(); rows.push({ id, name, passed: true }); }
  catch (error) { rows.push({ id, name, passed: false, error: error.stack || error.message }); }
}
function alteredManifest(name, change, refreshHash = false) {
  const folder = safeOutput(path.join(directory, name)); mkdirSync(folder);
  const value = JSON.parse(readFileSync(context.file, 'utf8')); change(value);
  if (refreshHash) value.definitionSha256 = sha(canonical(value.definition));
  const file = path.join(folder, 'manifest.json'); atomicJson(file, value, true); return file;
}
await test('P01', '固定五組109案例；只核批次形狀，非109份browser通過', () => {
  const expected = expectedCases();
  nodeAssert.deepEqual(Object.fromEntries(Object.entries(expected).map(([group, list]) => [group, list.length])), { '02': 22, '03': 12, '04': 25, '05-before': 21, '05-after': 29 });
  for (const list of Object.values(expected)) nodeAssert.equal(new Set(list.map(row => row.file)).size, list.length);
});
await test('P02', '未選定組不回舊固定目錄找成功檔', () => {
  const file = alteredManifest('no-selected-run', value => { value.selected = {}; });
  nodeAssert.throws(() => verifyManifest(loadManifest(file)), /尚未選定完整/);
});
await test('P04', '05前版固定來源與目前host分層', () => {
  const old = bindingFor(context, '05-before', randomUUID()), current = bindingFor(context, '05-after', randomUUID());
  nodeAssert.equal(old.sourceVersion, '0366f5fb1d58d963323cc9d519f49ec87217a048');
  nodeAssert.equal(current.sourceVersion, 'working-tree');
  nodeAssert.notEqual(old.sourceHashes['components/portfolio/useHoldingPrices.ts'], old.hostSourceHashes['components/portfolio/useHoldingPrices.ts']);
  nodeAssert.deepEqual(old.hostSourceHashes, current.sourceHashes);
});
for (const [name, mutate, pattern] of [
  ['unknown-schema', value => { value.schema = 'unknown'; }, /schema/],
  ['missing-case', value => { value.definition.expected['03'].pop(); }, /預期案例集合/],
  ['missing-source', value => { delete value.definition.inputs.sourceHashes['App.tsx']; }, /完整指紋/],
  ['missing-tool', value => { delete value.definition.inputs.toolHashes[`${tools12}/replay-server.mjs`]; }, /完整指紋/],
  ['missing-build', value => { delete value.definition.inputs.buildHashes['dist/index.html']; }, /完整指紋/],
  ['changed-build', value => { value.definition.inputs.buildHashes['dist/index.html'] = '0'.repeat(64); }, /完整指紋/],
]) await test(name === 'unknown-schema' || name === 'missing-case' ? 'P06' : 'P07', name, () => {
  nodeAssert.throws(() => loadManifest(alteredManifest(name, mutate, true)), pattern);
});
await test('P08', '原子結果拒絕重複且保留首次失敗bytes', () => {
  const file = path.join(directory, 'duplicate.json'); atomicJson(file, { protocolOnly: true, passed: false }, true);
  const original = sha(readFileSync(file));
  nodeAssert.throws(() => atomicJson(file, { protocolOnly: true, retry: true, passed: false }, true), /拒絕覆寫/);
  nodeAssert.equal(sha(readFileSync(file)), original);
  nodeAssert.equal(readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.lock')), false);
});
for (const file of ['.scratch/optimization-followup/evidence/12/new.json', `${evidence}/../escape.json`, `${evidence}/bad:stream`]) {
  await test('P09', `非法輸出：${file}`, () => nodeAssert.throws(() => safeOutput(file), /輸出/));
}
await test('P09', '半份manifest JSON明確失敗', () => {
  const folder = path.join(directory, 'partial'); mkdirSync(folder); const file = path.join(folder, 'manifest.json');
  writeFileSync(file, '{"schema":', { flag: 'wx' }); nodeAssert.throws(() => loadManifest(file));
});

const bootstrap = readFileSync(path.join(root, tools12, 'integration-bootstrap.js'), 'utf8');
function page(binding, scriptRun = binding.runId) {
  const sent = [], events = [];
  const sandbox = {
    URL, Headers, location: { origin: 'http://127.0.0.1:4177', pathname: '/', search: '' }, innerWidth: 1440, innerHeight: 900,
    navigator: { userAgent: 'Node-VM-protocol-only' }, console: { error() {}, warn() {} },
    addEventListener: (...event) => events.push(event),
    document: {
      currentScript: { src: `http://127.0.0.1:4177/__integration/${scriptRun}/${binding.toolHashes[`${tools12}/integration-bootstrap.js`]}.js` },
      getElementById: () => ({ textContent: JSON.stringify(binding) }), documentElement: { scrollWidth: 1440 },
    },
    window: { fetch: async (input, options) => { sent.push({ input, options }); return { ok: true, status: 200 }; } },
  };
  vm.runInNewContext(bootstrap, sandbox, { timeout: 1000, filename: 'integration-bootstrap.js' });
  return { sandbox, sent };
}
await test('P05', '原bootstrap從本頁固定ID；不向metadata認領新輪', async () => {
  const old = bindingFor(context, '03', randomUUID()), fixture = page(old);
  nodeAssert.equal(fixture.sent.length, 0);
  await fixture.sandbox.window.fetch('/__fixture/result', { method: 'POST', body: JSON.stringify({ name: 'green-stale-return', result: { name: 'stale-return', stage: 'green', passed: false, protocolOnly: true } }) });
  const request = fixture.sent[0];
  nodeAssert.equal(request.options.headers.get('X-Replay-Run'), old.runId);
  nodeAssert.equal(JSON.parse(request.options.body).result.integration.runId, old.runId);
  nodeAssert.equal(fixture.sent.some(row => String(row.input).includes('/meta')), false);
});
await test('P05', '延後載入的新版本bootstrap不能替舊HTML換ID', () => {
  const old = bindingFor(context, '03', randomUUID());
  nodeAssert.throws(() => page(old, randomUUID()), /頁面／bootstrap版本不符/);
});
await test('P03', '原bootstrap拒絕已有身分的結果重貼標記', async () => {
  const old = bindingFor(context, '03', randomUUID()), fixture = page(bindingFor(context, '03', randomUUID()));
  await nodeAssert.rejects(() => fixture.sandbox.window.fetch('/__fixture/result', { body: JSON.stringify({ name: 'green-stale-return', result: { passed: false, integration: old } }) }), /重貼本輪身分/);
  nodeAssert.equal(fixture.sent.length, 0);
});
for (const entry of ['replay-server.mjs', 'verify-replays.mjs', 'summarize-queue.mjs', 'seal-results.mjs']) {
  await test('P12', `${entry}舊呼叫非零退出`, () => {
    const call = spawnSync(process.execPath, [`${tools12}/${entry}`, ...(['replay-server.mjs', 'verify-replays.mjs'].includes(entry) ? ['03'] : [])], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    nodeAssert.equal(call.error, undefined); nodeAssert.notEqual(call.status, 0); nodeAssert.match(call.stderr, /manifest/);
    rows.push({ id: 'P12-command', command: [process.execPath, `${tools12}/${entry}`], exitCode: call.status, stdout: call.stdout, stderr: call.stderr, passed: true });
  });
}
const report = { schema: 'p1-structural-regression-v1', manifest: context.file, manifestSha256: context.manifestSha256,
  node: process.version, bootstrapSha256: sha(bootstrap), rows, passed: rows.every(row => row.passed),
  limits: '此為CLI／VM協定回歸；未啟HTTP站，未執行109案browser。P05真HTTP、P08接收端與P11活站補跑由prime另行取證；完整真raw負向矩陣使用replay-raw-regression。' };
atomicJson(path.join(directory, 'results.json'), report, true);
console.log(JSON.stringify({ output: directory, checks: rows.filter(row => row.id !== 'P12-command').length, passed: report.passed }));
if (!report.passed) { console.error(JSON.stringify(rows.filter(row => !row.passed))); process.exitCode = 1; }
