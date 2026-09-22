// 05前後各21份；先核指定run與raw，再保留原冷頁／暖機／五樣本統計。
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { options, requiredManifest, verifyManifest, atomicJson, json, beforeCommit } from '../../../reacceptance-fixes/tools/replay-contract.mjs';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = values => ({ samples: values, median: median(values), min: Math.min(...values), max: Math.max(...values) });
export function summarizeQueue(context) {
  const verification = verifyManifest(context, ['05-before', '05-after']);
  const rows = [];
  for (const count of [1, 10, 30]) {
    const row = { count };
    for (const stage of ['before', 'after']) {
      const files = verification.groups[`05-${stage}`].cases;
      const samples = Array.from({ length: 7 }, (_, sample) => json(path.join(context.directory, files.find(file => file.file.endsWith(`/${stage}-load-${count}-${sample}.json`)).file)));
      const measured = samples.slice(2);
      row[stage] = {
        cold: { firstVisibleMs: samples[0].firstVisibleMs, allCompleteMs: samples[0].allCompleteMs },
        warmup: { firstVisibleMs: samples[1].firstVisibleMs, allCompleteMs: samples[1].allCompleteMs },
        firstVisibleMs: stats(measured.map(sample => sample.firstVisibleMs)), allCompleteMs: stats(measured.map(sample => sample.allCompleteMs)),
        requestCounts: measured.map(sample => sample.network.records.length), peaks: measured.map(sample => sample.network.peak),
        fxStartPositions: measured.map(sample => sample.network.records.findIndex(record => record.symbol === 'USDTWD=X') + 1),
      };
    }
    rows.push(row);
  }
  return { ...verification, beforeBaseline: beforeCommit, afterCandidate: context.manifest.definition.inputs.candidate,
    method: '前版固定04完成來源，後版為當前候選；80ms合成HTTP，各0冷頁、1暖機、2～6完整五樣本。', rows };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const context = requiredManifest(options(process.argv.slice(2), ['manifest']));
    const result = summarizeQueue(context);
    atomicJson(path.join(context.directory, 'queue-summary.json'), result);
    console.log(JSON.stringify({ allPassed: true, batchId: result.batchId, manifestRevision: result.manifestRevision, rows: result.rows }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
