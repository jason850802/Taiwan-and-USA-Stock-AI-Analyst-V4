import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PortfolioItem, StockDataPoint } from '../types';
import { getLatestPrice, getStockData } from '../services/yahoo';
import { analyzeTradeDecision, analyzePortfolioHealth, PortfolioHealthItem } from '../services/gemini';
import { estimateVolumeTrend } from '../utils/volume';
import { Plus, Trash2, RefreshCw, Wallet, X, Loader2, ChevronDown, ChevronUp, Info, DollarSign, BrainCircuit, Bot, CalendarDays, MessageSquare, HeartPulse } from 'lucide-react';

interface PortfolioProps {
  items: PortfolioItem[];
  onAdd: (item: Omit<PortfolioItem, 'id'>) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void;
}

interface PriceData { price: number; name: string; loading: boolean; error: boolean }

// ── 判斷台股 ───────────────────────────────────────────────────────────────
const isTwStock = (symbol: string): boolean => {
  const s = symbol.toUpperCase();
  // 台股：含 .TW / .TWO 後綴，或數字代號（可加單一英文字母結尾，如 00631L、00679B、00981A）
  return s.endsWith('.TW') || s.endsWith('.TWO') || /^\d{3,6}[A-Z]?$/.test(s);
};

// ── 台股類型 ────────────────────────────────────────────────────────────────
type TwStockType = 'stock' | 'etf' | 'bond-etf';
const getTwStockType = (symbol: string): TwStockType => {
  const clean = symbol.replace(/\.(TW|TWO)$/i, '').toUpperCase();
  if (clean.startsWith('00')) {
    // B = 台幣計價債券ETF；C = 外幣計價債券ETF → 皆免證交稅
    return (clean.endsWith('B') || clean.endsWith('C')) ? 'bond-etf' : 'etf';
  }
  return 'stock';
};
const getTaxRate = (symbol: string): number => {
  const t = getTwStockType(symbol);
  if (t === 'bond-etf') return 0;
  if (t === 'etf') return 0.001;
  return 0.003;
};

// ── 台股手續費 ──────────────────────────────────────────────────────────────
const calcTwBuyFee = (base: number, discount: number): number =>
  discount > 0 ? Math.max(1, Math.floor(base * (discount / 10) * 0.001425)) : 0;
const calcTwSellFeeAndTax = (value: number, discount: number, symbol: string) => {
  if (value <= 0) return { sellFee: 0, tax: 0 };
  const sellFee = discount > 0 ? Math.max(1, Math.floor(value * (discount / 10) * 0.001425)) : 0;
  const tax = Math.floor(value * getTaxRate(symbol));
  return { sellFee, tax };
};

// ── 美股手續費 ──────────────────────────────────────────────────────────────
// 個股：0.008%（無最低）；ETF：統一 $3 USD；無交易稅
const calcUsFee = (valueUsd: number, isEtf: boolean): number =>
  isEtf ? 3 : valueUsd * 0.00008;

