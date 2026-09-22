// 四項覆核修正的凍結紀錄；只核bytes與既有測試報告，不補標舊gate或browser raw。
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { root, evidence, options, requiredManifest, fingerprints, equal, hashes, safeOutput, atomicJson, sha, relative } from '../../tools/replay-contract.mjs';

const context = requiredManifest(options(process.argv.slice(2), ['manifest']));
const inputs = fingerprints();
equal(inputs, context.manifest.definition.inputs, '凍結時完整fingerprint');
const protection = JSON.parse(readFileSync(safeOutput(context.manifest.definition.protection.file), 'utf8'));
equal(inputs.sourceHashes, Object.fromEntries(Object.keys(inputs.sourceHashes).map(file => [file, protection.trackedHashes[file]])), '本票產品／依賴bytes');
equal(hashes(Object.keys(protection.baselineTests)), protection.baselineTests, '原測試／snapshot bytes');
const diagnosticProbe = JSON.parse(readFileSync(path.join(root, evidence, 'fingerprint-red-7a502f13-b170-437e-a1de-f7aa8f7cc165/actual-esbuild-command.json'), 'utf8'));
equal(inputs.toolHashes[diagnosticProbe.binary], diagnosticProbe.binarySha256, 'native executable原bytes');
equal(inputs.toolHashes[diagnosticProbe.packageJson], diagnosticProbe.packageSha256, 'native package原bytes');
const results = {
  fingerprintRed: `${evidence}/fingerprint-red-7a502f13-b170-437e-a1de-f7aa8f7cc165/results.json`,
  fingerprintGreen: `${evidence}/fingerprint-green-42b46f75-e48c-4c49-b20c-c0c8056f0694/results.json`,
  artifactsRed: `${evidence}/artifacts-red-9bd40403-3f8a-4c3a-905e-55192299406b/results.json`,
  artifactsGreen: `${evidence}/artifacts-green-34be317d-b897-43ec-be36-e6712612d7a6/results.json`,
  adapterPreflight: `${evidence}/adapter-preflight-08fb4179-9790-49c5-92ff-967474a06bb7/results.json`,
  structuralGreen: `${evidence}/protocol-check-56fbde7a-b2ec-4b5a-993c-a45301afa1bc/results.json`,
};
const directory = safeOutput(`${evidence}/review-fix-freeze-${randomUUID()}`); mkdirSync(directory);
const regressionFiles = ['replay-fingerprint-regression.mjs', 'replay-artifact-regression.mjs', 'replay-adapter-preflight.mjs',
  'replay-structural-regression.mjs', 'replay-raw-regression.mjs'].map(name => `.scratch/reacceptance-fixes/tools/${name}`);
const report = {
  schema: 'p1-review-fix-freeze-v1', at: new Date().toISOString(),
  findings: ['S-P1-01 / P1-SPEC-01', 'S-P1-02 / P1-SPEC-03', 'P1-SPEC-02', 'P1-SPEC-04'],
  fingerprints: inputs, regressionHashes: hashes(regressionFiles),
  evidence: Object.fromEntries(Object.entries(results).map(([name, file]) => [name, { file, sha256: sha(readFileSync(path.join(root, file))) }])),
  validation: { fingerprintChecks: 45, fingerprintBeforeFailures: 29, fingerprintAfterFailures: 0,
    artifactChecks: 22, artifactBeforeFailures: 22, artifactAfterFailures: 0, structuralChecks: 21,
    adaptedSyntaxGroups: 5, realEsbuildBundlesWithoutListen: 3, protectedTestsAndSnapshots: Object.keys(protection.baselineTests).length,
    sourceFilesMatchOriginalProtection: Object.keys(inputs.sourceHashes).length, nativeBinaryAndMetadataUnchanged: true },
  contract: {
    addedSources: ['index.css', 'postcss.config.js', 'tailwind.config.js'],
    runtime: '以已安裝esbuild的generateBinPath解析；唯讀VM只提供existsSync，不能下載、解包或寫node_modules；只接受實際native optional package，拒絕ESBUILD_BINARY_PATH。',
    gate: 'run-check.mjs及run-gate.mjs均入toolHashes；gateDetails對runnerSha256/entrypointSha256逐值重算，缺欄或漂移拒絕。舊baseline-gate未補欄。',
    artifacts: '04/05原build分支在listen前執行；每run artifacts/holdings.js只保存一次。初載HTML binding、startup/state/raw含精確artifactHashes；版本URL帶run/hash。接收、送檔、verifier/queue/seal均重讀bytes。',
  },
  pending: ['prime真跑provenance-baseline-gate後init全新manifest', '新109及新P05/P11真HTTP／browser證據',
    '用新gate執行fingerprint回歸的完整gateDetails缺／錯hash副本', '新109真raw負向矩陣與產物漂移反例',
    '最終gate／完整保護核對／seal／獨立雙軸修正覆核／提交'],
  limits: '本檔是修正工具凍結，P1未關閉。CLI未啟listener、未跑gate或browser，沒有補標任何舊raw或gate。',
};
atomicJson(path.join(directory, 'fingerprints.json'), inputs, true);
atomicJson(path.join(directory, 'result.json'), report, true);
console.log(JSON.stringify({ file: relative(path.join(directory, 'result.json')), sourceFiles: Object.keys(inputs.sourceHashes).length,
  beforeSourceFiles: Object.keys(inputs.beforeSourceHashes).length, coreTools: Object.keys(inputs.toolHashes).length,
  buildFiles: Object.keys(inputs.buildHashes).length, contractSha256: inputs.toolHashes['.scratch/reacceptance-fixes/tools/replay-contract.mjs'],
  serverSha256: inputs.toolHashes['.scratch/optimization-followup/evidence/12/replay-server.mjs'],
  esbuildRuntime: inputs.esbuildRuntime, nativeSha256: inputs.toolHashes[inputs.esbuildRuntime.binary] }));
