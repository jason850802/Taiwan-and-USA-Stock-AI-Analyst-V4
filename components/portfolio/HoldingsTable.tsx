// components/portfolio/HoldingsTable.tsx — 台股/美股持股表的單一實作（Phase 12 T6b）
//
// 由原 Portfolio.tsx 的 TwGroupTable（藍本的 TW 分支來源）與 UsGroupTable（**功能超集，
// 本檔以它為藍本**）合併而成。TW/US 是同一 interface 的兩個 adapter：結構性差異走
// spec（MarketTableSpec）與 market 判別，逐格公式自兩表原樣搬入、零改寫。
//
// 兩市場「刻意不同、不得順手統一」的差異（golden-t6b.json 逐字鎖住）：
//   - TW 11 欄含獨立「手續費」欄（hasBuyFee 才顯示數字）；US 10 欄，費用只進損益 tooltip。
//   - TW 恆 TWD；US 有 USD/TWD 顯示切換（rate 不可得時 fallback USD_TWD_FALLBACK，僅顯示用）。
//   - TW 群組列「目前股價」有紅綠色（對均價）；US 群組列沒有。
//   - TW 卡片頭費稅逐批加總、symbol 列對整組市值算一次；US 兩處皆逐批加總。
//   - TW 批次列的成本均價可編輯；US 為換算顯示值、不可編輯（固定成本欄才可編輯）。
import React, { useState } from 'react';
import { PortfolioItem } from '../../types';
import { isTwStock, calcTwSellFeeAndTax, calcUsFee } from '../../utils/portfolioFees';
import { groupLotsBySymbol } from '../../utils/portfolioGrouping';
import { USD_TWD_FALLBACK, lotCostTwd, lotCostUsd, lotBuyRate, hasBuyRate } from '../../utils/fx';
import { Trash2, Loader2, ChevronDown, ChevronUp, Info, HeartPulse, Banknote } from 'lucide-react';
import Badge from '../ui/Badge';
import type { PriceData } from './useHoldingPrices';

