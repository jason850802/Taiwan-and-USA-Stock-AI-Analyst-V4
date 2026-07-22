// utils/portfolioHistory.ts — 庫存歷史損益：快照聚合／upsert／as-of 逆推／回推／圖表序列（Phase 10 T3）
// 全部為純函式（時間由呼叫端以 capturedAt 傳入），行為鎖：portfolioHistory.test.ts。
// 規格：.planning/phases/10-portfolio-history/10-PLAN.md S3/S5/S6；決策 CONTEXT D-05~D-14。
import { PortfolioItem, RealizedTrade, DailyPnlSnapshot } from '../types';
import { calcTwSellFeeAndTax, calcUsFee } from './portfolioFees';
import { round2 } from './portfolioLedger';

// ── 共用小工具 ──────────────────────────────────────────────────────────────

export interface PriceInfo {
  price: number;
  date?: string;      // 該報價所屬交易日（交易所當地 'YYYY-MM-DD'）
  loading?: boolean;
  error?: boolean;
}

const usLotNeedsRate = (lot: PortfolioItem): boolean =>
  lot.purchaseCurrency !== 'USD' || lot.cashDividends > 0;

/** 美股批次成本換算成 USD（TWD 計價批次沿表格 itemCostInDisplay 語意用當下匯率，D-10） */
const usLotCostUsd = (lot: PortfolioItem, rate: number): number =>
  lot.purchaseCurrency === 'USD' ? (lot.totalCostUSD ?? 0) : lot.totalCost / rate;

// ── S3：live 快照聚合（守衛 A/B 內建，被擋回傳 null）───────────────────────

export const computeLiveSnapshot = (
  market: 'TW' | 'US',
  lots: PortfolioItem[],
  prices: Record<string, PriceInfo | undefined>,
  usdTwdRate: number | undefined,
  capturedAt: number,
): DailyPnlSnapshot | null => {
  if (lots.length === 0) return null;

  // 守衛 A（完整性）：任一 symbol 報價缺/錯/無日期 → 本輪跳過（部分報價的快照是毒資料）
  for (const lot of lots) {
    const p = prices[lot.symbol];
    if (!p || p.loading || p.error || !(p.price > 0) || !p.date) return null;
  }
  // 守衛 B（美股匯率）：需要 TWD→USD 換算而匯率不可得 → 跳過（fallback 32 禁入持久化）
  const rateNeeded = market === 'US' && lots.some(usLotNeedsRate);
  const rateOk = usdTwdRate !== undefined && usdTwdRate > 0;
  if (rateNeeded && !rateOk) return null;

  let marketValue = 0, totalCost = 0, estSellCosts = 0, cashDividends = 0;
  const symbols = new Set<string>();
  let date = '';
  for (const lot of lots) {
    const p = prices[lot.symbol]!;
    if (p.date! > date) date = p.date!;   // 快照日＝該市場最新交易日（字串比較）
    symbols.add(lot.symbol);
    const value = p.price * lot.totalShares;
    if (market === 'TW') {
      const { sellFee, tax } = calcTwSellFeeAndTax(value, lot.symbol);   // per-lot floor（對齊 StatCards）
      marketValue += value;
      totalCost += lot.totalCost;
      estSellCosts += sellFee + tax;
      cashDividends += lot.cashDividends;
    } else {
      marketValue += value;
      totalCost += usLotCostUsd(lot, rateOk ? usdTwdRate! : 1);   // rateNeeded 時上面已保證 rateOk
      estSellCosts += calcUsFee(value, lot.isUsEtf ?? false);
      cashDividends += rateOk ? lot.cashDividends / usdTwdRate! : lot.cashDividends;   // 美股股利 TWD 計價
    }
  }
  if (market === 'US') {
    marketValue = round2(marketValue);
    totalCost = round2(totalCost);
    estSellCosts = round2(estSellCosts);
    cashDividends = round2(cashDividends);
  }
  return {
    date, market, source: 'live',
    marketValue, totalCost, estSellCosts, cashDividends,
    ...(market === 'US' && rateNeeded ? { usdTwdRate } : {}),
    symbolCount: symbols.size,
    capturedAt,
  };
};

// ── S3.4：upsert 規則（僅兩條）──────────────────────────────────────────────
// live 覆蓋一切同鍵舊列；backfill 永不覆蓋既有列。回傳新陣列（依 market,date 排序）。

export const upsertSnapshots = (
  rows: DailyPnlSnapshot[],
  incoming: DailyPnlSnapshot[],
): DailyPnlSnapshot[] => {
  const byKey = new Map<string, DailyPnlSnapshot>();
  for (const r of rows) byKey.set(`${r.market}|${r.date}`, r);
  for (const r of incoming) {
    const key = `${r.market}|${r.date}`;
    if (r.source === 'live' || !byKey.has(key)) byKey.set(key, r);
  }
  return [...byKey.values()].sort((a, b) =>
    a.market === b.market ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : (a.market < b.market ? -1 : 1));
};

