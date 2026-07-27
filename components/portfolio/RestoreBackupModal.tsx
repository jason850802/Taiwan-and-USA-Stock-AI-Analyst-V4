// components/portfolio/RestoreBackupModal.tsx — 回灌備份檔的確認框（票 02）
//
// 詞彙照 CONTEXT.md：這叫**回灌**（不叫匯入／還原）——「匯入」已被對帳單功能佔用。
// 流程：選檔 → 驗檔（不過就整包拒收）→ 筆數對照 → 使用者確認 → 交回呼叫端執行
// 「預備份 → 覆蓋 → 重載」。**本元件不寫任何一把 key、也不下載任何東西**，
// 取消時因此天然零副作用。判斷邏輯全在 utils/portfolioBackup（純模組、有行為鎖）。
import React, { useCallback, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import {
  BACKUP_KEYS, parseBackupFile, countBackupEntries, countStorageEntries,
  type BackupFile, type BackupKey, type EntryCounts,
} from '../../utils/portfolioBackup';
import { AlertTriangle, FileJson, Loader2, Upload } from 'lucide-react';

/** 對照表每一列的名字。少一把會 TS 紅字——新增第六把本體 key 時不會漏掉這裡 */
const KEY_LABELS: Record<BackupKey, string> = {
  portfolio_items: '持股',
  portfolio_transactions_v1: '交易流水',
  portfolio_realized_trades_v1: '已實現損益',
  portfolio_import_log_v1: '匯入去重鍵',
  portfolio_snapshots_v1: '每日快照',
};

/** 票 02 指定要對照的三項排前面，其餘照 BACKUP_KEYS 的順序接著列（新增的 key 自動出現） */
const PRIMARY_KEYS: BackupKey[] = ['portfolio_items', 'portfolio_transactions_v1', 'portfolio_realized_trades_v1'];
const ROW_KEYS: BackupKey[] = [...PRIMARY_KEYS, ...BACKUP_KEYS.filter(k => !PRIMARY_KEYS.includes(k))];

/** null＝形狀對不上、數不出來。顯示「不明」而不是 0——0 會被讀成「本來就沒資料」 */
const fmtCount = (n: number | null) => (n === null ? '不明' : n.toLocaleString('zh-TW'));

/** exportedAt 欄位是 UTC，顯示前一定要轉本地時間（深夜產生的檔案會跟檔名差一天） */
const localTime = (iso: string) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '未知時間' : t.toLocaleString('zh-TW', { hour12: false });
};

interface RestoreBackupModalProps {
  open: boolean;
  onClose: () => void;
  /** 使用者按下確認；呼叫端負責預備份 → 覆蓋 → 重載 */
  onConfirm: (text: string) => void;
}

/** 通過驗證、等使用者點頭的那份檔案 */
interface PickedBackup {
  text: string;
  file: BackupFile;
  from: EntryCounts;   // 現有
  to: EntryCounts;     // 回灌後
}

