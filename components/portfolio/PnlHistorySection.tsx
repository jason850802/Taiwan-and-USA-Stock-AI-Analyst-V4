// components/portfolio/PnlHistorySection.tsx — 歷史損益區塊編排（Phase 10 T6）
// 兩張圖（台股 TWD／美股 USD，D-04 不換匯）＋回推按鈕（3-worker 游標池，D-09 手動觸發）
// ＋進度＋無買進日期批次提示＋空狀態階梯。快照資料源＝localStorage（historyTick 通知重讀）。
import React, { useMemo, useState } from 'react';
import { PortfolioItem, RealizedTrade } from '../../types';
import { isTwStock } from '../../utils/portfolioFees';
import { buildChartSeries, upsertSnapshots } from '../../utils/portfolioHistory';
import { loadSnapshots, saveSnapshots } from '../../utils/portfolioHistoryStore';
import { loadTxns, saveTxns, appendTxns } from '../../utils/txnStore';
import { runBackfillPipeline } from '../../utils/backfillPipeline';
import { runWithConcurrency } from '../../utils/workerPool';
import { fetchFinMindRows } from '../../services/finmind';
import { type FetchErrorKind } from '../../services/fetchError';
import {
  estimateDividends, toDividendTxns, type DividendAnnouncement,
} from '../../utils/dividendEstimator';
import { Coins } from 'lucide-react';
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
  retrying?: number;   // 待重試檔數（退避中）
  waitSec?: number;    // 退避等待秒數
  kind?: FetchErrorKind;     // 退避成因（T7 B4）：後端關閉時退避文案不該說「限流中」
  doneMsg?: string | null;   // 完成回饋（T7 發現 #5：快取全命中時毫秒完成，無此行會看似沒反應）
}
const IDLE: BackfillState = { running: false, done: 0, total: 0, error: null };

/** 進度文字：一般抓取 vs 退避等待——退避成因依 kind 分流（T7 B4），後端關閉≠限流 */
const progressLabel = (st: BackfillState): string => {
  if (st.waitSec) {
    const cause = st.kind === 'BACKEND_DOWN' || st.kind === 'NETWORK' ? '後端無回應中' : '限流中';
    return `${cause}，${st.waitSec} 秒後重試 ${st.retrying} 檔…`;
  }
  return st.retrying ? `重試 ${st.retrying} 檔…` : `回推中 ${st.done}/${st.total} 檔…`;
};

const RATE_LIMIT_HINT = '（被行情來源限流）請等幾分鐘再按一次重算';
const BACKEND_DOWN_HINT = '（行情服務目前無回應，多半是本機後端未啟動或已中斷）請確認後端服務正常後再重算';

/** 抓取失敗的處置提示：先認 kind（T3 型別化錯誤），認不得再退回既有訊息比對 */
const diagnose = (kind: FetchErrorKind | 'NO_DATA' | undefined, message: string): string => {
  if (kind === 'RATE_LIMIT') return RATE_LIMIT_HINT;
  if (kind === 'BACKEND_DOWN' || kind === 'NETWORK') return BACKEND_DOWN_HINT;
  if (/429|too many|限流/i.test(message)) return RATE_LIMIT_HINT;
  if (/5\d\d|internal|failed to fetch|networkerror/i.test(message)) {
    return BACKEND_DOWN_HINT;
  }
  return message ? `（${message.slice(0, 60)}）` : '（原因不明）請稍後再試';
};

