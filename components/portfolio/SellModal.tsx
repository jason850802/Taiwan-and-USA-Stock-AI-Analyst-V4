// components/portfolio/SellModal.tsx — 賣出持股 Modal（Phase 10 T5）
// 計算全走 utils/portfolioLedger.buildSellResult（預覽與入帳同一條路，數字必然一致）。
import React, { useEffect, useMemo, useState } from 'react';
import { PortfolioItem } from '../../types';
import {
  buildSellResult, todayLocalStr, SellInput,
  assessDayTrade, DayTradeReason, DAY_TRADE_HARD_GATE_REASONS,
} from '../../utils/portfolioLedger';
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

/**
 * 當沖判定理由的顯示文案（reason 代碼 → 中文）。純函式只回代碼、不持有 UI 文字，
 * 映射放在這裡。用詞照 CONTEXT.md「台股現股當沖」節，不得漂移出詞彙表。
 *
 * 刻意用 Record 而不是 switch：本專案 tsconfig 非 strict、也沒開 noImplicitReturns，
 * switch 漏掉日後新增的 reason 不會編譯錯，只會**靜默少一行理由**——而這行理由正是
 * 這個勾選框存在的意義。Record 缺 key 則必紅（已實測本專案 tsconfig 下會報 TS2741）。
 */
const DAY_TRADE_REASON_TEXT: Record<DayTradeReason, (lot: PortfolioItem) => string> = {
  eligible:           () => '符合現股當沖：本批買進日＝賣出日、整張交易',
  'etf-not-eligible': () => 'ETF 當沖不適用減半，證交稅仍 0.1%／債券 ETF 免稅',
  'odd-lot-sell':     () => '零股不得當沖；若實為整張當沖＋零股賣出，請拆成兩筆賣出',
  'odd-lot-holding':  () => '本批持有含零股，未自動認定；當日整張買賣屬實可手動勾選',
  'date-mismatch':    lot => `本批買進日 ${lot.buyDate} ≠ 賣出日`,
  'no-buy-date':      () => '本批未記買進日；確為當沖可手動勾選',
  'not-tw-stock':     () => '',   // 美股完全不顯示當沖控制項，走不到這裡
};

