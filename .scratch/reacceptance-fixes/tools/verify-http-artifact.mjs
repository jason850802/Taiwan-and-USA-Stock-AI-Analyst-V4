// 真HTTP回應、初載binding與本run保存產物逐位元組對帳，不操作瀏覽器或替raw補標。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { options, requiredManifest, runDirectory, json, sha, atomicJson, relative } from './replay-contract.mjs';

const args = options(process.argv.slice(2), ['manifest', 'group', 'run', 'output']);
assert.ok(['04', '05-before', '05-after'].includes(args.group) && args.run && args.output);
const context = requiredManifest(args);
const directory = runDirectory(context, args.group, args.run);
const startup = json(path.join(directory, 'startup.json'));
const origin = new URL(startup.origin);
assert.equal(origin.hostname, '127.0.0.1');
assert.ok(['4178', '4179'].includes(origin.port));
const htmlResponse = await fetch(new URL('/harness', origin));
assert.equal(htmlResponse.status, 200);
const html = await htmlResponse.text();
const match = html.match(/<script id="p1-replay-binding" type="application\/json">([^<]+)<\/script>/);
assert.ok(match, '缺初載binding');
const binding = JSON.parse(match[1]);
assert.deepEqual(binding, startup.binding);
const artifactHash = binding.artifactHashes['holdings.js'];
const artifactPath = `/__integration/artifacts/${args.run}/${artifactHash}/holdings.js`;
assert.ok(html.includes(artifactPath), 'HTML沒有使用本run版本URL');
const response = await fetch(new URL(artifactPath, origin));
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
const savedFile = path.join(directory, 'artifacts/holdings.js');
const savedBytes = readFileSync(savedFile);
assert.equal(response.headers.get('x-replay-run'), args.run);
assert.equal(response.headers.get('x-replay-artifact-sha256'), artifactHash);
assert.equal(sha(bytes), artifactHash);
assert.deepEqual(bytes, savedBytes);
const result = {
  schema: 'p1-http-artifact-v1', at: new Date().toISOString(), passed: true,
  manifest: relative(context.file), definitionSha256: context.manifest.definitionSha256,
  group: args.group, runId: args.run, origin: origin.origin,
  html: { status: htmlResponse.status, sha256: sha(Buffer.from(html)), initialBinding: binding },
  response: { path: artifactPath, status: response.status, bytes: bytes.length, sha256: sha(bytes),
    runHeader: response.headers.get('x-replay-run'), artifactHeader: response.headers.get('x-replay-artifact-sha256') },
  saved: { file: relative(savedFile), sha256: sha(savedBytes) },
  toolSha256: sha(readFileSync(new URL(import.meta.url))),
};
atomicJson(args.output, result, true);
console.log(JSON.stringify({ output: args.output, passed: true, group: args.group, runId: args.run, sha256: artifactHash }));
