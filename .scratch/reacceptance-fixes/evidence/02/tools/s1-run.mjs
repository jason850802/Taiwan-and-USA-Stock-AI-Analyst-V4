// S1 專項執行：沿用 P1 的完整來源／建置與 native 工具指紋，輸出限制於新票。
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, existsSync, lstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprints, sha, canonical, equal, assert, root, relative } from '../../../tools/replay-contract.mjs';
import { names as hookNames } from './health-input-cases.mjs';

export { sha, root, relative };
const toolDir = fileURLToPath(new URL('./', import.meta.url));
const base = path.resolve(toolDir, '..');
const baseCommit = 'db2c8cb9dbf64f04b92af22264b80d209d72dead';
const expectedFor = group => {
  if (group === 'hook') return hookNames;
  if (group === 'formal') return ['desktop', 'narrow'];
  throw new Error(`未知 S1 組別：${group}`);
};
export function inputs() {
  const all = fingerprints();
  const tools = readdirSync(toolDir).filter(file => /\.(js|jsx|mjs)$/.test(file)).sort();
  return { baseCommit, node: all.node, sourceHashes: all.sourceHashes,
    buildHashes: all.buildHashes, esbuildRuntime: all.esbuildRuntime,
    toolHashes: { ...all.toolHashes, ...Object.fromEntries(tools.map(file => [relative(path.join(toolDir, file)), sha(readFileSync(path.join(toolDir, file)))])),
      '.scratch/optimization-followup/evidence/07/fixtures.mjs': sha(readFileSync(path.join(root, '.scratch/optimization-followup/evidence/07/fixtures.mjs'))) } };
}
function safe(file) {
  const rel = path.relative(base, file);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(':'), 'S1 輸出超出本票');
  let cursor = base;
  for (const part of rel.split(path.sep)) { cursor = path.join(cursor, part); if (existsSync(cursor)) assert(!lstatSync(cursor).isSymbolicLink(), 'S1 輸出穿越連結'); }
  return file;
}
function write(file, value) {
  safe(file);
  assert(!existsSync(file), '同案例拒絕覆寫', 409);
  const temp = safe(`${file}.${randomUUID()}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(temp, file);
}
export function createRun(group, expected, artifacts = {}) {
  equal(expected, expectedFor(group), 'S1 工具定義的預期案例');
  const runId = randomUUID();
  const directory = safe(path.join(base, 'runs', group, runId));
  mkdirSync(directory, { recursive: true });
  const artifactHashes = {};
  for (const [name, bytes] of Object.entries(artifacts)) {
    assert(/^[a-zA-Z0-9_-]+\.js$/.test(name), '產物名稱不合法');
    writeFileSync(safe(path.join(directory, name)), bytes, { flag: 'wx' });
    artifactHashes[name] = sha(bytes);
  }
  const binding = { schema: 's1-run-v1', scope: 'S1-public-behavior', group, runId, inputs: inputs(), artifactHashes };
  const manifest = { binding, bindingSha256: sha(canonical(binding)), expected,
    createdAt: new Date().toISOString(), pid: process.pid, command: process.argv };
  write(path.join(directory, 'manifest.json'), manifest);
  const verifyInputs = () => {
    equal(inputs(), binding.inputs, 'S1 來源／工具／建置');
    for (const [name, hash] of Object.entries(artifactHashes)) assert(sha(readFileSync(path.join(directory, name))) === hash, 'S1 實際 bundle 漂移');
  };
  return {
    binding, directory, manifest,
    bindingScript: `window.__s1Binding = Object.freeze(${JSON.stringify(binding)});`,
    versionUrl(name) { return `/__s1/${runId}/${sha(readFileSync(path.join(toolDir, name)))}/${name}`; },
    accept(data) {
      equal(data.binding, binding, '頁面初載身分');
      assert(expected.includes(data.name), '未知 S1 案例');
      verifyInputs();
      assert(typeof data.result?.passed === 'boolean', '缺少案例判定');
      assert(Array.isArray(group === 'hook' ? data.result?.requests : data.result?.serverRequests), '缺少假服務請求證據');
      const rawFile = path.join(directory, `${data.name}.json`);
      write(rawFile, data);
      return { saved: data.name, runId, rawSha256: sha(readFileSync(rawFile)) };
    },
    verifyInputs,
    saveStartup(origin) { write(path.join(directory, 'startup.json'), { ...binding, origin, pid: process.pid, startedAt: new Date().toISOString() }); },
  };
}
export function verifyRun(manifestFile) {
  const file = safe(path.resolve(root, manifestFile));
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  assert(manifest.binding?.schema === 's1-run-v1', '未知 S1 schema');
  assert(manifest.bindingSha256 === sha(canonical(manifest.binding)), 'S1 binding 雜湊不符');
  equal(manifest.expected, expectedFor(manifest.binding.group), 'S1 案例定義');
  equal(inputs(), manifest.binding.inputs, '目前 S1 指紋');
  const directory = path.dirname(file);
  const startup = JSON.parse(readFileSync(path.join(directory, 'startup.json'), 'utf8'));
  equal(Object.fromEntries(Object.keys(manifest.binding).map(key => [key, startup[key]])), manifest.binding, '啟動 binding');
  const raws = manifest.expected.map(name => {
    const rawFile = path.join(directory, `${name}.json`);
    const bytes = readFileSync(rawFile), raw = JSON.parse(bytes);
    equal(raw.binding, manifest.binding, 'raw binding');
    assert(raw.name === name && raw.result.passed === true, `案例未通過：${name}`);
    assert(Array.isArray(manifest.binding.group === 'hook' ? raw.result.requests : raw.result.serverRequests), 'raw 缺少假服務請求證據');
    return { file: relative(rawFile), sha256: sha(bytes) };
  });
  for (const [name, hash] of Object.entries(manifest.binding.artifactHashes)) assert(sha(readFileSync(path.join(directory, name))) === hash, '產物漂移');
  const allowed = ['manifest.json', 'startup.json', ...Object.keys(manifest.binding.artifactHashes), ...manifest.expected.map(name => `${name}.json`)];
  equal(readdirSync(directory).sort(), allowed.sort(), '執行檔案完整集合');
  return { manifest: relative(file), manifestSha256: sha(readFileSync(file)), runId: manifest.binding.runId, group: manifest.binding.group, count: raws.length, raws };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  assert(files.length > 0, '用法：node s1-run.mjs <明確 manifest 路徑...>');
  console.log(JSON.stringify({ scope: 'S1-public-behavior', passed: true, runs: files.map(verifyRun) }, null, 2));
}
