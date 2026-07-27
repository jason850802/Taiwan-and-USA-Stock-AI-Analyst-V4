import React, { useEffect, useState } from 'react';
import { PortfolioItem, RealizedTrade } from '../types';
import { getStockData } from '../services/yahoo';
import { analyzeTradeDecision } from '../services/gemini';
import { isTwStock, calcTwSellFeeAndTax, calcUsFee } from '../utils/portfolioFees';
import { SellInput } from '../utils/portfolioLedger';
import { lotCostTwd, hasBuyRate } from '../utils/fx';
import { buildBackup, backupFileName, serializeBackup } from '../utils/portfolioBackup';
import { Plus, RefreshCw, Wallet, Loader2, DollarSign, BrainCircuit, CalendarDays, MessageSquare, HeartPulse, Upload, Download, Coins } from 'lucide-react';
import Badge from './ui/Badge';
import Button from './ui/Button';
import StatCard from './ui/StatCard';
import MarkdownReport from './ui/MarkdownReport';
import Modal from './ui/Modal';
import Skeleton from './ui/Skeleton';
import SellModal from './portfolio/SellModal';
import RealizedLedger from './portfolio/RealizedLedger';
import PnlHistorySection from './portfolio/PnlHistorySection';
import ImportStatementModal, { ImportApplyPayload } from './portfolio/ImportStatementModal';
import HoldingsTable, { fmt, fmtUsd } from './portfolio/HoldingsTable';
import { useHoldingPrices } from './portfolio/useHoldingPrices';
import { useDailySnapshot } from './portfolio/useDailySnapshot';
import { usePortfolioForm } from './portfolio/usePortfolioForm';
import { useHealthCheck } from './portfolio/useHealthCheck';
import { useLotDividendUpdate } from './portfolio/useLotDividendUpdate';

interface PortfolioProps {
  items: PortfolioItem[];
  onAdd: (item: Omit<PortfolioItem, 'id'>) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void;
  realizedTrades: RealizedTrade[];
  onSell: (lotId: string, input: SellInput, usdTwdRate?: number) => string | null;   // 回傳錯誤訊息；null＝成功
  onUpdateMeta: (id: string, patch: { buyDate?: string }) => void;
  onDeleteTrade: (tradeId: string) => void;
  onStatementImport: (payload: ImportApplyPayload) => void;
}