const SellModal: React.FC<SellModalProps> = ({ lot, usdTwdRate, priceHint, onConfirm, onClose }) => {
  const [sharesStr, setSharesStr] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [dateStr, setDateStr] = useState(todayLocalStr());
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 當沖覆寫（三態）：undefined＝跟隨自動判定；true／false＝使用者手動指定。
  // 沿買入表單 feeTouched 的精神，但**方向相反**：這裡的覆寫一碰股數／日期就作廢，
  // 因為覆寫是針對「當下這組輸入」的判斷，輸入變了它就不再成立。
  const [dayTradeOverride, setDayTradeOverride] = useState<boolean | undefined>(undefined);

  // 換一批標的時重置表單（股數預設全賣、價格預填現價、日期預設今天）
  useEffect(() => {
    if (!lot) return;
    setSharesStr(String(lot.totalShares));
    setPriceStr(priceHint && priceHint > 0 ? String(priceHint) : '');
    setDateStr(todayLocalStr());
    setSubmitError(null);
    setDayTradeOverride(undefined);
  }, [lot?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const isTW = lot ? isTwStock(lot.symbol) : false;
  const fmtM = isTW ? fmtTwd : fmtUsd;   // 市場幣別格式
  const rateArg = usdTwdRate > 0 ? usdTwdRate : undefined;

  // 股數／日期一動就讓覆寫失效，回到自動判定
  const changeShares = (v: string) => { setSharesStr(v); setDayTradeOverride(undefined); };
  const changeDate = (v: string) => { setDateStr(v); setDayTradeOverride(undefined); };

  // 當沖判定：**直接呼叫純函式**、不依賴預覽是否成立——價格欄空白或報價缺失時，
  // 勾選框與理由照常運作（判定本來就不吃價格）。
  const shares = parseFloat(sharesStr);
  const assessment = useMemo(
    () => (lot && isTW ? assessDayTrade(lot, shares, dateStr) : null),
    [lot, shares, dateStr, isTW],
  );
  // 硬閘（非台股個股／賣出零股）不得覆寫成 true；股數還沒填完也一律停用。
  // 三層縱深防禦的第一層：這裡只是擋 UI，引擎與稅率函式各自還會再守一次。
  const dayTradeHardBlocked = !!assessment && DAY_TRADE_HARD_GATE_REASONS.includes(assessment.reason);
  const dayTradeDisabled = !assessment || dayTradeHardBlocked || !(shares > 0);
  const dayTradeChecked = !assessment || dayTradeHardBlocked
    ? false
    : (dayTradeOverride ?? assessment.eligible);
  // 傳給引擎的值＝勾選框當下的值（預覽與入帳同一個值、同一條路）
  const dayTradeArg = isTW ? dayTradeChecked : undefined;

  // 即時預覽：與入帳走同一個純函式；輸入不合法時回 {error} 顯示原因並鎖確認鈕
  const preview = useMemo(() => {
    if (!lot) return null;
    const price = parseFloat(priceStr);
    if (!(shares > 0) || !(price > 0)) return null;
    try {
      const { trade } = buildSellResult(
        lot, { sharesSold: shares, sellPrice: price, sellDate: dateStr, isDayTrade: dayTradeArg }, rateArg);
      return { trade, error: null as string | null };
    } catch (e: any) {
      return { trade: null, error: (e?.message as string) || '輸入不合法' };
    }
  }, [lot, shares, priceStr, dateStr, rateArg, dayTradeArg]);

  const trade = preview?.trade ?? null;

  const handleConfirm = () => {
    if (!lot || !trade) return;
    const err = onConfirm(lot.id,
      { sharesSold: shares, sellPrice: parseFloat(priceStr), sellDate: dateStr, isDayTrade: dayTradeArg }, rateArg);
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
              <input type="number" value={sharesStr} onChange={e => changeShares(e.target.value)}
                placeholder="0" className={inputCls} />
              <button onClick={() => changeShares(String(lot.totalShares))}
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
            onChange={e => changeDate(e.target.value)} className={inputCls} />
        </div>

        {/* 現股當沖（ADR-0003）。美股完全不顯示——無證交稅，勾了沒有意義。 */}
        {assessment && (
          <label className={`flex items-start gap-2 bg-surface-inset border border-surface-line rounded-card p-3
            ${dayTradeDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={dayTradeChecked} disabled={dayTradeDisabled}
              onChange={e => setDayTradeOverride(e.target.checked)}
              className="mt-0.5 accent-accent disabled:opacity-40 disabled:cursor-not-allowed" />
            <span className={`text-sm ${dayTradeDisabled ? 'text-slate-500' : 'text-slate-300'}`}>
              現股當沖<span className="text-slate-500">（證交稅減半 0.15%）</span>
              <span className="block text-xs text-slate-500 mt-0.5 font-normal">
                {shares > 0 ? DAY_TRADE_REASON_TEXT[assessment.reason](lot) : '輸入賣出股數後判定'}
              </span>
            </span>
          </label>
        )}

        {/* 預覽（與入帳同一條計算路徑） */}
        <div className="bg-surface-inset border border-surface-line rounded-card p-3 text-xs space-y-1.5 font-mono tabular-nums">
          {trade ? (
            <>
              <div className="flex justify-between text-slate-400"><span>賣出總額</span><span className="text-slate-200">{fmtM(trade.grossProceeds)}</span></div>
              <div className="flex justify-between text-slate-400"><span>手續費</span><span className="text-slate-200">−{isTW ? fmtTwd(trade.sellFee) : fmtUsd(trade.sellFee)}</span></div>
              {isTW && (
                <div className="flex justify-between text-slate-400">
                  {/* 標示依 trade.isDayTrade＝引擎夾制後的有效旗標，覆寫被夾掉時標示不會說謊 */}
                  <span>證交稅{trade.isDayTrade ? '（當沖 0.15%）' : ''}</span>
                  <span className="text-slate-200">−{fmtTwd(trade.sellTax)}</span>
                </div>
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
