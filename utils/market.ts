// utils/market.ts — 市場分類的唯一權威（Phase 12 T1）
//
// 由 utils/portfolioFees.ts 原樣搬入（實作零改寫），改由本檔統一供應：
// quoteCache.marketForSymbol、gemini.ts、App.tsx、yahoo.ts 的分類判斷全數委派到這裡。
// portfolioFees.ts 改為 re-export，既有 16 個呼叫端一行不動。
//
// 行為鎖：utils/market.test.ts（真值表）＋ utils/portfolioFees.test.ts（re-export 仍綠即證明相容）。
//
// 不屬於「分類」、刻意不收斂的地方（碰了就是 bug）：
//   services/yahoo.ts 的代碼「抽取」regex 與 canonical key、FinMind fallback 的硬編 true、
//   services/stockDirectory.ts 的台股名錄內個股/ETF 子分類、api/_lib/* 的後端輸入白名單。

// ── 判斷台股 ───────────────────────────────────────────────────────────────
export const isTwStock = (symbol: string): boolean => {
  const s = symbol.toUpperCase();
  // 台股：含 .TW / .TWO 後綴，或數字代號（可加單一英文字母結尾，如 00631L、00679B、00981A）
  return s.endsWith('.TW') || s.endsWith('.TWO') || /^\d{3,6}[A-Z]?$/.test(s);
};

// ── 市場歸屬 ───────────────────────────────────────────────────────────────
export const marketOf = (symbol: string): 'TW' | 'US' => (isTwStock(symbol) ? 'TW' : 'US');
