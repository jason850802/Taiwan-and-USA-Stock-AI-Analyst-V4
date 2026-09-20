// 只統計實際保存的完整樣本，不挑選有利批次。
import { readFileSync, writeFileSync } from 'node:fs';
const read = name => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const result = { method: '每組 sample 0 冷初始化另列、1 暖機、2～6 五次中位數與最差樣本', rows: [] };
for (const count of [1, 10, 30]) {
  const row = { count };
  for (const stage of ['before', 'after']) {
    const all = Array.from({ length: 7 }, (_, i) => read(`${stage}-load-${count}-${i}`));
    if (all.some(x => !x.passed || !Number.isFinite(x.firstVisibleMs) || !Number.isFinite(x.allCompleteMs))) throw new Error(`${stage}/${count} 的樣本不完整`);
    const measured = all.slice(2);
    row[stage] = {
      coldFirstMs: all[0].firstVisibleMs, coldAllMs: all[0].allCompleteMs,
      medianFirstMs: median(measured.map(x => x.firstVisibleMs)), medianAllMs: median(measured.map(x => x.allCompleteMs)),
      worstAllMs: Math.max(...measured.map(x => x.allCompleteMs)),
      peak: Math.max(...measured.map(x => x.network.peak)),
      requestCounts: measured.map(x => x.network.records.length),
      fxStartPositions: measured.map(x => x.network.records.findIndex(r => r.symbol === 'USDTWD=X') + 1),
    };
  }
  result.rows.push(row);
}
writeFileSync(new URL('./comparison.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
const fixed = n => n.toFixed(1);
const report = [
  '# 05 前後量測結果', '', result.method, '',
  '| 持股數 | HTTP 峰值 前→後 | 請求數 前→後 | 首檔中位數 ms 前→後 | 全部中位數 ms 前→後 | 最差全部 ms 前→後 |',
  '|---|---|---|---|---|---|',
  ...result.rows.map(({ count, before: b, after: a }) => `| ${count} | ${b.peak}→${a.peak} | ${b.requestCounts[0]}→${a.requestCounts[0]} | ${fixed(b.medianFirstMs)}→${fixed(a.medianFirstMs)} | ${fixed(b.medianAllMs)}→${fixed(a.medianAllMs)} | ${fixed(b.worstAllMs)}→${fixed(a.worstAllMs)} |`),
  '', '匯率在修正後每次都是第 1 個請求；修改前為持股數加 1。限制併發延長全量時間，是降低瞬間請求量的明確代價；不宣稱全面提速。首次冷初始化各自另列於 comparison.json。', '',
];
writeFileSync(new URL('./measurement-results.md', import.meta.url), report.join('\n'));
console.log(JSON.stringify(result, null, 2));
