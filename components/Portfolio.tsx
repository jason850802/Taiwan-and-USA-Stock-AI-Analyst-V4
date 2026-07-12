import React, { useState, useEffect, useCallback } from 'react';
import { PortfolioItem, StockDataPoint } from '../types';
import { getLatestPrice, getStockData } from '../services/yahoo';
import { analyzeTradeDecision, analyzePortfolioHealth, PortfolioHealthItem } from '../services/gemini';
import { parseHealthDecisions, extractDecisionByRegex, splitHealthReport, DECISION_EMOJI } from '../services/_shared/healthDecision';
import { estimateVolumeTrend } from '../utils/volume';
import { Plus, Trash2, RefreshCw, Wallet, Loader2, ChevronDown, ChevronUp, Info, DollarSign, BrainCircuit, CalendarDays, MessageSquare, HeartPulse } from 'lucide-react';
import Badge from './ui/Badge';
import Button from './ui/Button';
import StatCard from './ui/StatCard';
import MarkdownReport from './ui/MarkdownReport';
import Modal from './ui/Modal';
import Skeleton from './ui/Skeleton';

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
const calcTwBuyFee = (base: number): number =>
  base > 0 ? Math.max(1, Math.floor(base * 0.001425)) : 0;
const calcTwSellFeeAndTax = (value: number, symbol: string) => {
  if (value <= 0) return { sellFee: 0, tax: 0 };
  const sellFee = Math.max(1, Math.floor(value * 0.001425));
  const tax = Math.floor(value * getTaxRate(symbol));
  return { sellFee, tax };
};

// ── 美股手續費 ──────────────────────────────────────────────────────────────
// 個股：0.008%（無最低）；ETF：統一 $3 USD；無交易稅
const calcUsFee = (valueUsd: number, isEtf: boolean): number =>
  isEtf ? 3 : valueUsd * 0.00008;

// lots 維持逐筆儲存，只在渲染時依 symbol 保序分組。
const groupLotsBySymbol = (items: PortfolioItem[]): Map<string, PortfolioItem[]> => {
  const groups = new Map<string, PortfolioItem[]>();
  items.forEach(item => {
    const lots = groups.get(item.symbol) ?? [];
    lots.push(item);
    groups.set(item.symbol, lots);
  });
  return groups;
};