// ── 主元件 ─────────────────────────────────────────────────────────────────
const Portfolio: React.FC<PortfolioProps> = ({ items, onAdd, onDelete, onUpdate, realizedTrades, onSell, onUpdateMeta, onDeleteTrade, onStatementImport }) => {
  // 報價/匯率、每日快照、新增表單、庫存健檢四塊 state＋effect＋handlers 已抽成 hooks（T6a）；
  // 解構回原變數名，下方計算段與 JSX 一行不動。
  const { prices, usdTwdRate, fetchAllPrices, fetchExchangeRate } = useHoldingPrices(items);
  const { historyTick } = useDailySnapshot(items, prices, usdTwdRate);
  const {
    showAddModal, setShowAddModal, form, setForm, feeInput, setFeeInput, setFeeTouched,
    setRateTouched, formIsTW, shares, rate, preview, handleAdd,
  } = usePortfolioForm(onAdd, usdTwdRate);
  const {
    healthResults, healthModalSymbol, setHealthModalSymbol, batchChecking,
    handleSingleHealthCheck, handleBatchHealthCheck,
  } = useHealthCheck(items, prices, usdTwdRate);
  const { lotDividendState, runLotDividendUpdate } = useLotDividendUpdate(items, onUpdate);

  // 新增第一檔美股時庫存裡還沒有美股 → 平常不會抓匯率，表單的「預設當日匯率」會落空；
  // 表單開著且輸入的是美股代號就補抓一次（只在 rate 尚未取得時）。
  useEffect(() => {
    if (showAddModal && !formIsTW && form.symbol && usdTwdRate === 0) fetchExchangeRate();
  }, [showAddModal, formIsTW, form.symbol, usdTwdRate, fetchExchangeRate]);

  const [deleteConfirm,   setDeleteConfirm]  = useState<string | null>(null);
  const [sellTarget,      setSellTarget]      = useState<PortfolioItem | null>(null);   // 賣出 Modal 目標批次
  const [showImportModal, setShowImportModal] = useState(false);                        // 對帳單匯入 Modal
  const [includeDividend, setIncludeDividend] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<'TWD' | 'USD'>('USD');

  // 新增持股與AI分析 狀態
  const [isAnalyzeMode,   setIsAnalyzeMode]   = useState(false);
  const [tradeAnalyzing,  setTradeAnalyzing]  = useState(false);
  const [tradeResult,     setTradeResult]     = useState<string>('');
  const [showTradeResult, setShowTradeResult] = useState(false);

  // ── 備份下載（票 01）────────────────────────────────────────────────────
  // 邏輯全在 utils/portfolioBackup（純模組、有行為鎖）；這裡只是薄膠水：
  // 讀真實 localStorage → 產檔 → 觸發下載 → 釋放 object URL。
  // 不看 items prop——備份的是 storage 現況，庫存為空時交易流水／已實現帳本仍可能有東西。
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const handleBackup = () => {
    const now = new Date();
    let text: string;
    try {
      text = serializeBackup(buildBackup(localStorage, now));
    } catch (e: any) {
      // buildBackup 讀不動 storage 時整包放棄——必須讓使用者看到，
      // 否則他會以為手上那個檔是完整備份（保命功能最不能有的誤解）。
      setBackupMsg(e?.message || '備份失敗，請確認瀏覽器是否封鎖了本站的儲存空間。');
      return;
    }

    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(now);
    a.click();
    // 延到下一個 tick 才釋放：同一 tick 撤銷 object URL 在部分瀏覽器會讓下載拿到空檔
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setBackupMsg(`已下載備份檔 ${a.download}`);
  };

  // ── 新增持股並執行 AI 分析 ──────────────────────────────────────────────
  const handleAddAndAnalyze = async () => {
    if (!form.symbol || shares <= 0 || preview.total <= 0) return;

    // Capture needed data before form reset
    const sym          = form.symbol.trim().toUpperCase();
    const buyDate      = form.buyDate || new Date().toISOString().split('T')[0];
    const buyReason    = form.buyReason;
    const buyPrice     = preview.adjAvg;
    const currentPriceData = prices[sym];

    // Add the holding (resets form + closes modal)
    handleAdd();

    // Start AI analysis
    setTradeAnalyzing(true);
    try {
      let recentData = undefined;
      try {
        const { data } = await getStockData(sym, '1d');
        recentData = data;
      } catch { /* continue without recent data */ }

      const result = await analyzeTradeDecision(
        sym, buyDate, buyPrice, buyReason,
        currentPriceData?.price,
        recentData
      );
      setTradeResult(result);
    } catch {
      setTradeResult('**AI 分析失敗**\n\n請稍後再試，或檢查 API Key 是否設定正確。');
    } finally {
      setTradeAnalyzing(false);
      setShowTradeResult(true);
    }
  };

  // ── 分組 ───────────────────────────────────────────────────────────────
  const twItems = items.filter(i =>  isTwStock(i.symbol));
  const usItems = items.filter(i => !isTwStock(i.symbol));

  // ── 全局摘要（統一換算 TWD） ───────────────────────────────────────────
  const twInvested  = twItems.reduce((s, i) => s + i.totalCost, 0);
  // 成本用買入匯率、市值用即時匯率（使用者拍板口徑）；缺買入匯率的舊批次退回即時匯率
  const usInvestedTwd = usItems.reduce((s, i) => s + lotCostTwd(i, rate), 0);
  const usInvestedEstimated = usItems.some(i => !hasBuyRate(i));
  const totalInvested = twInvested + usInvestedTwd;

  const totalValue = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    const valTwd = isTwStock(i.symbol) ? p.price * i.totalShares : p.price * i.totalShares * rate;
    return s + valTwd;
  }, 0);

  const totalSellFees = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    if (isTwStock(i.symbol)) {
      const { sellFee, tax } = calcTwSellFeeAndTax(p.price * i.totalShares, i.symbol);
      return s + sellFee + tax;
    } else {
      const feeUsd = calcUsFee(p.price * i.totalShares, i.isUsEtf ?? false);
      return s + feeUsd * rate;
    }
  }, 0);

  const totalCashDiv = items.reduce((s, i) => s + i.cashDividends, 0);
  const totalPnL     = totalValue > 0
    ? totalValue - totalInvested - totalSellFees + (includeDividend ? totalCashDiv : 0) : null;
  const totalPnLPct  = totalPnL !== null && totalInvested > 0 ? (totalPnL / totalInvested) * 100 : null;
  const hasAnyPrice  = items.some(i => prices[i.symbol]?.price > 0);

  const inputCls = "w-full bg-surface-inset border border-surface-line text-white px-4 py-3 rounded-ctl focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-colors placeholder:text-slate-600 text-sm";

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-surface-card p-6 rounded-card border border-surface-line">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">我的庫存</h2>
          <p className="text-slate-400 text-sm">台股含手續費與證交稅・美股個股 0.08%・ETF $3/次</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* justify-end：按鈕列換行後，末排必須靠右貼齊——預設靠左會在末排右側留一大片
              與卡片邊緣之間的空洞（T7 B6 後半，實測 749px） */}
          <div className="flex flex-wrap justify-end gap-2">
            <div className="flex items-center bg-surface-inset border border-surface-line rounded-ctl p-1 gap-1">
              <Button variant={includeDividend ? 'primary' : 'ghost'} size="sm" onClick={() => setIncludeDividend(true)}>
                含息損益
              </Button>
              <Button variant={!includeDividend ? 'primary' : 'ghost'} size="sm" onClick={() => setIncludeDividend(false)}>
                不含息損益
              </Button>
            </div>
            <Button variant="ghost" onClick={fetchAllPrices} className="flex items-center gap-2">
              <RefreshCw size={15} /> 更新報價
            </Button>
            <span title="依除權息公告估算台股各批股利，會覆蓋該批的股利欄位">
              <Button variant="ghost" onClick={runLotDividendUpdate} disabled={lotDividendState.running}
                className="flex items-center gap-2">
                {lotDividendState.running ? <Loader2 size={15} className="animate-spin" /> : <Coins size={15} />} 自動估算股利
              </Button>
            </span>
            <Button variant="ghost" onClick={() => setShowImportModal(true)} className="flex items-center gap-2">
              <Upload size={15} /> 匯入對帳單
            </Button>
            <span title="把持股、交易流水、匯入紀錄、已實現帳本與每日快照存成一個 JSON 檔下載；收盤價與 AI 分析快取不含在內（那些會自動重抓）">
              <Button variant="ghost" onClick={handleBackup} className="flex items-center gap-2">
                <Download size={15} /> 備份
              </Button>
            </span>
            <Button variant="ai" onClick={handleBatchHealthCheck} disabled={items.length === 0 || batchChecking} className="flex items-center gap-2">
              {batchChecking ? <Loader2 size={15} className="animate-spin" /> : <HeartPulse size={15} />} 全部健檢
            </Button>
            <Button variant="primary" onClick={() => { setIsAnalyzeMode(false); setShowAddModal(true); }} className="flex items-center gap-2">
              <Plus size={15} /> 新增持股
            </Button>
            <Button variant="ai" onClick={() => { setIsAnalyzeMode(true); setShowAddModal(true); }} className="flex items-center gap-2">
              <BrainCircuit size={15} /> 新增持股與分析
            </Button>
          </div>
          {lotDividendState.msg && (
            <p className="text-xs text-accent text-right max-w-md">{lotDividendState.msg}</p>
          )}
          {backupMsg && (
            <p className="text-xs text-accent text-right max-w-md">{backupMsg}</p>
          )}
        </div>
      </div>

      {/* ── 全局摘要 ───────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="總投入成本 (TWD)" value={`${fmt(totalInvested)} 元`}
            sub={usItems.length === 0 ? undefined
              : usInvestedEstimated ? '美股依買入匯率換算（部分批次無匯率，以即時匯率估）'
              : '美股依買入匯率換算'} />
          <StatCard
            label="目前市值 (TWD)"
            value={hasAnyPrice ? `${fmt(totalValue)} 元` : '—'}
            sub={usdTwdRate > 0 ? `USD/TWD ${fmt(usdTwdRate, 2)}` : undefined}
          />
          <StatCard label="已領現金股利" value={`${fmt(totalCashDiv)} 元`} tone="up" />
          <StatCard
            label="總損益 (TWD)"
            value={totalPnL !== null ? `${totalPnL >= 0 ? '+' : ''}${fmt(totalPnL)} 元` : '—'}
            tone={totalPnL === null ? 'neutral' : totalPnL >= 0 ? 'up' : 'down'}
            sub={totalPnL !== null && totalPnLPct !== null
              ? `${totalPnL >= 0 ? '+' : ''}${totalPnLPct.toFixed(2)}% · ${includeDividend ? '含息' : '不含息'}`
              : undefined}
          />
        </div>
      )}

      {/* ── 空狀態 ──────────────────────────────────────────────────────── */}
      {items.length === 0 && (
        <div className="bg-surface-card border border-surface-line border-dashed rounded-card p-16 flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-surface-inset rounded-full mb-4">
            <Wallet className="text-slate-500 w-8 h-8" />
          </div>
          <h3 className="text-slate-300 font-medium mb-2 text-lg">尚無持股紀錄</h3>
          <p className="text-slate-500 mb-6">點擊「新增持股」按鈕來加入您的庫存</p>
          <Button variant="primary" onClick={() => { setIsAnalyzeMode(false); setShowAddModal(true); }} className="flex items-center gap-2">
            <Plus size={16} /> 新增持股
          </Button>
        </div>
      )}

      {/* ── 歷史損益折線圖（Phase 10）────────────────────────────────────── */}
      <PnlHistorySection items={items} realizedTrades={realizedTrades}
        includeDividend={includeDividend} usdTwdRate={usdTwdRate} historyTick={historyTick} />

      {/* ── 台股 ────────────────────────────────────────────────────────── */}
      {twItems.length > 0 && (
        <HoldingsTable market="TW" items={twItems} prices={prices} includeDividend={includeDividend}
          deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm}
          onDelete={onDelete} onUpdate={onUpdate}
          onUpdateMeta={onUpdateMeta} onSellClick={setSellTarget}
          healthResults={healthResults} onHealthCheck={handleSingleHealthCheck} onShowDetail={setHealthModalSymbol} />
      )}

      {/* ── 美股 ────────────────────────────────────────────────────────── */}
      {usItems.length > 0 && (
        <HoldingsTable market="US" items={usItems} prices={prices} includeDividend={includeDividend}
          displayCurrency={displayCurrency} onToggleCurrency={() => setDisplayCurrency(d => d === 'USD' ? 'TWD' : 'USD')}
          usdTwdRate={usdTwdRate} deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm}
          onDelete={onDelete} onUpdate={onUpdate}
          onUpdateMeta={onUpdateMeta} onSellClick={setSellTarget}
          healthResults={healthResults} onHealthCheck={handleSingleHealthCheck} onShowDetail={setHealthModalSymbol} />
      )}

      {/* ── 已實現損益帳本（Phase 10）─────────────────────────────────────── */}
      <RealizedLedger trades={realizedTrades} onDeleteTrade={onDeleteTrade} />

      {/* ── 賣出 Modal（Phase 10）────────────────────────────────────────── */}
      {/* ── 對帳單匯入 Modal（Phase 11）──────────────────────────────────── */}
      <ImportStatementModal open={showImportModal} onClose={() => setShowImportModal(false)}
        existingLots={items} onApply={onStatementImport} />

      <SellModal lot={sellTarget} usdTwdRate={usdTwdRate}
        priceHint={sellTarget ? prices[sellTarget.symbol]?.price : undefined}
        onConfirm={onSell} onClose={() => setSellTarget(null)} />

      {/* ── 新增 Modal ───────────────────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setIsAnalyzeMode(false); }}
        title={isAnalyzeMode ? '新增持股與 AI 分析' : '新增持股'}
        maxWidth="max-w-md"
      >
            <div className="space-y-4">
              {/* 代號 */}
              <div>
                <label className="text-slate-300 text-sm font-medium block mb-1.5">
                  股票代號 <span className="text-danger">*</span>
                </label>
                <input type="text" value={form.symbol}
                  onChange={e => setForm(p => ({ ...p, symbol: e.target.value }))}
                  placeholder="台股：2330 ／ 美股：AAPL, SPY" className={inputCls} />
                {form.symbol && (
                  <p className="text-xs mt-1.5 px-1 text-slate-400 flex items-center gap-2">
                    <Badge variant="neutral">{formIsTW ? '台股' : '美股'}</Badge>
                    {formIsTW ? '將計算買進手續費' : '請選擇購入幣別與股票類型'}
                  </p>
                )}
              </div>

              {/* 美股：幣別 + 個股/ETF 選擇 */}
              {!formIsTW && form.symbol && (
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">購入幣別</label>
                    <div className="flex bg-surface-inset border border-surface-line rounded-ctl p-1 gap-1">
                      <button onClick={() => setForm(p => ({ ...p, purchaseCurrency: 'USD' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5
                          ${form.purchaseCurrency === 'USD' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                        <DollarSign size={13} /> 美元 (USD)
                      </button>
                      <button onClick={() => setForm(p => ({ ...p, purchaseCurrency: 'TWD' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${form.purchaseCurrency === 'TWD' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                        TWD 台幣
                      </button>
                    </div>
                    {form.purchaseCurrency === 'TWD' && (
                      <p className="text-xs text-slate-500 mt-1.5 px-1">
                        以 TWD 購入：總成本(TWD)固定，USD 換算依下方買入匯率計算
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">
                      買入匯率 (USD/TWD)
                      <span className="text-slate-500 font-normal ml-1">預設為當日匯率，可改成實際成交匯率</span>
                    </label>
                    <input type="number" step="0.001" min="0" value={form.exchangeRate}
                      onFocus={e => e.target.select()}
                      onChange={e => { setRateTouched(true); setForm(p => ({ ...p, exchangeRate: e.target.value })); }}
                      placeholder={usdTwdRate > 0 ? usdTwdRate.toFixed(3) : '例：31.50'}
                      className={inputCls} />
                    <p className="text-xs text-slate-500 mt-1.5 px-1">
                      {usdTwdRate > 0
                        ? `當日匯率 ${fmt(usdTwdRate, 3)}`
                        : `尚未取得即時匯率，未填則以 ${fmt(rate, 2)} 計算（請先按「更新報價」）`}
                      ；此匯率會存入該批，台幣成本一律用它換算
                    </p>
                  </div>
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">股票類型</label>
                    <div className="flex bg-surface-inset border border-surface-line rounded-ctl p-1 gap-1">
                      <button onClick={() => setForm(p => ({ ...p, isUsEtf: false }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${!form.isUsEtf ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                        個股（0.08%）
                      </button>
                      <button onClick={() => setForm(p => ({ ...p, isUsEtf: true }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${form.isUsEtf ? 'bg-ai text-white' : 'text-slate-400 hover:text-white'}`}>
                        ETF（$3/次）
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 輸入模式 */}
              <div>
                <label className="text-slate-300 text-sm font-medium block mb-1.5">成本輸入方式</label>
                <div className="flex bg-surface-inset border border-surface-line rounded-ctl p-1 gap-1">
                  <button onClick={() => setForm(p => ({ ...p, inputMode: 'avg' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                      ${form.inputMode === 'avg' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                    輸入成本均價
                  </button>
                  <button onClick={() => setForm(p => ({ ...p, inputMode: 'total' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                      ${form.inputMode === 'total' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                    輸入總成本
                  </button>
                </div>
              </div>

              {/* 成本輸入 */}
              <div className="grid grid-cols-2 gap-3">
                {form.inputMode === 'avg' ? (
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">
                      成本均價 {!formIsTW && <span className="text-slate-500">({form.purchaseCurrency})</span>}
                      <span className="text-danger"> *</span>
                    </label>
                    <input type="number" value={form.avgCostPrice}
                      onChange={e => setForm(p => ({ ...p, avgCostPrice: e.target.value }))}
                      placeholder={!formIsTW && form.purchaseCurrency === 'USD' ? '例：185.50' : '例：500.5'}
                      className={inputCls} />
                  </div>
                ) : (
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">
                      總成本 {!formIsTW ? `(${form.purchaseCurrency})` : '(TWD)'}
                      <span className="text-danger"> *</span>
                    </label>
                    <input type="number" value={form.totalCostInput}
                      onChange={e => setForm(p => ({ ...p, totalCostInput: e.target.value }))}
                      placeholder={!formIsTW && form.purchaseCurrency === 'USD' ? '例：18550.00' : '例：500200'}
                      className={inputCls} />
                  </div>
                )}
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">
                    總股數 <span className="text-danger">*</span>
                  </label>
                  <input type="number" value={form.totalShares}
                    onChange={e => setForm(p => ({ ...p, totalShares: e.target.value }))}
                    placeholder="例：100" className={inputCls} />
                </div>
              </div>

              {/* 手續費（台股 total 模式的總成本已包含所有費用） */}
              {!(formIsTW && form.inputMode === 'total') && (
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">
                    手續費
                    {!formIsTW && <span className="text-slate-500 font-normal ml-1">（{form.purchaseCurrency}）</span>}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={feeInput}
                    onFocus={event => event.target.select()}
                    onChange={event => {
                      setFeeTouched(true);
                      setFeeInput(event.target.value);
                    }}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
              )}

              {/* 試算預覽 */}
              {preview.total > 0 && shares > 0 && (
                <div className="bg-surface-inset rounded-card p-4 border border-warn/20 space-y-1.5 text-xs">
                  <p className="text-amber-400 font-bold uppercase tracking-wider mb-2">試算預覽</p>
                  {form.inputMode === 'avg' ? (
                    <>
                      <div className="flex justify-between text-slate-400">
                        <span>基礎成本（均價 × 股數）</span>
                        <span className="text-white">
                          {!formIsTW && form.purchaseCurrency === 'USD' ? fmtUsd(preview.base) : `${fmt(preview.base)} 元`}
                        </span>
                      </div>
                      {preview.buyFee > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>+ {preview.feeLabel}</span>
                          <span className="text-amber-400">
                            +{!formIsTW && form.purchaseCurrency === 'USD' ? fmtUsd(preview.buyFee) : `${fmt(preview.buyFee)} 元`}
                            {!formIsTW && form.purchaseCurrency === 'TWD' && (preview as any).feeUsd != null && (
                              <span className="text-slate-500 ml-1">(≈ {fmtUsd((preview as any).feeUsd)})</span>
                            )}
                          </span>
                        </div>
                      )}
                      <div className="border-t border-slate-700 pt-1.5 flex justify-between font-bold">
                        <span className="text-slate-300">有效總成本</span>
                        <span className="text-amber-300">
                          {!formIsTW && form.purchaseCurrency === 'USD' ? fmtUsd(preview.total) : `${fmt(preview.total)} 元`}
                          {!formIsTW && form.purchaseCurrency === 'USD' && (preview as any).totalTwd > 0 && (
                            <span className="text-slate-500 font-normal ml-1">(≈ {fmt((preview as any).totalTwd ?? preview.total * rate)} TWD)</span>
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-slate-400">
                      <span>成本均價（總成本 ÷ 股數）</span>
                      <span className="text-amber-300">
                        {!formIsTW && form.purchaseCurrency === 'USD' ? fmtUsd(preview.adjAvg) : `${preview.adjAvg.toFixed(2)} 元`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-400 pt-0.5">
                    <span>儲存後成本均價</span>
                    <span className="text-white">
                      {!formIsTW && form.purchaseCurrency === 'USD' ? fmtUsd(preview.adjAvg) : `${preview.adjAvg.toFixed(2)} 元`}
                    </span>
                  </div>
                </div>
              )}

              {/* 股利 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">已領現金股利 (元)</label>
                  <input type="number" value={form.cashDividends}
                    onChange={e => setForm(p => ({ ...p, cashDividends: e.target.value }))}
                    placeholder="0" className={inputCls} />
                </div>
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">已領股票股利 (股)</label>
                  <input type="number" value={form.stockDividends}
                    onChange={e => setForm(p => ({ ...p, stockDividends: e.target.value }))}
                    placeholder="0" className={inputCls} />
                </div>
              </div>

              {/* 買進日期（Phase 10：回推歷史損益用，選填） */}
              <div>
                <label className="text-slate-300 text-sm font-medium block mb-1.5 flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-slate-400" /> 買進日期
                  <span className="text-xs text-slate-500 font-normal">（選填；填了才能回推這批的歷史損益）</span>
                </label>
                <input type="date" value={form.buyDateRecord}
                  onChange={e => setForm(p => ({ ...p, buyDateRecord: e.target.value }))}
                  className={inputCls} />
              </div>

              {/* 買入時間與原因（分析模式專用） */}
              {isAnalyzeMode && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="border-t border-ai/20 pt-3">
                    <p className="text-ai text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <BrainCircuit size={13} /> AI 分析資訊
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="text-slate-300 text-sm font-medium block mb-1.5 flex items-center gap-1.5">
                          <CalendarDays size={14} className="text-slate-400" /> 買入時間點
                        </label>
                        <input type="datetime-local" step="1" value={form.buyDate}
                          onChange={e => setForm(p => ({ ...p, buyDate: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className="text-slate-300 text-sm font-medium block mb-1.5 flex items-center gap-1.5">
                          <MessageSquare size={14} className="text-slate-400" /> 買入原因 <span className="text-danger">*</span>
                        </label>
                        <textarea
                          value={form.buyReason}
                          onChange={e => setForm(p => ({ ...p, buyReason: e.target.value }))}
                          placeholder="例：技術面突破前高、量增價漲、外資連續買超…"
                          rows={3}
                          className={`${inputCls} resize-none`}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {isAnalyzeMode ? (
                <Button variant="ai" onClick={handleAddAndAnalyze}
                  disabled={!form.symbol || shares <= 0 || preview.total <= 0 || !form.buyReason.trim()}
                  className="w-full flex items-center justify-center gap-2">
                  <BrainCircuit size={18} /> 新增並 AI 分析
                </Button>
              ) : (
                <Button variant="primary" onClick={handleAdd}
                  disabled={!form.symbol || shares <= 0 || preview.total <= 0}
                  className="w-full">
                  確認新增
                </Button>
              )}
            </div>
      </Modal>

      {/* ── AI 分析中 Loading Overlay ────────────────────────────────── */}
      <Modal
        open={tradeAnalyzing}
        onClose={() => setTradeAnalyzing(false)}
        title="AI 思考分析中"
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          <Skeleton variant="lines" lines={4} />
          <div className="text-center">
            <p className="text-slate-400 text-sm">正在評估您的買入決策，請稍候…</p>
            <p className="text-slate-500 text-xs mt-1">使用 Gemini 3.1 Pro 思考模式</p>
          </div>
        </div>
      </Modal>

      {/* ── AI 分析結果 Modal ────────────────────────────────────────── */}
      <Modal
        open={showTradeResult}
        onClose={() => setShowTradeResult(false)}
        title="AI 買入決策評估報告"
      >
            <div className="text-slate-300">
              <MarkdownReport content={tradeResult} />
            </div>
            <div className="pt-4 border-t border-surface-line">
              <Button variant="ghost" onClick={() => setShowTradeResult(false)} className="w-full">
                關閉
              </Button>
            </div>
      </Modal>
      {/* ── 個股健檢結果 Modal ────────────────────────────────────────── */}
      <Modal
        open={Boolean(healthModalSymbol && healthResults[healthModalSymbol]?.fullResult)}
        onClose={() => setHealthModalSymbol(null)}
        title={`持股健檢：${healthModalSymbol ?? ''}`}
        maxWidth="max-w-3xl"
      >
            <div className="text-slate-300">
              <MarkdownReport
                content={healthModalSymbol ? healthResults[healthModalSymbol]?.fullResult ?? '' : ''}
              />
            </div>
            <div className="pt-4 border-t border-surface-line">
              <Button variant="ghost" onClick={() => setHealthModalSymbol(null)} className="w-full">
                關閉
              </Button>
            </div>
      </Modal>
    </div>
  );
};

export default Portfolio;
