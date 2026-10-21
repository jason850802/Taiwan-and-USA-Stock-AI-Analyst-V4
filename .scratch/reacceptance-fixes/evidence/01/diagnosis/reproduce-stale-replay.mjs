// P1 修改前診斷：歷史 raw 只作未改標記的種子，實際執行原版 verifier。
// 所有寫入均在本腳本旁新建的獨立目錄；不啟站、不操作瀏覽器、不執行 gate。
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const diagnosisDir = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = path.resolve(diagnosisDir, '../../../../..');
const historyRoot = path.join(repoRoot, '.scratch/reacceptance-20260921/workspace');
const oldRelativeDir = '.scratch/optimization-followup/evidence/12';
const fixedCommit = 'b2bf7d8075eb31266d556afb0f874d37c3217bb4';
const verifierRelative = `${oldRelativeDir}/verify-replays.mjs`;
const removeResidue = process.argv.slice(2).includes('--without-residue');
assert(process.argv.slice(2).every(arg => arg === '--without-residue'), '未知參數');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeJoin = (root, relative) => {
  const resolved = path.resolve(root, relative);
  const within = path.relative(root, resolved);
  assert(within && !within.startsWith('..') && !path.isAbsolute(within), `路徑超出指定根：${relative}`);
  return resolved;
};
const relativeToRepo = absolute => path.relative(repoRoot, absolute).split(path.sep).join('/');
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

// 03 是原工具最小的完整組：五種行為加原生市場操作，各有桌面與窄版。
const caseNames = ['stale-return', 'switch-return', 'tab-return', 'force-pending', 'failure-retry'];
const expectedFiles = ['desktop', 'narrow'].flatMap(size =>
  caseNames.map(name => `${size}-green-${name}.json`).concat(`${size}-manual-market.json`));
const omittedFile = 'desktop-green-stale-return.json';
const startedAt = new Date().toISOString();
const runDir = path.join(diagnosisDir, `run-${randomUUID()}`);
mkdirSync(runDir);
const snapshotRoot = path.join(runDir, 'snapshot');
const snapshotEvidence = path.join(snapshotRoot, oldRelativeDir);
const receiptsDir = path.join(runDir, 'receipts');
mkdirSync(receiptsDir);

const verifierOriginal = readFileSync(path.join(historyRoot, verifierRelative));
const verifierCommitted = execFileSync('git', ['show', `${fixedCommit}:${verifierRelative}`], {
  cwd: repoRoot, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
});
assert(verifierOriginal.equals(verifierCommitted), '歷史 verifier bytes 不等於固定提交');
const auditRelative = `${oldRelativeDir}/audit.json`;
const audit = JSON.parse(readFileSync(path.join(historyRoot, auditRelative), 'utf8'));
const seeds = expectedFiles.map(file => {
  const relative = `${oldRelativeDir}/replay-03/${file}`;
  const absolute = safeJoin(historyRoot, relative);
  const bytes = readFileSync(absolute);
  const result = JSON.parse(bytes.toString('utf8'));
  assert.equal(result.passed, true, `${file} 不是歷史成功種子`);
  assert.equal(result.integration.candidate, fixedCommit, `${file} 候選不符`);
  return { file, relative, absolute, bytes, result, sha256: sha(bytes) };
});

// 複製原 verifier 讀取的最小檔案集合，保留完整相對目錄，因此程式 bytes 零重定位。
const dependencyPaths = [...new Set([
  verifierRelative, auditRelative, `${oldRelativeDir}/holdings-cases.mjs`, 'dist/index.html',
  ...audit.files.map(file => file.path),
  ...seeds.flatMap(seed => Object.keys(seed.result.integration.toolHashes)),
])];
const dependencies = dependencyPaths.map(relative => {
  const source = safeJoin(historyRoot, relative);
  const target = safeJoin(snapshotRoot, relative);
  const bytes = readFileSync(source);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  return { file: relative, original: relativeToRepo(source), bytes: bytes.length, sha256: sha(bytes) };
});
assert(readFileSync(path.join(snapshotRoot, verifierRelative)).equals(verifierOriginal), '執行副本不是原 bytes');

const deliver = (round, selected) => {
  const deliveries = selected.map(seed => {
    const target = safeJoin(snapshotEvidence, `replay-03/${seed.file}`);
    mkdirSync(path.dirname(target), { recursive: true });
    // 第二輪重送相同已捕捉 bytes；收件紀錄分開存，絕不把新輪 metadata 蓋進 raw。
    writeFileSync(target, seed.bytes, { flag: round === 1 ? 'wx' : 'w' });
    assert.equal(sha(readFileSync(target)), seed.sha256, `${seed.file} 複製後 bytes 不符`);
    return { file: seed.file, source: relativeToRepo(seed.absolute), sha256: seed.sha256 };
  });
  const receipt = {
    round, type: '歷史捕捉資料的檔案投遞模擬，非本次瀏覽器新驗收',
    expectedFiles, deliveredFiles: deliveries.map(item => item.file),
    omittedFiles: expectedFiles.filter(file => !deliveries.some(item => item.file === file)), deliveries,
  };
  writeJson(path.join(receiptsDir, `round-${round}.json`), receipt);
  return receipt;
};