// ── 格式化 ─────────────────────────────────────────────────────────────────
const fmt  = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtUsd = (n: number, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

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
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());

  const toggleSymbol = (symbol: string) => {
    setExpandedSymbols(current => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const groupInvested = items.reduce((s, i) => s + i.totalCost, 0);
  const groupValue    = items.reduce((s, i) => {
    const p = prices[i.symbol];
    return (!p || p.loading || p.error) ? s : s + p.price * i.totalShares;
  }, 0);
  const groupSellFees = items.reduce((s, i) => {
    const p = prices[i.symbol];
    if (!p || p.loading || p.error) return s;
    const { sellFee, tax } = calcTwSellFeeAndTax(p.price * i.totalShares, i.symbol);
    return s + sellFee + tax;
  }, 0);
  const groupCashDiv = items.reduce((s, i) => s + i.cashDividends, 0);
  const groupPnL     = groupValue > 0
    ? groupValue - groupInvested - groupSellFees + (includeDividend ? groupCashDiv : 0) : null;
  const groupPnLPct  = groupPnL !== null && groupInvested > 0 ? (groupPnL / groupInvested) * 100 : null;

  return (
    <div className="bg-surface-card rounded-card border border-surface-line overflow-hidden">
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors">
        <div className="flex items-center gap-3">
          <Badge variant="neutral">台股</Badge>
          <span className="text-white font-semibold">台灣股票</span>
          <span className="text-slate-500 text-xs">{groupLotsBySymbol(items).size} 檔</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {groupPnL !== null && groupPnLPct !== null && (
            <span className={`font-bold font-mono tabular-nums ${groupPnL >= 0 ? 'text-up' : 'text-down'}`}>
              {groupPnL >= 0 ? '+' : ''}{fmt(groupPnL)} ({groupPnL >= 0 ? '+' : ''}{groupPnLPct.toFixed(2)}%)
            </span>
          )}
          {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
        </div>
      </button>
      {!collapsed && (
        <div className="overflow-x-auto border-t border-surface-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr className="text-slate-400 font-medium">
                <th className="text-center p-3 whitespace-nowrap">健檢</th>
                <th className="text-left p-3 whitespace-nowrap">代號 / 名稱</th>
                <th className="text-right p-3 whitespace-nowrap">成本均價</th>
                <th className="text-right p-3 whitespace-nowrap">總股數</th>
                <th className="text-right p-3 whitespace-nowrap">總成本 (元)</th>
                <th className="text-right p-3 whitespace-nowrap">目前股價</th>
                <th className="text-right p-3 whitespace-nowrap">目前市值</th>
                <th className="text-right p-3 whitespace-nowrap">現金股利</th>
                <th className="text-right p-3 whitespace-nowrap">股票股利(股)</th>
                <th className="text-right p-3 whitespace-nowrap">手續費</th>
                <th className="text-right p-3 whitespace-nowrap">總損益</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {Array.from(groupLotsBySymbol(items)).map(([symbol, lots]) => {
                const p = prices[symbol];
                const totalShares = lots.reduce((sum, lot) => sum + lot.totalShares, 0);
                const totalCost = lots.reduce((sum, lot) => sum + lot.totalCost, 0);
                const totalCashDividends = lots.reduce((sum, lot) => sum + lot.cashDividends, 0);
                const totalStockDividends = lots.reduce((sum, lot) => sum + lot.stockDividends, 0);
                const totalBuyFee = lots.reduce((sum, lot) => sum + (lot.buyFee ?? 0), 0);
                const hasBuyFee = lots.some(lot => lot.buyFee !== undefined);
                const currentPrice = p?.price ?? 0;
                const currentValue = currentPrice * totalShares;
                const { sellFee, tax } = calcTwSellFeeAndTax(currentValue, symbol);
                const sellCosts = sellFee + tax;
                const pnl = (p && !p.loading && !p.error && currentPrice > 0)
                  ? currentValue - totalCost - sellCosts + (includeDividend ? totalCashDividends : 0)
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
                        {(() => {
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
                        })()}
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-white">{symbol}</p>
                        {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                        <p className="text-[10px] text-slate-500 mt-0.5">{lots.length} 批</p>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{avgCost.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalShares)}</td>
                      <td className="p-3 text-right font-mono tabular-nums text-amber-300">{fmt(totalCost)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                          : p?.error ? <span className="text-danger text-xs">讀取失敗</span>
                          : currentPrice > 0
                            ? <span className={currentPrice >= avgCost ? 'text-up' : 'text-down'}>{currentPrice.toFixed(2)}</span>
                            : '—'}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{currentValue > 0 ? fmt(currentValue) : '—'}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalCashDividends)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalStockDividends)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{hasBuyFee ? fmt(totalBuyFee) : '—'}</td>
                      <td className="p-3">
                        <PnLCell pnl={pnl} pnlPct={pnlPct} currency="TWD" />
                      </td>
                      <td className="p-3 text-right">
                        {expanded ? <ChevronUp size={16} className="ml-auto text-slate-400" /> : <ChevronDown size={16} className="ml-auto text-slate-400" />}
                      </td>
                    </tr>
                    {expanded && lots.map(item => {
                const p            = prices[item.symbol];
                const currentPrice = p?.price ?? 0;
                const currentValue = currentPrice * item.totalShares;
                const { sellFee, tax } = calcTwSellFeeAndTax(currentValue, item.symbol);
                const pnl    = (p && !p.loading && !p.error && currentPrice > 0)
                  ? currentValue - item.totalCost - sellFee - tax + (includeDividend ? item.cashDividends : 0)
                  : null;
                const pnlPct = pnl !== null && item.totalCost > 0 ? (pnl / item.totalCost) * 100 : null;
                return (
                  <tr key={item.id} className="border-t border-surface-line bg-surface-inset/50 hover:bg-surface-inset transition-colors">
                    <td className="p-3 text-center text-xs text-slate-500">明細</td>
                    <td className="p-3">
                      <p className="font-bold text-white">{item.symbol}</p>
                      {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.avgCostPrice} digits={2}
                        onSave={v => onUpdate(item.id, 'avgCostPrice', v)} />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.totalShares}
                        onSave={v => onUpdate(item.id, 'totalShares', v)} />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.totalCost}
                        onSave={v => onUpdate(item.id, 'totalCost', v)} cls="text-amber-300" />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                        : p?.error  ? <span className="text-danger text-xs">讀取失敗</span>
                        : currentPrice > 0
                          ? <span className={`font-medium ${currentPrice >= item.avgCostPrice ? 'text-up' : 'text-down'}`}>
                              {currentPrice.toFixed(2)}
                            </span>
                          : '—'}
                    </td>
                    <td className="p-3 text-right text-slate-200 font-mono tabular-nums">{currentValue > 0 ? fmt(currentValue) : '—'}</td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.cashDividends}
                        onSave={v => onUpdate(item.id, 'cashDividends', v)} cls="text-up" />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.stockDividends}
                        onSave={v => onUpdate(item.id, 'stockDividends', v)} cls="text-accent" />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.buyFee}
                        onSave={v => onUpdate(item.id, 'buyFee', v)} cls="text-slate-400" />
                    </td>
                    <td className="p-3">
                      <PnLCell pnl={pnl} pnlPct={pnlPct} currency="TWD"
                        feeDetails={(sellFee > 0 || tax > 0) ? { sellFee, tax, label: '證交稅', currentValue } : undefined} />
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
                        <button onClick={() => setDeleteConfirm(item.id)}
                          className="text-slate-500 hover:text-danger transition-colors p-1.5 rounded-ctl hover:bg-danger-muted flex items-center justify-center ml-auto">
                          <Trash2 size={15} />
                        </button>
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
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const rate = usdTwdRate > 0 ? usdTwdRate : 32; // fallback rate

  const toggleSymbol = (symbol: string) => {
    setExpandedSymbols(current => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

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
    <div className="bg-surface-card rounded-card border border-surface-line overflow-hidden">
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-700/30 transition-colors">
        <div className="flex items-center gap-3">
          <Badge variant="neutral">美股</Badge>
          <span className="text-white font-semibold">美國股票</span>
          <span className="text-slate-500 text-xs">{groupLotsBySymbol(items).size} 檔</span>
          {usdTwdRate > 0 && (
            <span className="text-xs text-slate-500">1 USD ≈ {fmt(usdTwdRate, 2)} TWD</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Currency toggle — stop propagation so it doesn't collapse the table */}
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
          {groupPnL !== null && groupPnLPct !== null && (
            <span className={`font-bold font-mono tabular-nums ${groupPnL >= 0 ? 'text-up' : 'text-down'}`}>
              {groupPnL >= 0 ? '+' : ''}{f(groupPnL)} ({groupPnL >= 0 ? '+' : ''}{groupPnLPct.toFixed(2)}%)
            </span>
          )}
          {collapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto border-t border-surface-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr className="text-slate-400 font-medium">
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
              {Array.from(groupLotsBySymbol(items)).map(([symbol, lots]) => {
                const p = prices[symbol];
                const totalShares = lots.reduce((sum, lot) => sum + lot.totalShares, 0);
                const totalCost = lots.reduce((sum, lot) => sum + itemCostInDisplay(lot), 0);
                const priceUsd = p?.price ?? 0;
                const valueUsd = priceUsd * totalShares;
                const dispValue = toDisplay(valueUsd);
                const dispFee = lots.reduce((sum, lot) => {
                  const lotValueUsd = priceUsd * lot.totalShares;
                  return sum + toDisplay(calcUsFee(lotValueUsd, lot.isUsEtf ?? false));
                }, 0);
                const totalCashDividends = lots.reduce((sum, lot) =>
                  sum + (dc === 'USD' ? lot.cashDividends / rate : lot.cashDividends), 0);
                const totalStockDividends = lots.reduce((sum, lot) => sum + lot.stockDividends, 0);
                const pnl = (p && !p.loading && !p.error && priceUsd > 0)
                  ? dispValue - totalCost - dispFee + (includeDividend ? totalCashDividends : 0)
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
                        {(() => {
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
                        })()}
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-white">{symbol}</p>
                        {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                        <p className="text-[10px] text-slate-500 mt-0.5">{lots.length} 批</p>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{dc === 'USD' ? fmtUsd(avgCost) : avgCost.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalShares)}</td>
                      <td className="p-3 text-right font-mono tabular-nums text-amber-300">{dc === 'USD' ? fmtUsd(totalCost) : fmt(totalCost)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                          : p?.error ? <span className="text-danger text-xs">讀取失敗</span>
                          : priceUsd > 0 ? fmtUsd(priceUsd) : '—'}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{dispValue > 0 ? (dc === 'USD' ? fmtUsd(dispValue) : fmt(dispValue)) : '—'}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{dc === 'USD' ? fmtUsd(totalCashDividends) : fmt(totalCashDividends)}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{fmt(totalStockDividends)}</td>
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
                  <tr key={item.id} className="border-t border-surface-line bg-surface-inset/50 hover:bg-surface-inset transition-colors">
                    <td className="p-3 text-center text-xs text-slate-500">明細</td>
                    <td className="p-3">
                      <p className="font-bold text-white">{item.symbol}</p>
                      {p && !p.loading && !p.error && <p className="text-xs text-slate-400">{p.name}</p>}
                      <p className={`text-[10px] mt-0.5 ${item.isUsEtf ? 'text-accent' : 'text-slate-400'}`}>
                        {item.isUsEtf ? 'ETF  · $3/次' : '個股 · 0.008%'}
                        {item.purchaseCurrency && (
                          <span className="ml-1.5 text-slate-500">買入:{item.purchaseCurrency}</span>
                        )}
                      </p>
                    </td>
                    <td className="p-3 text-right text-slate-200 text-sm font-mono tabular-nums">
                      {dc === 'USD' ? fmtUsd(dispAvgCost) : dispAvgCost.toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.totalShares}
                        onSave={v => onUpdate(item.id, 'totalShares', v)} />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
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
                    <td className="p-3 text-right font-mono tabular-nums">
                      {p?.loading ? <Loader2 size={14} className="animate-spin text-slate-500 ml-auto" />
                        : p?.error  ? <span className="text-danger text-xs">讀取失敗</span>
                        : priceUsd > 0
                          ? <span className={`font-medium ${priceUsd >= (item.purchaseCurrency === 'USD' ? item.avgCostPrice : item.avgCostPrice / rate) ? 'text-up' : 'text-down'}`}>
                              {fmtUsd(priceUsd)}
                            </span>
                          : '—'}
                    </td>
                    <td className="p-3 text-right text-slate-200 font-mono tabular-nums">
                      {dispValue > 0 ? (dc === 'USD' ? fmtUsd(dispValue) : fmt(dispValue)) : '—'}
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.cashDividends}
                        onSave={v => onUpdate(item.id, 'cashDividends', v)} cls="text-up" />
                    </td>
                    <td className="p-3 text-right font-mono tabular-nums">
                      <EditableCell value={item.stockDividends}
                        onSave={v => onUpdate(item.id, 'stockDividends', v)} cls="text-accent" />
                    </td>
                    <td className="p-3">
                      <PnLCell pnl={pnl} pnlPct={pnlPct} currency={dc}
                        feeDetails={feeUsd > 0 ? { sellFee: dispFee, tax: 0, label: '', currentValue: dispValue } : undefined} />
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
                        <button onClick={() => setDeleteConfirm(item.id)}
                          className="text-slate-500 hover:text-danger transition-colors p-1.5 rounded-ctl hover:bg-danger-muted flex items-center justify-center ml-auto">
                          <Trash2 size={15} />
                        </button>
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
  const [batchChecking, setBatchChecking] = useState(false);

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
  const [feeInput, setFeeInput] = useState('');
  const [feeTouched, setFeeTouched] = useState(false);

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
    Array.from(new Set(items.map(i => i.symbol))).forEach(fetchPrice);
    // Fetch exchange rate if any US stock exists
    if (items.some(i => !isTwStock(i.symbol))) fetchExchangeRate();
  }, [items, fetchPrice, fetchExchangeRate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (items.length > 0) fetchAllPrices();
  }, [items.map(i => i.symbol).join(',')]);

  // ── 表單輔助 ───────────────────────────────────────────────────────────
  const formIsTW = isTwStock(form.symbol);
  const shares   = parseFloat(form.totalShares)    || 0;
  const rate     = usdTwdRate > 0 ? usdTwdRate : 32;

  useEffect(() => {
    if (feeTouched) return;
    if (formIsTW && form.inputMode === 'total') {
      setFeeInput('');
      return;
    }

    const avg = parseFloat(form.avgCostPrice) || 0;
    const totalInput = parseFloat(form.totalCostInput) || 0;
    const base = form.inputMode === 'avg' ? avg * shares : totalInput;
    if (base <= 0) {
      setFeeInput('');
      return;
    }

    if (formIsTW) {
      setFeeInput(String(calcTwBuyFee(base)));
      return;
    }

    const fee = form.purchaseCurrency === 'USD'
      ? calcUsFee(base, form.isUsEtf)
      : calcUsFee(base / rate, form.isUsEtf) * rate;
    setFeeInput(String(Number(fee.toFixed(2))));
  }, [feeTouched, form.avgCostPrice, form.inputMode, form.isUsEtf, form.purchaseCurrency,
    form.totalCostInput, formIsTW, rate, shares]);

  const preview = (() => {
    const avg       = parseFloat(form.avgCostPrice)   || 0;
    const totalInp  = parseFloat(form.totalCostInput) || 0;
    const enteredBuyFee = parseFloat(feeInput) || 0;

    if (formIsTW) {
      if (form.inputMode === 'avg') {
        const base   = avg * shares;
        const buyFee = enteredBuyFee;
        const total  = base + buyFee;
        return { base, buyFee, total, adjAvg: shares > 0 ? total / shares : avg, feeLabel: '買進手續費' };
      } else {
        const total = totalInp;
        return { base: total, buyFee: 0, total, adjAvg: shares > 0 ? total / shares : 0, feeLabel: '' };
      }
    } else {
      if (form.purchaseCurrency === 'USD') {
        const baseUsd = form.inputMode === 'avg' ? avg * shares : totalInp;
        const totalUsd = baseUsd + enteredBuyFee;
        const totalTwd = totalUsd * rate;
        return {
          base: baseUsd, buyFee: enteredBuyFee, total: totalUsd,
          adjAvg: shares > 0 ? totalUsd / shares : avg, totalTwd,
          feeLabel: '買進手續費',
        };
      } else {
        const baseTwd = form.inputMode === 'avg' ? avg * shares : totalInp;
        const totalTwd = baseTwd + enteredBuyFee;
        const feeUsd = enteredBuyFee / rate;
        return {
          base: baseTwd, buyFee: enteredBuyFee, total: totalTwd,
          adjAvg: shares > 0 ? totalTwd / shares : avg, feeUsd,
          feeLabel: '買進手續費',
        };
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
        totalCost: preview.total, brokerDiscount: 10,
        ...(form.inputMode === 'avg' ? { buyFee: preview.buyFee } : {}),
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
          brokerDiscount: 10, buyFee: preview.buyFee,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
        });
      } else {
        onAdd({
          symbol: sym, avgCostPrice: preview.adjAvg, totalShares: shares,
          totalCost: preview.total,            // fixed TWD cost
          purchaseCurrency: 'TWD', isUsEtf: form.isUsEtf,
          brokerDiscount: 10, buyFee: preview.buyFee,
          cashDividends: parseFloat(form.cashDividends) || 0,
          stockDividends: parseFloat(form.stockDividends) || 0,
        });
      }
    }

    setForm({ symbol: '', inputMode: 'avg', avgCostPrice: '', totalCostInput: '',
              totalShares: '', brokerDiscount: '', cashDividends: '', stockDividends: '',
              purchaseCurrency: 'USD', isUsEtf: false, buyDate: '', buyReason: '' });
    setFeeInput('');
    setFeeTouched(false);
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

  // ── 庫存健檢：組單檔 PortfolioHealthItem（單檔/批次共用）──────────────
  const buildHealthItem = useCallback(async (symbol: string): Promise<PortfolioHealthItem | null> => {
    const lots = items.filter(item => item.symbol === symbol);
    if (lots.length === 0) return null;

    const p = prices[symbol];
    const currentPrice = p && !p.loading && !p.error ? p.price : 0;

    // 美股：currentPrice 永遠是 USD；avgCostPrice 若以 TWD 購入需先換算成 USD
    const isUS = !isTwStock(symbol);
    const rate = usdTwdRate > 0 ? usdTwdRate : 32;
    const totalShares = lots.reduce((sum, lot) => sum + lot.totalShares, 0);
    const totalCostInCurrentCurrency = lots.reduce((sum, lot) => {
      if (!isUS) return sum + lot.totalCost;
      if (lot.purchaseCurrency === 'USD' && lot.totalCostUSD != null) return sum + lot.totalCostUSD;
      return sum + lot.totalCost / rate;
    }, 0);
    const avgCostPriceInCurrentCurrency = totalShares > 0
      ? totalCostInCurrentCurrency / totalShares
      : 0;

    const profitPct = avgCostPriceInCurrentCurrency > 0 && currentPrice > 0
      ? ((currentPrice - avgCostPriceInCurrentCurrency) / avgCostPriceInCurrentCurrency) * 100 : 0;

    let recentData: StockDataPoint[] = [];
    let volProj = null;
    try {
      const { data } = await getStockData(symbol, '1d');
      recentData = data;
      volProj = estimateVolumeTrend(data, isTwStock(symbol), '1d');
    } catch { /* continue without data */ }

    return {
      symbol, name: p?.name || symbol, avgCostPrice: avgCostPriceInCurrentCurrency,
      currentPrice, totalShares, profitPct, recentData, volumeProjection: volProj,
    };
  }, [items, prices, usdTwdRate]);

  // ── 單檔庫存健檢 ──────────────────────────────────────────────────────
  const handleSingleHealthCheck = useCallback(async (symbol: string) => {
    if (!items.some(i => i.symbol === symbol)) return;

    setHealthResults(prev => ({ ...prev, [symbol]: { status: 'loading', decision: '', fullResult: '' } }));

    try {
      const healthItem = await buildHealthItem(symbol);
      if (!healthItem) return;

      const result = await analyzePortfolioHealth([healthItem]);

      // 決策：優先 json 機器區，失敗 fallback regex（舊行為是下限）
      const parsed = parseHealthDecisions(result);
      const entry = parsed?.decisions.find(d => d.symbol === symbol) ?? parsed?.decisions[0] ?? null;
      const decision = entry
        ? DECISION_EMOJI[entry.decision] + entry.decision
        : (extractDecisionByRegex(result) ?? '分析完成');
      const fullResult = parsed ? parsed.cleanedMarkdown : result;

      setHealthResults(prev => ({ ...prev, [symbol]: { status: 'done', decision, fullResult } }));
    } catch {
      setHealthResults(prev => ({ ...prev, [symbol]: { status: 'error', decision: '分析失敗', fullResult: '**庫存健檢分析失敗**\n\n請稍後再試。' } }));
    }
  }, [items, buildHealthItem]);

  // ── 一鍵批次健檢（全部持股一次 LLM 呼叫）──────────────────────────────
  const handleBatchHealthCheck = useCallback(async () => {
    const symbols = Array.from(new Set(items.map(i => i.symbol)));
    if (symbols.length === 0 || batchChecking) return;

    setBatchChecking(true);
    setHealthResults(prev => {
      const next = { ...prev };
      symbols.forEach(s => { next[s] = { status: 'loading', decision: '', fullResult: '' }; });
      return next;
    });

    try {
      // 資料準備：併發上限 3 的 index 游標池（getLatestPrice 不暖 getStockData 快取，冷抓打真網路，429 是常態）
      const results: (PortfolioHealthItem | null)[] = new Array(symbols.length).fill(null);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, symbols.length) }, async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= symbols.length) break;
          const it = await buildHealthItem(symbols[idx]);
          if (it) results[idx] = it;
        }
      });
      await Promise.all(workers);
      const healthItems = results.filter((it): it is PortfolioHealthItem => it !== null);

      const result = await analyzePortfolioHealth(healthItems);

      // fallback 階梯：json 機器區 → 切段 → regex → 全文兜底
      const parsed = parseHealthDecisions(result);
      const displayText = parsed ? parsed.cleanedMarkdown : result;
      const split = splitHealthReport(displayText, symbols);
      const decisionMap = new Map((parsed?.decisions ?? []).map(d => [d.symbol, d.decision]));

      setHealthResults(prev => {
        const next = { ...prev };
        symbols.forEach(symbol => {
          const fullResult = split
            ? split.perSymbol[symbol] + (split.overview ? '\n\n---\n\n' + split.overview : '')
            : displayText;
          const d = decisionMap.get(symbol);
          const decision = d
            ? DECISION_EMOJI[d] + d
            : (extractDecisionByRegex(split ? split.perSymbol[symbol] : displayText) ?? '分析完成');
          next[symbol] = { status: 'done', decision, fullResult };
        });
        return next;
      });
    } catch {
      setHealthResults(prev => {
        const next = { ...prev };
        symbols.forEach(symbol => {
          next[symbol] = { status: 'error', decision: '分析失敗', fullResult: '**庫存健檢分析失敗**\n\n請稍後再試。' };
        });
        return next;
      });
    } finally {
      setBatchChecking(false);
    }
  }, [items, batchChecking, buildHealthItem]);

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
          <p className="text-slate-400 text-sm">台股含手續費與證交稅・美股個股 0.008%・ETF $3/次</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
      </div>

      {/* ── 全局摘要 ───────────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="總投入成本 (TWD)" value={`${fmt(totalInvested)} 元`} sub="美股依即時匯率換算" />
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
                        以 TWD 購入：總成本(TWD)固定，USD換算依即時匯率計算
                        {usdTwdRate > 0 && `（目前匯率約 ${fmt(usdTwdRate, 2)}）`}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-slate-300 text-sm font-medium block mb-1.5">股票類型</label>
                    <div className="flex bg-surface-inset border border-surface-line rounded-ctl p-1 gap-1">
                      <button onClick={() => setForm(p => ({ ...p, isUsEtf: false }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all
                          ${!form.isUsEtf ? 'bg-accent text-white' : 'text-slate-400 hover:text-white'}`}>
                        個股（0.008%）
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