// ── S5.4：as-of 逆推（用帳本還原賣出前的批次組成；chart 幣別）──────────────

export interface LotStateAsOf { shares: number; cost: number; cashDiv: number }

export const reconstructLotAsOf = (
  lotNow: LotStateAsOf,
  tradesForLot: RealizedTrade[],   // 同一 lotId 的帳本紀錄（欄位已是 chart 幣別）
  d: string,
): LotStateAsOf => {
  let { shares, cost, cashDiv } = lotNow;
  for (const t of tradesForLot) {
    if (t.sellDate > d) {   // 賣出日之後的日子才「還沒賣」；d==sellDate 視為已賣（與 live 快照一致）
      shares += t.sharesSold;
      cost += t.costBasis;
      cashDiv += t.divCarried;
    }
  }
  return { shares, cost, cashDiv };
};

// ── S5：回推（backfill）────────────────────────────────────────────────────

export interface BackfillLotInput {
  id: string;
  symbol: string;
  buyDate?: string;
  shares: number;    // 現持股數
  cost: number;      // 現成本（chart 幣別：TW=TWD；US 已依 D-10 換算 USD）
  cashDiv: number;   // 現現金股利累計（chart 幣別）
  isUsEtf?: boolean;
}

export interface BackfillParams {
  market: 'TW' | 'US';
  lots: BackfillLotInput[];   // 該市場全部批次（含無 buyDate，函式內排除並回報）
  closeSeries: Record<string, { date: string; close: number }[]>;   // 各 symbol 日線（升冪、raw close）
  trades: RealizedTrade[];    // 該市場帳本（chart 幣別欄位）
  boundaryDate?: string;      // 第一筆 live 快照日（exclusive：只產出 < boundary 的列）
  usdTwdRate?: number;        // US 有 TWD→USD 換算時記入列（審計）
  capturedAt: number;
}

export interface BackfillResult {
  rows: DailyPnlSnapshot[];
  excludedLots: { id: string; symbol: string; shares: number }[];
}

export const buildBackfillRows = (params: BackfillParams): BackfillResult => {
  const { market, lots, closeSeries, trades, boundaryDate, usdTwdRate, capturedAt } = params;
  const excludedLots = lots.filter(l => !l.buyDate).map(l => ({ id: l.id, symbol: l.symbol, shares: l.shares }));
  const participants = lots.filter(l => !!l.buyDate);
  if (participants.length === 0) return { rows: [], excludedLots };

  const tradesByLot = new Map<string, RealizedTrade[]>();
  for (const t of trades) {
    const arr = tradesByLot.get(t.lotId) ?? [];
    arr.push(t);
    tradesByLot.set(t.lotId, arr);
  }

  // 日期軸：參與 symbols 的 close 日期聯集，裁剪到 [min(buyDate), boundaryDate)
  const minBuyDate = participants.reduce((m, l) => (l.buyDate! < m ? l.buyDate! : m), participants[0].buyDate!);
  const dateSet = new Set<string>();
  const participantSymbols = new Set(participants.map(l => l.symbol));
  for (const sym of participantSymbols) {
    for (const bar of closeSeries[sym] ?? []) {
      if (bar.date >= minBuyDate && (!boundaryDate || bar.date < boundaryDate)) dateSet.add(bar.date);
    }
  }
  const axis = [...dateSet].sort();

  // carry-forward：每 symbol 一個游標（axis 升冪，均攤 O(n)）
  const cursor = new Map<string, { i: number; last: number | null }>();
  for (const sym of participantSymbols) cursor.set(sym, { i: 0, last: null });

  const rows: DailyPnlSnapshot[] = [];
  for (const d of axis) {
    // 推進各 symbol 游標到 ≤ d 的最後一根 close
    for (const sym of participantSymbols) {
      const c = cursor.get(sym)!;
      const series = closeSeries[sym] ?? [];
      while (c.i < series.length && series[c.i].date <= d) {
        c.last = series[c.i].close;
        c.i++;
      }
    }
    let marketValue = 0, totalCost = 0, estSellCosts = 0, cashDividends = 0;
    const activeSymbols = new Set<string>();
    for (const lot of participants) {
      if (lot.buyDate! > d) continue;                    // 尚未買進
      const close = cursor.get(lot.symbol)!.last;
      if (close === null) continue;                      // 上市/資料起點前：不 carry-backward
      const asOf = reconstructLotAsOf(
        { shares: lot.shares, cost: lot.cost, cashDiv: lot.cashDiv },
        tradesByLot.get(lot.id) ?? [], d);
      if (asOf.shares <= 0) continue;
      const value = close * asOf.shares;
      activeSymbols.add(lot.symbol);
      marketValue += value;
      totalCost += asOf.cost;
      cashDividends += asOf.cashDiv;
      if (market === 'TW') {
        const { sellFee, tax } = calcTwSellFeeAndTax(value, lot.symbol);
        estSellCosts += sellFee + tax;
      } else {
        estSellCosts += calcUsFee(value, lot.isUsEtf ?? false);
      }
    }
    if (activeSymbols.size === 0) continue;
    if (market === 'US') {
      marketValue = round2(marketValue);
      totalCost = round2(totalCost);
      estSellCosts = round2(estSellCosts);
      cashDividends = round2(cashDividends);
    }
    rows.push({
      date: d, market, source: 'backfill',
      marketValue, totalCost, estSellCosts, cashDividends,
      ...(market === 'US' && usdTwdRate !== undefined ? { usdTwdRate } : {}),
      symbolCount: activeSymbols.size,
      capturedAt,
    });
  }
  return { rows, excludedLots };
};

