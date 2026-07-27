// components/portfolio/usePortfolioBackup.ts — 備份下載（票 01）與回灌（票 02）的膠水
//
// 判斷邏輯全在 utils/portfolioBackup（純模組、有行為鎖）；這裡只做瀏覽器那一半：
// 讀真實 localStorage → 產檔 → 觸發下載 → 釋放 object URL → 重新載入。
// 刻意不看 items——備份的是 storage 現況，庫存為空時交易流水／已實現帳本仍可能有東西。
//
// 詞彙照 CONTEXT.md：**備份**（不叫匯出）、**回灌**（不叫匯入／還原）、**預備份**。
import { useState } from 'react';
import {
  buildBackup, backupFileName, serializeBackup, applyBackup, isEmptyBackup, type BackupFile,
} from '../../utils/portfolioBackup';

/** 回灌成功後隔多久重新載入。留這一拍是給預備份的下載送出，別讓導頁把它取消掉。 */
const RELOAD_DELAY_MS = 400;

export const usePortfolioBackup = () => {
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  /** 回灌成功到重新載入之間的那一拍；呼叫端據此蓋上簾幕，別讓人在半途按到東西 */
  const [reloading, setReloading] = useState(false);

  /** 產檔 → 觸發下載 → 釋放 object URL，回傳檔名。備份鈕與回灌的預備份共用這一條路徑。 */
  const downloadBackup = (file: BackupFile, now: Date): string => {
    const url = URL.createObjectURL(new Blob([serializeBackup(file)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(now);
    a.click();
    // 延到下一個 tick 才釋放：同一 tick 撤銷 object URL 在部分瀏覽器會讓下載拿到空檔
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return a.download;
  };

  const handleBackup = () => {
    const now = new Date();
    let file: BackupFile;
    try {
      file = buildBackup(localStorage, now);
    } catch (e: any) {
      // buildBackup 讀不動 storage 時整包放棄——必須讓使用者看到，
      // 否則他會以為手上那個檔是完整備份（保命功能最不能有的誤解）。
      setBackupMsg(e?.message || '備份失敗，請確認瀏覽器是否封鎖了本站的儲存空間。');
      return;
    }
    setBackupMsg(`已下載備份檔 ${downloadBackup(file, now)}`);
  };

  /**
   * 回灌（使用者已在確認框看過筆數對照並點頭）：**預備份 → 覆蓋 → 重載**。
   * 順序不可調換——預備份是他回錯檔時唯一的救命索，必須在覆蓋之前落地；
   * 連預備份都產不出來（storage 讀不動）就整個中止，沒有退路就不動人家的資料。
   */
  const handleRestore = (text: string) => {
    const now = new Date();
    let current: BackupFile;
    try {
      current = buildBackup(localStorage, now);
    } catch (e: any) {
      setShowRestoreModal(false);
      setBackupMsg(`回灌已中止：${e?.message || '無法讀取現有資料'}（沒有預備份就不覆蓋）。`);
      return;
    }
    // 全新使用者（五把 key 全缺席）跳過，不塞一個空檔進他的下載資料夾
    const preName = isEmptyBackup(current) ? null : downloadBackup(current, now);

    const result = applyBackup(localStorage, text);
    setShowRestoreModal(false);
    if (result.status !== 'ok') {
      setBackupMsg(result.message);   // quota／storage 失敗都要明講，不得靜默
      return;
    }

    setBackupMsg(preName ? `回灌完成（現況已存成 ${preName}），正在重新載入…` : '回灌完成，正在重新載入…');
    setReloading(true);
    // 重載讓五把 key 在 mount 時全部重讀（只有兩把在 App 有 React state 鏡像），
    // 也避免每日快照 hook 立刻寫一筆當日 live 快照蓋掉剛回灌的內容。
    setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
  };

  return { backupMsg, showRestoreModal, setShowRestoreModal, reloading, handleBackup, handleRestore };
};