const executeVerifier = round => {
  const script = path.join(snapshotRoot, verifierRelative);
  const before = performance.now();
  const child = spawnSync(process.execPath, [script, '03'], {
    cwd: snapshotRoot, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
  });
  assert(!child.error && child.signal === null && child.status !== null, `verifier 無正常退出：${child.error || child.signal}`);
  const log = {
    round, executable: process.execPath, arguments: [script, '03'], cwd: snapshotRoot,
    commandFromRepo: `node ${relativeToRepo(script)} 03`, exitCode: child.status,
    elapsedMs: Number((performance.now() - before).toFixed(3)), stdout: child.stdout, stderr: child.stderr,
  };
  if (child.status === 0) {
    log.consoleResult = JSON.parse(child.stdout.trim());
    const summary = readFileSync(path.join(snapshotEvidence, 'verified-replay-03.json'));
    writeFileSync(path.join(runDir, `round-${round}-verified-replay-03.json`), summary, { flag: 'wx' });
    log.summarySha256 = sha(summary);
    log.summaryCases = JSON.parse(summary).cases.length;
  }
  writeJson(path.join(runDir, `round-${round}-execution.json`), log);
  return log;
};

const firstReceipt = deliver(1, seeds);
const first = executeVerifier(1);
assert.equal(first.exitCode, 0, `第一輪正常重算失敗：${first.stderr}`);
assert.equal(first.consoleResult.allPassed, true);
assert.equal(first.consoleResult.cases, expectedFiles.length);
assert.equal(first.summaryCases, expectedFiles.length);
const omittedPath = path.join(snapshotEvidence, 'replay-03', omittedFile);
const firstOmittedBytes = readFileSync(omittedPath);
const firstOmittedMtimeMs = statSync(omittedPath).mtimeMs;
const secondReceipt = deliver(2, seeds.filter(seed => seed.file !== omittedFile));
assert.deepEqual(secondReceipt.omittedFiles, [omittedFile]);
assert.equal(secondReceipt.deliveredFiles.length, expectedFiles.length - 1);
assert(readFileSync(omittedPath).equals(firstOmittedBytes), '漏案檔案已被重寫');
assert.equal(statSync(omittedPath).mtimeMs, firstOmittedMtimeMs, '漏案檔案已被碰觸');
if (removeResidue) {
  // 對照只移開本次沙箱中自建的殘留副本，歷史來源與其餘輸入不動。
  renameSync(omittedPath, path.join(runDir, 'control-removed-residue.json'));
}
const second = executeVerifier(2);
if (removeResidue) {
  assert.notEqual(second.exitCode, 0, '移開舊副本後原 verifier 未拒絕缺案');
  assert(second.stderr.includes('ENOENT') && second.stderr.includes(omittedFile), '對照失敗不是指定缺案');
}

// 新斷言命中原症狀：本輪漏一案時，真實 verifier 必須非零退出。
let assertionFailure = null;
try {
  assert.notEqual(second.exitCode, 0, `P02：本輪只投遞 ${secondReceipt.deliveredFiles.length}/${expectedFiles.length} 案，原 verifier 卻接受第一輪殘留檔並成功退出`);
} catch (error) {
  assertionFailure = { name: error.name, code: error.code, message: error.message, actual: error.actual, operator: error.operator };
}
const preserved = [
  ...dependencies.map(item => ({ path: item.original, sha256: item.sha256 })),
  ...seeds.map(seed => ({ path: relativeToRepo(seed.absolute), sha256: seed.sha256 })),
];
const changedOriginals = preserved.filter(item => sha(readFileSync(path.join(repoRoot, item.path))) !== item.sha256);
assert.deepEqual(changedOriginals, [], '診斷期間歷史來源被改動');
const report = {
  schema: 'p1-stale-replay-diagnosis-v1', startedAt, completedAt: new Date().toISOString(),
  node: process.version, fixedCommit, mode: removeResidue ? '移開殘留的對照' : '保留第一輪殘留的紅燈',
  harness: { path: relativeToRepo(fileURLToPath(import.meta.url)), sha256: sha(readFileSync(fileURLToPath(import.meta.url))) },
  scope: '僅重算原 03 verifier；歷史成功 raw 作種子，沒有執行新瀏覽器矩陣。',
  originalVerifier: { source: relativeToRepo(path.join(historyRoot, verifierRelative)), fixedCommit, sha256: sha(verifierOriginal), copiedBytesIdentical: true, relocationEdits: 0 },
  runDirectory: relativeToRepo(runDir), dependencies, seedRaw: seeds.map(seed => ({ file: seed.file, source: relativeToRepo(seed.absolute), bytes: seed.bytes.length, sha256: seed.sha256 })),
  firstRound: { received: firstReceipt.deliveredFiles.length, expected: expectedFiles.length, execution: first },
  secondRound: { received: secondReceipt.deliveredFiles.length, expected: expectedFiles.length, missing: secondReceipt.omittedFiles, residuePresent: !removeResidue, residueSha256: sha(firstOmittedBytes), residueUntouchedBeforeControl: true, execution: second },
  originalFilesChecked: preserved.length, changedOriginals,
  regression: { expected: '第二輪缺案必須讓 verifier 非零退出', actualExitCode: second.exitCode, passed: assertionFailure === null, failure: assertionFailure },
  harnessExitCode: assertionFailure ? 1 : 0,
};
writeJson(path.join(runDir, 'diagnosis.json'), report);
console.log(JSON.stringify({
  evidence: report.runDirectory, originalVerifierSha256: report.originalVerifier.sha256,
  firstRound: { received: firstReceipt.deliveredFiles.length, exit: first.exitCode, console: first.consoleResult },
  secondRound: { received: secondReceipt.deliveredFiles.length, missing: omittedFile, residue: !removeResidue, exit: second.exitCode, console: second.consoleResult ?? null },
  regressionPassed: report.regression.passed, exit: report.harnessExitCode,
}));
if (assertionFailure) console.error(assertionFailure.message);
process.exitCode = report.harnessExitCode;
