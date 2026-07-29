// components/portfolio/RealizedLedger.tsx — 已實現損益帳本（Phase 10 T5）
// single source of truth＝帳本紀錄；刪除僅移除帳面，不回復持股（二段確認＋可見警語）。
import React, { useMemo, useState } from 'react';
import { RealizedTrade } from '../../types';
import { twdRealizedPnl } from '../../utils/fx';
import { ChevronDown, ChevronUp, Trash2, ReceiptText } from 'lucide-react';

interface RealizedLedgerProps {
  trades: RealizedTrade[];
  onDeleteTrade: (tradeId: string) => void;
}

const fmt = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtUsd = (n: number, d = 2) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// 台幣實現損益（含匯差）：與歷史曲線的台幣已實現側共用同一口徑
const twdRealized = twdRealizedPnl;

const RealizedLedger: React.FC<RealizedLedgerProps> = ({ trades, onDeleteTrade }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const hasUs = trades.some(t => t.market === 'US');

  const { sorted, twTotal, usTotal, usTwdTotal, usTwdPartial, usTwdCount } = useMemo(() => {
    const sorted = [...trades].sort((a, b) =>
      a.sellDate === b.sellDate ? b.createdAt - a.createdAt : (a.sellDate < b.sellDate ? 1 : -1));
    // 已實現累計＝賣出損益＋股利移轉（與圖表 realizedCum 同口徑）
    const twTotal = trades.filter(t => t.market === 'TW').reduce((s, t) => s + t.realizedPnl + t.divCarried, 0);
    const usTotal = trades.filter(t => t.market === 'US').reduce((s, t) => s + t.realizedPnl + t.divCarried, 0);
    // 美股台幣合計：只加總「買賣匯率都齊」的筆數，並標示是否只涵蓋部分紀錄
    const usTrades = trades.filter(t => t.market === 'US');
    const rated = usTrades.filter(t => twdRealized(t) !== null);
    const usTwdTotal = rated.reduce((s, t) => s + (twdRealized(t) as number), 0);
    return { sorted, twTotal, usTotal, usTwdTotal, usTwdPartial: rated.length < usTrades.length, usTwdCount: rated.length };
  }, [trades]);

  if (trades.length === 0) return null;

  const pnlCls = (v: number) => (v >= 0 ? 'text-up' : 'text-down');

  return (
    <div className="bg-surface border border-surface-line rounded-card overflow-hidden">
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-inset/50 transition-colors">
        <div className="flex items-center gap-2">
          <ReceiptText size={16} className="text-accent" />
          <span className="font-bold text-white text-sm">已實現損益帳本</span>
          <span className="text-xs text-slate-500">（{trades.length} 筆；刪除僅移除帳面紀錄，不會回復持股）</span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
          {trades.some(t => t.market === 'TW') && (
            <span className="text-slate-400">台股 <span className={`font-bold ${pnlCls(twTotal)}`}>{twTotal >= 0 ? '+' : ''}{fmt(twTotal)} 元</span></span>
          )}
          {trades.some(t => t.market === 'US') && (
            <span className="text-slate-400">美股 <span className={`font-bold ${pnlCls(usTotal)}`}>{usTotal >= 0 ? '+' : ''}{fmtUsd(usTotal)}</span></span>
          )}
          {usTwdCount > 0 && (
            <span className="text-slate-400"
              title={usTwdPartial ? '僅計入買賣匯率都有紀錄的筆數' : '含匯差的台幣實現損益'}>
              美股台幣 <span className={`font-bold ${pnlCls(usTwdTotal)}`}>{usTwdTotal >= 0 ? '+' : ''}{fmt(usTwdTotal)} 元</span>
              {usTwdPartial && <span className="text-slate-600 ml-1">(部分)</span>}
            </span>
          )}
          {collapsed ? <ChevronDown size={15} className="text-slate-500" /> : <ChevronUp size={15} className="text-slate-500" />}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${hasUs ? 'min-w-[1060px]' : 'min-w-[860px]'}`}>
            <thead>
              <tr className="text-xs text-slate-500 border-t border-surface-line">
                <th className="p-3 text-left font-medium">賣出日</th>
                <th className="p-3 text-left font-medium">代號</th>
                <th className="p-3 text-right font-medium">股數</th>
                <th className="p-3 text-right font-medium">賣價</th>
                <th className="p-3 text-right font-medium">費＋稅</th>
                <th className="p-3 text-right font-medium">成本基礎</th>
                <th className="p-3 text-right font-medium">股利移轉</th>
                <th className="p-3 text-right font-medium">已實現損益</th>
                {hasUs && (
                  <>
                    <th className="p-3 text-right font-medium" title="買入匯率 → 賣出匯率">匯率 (買→賣)</th>
                    <th className="p-3 text-right font-medium" title="賣出淨額×賣出匯率 − 成本×買入匯率（含匯差）">台幣損益</th>
                  </>
                )}
                <th className="p-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {sorted.map(t => {
                const f = t.currency === 'USD' ? fmtUsd : (n: number) => `${fmt(n)}`;
                return (
                  <tr key={t.id} className="border-t border-surface-line hover:bg-surface-inset/50 transition-colors">
                    <td className="p-3 text-slate-300">{t.sellDate}</td>
                    <td className="p-3">
                      <span className="text-white font-bold">{t.symbol}</span>
                      <span className="ml-1.5 text-[10px] text-slate-500">{t.market === 'TW' ? '台' : '美'}</span>
                      {/* 只有 true 標「沖」；false 與 undefined 一律無視覺變化——
                          顯示層不放大三態（「明確一般」與「不知道」對讀帳的人沒有差別）。
                          尺寸對齊左邊的市場標記，不用 Badge 元件以免撐開表格列高。 */}
                      {t.isDayTrade === true && (
                        <span className="ml-1.5 text-[10px] px-1 py-px rounded bg-accent/15 text-accent border border-accent/30"
                          title="現股當沖：證交稅按 0.15% 減半計">沖</span>
                      )}
                    </td>
                    <td className="p-3 text-right text-slate-300">{fmt(t.sharesSold)}</td>
                    <td className="p-3 text-right text-slate-300">{t.sellPrice.toFixed(2)}</td>
                    <td className="p-3 text-right text-slate-400">{f(t.sellFee + t.sellTax)}</td>
                    <td className="p-3 text-right text-amber-300">{f(t.costBasis)}</td>
                    <td className="p-3 text-right text-slate-300">{t.divCarried > 0 ? f(t.divCarried) : '—'}</td>
                    <td className={`p-3 text-right font-bold ${pnlCls(t.realizedPnl)}`}>
                      {t.realizedPnl >= 0 ? '+' : ''}{f(t.realizedPnl)}
                    </td>
                    {hasUs && (
                      <>
                        <td className="p-3 text-right text-xs text-slate-400">
                          {t.market === 'US'
                            ? (t.buyExchangeRate || t.sellExchangeRate
                                ? `${t.buyExchangeRate ? t.buyExchangeRate.toFixed(3) : '—'} → ${t.sellExchangeRate ? t.sellExchangeRate.toFixed(3) : '—'}`
                                : <span className="text-slate-600">—</span>)
                            : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="p-3 text-right">
                          {(() => {
                            const twd = twdRealized(t);
                            if (twd === null) return <span className="text-slate-600 text-xs">—</span>;
                            return (
                              <span className={`font-bold ${pnlCls(twd)}`}>
                                {twd >= 0 ? '+' : ''}{fmt(twd)} 元
                              </span>
                            );
                          })()}
                        </td>
                      </>
                    )}
                    <td className="p-3">
                      {deleteConfirmId === t.id ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-[10px] text-amber-300 whitespace-nowrap">僅刪帳，不回復持股；曲線需按「重算歷史回推」才更新</span>
                          <button onClick={() => { onDeleteTrade(t.id); setDeleteConfirmId(null); }}
                            className="text-xs bg-danger-muted text-danger border border-danger/30 px-2 py-1 rounded-ctl hover:bg-danger/30 transition-colors whitespace-nowrap">確認刪帳</button>
                          <button onClick={() => setDeleteConfirmId(null)}
                            className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded-lg hover:bg-slate-600 transition-colors">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(t.id)} title="刪除帳面紀錄（不回復持股）"
                          className="text-slate-500 hover:text-danger transition-colors p-1.5 rounded-ctl hover:bg-danger-muted flex items-center justify-center ml-auto">
                          <Trash2 size={14} />
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

export default RealizedLedger;
