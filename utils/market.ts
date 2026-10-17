// utils/market.ts — 市場分類的唯一權威（Phase 12 T1）
//
// 由 utils/portfolioFees.ts 原樣搬入（實作零改寫），改由本檔統一供應：
// quoteCache.marketForSymbol、gemini.ts、App.tsx、yahoo.ts 的分類判斷全數委派到這裡。
// portfolioFees.ts 改為 re-export，既有 16 個呼叫端一行不動。
// 2026-10-01：台股代碼 regex 抽成純代碼版 isTwCode（isTwStock 委派它），並收進 T1 漏掉的
// components/FundamentalsPanel.tsx 本地 isTwCode（搜尋閘門只剝一層後綴，不能換成 isTwStock）。
//
// 行為鎖：utils/market.test.ts（真值表）＋ utils/portfolioFees.test.ts（re-export 仍綠即證明相容）
//         ＋ components/FundamentalsPanel.test.ts（基本面分頁搜尋閘門）。
//
// 不屬於「分類」、刻意不收斂的地方（碰了就是 bug）：
//   services/yahoo.ts 的代碼「抽取」regex 與 canonical key、FinMind fallback 的硬編 true、
//   services/stockDirectory.ts 的台股名錄內個股/ETF 子分類、api/_lib/* 的後端輸入白名單。

// ── 判斷台股代碼（純代碼，不含後綴）───────────────────────────────────────
// 數字代號，可加單一英文字母結尾（如 00631L、00679B、00981A）；大小寫不敏感、不 trim。
// 帶 .TW／.TWO 後綴的完整代碼回 false。只收純代碼的地方用這個（例：基本面分頁交給 FinMind 的
// data_id），不可換成 isTwStock——它收任何以後綴結尾的字串。
export const isTwCode = (code: string): boolean => /^\d{3,6}[A-Z]?$/.test(code.toUpperCase());

// ── 判斷台股 ───────────────────────────────────────────────────────────────
export const isTwStock = (symbol: string): boolean => {
  const s = symbol.toUpperCase();
  // 台股：含 .TW / .TWO 後綴，或台股純代碼
  return s.endsWith('.TW') || s.endsWith('.TWO') || isTwCode(s);
};

// ── 市場歸屬 ───────────────────────────────────────────────────────────────
export const marketOf = (symbol: string): 'TW' | 'US' => (isTwStock(symbol) ? 'TW' : 'US');
