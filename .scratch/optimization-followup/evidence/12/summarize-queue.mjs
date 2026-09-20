// 同機器重跑前後批次；完整保留冷啟動、暖機、五次樣本及最差全量時間。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = fileURLToPath(new URL('./', import.meta.url));
const read = name => JSON.parse(readFileSync(path.join(dir, 'replay-05', `${name}.json`), 'utf8'));
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
const stats = values => ({ samples: values, median: median(values), min: Math.min(...values), max: Math.max(...values) });
const beforeBaseline = '0366f5fb1d58d963323cc9d519f49ec87217a048';
const rows = [], rawHashes = {};
for (const count of [1,10,30]) {
  const row = { count };
  for (const stage of ['before','after']) {
    const samples = Array.from({length:7}, (_, i) => {
      const name = `${stage}-load-${count}-${i}`, raw = readFileSync(path.join(dir,'replay-05',`${name}.json`));
      rawHashes[`${name}.json`] = createHash('sha256').update(raw).digest('hex');
      const s = read(name);
      if (s.passed !== true || s.count !== count || s.sample !== i || s.network.delay !== 80
        || !Number.isFinite(s.firstVisibleMs) || !Number.isFinite(s.allCompleteMs)) throw new Error(`樣本不完整:${name}`);
      if (stage === 'before' && (s.source !== beforeBaseline || s.queueSha256 !== null)) throw new Error(`前版本來源錯誤:${name}`);
      if (stage === 'after' && (!s.queueSha256 || s.source !== 'working-tree' || s.network.peak > 3)) throw new Error(`後版本來源或峰值錯誤:${name}`);
      return s;
    });
    const measured = samples.slice(2);
    row[stage] = {
      cold: { firstVisibleMs:samples[0].firstVisibleMs, allCompleteMs:samples[0].allCompleteMs },
      warmup: { firstVisibleMs:samples[1].firstVisibleMs, allCompleteMs:samples[1].allCompleteMs },
      firstVisibleMs: stats(measured.map(s=>s.firstVisibleMs)), allCompleteMs: stats(measured.map(s=>s.allCompleteMs)),
      requestCounts: measured.map(s=>s.network.records.length), peaks: measured.map(s=>s.network.peak),
      fxStartPositions: measured.map(s=>s.network.records.findIndex(r=>r.symbol==='USDTWD=X')+1),
    };
  }
  rows.push(row);
}
const result = { beforeBaseline, afterCandidate: read('after-load-1-0').integration.candidate,
  method:'前版本為04完成、05三槽排隊前的來源；後版本為12最終候選。同一80ms假HTTP／資料集，各0冷啟動、1暖機、2～6五次完整樣本。不是01全部功能的等同基準。',
  rows, rawHashes };
writeFileSync(path.join(dir,'queue-summary.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(rows.map(r=>({count:r.count,peak:[Math.max(...r.before.peaks),Math.max(...r.after.peaks)],
  firstMs:[r.before.firstVisibleMs.median,r.after.firstVisibleMs.median],allMs:[r.before.allCompleteMs.median,r.after.allCompleteMs.median]}))));
