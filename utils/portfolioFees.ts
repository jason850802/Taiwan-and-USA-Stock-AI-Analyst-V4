// utils/portfolioFees.ts — 庫存費用/稅純函式（Phase 10 T1 自 components/Portfolio.tsx 原樣搬出）
// 行為鎖：portfolioFees.test.ts。改任何常數/rounding 前先跑 npm run test。
// 台股費率／稅率不在本檔：見 config/twFeeRates.ts（設定與計算分離，本檔只留 rounding 規則）。
import {
  TW_BROKERAGE_FEE_RATE,
  TW_SECURITIES_TAX_RATES,
  TW_DAY_TRADE_STOCK_TAX_RATE,
} from '../config/twFeeRates';

// ── 判斷台股 ───────────────────────────────────────────────────────────────
// 實作已移至 utils/market.ts（市場分類唯一權威，Phase 12 T1）；此處僅 re-export 保呼叫端不動。
export { isTwStock } from './market';

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
/**
 * 賣出證交稅率。`isDayTrade` 為 optional，缺參／false 一律等於現行為（一般交易）。
 * **只有個股減半**：ETF／債券 ETF 收到 true 仍回原檔次——這是縱深防禦的最底層，
 * 「ETF 當沖不適用減半」鎖在稅率函式裡，不靠 UI 或引擎的紀律（ADR-0003 決策 3）。
 */
export const getTaxRate = (symbol: string, isDayTrade?: boolean): number => {
  const type = getTwStockType(symbol);
  if (isDayTrade && type === 'stock') return TW_DAY_TRADE_STOCK_TAX_RATE;
  return TW_SECURITIES_TAX_RATES[type];
};

// ── 台股手續費 ──────────────────────────────────────────────────────────────
export const calcTwBuyFee = (base: number): number =>
  base > 0 ? Math.max(1, Math.floor(base * TW_BROKERAGE_FEE_RATE)) : 0;
/**
 * 賣出的手續費與證交稅。`isDayTrade` 為 optional，缺參／false 一律等於現行為。
 * 當沖的正典公式＝**稅率替換、單次 floor**：`floor(成交金額 × 0.0015)`；
 * 禁止任何中間 rounding（例如先算一般稅額取整再除二）。
 * **手續費完全不受旗標影響**——當沖減半是法定稅率，折讓是券商商業條件（ADR-0003 決策 6）。
 */
export const calcTwSellFeeAndTax = (value: number, symbol: string, isDayTrade?: boolean) => {
  if (value <= 0) return { sellFee: 0, tax: 0 };
  const sellFee = Math.max(1, Math.floor(value * TW_BROKERAGE_FEE_RATE));
  const tax = Math.floor(value * getTaxRate(symbol, isDayTrade));
  return { sellFee, tax };
};

// ── 美股手續費 ──────────────────────────────────────────────────────────────
// 個股：0.08%（無最低）；ETF：統一 $3 USD；無交易稅
//
// 費率依據（2026-07 以國泰複委託對帳單反推，5 個樣本全數吻合，round2 後與帳單逐筆相同）：
//   成交 1500.00 → 費 1.20 ｜ 895.00 → 0.72 ｜ 604.00 → 0.48 ｜ 175.50 → 0.14
// 原值誤植為 0.00008（0.008%），使美股賣出成本低估 10 倍、損益被高估，2026-07-23 修正。
// ETF 固定 $3 部分經帳單驗證正確（DRAM／SOXX／MUU／GLWG／LITX／SNXX 實收皆 3.00）。
export const calcUsFee = (valueUsd: number, isEtf: boolean): number =>
  isEtf ? 3 : valueUsd * 0.0008;
