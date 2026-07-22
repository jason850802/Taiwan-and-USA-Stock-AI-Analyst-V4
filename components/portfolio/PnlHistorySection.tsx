// components/portfolio/PnlHistorySection.tsx — 歷史損益區塊編排（Phase 10 T6）
// 兩張圖（台股 TWD／美股 USD，D-04 不換匯）＋回推按鈕（3-worker 游標池，D-09 手動觸發）
// ＋進度＋無買進日期批次提示＋空狀態階梯。快照資料源＝localStorage（historyTick 通知重讀）。
import React, { useMemo, useState } from 'react';
import { PortfolioItem, RealizedTrade } from '../../types';
import { getStockData } from '../../services/yahoo';
import { isTwStock } from '../../utils/portfolioFees';
import {
  buildBackfillRows, buildBackfillFromTxns, buildChartSeries, upsertSnapshots,
  BackfillLotInput, TxnForBackfill,
} from '../../utils/portfolioHistory';
import { loadSnapshots, saveSnapshots } from '../../utils/portfolioHistoryStore';
import { loadTxns } from '../../utils/txnStore';
import { getCachedSeries, putCachedSeriesMany } from '../../utils/closeSeriesCache';
import Card from '../ui/Card';
import PnlHistoryChart from './PnlHistoryChart';
import { History, Loader2 } from 'lucide-react';

interface PnlHistorySectionProps {
  items: PortfolioItem[];
  realizedTrades: RealizedTrade[];
  includeDividend: boolean;
  usdTwdRate: number;    // 0＝不可得
  historyTick: number;   // live 快照落地通知（Portfolio 的 debounced effect bump）
}

type Market = 'TW' | 'US';
interface BackfillState {
  running: boolean; done: number; total: number; error: string | null;
  retrying?: number;   // 待重試檔數（限流退避中）
  waitSec?: number;    // 退避等待秒數
}
const IDLE: BackfillState = { running: false, done: 0, total: 0, error: null };

/** 進度文字：一般抓取 vs 限流退避等待 */
const progressLabel = (st: BackfillState): string =>
  st.waitSec ? `限流中，${st.waitSec} 秒後重試 ${st.retrying} 檔…`
    : st.retrying ? `重試 ${st.retrying} 檔…`
      : `回推中 ${st.done}/${st.total} 檔…`;