// ── 格式化（自 Portfolio.tsx 原樣搬出；主元件與本表共用）───────────────────
export const fmt  = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtUsd = (n: number, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ── 可編輯儲存格 ────────────────────────────────────────────────────────────
const EditableCell: React.FC<{
  value?: number; digits?: number;
  onSave: (v: number) => void;
  cls?: string;
}> = ({ value, digits = 0, onSave, cls = 'text-slate-200' }) => {
  const [active, setActive] = useState(false);
  const [draft,  setDraft]  = useState('');
  const display = value === undefined ? '' : digits > 0 ? value.toFixed(digits) : String(value);
  return (
    <input type="number"
      value={active ? draft : display}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setDraft(display); setActive(true); }}
      onBlur={() => { const n = parseFloat(draft); if (!isNaN(n) && n >= 0) onSave(n); setActive(false); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      title="點擊直接編輯"
      placeholder="—"
      className={`bg-surface-inset border border-surface-line rounded-ctl text-right w-24 min-w-0 px-1.5 py-0.5 font-mono tabular-nums ${cls}
        hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-accent
        cursor-text transition-colors text-sm`}
    />
  );
};

// ── 買進日期儲存格（Phase 10：回推歷史用；未填以琥珀色框提示）──────────────
const EditableDateCell: React.FC<{
  value?: string;
  onSave: (v: string) => void;
}> = ({ value, onSave }) => (
  <input type="date" value={value ?? ''}
    onChange={e => { if (e.target.value) onSave(e.target.value); }}
    title="買進日期（歷史損益回推用；未填的批次不參與回推）"
    className={`mt-1 bg-surface-inset border rounded-ctl px-1.5 py-0.5 text-[11px] font-mono
      ${value ? 'border-surface-line text-slate-400' : 'border-amber-500/60 text-amber-300'}
      hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-accent cursor-text transition-colors`}
  />
);

// ── 損益儲存格 ─────────────────────────────────────────────────────────────
const PnLCell: React.FC<{
  pnl: number | null; pnlPct: number | null;
  currency: 'TWD' | 'USD';
  feeDetails?: { sellFee: number; tax: number; label: string; currentValue: number };
}> = ({ pnl, pnlPct, currency, feeDetails }) => {
  const [show, setShow] = useState(false);
  if (pnl === null) return <span className="text-slate-500">—</span>;
  const hasFees = feeDetails && (feeDetails.sellFee > 0 || feeDetails.tax > 0);
  const f = (v: number) => currency === 'USD' ? fmtUsd(v) : `${fmt(v)} 元`;
  return (
    <div className="relative inline-flex items-start gap-1 justify-end w-full"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <div className="text-right font-mono tabular-nums">
        <p className={`font-bold ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
          {pnl >= 0 ? '+' : ''}{f(pnl)}
        </p>
        {pnlPct !== null && (
          <p className={`text-xs ${pnl >= 0 ? 'text-up/70' : 'text-down/70'}`}>
            ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </p>
        )}
      </div>
      {hasFees && <Info size={12} className="text-slate-500 mt-0.5 shrink-0" />}
      {show && hasFees && feeDetails && (
        <div className="absolute z-50 right-5 top-0 w-60 bg-surface-inset border border-surface-line rounded-card p-3 text-xs text-left pointer-events-none whitespace-nowrap">
          <p className="text-slate-300 font-bold mb-2">損益含預估賣出費用</p>
          <div className="space-y-1 text-slate-400">
            <div className="flex justify-between gap-4"><span>目前市值</span><span className="text-white">{f(feeDetails.currentValue)}</span></div>
            <div className="flex justify-between gap-4"><span>賣出手續費（預估）</span><span className="text-amber-400">-{f(feeDetails.sellFee)}</span></div>
            {feeDetails.tax > 0 && (
              <div className="flex justify-between gap-4"><span>{feeDetails.label}（預估）</span><span className="text-amber-400">-{f(feeDetails.tax)}</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── 健檢儲存格（原本兩表各一份、位元組相同——併表後收一份）──────────────────
export interface HealthCheckProps {
  healthResults: Record<string, { status: 'loading' | 'done' | 'error'; decision: string; fullResult: string }>;
  onHealthCheck: (symbol: string) => void;
  onShowDetail: (symbol: string) => void;
}

const HealthCell: React.FC<HealthCheckProps & { symbol: string }> = ({ symbol, healthResults, onHealthCheck, onShowDetail }) => {
  const hr = healthResults[symbol];
  if (!hr) return (
    <button
      onClick={event => { event.stopPropagation(); onHealthCheck(symbol); }}
      title="健檢"
      className="p-1.5 rounded-ctl bg-surface-inset hover:bg-danger-muted text-slate-400 hover:text-danger transition-colors"
    >
      <HeartPulse size={14} />
    </button>
  );
  if (hr.status === 'loading') return <Loader2 size={14} className="animate-spin text-danger mx-auto" />;
  const decVariant = hr.decision.includes('停損') ? 'danger'
    : hr.decision.includes('停利') ? 'warn'
    : hr.decision.includes('減碼') ? 'warn'
    : hr.decision.includes('續抱') ? 'ok'
    : hr.decision.includes('加碼') ? 'ok'
    : 'neutral';
  return (
    <button
      onClick={event => { event.stopPropagation(); onShowDetail(symbol); }}
      className="cursor-pointer hover:brightness-125 transition-all"
    >
      <Badge variant={decVariant}>{hr.decision.replace(/[🟢🔵🟡🟠🔴]/gu, '')}</Badge>
    </button>
  );
};

// ── 市場設定物件（D-07：同一 interface、兩個 adapter）──────────────────────
interface MarketTableSpec {
  market: 'TW' | 'US';
  badge: string;
  title: string;
  /** TW 才有獨立手續費欄（11 欄 vs 10 欄） */
  showFeeColumn: boolean;
}

const TW_SPEC: MarketTableSpec = { market: 'TW', badge: '台股', title: '台灣股票', showFeeColumn: true };
const US_SPEC: MarketTableSpec = { market: 'US', badge: '美股', title: '美國股票', showFeeColumn: false };

export interface HoldingsTableProps extends HealthCheckProps {
  market: 'TW' | 'US';
  items: PortfolioItem[];
  prices: Record<string, PriceData>;
  includeDividend: boolean;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void;
  onUpdateMeta: (id: string, patch: { buyDate?: string }) => void;
  onSellClick: (item: PortfolioItem) => void;
  /** US only：顯示幣別切換 */
  displayCurrency?: 'TWD' | 'USD';
  onToggleCurrency?: () => void;
  usdTwdRate?: number;
}

const HoldingsTable: React.FC<HoldingsTableProps> = ({
  market, items, prices, includeDividend,
  displayCurrency, onToggleCurrency, usdTwdRate,
  deleteConfirm, setDeleteConfirm, onDelete, onUpdate,
  onUpdateMeta, onSellClick,
  healthResults, onHealthCheck, onShowDetail,
}) => {
  const spec = market === 'TW' ? TW_SPEC : US_SPEC;
  const isTW = spec.market === 'TW';
  const [collapsed, setCollapsed] = useState(false);
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const rate = (usdTwdRate ?? 0) > 0 ? usdTwdRate! : USD_TWD_FALLBACK; // fallback rate（僅顯示用，D-10）

  const toggleSymbol = (symbol: string) => {
    setExpandedSymbols(current => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  // 顯示幣別：TW 恆 TWD；US 依切換
  const dc: 'TWD' | 'USD' = isTW ? 'TWD' : (displayCurrency ?? 'USD');

  // Convert USD value to display currency（US 專用；TW 值本來就是 TWD）
  const toDisplay = (usdVal: number) => dc === 'USD' ? usdVal : usdVal * rate;

  // Cost of item in display currency
  // 口徑：成本用「買入匯率」（該批 exchangeRate），市值才用即時匯率——切到 TWD 時看到的
  // 成本＝當初實際扣款台幣，匯差賺賠會真實反映在損益。舊批次無匯率時退回即時匯率。
  const itemCostInDisplay = (item: PortfolioItem): number => {
    if (isTW) return item.totalCost;
    return dc === 'USD' ? lotCostUsd(item, rate) : lotCostTwd(item, rate);
  };

  // ── 卡片頭合計（TW：費稅逐批加總；US：費用逐批加總＋幣別換算）──────────
  const groupCost  = items.reduce((s, i) => s + itemCostInDisplay(i), 0);
  const groupValue = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    const valueUsd = p.price * i.totalShares;
    return s + (isTW ? valueUsd : toDisplay(valueUsd));
  }, 0);
  const groupSellCosts = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    if (isTW) {
      const { sellFee, tax } = calcTwSellFeeAndTax(p.price * i.totalShares, i.symbol);
      return s + sellFee + tax;
    }
    if (p.price <= 0) return s;
    return s + toDisplay(calcUsFee(p.price * i.totalShares, i.isUsEtf ?? false));
  }, 0);
  const groupCashDiv = items.reduce((s, i) => {
    // US：cashDividends stored in TWD by default
    if (isTW) return s + i.cashDividends;
    return s + (dc === 'USD' ? i.cashDividends / rate : i.cashDividends);
  }, 0);
  const groupPnL    = groupValue > 0
    ? groupValue - groupCost - groupSellCosts + (includeDividend ? groupCashDiv : 0) : null;
  const groupPnLPct = groupPnL !== null && groupCost > 0 ? (groupPnL / groupCost) * 100 : null;
  const f = (v: number) => dc === 'USD' ? fmtUsd(v) : `${fmt(v)}`;

  // 卡片頭：TW 用 <button>；US 內含幣別切換鈕（HTML 不允許 button 巢狀 button）改 div+role=button
  const headerInner = (
    <>
      <div className="flex items-center gap-3">
        <Badge variant="neutral">{spec.badge}</Badge>
        <span className="text-white font-semibold">{spec.title}</span>
        <span className="text-slate-500 text-xs">{groupLotsBySymbol(items).size} 檔</span>
        {!isTW && (usdTwdRate ?? 0) > 0 && (
          <span className="text-xs text-slate-500">1 USD ≈ {fmt(usdTwdRate!, 2)} TWD</span>
        )}
      </div>
      <div className={`flex items-center ${isTW ? 'gap-4' : 'gap-3'} text-sm`}>
        {!isTW && (
          /* Currency toggle — stop propagation so it doesn't collapse the table */
          <div onClick={e => e.stopPropagation()}
            className="flex items-center bg-surface-inset border border-surface-line rounded-ctl p-0.5 gap-0.5">
            <button onClick={onToggleCurrency}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all
                ${dc === 'USD' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
              USD
            </button>
            <button onClick={onToggleCurrency}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all
                ${dc === 'TWD' ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
              TWD
            </button>
          </div>
        )}
        {groupPnL !== null && groupPnLPct !== null && (
          <span className={`font-bold font-mono tabular-nums ${groupPnL >= 0 ? 'text-up' : 'text-down'}`}>
            {groupPnL >= 0 ? '+' : ''}{f(groupPnL)} ({groupPnL >= 0 ? '+' : ''}{groupPnLPct.toFixed(2)}%)
          </span>
        )}
        {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
      </div>
    </>
  );

  return (
    <div className="bg-surface-card rounded-card border border-surface-line overflow-hidden">
      {isTW ? (
        <button onClick={() => setCollapsed(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors">
          {headerInner}
        </button>
      ) : (
        <div role="button" tabIndex={0} onClick={() => setCollapsed(v => !v)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(v => !v); } }}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors cursor-pointer">
          {headerInner}
        </div>
      )}

      {!collapsed && (
        <div className="overflow-x-auto border-t border-surface-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr className="text-slate-400 font-medium">
                <th className="text-center p-3 whitespace-nowrap">健檢</th>
                <th className="text-left p-3 whitespace-nowrap">代號 / 名稱</th>
                <th className="text-right p-3 whitespace-nowrap">{isTW ? '成本均價' : `成本均價 (${dc})`}</th>
                <th className="text-right p-3 whitespace-nowrap">總股數</th>
                <th className="text-right p-3 whitespace-nowrap">{isTW ? '總成本 (元)' : `總成本 (${dc})`}</th>
                {!isTW && <th className="text-right p-3 whitespace-nowrap" title="買入當時的 USD/TWD；台幣成本一律以它換算">買入匯率</th>}
                <th className="text-right p-3 whitespace-nowrap">{isTW ? '目前股價' : '目前股價 (USD)'}</th>
                <th className="text-right p-3 whitespace-nowrap">{isTW ? '目前市值' : `目前市值 (${dc})`}</th>
                <th className="text-right p-3 whitespace-nowrap">現金股利</th>
                <th className="text-right p-3 whitespace-nowrap">股票股利(股)</th>
                {spec.showFeeColumn && <th className="text-right p-3 whitespace-nowrap">手續費</th>}
                <th className="text-right p-3 whitespace-nowrap">{isTW ? '總損益' : `總損益 (${dc})`}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupLotsBySymbol(items)).map(([symbol, lots]) => {
                const p = prices[symbol];
                const totalShares = lots.reduce((sum, lot) => sum + lot.totalShares, 0);
                const totalCost = lots.reduce((sum, lot) => sum + itemCostInDisplay(lot), 0);
                const totalCashDividends = lots.reduce((sum, lot) =>
                  sum + (isTW ? lot.cashDividends : (dc === 'USD' ? lot.cashDividends / rate : lot.cashDividends)), 0);
                const totalStockDividends = lots.reduce((sum, lot) => sum + lot.stockDividends, 0);
                const totalBuyFee = lots.reduce((sum, lot) => sum + (lot.buyFee ?? 0), 0);
                const hasBuyFee = lots.some(lot => lot.buyFee !== undefined);
                const priceUsd = p?.price ?? 0;       // TW 語境下即 TWD 價；沿藍本變數名
                const currentPrice = priceUsd;
                const valueRaw = currentPrice * totalShares;
                const dispValue = isTW ? valueRaw : toDisplay(valueRaw);
                // 賣出成本：TW 對整組市值算一次（原 TwGroupTable 語意）；US 逐批加總（原 UsGroupTable 語意）
                const sellCosts = isTW
                  ? (() => { const { sellFee, tax } = calcTwSellFeeAndTax(valueRaw, symbol); return sellFee + tax; })()
                  : lots.reduce((sum, lot) => {
                      const lotValueUsd = priceUsd * lot.totalShares;
                      return sum + toDisplay(calcUsFee(lotValueUsd, lot.isUsEtf ?? false));
                    }, 0);
                const pnl = (p && !p.loading && !p.error && currentPrice > 0)
                  ? dispValue - totalCost - sellCosts + (includeDividend ? totalCashDividends : 0)
                  : null;
                const pnlPct = pnl !== null && totalCost > 0 ? (pnl / totalCost) * 100 : null;
                const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
                const expanded = expandedSymbols.has(symbol);

                return (
                  <React.Fragment key={symbol}>
                    <tr
                      onClick={() => toggleSymbol(symbol)}
                      className="border-t border-surface-line hover:bg-surface-inset transition-colors cursor-pointer"
                    >
                      <td className="p-3 text-center">
                        <HealthCell symbol={symbol} healthResults={healthResults}
                          onHealthCheck={onHealthCheck} onShowDetail={onShowDetail} />
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-white">{symbol}</p>
                        {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                        <p className="text-[10px] text-slate-500 mt-0.5">{lots.length} 批</p>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {isTW ? avgCost.toFixed(2) : (dc === 'USD' ? fmtUsd(avgCost) : avgCost.toFixed(2))}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalShares)}</td>
                      <td className="p-3 text-right font-mono tabular-nums text-amber-300">
                        {isTW ? fmt(totalCost) : (dc === 'USD' ? fmtUsd(totalCost) : fmt(totalCost))}
                      </td>
                      {!isTW && (
                        <td className="p-3 text-right font-mono tabular-nums text-slate-400 text-xs">
                          {(() => {
                            // 組列顯示「以成本加權的平均買入匯率」；全部批次都沒記匯率才顯示 —
                            const rated = lots.filter(hasBuyRate);
                            if (rated.length === 0) return <span className="text-slate-600">—</span>;
                            const w = rated.reduce((s, l) => s + lotCostUsd(l, rate), 0);
                            const avgRate = w > 0
                              ? rated.reduce((s, l) => s + lotBuyRate(l, rate) * lotCostUsd(l, rate), 0) / w
                              : lotBuyRate(rated[0], rate);
                            return (
                              <>
                                {avgRate.toFixed(3)}
                                {rated.length < lots.length && <span className="text-slate-600 ml-1">(部分)</span>}
                              </>
                            );
                          })()}
                        </td>
                      )}
                      <td className="p-3 text-right font-mono tabular-nums">
                        {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                          : p?.error ? <span className="text-danger text-xs">讀取失敗</span>
                          : currentPrice > 0
                            ? (isTW
                                ? <span className={currentPrice >= avgCost ? 'text-up' : 'text-down'}>{currentPrice.toFixed(2)}</span>
                                : fmtUsd(currentPrice))
                            : '—'}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {dispValue > 0 ? (isTW ? fmt(dispValue) : (dc === 'USD' ? fmtUsd(dispValue) : fmt(dispValue))) : '—'}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {isTW ? fmt(totalCashDividends) : (dc === 'USD' ? fmtUsd(totalCashDividends) : fmt(totalCashDividends))}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalStockDividends)}</td>
                      {spec.showFeeColumn && (
                        <td className="p-3 text-right font-mono tabular-nums">{hasBuyFee ? fmt(totalBuyFee) : '—'}</td>
                      )}
                      <td className="p-3">
                        <PnLCell pnl={pnl} pnlPct={pnlPct} currency={dc} />
                      </td>
                      <td className="p-3 text-right">
                        {expanded ? <ChevronUp size={16} className="ml-auto text-slate-400" /> : <ChevronDown size={16} className="ml-auto text-slate-400" />}
                      </td>
                    </tr>
                    {expanded && lots.map(item => {
                      const p            = prices[item.symbol];
                      const priceUsd     = p?.price ?? 0;
                      const currentPrice = priceUsd;
                      const valueRaw     = priceUsd * item.totalShares;
                      const dispValue    = isTW ? valueRaw : toDisplay(valueRaw);
                      const dispCost     = itemCostInDisplay(item);
                      // TW：證交稅拆列；US：僅手續費（tax 0）
                      const twSell       = isTW ? calcTwSellFeeAndTax(valueRaw, item.symbol) : { sellFee: 0, tax: 0 };
                      const feeUsd       = !isTW && valueRaw > 0 ? calcUsFee(valueRaw, item.isUsEtf ?? false) : 0;
                      const dispFee      = isTW ? twSell.sellFee + twSell.tax : toDisplay(feeUsd);
                      const cashDivDisp  = isTW ? item.cashDividends : (dc === 'USD' ? item.cashDividends / rate : item.cashDividends);
                      const pnl          = (p && !p.loading && !p.error && currentPrice > 0)
                        ? dispValue - dispCost - dispFee + (includeDividend ? cashDivDisp : 0) : null;
                      const pnlPct       = pnl !== null && dispCost > 0 ? (pnl / dispCost) * 100 : null;

                      // avgCostPrice is stored in purchase currency; convert for column display（US only）
                      const dispAvgCost = (() => {
                        if (isTW) return item.avgCostPrice;
                        const br = lotBuyRate(item, rate);   // 成本側一律用買入匯率
                        if (item.purchaseCurrency === 'USD') {
                          return dc === 'USD' ? item.avgCostPrice : item.avgCostPrice * br;
                        }
                        return dc === 'USD' ? item.avgCostPrice / br : item.avgCostPrice;
                      })();

                      return (
                        <tr key={item.id} className="border-t border-surface-line bg-surface-inset/50 hover:bg-surface-inset transition-colors">
                          <td className="p-3 text-center text-xs text-slate-500">明細</td>
                          <td className="p-3">
                            <p className="font-bold text-white">{item.symbol}</p>
                            {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                            {!isTW && (
                              <p className={`text-[10px] mt-0.5 ${item.isUsEtf ? 'text-accent' : 'text-slate-400'}`}>
                                {item.isUsEtf ? 'ETF  · $3/次' : '個股 · 0.08%'}
                                {item.purchaseCurrency && (
                                  <span className="ml-1.5 text-slate-500">買入:{item.purchaseCurrency}</span>
                                )}
                              </p>
                            )}
                            <EditableDateCell value={item.buyDate} onSave={v => onUpdateMeta(item.id, { buyDate: v })} />
                          </td>
                          {isTW ? (
                            <td className="p-3 text-right font-mono tabular-nums">
                              <EditableCell value={item.avgCostPrice} digits={2}
                                onSave={v => onUpdate(item.id, 'avgCostPrice', v)} />
                            </td>
                          ) : (
                            <td className="p-3 text-right text-slate-200 text-sm font-mono tabular-nums">
                              {dc === 'USD' ? fmtUsd(dispAvgCost) : dispAvgCost.toFixed(2)}
                            </td>
                          )}
                          <td className="p-3 text-right font-mono tabular-nums">
                            <EditableCell value={item.totalShares}
                              onSave={v => onUpdate(item.id, 'totalShares', v)} />
                          </td>
                          {isTW ? (
                            <td className="p-3 text-right font-mono tabular-nums">
                              <EditableCell value={item.totalCost}
                                onSave={v => onUpdate(item.id, 'totalCost', v)} cls="text-amber-300" />
                            </td>
                          ) : (
                            <td className="p-3 text-right font-mono tabular-nums">
                              {/* Edit the "fixed" cost in its purchase currency */}
                              {item.purchaseCurrency === 'USD' && item.totalCostUSD != null ? (
                                <div>
                                  <EditableCell value={item.totalCostUSD} digits={2}
                                    onSave={v => onUpdate(item.id, 'totalCostUSD', v)} cls="text-amber-300" />
                                  {dc === 'TWD' && (
                                    <p className="text-[10px] text-slate-500">≈ {fmt(lotCostTwd(item, rate))} TWD</p>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <EditableCell value={item.totalCost}
                                    onSave={v => onUpdate(item.id, 'totalCost', v)} cls="text-amber-300" />
                                  {dc === 'USD' && (
                                    <p className="text-[10px] text-slate-500">≈ {fmtUsd(lotCostUsd(item, rate))}</p>
                                  )}
                                </div>
                              )}
                            </td>
                          )}
                          {!isTW && (
                            <td className="p-3 text-right font-mono tabular-nums">
                              {/* 買入匯率：舊批次為空 → 顯示「—」可點擊補填（不猜、不造史料 D-10） */}
                              <EditableCell value={item.exchangeRate} digits={3}
                                onSave={v => onUpdate(item.id, 'exchangeRate', v)}
                                cls={hasBuyRate(item) ? 'text-slate-300' : 'text-slate-600'} />
                              {!hasBuyRate(item) && (
                                <p className="text-[10px] text-slate-600">暫用 {rate.toFixed(2)}</p>
                              )}
                            </td>
                          )}
                          <td className="p-3 text-right font-mono tabular-nums">
                            {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                              : p?.error  ? <span className="text-danger text-xs">讀取失敗</span>
                              : currentPrice > 0
                                ? (isTW
                                    ? <span className={`font-medium ${currentPrice >= item.avgCostPrice ? 'text-up' : 'text-down'}`}>
                                        {currentPrice.toFixed(2)}
                                      </span>
                                    : <span className={`font-medium ${priceUsd >= (item.purchaseCurrency === 'USD' ? item.avgCostPrice : item.avgCostPrice / lotBuyRate(item, rate)) ? 'text-up' : 'text-down'}`}>
                                        {fmtUsd(priceUsd)}
                                      </span>)
                                : '—'}
                          </td>
                          <td className="p-3 text-right text-slate-200 font-mono tabular-nums">
                            {dispValue > 0 ? (isTW ? fmt(dispValue) : (dc === 'USD' ? fmtUsd(dispValue) : fmt(dispValue))) : '—'}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            <EditableCell value={item.cashDividends}
                              onSave={v => onUpdate(item.id, 'cashDividends', v)} cls="text-up" />
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            <EditableCell value={item.stockDividends}
                              onSave={v => onUpdate(item.id, 'stockDividends', v)} cls="text-accent" />
                          </td>
                          {spec.showFeeColumn && (
                            <td className="p-3 text-right font-mono tabular-nums">
                              <EditableCell value={item.buyFee}
                                onSave={v => onUpdate(item.id, 'buyFee', v)} cls="text-slate-400" />
                            </td>
                          )}
                          <td className="p-3">
                            {isTW ? (
                              <PnLCell pnl={pnl} pnlPct={pnlPct} currency="TWD"
                                feeDetails={(twSell.sellFee > 0 || twSell.tax > 0) ? { sellFee: twSell.sellFee, tax: twSell.tax, label: '證交稅', currentValue: dispValue } : undefined} />
                            ) : (
                              <PnLCell pnl={pnl} pnlPct={pnlPct} currency={dc}
                                feeDetails={feeUsd > 0 ? { sellFee: dispFee, tax: 0, label: '', currentValue: dispValue } : undefined} />
                            )}
                          </td>
                          <td className="p-3">
                            {deleteConfirm === item.id ? (
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => { onDelete(item.id); setDeleteConfirm(null); }}
                                  className="text-xs bg-danger-muted text-danger border border-danger/30 px-2 py-1 rounded-ctl hover:bg-danger/30 transition-colors whitespace-nowrap">確認</button>
                                <button onClick={() => setDeleteConfirm(null)}
                                  className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded-lg hover:bg-slate-600 transition-colors">取消</button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => onSellClick(item)} title="賣出（記入已實現帳本）"
                                  className="text-slate-500 hover:text-up transition-colors p-1.5 rounded-ctl hover:bg-surface-inset flex items-center justify-center">
                                  <Banknote size={15} />
                                </button>
                                <button onClick={() => setDeleteConfirm(item.id)}
                                  className="text-slate-500 hover:text-danger transition-colors p-1.5 rounded-ctl hover:bg-danger-muted flex items-center justify-center">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HoldingsTable;
