// components/portfolio/ImportStatementModal.tsx — 對帳單上傳與匯入預覽（Phase 11 T4）
// 流程：選檔 → 解析（xlsx 套件懶載）→ 預覽統計＋期初缺口補成本 → 確認套用。
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PortfolioItem, ImportPlan, ImportGap } from '../../types';
import { parseStatementFile, StatementParseError, getBrokerLabel } from '../../utils/statementParsers';
import { ensureTaiwanDirectory } from '../../services/stockDirectory';
import { buildImportPlan } from '../../utils/importPlan';
import { replayStatement } from '../../utils/importReplay';
import { loadImportLog } from '../../utils/importStore';
import Modal from '../ui/Modal';
import { Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface ImportApplyPayload {
  lots: PortfolioItem[];
  newTrades: ReturnType<typeof replayStatement>['newTrades'];
  importedKeys: string[];
  txns: ImportPlan['txns'];      // 完整買賣流水（供歷史回推重建已清倉部位）
  broker: ImportPlan['broker'];
  fileName: string;
}

interface ImportStatementModalProps {
  open: boolean;
  onClose: () => void;
  existingLots: PortfolioItem[];
  onApply: (payload: ImportApplyPayload) => void;
}

const inputCls = `bg-surface-inset border border-surface-line rounded-ctl px-2 py-1 text-sm text-white
  placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent transition-colors`;

const fmt = (n: number, d = 0) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });

