// components/portfolio/SellModal.tsx — 賣出持股 Modal（Phase 10 T5）
// 計算全走 utils/portfolioLedger.buildSellResult（預覽與入帳同一條路，數字必然一致）。
import React, { useEffect, useMemo, useState } from 'react';
import { PortfolioItem } from '../../types';
import { buildSellResult, todayLocalStr, SellInput } from '../../utils/portfolioLedger';
import { isTwStock } from '../../utils/portfolioFees';
import Modal from '../ui/Modal';

interface SellModalProps {
  lot: PortfolioItem | null;
  usdTwdRate: number;        // 0＝不可得（美股 TWD 計價批次會被引擎擋下）
  priceHint?: number;        // 現價預填
  onConfirm: (lotId: string, input: SellInput, usdTwdRate?: number) => string | null;
  onClose: () => void;
}

const fmtTwd = (n: number) => `${n.toLocaleString('zh-TW', { maximumFractionDigits: 0 })} 元`;
const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputCls = `w-full bg-surface-inset border border-surface-line rounded-ctl px-3 py-2 text-sm text-white
  placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent transition-colors`;

const SellModal: React.FC<SellModalProps> = ({ lot, usdTwdRate, priceHint, onConfirm, onClose }) => {
  const [sharesStr, setSharesStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [dateStr, setDateStr] = useState(todayLocalStr());
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 換一批標的時重置表單（股數預設全賣、價格預填現價、日期預設今天）
  useEffect(() => {
    if (!lot) return;
    setSharesStr(String(lot.totalShares));
    setPriceStr(priceHint && priceHint > 0 ? String(priceHint) : '');
    setDateStr(todayLocalStr());
    setSubmitError(null);
  }, [lot?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const isTW = lot ? isTwStock(lot.symbol) : false;
  const fmtM = isTW ? fmtTwd : fmtUsd;   // 市場幣別格式
  const rateArg = usdTwdRate > 0 ? usdTwdRate : undefined;

  // 即時預覽：與入帳走同一個純函式；輸入不合法時回 {error} 顯示原因並鎖確認鈕
  const preview = useMemo(() => {
    if (!lot) return null;
    const shares = parseFloat(sharesStr);
    const price = parseFloat(priceStr);
    if (!(shares > 0) || !(price > 0)) return null;
    try {
      const { trade } = buildSellResult(lot, { sharesSold: shares, sellPrice: price, sellDate: dateStr }, rateArg);
      return { trade, error: null as string | null };
    } catch (e: any) {
      return { trade: null, error: (e?.message as string) || '輸入不合法' };
    }
  }, [lot, sharesStr, priceStr, dateStr, rateArg]);

  const trade = preview?.trade ?? null;

  const handleConfirm = () => {
    if (!lot || !trade) return;
    const err = onConfirm(lot.id,
      { sharesSold: parseFloat(sharesStr), sellPrice: parseFloat(priceStr), sellDate: dateStr }, rateArg);
    if (err) setSubmitError(err);
    else onClose();
  };

  if (!lot) return null;
  return (
    <Modal open={!!lot} onClose={onClose} title={`賣出 ${lot.symbol}`} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="text-sm text-slate-400 flex justify-between">
          <span>持有 <span className="text-white font-mono">{lot.totalShares.toLocaleString('zh-TW')}</span> 股</span>
          <span>成本均價 <span className="text-amber-300 font-mono">{lot.avgCostPrice.toFixed(2)}</span></span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">賣出股數</label>
            <div className="flex gap-1.5">
              <input type="number" value={sharesStr} onChange={e => setSharesStr(e.target.value)}
                placeholder="0" className={inputCls} />
              <button onClick={() => setSharesStr(String(lot.totalShares))}
                className="shrink-0 text-xs px-2 rounded-ctl bg-surface-inset border border-surface-line text-slate-400 hover:text-white hover:border-slate-500 transition-colors">全部</button>
            </div>
          </div>
          <div>
            <label className="text-slate-300 text-sm font-medium block mb-1.5">賣出單價（{isTW ? 'TWD' : 'USD'}）</label>
            <input type="number" value={priceStr} onChange={e => setPriceStr(e.target.value)}
              placeholder="0.00" className={inputCls} />
          </div>
        </div>

        <div>
          <label className="text-slate-300 text-sm font-medium block mb-1.5">賣出日期</label>
          <input type="date" value={dateStr} max={todayLocalStr()}
            onChange={e => setDateStr(e.target.value)} className={inputCls} />
        </div>

        {/* 預覽（與入帳同一條計算路徑） */}
        <div className="bg-surface-inset border border-surface-line rounded-card p-3 text-xs space-y-1.5 font-mono tabular-nums">
          {trade ? (
            <>
              <div className="flex justify-between text-slate-400"><span>賣出總額</span><span className="text-slate-200">{fmtM(trade.grossProceeds)}</span></div>
              <div className="flex justify-between text-slate-400"><span>手續費</span><span className="text-slate-200">−{isTW ? fmtTwd(trade.sellFee) : fmtUsd(trade.sellFee)}</span></div>
              {isTW && (
                <div className="flex justify-between text-slate-400"><span>證交稅</span><span className="text-slate-200">−{fmtTwd(trade.sellTax)}</span></div>
              )}
              <div className="flex justify-between text-slate-400"><span>成本基礎（等比）</span><span className="text-amber-300">−{fmtM(trade.costBasis)}</span></div>
              {trade.divCarried > 0 && (
                <div className="flex justify-between text-slate-400"><span>股利移轉至已實現</span><span className="text-up">{fmtM(trade.divCarried)}</span></div>
              )}
              {trade.usdTwdRateUsed !== undefined && (
                <div className="flex justify-between text-slate-500"><span>換算匯率</span><span>{trade.usdTwdRateUsed.toFixed(3)}</span></div>
              )}
              <div className="flex justify-between border-t border-surface-line pt-1.5 mt-1.5 text-sm">
                <span className="text-slate-300 font-bold">已實現損益</span>
                <span className={`font-bold ${trade.realizedPnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {trade.realizedPnl >= 0 ? '+' : ''}{fmtM(trade.realizedPnl)}
                  {trade.costBasis > 0 && (
                    <span className="ml-1 text-xs opacity-70">({trade.realizedPnl >= 0 ? '+' : ''}{((trade.realizedPnl / trade.costBasis) * 100).toFixed(2)}%)</span>
                  )}
                </span>
              </div>
            </>
          ) : (
            <p className="text-slate-500">{preview?.error ?? '輸入股數與單價後顯示試算'}</p>
          )}
        </div>

        {submitError && <p className="text-danger text-xs">{submitError}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-ctl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">取消</button>
          <button onClick={handleConfirm} disabled={!trade}
            className="text-sm px-4 py-2 rounded-ctl bg-accent text-white font-bold hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            確認賣出
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SellModal;
