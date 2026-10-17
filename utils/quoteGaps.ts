// utils/quoteGaps.ts — 報價不齊判定（庫存頁全局摘要與持股表群組小計共用）
// 2026-10-01 使用者拍板：任一持股沒有可用報價 → 市值與總損益一律顯示「—」並列出缺哪幾檔，
// 報價齊全才出數字。不以 0 計（＝假設那檔歸零）、也不排除兩邊（＝假設那檔不賺不賠）——
// 與每日快照守衛 A、回推缺價日「不畫」同一個寧缺勿錯原則。行為鎖：quoteGaps.test.ts。
// 2026-10-05 拍板：查無行情（NOT_FOUND，永久、要使用者處理）在說明文字裡與其他讀取失敗分開列；
// 判定不變（查無仍不可用），單檔種類 quoteGapKind 也照舊歸 failed。

/** 判定所需的最小報價形狀（PriceData 的子集） */
export interface QuoteLike {
  price: number;
  loading?: boolean;
  error?: boolean;
  notFound?: boolean;   // 查無行情（伴隨 error）：說明文字分開列
}

/** 缺報價的代號：載入中（含還沒有項目）與讀取失敗（含回應成功但價格無效）分開列；
 *  查無行情另列 notFound（不在 failed 裡），沒有查無時不帶這欄 */
export interface QuoteGaps {
  loading: string[];
  failed: string[];
  notFound?: string[];
}

/** 可用報價：已到貨、非錯誤、價格為正的有限數（undefined／NaN 等無效價不算）。加總只計可用報價 */
export const isUsableQuote = (p: QuoteLike | undefined): boolean =>
  !!p && !p.loading && !p.error && Number.isFinite(p.price) && p.price > 0;

/** 缺報價的種類（查無屬於 failed，只在說明文字分開列） */
export type QuoteGapKind = 'loading' | 'failed';

/** 單檔的缺報價種類：可用回 null；沒有項目與載入中歸 loading，讀取失敗與價格無效歸 failed（健檢守門也用這套） */
export const quoteGapKind = (p: QuoteLike | undefined): QuoteGapKind | null =>
  isUsableQuote(p) ? null : (!p || p.loading ? 'loading' : 'failed');

/** 盤點缺報價的代號；同代號多批只列一次、依第一次出現的順序。兩個清單皆空＝報價齊全 */
export const findQuoteGaps = (symbols: string[], prices: Record<string, QuoteLike | undefined>): QuoteGaps => {
  const gaps: QuoteGaps = { loading: [], failed: [] };
  for (const symbol of new Set(symbols)) {
    const p = prices[symbol];
    const kind = quoteGapKind(p);
    if (kind === 'failed' && p?.notFound) (gaps.notFound ??= []).push(symbol);
    else if (kind) gaps[kind].push(symbol);
  }
  return gaps;
};

/** 查無行情的處理提示（只放總損益卡；即時報價只問 Yahoo，所以說「可能」、不斷言已下市） */
const NOT_FOUND_HINT = '（可能已下市或代號有誤，可刪除或改用正確代號重新新增）';

/** 說明文字選項：notFoundHint＝查無清單後補處理提示 */
export interface QuoteGapNoteOpts { notFoundHint?: boolean }

/** 卡片底下的說明：查無列最前面（永久、要處理）、讀取失敗列代號、載入中只報檔數（等一下就好）；齊全回 null */
export const describeQuoteGaps = (gaps: QuoteGaps, opts?: QuoteGapNoteOpts): string | null => {
  const parts: string[] = [];
  if (gaps.notFound?.length) {
    parts.push(`查無行情：${gaps.notFound.join('、')}${opts?.notFoundHint ? NOT_FOUND_HINT : ''}`);
  }
  if (gaps.failed.length > 0) parts.push(`讀取失敗：${gaps.failed.join('、')}`);
  if (gaps.loading.length > 0) parts.push(`${gaps.loading.length} 檔報價載入中`);
  return parts.length > 0 ? parts.join('；') : null;
};

/** 一組持股的報價狀態：complete 決定加總出不出數字（看清單、不看文字），note 是卡片底下的說明 */
export const summarizeQuoteGaps = (
  symbols: string[],
  prices: Record<string, QuoteLike | undefined>,
  opts?: QuoteGapNoteOpts,
): { complete: boolean; note: string | null } => {
  const gaps = findQuoteGaps(symbols, prices);
  const complete = gaps.loading.length === 0 && gaps.failed.length === 0 && !gaps.notFound?.length;
  return { complete, note: describeQuoteGaps(gaps, opts) };
};