// ── 流水式回推（Phase 11 追加）──────────────────────────────────────────────
// buildBackfillRows 從「現存持股」逆推，完全清倉的部位其 lot 已不存在 → 整段歷史缺席。
// 本函式改以「完整買賣流水」逐日重播，重建每一天的真實持倉（含後來清倉的部位）。

export interface TxnForBackfill {
  date: string;
  symbol: string;
  market: 'TW' | 'US';
  kind: 'buy' | 'sell' | 'dividend';
  shares: number;
  gross: number;      // chart 幣別成交金額
  fee: number;
  tax: number;
  divAmount?: number; // 配息金額（TW=TWD、US 亦記 TWD，與 App 的 cashDividends 語意一致）
  isUsEtf?: boolean;
}

export interface BackfillFromTxnsParams {
  market: 'TW' | 'US';
  txns: TxnForBackfill[];                                           // 該市場流水（任意順序，函式內排序）
  closeSeries: Record<string, { date: string; close: number }[]>;
  boundaryDate?: string;                                            // 第一筆 live 快照日（exclusive）
  usdTwdRate?: number;
  capturedAt: number;
}

interface ReplayLot { shares: number; cost: number; cashDiv: number }

/**
 * 逐日重播流水產生每日快照。
 * 買進建 lot、賣出 FIFO 減 lot（清倉即從池中消失，該日之後不再計入市值）、配息累加。
 * 與 importReplay 的 FIFO 語意一致，但目的是產生「每日組成」而非已實現紀錄。
 */
export const buildBackfillFromTxns = (params: BackfillFromTxnsParams): DailyPnlSnapshot[] => {
  const { market, txns, closeSeries, boundaryDate, usdTwdRate, capturedAt } = params;
  if (txns.length === 0) return [];

  const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const firstDate = sorted[0].date;

  // 日期軸：有交易的 symbols 的 close 日期聯集，裁剪到 [首筆交易日, boundaryDate)
  const symbols = new Set(sorted.map(t => t.symbol));
  const dateSet = new Set<string>();
  for (const sym of symbols) {
    for (const bar of closeSeries[sym] ?? []) {
      if (bar.date >= firstDate && (!boundaryDate || bar.date < boundaryDate)) dateSet.add(bar.date);
    }
  }
  // 交易日本身也要在軸上（避免當日無行情資料時該筆交易被延後反映）
  for (const t of sorted) {
    if (!boundaryDate || t.date < boundaryDate) dateSet.add(t.date);
  }
  const axis = [...dateSet].sort();
  if (axis.length === 0) return [];

  const cursor = new Map<string, { i: number; last: number | null }>();
  for (const sym of symbols) cursor.set(sym, { i: 0, last: null });

  const pool = new Map<string, ReplayLot[]>();   // symbol → FIFO lot 池
  const etfFlag = new Map<string, boolean>();
  let ti = 0;
  const rows: DailyPnlSnapshot[] = [];

  for (const d of axis) {
    // 1) 套用當日（含之前）尚未處理的交易
    while (ti < sorted.length && sorted[ti].date <= d) {
      const t = sorted[ti++];
      if (t.isUsEtf !== undefined) etfFlag.set(t.symbol, t.isUsEtf);
      const lots = pool.get(t.symbol) ?? [];

      if (t.kind === 'buy') {
        lots.push({ shares: t.shares, cost: t.gross + t.fee, cashDiv: 0 });   // 成本含買費（D-07）
        pool.set(t.symbol, lots);
        continue;
      }
      if (t.kind === 'dividend') {
        // 配息不掛在 lot 上：已入袋的現金不該因為之後賣股而消失。
        // 改由 buildChartSeries 以流水累計計入「已實現」側（含已清倉部位的歷史配息）。
        continue;
      }
      // sell：FIFO 扣減（賣超部分忽略——期初部位缺口，圖上不臆測）
      let remaining = t.shares;
      while (remaining > 1e-9 && lots.length > 0) {
        const l = lots[0];
        const take = Math.min(l.shares, remaining);
        const ratio = take / l.shares;
        l.cost -= l.cost * ratio;
        l.cashDiv -= l.cashDiv * ratio;
        l.shares -= take;
        remaining -= take;
        if (l.shares <= 1e-9) lots.shift();
      }
      pool.set(t.symbol, lots);
    }

    // 2) 推進行情游標並計算當日快照
    let marketValue = 0, totalCost = 0, estSellCosts = 0, cashDividends = 0;
    const active = new Set<string>();
    for (const sym of symbols) {
      const lots = pool.get(sym);
      if (!lots || lots.length === 0) continue;
      const c = cursor.get(sym)!;
      const series = closeSeries[sym] ?? [];
      while (c.i < series.length && series[c.i].date <= d) { c.last = series[c.i].close; c.i++; }
      if (c.last === null) continue;                       // 尚無行情（上市前/資料起點前）
      const shares = lots.reduce((s, l) => s + l.shares, 0);
      if (shares <= 1e-9) continue;
      const value = c.last * shares;
      active.add(sym);
      marketValue += value;
      totalCost += lots.reduce((s, l) => s + l.cost, 0);
      cashDividends += lots.reduce((s, l) => s + l.cashDiv, 0);
      if (market === 'TW') {
        const { sellFee, tax } = calcTwSellFeeAndTax(value, sym);
        estSellCosts += sellFee + tax;
      } else {
        estSellCosts += calcUsFee(value, etfFlag.get(sym) ?? false);
      }
    }
    if (active.size === 0) continue;

    rows.push({
      date: d, market, source: 'backfill',
      marketValue: market === 'US' ? round2(marketValue) : marketValue,
      totalCost: market === 'US' ? round2(totalCost) : totalCost,
      estSellCosts: market === 'US' ? round2(estSellCosts) : estSellCosts,
      cashDividends: market === 'US' ? round2(cashDividends) : cashDividends,
      ...(market === 'US' && usdTwdRate !== undefined ? { usdTwdRate } : {}),
      symbolCount: active.size,
      capturedAt,
    });
  }
  return rows;
};

