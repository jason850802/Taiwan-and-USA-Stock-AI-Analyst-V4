// P1 專用批次／執行契約；案例來自原場景，raw 不補標記、不跨輪補案。
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { caseNames as fundCases } from '../../optimization-followup/evidence/02/browser-cases.mjs';
import { caseNames as marketCases } from '../../optimization-followup/evidence/03/browser-cases.mjs';
import { caseNames as holdingCases } from '../../optimization-followup/evidence/12/holdings-cases.mjs';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const evidence = '.scratch/reacceptance-fixes/evidence/01';
export const tools12 = '.scratch/optimization-followup/evidence/12';
export const beforeCommit = '0366f5fb1d58d963323cc9d519f49ec87217a048';
export const fixedCommit = 'b2bf7d8075eb31266d556afb0f874d37c3217bb4';
export const groups = ['02', '03', '04', '05-before', '05-after'];
export const schema = 'p1-replay-v1';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const relative = value => path.relative(root, value).split(path.sep).join('/');
export const assert = (ok, message, status = 400) => { if (!ok) throw Object.assign(new Error(message), { status }); };
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const equal = (actual, expected, label) => assert(canonical(actual) === canonical(expected), `${label}不符`);
export const json = file => JSON.parse(readFileSync(file, 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

// 所有新結果只落本案01；逐層拒絕 symlink／junction，亦拒絕 Windows ADS。
export function safeOutput(file) {
  assert(typeof file === 'string' && !file.includes('\0'), '輸出路徑無效');
  assert(!file.split(/[\\/]/).includes('..'), '輸出不可含路徑穿越');
  const absolute = path.resolve(root, file), base = path.resolve(root, evidence);
  const rel = path.relative(base, absolute);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel) && !rel.includes(':'), '輸出超出本案01核准根');
  let cursor = root;
  for (const part of path.relative(root, absolute).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor)) assert(!lstatSync(cursor).isSymbolicLink(), '輸出不可穿越連結');
  }
  return absolute;
}
function atomicBytes(file, bytes, exclusive = false) {
  file = safeOutput(file);
  const temp = safeOutput(`${file}.${randomUUID()}.tmp`);
  const lock = safeOutput(`${file}.lock`);
  let ownsLock = false;
  try {
    // Windows卷不一定支援硬連結；wx鎖保護唯一提交，完整temp才原子rename。
    if (exclusive) {
      closeSync(openSync(lock, 'wx')); ownsLock = true;
      assert(!existsSync(file), '目的結果已存在，拒絕覆寫', 409);
    }
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
    if (ownsLock) unlinkSync(lock);
  }
}
export function atomicJson(file, value, exclusive = false) {
  atomicBytes(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'), exclusive);
}
function walk(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `來源不可為連結：${directory}/${entry.name}`);
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  }).sort();
}
const rootSources = ['App.tsx', 'index.tsx', 'types.ts', 'index.html', 'index.css', 'postcss.config.js', 'tailwind.config.js', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];
const productFile = file => rootSources.includes(file) || /^(api|components|config|services|utils)\/.*\.(ts|tsx|js|jsx|css)$/.test(file) && !/\.(test|spec)\.[^.]+$/.test(file);
export function sourceFiles() {
  return [...rootSources, ...['api', 'components', 'config', 'services', 'utils'].flatMap(walk).filter(productFile)].sort();
}
export function hashes(files) { return Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(root, file)))])); }
function committedHashes(commit, files) {
  const data = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: files.map(file => `${commit}:${file}\n`).join(''), maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  let offset = 0;
  return Object.fromEntries(files.map(file => {
    const end = data.indexOf(10, offset), header = data.subarray(offset, end).toString('utf8');
    assert(/^[a-f0-9]+ blob \d+$/.test(header), `固定來源缺檔：${file}`);
    const length = Number(header.split(' ')[2]);
    offset = end + 1;
    const hash = sha(data.subarray(offset, offset + length));
    offset += length + 1;
    return [file, hash];
  }));
}
function originalTests() {
  return git(['ls-tree', '-r', '--name-only', fixedCommit]).toString('utf8').trim().split('\n')
    .filter(file => !file.startsWith('.') && (/\.(test|spec)\.[^.]+$/.test(file) || file.endsWith('.snap'))).sort();
}
// 讀取實際安裝 API 的平台解析段；不複製平台對照表，不啟動服務或允許解包寫入。
function esbuildRuntime() {
  assert(process.env.ESBUILD_BINARY_PATH === undefined, 'P1不接受ESBUILD_BINARY_PATH；請解除覆寫後建立新批次');
  const api = path.join(root, 'node_modules/esbuild/lib/main.js'), requireFromApi = createRequire(api);
  const source = readFileSync(api, 'utf8');
  const startMarker = '// lib/npm/node-platform.ts', endMarker = '// lib/npm/node.ts';
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start && source.indexOf(startMarker, start + 1) < 0, 'esbuild解析入口改變，須重新覆核');
  const readOnlyRequire = name => {
    if (name === 'fs') return Object.freeze({ existsSync });
    if (name === 'os') return os;
    if (name === 'path') return path;
    throw new Error(`P1 esbuild解析不提供模組：${name}`);
  };
  readOnlyRequire.resolve = requireFromApi.resolve;
  const resolved = vm.runInNewContext(source.slice(start, end)
    + '\n({ selected: pkgAndSubpathForCurrentPlatform(), native: generateBinPath() });', {
    require: readOnlyRequire, process: { platform: process.platform, env: {} },
    console: { warn() { throw new Error('P1 esbuild解析不能降級'); } },
  }, { timeout: 1000, filename: api });
  const { pkg, subpath, isWASM } = resolved.selected;
  assert(!isWASM && resolved.native.isWASM === false, 'P1只接受已安裝的native esbuild，不接受WASM fallback');
  const binary = requireFromApi.resolve(`${pkg}/${subpath}`);
  const nativePackageJson = requireFromApi.resolve(`${pkg}/package.json`);
  equal(resolved.native.binPath, binary, 'esbuild實際執行檔與native optional package');
  const files = [api, path.join(path.dirname(api), '../package.json'), binary, nativePackageJson];
  for (const file of files) {
    const local = path.relative(path.join(root, 'node_modules'), file);
    assert(local && !local.startsWith('..') && !path.isAbsolute(local) && !local.includes(':'), 'esbuild runtime超出本機node_modules');
    let cursor = path.join(root, 'node_modules');
    for (const part of local.split(path.sep)) { cursor = path.join(cursor, part); assert(!lstatSync(cursor).isSymbolicLink(), 'esbuild runtime不可穿越連結'); }
    assert(statSync(file).isFile(), 'esbuild runtime不是檔案');
  }
  const packageMetadata = json(files[1]), nativeMetadata = json(nativePackageJson);
  assert(packageMetadata.name === 'esbuild' && nativeMetadata.name === pkg
    && packageMetadata.optionalDependencies?.[pkg] === nativeMetadata.version
    && packageMetadata.version === nativeMetadata.version, 'esbuild native套件版本／metadata不符');
  return { api: relative(api), apiPackageJson: relative(files[1]), binary: relative(binary), nativePackageJson: relative(nativePackageJson),
    nativePackage: pkg, version: nativeMetadata.version, platform: process.platform, arch: os.arch(), endianness: os.endianness(),
    resolution: 'installed-native-optional-package', binaryPathOverride: 'unset' };
}
const gateToolFiles = { runnerSha256: '.scratch/reacceptance-fixes/run-check.mjs', entrypointSha256: 'scripts/run-gate.mjs' };
export function gateProvenance(record) {
  const current = Object.fromEntries(Object.entries(gateToolFiles).map(([field, file]) => [field, sha(readFileSync(path.join(root, file)))]));
  for (const [field, hash] of Object.entries(current)) assert(record?.[field] === hash, `gate工具${field}缺失或漂移`);
  return current;
}
function toolFiles(runtime) {
  return [...new Set([
    ...['02', '03', '04', '05'].flatMap(ticket => readdirSync(path.join(root, `.scratch/optimization-followup/evidence/${ticket}`))
      .filter(file => /\.(mjs|jsx|js)$/.test(file)).map(file => `.scratch/optimization-followup/evidence/${ticket}/${file}`)),
    ...['replay-server.mjs', 'integration-bootstrap.js', 'holdings-cases.mjs', 'verify-replays.mjs', 'summarize-queue.mjs', 'seal-results.mjs'].map(file => `${tools12}/${file}`),
    '.scratch/reacceptance-fixes/tools/replay-contract.mjs', '.scratch/reacceptance-fixes/tools/replay-batch.mjs',
    '.scratch/reacceptance-fixes/tools/replay-harness-adapter.mjs',
    '.scratch/reacceptance-fixes/manual-market.mjs', '.scratch/reacceptance-fixes/viewport-controls.mjs', ...Object.values(gateToolFiles),
    runtime.api, runtime.apiPackageJson, runtime.binary, runtime.nativePackageJson,
  ])].sort();
}
export function fingerprints() {
  const oldFiles = git(['ls-tree', '-r', '--name-only', beforeCommit]).toString('utf8').trim().split('\n').filter(productFile).sort();
  const runtime = esbuildRuntime();
  return {
    candidate: git(['rev-parse', 'HEAD']).toString('utf8').trim(), node: process.version,
    sourceHashes: hashes(sourceFiles()), beforeSourceHashes: committedHashes(beforeCommit, oldFiles),
    beforeCommit, toolHashes: hashes(toolFiles(runtime)), esbuildRuntime: runtime, buildHashes: hashes(walk('dist')),
  };
}
export function expectedCases() {
  const sized = (names, pathname = '/') => ['desktop', 'narrow'].flatMap(size => names.map(name => ({
    file: `${size}-green-${name}.json`, payloadName: `green-${name}`, name, stage: 'green', pathname,
    width: size === 'desktop' ? 1440 : 390, height: size === 'desktop' ? 900 : 844,
  })));
  const behaviorText = readFileSync(path.join(root, '.scratch/optimization-followup/evidence/05/cases.mjs'), 'utf8');
  const match = behaviorText.match(/const cases = (\['overlap'[^;]+);/);
  assert(match, '原05場景定義改變');
  const behaviorNames = JSON.parse(match[1].replaceAll("'", '"'));
  const load = stage => [1, 10, 30].flatMap(count => Array.from({ length: 7 }, (_, sample) => ({
    file: `${stage}-load-${count}-${sample}.json`, payloadName: `${stage}-load-${count}-${sample}`,
    suite: stage, scenario: 'load', count, sample, pathname: '/harness', width: 1440, height: 900,
  })));
  const manual = ['desktop', 'narrow'].map(size => ({ file: `${size}-manual-market.json`, payloadName: 'manual-market', name: 'market', stage: 'manual', pathname: '/', width: size === 'desktop' ? 1440 : 390, height: size === 'desktop' ? 900 : 844 }));
  return {
    '02': sized(fundCases), '03': [...sized(marketCases), ...manual],
    '04': [...sized(holdingCases, '/harness').filter(row => row.width === 1440), ...sized(['app-overlap']).map(({ stage, ...row }) => row)],
    '05-before': load('before'),
    '05-after': [...load('after'), ...behaviorNames.map(scenario => ({ file: `green-${scenario}-30-0.json`, payloadName: `green-${scenario}-30-0`, suite: 'green', scenario, count: 30, sample: 0, pathname: '/harness', width: 1440, height: 900 })),
      ...['desktop', 'narrow'].map(size => ({ file: `${size}-green-app-30-0.json`, payloadName: 'green-app-30-0', suite: 'green', scenario: 'overlap', count: 30, sample: 0, pathname: '/', width: size === 'desktop' ? 1440 : 390, height: size === 'desktop' ? 900 : 844 }))],
  };
}
export function expectedBuildArtifacts() {
  return Object.fromEntries(groups.map(group => [group, ['04', '05-before', '05-after'].includes(group) ? ['holdings.js'] : []]));
}
export function gateDetails(recordPath) {
  const file = safeOutput(recordPath), record = json(file);
  assert(record.schema === 1 && record.exitCode === 0 && record.signal === null && record.fullGate === true, 'gate執行未完整通過');
  equal(record.command, ['node', 'scripts/run-gate.mjs'], 'gate命令');
  const provenance = gateProvenance(record);
  const logFile = safeOutput(record.log), raw = readFileSync(logFile);
  assert(sha(raw) === record.logSha256, 'gate log雜湊不符');
  const log = raw.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  assert(log.includes('GATE 全綠') && record.secretScanDegraded === false, 'gate未全綠或金鑰掃描降級');
  const entries = [...log.matchAll(/^\s*[✓✔]\s+(.+?)\s+\((\d+) tests?\)/gm)].map(match => ({ file: match[1].replaceAll('\\', '/'), tests: Number(match[2]) }));
  const testSet = originalTests(), rootTests = entries.filter(row => testSet.includes(row.file));
  const expected = testSet.filter(file => !file.endsWith('.snap'));
  equal(rootTests.map(row => row.file).sort(), expected, 'gate根測試集合');
  const totalFiles = Number(log.match(/Test Files\s+(\d+) passed/)?.[1]), totalTests = Number(log.match(/Tests\s+(\d+) passed/)?.[1]);
  assert(entries.length === totalFiles && entries.reduce((sum, row) => sum + row.tests, 0) === totalTests, 'gate逐檔與總數不符');
  equal(hashes(testSet), committedHashes(fixedCommit, testSet), '原test／snapshot保護');
  return { record: relative(file), recordSha256: sha(readFileSync(file)), ...provenance, log: relative(logFile), logSha256: sha(raw),
    startedAt: record.startedAt, completedAt: record.completedAt, rootTests: rootTests.sort((a, b) => a.file.localeCompare(b.file)),
    originalTestHashes: hashes(testSet), totalFiles, totalTests, historicalCopyFiles: totalFiles - rootTests.length,
    historicalCopyTests: totalTests - rootTests.reduce((sum, row) => sum + row.tests, 0), secretScanDegraded: false };
}
export function createBatch(label, baselineGate, protectionPath) {
  assert(/^[a-z0-9][a-z0-9-]{0,39}$/.test(label), 'label只接受小寫英數及連字號');
  const inputs = fingerprints();
  const protectionFile = safeOutput(protectionPath), protection = json(protectionFile);
  assert(protection.schema === 1 && protection.head === fixedCommit && protection.trackedHashes, '原工作樹保護清單無效');
  equal(inputs.sourceHashes, Object.fromEntries(Object.keys(inputs.sourceHashes).map(file => [file, protection.trackedHashes[file]])), 'P1產品及依賴零改動');
  const buildTime = statSync(path.join(root, 'dist/index.html')).mtimeMs;
  assert(sourceFiles().every(file => statSync(path.join(root, file)).mtimeMs <= buildTime), '先建置當前來源');
  const batchId = randomUUID(), directory = safeOutput(`${evidence}/batches/${label}-${batchId}`);
  mkdirSync(path.dirname(directory), { recursive: true });
  mkdirSync(directory);
  const definition = { schema, scope: 'P1-replay-109', batchId, createdAt: new Date().toISOString(),
    inputs, expected: expectedCases(), expectedArtifacts: expectedBuildArtifacts(), baselineGate: gateDetails(baselineGate),
    protection: { file: relative(protectionFile), sha256: sha(readFileSync(protectionFile)) } };
  const manifest = { schema, definition, definitionSha256: sha(canonical(definition)), revision: 0, selected: {} };
  atomicJson(path.join(directory, 'manifest.json'), manifest, true);
  return relative(path.join(directory, 'manifest.json'));
}
export function loadManifest(file, checkInputs = true) {
  file = safeOutput(file);
  assert(path.basename(file) === 'manifest.json', '請明確指定manifest.json');
  const manifest = json(file), d = manifest.definition;
  assert(manifest.schema === schema && d?.schema === schema && d.scope === 'P1-replay-109', '未知manifest schema／scope');
  assert(uuid(d.batchId) && Number.isSafeInteger(manifest.revision) && manifest.revision >= 0, 'manifest身分或版本無效');
  assert(sha(canonical(d)) === manifest.definitionSha256, 'manifest定義雜湊不符');
  equal(d.expected, expectedCases(), 'manifest預期案例集合');
  equal(d.expectedArtifacts, expectedBuildArtifacts(), 'manifest預期建置產物集合');
  assert(d.protection && sha(readFileSync(safeOutput(d.protection.file))) === d.protection.sha256, '原工作樹保護清單漂移');
  assert(manifest.selected && Object.keys(manifest.selected).every(group => groups.includes(group)), '未知選擇組別');
  if (checkInputs) equal(d.inputs, fingerprints(), '來源／工具／建置完整指紋');
  return { file, directory: path.dirname(file), manifest, manifestSha256: sha(readFileSync(file)) };
}
export function bindingFor(context, group, runId, artifactHashes = {}) {
  assert(groups.includes(group) && uuid(runId), '組別／runId無效');
  const { manifest: m } = context, { inputs } = m.definition;
  return { schema, ticket: '12', replayOf: group.slice(0, 2), group, batchId: m.definition.batchId, runId,
    definitionSha256: m.definitionSha256, expectedSha256: sha(canonical(m.definition.expected[group])),
    candidate: inputs.candidate, node: inputs.node, sourceVersion: group === '05-before' ? beforeCommit : 'working-tree',
    sourceHashes: group === '05-before' ? inputs.beforeSourceHashes : inputs.sourceHashes,
    hostSourceHashes: inputs.sourceHashes, toolHashes: inputs.toolHashes, esbuildRuntime: inputs.esbuildRuntime, buildHashes: inputs.buildHashes, artifactHashes,
    buildIndexSha256: inputs.buildHashes['dist/index.html'], buildUse: group === '05-before' ? 'hook-only-current-dist-not-served' : 'current-dist-and-hook' };
}
export function runDirectory(context, group, runId) {
  assert(groups.includes(group) && uuid(runId), '組別／runId無效');
  return safeOutput(path.join(context.directory, 'runs', group, runId));
}
export function verifyRunArtifacts(context, group, runId, artifactHashes) {
  const expected = expectedBuildArtifacts()[group];
  assert(expected, '建置產物組別無效');
  equal(Object.keys(artifactHashes || {}).sort(), expected, 'run建置產物宣告集合');
  const directory = safeOutput(path.join(runDirectory(context, group, runId), 'artifacts'));
  assert(existsSync(directory), '缺run建置產物目錄');
  equal(readdirSync(directory).sort(), expected, 'run建置產物檔案集合');
  const artifacts = expected.map(name => {
    const file = safeOutput(path.join(directory, name));
    assert(statSync(file).isFile(), 'run建置產物不是檔案');
    const hash = sha(readFileSync(file));
    assert(hash === artifactHashes[name], `run建置產物雜湊漂移：${name}`);
    return { file: path.relative(context.directory, file).split(path.sep).join('/'), sha256: hash };
  });
  return { artifactHashes: Object.fromEntries(artifacts.map(row => [path.basename(row.file), row.sha256])), artifacts };
}
export function validateCase(data, descriptor, binding, requirePass = true) {
  equal(data.integration, binding, 'raw執行／來源／工具／build');
  equal(data.replayCase, descriptor, 'raw案例身分');
  const browser = data.integrationBrowser;
  assert(browser && Array.isArray(browser.errors) && Array.isArray(browser.warnings) && Array.isArray(browser.failures) && Array.isArray(browser.nativeKeys), '缺瀏覽器觀測');
  equal({ pathname: browser.pathname, width: browser.viewport?.width, height: browser.viewport?.height },
    { pathname: descriptor.pathname, width: descriptor.width, height: descriptor.height }, '案例尺寸／宿主');
  for (const key of ['name', 'stage', 'suite', 'scenario', 'count', 'sample']) if (key in descriptor) equal(data[key], descriptor[key], `案例${key}`);
  assert(typeof data.passed === 'boolean', '缺案例結果');
  if (!requirePass) return;
  assert(data.passed === true, `${descriptor.file}未通過：${data.error || '缺成功結果'}`);
  assert(browser.errors.length === 0 && (data.uncaught?.length ?? 0) === 0, '未捕捉例外或console error');
  if (browser.pathname === '/') assert(Number.isFinite(browser.viewport.scrollWidth) && browser.viewport.scrollWidth <= browser.viewport.width + 1, '正式App整頁溢出');
  if (descriptor.payloadName === 'manual-market') {
    assert(browser.nativeKeys.length === 17 && browser.nativeKeys.every(key => key.trusted), '缺原生鍵盤證據');
    assert(data.before === 64 && data.zoomed === 51, 'K線縮放讀值不符');
    assert(data.readings?.length === 7 && data.readings.some(row => row.step === '原生清空' && row.value === '')
      && data.readings.some(row => row.step === '原生方向鍵選股' && row.value.includes('2330'))
      && data.readings.some(row => row.step === '原生輸入美股' && row.query === 'AAPL' && row.quote === '222.00'), '搜尋操作讀值缺失');
  }
  if (binding.replayOf === '05') {
    assert(data.source === binding.sourceVersion && data.hookSha256 === binding.sourceHashes['components/portfolio/useHoldingPrices.ts'], '05來源身分錯誤');
    const expectedQueue = binding.group === '05-before' ? null : binding.sourceHashes['components/portfolio/holdingPriceQueue.ts'];
    assert(data.queueSha256 === expectedQueue && data.buildIndexSha256 === binding.buildIndexSha256, '05來源或build錯誤');
    if (descriptor.scenario === 'load') assert(data.network?.delay === 80 && Number.isFinite(data.firstVisibleMs) && Number.isFinite(data.allCompleteMs), '排程量測不完整');
    if (binding.group === '05-after') assert(data.network?.peak <= 3, '後版排程峰值超過3');
  }
}
export function prepareRun(context, group, runId = randomUUID()) {
  let binding = bindingFor(context, group, runId);
  const directory = runDirectory(context, group, runId), artifactHashes = {};
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(directory, 'raw'));
  mkdirSync(path.join(directory, 'artifacts'));
  const state = { schema, batchId: binding.batchId, group, runId, status: 'starting', cases: {} };
  atomicJson(path.join(directory, 'state.json'), state, true);
  let listening = false;
  return {
    get binding() { return binding; }, directory,
    captureArtifact(name, bytes) {
      assert(!listening, '啟站後不可重建或覆寫建置產物', 409);
      assert(expectedBuildArtifacts()[group].includes(name), '非預期建置產物');
      assert(!Object.hasOwn(artifactHashes, name), '建置產物重複保存，請另啟新run', 409);
      assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, '建置產物須為實際編譯bytes');
      equal(context.manifest.definition.inputs, fingerprints(), '編譯時來源／工具／build');
      const file = safeOutput(path.join(directory, 'artifacts', name));
      atomicBytes(file, bytes, true);
      artifactHashes[name] = sha(readFileSync(file));
      binding = bindingFor(context, group, runId, { ...artifactHashes });
    },
    artifactPath(name) {
      assert(Object.hasOwn(artifactHashes, name), '建置產物尚未固定');
      return `/__integration/artifacts/${runId}/${artifactHashes[name]}/${name}`;
    },
    serveArtifact(name) {
      assert(listening && Object.hasOwn(artifactHashes, name), '建置產物未準備完成');
      verifyRunArtifacts(context, group, runId, binding.artifactHashes);
      return readFileSync(safeOutput(path.join(directory, 'artifacts', name)));
    },
    serveRaw(name) {
      assert(listening, '假站尚未啟動', 409);
      const descriptor = context.manifest.definition.expected[group].find(row => row.file === name);
      assert(descriptor && state.cases[name], '本run沒有已接受的指定case', 404);
      const file = safeOutput(path.join(directory, 'raw', name));
      const bytes = readFileSync(file), hash = sha(bytes);
      assert(state.cases[name].sha256 === hash, '實收raw／receipt雜湊不符', 409);
      return { bytes, sha256: hash };
    },
    markListening(origin) {
      assert(!listening, '假站重複初始化');
      verifyRunArtifacts(context, group, runId, binding.artifactHashes);
      listening = true;
      const startup = { schema, binding, pid: process.pid, origin, startedAt: new Date().toISOString(), command: process.argv };
      atomicJson(path.join(directory, 'startup.json'), startup, true);
      state.status = 'collecting'; state.artifactHashes = { ...artifactHashes }; atomicJson(path.join(directory, 'state.json'), state);
      console.log(JSON.stringify({ manifest: relative(context.file), group, runId, output: relative(directory), origin, pid: process.pid }));
    },
    accept(payload, headerRun) {
      assert(listening, '假站尚未啟動', 409);
      assert(headerRun === runId, '頁面runId缺失或已過期', 409);
      equal(payload?.result?.integration, binding, '頁面執行身分');
      const data = payload.result, viewport = data.integrationBrowser?.viewport;
      const descriptor = context.manifest.definition.expected[group].find(row => row.payloadName === payload.name && row.pathname === data.integrationBrowser?.pathname && row.width === viewport?.width && row.height === viewport?.height);
      assert(descriptor, '案例／尺寸／sample不在本組預期清單');
      assert(!state.cases[descriptor.file], '同case重複送出；失敗保留，請新啟完整組', 409);
      // 這些欄位原由02～05假站附加；已有值時先核對，不能替舊raw改標。
      const metadata = group.startsWith('05') ? { source: binding.sourceVersion, hookSha256: binding.sourceHashes['components/portfolio/useHoldingPrices.ts'], queueSha256: group === '05-before' ? null : binding.sourceHashes['components/portfolio/holdingPriceQueue.ts'], buildIndexSha256: binding.buildIndexSha256 }
        : group === '04' ? { hookSha256: binding.sourceHashes['components/portfolio/useHoldingPrices.ts'], buildIndexSha256: binding.buildIndexSha256 }
          : group === '03' ? { buildIndexSha256: binding.buildIndexSha256 } : {};
      for (const [key, value] of Object.entries(metadata)) if (key in data) equal(data[key], value, `呼叫端${key}`);
      if ('replayCase' in data) equal(data.replayCase, descriptor, '呼叫端案例');
      const result = { ...data, ...metadata, replayCase: descriptor };
      validateCase(result, descriptor, binding, false);
      equal(context.manifest.definition.inputs, fingerprints(), '接收時來源／工具／build');
      verifyRunArtifacts(context, group, runId, binding.artifactHashes);
      const target = safeOutput(path.join(directory, 'raw', descriptor.file));
      atomicJson(target, result, true);
      state.cases[descriptor.file] = { sha256: sha(readFileSync(target)), passed: result.passed };
      state.status = Object.values(state.cases).some(row => !row.passed) ? 'failed'
        : Object.keys(state.cases).length === context.manifest.definition.expected[group].length ? 'complete' : 'collecting';
      atomicJson(path.join(directory, 'state.json'), state);
      return { saved: descriptor.file, runId, status: state.status };
    },
  };
}
export function verifyRun(context, group, runId) {
  const directory = runDirectory(context, group, runId);
  const startupFile = safeOutput(path.join(directory, 'startup.json')), stateFile = safeOutput(path.join(directory, 'state.json'));
  const startup = json(startupFile), state = json(stateFile), expected = context.manifest.definition.expected[group];
  const build = verifyRunArtifacts(context, group, runId, startup.binding?.artifactHashes);
  const binding = bindingFor(context, group, runId, build.artifactHashes);
  equal(startup.binding, binding, 'startup執行身分');
  equal(state.artifactHashes, build.artifactHashes, 'state建置產物身分');
  assert(startup.schema === schema && state.schema === schema && state.runId === runId && state.group === group && state.batchId === binding.batchId, '執行狀態身分錯誤');
  assert(state.status === 'complete', `執行尚未完整成功：${group}/${state.status}`);
  equal(Object.keys(state.cases).sort(), expected.map(row => row.file).sort(), 'receipt預期案例集合');
  equal(readdirSync(safeOutput(path.join(directory, 'raw'))).sort(), expected.map(row => row.file).sort(), 'raw預期檔案集合');
  const cases = expected.map(descriptor => {
    const file = safeOutput(path.join(directory, 'raw', descriptor.file)), bytes = readFileSync(file), data = JSON.parse(bytes.toString('utf8'));
    validateCase(data, descriptor, binding);
    assert(state.cases[descriptor.file].sha256 === sha(bytes) && state.cases[descriptor.file].passed === true, `raw／receipt雜湊不符：${descriptor.file}`);
    return { file: path.relative(context.directory, file).split(path.sep).join('/'), sha256: sha(bytes), passed: true,
      width: descriptor.width, height: descriptor.height, formalApp: descriptor.pathname === '/', nativeKeys: data.integrationBrowser.nativeKeys.length };
  });
  return { runId, startupSha256: sha(readFileSync(startupFile)), stateSha256: sha(readFileSync(stateFile)), ...build, cases };
}
export function selectRun(manifestFile, group, runId) {
  const context = loadManifest(manifestFile), lock = safeOutput(path.join(context.directory, 'selection.lock'));
  mkdirSync(lock);
  try {
    const fresh = loadManifest(manifestFile), checked = verifyRun(fresh, group, runId);
    fresh.manifest.selected[group] = { runId, startupSha256: checked.startupSha256 };
    fresh.manifest.revision++;
    atomicJson(fresh.file, fresh.manifest);
    return { group, runId, revision: fresh.manifest.revision };
  } finally { rmdirSync(lock); }
}
export function verifyManifest(context, selectedGroups = groups) {
  const rows = Object.fromEntries(selectedGroups.map(group => {
    assert(groups.includes(group), '未知驗證組別');
    const selected = context.manifest.selected[group];
    assert(selected, `manifest尚未選定完整${group}組`);
    const checked = verifyRun(context, group, selected.runId);
    assert(selected.startupSha256 === checked.startupSha256, '所選startup被替換');
    return [group, checked];
  }));
  return { schema, scope: 'P1-replay-109', batchId: context.manifest.definition.batchId,
    manifestRevision: context.manifest.revision, manifestSha256: context.manifestSha256,
    definitionSha256: context.manifest.definitionSha256, groups: rows, allPassed: true };
}
export function options(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    assert(key?.startsWith('--') && allowed.includes(key.slice(2)) && argv[i + 1] && !argv[i + 1].startsWith('--') && !(key.slice(2) in result), '參數無效；新驗收必須明確指定 --manifest <本案manifest.json>，請見本案tools/README.md');
    result[key.slice(2)] = argv[i + 1];
  }
  return result;
}
export function requiredManifest(args) {
  assert(args.manifest, '舊固定目錄入口已停用；請先用 replay-batch.mjs init，再指定 --manifest <本案manifest.json>');
  return loadManifest(args.manifest);
}
