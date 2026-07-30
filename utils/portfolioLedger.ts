// utils/portfolioLedger.ts — 賣出引擎純函式（Phase 10 T2）
// 手算對數案例：.planning/phases/10-portfolio-history/10-PLAN.md Case 1/1b/2/3/3b。
// 鐵則：等比量一律「乘先除後」；美股 USD 金額入帳前一律 round2；台股整數金額不動 rounding。
import { PortfolioItem, RealizedTrade } from '../types';
import { isTwStock, getTwStockType, calcTwSellFeeAndTax, calcUsFee } from './portfolioFees';

export interface SellInput {
  sharesSold: number;
  sellPrice: number;   // 成交單價（市場幣別：TW=TWD、US=USD）
  sellDate: string;    // 'YYYY-MM-DD'
  /**
   * 現股當沖覆寫（三態）：undefined＝請引擎用 assessDayTrade 自動判定；
   * true／false＝使用者在賣出視窗手動指定。硬閘不過時會被夾制回 false（見下）。
   */
  isDayTrade?: boolean;
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

// ── 現股當沖判定（ADR-0003）────────────────────────────────────────────────
/** 判定結果的理由代碼。**代碼不含文案**——顯示字串由 UI 映射，純函式不持有 UI 文字。 */
export type DayTradeReason =
  | 'eligible'
  | 'not-tw-stock'
  | 'etf-not-eligible'
  | 'odd-lot-sell'
  | 'odd-lot-holding'
  | 'date-mismatch'
  | 'no-buy-date';

export interface DayTradeAssessment {
  eligible: boolean;
  reason: DayTradeReason;
}

/** 一張＝1000 股；非整數倍即零股，零股交易不得當沖 */
const TW_LOT_SIZE = 1000;
const isRoundLot = (shares: number): boolean =>
  Number.isFinite(shares) && shares > 0 && shares % TW_LOT_SIZE === 0;

/**
 * 硬閘：這三種理由**永遠不可覆寫成 true**（引擎夾制與賣出視窗停用勾選框共用這一份）。
 * 零股賣單現實中不可能沖銷，而賣出股數是此刻親手輸入的事實（沒有「資料舊了」的藉口）；
 * ETF 不在減半條文射程；美股無證交稅。其餘（no-buy-date／date-mismatch／odd-lot-holding）
 * 都是**軟閘**——那些是儲存的中繼資料，可能沒填或填錯，使用者有權更正。
 */
export const DAY_TRADE_HARD_GATE_REASONS: readonly DayTradeReason[] = ['not-tw-stock', 'etf-not-eligible', 'odd-lot-sell'];

/**
 * 判定一筆賣出是否為現股當沖。**不吃價格**——判定不依賴價格，
 * UI 在價格欄空白／報價缺失時也要能畫出勾選框與理由。
 *
 * 判準（全部成立才 eligible）：台股個股 ∧ 賣出股數為 1000 整數倍 ∧
 * 該批持有股數為 1000 整數倍 ∧ 該批買進日＝賣出日。
 *
 * 檢查順序即 reason 的優先序（硬閘先於軟閘），UI 據此顯示唯一一條理由。
 * 註：判準裡沒有「09:00–13:30」——全專案沒有任何交易時間資料，
 * 實務上以「雙邊整張」近似（ADR-0003 決策 2）。
 */
export const assessDayTrade = (
  lot: PortfolioItem,
  sharesSold: number,
  sellDate: string,
): DayTradeAssessment => {
  if (!isTwStock(lot.symbol)) return { eligible: false, reason: 'not-tw-stock' };
  if (getTwStockType(lot.symbol) !== 'stock') return { eligible: false, reason: 'etf-not-eligible' };
  if (!isRoundLot(sharesSold)) return { eligible: false, reason: 'odd-lot-sell' };
  if (!lot.buyDate) return { eligible: false, reason: 'no-buy-date' };
  if (lot.buyDate !== sellDate) return { eligible: false, reason: 'date-mismatch' };
  if (!isRoundLot(lot.totalShares)) return { eligible: false, reason: 'odd-lot-holding' };
  return { eligible: true, reason: 'eligible' };
};

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
    // 當沖有效旗標＝夾制後的（覆寫 ?? 自動判定）。硬閘不過一律強制 false，且**夾制不拋錯**——
    // 與稅率函式忽略非個股旗標同一套縱深防禦：UI 擋第一層、引擎夾第二層、稅率函式守第三層。
    const assessment = assessDayTrade(lot, sharesSold, sellDate);
    const isDayTrade = DAY_TRADE_HARD_GATE_REASONS.includes(assessment.reason)
      ? false
      : (input.isDayTrade ?? assessment.eligible);
    const { sellFee, tax } = calcTwSellFeeAndTax(rawGross, lot.symbol, isDayTrade);
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
      // 台股賣出一律留痕（true／false 都寫）；美股不寫該欄位＝三態的「不適用」
      isDayTrade,
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
    // TWD 購入且該批有記買入匯率 → 用買入匯率換算（不必等即時匯率）
    const buyRate = lot.exchangeRate && lot.exchangeRate > 0 ? lot.exchangeRate : undefined;
    const needRateForCost = !isUsdPurchase && buyRate === undefined;
    const needRateForDiv = lot.cashDividends > 0;  // 美股股利以 TWD 計價儲存（UsGroupTable 語意）
    if ((needRateForCost || needRateForDiv) && !(usdTwdRate && usdTwdRate > 0)) {
      throw new Error('USD/TWD 匯率不可得，無法計算美股成本／股利換算，請先更新報價');
    }
    const gross = round2(rawGross);
    const sellFee = round2(calcUsFee(rawGross, lot.isUsEtf ?? false));
    // 批次縮減用「原幣」量；帳本欄位用 USD
    const costNative = isUsdPurchase ? scale(lot.totalCostUSD ?? 0) : scale(lot.totalCost);
    const costBasisUsd = isUsdPurchase ? round2(costNative) : round2(costNative / (buyRate ?? usdTwdRate!));
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
      // 匯率留痕：買入匯率隨批次、賣出匯率＝成交當下的即時匯率（供台幣實現損益）
      ...(lot.exchangeRate && lot.exchangeRate > 0 ? { buyExchangeRate: lot.exchangeRate } : {}),
      ...(usdTwdRate && usdTwdRate > 0 ? { sellExchangeRate: usdTwdRate } : {}),
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
