// 保守清理證據：模組可達性不是所有分支皆有用途的證明，仍保留逐項人工判讀。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const baseline = 'eb1dcfac70094fcbdcdacf9c873b589e5f52c6b4';
const first = 'ade5dca1e7106c90430efc35b50ba4adaaae8b42';
const git = args => {
  const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || 'Git 檢查失敗');
  return run.stdout.trim();
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const audit = JSON.parse(readFileSync(path.join(dir, 'audit.json'), 'utf8'));
const productionPaths = audit.files.map(file => file.path);
const unused = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--noUnusedLocals', '--noUnusedParameters'],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const raw = `${unused.stdout || ''}${unused.stderr || ''}`;
writeFileSync(path.join(dir, 'unused-declarations.txt'), `${raw}\nexit_code=${unused.status}\n`);
const diagnostics = raw.split(/\r?\n/).filter(line => line.includes('error TS')).map(line => ({
  file: line.slice(0, line.indexOf('(')).replaceAll('\\', '/'), diagnostic: line,
}));
const formalDiagnostics = diagnostics.filter(row => !/\.test\.tsx?$/.test(row.file));
const testDiagnostics = diagnostics.filter(row => /\.test\.tsx?$/.test(row.file));
const names = ['createFramePublisher', 'createHoldingPriceQueue', 'createBoundedSessionStore', 'writeMemoryAlias', 'getLatestPrice', 'getStockData'];
const references = Object.fromEntries(names.map(name => [name, productionPaths.flatMap(file =>
  readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).flatMap((text, index) => text.includes(name)
    ? [{ file, line: index + 1, text: text.trim() }] : []))]));
const productDiff = git(['diff', '--name-only', baseline, '--', ...productionPaths]);
const result = {
  baseline, head: git(['rev-parse', 'HEAD']), node: process.version,
  sourceFiles: audit.sourceFiles, reachableFiles: audit.reachableFiles, unreachableCandidates: audit.unreachableCandidates,
  unused: { exitCode: unused.status, formalDiagnostics, testDiagnostics }, references,
  productDiffFromTicketStart: productDiff ? productDiff.split('\n') : [],
  productHashes: Object.fromEntries(productionPaths.map(file => [file, hash(readFileSync(path.join(root, file)))])),
  priorProductNumstat: git(['diff', '--numstat', first, baseline, '--', ...productionPaths]),
  lineAccounting: { production: { added: 0, removed: 0 }, tests: { added: 0, removed: 0 },
    tools: [{ file: 'evidence/11/analyze.mjs', added: readFileSync(fileURLToPath(import.meta.url), 'utf8').trimEnd().split('\n').length, removed: 0 }],
    note: '文件與原始JSON／文字證據不混入產品程式行數；完整檔案增刪見本票Git numstat。' },
  interpretation: '字串引用列表只供逐項定位；已讀呼叫端確認實際使用。沒有把可達性等同所有export或分支皆有效，也不因檔案大而拆分。',
};
writeFileSync(path.join(dir, 'cleanup-analysis.json'), JSON.stringify(result, null, 2) + '\n');
// 本票未動UI，核對已實跑15案是否仍綁定當前來源／建置；不重寫10的歷史檔。
const uiDir = path.join(root, '.scratch/optimization-followup/evidence/10');
const ui = JSON.parse(readFileSync(path.join(uiDir, 'verified-evidence.json'), 'utf8'));
const uiSourceMatches = Object.entries(ui.sourceHashes).every(([file, expected]) => hash(readFileSync(path.join(root, file))) === expected);
const uiBuildMatches = hash(readFileSync(path.join(root, 'dist/index.html'))) === ui.buildIndexSha256;
const uiCases = ui.cases.map(row => ({ name: row.name, passed: row.passed,
  rawMatches: hash(readFileSync(path.join(uiDir, `${row.name}.json`))) === row.sha256 }));
const uiBinding = { historicalTicket: '10', newNativeInputsThisTicket: 0, sourceMatches: uiSourceMatches,
  buildMatches: uiBuildMatches, cases: uiCases, note: '相同產品的已驗證UI結果，不冒充11重新操作；12另重跑完整整合。' };
writeFileSync(path.join(dir, 'ui-evidence-binding.json'), JSON.stringify(uiBinding, null, 2) + '\n');
const onlyUnusedTestDiagnostics = testDiagnostics.every(row => /error TS(?:6133|6196):/.test(row.diagnostic));
if (unused.error || unused.status === null || unused.status !== 0 && diagnostics.length === 0 || !onlyUnusedTestDiagnostics
  || formalDiagnostics.length || audit.unreachableCandidates.length || productDiff
  || !uiSourceMatches || !uiBuildMatches || uiCases.length !== 15 || uiCases.some(row => !row.passed || !row.rawMatches)) {
  throw new Error('需要人工處置的正式程式差異、不可達候選或未用宣告，請檢查保存結果');
}
console.log(JSON.stringify({ sourceFiles: audit.sourceFiles, reachableFiles: audit.reachableFiles,
  formalUnused: formalDiagnostics.length, existingTestUnused: testDiagnostics.length, productFilesChanged: 0 }));