// ── S6：圖表序列（渲染期組合，含息開關在此收斂）────────────────────────────

export interface ChartPoint {
  date: string;
  unrealized: number;    // 純價差：市值 − 成本 − 預估賣出費用
  realizedCum: number;   // 已實現累計：賣出損益 ＋（含息時）累計配息
  total: number;         // unrealized + realizedCum
  source: 'live' | 'backfill';
}

/**
 * 組合圖表序列。
 *
 * 含息語意（Phase 11 修正）：配息是「已入袋的現金收入」，故計入**已實現**側，
 * 且不因之後賣股而消失。原本把配息掛在持有中 lot（未實現側）的做法有兩個錯誤——
 * 清倉後歷史配息會憑空消失，且已實現側的 divCarried 不受含息開關控制。
 *
 * @param dividends 配息流水（date/amount，市場幣別）；未提供則視同無配息
 */
export const buildChartSeries = (
  rows: DailyPnlSnapshot[],
  trades: RealizedTrade[],
  market: 'TW' | 'US',
  includeDividend: boolean,
  dividends?: { date: string; amount: number }[],
): ChartPoint[] => {
  const marketRows = rows.filter(r => r.market === market)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const marketTrades = trades.filter(t => t.market === market)
    .sort((a, b) => (a.sellDate < b.sellDate ? -1 : a.sellDate > b.sellDate ? 1 : 0));
  const divs = (dividends ?? []).slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const isUs = market === 'US';
  let ti = 0, di = 0;
  let cum = 0, divCum = 0;
  return marketRows.map(r => {
    while (ti < marketTrades.length && marketTrades[ti].sellDate <= r.date) {
      // divCarried：賣出時自 lot 移轉的手動輸入股利（與流水配息互不重疊）
      cum += marketTrades[ti].realizedPnl + marketTrades[ti].divCarried;
      ti++;
    }
    while (di < divs.length && divs[di].date <= r.date) {
      divCum += divs[di].amount;
      di++;
    }
    // 未實現＝純價差；配息一律計入已實現側（含息開關同時控制圖表與庫存表格的呈現）
    const unrealized = r.marketValue - r.totalCost - r.estSellCosts;
    const realized = includeDividend ? cum + divCum : cum;
    const point: ChartPoint = {
      date: r.date,
      unrealized: isUs ? round2(unrealized) : unrealized,
      realizedCum: isUs ? round2(realized) : realized,
      total: isUs ? round2(unrealized + realized) : unrealized + realized,
      source: r.source,
    };
    return point;
  });
};
