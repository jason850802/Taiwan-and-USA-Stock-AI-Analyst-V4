#!/usr/bin/env node
// 01 票證據核對：只讀上一輪 v5 十檔真行情 raw，重算排隊／TTFB／body／發布分段與三槽波次。
// 不發任何請求；輸出寫到 evidence/01/v5-segments/（已存在則只比對、不覆寫）。
import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_ROOT, ROOT, median, round, stats, writeOnceOrCompare } from './verify-b1-breakdown.mjs';

const V5_DIR = path.join(ROOT, '.scratch', 'performance-fix-20260922', 'evidence', '05', 'true-market-paired-20260923-v5');
const OUT_DIR = path.join(EVIDENCE_ROOT, 'v5-segments');
const pages = fs.readdirSync(V5_DIR).filter(name => /^(before|after)-pair-\d\.json$/.test(name)).sort();

const perPage = pages.map(name => {
  const page = JSON.parse(fs.readFileSync(path.join(V5_DIR, name), 'utf8'));
  const requests = page.requests.map(r => ({
    kind: r.kind,
    symbol: r.symbol,
    status: r.status,
    startMs: r.startMs,
    activeAtStart: r.activeAtStart,
    ttfbMs: r.headersMs - r.startMs,
    bodyReadMs: r.bodyMs - r.headersMs,
    endMs: r.bodyMs,
    publishMs: r.kind === 'quote' && Number.isFinite(page.visible?.[r.symbol]) ? page.visible[r.symbol] - r.bodyMs : null,
  }));
  const priced = requests.filter(r => r.kind === 'quote' || r.kind === 'fx');
  const firstStart = Math.min(...priced.map(r => r.startMs));
  // 三槽波次：以起跑時間排序，每支請求的「等槽」＝起跑−第一支起跑。
  const waves = priced.slice().sort((a, b) => a.startMs - b.startMs).map((r, i) => ({ order: i, symbol: r.symbol, kind: r.kind, slotWaitMs: round(r.startMs - firstStart), ttfbMs: round(r.ttfbMs), endMs: round(r.endMs) }));
  const lastQuote = priced.reduce((a, b) => (a.endMs > b.endMs ? a : b));
  const names = requests.filter(r => r.kind === 'name');
  return {
    page: name.replace('.json', ''),
    sourceId: page.sourceId,
    firstValidQuoteMs: round(page.firstValidQuoteMs),
    allValidQuotesFxMs: round(page.allValidQuotesFxMs),
    httpPeak: page.httpPeak,
    pricedTtfb: stats(priced.map(r => r.ttfbMs)),
    pricedBodyRead: stats(priced.map(r => r.bodyReadMs)),
    quotePublish: stats(priced.map(r => r.publishMs)),
    firstPricedStartMs: round(firstStart),
    lastPriced: { symbol: lastQuote.symbol, slotWaitMs: round(lastQuote.startMs - firstStart), ttfbMs: round(lastQuote.ttfbMs), endMs: round(lastQuote.endMs) },
    namesStartedBeforeLastPriced: names.filter(n => n.startMs < lastQuote.startMs).length,
    nameTtfb: stats(names.map(r => r.ttfbMs)),
    waves,
  };
});

const pool = variant => perPage.filter(p => p.page.startsWith(variant));
const summary = {
  source: path.relative(ROOT, V5_DIR).replaceAll('\\', '/'),
  note: '保存樣本的重算（證據核對），非本輪 fresh 量測；時間皆為瀏覽器頁面單調時鐘 ms',
  pages: perPage,
  byVariant: Object.fromEntries(['before', 'after'].map(variant => [variant, {
    firstValidQuoteMedianMs: round(median(pool(variant).map(p => p.firstValidQuoteMs))),
    allValidQuotesFxMedianMs: round(median(pool(variant).map(p => p.allValidQuotesFxMs))),
    pricedTtfbMedianOfPagesMs: round(median(pool(variant).map(p => p.pricedTtfb.median))),
    lastPricedSlotWaitMedianMs: round(median(pool(variant).map(p => p.lastPriced.slotWaitMs))),
    lastPricedTtfbMedianMs: round(median(pool(variant).map(p => p.lastPriced.ttfbMs))),
    quotePublishMaxMs: round(Math.max(...pool(variant).map(p => p.quotePublish.max ?? -Infinity))),
  }])),
};

const lines = ['# v5 十檔真行情分段重算（證據核對）', '', `來源：\`${summary.source}\`（只讀；本檔由 v5-segments.mjs 產生，請勿手改）`, ''];
lines.push('| 頁 | 首價 | 全價＋FX | 報價 TTFB 中位 | body 讀取中位 | 發布最大 | 最後一支：等槽／TTFB／完成 | 最後一支前起跑的名稱請求 |', '|---|---:|---:|---:|---:|---:|---|---:|');
for (const p of perPage) {
  lines.push(`| ${p.page}（${p.sourceId}） | ${p.firstValidQuoteMs} | ${p.allValidQuotesFxMs} | ${p.pricedTtfb.median} | ${p.pricedBodyRead.median} | ${p.quotePublish.max ?? '—'} | ${p.lastPriced.symbol}：${p.lastPriced.slotWaitMs}／${p.lastPriced.ttfbMs}／${p.lastPriced.endMs} | ${p.namesStartedBeforeLastPriced} |`);
}
lines.push('', '| 版本 | 首價中位 | 全價＋FX 中位 | 各頁報價 TTFB 中位的中位 | 最後一支等槽中位 | 最後一支 TTFB 中位 | 發布最大 |', '|---|---:|---:|---:|---:|---:|---:|');
for (const [variant, v] of Object.entries(summary.byVariant)) {
  lines.push(`| ${variant} | ${v.firstValidQuoteMedianMs} | ${v.allValidQuotesFxMedianMs} | ${v.pricedTtfbMedianOfPagesMs} | ${v.lastPricedSlotWaitMedianMs} | ${v.lastPricedTtfbMedianMs} | ${v.quotePublishMaxMs} |`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const problems = [];
const status = [
  writeOnceOrCompare(path.join(OUT_DIR, 'v5-segments.json'), `${JSON.stringify(summary, null, 2)}\n`, problems),
  writeOnceOrCompare(path.join(OUT_DIR, 'v5-segments.md'), `${lines.join('\n')}\n`, problems),
];
console.log(JSON.stringify({ byVariant: summary.byVariant, status, problems }, null, 2));
process.exitCode = problems.length ? 2 : 0;