const PnlHistorySection: React.FC<PnlHistorySectionProps> = ({
  items, realizedTrades, includeDividend, usdTwdRate, historyTick,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  const [bfState, setBfState] = useState<Record<Market, BackfillState>>({ TW: IDLE, US: IDLE });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => loadSnapshots(), [historyTick, refreshTick]);

  const runBackfill = async (market: Market) => {
    const mLots = items.filter(i => (market === 'TW') === isTwStock(i.symbol));
    const datedLots = mLots.filter(l => !!l.buyDate);
    // 有交易流水時以流水為準（可含已清倉部位）；沒有流水才退回「現存持股逆推」
    const allTxns = loadTxns().filter(t => t.market === market);
    const useTxnMode = allTxns.length > 0;
    if (!useTxnMode && datedLots.length === 0) return;
    if (bfState[market].running) return;

    const rate = usdTwdRate > 0 ? usdTwdRate : undefined;
    if (market === 'US') {
      // D-10：TWD 計價成本/股利需以當下匯率換 USD；匯率不可得就不啟動（不用 fallback 32 造史料）
      const needRate = datedLots.some(l => l.purchaseCurrency !== 'USD' || l.cashDividends > 0);
      if (needRate && !rate) {
        setBfState(s => ({ ...s, [market]: { ...IDLE, error: 'USD/TWD 匯率不可得，請先按「更新報價」再回推' } }));
        return;
      }
    }

    const symbols = useTxnMode
      ? [...new Set(allTxns.map(t => t.symbol))]           // 含已清倉部位（完整歷史）
      : [...new Set(datedLots.map(l => l.symbol))];
    setBfState(s => ({ ...s, [market]: { running: true, done: 0, total: symbols.length, error: null } }));

    // 併發游標池（沿批次健檢先例）。台股每檔會連帶抓籌碼三件套，
    // 檔數多時容易觸及後端 marketPerMin=60 → 失敗批次自動退避重試，
    // 不讓整輪（可能已跑數分鐘）因少數 429 全數作廢。
    const closeSeries: Record<string, { date: string; close: number }[]> = {};
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const firstTxnDate = allTxns.length > 0
      ? allTxns.reduce((m, t) => (t.date < m ? t.date : m), allTxns[0].date)
      : undefined;

    // 歷史收盤價是不變的事實 → 先吃快取，只有沒快取／過期的才打網路（大幅降低 429 機率）
    const toFetch: string[] = [];
    for (const sym of symbols) {
      const cached = getCachedSeries(sym);
      if (cached && cached.length > 0) closeSeries[sym] = cached;
      else toFetch.push(sym);
    }
    setBfState(s => ({ ...s, [market]: { ...s[market], done: symbols.length - toFetch.length } }));

    // 記錄最後一個錯誤，用來區分「限流」與「後端掛掉」——兩者的處置完全不同
    let lastError = '';
    const freshlyFetched: { symbol: string; bars: { date: string; close: number }[] }[] = [];
    const fetchBatch = async (list: string[], workers: number): Promise<string[]> => {
      const missed: string[] = [];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(workers, list.length) }, async () => {
        while (cursor < list.length) {
          const sym = list[cursor++];
          try {
            const { data } = await getStockData(sym, '1d');
            const bars = data
              .filter(d => d.close !== null && d.close !== undefined)
              .map(d => ({ date: d.date, close: d.close as number }));
            closeSeries[sym] = bars;
            freshlyFetched.push({ symbol: sym, bars });   // 收集後批次寫入，避免逐檔序列化整份快取
          } catch (e: any) {
            lastError = String(e?.message ?? e ?? '');
            missed.push(sym);
          }
          setBfState(s => ({ ...s, [market]: { ...s[market], done: Math.min(s[market].done + 1, s[market].total) } }));
        }
      }));
      return missed;
    };
    const diagnose = (): string => {
      if (/429|too many|限流/i.test(lastError)) return '（被行情來源限流）請等幾分鐘再按一次重算';
      if (/5\d\d|internal|failed to fetch|networkerror/i.test(lastError)) {
        return '（行情服務目前無回應，多半是本機後端未啟動或已中斷）請確認後端服務正常後再重算';
      }
      return lastError ? `（${lastError.slice(0, 60)}）` : '（原因不明）請稍後再試';
    };

    let pending = await fetchBatch(toFetch, 3);
    // 重試兩輪：降併發並拉長等待，讓限流視窗（每分鐘）先過去
    for (let round = 0; round < 2 && pending.length > 0; round++) {
      setBfState(s => ({ ...s, [market]: { ...s[market], retrying: pending.length, waitSec: 45 } }));
      await sleep(45000);
      setBfState(s => ({ ...s, [market]: { ...s[market], retrying: pending.length, waitSec: 0, done: Math.max(0, s[market].total - pending.length) } }));
      pending = await fetchBatch(pending, 1);
    }

    putCachedSeriesMany(freshlyFetched, firstTxnDate);   // 一次寫入本輪抓到的全部序列

    const failed = pending;
    if (failed.length > 0) {
      const shown = failed.slice(0, 6).join('、') + (failed.length > 6 ? ` 等 ${failed.length} 檔` : '');
      setBfState(s => ({ ...s, [market]: { ...IDLE, error: `${shown} 行情抓取失敗，已自動重試 2 次 ${diagnose()}` } }));
      return;
    }

    // chart 幣別的批次現值（TW=TWD；US：USD 購入取 totalCostUSD、TWD 購入以當下匯率換算）
    const lotsInput: BackfillLotInput[] = mLots.map(l => {
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
    });

    const existing = loadSnapshots();
    const liveDates = existing.filter(r => r.market === market && r.source === 'live').map(r => r.date).sort();
    const bfRows = useTxnMode
      ? buildBackfillFromTxns({
          market,
          // 流水金額本就是市場幣別（TW=TWD、US=USD，解析器保證），無需換算。
          // 例外：美股配息在帳單上是「應收台幣」，須換成 USD 才與同列其他欄位同幣別
          // （對齊 computeLiveSnapshot 對 cashDividends 的 /rate 處理）。
          txns: allTxns.map((t): TxnForBackfill => ({
            date: t.date, symbol: t.symbol, market: t.market, kind: t.kind,
            shares: t.shares, gross: t.gross, fee: t.fee, tax: t.tax,
            divAmount: t.kind !== 'dividend'
              ? undefined
              : t.market === 'US'
                ? (rate ? (t.netTwd ?? 0) / rate : 0)
                : t.gross,
          })),
          closeSeries,
          boundaryDate: liveDates[0],
          usdTwdRate: market === 'US' ? rate : undefined,
          capturedAt: Date.now(),
        })
      : buildBackfillRows({
          market,
          lots: lotsInput,
          closeSeries,
          trades: realizedTrades.filter(t => t.market === market),
          boundaryDate: liveDates[0],   // 回推只填第一筆 live 之前（D-08）
          usdTwdRate: market === 'US' ? rate : undefined,
          capturedAt: Date.now(),
        }).rows;
    // 重算語意：先清該市場全部 backfill 再寫入（backfill 永不覆蓋 live）
    const cleaned = existing.filter(r => !(r.market === market && r.source === 'backfill'));
    saveSnapshots(upsertSnapshots(cleaned, bfRows));
    setBfState(s => ({ ...s, [market]: { ...IDLE, done: symbols.length, total: symbols.length } }));
    setRefreshTick(t => t + 1);
  };

  const renderMarket = (market: Market) => {
    const mLots = items.filter(i => (market === 'TW') === isTwStock(i.symbol));
    const mRows = rows.filter(r => r.market === market);
    if (mLots.length === 0 && mRows.length === 0) return null;

    const points = buildChartSeries(rows, realizedTrades, market, includeDividend);
    const datedLots = mLots.filter(l => !!l.buyDate);
    const undatedLots = mLots.filter(l => !l.buyDate);
    const hasBackfill = mRows.some(r => r.source === 'backfill');
    const st = bfState[market];
    const title = market === 'TW' ? '台股損益歷史（TWD）' : '美股損益歷史（USD）';

    return (
      <Card key={market} title={title}>
        {points.length > 0 ? (
          <div className="space-y-2">
            <PnlHistoryChart currency={market === 'TW' ? 'TWD' : 'USD'} points={points} />
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {datedLots.length > 0 && (
                <button onClick={() => runBackfill(market)} disabled={st.running}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-ctl border border-surface-line text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50">
                  {st.running ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                  {st.running ? progressLabel(st) : (hasBackfill ? '重算歷史回推' : '建立歷史曲線（回推）')}
                </button>
              )}
              {undatedLots.length > 0 && (
                <span className="text-amber-300/80">
                  {undatedLots.length} 筆持股未填買進日期，回推曲線未包含（點明細列的日期欄補填）
                </span>
              )}
              {st.error && <span className="text-danger">{st.error}</span>}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center space-y-3">
            {datedLots.length > 0 ? (
              <>
                <p className="text-sm text-slate-500">尚無歷史資料——用歷史股價回推建立這個市場的損益曲線</p>
                <button onClick={() => runBackfill(market)} disabled={st.running}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-ctl bg-accent text-white text-sm font-bold hover:bg-accent/80 transition-colors disabled:opacity-50">
                  {st.running ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                  {st.running ? progressLabel(st) : '建立歷史曲線'}
                </button>
                {st.error && <p className="text-danger text-xs">{st.error}</p>}
              </>
            ) : mLots.length > 0 ? (
              <p className="text-sm text-slate-500">
                持股尚未填「買進日期」——點各批明細列的日期欄補填後，即可回推歷史損益；
                每日開啟 App 也會自動累積當日快照。
              </p>
            ) : (
              <p className="text-sm text-slate-500">此市場目前無持股；歷史快照將於新增持股後開始累積。</p>
            )}
          </div>
        )}
      </Card>
    );
  };

  const tw = renderMarket('TW');
  const us = renderMarket('US');
  if (!tw && !us) return null;
  return <>{tw}{us}</>;
};

export default PnlHistorySection;
