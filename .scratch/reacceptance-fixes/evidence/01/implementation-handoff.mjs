// 交付當下核心指紋與驗證邊界；只寫本案新的交付紀錄。
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { root, evidence, options, requiredManifest, atomicJson, safeOutput, sha, relative } from '../../tools/replay-contract.mjs';
const context = requiredManifest(options(process.argv.slice(2), ['manifest']));
const directory = safeOutput(`${evidence}/handoff-${randomUUID()}`); mkdirSync(directory);
const cli = ['replay-structural-regression.mjs', 'replay-raw-regression.mjs'].map(name => `.scratch/reacceptance-fixes/tools/${name}`);
const result = {
  schema: 'p1-implementation-handoff-v1', recordedAt: new Date().toISOString(),
  checkedAgainstManifest: relative(context.file), definitionSha256: context.manifest.definitionSha256,
  coreToolHashes: context.manifest.definition.inputs.toolHashes,
  regressionToolHashes: Object.fromEntries(cli.map(file => [file, sha(readFileSync(path.join(root, file)))])),
  completed: { structuralChecks: 21, structuralEvidence: `${evidence}/protocol-check-db83523b-9bac-4df2-86e8-9f1abaa9df32/results.json`, coreSyntaxChecks: 7, regressionSyntaxChecks: 2 },
  pending: ['prime的109份fresh browser及明確五組選擇', '最終gate與兩份摘要', '真raw負向副本矩陣的實跑', 'P11真活站補案證據', '獨立Standards／Spec及關票'],
  sourceProtection: '以起始protection.json的實際工作樹SHA核對P1來源與依賴；未轉換產品行尾。最初直接比較Git blob的差異原因尚未完整定位，不宣稱已證明是CRLF。',
  scope: '工具實作交付，P1尚未關閉。prime已回報P05真舊browser跨restart與P08重複case拒絕；其原始證據由prime保存及覆核。',
};
atomicJson(path.join(directory, 'result.json'), result, true);
console.log(JSON.stringify({ evidence: relative(path.join(directory, 'result.json')), coreTools: Object.keys(result.coreToolHashes).length, regressionTools: result.regressionToolHashes }));
