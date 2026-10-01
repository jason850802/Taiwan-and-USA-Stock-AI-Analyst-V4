// utils/quoteGaps.ts — 報價不齊判定（庫存頁全局摘要與持股表群組小計共用）
// 2026-10-01 使用者拍板：任一持股沒有可用報價 → 市值與總損益一律顯示「—」並列出缺哪幾檔，
// 報價齊全才出數字。不以 0 計（＝假設那檔歸零）、也不排除兩邊（＝假設那檔不賺不賠）——
// 與每日快照守衛 A、回推缺價日「不畫」同一個寧缺勿錯原則。行為鎖：quoteGaps.test.ts。

/** 判定所需的最小報價形狀（PriceData 的子集） */
export interface QuoteLike {
  price: number;
  loading?: boolean;
  error?: boolean;
}

/** 缺報價的代號：載入中（含還沒有項目）與讀取失敗（含回應成功但價格無效）分開列 */
export interface QuoteGaps {
  loading: string[];
  failed: string[];
}

/** 可用報價：已到貨、非錯誤、價格為正的有限數（undefined／NaN 等無效價不算）。加總只計可用報價 */
export const isUsableQuote = (p: QuoteLike | undefined): boolean =>
  !!p && !p.loading && !p.error && Number.isFinite(p.price) && p.price > 0;

/** 盤點缺報價的代號；同代號多批只列一次、依第一次出現的順序。兩個清單皆空＝報價齊全 */
export const findQuoteGaps = (symbols: string[], prices: Record<string, QuoteLike | undefined>): QuoteGaps => {
  const gaps: QuoteGaps = { loading: [], failed: [] };
  for (const symbol of new Set(symbols)) {
    const p = prices[symbol];
    if (isUsableQuote(p)) continue;
    if (!p || p.loading) gaps.loading.push(symbol);
    else gaps.failed.push(symbol);
  }
  return gaps;
};

/** 卡片底下的說明：讀取失敗列代號（要使用者處理）、載入中只報檔數（等一下就好）；齊全回 null */
export const describeQuoteGaps = (gaps: QuoteGaps): string | null => {
  const parts: string[] = [];
  if (gaps.failed.length > 0) parts.push(`讀取失敗：${gaps.failed.join('、')}`);
  if (gaps.loading.length > 0) parts.push(`${gaps.loading.length} 檔報價載入中`);
  return parts.length > 0 ? parts.join('；') : null;
};

/** 一組持股的報價狀態：complete 決定加總出不出數字（看清單、不看文字），note 是卡片底下的說明 */
export const summarizeQuoteGaps = (
  symbols: string[],
  prices: Record<string, QuoteLike | undefined>,
): { complete: boolean; note: string | null } => {
  const gaps = findQuoteGaps(symbols, prices);
  return { complete: gaps.loading.length === 0 && gaps.failed.length === 0, note: describeQuoteGaps(gaps) };
};