// ── 格式化 ─────────────────────────────────────────────────────────────────
const fmt  = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtUsd = (n: number, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ── 可編輯儲存格 ────────────────────────────────────────────────────────────
const EditableCell: React.FC<{
  value: number; digits?: number;
  onSave: (v: number) => void;
  cls?: string;
}> = ({ value, digits = 0, onSave, cls = 'text-slate-200' }) => {
  const [active, setActive] = useState(false);
  const [draft,  setDraft]  = useState('');
  const display = digits > 0 ? value.toFixed(digits) : String(value);
  return (
    <input type="number"
      value={active ? draft : display}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => { setDraft(display); setActive(true); }}
      onBlur={() => { const n = parseFloat(draft); if (!isNaN(n) && n >= 0) onSave(n); setActive(false); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      title="點擊直接編輯"
      className={`bg-transparent text-right w-24 min-w-0 ${cls}
        hover:bg-slate-700/40 hover:rounded
        focus:bg-slate-700/80 focus:rounded focus:outline-none focus:ring-1 focus:ring-blue-400
        cursor-text transition-all text-sm`}
    />
  );
};

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
      <div className="text-right">
        <p className={`font-bold ${pnl >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {pnl >= 0 ? '+' : ''}{f(pnl)}
        </p>
        {pnlPct !== null && (
          <p className={`text-xs ${pnl >= 0 ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
            ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </p>
        )}
      </div>
      {hasFees && <Info size={12} className="text-slate-500 mt-0.5 shrink-0" />}
      {show && hasFees && feeDetails && (
        <div className="absolute z-50 right-5 top-0 w-60 bg-slate-900 border border-slate-600 rounded-xl shadow-xl p-3 text-xs text-left pointer-events-none whitespace-nowrap">
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

// ── 台股 GroupTable ─────────────────────────────────────────────────────────
interface HealthCheckProps {
  healthResults: Record<string, { status: 'loading' | 'done' | 'error'; decision: string; fullResult: string }>;
  onHealthCheck: (symbol: string) => void;
  onShowDetail: (symbol: string) => void;
}

interface TwGroupTableProps extends HealthCheckProps {
  items: PortfolioItem[];
  prices: Record<string, PriceData>;
  includeDividend: boolean;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void;
}

const TwGroupTable: React.FC<TwGroupTableProps> = ({
  items, prices, includeDividend, deleteConfirm, setDeleteConfirm, onDelete, onUpdate,
  healthResults, onHealthCheck, onShowDetail,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const groupInvested = items.reduce((s, i) => s + i.totalCost, 0);
  const groupValue    = items.reduce((s, i) => {
    const p = prices[i.symbol];
    return (!p || p.loading || p.error) ? s : s + p.price * i.totalShares;
  }, 0);
  const groupSellFees = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    const { sellFee, tax } = calcTwSellFeeAndTax(p.price * i.totalShares, i.brokerDiscount, i.symbol);
    return s + sellFee + tax;
  }, 0);
  const groupCashDiv = items.reduce((s, i) => s + i.cashDividends, 0);
  const groupPnL     = groupValue > 0
    ? groupValue - groupInvested - groupSellFees + (includeDividend ? groupCashDiv : 0) : null;
  const groupPnLPct  = groupPnL !== null && groupInvested > 0 ? (groupPnL / groupInvested) * 100 : null;

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-red-500/20 text-red-400 border-red-500/30">台股</span>
          <span className="text-white font-semibold">台灣股票</span>
          <span className="text-slate-500 text-xs">{items.length} 檔</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {groupPnL !== null && groupPnLPct !== null && (
            <span className={`font-bold ${groupPnL >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {groupPnL >= 0 ? '+' : ''}{fmt(groupPnL)} ({groupPnL >= 0 ? '+' : ''}{groupPnLPct.toFixed(2)}%)
            </span>
          )}
          {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
        </div>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto border-t border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900/40 text-slate-400 font-medium">
                <th className="text-center p-3 whitespace-nowrap">健檢</th>
                <th className="text-left p-3 whitespace-nowrap">代號 / 名稱</th>
                <th className="text-right p-3 whitespace-nowrap">成本均價</th>
                <th className="text-right p-3 whitespace-nowrap">總股數</th>
                <th className="text-right p-3 whitespace-nowrap">總成本 (元)</th>
                <th className="text-right p-3 whitespace-nowrap">目前股價</th>
                <th className="text-right p-3 whitespace-nowrap">目前市值</th>
                <th className="text-right p-3 whitespace-nowrap">現金股利</th>
                <th className="text-right p-3 whitespace-nowrap">股票股利(股)</th>
                <th className="text-right p-3 whitespace-nowrap">券商折扣</th>
                <th className="text-right p-3 whitespace-nowrap">總損益</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const p            = prices[item.symbol];
                const currentPrice = p?.price ?? 0;
                const currentValue = currentPrice * item.totalShares;
                const { sellFee, tax } = calcTwSellFeeAndTax(currentValue, item.brokerDiscount, item.symbol);
                const pnl    = (p && !p.loading && !p.error && currentPrice > 0)
                  ? currentValue - item.totalCost - sellFee - tax + (includeDividend ? item.cashDividends : 0)
                  : null;
                const pnlPct = pnl !== null && item.totalCost > 0 ? (pnl / item.totalCost) * 100 : null;
                return (
                  <tr key={item.id} className="border-t border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                    <td className="p-3 text-center">
                      {(() => {
                        const hr = healthResults[item.symbol];
                        if (!hr) return (
                          <button onClick={() => onHealthCheck(item.symbol)} title="健檢"
                            className="p-1.5 rounded-lg bg-slate-700 hover:bg-rose-600/30 text-slate-400 hover:text-rose-400 transition-all">
                            <HeartPulse size={14} />
                          </button>
                        );
                        if (hr.status === 'loading') return <Loader2 size={14} className="animate-spin text-rose-400 mx-auto" />;
                        const decColor = hr.decision.includes('停損') ? 'text-red-400 bg-red-500/15 border-red-500/30'
                          : hr.decision.includes('停利') ? 'text-orange-400 bg-orange-500/15 border-orange-500/30'
                          : hr.decision.includes('減碼') ? 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30'
                          : hr.decision.includes('續抱') ? 'text-blue-400 bg-blue-500/15 border-blue-500/30'
                          : hr.decision.includes('加碼') ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
                          : 'text-slate-400 bg-slate-700 border-slate-600';
                        return (
                          <button onClick={() => onShowDetail(item.symbol)}
                            className={`text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer hover:brightness-125 transition-all ${decColor}`}>
                            {hr.decision}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-white">{item.symbol}</p>
                      {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.avgCostPrice} digits={2}
                        onSave={v => onUpdate(item.id, 'avgCostPrice', v)} />
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.totalShares}
                        onSave={v => onUpdate(item.id, 'totalShares', v)} />
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.totalCost}
                        onSave={v => onUpdate(item.id, 'totalCost', v)} cls="text-amber-300" />
                    </td>
                    <td className="p-3 text-right">
                      {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                        : p?.error  ? <span className="text-red-400 text-xs">讀取失敗</span>
                        : currentPrice > 0
                          ? <span className={`font-medium ${currentPrice >= item.avgCostPrice ? 'text-red-400' : 'text-emerald-400'}`}>
                              {currentPrice.toFixed(2)}
                            </span>
                          : '—'}
                    </td>
                    <td className="p-3 text-right text-slate-200">{currentValue > 0 ? fmt(currentValue) : '—'}</td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.cashDividends}
                        onSave={v => onUpdate(item.id, 'cashDividends', v)} cls="text-emerald-400" />
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.stockDividends}
                        onSave={v => onUpdate(item.id, 'stockDividends', v)} cls="text-blue-400" />
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.brokerDiscount} digits={1}
                        onSave={v => onUpdate(item.id, 'brokerDiscount', v)} cls="text-slate-400" />
                    </td>
                    <td className="p-3">
                      <PnLCell pnl={pnl} pnlPct={pnlPct} currency="TWD"
                        feeDetails={(sellFee > 0 || tax > 0) ? { sellFee, tax, label: '證交稅', currentValue } : undefined} />
                    </td>
                    <td className="p-3">
                      {deleteConfirm === item.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { onDelete(item.id); setDeleteConfirm(null); }}
                            className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg hover:bg-red-500/30 transition-colors whitespace-nowrap">確認</button>
                          <button onClick={() => setDeleteConfirm(null)}
                            className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded-lg hover:bg-slate-600 transition-colors">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(item.id)}
                          className="text-slate-500 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10 flex items-center justify-center ml-auto">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── 美股 GroupTable ─────────────────────────────────────────────────────────
interface UsGroupTableProps extends HealthCheckProps {
  items: PortfolioItem[];
  prices: Record<string, PriceData>;
  includeDividend: boolean;
  displayCurrency: 'TWD' | 'USD';
  onToggleCurrency: () => void;
  usdTwdRate: number;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof Omit<PortfolioItem, 'id'>, value: number) => void;
}

const UsGroupTable: React.FC<UsGroupTableProps> = ({
  items, prices, includeDividend, displayCurrency, onToggleCurrency, usdTwdRate,
  deleteConfirm, setDeleteConfirm, onDelete, onUpdate,
  healthResults, onHealthCheck, onShowDetail,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const rate = usdTwdRate > 0 ? usdTwdRate : 32; // fallback rate

  // Convert USD value to display currency
  const toDisplay = (usdVal: number) => displayCurrency === 'USD' ? usdVal : usdVal * rate;

  // Cost of item in display currency
  const itemCostInDisplay = (item: PortfolioItem): number => {
    if (item.purchaseCurrency === 'USD' && item.totalCostUSD != null) {
      return toDisplay(item.totalCostUSD);
    }
    // TWD purchase (or legacy): totalCost is TWD
    return displayCurrency === 'USD' ? item.totalCost / rate : item.totalCost;
  };

  const groupCost  = items.reduce((s, i) => s + itemCostInDisplay(i), 0);
  const groupValue = items.reduce((s, i) => {
    const p = prices[i.symbol];
    return (!p || p.loading || p.error) ? s : s + toDisplay(p.price * i.totalShares);
  }, 0);
  const groupFee = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error || p.price <= 0) return s;
    return s + toDisplay(calcUsFee(p.price * i.totalShares, i.isUsEtf ?? false));
  }, 0);
  const groupCashDiv = items.reduce((s, i) => {
    // cashDividends stored in TWD by default
    return s + (displayCurrency === 'USD' ? i.cashDividends / rate : i.cashDividends);
  }, 0);
  const groupPnL    = groupValue > 0
    ? groupValue - groupCost - groupFee + (includeDividend ? groupCashDiv : 0) : null;
  const groupPnLPct = groupPnL !== null && groupCost > 0 ? (groupPnL / groupCost) * 100 : null;
  const dc = displayCurrency;
  const f  = (v: number) => dc === 'USD' ? fmtUsd(v) : `${fmt(v)}`;

  return (
    <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-blue-500/20 text-blue-400 border-blue-500/30">美股</span>
          <span className="text-white font-semibold">美國股票</span>
          <span className="text-slate-500 text-xs">{items.length} 檔</span>
          {usdTwdRate > 0 && (
            <span className="text-xs text-slate-500">1 USD ≈ {fmt(usdTwdRate, 2)} TWD</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Currency toggle — stop propagation so it doesn't collapse the table */}
          <div onClick={e => e.stopPropagation()}
            className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 gap-0.5">
            <button onClick={onToggleCurrency}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all
                ${dc === 'USD' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              USD
            </button>
            <button onClick={onToggleCurrency}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all
                ${dc === 'TWD' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              TWD
            </button>
          </div>
          {groupPnL !== null && groupPnLPct !== null && (
            <span className={`font-bold ${groupPnL >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {groupPnL >= 0 ? '+' : ''}{f(groupPnL)} ({groupPnL >= 0 ? '+' : ''}{groupPnLPct.toFixed(2)}%)
            </span>
          )}
          {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto border-t border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900/40 text-slate-400 font-medium">
                <th className="text-center p-3 whitespace-nowrap">健檢</th>
                <th className="text-left p-3 whitespace-nowrap">代號 / 名稱</th>
                <th className="text-right p-3 whitespace-nowrap">成本均價 ({dc})</th>
                <th className="text-right p-3 whitespace-nowrap">總股數</th>
                <th className="text-right p-3 whitespace-nowrap">總成本 ({dc})</th>
                <th className="text-right p-3 whitespace-nowrap">目前股價 (USD)</th>
                <th className="text-right p-3 whitespace-nowrap">目前市值 ({dc})</th>
                <th className="text-right p-3 whitespace-nowrap">現金股利</th>
                <th className="text-right p-3 whitespace-nowrap">股票股利(股)</th>
                <th className="text-right p-3 whitespace-nowrap">總損益 ({dc})</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const p            = prices[item.symbol];
                const priceUsd     = p?.price ?? 0;
                const valueUsd     = priceUsd * item.totalShares;
                const dispValue    = toDisplay(valueUsd);
                const dispCost     = itemCostInDisplay(item);
                const feeUsd       = valueUsd > 0 ? calcUsFee(valueUsd, item.isUsEtf ?? false) : 0;
                const dispFee      = toDisplay(feeUsd);
                const cashDivDisp  = dc === 'USD' ? item.cashDividends / rate : item.cashDividends;
                const pnl          = (p && !p.loading && !p.error && priceUsd > 0)
                  ? dispValue - dispCost - dispFee + (includeDividend ? cashDivDisp : 0) : null;
                const pnlPct       = pnl !== null && dispCost > 0 ? (pnl / dispCost) * 100 : null;

                // avgCostPrice is stored in purchase currency; convert for column display
                const dispAvgCost = (() => {
                  if (item.purchaseCurrency === 'USD') {
                    return dc === 'USD' ? item.avgCostPrice : item.avgCostPrice * rate;
                  }
                  return dc === 'USD' ? item.avgCostPrice / rate : item.avgCostPrice;
                })();

                return (
                  <tr key={item.id} className="border-t border-slate-700/50 hover:bg-slate-700/20 transition-colors">
                    <td className="p-3 text-center">
                      {(() => {
                        const hr = healthResults[item.symbol];
                        if (!hr) return (
                          <button onClick={() => onHealthCheck(item.symbol)} title="健檢"
                            className="p-1.5 rounded-lg bg-slate-700 hover:bg-rose-600/30 text-slate-400 hover:text-rose-400 transition-all">
                            <HeartPulse size={14} />
                          </button>
                        );
                        if (hr.status === 'loading') return <Loader2 size={14} className="animate-spin text-rose-400 mx-auto" />;
                        const decColor = hr.decision.includes('停損') ? 'text-red-400 bg-red-500/15 border-red-500/30'
                          : hr.decision.includes('停利') ? 'text-orange-400 bg-orange-500/15 border-orange-500/30'
                          : hr.decision.includes('減碼') ? 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30'
                          : hr.decision.includes('續抱') ? 'text-blue-400 bg-blue-500/15 border-blue-500/30'
                          : hr.decision.includes('加碼') ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30'
                          : 'text-slate-400 bg-slate-700 border-slate-600';
                        return (
                          <button onClick={() => onShowDetail(item.symbol)}
                            className={`text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer hover:brightness-125 transition-all ${decColor}`}>
                            {hr.decision}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-white">{item.symbol}</p>
                      {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                      <p className={`text-[10px] mt-0.5 ${item.isUsEtf ? 'text-purple-400' : 'text-sky-400'}`}>
                        {item.isUsEtf ? 'ETF  · $3/次' : '個股 · 0.008%'}
                        {item.purchaseCurrency && (
                          <span className="ml-1.5 text-slate-500">買入:{item.purchaseCurrency}</span>
                        )}
                      </p>
                    </td>
                    <td className="p-3 text-right text-slate-200 text-sm">
                      {dc === 'USD' ? fmtUsd(dispAvgCost) : dispAvgCost.toFixed(2)}
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.totalShares}
                        onSave={v => onUpdate(item.id, 'totalShares', v)} />
                    </td>
                    <td className="p-3 text-right">
                      {/* Edit the "fixed" cost in its purchase currency */}
                      {item.purchaseCurrency === 'USD' && item.totalCostUSD != null ? (
                        <div>
                          <EditableCell value={item.totalCostUSD} digits={2}
                            onSave={v => onUpdate(item.id, 'totalCostUSD', v)} cls="text-amber-300" />
                          {dc === 'TWD' && (
                            <p className="text-[10px] text-slate-500">≈ {fmt(item.totalCostUSD * rate)} TWD</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <EditableCell value={item.totalCost}
                            onSave={v => onUpdate(item.id, 'totalCost', v)} cls="text-amber-300" />
                          {dc === 'USD' && (
                            <p className="text-[10px] text-slate-500">≈ {fmtUsd(item.totalCost / rate)}</p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                        : p?.error  ? <span className="text-red-400 text-xs">讀取失敗</span>
                        : priceUsd > 0
                          ? <span className={`font-medium ${priceUsd >= (item.purchaseCurrency === 'USD' ? item.avgCostPrice : item.avgCostPrice / rate) ? 'text-red-400' : 'text-emerald-400'}`}>
                              {fmtUsd(priceUsd)}
                            </span>
                          : '—'}
                    </td>
                    <td className="p-3 text-right text-slate-200">
                      {dispValue > 0 ? (dc === 'USD' ? fmtUsd(dispValue) : fmt(dispValue)) : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.cashDividends}
                        onSave={v => onUpdate(item.id, 'cashDividends', v)} cls="text-emerald-400" />
                    </td>
                    <td className="p-3 text-right">
                      <EditableCell value={item.stockDividends}
                        onSave={v => onUpdate(item.id, 'stockDividends', v)} cls="text-blue-400" />
                    </td>
                    <td className="p-3">
                      <PnLCell pnl={pnl} pnlPct={pnlPct} currency={dc}
                        feeDetails={feeUsd > 0 ? { sellFee: dispFee, tax: 0, label: '', currentValue: dispValue } : undefined} />
                    </td>
                    <td className="p-3">
                      {deleteConfirm === item.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => { onDelete(item.id); setDeleteConfirm(null); }}
                            className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded-lg hover:bg-red-500/30 transition-colors whitespace-nowrap">確認</button>
                          <button onClick={() => setDeleteConfirm(null)}
                            className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded-lg hover:bg-slate-600 transition-colors">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(item.id)}
                          className="text-slate-500 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10 flex items-center justify-center ml-auto">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ── 主元件 ─────────────────────────────────────────────────────────────────
const Portfolio: React.FC<PortfolioProps> = ({ items, onAdd, onDelete, onUpdate }) => {
  const [prices,          setPrices]          = useState<Record<string, PriceData>>({});
  const [usdTwdRate,      setUsdTwdRate]      = useState<number>(0);
  const [showAddModal,    setShowAddModal]    = useState(false);
  const [deleteConfirm,   setDeleteConfirm]  = useState<string | null>(null);
  const [includeDividend, setIncludeDividend] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<'TWD' | 'USD'>('USD');

  // 新增持股與AI分析 狀態
  const [isAnalyzeMode,   setIsAnalyzeMode]   = useState(false);
  const [tradeAnalyzing,  setTradeAnalyzing]  = useState(false);
  const [tradeResult,     setTradeResult]     = useState<string>('');
  const [showTradeResult, setShowTradeResult] = useState(false);

  // 庫存健檢 狀態（per-stock）
  const [healthResults, setHealthResults] = useState<Record<string, { status: 'loading' | 'done' | 'error'; decision: string; fullResult: string }>>({});
  const [healthModalSymbol, setHealthModalSymbol] = useState<string | null>(null);

  // 新增表單
  const [form, setForm] = useState({
    symbol:           '',
    inputMode:        'avg' as 'avg' | 'total',
    avgCostPrice:     '',
    totalCostInput:   '',
    totalShares:      '',
    brokerDiscount:   '',
    cashDividends:    '',
    stockDividends:   '',
    purchaseCurrency: 'USD' as 'TWD' | 'USD', // for US stocks
    isUsEtf:          false,
    buyDate:          '',     // 買入時間（分析用）
    buyReason:        '',     // 買入原因（分析用）
  });

  // ── 報價抓取 ───────────────────────────────────────────────────────────
  const fetchPrice = useCallback(async (symbol: string) => {
    setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: true, error: false } }));
    try {
      const r = await getLatestPrice(symbol);
      setPrices(prev => ({ ...prev, [symbol]: { ...r, loading: false, error: false } }));
    } catch {
      setPrices(prev => ({ ...prev, [symbol]: { price: 0, name: symbol, loading: false, error: true } }));
    }
  }, []);

  const fetchExchangeRate = useCallback(async () => {
    try {
      const r = await getLatestPrice('USDTWD=X');
      if (r.price > 0) setUsdTwdRate(r.price);
    } catch { /* ignore */ }
  }, []);

  const fetchAllPrices = useCallback(() => {
    items.forEach(i => fetchPrice(i.symbol));
    // Fetch exchange rate if any US stock exists
    if (items.some(i => !isTwStock(i.symbol))) fetchExchangeRate();
  }, [items, fetchPrice, fetchExchangeRate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length > 0) fetchAllPrices();
  }, [items.map(i => i.symbol).join(',')]);

  // ── 表單輔助 ───────────────────────────────────────────────────────────
  const formIsTW = isTwStock(form.symbol);
  const discount = parseFloat(form.brokerDiscount) || 0;
  const shares   = parseFloat(form.totalShares)    || 0;
  const rate     = usdTwdRate > 0 ? usdTwdRate : 32;

  const preview = (() => {
    const avg       = parseFloat(form.avgCostPrice)   || 0;
    const totalInp  = parseFloat(form.totalCostInput) || 0;

    if (formIsTW) {
      // Taiwan stock — same as before
      if (form.inputMode === 'avg') {
        const base   = avg * shares;
        const buyFee = calcTwBuyFee(base, discount);
        const total  = base + buyFee;
        return { base, buyFee, total, adjAvg: shares > 0 ? total / shares : avg, feeLabel: `買進手續費（${form.brokerDiscount}折）` };
      } else {
        const total = totalInp;
        return { base: total, buyFee: 0, total, adjAvg: shares > 0 ? total / shares : 0, feeLabel: '' };
      }
    } else {
      // US stock
      const isEtf = form.isUsEtf;
      if (form.purchaseCurrency === 'USD') {
        if (form.inputMode === 'avg') {
          const baseUsd  = avg * shares;
          const feeUsd   = calcUsFee(baseUsd, isEtf);
          const totalUsd = baseUsd + feeUsd;
          const totalTwd = totalUsd * rate;
          return { base: baseUsd, buyFee: feeUsd, total: totalUsd, adjAvg: shares > 0 ? totalUsd / shares : avg, totalTwd, feeLabel: isEtf ? 'ETF手續費 $3' : '個股手續費 0.008%' };
        } else {
          const totalUsd = totalInp;
          const totalTwd = totalUsd * rate;
          return { base: totalUsd, buyFee: 0, total: totalUsd, adjAvg: shares > 0 ? totalUsd / shares : 0, totalTwd, feeLabel: '' };
        }
      } else {
        // TWD purchase
        if (form.inputMode === 'avg') {
          const baseTwd  = avg * shares;
          const baseUsd  = baseTwd / rate;
          const feeUsd   = calcUsFee(baseUsd, isEtf);
          const feeTwd   = feeUsd * rate;
          const totalTwd = baseTwd + feeTwd;
          return { base: baseTwd, buyFee: feeTwd, total: totalTwd, adjAvg: shares > 0 ? totalTwd / shares : avg, feeUsd, feeLabel: isEtf ? 'ETF手續費 $3' : '個股手續費 0.008%' };
        } else {
          const totalTwd = totalInp;
          return { base: totalTwd, buyFee: 0, total: totalTwd, adjAvg: shares > 0 ? totalTwd / shares : 0, feeLabel: '' };
        }
      }
    }
  })();

  // ── 新增 ───────────────────────────────────────────────────────────────
  const handleAdd = () => {
    if (!form.symbol || shares <= 0 || preview.total <= 0) return;
    const sym = form.symbol.trim().toUpperCase();

    if (formIsTW) {
      onAdd({
        symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
        totalCost: preview.total, brokerDiscount: discount,
        cashDividends: parseFloat(form.cashDividends) || 0,
        stockDividends: parseFloat(form.stockDividends) || 0,
      });
    } else {
      if (form.purchaseCurrency === 'USD') {
        onAdd({
          symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
          totalCost: 0,                        // not used for USD purchase
          totalCostUSD: preview.total,         // fixed USD cost
          purchaseCurrency: 'USD', isUsEtf: form.isUsEtf,
          brokerDiscount: 0,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
        });
      } else {
        onAdd({
          symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
          totalCost: preview.total,            // fixed TWD cost
          purchaseCurrency: 'TWD', isUsEtf: form.isUsEtf,
          brokerDiscount: 0,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
        });
      }
    }

    setForm({ symbol: '', inputMode: 'avg', avgCostPrice: '', totalCostInput: '',
              totalShares: '', brokerDiscount: '', cashDividends: '', stockDividends: '',
              purchaseCurrency: 'USD', isUsEtf: false, buyDate: '', buyReason: '' });
    setShowAddModal(false);
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

  // ── 單檔庫存健檢 ──────────────────────────────────────────────────────
  const handleSingleHealthCheck = useCallback(async (symbol: string) => {
    const item = items.find(i => i.symbol === symbol);
    if (!item) return;

    setHealthResults(prev => ({ ...prev, [symbol]: { status: 'loading', decision: '', fullResult: '' } }));

    try {
      const p = prices[symbol];
      const currentPrice = p && !p.loading && !p.error ? p.price : 0;

      // 美股：currentPrice 永遠是 USD；avgCostPrice 若以 TWD 購入需先換算成 USD
      const isUS = !isTwStock(symbol);
      const rate = usdTwdRate > 0 ? usdTwdRate : 32;
      const avgCostPriceInCurrentCurrency = isUS && (item.purchaseCurrency === 'TWD' || !item.purchaseCurrency)
        ? item.avgCostPrice / rate   // TWD → USD
        : item.avgCostPrice;         // 台股 TWD / 美股已是 USD

      const profitPct = avgCostPriceInCurrentCurrency > 0 && currentPrice > 0
        ? ((currentPrice - avgCostPriceInCurrentCurrency) / avgCostPriceInCurrentCurrency) * 100 : 0;

      let recentData: StockDataPoint[] = [];
      let volProj = null;
      try {
        const { data } = await getStockData(symbol, '1d');
        recentData = data;
        volProj = estimateVolumeTrend(data, isTwStock(symbol), '1d');
      } catch { /* continue without data */ }

      const healthItem: PortfolioHealthItem = {
        symbol, name: p?.name || symbol, avgCostPrice: avgCostPriceInCurrentCurrency,
        currentPrice, totalShares: item.totalShares, profitPct, recentData, volumeProjection: volProj,
      };

      const result = await analyzePortfolioHealth([healthItem]);

      // 從結果中提取決策
      const decisionMatch = result.match(/操作決策[：:]\s*(🟢\s*加碼|🔵\s*續抱|🟡\s*減碼|🟠\s*停利|🔴\s*停損)/);
      const decision = decisionMatch ? decisionMatch[1] : '分析完成';

      setHealthResults(prev => ({ ...prev, [symbol]: { status: 'done', decision, fullResult: result } }));
    } catch {
      setHealthResults(prev => ({ ...prev, [symbol]: { status: 'error', decision: '分析失敗', fullResult: '**庫存健檢分析失敗**\n\n請稍後再試。' } }));
    }
  }, [items, prices, usdTwdRate]);

  // ── 分組 ───────────────────────────────────────────────────────────────
  const twItems = items.filter(i =>  isTwStock(i.symbol));
  const usItems = items.filter(i => !isTwStock(i.symbol));

  // ── 全局摘要（統一換算 TWD） ───────────────────────────────────────────
  const twInvested  = twItems.reduce((s, i) => s + i.totalCost, 0);
  const usInvestedTwd = usItems.reduce((s, i) => {
    if (i.purchaseCurrency === 'USD' && i.totalCostUSD != null)
      return s + i.totalCostUSD * rate;
    return s + i.totalCost;
  }, 0);
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
      const { sellFee, tax } = calcTwSellFeeAndTax(p.price * i.totalShares, i.brokerDiscount, i.symbol);
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

  const inputCls = "w-full bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all placeholder:text-slate-600 text-sm";

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
        <div>
          <h2 className="text-2xl font-bold text-white mb-1">我的庫存</h2>
          <p className="text-slate-400 text-sm">台股含手續費與證交稅・美股個股 0.008%・ETF $3/次</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1">
            <button onClick={() => setIncludeDividend(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${includeDividend ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              含息損益
            </button>
            <button onClick={() => setIncludeDividend(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${!includeDividend ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
              不含息損益
            </button>
          </div>
          <button onClick={fetchAllPrices}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <RefreshCw size={15} /> 更新報價
          </button>
          <button onClick={() => { setIsAnalyzeMode(false); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-600/20">
            <Plus size={15} /> 新增持股
          </button>
          <button onClick={() => { setIsAnalyzeMode(true); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-lg shadow-purple-600/20">
            <BrainCircuit size={15} /> 新增持股與分析
          </button>
        </div>
      </div>

      {/* ── 全局摘要 ───────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">總投入成本 (TWD)</p>
            <p className="text-xl font-bold text-amber-300">{fmt(totalInvested)} 元</p>
            <p className="text-[10px] text-slate-500 mt-1">美股依即時匯率換算</p>
          </div>
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">目前市值 (TWD)</p>
            <p className="text-xl font-bold text-white">{hasAnyPrice ? fmt(totalValue) + ' 元' : '—'}</p>
            {usdTwdRate > 0 && <p className="text-[10px] text-slate-500 mt-1">USD/TWD {fmt(usdTwdRate, 2)}</p>}
          </div>
          <div className="bg-slate-800 p-4 rounded-xl border border-emerald-500/20">
            <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">已領現金股利</p>
            <p className="text-xl font-bold text-emerald-400">{fmt(totalCashDiv)} 元</p>
          </div>
          <div className={`bg-slate-800 p-4 rounded-xl border
            ${totalPnL !== null ? (totalPnL >= 0 ? 'border-red-500/30' : 'border-emerald-500/30') : 'border-slate-700'}`}>
            <p className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">
              總損益 (TWD)
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-normal normal-case
                ${includeDividend ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600 text-slate-400'}`}>
                {includeDividend ? '含息' : '不含息'}
              </span>
            </p>
            {totalPnL !== null && totalPnLPct !== null ? (
              <>
                <p className={`text-xl font-bold ${totalPnL >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}{fmt(totalPnL)} 元
                </p>
                <p className={`text-xs mt-0.5 ${totalPnL >= 0 ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
                  ({totalPnL >= 0 ? '+' : ''}{totalPnLPct.toFixed(2)}%)
                </p>
              </>
            ) : <p className="text-xl font-bold text-slate-500">—</p>}
          </div>
        </div>
      )}

      {/* ── 空狀態 ──────────────────────────────────────────────────────── */}
      {items.length === 0 && (
        <div className="bg-slate-800/50 border border-slate-700 border-dashed rounded-xl p-16 flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-slate-800 rounded-full mb-4">
            <Wallet className="text-slate-500 w-8 h-8" />
          </div>
          <h3 className="text-slate-300 font-medium mb-2 text-lg">尚無持股紀錄</h3>
          <p className="text-slate-500 mb-6">點擊「新增持股」按鈕來加入您的庫存</p>
          <button onClick={() => { setIsAnalyzeMode(false); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all">
            <Plus size={16} /> 新增持股
          </button>
        </div>
      )}

      {/* ── 台股 ────────────────────────────────────────────────────────── */}
      {twItems.length > 0 && (
        <TwGroupTable items={twItems} prices={prices} includeDividend={includeDividend}
          deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm}
          onDelete={onDelete} onUpdate={onUpdate}
          healthResults={healthResults} onHealthCheck={handleSingleHealthCheck} onShowDetail={setHealthModalSymbol} />
      )}

      {/* ── 美股 ────────────────────────────────────────────────────────── */}
      {usItems.length > 0 && (
        <UsGroupTable items={usItems} prices={prices} includeDividend={includeDividend}
          displayCurrency={displayCurrency} onToggleCurrency={() => setDisplayCurrency(d => d === 'USD' ? 'TWD' : 'USD')}
          usdTwdRate={usdTwdRate} deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm}
          onDelete={onDelete} onUpdate={onUpdate}
          healthResults={healthResults} onHealthCheck={handleSingleHealthCheck} onShowDetail={setHealthModalSymbol} />
      )}

      {/* ── 新增 Modal ───────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/50">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {isAnalyzeMode
                  ? <><BrainCircuit size={20} className="text-purple-400" /> 新增持股與 AI 分析</>
                  : <><Plus size={20} className="text-blue-400" /> 新增持股</>
                }
              </h3>
              <button onClick={() => { setShowAddModal(false); setIsAnalyzeMode(false); }} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* 代號 */}
              <div>
                <label className="text-slate-300 text-sm font-medium block mb-1.5">
                  股票代號 <span className="text-red-400">*</span>
                </label>
                <input type="text" value={form.symbol}
                  onChange={e => setForm(p => ({ ...p, symbol: e.target.value }))}
                  placeholder="台股：2330 ／ 美股：AAPL, SPY" className={inputCls} />
                {form.symbol && (
                  <p className={`text-xs mt-1.5 px-1 ${formIsTW ? 'text-red-400' : 'text-blue-400'}`}>
                    {formIsTW ? '🇹🇼 台股，將計算買進手續費' : '🇺🇸 美股，請選擇購入幣別與股票類型'}
                  </p>
                )}
              </div>

              {/* 美股：幣別 + 個股/ETF 選擇 */}
              {!formIsTW && form.symbol && (
                <div className="space-y-3">
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">購入幣別</label>
                    <div className="flex bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1">
                      <button onClick={() => setForm(p => ({ ...p, purchaseCurrency: 'USD' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5
                          ${form.purchaseCurrency === 'USD' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                        <DollarSign size={13} /> 美元 (USD)
                      </button>
                      <button onClick={() => setForm(p => ({ ...p, purchaseCurrency: 'TWD' }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${form.purchaseCurrency === 'TWD' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                        TWD 台幣
                      </button>
                    </div>
                    {form.purchaseCurrency === 'TWD' && (
                      <p className="text-xs text-slate-500 mt-1.5 px-1">
                        以 TWD 購入：總成本(TWD)固定，USD換算依即時匯率計算
                        {usdTwdRate > 0 && `（目前匯率約 ${fmt(usdTwdRate, 2)}）`}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">股票類型</label>
                    <div className="flex bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1">
                      <button onClick={() => setForm(p => ({ ...p, isUsEtf: false }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${!form.isUsEtf ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                        個股（0.008%）
                      </button>
                      <button onClick={() => setForm(p => ({ ...p, isUsEtf: true }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${form.isUsEtf ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                        ETF（$3/次）
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 輸入模式 */}
              <div>
                <label className="text-slate-300 text-sm font-medium block mb-1.5">成本輸入方式</label>
                <div className="flex bg-slate-900 border border-slate-700 rounded-xl p-1 gap-1">
                  <button onClick={() => setForm(p => ({ ...p, inputMode: 'avg' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                      ${form.inputMode === 'avg' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
                    輸入成本均價
                  </button>
                  <button onClick={() => setForm(p => ({ ...p, inputMode: 'total' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                      ${form.inputMode === 'total' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>
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
                      <span className="text-red-400"> *</span>
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
                      <span className="text-red-400"> *</span>
                    </label>
                    <input type="number" value={form.totalCostInput}
                      onChange={e => setForm(p => ({ ...p, totalCostInput: e.target.value }))}
                      placeholder={!formIsTW && form.purchaseCurrency === 'USD' ? '例：18550.00' : '例：500200'}
                      className={inputCls} />
                  </div>
                )}
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">
                    總股數 <span className="text-red-400">*</span>
                  </label>
                  <input type="number" value={form.totalShares}
                    onChange={e => setForm(p => ({ ...p, totalShares: e.target.value }))}
                    placeholder="例：100" className={inputCls} />
                </div>
              </div>

              {/* 券商折扣（台股） */}
              {formIsTW && (
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">
                    券商折扣
                    <span className="text-slate-500 font-normal ml-1">（例：2.8 = 2.8折）</span>
                  </label>
                  <input type="number" step="0.1" value={form.brokerDiscount}
                    onChange={e => setForm(p => ({ ...p, brokerDiscount: e.target.value }))}
                    placeholder="例：2.8" className={inputCls} />
                </div>
              )}

              {/* 試算預覽 */}
              {preview.total > 0 && shares > 0 && (
                <div className="bg-slate-900/60 rounded-xl p-4 border border-amber-500/20 space-y-1.5 text-xs">
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
                          {!formIsTW && form.purchaseCurrency === 'USD' && usdTwdRate > 0 && (
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

              {/* 買入時間與原因（分析模式專用） */}
              {isAnalyzeMode && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="border-t border-purple-500/20 pt-3">
                    <p className="text-purple-300 text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5">
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
                          <MessageSquare size={14} className="text-slate-400" /> 買入原因 <span className="text-red-400">*</span>
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
                <button onClick={handleAddAndAnalyze}
                  disabled={!form.symbol || shares <= 0 || preview.total <= 0 || !form.buyReason.trim()}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  <BrainCircuit size={18} /> 新增並 AI 分析
                </button>
              ) : (
                <button onClick={handleAdd}
                  disabled={!form.symbol || shares <= 0 || preview.total <= 0}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-3.5 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  確認新增
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AI 分析中 Loading Overlay ────────────────────────────────── */}
      {tradeAnalyzing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-800 border border-purple-500/30 rounded-2xl p-10 flex flex-col items-center gap-5 shadow-2xl max-w-sm w-full mx-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-purple-500/20 flex items-center justify-center">
                <BrainCircuit className="text-purple-400 animate-pulse" size={32} />
              </div>
              <div className="absolute inset-0 rounded-full border-2 border-purple-500/50 animate-spin border-t-transparent" />
            </div>
            <div className="text-center">
              <p className="text-white font-bold text-lg">AI 思考分析中</p>
              <p className="text-slate-400 text-sm mt-1">正在評估您的買入決策，請稍候…</p>
              <p className="text-slate-500 text-xs mt-1">使用 Gemini 3.1 Pro 思考模式</p>
            </div>
          </div>
        </div>
      )}

      {/* ── AI 分析結果 Modal ────────────────────────────────────────── */}
      {showTradeResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-gradient-to-r from-purple-600/20 to-indigo-600/20 shrink-0">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <BrainCircuit size={20} className="text-purple-400" /> AI 買入決策評估報告
              </h3>
              <button onClick={() => setShowTradeResult(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto p-6 text-slate-300 prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({node, ...props}) => (
                    <h2 className="text-xl font-bold text-white mt-2 mb-4 pb-3 border-b border-slate-700 flex items-center gap-2" {...props} />
                  ),
                  h3: ({node, ...props}) => (
                    <h3 className="text-lg font-bold text-purple-300 mt-6 mb-3 pt-4 border-t border-slate-700/50" {...props} />
                  ),
                  strong: ({node, children, ...props}) => {
                    const text = children?.toString() || '';
                    if (['停損', '風險', '出場', '減碼'].some(k => text.includes(k)))
                      return <strong className="text-red-400 font-bold" {...props}>{children}</strong>;
                    if (['加碼', '目標', '突破', '買入', '策略'].some(k => text.includes(k)))
                      return <strong className="text-emerald-400 font-bold" {...props}>{children}</strong>;
                    return <strong className="text-blue-200 font-bold" {...props}>{children}</strong>;
                  },
                  ul: ({node, ...props}) => <ul className="space-y-2 my-3 pl-5 list-disc marker:text-purple-400" {...props} />,
                  ol: ({node, ...props}) => <ol className="space-y-2 my-3 pl-5 list-decimal marker:text-purple-400" {...props} />,
                  li: ({node, ...props}) => <li className="text-slate-200 leading-relaxed" {...props} />,
                  p:  ({node, ...props}) => <p className="mb-3 leading-7 text-slate-200" {...props} />,
                  table: ({node, ...props}) => (
                    <div className="overflow-x-auto my-4">
                      <table className="w-full text-sm border-collapse" {...props} />
                    </div>
                  ),
                  thead: ({node, ...props}) => (
                    <thead className="bg-slate-700/60" {...props} />
                  ),
                  tbody: ({node, ...props}) => (
                    <tbody className="divide-y divide-slate-700/40" {...props} />
                  ),
                  tr: ({node, ...props}) => (
                    <tr className="hover:bg-slate-700/30 transition-colors" {...props} />
                  ),
                  th: ({node, ...props}) => (
                    <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 uppercase tracking-wider border border-slate-600/50" {...props} />
                  ),
                  td: ({node, children, ...props}) => {
                    const text = String(children ?? '');
                    const isPass = text === '✅';
                    const isWarn = text === '⚠️';
                    const isFail = text === '❌';
                    return (
                      <td
                        className={`px-3 py-2 border border-slate-700/40 text-sm align-top
                          ${isPass ? 'text-emerald-400 text-center font-bold text-base' : ''}
                          ${isWarn ? 'text-amber-400 text-center font-bold text-base' : ''}
                          ${isFail ? 'text-red-400 text-center font-bold text-base' : 'text-slate-200'}
                        `}
                        {...props}
                      >
                        {children}
                      </td>
                    );
                  },
                }}
              >
                {tradeResult}
              </ReactMarkdown>
            </div>
            <div className="p-4 border-t border-slate-700 shrink-0">
              <button onClick={() => setShowTradeResult(false)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 py-2.5 rounded-xl font-medium transition-all text-sm">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 個股健檢結果 Modal ────────────────────────────────────────── */}
      {healthModalSymbol && healthResults[healthModalSymbol]?.fullResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-slate-700 bg-gradient-to-r from-rose-600/20 to-orange-600/20 shrink-0">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <HeartPulse size={20} className="text-rose-400" /> 持股健檢：{healthModalSymbol}
              </h3>
              <button onClick={() => setHealthModalSymbol(null)} className="text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto p-6 text-slate-300 prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({node, ...props}) => (
                    <h2 className="text-xl font-bold text-white mt-2 mb-4 pb-3 border-b border-slate-700 flex items-center gap-2" {...props} />
                  ),
                  h3: ({node, ...props}) => (
                    <h3 className="text-lg font-bold text-rose-300 mt-6 mb-3 pt-4 border-t border-slate-700/50" {...props} />
                  ),
                  strong: ({node, children, ...props}) => {
                    const text = children?.toString() || '';
                    if (['停損', '風險', '出場', '🔴', '❌'].some(k => text.includes(k)))
                      return <strong className="text-red-400 font-bold" {...props}>{children}</strong>;
                    if (['加碼', '突破', '🟢', '✅'].some(k => text.includes(k)))
                      return <strong className="text-emerald-400 font-bold" {...props}>{children}</strong>;
                    if (['停利', '🟠'].some(k => text.includes(k)))
                      return <strong className="text-orange-400 font-bold" {...props}>{children}</strong>;
                    if (['續抱', '🔵'].some(k => text.includes(k)))
                      return <strong className="text-blue-400 font-bold" {...props}>{children}</strong>;
                    if (['減碼', '🟡'].some(k => text.includes(k)))
                      return <strong className="text-yellow-400 font-bold" {...props}>{children}</strong>;
                    return <strong className="text-blue-200 font-bold" {...props}>{children}</strong>;
                  },
                  ul: ({node, ...props}) => <ul className="space-y-2 my-3 pl-5 list-disc marker:text-rose-400" {...props} />,
                  ol: ({node, ...props}) => <ol className="space-y-2 my-3 pl-5 list-decimal marker:text-rose-400" {...props} />,
                  li: ({node, ...props}) => <li className="text-slate-200 leading-relaxed" {...props} />,
                  p:  ({node, ...props}) => <p className="mb-3 leading-7 text-slate-200" {...props} />,
                  table: ({node, ...props}) => (
                    <div className="overflow-x-auto my-4">
                      <table className="w-full text-sm border-collapse" {...props} />
                    </div>
                  ),
                  thead: ({node, ...props}) => <thead className="bg-slate-700/60" {...props} />,
                  tbody: ({node, ...props}) => <tbody className="divide-y divide-slate-700/40" {...props} />,
                  tr: ({node, ...props}) => <tr className="hover:bg-slate-700/30 transition-colors" {...props} />,
                  th: ({node, ...props}) => (
                    <th className="px-3 py-2 text-left text-xs font-bold text-slate-300 uppercase tracking-wider border border-slate-600/50" {...props} />
                  ),
                  td: ({node, children, ...props}) => {
                    const text = String(children ?? '');
                    let colorCls = 'text-slate-200';
                    if (text.includes('✅'))      colorCls = 'text-emerald-400 font-bold';
                    else if (text.includes('✔'))  colorCls = 'text-red-400 font-bold';
                    else if (text.includes('⛔')) colorCls = 'text-orange-400 font-bold';
                    else if (text.includes('⚠️')) colorCls = 'text-amber-400 font-bold';
                    else if (text.includes('➖')) colorCls = 'text-slate-400';
                    else if (text.includes('－')) colorCls = 'text-emerald-400 font-bold';
                    return (
                      <td className={`px-3 py-2 border border-slate-700/40 text-sm align-top ${colorCls}`} {...props}>{children}</td>
                    );
                  },
                }}
              >
                {healthResults[healthModalSymbol].fullResult}
              </ReactMarkdown>
            </div>
            <div className="p-4 border-t border-slate-700 shrink-0">
              <button onClick={() => setHealthModalSymbol(null)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 py-2.5 rounded-xl font-medium transition-all text-sm">
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Portfolio;