const PnlHistorySection: React.FC<PnlHistorySectionProps> = ({
  items, realizedTrades, includeDividend, usdTwdRate, historyTick,
}) => {
  const [refreshTick, setRefreshTick] = useState(0);
  const [usCurrency, setUsCurrency] = useState<'USD' | 'TWD'>('USD');   // 美股曲線幣別
  const [bfState, setBfState] = useState<Record<Market, BackfillState>>({ TW: IDLE, US: IDLE });
  const [divState, setDivState] = useState<{ running: boolean; done: number; total: number; msg: string | null }>(
    { running: false, done: 0, total: 0, msg: null });

  /**
   * 估算歷史配息：券商交易對帳單不含配息，改用公開除權息公告 × 交易流水推算。
   * 只做台股（美股複委託帳單本身就有除息列）。金額為稅前，未扣二代健保補充保費。
   */
  const runDividendEstimate = async () => {
    if (divState.running) return;
    const txns = loadTxns().filter(t => t.market === 'TW');
    const symbols = [...new Set(txns.filter(t => t.kind === 'buy').map(t => t.symbol))];
    if (symbols.length === 0) return;

    setDivState({ running: true, done: 0, total: symbols.length, msg: null });
    const firstDate = txns.reduce((m, t) => (t.date < m ? t.date : m), txns[0].date);
    const anns: Record<string, DividendAnnouncement[]> = {};
    const failed: string[] = [];
    await runWithConcurrency(symbols, 3, async (sym) => {
      const rows = await fetchFinMindRows('TaiwanStockDividend', { data_id: sym, start_date: firstDate });
      anns[sym] = rows as DividendAnnouncement[];
    }, {
      onSettled: (sym, result) => {
        if (!result.ok) failed.push(sym);
        setDivState(s => ({ ...s, done: s.done + 1 }));
      },
    });

    const { dividends, stockDividendNotes, skipped } = estimateDividends(txns, anns);
    if (dividends.length > 0) {
      saveTxns(appendTxns(loadTxns(), toDividendTxns(dividends, 'TW')));
    }
    const total = dividends.reduce((s, d) => s + d.amount, 0);
    const parts = [`估算 ${dividends.length} 筆配息，合計 ${total.toLocaleString('zh-TW')} 元（稅前）`];
    if (stockDividendNotes.length > 0) parts.push(`另有 ${stockDividendNotes.length} 筆配股需自行確認股數`);
    if (skipped.length > 0) parts.push(`${skipped.length} 筆公告資料不全已略過`);
    if (failed.length > 0) parts.push(`${failed.length} 檔查詢失敗`);
    parts.push('請按「重算歷史回推」讓曲線納入');
    setDivState({ running: false, done: symbols.length, total: symbols.length, msg: parts.join('；') });
    setRefreshTick(t => t + 1);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => loadSnapshots(), [historyTick, refreshTick]);
  // 配息流水（含已清倉部位的歷史配息）——供圖表以「已實現側累計」計入
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dividendTxns = useMemo(() => loadTxns().filter(t => t.kind === 'dividend'), [historyTick, refreshTick]);

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

    // 編排（快取先行→併發抓→退避重試→批次寫快取→選模式建列）已收進 utils/backfillPipeline，
    // 那裡有 fake ports 的完整測試。留在這裡的只有表現層的事：進度映射、失敗文案、合併存檔。
    const result = await runBackfillPipeline({
      market,
      items: mLots,
      txns: allTxns,
      realizedTrades,
      usdTwdRate,
      onProgress: p => setBfState(s => ({
        ...s,
        [market]: {
          ...s[market], done: p.done, total: p.total,
          // 只覆寫有帶的欄位——退避輪設定的 retrying 要延續到該輪的逐檔進度，
          // 進度文字才會維持「重試 N 檔…」而不是跳回「回推中 x/y 檔…」
          ...(p.retrying !== undefined ? { retrying: p.retrying } : {}),
          ...(p.waitSec !== undefined ? { waitSec: p.waitSec } : {}),
          ...(p.kind !== undefined ? { kind: p.kind } : {}),
        },
      })),
    });

    if (!result.ok) {
      if (result.kind === 'NO_DATA') { setBfState(s => ({ ...s, [market]: IDLE })); return; }
      const failed = result.missedSymbols;
      const shown = failed.slice(0, 6).join('、') + (failed.length > 6 ? ` 等 ${failed.length} 檔` : '');
      setBfState(s => ({ ...s, [market]: { ...IDLE, error: `${shown} 行情抓取失敗，已自動重試 2 次 ${diagnose(result.kind, result.detail)}` } }));
      return;
    }

    // 重算語意：先清該市場全部 backfill 再寫入（backfill 永不覆蓋 live）
    const existing = loadSnapshots();
    const cleaned = existing.filter(r => !(r.market === market && r.source === 'backfill'));
    saveSnapshots(upsertSnapshots(cleaned, result.snapshots));
    // 完成回饋必須給（T7 發現 #5）：快取全命中時整條鏈毫秒完成、瀏覽器來不及畫進度，
    // 且重算結果常與畫面現值相同——沒有這行字，成功看起來就跟沒反應一樣。
    setBfState(s => ({ ...s, [market]: {
      ...IDLE, done: symbols.length, total: symbols.length,
      doneMsg: `重算完成：快照 ${result.snapshots.length} 筆（快取命中 ${result.cacheHits} 檔、重抓 ${result.fetched} 檔）`,
    } }));
    setRefreshTick(t => t + 1);
  };

  const renderMarket = (market: Market) => {
    const mLots = items.filter(i => (market === 'TW') === isTwStock(i.symbol));
    const mRows = rows.filter(r => r.market === market);
    if (mLots.length === 0 && mRows.length === 0) return null;

    const curr: 'TWD' | 'USD' = market === 'TW' ? 'TWD' : usCurrency;
    const marketDivs = dividendTxns
      .filter(t => t.market === market)
      .map(t => ({
        date: t.date,
        amount: market === 'US' ? (t.netTwd ?? t.gross) : t.gross,
        // 美股配息的實收台幣就在帳單上（netTwd），台幣口徑直接用實收數字，不必再換匯
        ...(market === 'US' ? { amountTwd: t.netTwd ?? 0 } : {}),
      }));
    const points = buildChartSeries(rows, realizedTrades, market, includeDividend, marketDivs, curr);
    const divTotal = marketDivs.reduce((s, d) => s + d.amount, 0);
    // 台幣曲線缺口：有快照但因缺匯率而畫不出來的天數（提示使用者重算）
    const twdGap = market === 'US' && curr === 'TWD' ? mRows.length - points.length : 0;
    const datedLots = mLots.filter(l => !!l.buyDate);
    const undatedLots = mLots.filter(l => !l.buyDate);
    const hasBackfill = mRows.some(r => r.source === 'backfill');
    const st = bfState[market];
    const title = market === 'TW' ? '台股損益歷史（TWD）' : `美股損益歷史（${curr}）`;

    // 美股幣別切換：USD＝純股價損益；TWD＝含匯差的實際台幣損益
    const currencyToggle = market === 'US' ? (
      <div className="flex items-center bg-surface-inset border border-surface-line rounded-ctl p-0.5 gap-0.5">
        {(['USD', 'TWD'] as const).map(c => (
          <button key={c} onClick={() => setUsCurrency(c)}
            title={c === 'USD' ? '美元口徑：純股價損益，不含匯率變動' : '台幣口徑：成本用買入匯率、市值用當日匯率，含匯差'}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all
              ${curr === c ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
            {c}
          </button>
        ))}
      </div>
    ) : undefined;

    return (
      <Card key={market} title={title} actions={currencyToggle}>
        {points.length > 0 ? (
          <div className="space-y-2">
            <PnlHistoryChart currency={curr} points={points} />
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {datedLots.length > 0 && (
                <button onClick={() => runBackfill(market)} disabled={st.running}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-ctl border border-surface-line text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50">
                  {st.running ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
                  {st.running ? progressLabel(st) : (hasBackfill ? '重算歷史回推' : '建立歷史曲線（回推）')}
                </button>
              )}
              {market === 'TW' && (
                <button onClick={runDividendEstimate} disabled={divState.running || st.running}
                  title="券商交易對帳單不含配息，改用公開除權息公告×你的持股推算（稅前）"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-ctl border border-surface-line text-slate-400 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50">
                  {divState.running ? <Loader2 size={12} className="animate-spin" /> : <Coins size={12} />}
                  {divState.running ? `估算配息 ${divState.done}/${divState.total} 檔…` : '估算歷史配息'}
                </button>
              )}
              {divTotal > 0 && (
                <span className="text-up/80">
                  已計入配息 {Math.round(divTotal).toLocaleString('zh-TW')} 元（稅前，切「不含息損益」可排除）
                </span>
              )}
              {twdGap > 0 && (
                <span className="text-amber-300/80">
                  {twdGap} 天缺當日匯率或買入匯率，台幣曲線未涵蓋——按「重算歷史回推」可補上
                </span>
              )}
              {undatedLots.length > 0 && (
                <span className="text-amber-300/80">
                  {undatedLots.length} 筆持股未填買進日期，回推曲線未包含（點明細列的日期欄補填）
                </span>
              )}
              {market === 'TW' && divState.msg && <span className="text-accent">{divState.msg}</span>}
              {st.doneMsg && <span className="text-up/80">{st.doneMsg}</span>}
              {st.error && <span className="text-danger">{st.error}</span>}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center space-y-3">
            {twdGap > 0 ? (
              <>
                <p className="text-sm text-slate-500">
                  這 {twdGap} 天的快照缺當日匯率或買入匯率，畫不出台幣曲線
                  （USD 曲線可正常顯示）。按下方重算會一併抓取歷史匯率。
                </p>
                <button onClick={() => runBackfill(market)} disabled={st.running}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-ctl bg-accent text-white text-sm font-bold hover:bg-accent/80 transition-colors disabled:opacity-50">
                  {st.running ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                  {st.running ? progressLabel(st) : '重算歷史回推（含匯率）'}
                </button>
                {st.error && <p className="text-danger text-xs">{st.error}</p>}
              </>
            ) : datedLots.length > 0 ? (
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
