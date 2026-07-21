// utils/portfolioFees.ts — 庫存費用/稅純函式（Phase 10 T1 自 components/Portfolio.tsx 原樣搬出）
// 行為鎖：portfolioFees.test.ts。改任何常數/rounding 前先跑 npm run test。

// ── 判斷台股 ───────────────────────────────────────────────────────────────
export const isTwStock = (symbol: string): boolean => {
  const s = symbol.toUpperCase();
  // 台股：含 .TW / .TWO 後綴，或數字代號（可加單一英文字母結尾，如 00631L、00679B、00981A）
  return s.endsWith('.TW') || s.endsWith('.TWO') || /^\d{3,6}[A-Z]?$/.test(s);
};

// ── 台股類型 ────────────────────────────────────────────────────────────────
export type TwStockType = 'stock' | 'etf' | 'bond-etf';
export const getTwStockType = (symbol: string): TwStockType => {
  const clean = symbol.replace(/\.(TW|TWO)$/i, '').toUpperCase();
  if (clean.startsWith('00')) {
    // B = 台幣計價債券ETF；C = 外幣計價債券ETF → 皆免證交稅
    return (clean.endsWith('B') || clean.endsWith('C')) ? 'bond-etf' : 'etf';
  }
  return 'stock';
};
export const getTaxRate = (symbol: string): number => {
  const t = getTwStockType(symbol);
  if (t === 'bond-etf') return 0;
  if (t === 'etf') return 0.001;
  return 0.003;
};

// ── 台股手續費 ──────────────────────────────────────────────────────────────
export const calcTwBuyFee = (base: number): number =>
  base > 0 ? Math.max(1, Math.floor(base * 0.001425)) : 0;
export const calcTwSellFeeAndTax = (value: number, symbol: string) => {
  if (value <= 0) return { sellFee: 0, tax: 0 };
  const sellFee = Math.max(1, Math.floor(value * 0.001425));
  const tax = Math.floor(value * getTaxRate(symbol));
  return { sellFee, tax };
};

// ── 美股手續費 ──────────────────────────────────────────────────────────────
// 個股：0.008%（無最低）；ETF：統一 $3 USD；無交易稅
export const calcUsFee = (valueUsd: number, isEtf: boolean): number =>
  isEtf ? 3 : valueUsd * 0.00008;