const ImportStatementModal: React.FC<ImportStatementModalProps> = ({ open, onClose, existingLots, onApply }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [gapInputs, setGapInputs] = useState<Record<number, { cost: string; buyDate: string }>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPlan(null); setError(null); setFileName(''); setGapInputs({}); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleFile = async (file: File) => {
    setBusy(true); setError(null); setPlan(null);
    try {
      // 國泰台股對帳單只有中文股名，需台股名錄反查代號（其餘格式不會用到此 callback）
      const parsed = await parseStatementFile(file, () => ensureTaiwanDirectory());
      const log = loadImportLog();
      const p = buildImportPlan({
        broker: parsed.broker,
        txns: parsed.txns,
        unsupported: parsed.unsupported,
        importedKeys: log.keys,
        existingLots,
      });
      setPlan(p);
      setFileName(parsed.fileName);
      setGapInputs(Object.fromEntries(p.gaps.map(g => [g.txnIndex, { cost: '', buyDate: g.buyDate ?? '' }])));
    } catch (e: any) {
      setError(e instanceof StatementParseError ? e.message : `解析失敗：${e?.message || '未知錯誤'}`);
    } finally {
      setBusy(false);
    }
  };

  // 使用者補值後的缺口（未填成本者不納入 → 該筆賣出會被略過）
  const filledGaps = useMemo<ImportGap[]>(() => {
    if (!plan) return [];
    const out: ImportGap[] = [];
    for (const g of plan.gaps) {
      const v = gapInputs[g.txnIndex];
      const cost = parseFloat(v?.cost ?? '');
      if (!Number.isFinite(cost) || cost < 0) continue;   // 未填/非法 → 該筆賣出略過
      out.push({ ...g, costPerShare: cost, buyDate: v?.buyDate || g.buyDate });
    }
    return out;
  }, [plan, gapInputs]);

  const applyPreview = useMemo(() => {
    if (!plan) return null;
    return replayStatement({ txns: plan.txns, existingLots, gapsFilled: filledGaps });
  }, [plan, existingLots, filledGaps]);

  const handleConfirm = () => {
    if (!plan || !applyPreview) return;
    onApply({
      lots: applyPreview.lots,
      newTrades: applyPreview.newTrades,
      importedKeys: plan.txns.map(t => t.dedupeKey),
      txns: plan.txns,
      broker: plan.broker,
      fileName,
    });
    reset();
    onClose();
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Modal open={open} onClose={handleClose} title="匯入券商對帳單" maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* ── 選檔 ─────────────────────────────────────────────── */}
        {!plan && (
          <div className="space-y-3">
            <div className="border border-dashed border-surface-line rounded-card p-8 text-center">
              <FileSpreadsheet className="mx-auto text-slate-500 mb-3" size={32} />
              <p className="text-slate-300 text-sm mb-1">選擇永豐金或國泰證券的對帳單（.xlsx / .csv）</p>
              <p className="text-slate-500 text-xs mb-4">買進會建立持股、賣出會從庫存扣減並計入已實現損益</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-ctl bg-accent text-white text-sm font-bold hover:bg-accent/80 transition-colors disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {busy ? '解析中…' : '選擇檔案'}
              </button>
            </div>
            {error && (
              <div className="flex items-start gap-2 bg-danger-muted border border-danger/30 rounded-card p-3">
                <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
                <p className="text-danger text-sm">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── 預覽 ─────────────────────────────────────────────── */}
        {plan && applyPreview && (
          <div className="space-y-4">
            <div className="bg-surface-inset border border-surface-line rounded-card p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white font-bold">{getBrokerLabel(plan.broker)}</span>
                <span className="text-slate-500 text-xs">{fileName}</span>
              </div>
              {plan.dateRange && (
                <p className="text-xs text-slate-400">交易期間 {plan.dateRange.from} ～ {plan.dateRange.to}</p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-center font-mono tabular-nums">
                <div><p className="text-lg text-up font-bold">{applyPreview.applied.buys}</p><p className="text-[11px] text-slate-500">買進建立持股</p></div>
                <div><p className="text-lg text-down font-bold">{applyPreview.applied.sells}</p><p className="text-[11px] text-slate-500">賣出計入損益</p></div>
                <div><p className="text-lg text-accent font-bold">{applyPreview.applied.dividends}</p><p className="text-[11px] text-slate-500">配息</p></div>
                <div><p className="text-lg text-slate-400 font-bold">{plan.skippedDuplicates}</p><p className="text-[11px] text-slate-500">略過重複</p></div>
              </div>
            </div>

            {plan.txns.length === 0 && (
              <div className="flex items-start gap-2 bg-surface-inset border border-surface-line rounded-card p-3">
                <CheckCircle2 size={15} className="text-up mt-0.5 shrink-0" />
                <p className="text-sm text-slate-300">
                  這份對帳單的 {plan.skippedDuplicates} 筆交易先前都已匯入過，沒有新資料需要處理。
                </p>
              </div>
            )}

            {/* 期初缺口：找不到買進紀錄的賣出（D-02） */}
            {plan.gaps.length > 0 && (
              <div className="border border-amber-500/40 rounded-card overflow-hidden">
                <div className="bg-amber-500/10 px-3 py-2">
                  <p className="text-amber-300 text-sm font-bold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> {plan.gaps.length} 筆賣出找不到買進紀錄
                  </p>
                  <p className="text-amber-200/70 text-xs mt-0.5">
                    這些是對帳單期間之前就持有的部位。填入當初的成本均價才會計入已實現損益；留空則略過該筆。
                  </p>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-surface-line">
                        <th className="p-2 text-left font-medium">代號</th>
                        <th className="p-2 text-right font-medium">賣出</th>
                        <th className="p-2 text-right font-medium">賣價</th>
                        <th className="p-2 text-right font-medium">成本均價</th>
                        <th className="p-2 text-right font-medium">買進日期</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tabular-nums">
                      {plan.gaps.map(g => {
                        const v = gapInputs[g.txnIndex] ?? { cost: '', buyDate: g.buyDate ?? '' };
                        const filled = Number.isFinite(parseFloat(v.cost)) && parseFloat(v.cost) >= 0;
                        return (
                          <tr key={g.txnIndex} className="border-b border-surface-line/50">
                            <td className="p-2">
                              <span className="text-white font-bold">{g.symbol}</span>
                              <span className="ml-1 text-slate-500">{g.name}</span>
                              <span className="ml-1 text-slate-600">{g.sellDate}</span>
                            </td>
                            <td className="p-2 text-right text-slate-300">{fmt(g.sharesMissing)}</td>
                            <td className="p-2 text-right text-slate-300">{g.sellPrice.toFixed(2)}</td>
                            <td className="p-2 text-right">
                              <input type="number" value={v.cost} placeholder="留空略過"
                                onChange={e => setGapInputs(p => ({ ...p, [g.txnIndex]: { ...v, cost: e.target.value } }))}
                                className={`${inputCls} w-24 text-right ${filled ? 'border-up/50' : ''}`} />
                            </td>
                            <td className="p-2 text-right">
                              <input type="date" value={v.buyDate} max={g.sellDate}
                                onChange={e => setGapInputs(p => ({ ...p, [g.txnIndex]: { ...v, buyDate: e.target.value } }))}
                                className={`${inputCls} w-32`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {plan.unsupported.length > 0 && (
              <details className="bg-surface-inset border border-surface-line rounded-card p-3">
                <summary className="text-slate-400 text-xs cursor-pointer">
                  {plan.unsupported.length} 筆未支援的交易別（不會匯入，點開查看）
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                  {plan.unsupported.slice(0, 20).map((u, i) => <li key={i}>・{u.reason}</li>)}
                </ul>
              </details>
            )}

            {applyPreview.notes.length > 0 && (
              <details className="bg-surface-inset border border-surface-line rounded-card p-3">
                <summary className="text-slate-400 text-xs cursor-pointer">{applyPreview.notes.length} 筆提醒</summary>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                  {applyPreview.notes.slice(0, 20).map((n, i) => <li key={i}>・{n}</li>)}
                </ul>
              </details>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button onClick={reset} className="text-sm px-4 py-2 rounded-ctl bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">
                換一個檔案
              </button>
              <button onClick={handleConfirm} disabled={plan.txns.length === 0}
                className="text-sm px-4 py-2 rounded-ctl bg-accent text-white font-bold hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                確認匯入
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ImportStatementModal;
