// utils/dividendEstimator.ts — 依交易流水與除權息公告推算歷史配息（Phase 11 追加，純函式）
//
// 為什麼需要：券商的「交易對帳單」不含配息（配息屬股務、非交易），使用者的高股息 ETF
// 帳上只看得到價差虧損，實際報酬被嚴重低估。本模組用公開的除權息公告（FinMind
// TaiwanStockDividend）配合完整交易流水，反推每次除息時的持股，算出應得配息。
//
// 語意界定（重要）：
// - 權利判定用「除息交易日」——**該日當天買進不享權**，故以 date < exDate 的交易淨持股為準。
// - 產生的配息紀錄日期用「除息日」而非「發放日」：除息當天股價已扣除股利，若不同步認列
//   股利，損益曲線會出現假性下跌。
// - 金額為**稅前**，未扣二代健保補充保費與所得稅（呼叫端須向使用者揭露）。
// - 只處理現金股利；股票股利（配股）會改變股數，本模組不處理，另行回報供人工確認。
import { StoredTxn } from './txnStore';

/** FinMind TaiwanStockDividend 的必要欄位 */
export interface DividendAnnouncement {
  stock_id: string;
  date: string;                        // 公告基準日
  CashEarningsDistribution: number;    // 每股現金股利
  CashExDividendTradingDate?: string;  // 除息交易日
  StockEarningsDistribution?: number;  // 每股股票股利（配股）
  StockExDividendTradingDate?: string; // 除權交易日
  CashDividendPaymentDate?: string;    // 現金股利發放日
}

export interface EstimatedDividend {
  symbol: string;
  exDate: string;        // 除息交易日
  payDate?: string;      // 發放日（僅供顯示）
  sharesHeld: number;    // 除息時持股
  perShare: number;      // 每股現金股利
  amount: number;        // 配息總額（稅前，台股取整數元）
}

export interface StockDividendNote {
  symbol: string;
  exDate: string;
  perShare: number;      // 每股配股數
  sharesHeld: number;
}

export interface EstimateResult {
  dividends: EstimatedDividend[];
  stockDividendNotes: StockDividendNote[];   // 配股：需人工處理（會改變股數）
  skipped: { symbol: string; reason: string }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 某日「開盤前」的持股：只計 date < asOfDate 的交易（除息日當天買進不享權） */
export const sharesBefore = (txns: StoredTxn[], symbol: string, asOfDate: string): number => {
  let shares = 0;
  for (const t of txns) {
    if (t.symbol !== symbol || t.date >= asOfDate) continue;
    if (t.kind === 'buy') shares += t.shares;
    else if (t.kind === 'sell') shares -= t.shares;
  }
  return shares > 0 ? shares : 0;
};

/**
 * 依公告推算配息。
 * @param txns   完整交易流水（該市場）
 * @param annsBySymbol 各代號的除權息公告
 */
export const estimateDividends = (
  txns: StoredTxn[],
  annsBySymbol: Record<string, DividendAnnouncement[]>,
): EstimateResult => {
  const dividends: EstimatedDividend[] = [];
  const stockDividendNotes: StockDividendNote[] = [];
  const skipped: { symbol: string; reason: string }[] = [];
  const buyTxns = txns.filter(t => t.kind === 'buy');

  for (const [symbol, anns] of Object.entries(annsBySymbol)) {
    if (!anns || anns.length === 0) continue;
    const firstBuy = buyTxns
      .filter(t => t.symbol === symbol)
      .reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
    if (!firstBuy) continue;   // 從未持有過

    for (const a of anns) {
      const exDate = (a.CashExDividendTradingDate || '').trim();
      const cash = Number(a.CashEarningsDistribution) || 0;
      const stock = Number(a.StockEarningsDistribution) || 0;
      const stockExDate = (a.StockExDividendTradingDate || '').trim();

      // 配股另行回報（會改變股數，不能只當現金處理）
      if (stock > 0 && DATE_RE.test(stockExDate) && stockExDate > firstBuy) {
        const held = sharesBefore(txns, symbol, stockExDate);
        if (held > 0) stockDividendNotes.push({ symbol, exDate: stockExDate, perShare: stock, sharesHeld: held });
      }

      if (cash <= 0) continue;
      if (!DATE_RE.test(exDate)) {
        skipped.push({ symbol, reason: `${a.date} 公告缺除息交易日，無法判定權利歸屬` });
        continue;
      }
      if (exDate <= firstBuy) continue;            // 買進前的配息與使用者無關

      const held = sharesBefore(txns, symbol, exDate);
      if (held <= 0) continue;                     // 除息時未持有

      dividends.push({
        symbol,
        exDate,
        payDate: (a.CashDividendPaymentDate || '').trim() || undefined,
        sharesHeld: held,
        perShare: cash,
        amount: Math.round(held * cash),           // 台股配息以元計
      });
    }
  }

  dividends.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : a.symbol < b.symbol ? -1 : 1));
  return { dividends, stockDividendNotes, skipped };
};

/** 轉成交易流水（kind='dividend'），key 具冪等性：重複估算不會重複累加 */
export const toDividendTxns = (list: EstimatedDividend[], market: 'TW' | 'US' = 'TW'): StoredTxn[] =>
  list.map(d => ({
    date: d.exDate,
    symbol: d.symbol,
    name: d.symbol,
    market,
    kind: 'dividend' as const,
    shares: d.sharesHeld,
    price: d.perShare,
    gross: d.amount,
    fee: 0,
    tax: 0,
    source: 'import' as const,
    key: `div|${market}|${d.symbol}|${d.exDate}`,
  }));

/** 到某日為止的累計配息（含已清倉部位——現金已入袋，不因賣股消失） */
export const dividendCumUpTo = (txns: StoredTxn[], market: 'TW' | 'US', date: string): number => {
  let sum = 0;
  for (const t of txns) {
    if (t.kind !== 'dividend' || t.market !== market || t.date > date) continue;
    sum += t.market === 'US' ? (t.netTwd ?? t.gross) : t.gross;
  }
  return sum;
};
