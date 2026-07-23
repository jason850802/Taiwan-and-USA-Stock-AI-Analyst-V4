// utils/backfillPipeline.ts — 歷史回推的編排層（Phase 12 T4）
//
// 為什麼要有這一層：回推的編排（快取先行 → 併發抓 → 限流退避重試 → 批次寫快取 →
// 選模式建列）原本整段長在 PnlHistorySection 的 runBackfill 裡，跟 React state 綁死，
// 一個 case 都測不到——而它正是全專案最容易出錯、跑最久（數分鐘）、失敗成本最高的一段。
//
// **seam＝注入的 ports**：正式環境接 getStockData／closeSeriesCache／真 setTimeout；
// 測試接記憶體 fake 與瞬時 sleep，於是重試政策、進度、快取命中全都測得到。
//
// 留在 UI 的（表現層閘門，刻意不收進來）：市場篩選、匯率守衛、進度 state 映射、
// 以及最後的 merge/save（cleaned → upsertSnapshots → saveSnapshots）。
//
// 行為鎖：utils/backfillPipeline.test.ts。計算本身仍是 portfolioHistory.ts 的責任，
// 本檔只搬編排、不碰計算（那兩支的行為鎖是 backfillFromTxns.test.ts／portfolioHistory.test.ts）。
import { DailyPnlSnapshot, PortfolioItem, RealizedTrade } from '../types';
import { getStockData } from '../services/yahoo';
import { DataFetchError, type FetchErrorKind } from '../services/fetchError';
import { CloseBar, getCachedSeries, putCachedSeriesMany } from './closeSeriesCache';
import {
  buildBackfillRows, buildBackfillFromTxns, BackfillLotInput, TxnForBackfill,
} from './portfolioHistory';
import { loadSnapshots } from './portfolioHistoryStore';
import type { StoredTxn } from './txnStore';
import { runWithConcurrency } from './workerPool';

export type BackfillMarket = 'TW' | 'US';

/** 抓取回來的原始日線（getStockData 的 data 子集） */
export interface DailyBar { date: string; close?: number | null }

export interface BackfillPorts {
  fetchDaily: (symbol: string) => Promise<DailyBar[]>;
  closeCache: {
    get(symbol: string): CloseBar[] | null;
    putMany(entries: { symbol: string; bars: CloseBar[] }[], fromDate?: string): void;
  };
  sleep: (ms: number) => Promise<void>;
}

export interface BackfillProgress {
  done: number;
  total: number;
  retrying?: number;   // 待重試檔數（限流退避中）
  waitSec?: number;    // 退避等待秒數
}

export interface BackfillParams {
  market: BackfillMarket;
  items: PortfolioItem[];            // 已由 UI 篩到本市場
  txns: StoredTxn[];                 // 已由 UI 篩到本市場
  realizedTrades: RealizedTrade[];   // lots 模式用；內部再依市場篩（比照原碼）
  usdTwdRate: number;                // 0＝不可得（US 的匯率守衛在 UI）
  ports?: Partial<BackfillPorts>;
  onProgress?: (p: BackfillProgress) => void;
  /**
   * 取現有快照以決定 live 邊界日。**刻意是 thunk**：必須在抓取「之後」才讀，
   * 否則長達數分鐘的抓取期間若有 live 快照落地，邊界會用到過期資料。
   */
  loadExistingSnapshots?: () => DailyPnlSnapshot[];
}

/**
 * 兩個分支都把對方的欄位列為 optional undefined——本專案 tsconfig 非 strict，
 * 少了這層聯合型別窄化不會生效，呼叫端讀 .kind／.detail 會編譯失敗。
 */
export type BackfillResult =
  | {
      ok: true;
      snapshots: DailyPnlSnapshot[];
      fetched: number;        // 本輪實際打網路抓到的檔數
      cacheHits: number;      // 吃到快取、免抓的檔數
      missedSymbols: string[];// 成功路徑恆為空
      kind?: undefined;
      detail?: undefined;
    }
  | {
      ok: false;
      kind?: FetchErrorKind | 'NO_DATA';   // 認不出來就 undefined，交由 UI 退回訊息比對
      detail: string;                      // 最後一個錯誤的原文（未經包裝）
      missedSymbols: string[];
      snapshots?: undefined;
      fetched?: undefined;
      cacheHits?: undefined;
    };

const RETRY_ROUNDS = 2;
const RETRY_WAIT_MS = 45000;
const FIRST_ROUND_WORKERS = 3;
const RETRY_WORKERS = 1;

