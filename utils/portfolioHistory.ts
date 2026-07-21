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

// ── S6：圖表序列（渲染期組合，含息開關在此收斂）────────────────────────────

export interface ChartPoint {
  date: string;
  unrealized: number;    // 依 includeDividend 決定是否含持有側股利
  realizedCum: number;   // 帳本累計：Σ(realizedPnl + divCarried)，sellDate ≤ date
  total: number;         // unrealized + realizedCum
  source: 'live' | 'backfill';
}

export const buildChartSeries = (
  rows: DailyPnlSnapshot[],
  trades: RealizedTrade[],
  market: 'TW' | 'US',
  includeDividend: boolean,
): ChartPoint[] => {
  const marketRows = rows.filter(r => r.market === market)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const marketTrades = trades.filter(t => t.market === market)
    .sort((a, b) => (a.sellDate < b.sellDate ? -1 : a.sellDate > b.sellDate ? 1 : 0));
  const isUs = market === 'US';
  let ti = 0;
  let cum = 0;
  return marketRows.map(r => {
    while (ti < marketTrades.length && marketTrades[ti].sellDate <= r.date) {
      cum += marketTrades[ti].realizedPnl + marketTrades[ti].divCarried;
      ti++;
    }
    const base = r.marketValue - r.totalCost - r.estSellCosts;
    const unrealized = includeDividend ? base + r.cashDividends : base;
    const point: ChartPoint = {
      date: r.date,
      unrealized: isUs ? round2(unrealized) : unrealized,
      realizedCum: isUs ? round2(cum) : cum,
      total: isUs ? round2(unrealized + cum) : unrealized + cum,
      source: r.source,
    };
    return point;
  });
};
