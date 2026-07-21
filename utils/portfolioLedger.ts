// utils/portfolioLedger.ts — 賣出引擎純函式（Phase 10 T2）
// 手算對數案例：.planning/phases/10-portfolio-history/10-PLAN.md Case 1/1b/2/3/3b。
// 鐵則：等比量一律「乘先除後」；美股 USD 金額入帳前一律 round2；台股整數金額不動 rounding。
import { PortfolioItem, RealizedTrade } from '../types';
import { isTwStock, calcTwSellFeeAndTax, calcUsFee } from './portfolioFees';

export interface SellInput {
  sharesSold: number;
  sellPrice: number;   // 成交單價（市場幣別：TW=TWD、US=USD）
  sellDate: string;    // 'YYYY-MM-DD'
}

export interface SellResult {
  trade: RealizedTrade;
  updatedLot: PortfolioItem | null;  // null＝全數賣出，呼叫端刪除該批
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

// 本地日期組字串——禁用 toISOString()（260612-pdz 時區教訓）
export const todayLocalStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 賣出一批持股：算費稅與已實現損益、等比縮減批次（含股利守恆移轉 divCarried）。
 * @param usdTwdRate 僅美股「TWD 計價成本」或「TWD 計價股利>0」時必要；缺失時拋錯（UI 應先擋）
 */
export const buildSellResult = (
  lot: PortfolioItem,
  input: SellInput,
  usdTwdRate?: number,
): SellResult => {
  const { sharesSold, sellPrice, sellDate } = input;

  if (!(sharesSold > 0)) throw new Error('賣出股數必須大於 0');
  if (sharesSold > lot.totalShares) throw new Error(`賣出股數不可超過持有股數（${lot.totalShares}）`);
  if (!(sellPrice > 0)) throw new Error('賣出單價必須大於 0');
  if (!DATE_RE.test(sellDate)) throw new Error('賣出日期格式須為 YYYY-MM-DD');
  if (sellDate > todayLocalStr()) throw new Error('賣出日期不可晚於今天');

  const market: 'TW' | 'US' = isTwStock(lot.symbol) ? 'TW' : 'US';
  const ratio = { num: sharesSold, den: lot.totalShares };   // 乘先除後：(x × num) / den
  const scale = (x: number) => (x * ratio.num) / ratio.den;
  const isFullSell = sharesSold === lot.totalShares;
  const rawGross = sellPrice * sharesSold;

  let trade: RealizedTrade;
  let updatedLot: PortfolioItem | null;

  if (market === 'TW') {
    const { sellFee, tax } = calcTwSellFeeAndTax(rawGross, lot.symbol);
    const costBasis = scale(lot.totalCost);
    const divCarried = scale(lot.cashDividends);
    trade = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      lotId: lot.id,
      symbol: lot.symbol,
      market,
      sellDate,
      sharesSold,
      sellPrice,
      grossProceeds: rawGross,
      sellFee,
      sellTax: tax,
      costBasis,
      realizedPnl: rawGross - sellFee - tax - costBasis,
      divCarried,
      currency: 'TWD',
      createdAt: Date.now(),
    };
    updatedLot = isFullSell ? null : {
      ...lot,
      totalShares: lot.totalShares - sharesSold,
      totalCost: lot.totalCost - costBasis,
      cashDividends: lot.cashDividends - divCarried,
      ...(lot.buyFee !== undefined ? { buyFee: lot.buyFee - scale(lot.buyFee) } : {}),
    };
  } else {
    // 美股：帳本一律 USD。成本基礎三路——USD 購入直接用 totalCostUSD；
    // TWD 購入（undefined 向下相容）需以即時匯率換算（沿表格 itemCostInDisplay 語意）。
    const isUsdPurchase = lot.purchaseCurrency === 'USD';
    const needRateForCost = !isUsdPurchase;
    const needRateForDiv = lot.cashDividends > 0;  // 美股股利以 TWD 計價儲存（UsGroupTable 語意）
    if ((needRateForCost || needRateForDiv) && !(usdTwdRate && usdTwdRate > 0)) {
      throw new Error('USD/TWD 匯率不可得，無法計算美股成本／股利換算，請先更新報價');
    }
    const gross = round2(rawGross);
    const sellFee = round2(calcUsFee(rawGross, lot.isUsEtf ?? false));
    // 批次縮減用「原幣」量；帳本欄位用 USD
    const costNative = isUsdPurchase ? scale(lot.totalCostUSD ?? 0) : scale(lot.totalCost);
    const costBasisUsd = isUsdPurchase ? round2(costNative) : round2(costNative / usdTwdRate!);
    const divNativeTwd = scale(lot.cashDividends);
    const divCarriedUsd = lot.cashDividends > 0 ? round2(divNativeTwd / usdTwdRate!) : 0;
    trade = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      lotId: lot.id,
      symbol: lot.symbol,
      market,
      sellDate,
      sharesSold,
      sellPrice,
      grossProceeds: gross,
      sellFee,
      sellTax: 0,
      costBasis: costBasisUsd,
      realizedPnl: round2(gross - sellFee - costBasisUsd),
      divCarried: divCarriedUsd,
      currency: 'USD',
      ...(needRateForCost || needRateForDiv ? { usdTwdRateUsed: usdTwdRate } : {}),
      createdAt: Date.now(),
    };
    updatedLot = isFullSell ? null : {
      ...lot,
      totalShares: lot.totalShares - sharesSold,
      ...(isUsdPurchase
        ? { totalCostUSD: (lot.totalCostUSD ?? 0) - costNative }
        : { totalCost: lot.totalCost - costNative }),
      cashDividends: lot.cashDividends - divNativeTwd,
      ...(lot.buyFee !== undefined ? { buyFee: lot.buyFee - scale(lot.buyFee) } : {}),
    };
  }
  return { trade, updatedLot };
};
