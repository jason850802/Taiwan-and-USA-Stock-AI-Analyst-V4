// config/twFeeRates.ts — 台股費率／稅率設定（唯一事實來源）
//
// 這裡只放「會隨法規/券商調整的數字」；計算式與 rounding（floor、最低 1 元）
// 留在 utils/portfolioFees.ts，不要搬過來——rounding 屬於行為，不屬於設定。
//
// 改這裡等於改動所有台股費稅試算（賣出試算、手動賣出的已實現損益、統計卡／明細表的
// 預估賣出成本、歷史回推的 estSellCosts）。對帳單匯入不受影響——那條路一律取帳單
// 實付數字、不重算（D-06）。
// 這些數字被 utils/portfolioFees.test.ts 的手算對數案例釘死（行為鎖）：任何數字一動，
// 測試必紅。紅燈是護欄，不是要你去改測試——本專案紅線「既有測試案例零修改」，
// 禁止為了轉綠自行更新既有期望值。法定費率／稅率真的調整時，一律先停下來交使用者
// 裁決，拍板後才連同行為鎖一起更新（見 CORE_RULES.md 的 gate 規則）。
import type { TwStockType } from '../utils/portfolioFees';

/**
 * 券商手續費率（買、賣同一費率）。
 * 實收 = max(1, floor(成交金額 × 費率))；公定 0.1425%，未計入券商折讓。
 */
export const TW_BROKERAGE_FEE_RATE = 0.001425;

/**
 * 賣出證交稅率（買進不課）。實收 = floor(成交金額 × 稅率)。
 * - stock    一般個股 0.3%
 * - etf      一般 ETF 0.1%（含槓桿型；00 開頭且非 B/C 結尾）
 * - bond-etf 債券 ETF 免稅（B＝台幣計價、C＝外幣計價）
 */
export const TW_SECURITIES_TAX_RATES: Record<TwStockType, number> = {
  stock: 0.003,
  etf: 0.001,
  'bond-etf': 0,
};

/**
 * 現股當沖的賣出證交稅率——**只適用個股**（0.3% 減半為 0.15%）。
 * 一般 ETF 維持 0.1%、債券 ETF 維持免稅：減半條文的適用對象是「股票」，
 * ETF 在證交稅上屬受益憑證，不在射程內（ADR-0003 決策 3）。
 *
 * 租稅優惠有期限，現行至 2027-12-31。**程式刻意不做日期閘門**（ADR-0003 決策 5）：
 * 這條優惠歷次都在到期前延長，寫死日期一旦遇上延長，App 會無聲地多課一倍稅；
 * 反方向（真的落日了）則有賣出視窗的手動覆寫可即時補救。期限到期時由使用者裁決。
 */
export const TW_DAY_TRADE_STOCK_TAX_RATE = 0.0015;
