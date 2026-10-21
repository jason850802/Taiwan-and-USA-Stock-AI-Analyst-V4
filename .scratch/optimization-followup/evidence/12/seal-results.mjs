// 本案P1封存只聲稱109份replay；舊213全矩陣不走新PASS捷徑。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { options, requiredManifest, verifyManifest, atomicJson, json, equal, assert, sha, gateDetails, safeOutput } from '../../../reacceptance-fixes/tools/replay-contract.mjs';
import { summarizeQueue } from './summarize-queue.mjs';
try {
  const args = options(process.argv.slice(2), ['manifest', 'gate']);
  const context = requiredManifest(args);
  assert(args.gate, '封存須指定 --gate <本批次完成後的真實gate.json>');
  const replayFile = safeOutput(path.join(context.directory, 'verified-replays.json'));
  const queueFile = safeOutput(path.join(context.directory, 'queue-summary.json'));
  const replay = verifyManifest(context), queue = summarizeQueue(context);
  equal(json(replayFile), replay, '分組摘要版本／run／raw');
  equal(json(queueFile), queue, '05摘要版本／run／raw');
  const gate = gateDetails(args.gate), baseline = context.manifest.definition.baselineGate;
  equal(gate.rootTests, baseline.rootTests, '最終gate根母體逐檔案例數');
  equal(gate.originalTestHashes, baseline.originalTestHashes, '最終gate既有tests／snapshot');
  assert(Number.isFinite(Date.parse(gate.startedAt)) && Date.parse(gate.startedAt) >= Date.parse(context.manifest.definition.createdAt)
    && Date.parse(gate.completedAt) >= Date.parse(gate.startedAt), 'gate來自舊批次或時間不完整');
  const raw = Object.values(replay.groups).flatMap(group => group.cases);
  const result = { ...replay, gate, verifiedRawFiles: raw.length,
    counts: { replays: raw.length - replay.groups['05-before'].cases.length, queueBefore: replay.groups['05-before'].cases.length,
      formalApp: raw.filter(row => row.formalApp).length },
    verifications: { 'verified-replays.json': sha(readFileSync(replayFile)), 'queue-summary.json': sha(readFileSync(queueFile)) },
    note: '此封存僅涵蓋本案P1的109份新結果；歷史副本測試另列，未宣稱原213案重跑或S1已修正。' };
  atomicJson(path.join(context.directory, 'final-seal.json'), result);
  console.log(JSON.stringify({ allPassed: true, scope: result.scope, batchId: result.batchId, manifestRevision: result.manifestRevision, ...result.counts,
    rootTestFiles: gate.rootTests.length, rootTests: gate.rootTests.reduce((sum, row) => sum + row.tests, 0), historicalCopyTests: gate.historicalCopyTests }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
