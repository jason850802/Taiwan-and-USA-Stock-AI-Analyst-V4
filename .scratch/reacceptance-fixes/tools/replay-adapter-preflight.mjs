// 執行新adapter與原build選項，僅以測試物件取代HTTP createServer，沒有開埠或browser結果。
// 產物是真esbuild write:false輸出；run維持starting，不能選為正式成功組。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, evidence, tools12, requiredManifest, options, safeOutput, atomicJson, relative, sha, verifyRunArtifacts } from './replay-contract.mjs';

const context = requiredManifest(options(process.argv.slice(2), ['manifest']));
assert.equal(context.manifest.definition.baselineGate.protocolOnly, true, '此CLI只接受未選案的protocol-only測試manifest');
assert.equal(Object.keys(context.manifest.selected).length, 0, '此CLI不碰正式已選run');
const directory = safeOutput(`${evidence}/adapter-preflight-${randomUUID()}`); mkdirSync(directory);
const serverFile = path.join(root, tools12, 'replay-server.mjs'), serverBytes = readFileSync(serverFile);
const finalImport = "await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`);";
assert.equal(serverBytes.toString('utf8').split(finalImport).length, 2, 'adapter最後執行邊界改變');
const rows = [];
const api = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
try {
  for (const group of ['02', '03', '04', '05-before', '05-after']) {
    const argv = process.argv;
    let adapted;
    try {
      // 真adapter先完整產生來源；只攔截最後import，不修改其中轉接規則。
      let generator = serverBytes.toString('utf8').replace(finalImport, 'globalThis.__p1AdapterCapture({ code: prelude + source, runId });');
      for (const file of ['replay-contract.mjs', 'replay-harness-adapter.mjs']) {
        generator = generator.replace(`'../../../reacceptance-fixes/tools/${file}'`, JSON.stringify(pathToFileURL(path.join(root, '.scratch/reacceptance-fixes/tools', file)).href));
      }
      globalThis.__p1AdapterCapture = value => { adapted = value; };
      process.argv = [process.execPath, serverFile, '--manifest', context.file, '--group', group];
      await import(`data:text/javascript;base64,${Buffer.from(generator + `\n// ${randomUUID()}`).toString('base64')}`);
    } finally { process.argv = argv; delete globalThis.__p1AdapterCapture; }
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { cwd: root, input: adapted.code, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(syntax.status, 0, syntax.stderr);
    if (['02', '03'].includes(group)) { rows.push({ group, syntaxExitCode: syntax.status, compiled: false }); continue; }
    let handler, replay, listenCalls = 0, reply;
    const httpImport = "import { createServer } from 'node:http';";
    assert.equal(adapted.code.split(httpImport).length, 2, '原HTTP import邊界改變');
    const execution = adapted.code.replace(httpImport, 'const createServer = globalThis.__p1NoListener;')
      + '\nglobalThis.__p1CompiledCapture(replay);';
    try {
      globalThis.__p1NoListener = value => {
        handler = value;
        return { once() { return this; }, listen() { listenCalls++; return this; } };
      };
      globalThis.__p1CompiledCapture = value => { replay = value; };
      await import(`data:text/javascript;base64,${Buffer.from(execution).toString('base64')}`);
      assert.equal(listenCalls, 1);
      assert.equal(existsSync(path.join(replay.directory, 'startup.json')), false);
      assert.equal(JSON.parse(readFileSync(path.join(replay.directory, 'state.json'), 'utf8')).status, 'starting');
      assert.equal(readdirSync(path.join(replay.directory, 'raw')).length, 0);
      const checked = verifyRunArtifacts(context, group, adapted.runId, replay.binding.artifactHashes);
      const port = group === '04' ? 4178 : 4179;
      const response = { writeHead(status, headers) { reply = { status, headers }; }, end(content) { reply.body = String(content); } };
      await handler({ url: '/harness', method: 'GET', headers: { host: `127.0.0.1:${port}` } }, response);
      assert.equal(reply.status, 200);
      const pageBinding = JSON.parse(reply.body.match(/<script id="p1-replay-binding" type="application\/json">([^<]+)<\/script>/)?.[1]);
      assert.deepEqual(pageBinding, replay.binding);
      const artifactPath = replay.artifactPath('holdings.js');
      assert.ok(reply.body.includes(`src="${artifactPath}"`));
      assert.equal(reply.body.includes('src="/__fixture/holdings.js"'), false);
      rows.push({ group, runId: adapted.runId, syntaxExitCode: syntax.status, compiled: true, generatedArtifacts: checked,
        artifactPath, htmlBindingMatches: true, startupCreated: false, rawFiles: 0, listeningSockets: 0 });
    } finally { delete globalThis.__p1NoListener; delete globalThis.__p1CompiledCapture; }
  }
} finally { await api.stop(); }
const report = { schema: 'p1-adapter-preflight-v1', at: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
  manifest: relative(context.file), manifestSha256: context.manifestSha256, adapterSha256: sha(serverBytes), rows,
  scope: '完整adapter與原04／05編譯分支實跑；HTTP建站由測試物件截斷，HTML由handler直接產生。沒有真HTTP或browser PASS。所有run維持starting。' };
atomicJson(path.join(directory, 'results.json'), report, true);
console.log(JSON.stringify({ output: relative(directory), syntaxGroups: rows.length, actualBundles: rows.filter(row => row.compiled).length, listeningSockets: 0, passed: true }));