const RestoreBackupModal: React.FC<RestoreBackupModalProps> = ({ open, onClose, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [picked, setPicked] = useState<PickedBackup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPicked(null); setError(null); setFileName(''); setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleFile = async (f: File) => {
    setBusy(true); setError(null); setPicked(null); setFileName(f.name);
    let text: string;
    try {
      text = await f.text();
    } catch (e: any) {
      setError(`檔案讀取失敗：${e?.message || '無法讀取檔案內容'}`);
      setBusy(false);
      return;
    }

    const parsed = parseBackupFile(text);
    if (parsed.status !== 'ok') {
      setError(parsed.message);   // 驗不過就到此為止，連確認框都不給看
      setBusy(false);
      return;
    }

    // 現況筆數在這個當下算——左欄就是他按下確認後會被換掉的東西
    setPicked({
      text,
      file: parsed.file,
      from: countStorageEntries(localStorage),
      to: countBackupEntries(parsed.file),
    });
    setBusy(false);
  };

  // 取消＝什麼都沒發生：不下載預備份、不寫任何 key
  const handleClose = () => { reset(); onClose(); };

  const handleConfirm = () => {
    if (!picked) return;
    const { text } = picked;
    // 先清空自己再交出去：回灌成功會重新載入整頁，但失敗時呼叫端只是把 Modal 關掉——
    // 沒清的話下次打開會停在上一份檔案的對照畫面，筆數還是舊的。
    reset();
    onConfirm(text);
  };

  const unparsedKeys = picked ? Object.keys(picked.file.unparsed ?? {}) : [];

  return (
    <Modal open={open} onClose={handleClose} title="回灌備份檔" maxWidth="max-w-xl">
      <div className="space-y-4">
        {/* ── 選檔 ─────────────────────────────────────────────── */}
        {!picked && (
          <div className="space-y-3">
            <div className="border border-dashed border-surface-line rounded-card p-8 text-center">
              <FileJson className="mx-auto text-slate-500 mb-3" size={32} />
              <p className="text-slate-300 text-sm mb-1">選擇先前用「備份」下載的 JSON 檔</p>
              <p className="text-slate-500 text-xs mb-4">
                回灌會用檔案內容<span className="text-amber-300">整包覆蓋</span>目前的庫存資料
              </p>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-ctl bg-accent text-white text-sm font-bold hover:bg-accent/80 transition-colors disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {busy ? '讀取中…' : '選擇備份檔'}
              </button>
            </div>
            {error && (
              <div className="flex items-start gap-2 bg-danger-muted border border-danger/30 rounded-card p-3">
                <AlertTriangle size={15} className="text-danger mt-0.5 shrink-0" />
                <div>
                  <p className="text-danger text-sm">{error}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {fileName && `${fileName}・`}現有資料一個位元組都沒有被更動
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 確認：筆數對照 ────────────────────────────────────── */}
        {picked && (
          <div className="space-y-4">
            {/* 檔名與匯出時間——要讓他在按下去之前就發現選錯檔 */}
            <div className="bg-surface-inset border border-surface-line rounded-card p-3
              flex items-center justify-between gap-3 text-sm">
              <span className="text-white font-bold truncate">{fileName}</span>
              {/* 詞彙照 CONTEXT.md：講「備份於」不講「匯出於」——匯出留給 P2 的 CSV 報表 */}
              <span className="text-slate-500 text-xs shrink-0">備份於 {localTime(picked.file.exportedAt)}</span>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-surface-line">
                  <th className="py-1.5 text-left font-medium">資料</th>
                  <th className="py-1.5 text-right font-medium">現有</th>
                  <th className="py-1.5 w-10" />
                  <th className="py-1.5 text-right font-medium">回灌後</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {ROW_KEYS.map(k => {
                  const from = picked.from[k];
                  const to = picked.to[k];
                  // 變少的欄位標黃：使用者最該注意的就是「這幾筆會不見」
                  const shrinking = from !== null && to !== null && to < from;
                  return (
                    <tr key={k} className="border-b border-surface-line/50">
                      <td className="py-1.5 font-sans text-slate-300">{KEY_LABELS[k]}</td>
                      <td className="py-1.5 text-right text-slate-400">{fmtCount(from)}</td>
                      <td className="py-1.5 text-center text-slate-600">→</td>
                      <td className={`py-1.5 text-right font-bold ${shrinking ? 'text-amber-300' : 'text-white'}`}>
                        {fmtCount(to)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-start gap-2 bg-warn/10 border border-warn/40 rounded-card p-3">
              <AlertTriangle size={15} className="text-warn mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300 space-y-1">
                <p className="text-warn text-sm font-bold">備份之後新增的資料會被捨棄</p>
                <p>
                  回灌是整包覆蓋：這份備份檔產生<span className="text-amber-300">之後</span>你新增的持股、
                  匯入的對帳單、賣出紀錄與每日快照都會消失，且無法復原。
                </p>
                <p>按下確認時會先自動下載一份「現況」的備份檔當救命索，接著才覆蓋，完成後整頁重新載入。</p>
                <p className="text-slate-500">
                  收盤價快取不在備份範圍，回灌後第一次看歷史損益曲線會重抓行情、稍慢幾秒。
                </p>
              </div>
            </div>

            {/* 備份當下就已損壞的 key：靜默忽略等於騙人，這裡明講 */}
            {unparsedKeys.length > 0 && (
              <div className="flex items-start gap-2 bg-surface-inset border border-surface-line rounded-card p-3">
                <AlertTriangle size={15} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-400">
                  這份備份檔裡有 {unparsedKeys.length} 把資料在備份當下就已損壞
                  （{unparsedKeys.map(k => (KEY_LABELS as Record<string, string>)[k] ?? k).join('、')}），
                  回灌<span className="text-amber-300">不會</span>還原它們——回灌後這些資料會從瀏覽器中消失。
                  原始內容仍完整保留在備份檔的 unparsed 區，可自行打開檔案搶救。
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={reset}>換一個檔案</Button>
              <Button variant="ghost" onClick={handleClose}>取消</Button>
              <Button variant="danger" onClick={handleConfirm}>
                確認回灌（覆蓋現有資料）
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RestoreBackupModal;
