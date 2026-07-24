// utils/fx.ts — 匯率常數與批次成本換算（Phase 12 T6a；匯率欄位擴充後加入買入匯率口徑）
//
// USD/TWD 的顯示用後備匯率。**只准表格顯示與表單試算用**——持久化快照（computeLiveSnapshot）
// 與歷史回推（backfillPipeline）拿不到匯率時一律跳過或擋下，不得用這個數字造史料（D-10）。
// 現況散寫在 Portfolio.tsx 的兩處硬編 32 收斂到這裡（T6a 先收主元件，表格那份 T6b 併表時收）。
import type { PortfolioItem, RealizedTrade } from '../types';

export const USD_TWD_FALLBACK = 32;

/**
 * 口徑（使用者 2026-07-24 拍板）：**成本用買入匯率、市值用即時匯率**。
 * 買入匯率＝該批 exchangeRate；沒有（舊資料）就退回即時匯率，UI 需標示為估算。
 */
export const lotBuyRate = (lot: PortfolioItem, liveRate: number): number =>
  lot.exchangeRate && lot.exchangeRate > 0 ? lot.exchangeRate : liveRate;

/** 該批是否有自己的買入匯率（UI 用來決定顯示實數還是「—」） */
export const hasBuyRate = (lot: PortfolioItem): boolean =>
  lot.exchangeRate !== undefined && lot.exchangeRate > 0;

/** 美股批次成本（TWD）：USD 計價 → ×買入匯率；TWD 計價 → totalCost 本來就是實付台幣 */
export const lotCostTwd = (lot: PortfolioItem, liveRate: number): number =>
  lot.purchaseCurrency === 'USD' && lot.totalCostUSD != null
    ? lot.totalCostUSD * lotBuyRate(lot, liveRate)
    : lot.totalCost;

/** 美股批次成本（USD）：USD 計價 → 固定值；TWD 計價 → ÷買入匯率 */
export const lotCostUsd = (lot: PortfolioItem, liveRate: number): number =>
  lot.purchaseCurrency === 'USD' && lot.totalCostUSD != null
    ? lot.totalCostUSD
    : lot.totalCost / lotBuyRate(lot, liveRate);

/**
 * 台幣實現損益（含匯差）＝ 賣出實收美元 × 賣出匯率 − 成本美元 × 買入匯率。
 * 兩個匯率缺一就回 null——不用即時匯率替代，否則等於偽造當時的成交匯率（D-10）。
 * 台股本來就是台幣，直接回 realizedPnl。
 * 帳本表格與歷史曲線的台幣已實現側共用此函式（單一口徑）。
 */
export const twdRealizedPnl = (t: RealizedTrade): number | null => {
  if (t.market === 'TW') return t.realizedPnl;
  if (!t.buyExchangeRate || !t.sellExchangeRate) return null;
  const netUsd = t.grossProceeds - t.sellFee - t.sellTax;
  return netUsd * t.sellExchangeRate - t.costBasis * t.buyExchangeRate;
};
