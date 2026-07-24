// utils/importReplay.ts — 對帳單交易重播引擎（Phase 11 T2，純函式）
// 買進 → 建 lot；賣出 → FIFO 從 lot 池（含既有庫存）扣減並產生 RealizedTrade；除息 → 加 cashDividends。
// 費用一律取帳單實數，不呼叫 App 的 calcTw*/calcUsFee 公式（D-06）。
// 手算對數案例：11-PLAN.md Case A~I。
import { PortfolioItem, RealizedTrade, ParsedTxn, ImportGap } from '../types';
import { round2 } from './portfolioLedger';

export interface ReplayInput {
  txns: ParsedTxn[];                   // 已去重、已排序（sortTxns）
  existingLots: PortfolioItem[];       // 既有庫存（會被對帳單的賣出扣減，D-08）
  gapsFilled?: ImportGap[];            // 使用者補了成本的缺口（D-02）
  now?: number;                        // 注入時鐘（測試用）
}

export interface ReplayResult {
  lots: PortfolioItem[];               // 套用後的完整庫存
  newTrades: RealizedTrade[];          // 新產生的已實現紀錄
  gaps: ImportGap[];                   // 尚未補值的缺口（賣出找不到 lot）
  applied: { buys: number; sells: number; dividends: number; skipped: number };
  notes: string[];                     // 無法處理但不致命的情況（例如除息時已無持股）
}

