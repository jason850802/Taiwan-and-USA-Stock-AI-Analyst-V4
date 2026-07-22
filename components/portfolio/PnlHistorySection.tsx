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
interface BackfillState { running: boolean; done: number; total: number; error: string | null }
const IDLE: BackfillState = { running: false, done: 0, total: 0, error: null };

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

    // 3-worker 游標池（沿批次健檢先例；避免打爆 marketPerMin 限流）
    const closeSeries: Record<string, { date: string; close: number }[]> = {};
    const failed: string[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, symbols.length) }, async () => {
      while (cursor < symbols.length) {
        const sym = symbols[cursor++];
        try {
          const { data } = await getStockData(sym, '1d');
          closeSeries[sym] = data
            .filter(d => d.close !== null && d.close !== undefined)
            .map(d => ({ date: d.date, close: d.close as number }));
        } catch {
          failed.push(sym);
        }
        setBfState(s => ({ ...s, [market]: { ...s[market], done: s[market].done + 1 } }));
      }
    }));

    if (failed.length > 0) {
      setBfState(s => ({ ...s, [market]: { ...IDLE, error: `${failed.join('、')} 行情抓取失敗（可能限流 429），稍後再試` } }));
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
          txns: allTxns.map((t): TxnForBackfill => {
            // US 的金額換算成 USD（TWD 計價批次沿 D-10 用當下匯率）
            const conv = (v: number) => (market === 'US' && rate ? v : v);
            return {
              date: t.date, symbol: t.symbol, market: t.market, kind: t.kind,
              shares: t.shares, gross: conv(t.gross), fee: conv(t.fee), tax: conv(t.tax),
              divAmount: t.kind === 'dividend' ? (t.market === 'US' ? (t.netTwd ?? 0) : t.gross) : undefined,
            };
          }),
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
                  {st.running ? `回推中 ${st.done}/${st.total} 檔…` : (hasBackfill ? '重算歷史回推' : '建立歷史曲線（回推）')}
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
                  {st.running ? `回推中 ${st.done}/${st.total} 檔…` : '建立歷史曲線'}
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