const DEFAULT_PORTS: BackfillPorts = {
  fetchDaily: async (symbol) => (await getStockData(symbol, '1d')).data,
  closeCache: { get: getCachedSeries, putMany: putCachedSeriesMany },
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

/**
 * 跑完一個市場的歷史回推，回傳待合併的快照列（不負責存檔）。
 * 重試政策沿用既有：首輪 3 workers、失敗者再重試 2 輪各 1 worker、輪間等 45 秒。
 */
export const runBackfillPipeline = async (params: BackfillParams): Promise<BackfillResult> => {
  const { market, items, txns, realizedTrades, usdTwdRate, onProgress } = params;
  const ports: BackfillPorts = { ...DEFAULT_PORTS, ...params.ports };
  const loadExisting = params.loadExistingSnapshots ?? loadSnapshots;
  const rate = usdTwdRate > 0 ? usdTwdRate : undefined;

  const datedLots = items.filter(l => !!l.buyDate);
  // 有交易流水時以流水為準（可含已清倉部位）；沒有流水才退回「現存持股逆推」
  const useTxnMode = txns.length > 0;
  const symbols = useTxnMode
    ? [...new Set(txns.map(t => t.symbol))]           // 含已清倉部位（完整歷史）
    : [...new Set(datedLots.map(l => l.symbol))];
  if (symbols.length === 0) {
    return { ok: false, kind: 'NO_DATA', detail: '此市場沒有可回推的標的', missedSymbols: [] };
  }

  const total = symbols.length;
  const closeSeries: Record<string, CloseBar[]> = {};
  const firstTxnDate = txns.length > 0
    ? txns.reduce((m, t) => (t.date < m ? t.date : m), txns[0].date)
    : undefined;

  // 歷史收盤價是不變的事實 → 先吃快取，只有沒快取／過期的才打網路（大幅降低 429 機率）
  const toFetch: string[] = [];
  for (const sym of symbols) {
    const cached = ports.closeCache.get(sym);
    if (cached && cached.length > 0) closeSeries[sym] = cached;
    else toFetch.push(sym);
  }
  const cacheHits = total - toFetch.length;
  let done = cacheHits;
  onProgress?.({ done, total });

  // 記錄最後一個錯誤，用來區分「限流」與「後端掛掉」——兩者的處置完全不同
  let lastError: { kind?: FetchErrorKind; message: string } = { message: '' };
  const freshlyFetched: { symbol: string; bars: CloseBar[] }[] = [];

  const fetchBatch = async (list: string[], workers: number): Promise<string[]> => {
    const missed: string[] = [];
    await runWithConcurrency(list, workers, async (sym: string) => {
      const data = await ports.fetchDaily(sym);
      const bars = data
        .filter(d => d.close !== null && d.close !== undefined)
        .map(d => ({ date: d.date, close: d.close as number }));
      closeSeries[sym] = bars;
      freshlyFetched.push({ symbol: sym, bars });   // 收集後批次寫入，避免逐檔序列化整份快取
      return bars;
    }, {
      onSettled: (sym, result) => {
        if (!result.ok) {
          const e = result.error as { message?: unknown } | undefined;
          lastError = {
            kind: result.error instanceof DataFetchError ? result.error.kind : undefined,
            message: String(e?.message ?? result.error ?? ''),
          };
          missed.push(sym);
        }
        done = Math.min(done + 1, total);
        onProgress?.({ done, total });
      },
    });
    return missed;
  };

  let pending = await fetchBatch(toFetch, FIRST_ROUND_WORKERS);
  // 重試兩輪：降併發並拉長等待，讓限流視窗（每分鐘）先過去
  for (let round = 0; round < RETRY_ROUNDS && pending.length > 0; round++) {
    onProgress?.({ done, total, retrying: pending.length, waitSec: RETRY_WAIT_MS / 1000 });
    await ports.sleep(RETRY_WAIT_MS);
    done = Math.max(0, total - pending.length);
    onProgress?.({ done, total, retrying: pending.length, waitSec: 0 });
    pending = await fetchBatch(pending, RETRY_WORKERS);
  }

  ports.closeCache.putMany(freshlyFetched, firstTxnDate);   // 一次寫入本輪抓到的全部序列

  if (pending.length > 0) {
    return { ok: false, kind: lastError.kind, detail: lastError.message, missedSymbols: pending };
  }

  const existing = loadExisting();
  const liveDates = existing
    .filter(r => r.market === market && r.source === 'live')
    .map(r => r.date)
    .sort();
  const boundaryDate = liveDates[0];   // 回推只填第一筆 live 之前（D-08）

  const snapshots = useTxnMode
    ? buildBackfillFromTxns({
        market,
        // 流水金額本就是市場幣別（TW=TWD、US=USD，解析器保證），無需換算。
        // 例外：美股配息在帳單上是「應收台幣」，須換成 USD 才與同列其他欄位同幣別
        // （對齊 computeLiveSnapshot 對 cashDividends 的 /rate 處理）。
        txns: txns.map((t): TxnForBackfill => ({
          date: t.date, symbol: t.symbol, market: t.market, kind: t.kind,
          shares: t.shares, gross: t.gross, fee: t.fee, tax: t.tax,
          divAmount: t.kind !== 'dividend'
            ? undefined
            : t.market === 'US'
              ? (rate ? (t.netTwd ?? 0) / rate : 0)
              : t.gross,
        })),
        closeSeries,
        boundaryDate,
        usdTwdRate: market === 'US' ? rate : undefined,
        capturedAt: Date.now(),
      })
    : buildBackfillRows({
        market,
        // chart 幣別的批次現值（TW=TWD；US：USD 購入取 totalCostUSD、TWD 購入以當下匯率換算）
        lots: items.map((l): BackfillLotInput => {
          if (!l.buyDate) return { id: l.id, symbol: l.symbol, shares: l.totalShares, cost: 0, cashDiv: 0 };   // 交由函式排除＋回報
          if (market === 'TW') {
            return { id: l.id, symbol: l.symbol, buyDate: l.buyDate, shares: l.totalShares, cost: l.totalCost, cashDiv: l.cashDividends };
          }
          return {
            id: l.id, symbol: l.symbol, buyDate: l.buyDate, shares: l.totalShares,
            cost: l.purchaseCurrency === 'USD' ? (l.totalCostUSD ?? 0) : l.totalCost / rate!,
            cashDiv: rate ? l.cashDividends / rate : 0,
            isUsEtf: l.isUsEtf,
          };
        }),
        closeSeries,
        trades: realizedTrades.filter(t => t.market === market),
        boundaryDate,
        usdTwdRate: market === 'US' ? rate : undefined,
        capturedAt: Date.now(),
      }).rows;

  return { ok: true, snapshots, fetched: freshlyFetched.length, cacheHits, missedSymbols: [] };
};