let seq = 0;
const genId = (now: number, prefix: string): string =>
  `${prefix}-${now.toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** 成本/損益金額：台股保留等比分割的小數，美股收斂 2 位 */
const money = (v: number, market: 'TW' | 'US'): number => (market === 'TW' ? v : round2(v));

/**
 * 把帳單上的「總額」（成交金額/手續費/交易稅）按股數分攤給某一片 slice。
 * 台股金額為整數制故取整、美股取 2 位；末筆由呼叫端以「總額 − 已分配」吃餘數，
 * 保證各片加總嚴格等於帳單金額（不漏元）。
 */
const allocate = (total: number, take: number, totalShares: number, market: 'TW' | 'US'): number => {
  const raw = (total * take) / totalShares;
  return market === 'TW' ? Math.round(raw) : round2(raw);
};

/** 前一日（本地字串運算，禁 toISOString）——缺口 lot 的預設買進日（D-13） */
export const prevDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/** lot 的成本（市場幣別）：台股用 totalCost；美股 USD 購入用 totalCostUSD */
const lotCost = (lot: PortfolioItem, market: 'TW' | 'US'): number =>
  market === 'US' && lot.purchaseCurrency === 'USD' ? (lot.totalCostUSD ?? 0) : lot.totalCost;

const setLotCost = (lot: PortfolioItem, market: 'TW' | 'US', v: number): PortfolioItem =>
  market === 'US' && lot.purchaseCurrency === 'USD'
    ? { ...lot, totalCostUSD: money(v, market) }
    : { ...lot, totalCost: money(v, market) };

/**
 * FIFO 排序鍵：buyDate 升冪；無 buyDate 視為最早（保守：先出老部位）。
 * 同日以 id 穩定排序，確保重播結果可重現。
 */
const fifoSort = (a: PortfolioItem, b: PortfolioItem): number => {
  const da = a.buyDate ?? '0000-00-00';
  const db = b.buyDate ?? '0000-00-00';
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export const replayStatement = (input: ReplayInput): ReplayResult => {
  const { txns, existingLots, gapsFilled = [], now = Date.now() } = input;
  const lots: PortfolioItem[] = existingLots.map(l => ({ ...l }));
  const newTrades: RealizedTrade[] = [];
  const gaps: ImportGap[] = [];
  const notes: string[] = [];
  const applied = { buys: 0, sells: 0, dividends: 0, skipped: 0 };

  const filledByIndex = new Map<number, ImportGap>();
  for (const g of gapsFilled) {
    if (g.costPerShare !== undefined && g.costPerShare >= 0) filledByIndex.set(g.txnIndex, g);
  }

  txns.forEach((txn, txnIndex) => {
    const { market } = txn;

    // ── 買進：建立新 lot（成本含買費，D-07）──────────────────────────
    if (txn.kind === 'buy') {
      const cost = money(txn.gross + txn.fee, market);
      const base: PortfolioItem = {
        id: genId(now, 'imp'),
        symbol: txn.symbol,
        avgCostPrice: cost / txn.shares,
        totalShares: txn.shares,
        totalCost: market === 'TW' ? cost : 0,
        brokerDiscount: 10,
        buyFee: txn.fee,
        cashDividends: 0,
        stockDividends: 0,
        buyDate: txn.date,
      };
      lots.push(market === 'US'
        ? {
            ...base, purchaseCurrency: 'USD', totalCostUSD: cost, isUsEtf: false,
            // 帳單有匯率欄就記為該批的買入匯率（成本換台幣一律用它）
            ...(txn.exchangeRate ? { exchangeRate: txn.exchangeRate } : {}),
          }
        : base);
      applied.buys++;
      return;
    }

    // ── 除息：等比加到該檔現存 lots 的 cashDividends（D-04）──────────
    if (txn.kind === 'dividend') {
      const holding = lots.filter(l => l.symbol === txn.symbol && l.totalShares > 0);
      const totalShares = holding.reduce((s, l) => s + l.totalShares, 0);
      // 美股 cashDividends 以 TWD 計價（App 既有語意）→ 取帳單應收台幣；台股取金額
      const amount = market === 'US' ? (txn.netTwd ?? 0) : txn.gross;
      if (totalShares <= 0 || amount === 0) {
        notes.push(`${txn.date} ${txn.symbol} 配息 ${amount} 無對應持股，已略過`);
        applied.skipped++;
        return;
      }
      for (const l of holding) {
        const idx = lots.indexOf(l);
        lots[idx] = { ...l, cashDividends: l.cashDividends + (amount * l.totalShares) / totalShares };
      }
      applied.dividends++;
      return;
    }

    // ── 賣出：FIFO 吃 lot 池，跨 lot 拆成多筆 trade（D-09）────────────
    let remaining = txn.shares;
    const pool = lots.filter(l => l.symbol === txn.symbol && l.totalShares > 0 && (l.buyDate ?? '0000-00-00') <= txn.date)
      .sort(fifoSort);

    // 缺口：池子不足以支應這筆賣出 → 若使用者已補成本則先造 synthetic lot
    const poolShares = pool.reduce((s, l) => s + l.totalShares, 0);
    if (poolShares < txn.shares) {
      const missing = txn.shares - poolShares;
      const filled = filledByIndex.get(txnIndex);
      if (filled?.costPerShare !== undefined) {
        const cost = money(filled.costPerShare * missing, market);
        const synth: PortfolioItem = {
          id: genId(now, 'gap'),
          symbol: txn.symbol,
          avgCostPrice: filled.costPerShare,
          totalShares: missing,
          totalCost: market === 'TW' ? cost : 0,
          brokerDiscount: 10,
          cashDividends: 0,
          stockDividends: 0,
          buyDate: filled.buyDate || prevDay(txn.date),
          ...(market === 'US' ? { purchaseCurrency: 'USD' as const, totalCostUSD: cost, isUsEtf: false } : {}),
        };
        lots.push(synth);
        pool.push(synth);
        pool.sort(fifoSort);
      } else {
        gaps.push({
          txnIndex,
          symbol: txn.symbol,
          name: txn.name,
          market,
          sellDate: txn.date,
          sharesMissing: missing,
          sellPrice: txn.price,
          buyDate: prevDay(txn.date),
        });
        applied.skipped++;
        return;   // 不猜成本：整筆賣出略過，等使用者補值後重跑
      }
    }

    // 費稅等比分攤，最後一筆吃餘數（避免 rounding 漏元）
    const slices: { lot: PortfolioItem; take: number }[] = [];
    for (const lot of pool) {
      if (remaining <= 1e-9) break;
      const take = Math.min(lot.totalShares, remaining);
      slices.push({ lot, take });
      remaining -= take;
    }
    let feeLeft = txn.fee;
    let taxLeft = txn.tax;
    let grossLeft = txn.gross;
    slices.forEach(({ lot, take }, i) => {
      const isLast = i === slices.length - 1;
      // 末筆吃餘數：保證 Σ 各片 ＝ 帳單總額（碎股時用單價重算會有精度差，故一律從總額分攤）
      const feeI = isLast ? feeLeft : allocate(txn.fee, take, txn.shares, market);
      const taxI = isLast ? taxLeft : allocate(txn.tax, take, txn.shares, market);
      const gross = isLast ? grossLeft : allocate(txn.gross, take, txn.shares, market);
      if (!isLast) { feeLeft -= feeI; taxLeft -= taxI; grossLeft -= gross; }

      const lotIdx = lots.indexOf(lot);
      const cost = lotCost(lot, market);
      const costBasis = (cost * take) / lot.totalShares;                 // 乘先除後
      const divCarried = (lot.cashDividends * take) / lot.totalShares;   // Phase 10 股利守恆
      const pnl = money(gross - feeI - taxI - costBasis, market);

      newTrades.push({
        id: genId(now, 'imt'),
        lotId: lot.id,
        symbol: txn.symbol,
        market,
        sellDate: txn.date,
        sharesSold: take,
        sellPrice: txn.price,
        grossProceeds: gross,
        sellFee: feeI,
        sellTax: taxI,
        costBasis: money(costBasis, market),
        realizedPnl: pnl,
        divCarried: money(divCarried, market),
        currency: market === 'TW' ? 'TWD' : 'USD',
        ...(market === 'US' && lot.exchangeRate ? { buyExchangeRate: lot.exchangeRate } : {}),
        ...(market === 'US' && txn.exchangeRate ? { sellExchangeRate: txn.exchangeRate } : {}),
        createdAt: now,
      });

      // 縮減或移除來源 lot（等比，與 Phase 10 buildSellResult 同語意）
      const leftShares = lot.totalShares - take;
      if (leftShares <= 1e-9) {
        lots[lotIdx] = { ...lot, totalShares: 0 };                       // 標記待清除
      } else {
        const shrunk = setLotCost(lot, market, cost - costBasis);
        lots[lotIdx] = {
          ...shrunk,
          totalShares: leftShares,
          cashDividends: lot.cashDividends - divCarried,
          ...(lot.buyFee !== undefined ? { buyFee: lot.buyFee - (lot.buyFee * take) / lot.totalShares } : {}),
        };
      }
    });
    applied.sells++;
  });

  return {
    lots: lots.filter(l => l.totalShares > 1e-9),   // 清掉全數賣出的 lot
    newTrades,
    gaps,
    applied,
    notes,
  };
};
