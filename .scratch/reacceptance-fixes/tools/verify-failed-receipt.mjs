// P08真HTTP故障注入：獨立空run保存明標失敗的協定payload；不得用作瀏覽器成功證據。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { options, requiredManifest, runDirectory, json, sha, atomicJson, relative } from './replay-contract.mjs';

const args = options(process.argv.slice(2), ['manifest', 'run', 'output']);
assert.ok(args.run && args.output);
const context = requiredManifest(args);
const directory = runDirectory(context, '03', args.run);
const startup = json(path.join(directory, 'startup.json'));
assert.equal(startup.origin, 'http://127.0.0.1:4177');
assert.deepEqual(json(path.join(directory, 'state.json')).cases, {}, '只可使用獨立空run');
assert.deepEqual(readdirSync(path.join(directory, 'raw')), []);
const descriptor = context.manifest.definition.expected['03'].find(row => row.file === 'desktop-green-stale-return.json');
const payload = {
  name: descriptor.payloadName,
  result: {
    name: descriptor.name, stage: descriptor.stage, passed: false,
    error: 'P08協定故障注入；不是App案例執行結果', protocolOnly: true,
    integration: startup.binding,
    integrationBrowser: { pathname: '/', viewport: { width: 1440, height: 900, scrollWidth: 1440 },
      errors: [], warnings: [], failures: [], nativeKeys: [], method: 'Node HTTP協定fixture，未啟瀏覽器' },
  },
};
const post = async () => {
  const response = await fetch(`${startup.origin}/__fixture/result`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Replay-Run': args.run },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.text() };
};
const first = await post();
assert.equal(first.status, 200, first.body);
const file = path.join(directory, 'raw', descriptor.file);
const originalBytes = readFileSync(file);
assert.equal(JSON.parse(originalBytes).passed, false);
const stateFile = path.join(directory, 'state.json');
const firstStateBytes = readFileSync(stateFile);
const firstState = JSON.parse(firstStateBytes);
assert.equal(firstState.status, 'failed');
assert.equal(firstState.cases[descriptor.file].passed, false);
assert.equal(firstState.cases[descriptor.file].sha256, sha(originalBytes));
const duplicate = await post();
assert.equal(duplicate.status, 409, duplicate.body);
assert.match(duplicate.body, /重複送出/);
assert.deepEqual(readFileSync(file), originalBytes);
const secondStateBytes = readFileSync(stateFile);
assert.deepEqual(secondStateBytes, firstStateBytes);
const state = JSON.parse(secondStateBytes);
assert.equal(state.status, 'failed');
assert.equal(state.cases[descriptor.file].passed, false);
atomicJson(args.output, {
  schema: 'p1-failed-http-receipt-v1', at: new Date().toISOString(), passed: true,
  manifest: relative(context.file), definitionSha256: context.manifest.definitionSha256,
  runId: args.run, first, duplicate,
  original: { file: relative(file), sha256: sha(originalBytes), passed: false },
  state: { status: state.status, beforeSha256: sha(firstStateBytes), afterSha256: sha(secondStateBytes), unchanged: true },
  toolSha256: sha(readFileSync(new URL(import.meta.url))),
  limits: '只驗失敗HTTP收件不被重試覆寫；失敗payload明標協定fixture，不計109份真瀏覽器案例。',
}, true);
console.log(JSON.stringify({ output: args.output, passed: true, firstStatus: first.status, retryStatus: duplicate.status, originalPassed: false }));
