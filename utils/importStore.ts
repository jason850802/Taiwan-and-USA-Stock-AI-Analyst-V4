// utils/importStore.ts — 已匯入交易鍵的 localStorage 薄 IO（Phase 11 T3）
// 比照 portfolioHistoryStore：版本驗證（未知版本原樣保留、回空啟動）＋quota 守衛。
import { BrokerId } from '../types';

const KEY = 'portfolio_import_log_v1';
const MAX_KEYS = 20000;   // 每筆鍵約 40 bytes，上限約 800KB

export interface ImportBatch {
  at: number;
  broker: BrokerId;
  fileName: string;
  count: number;
}

export interface ImportLog {
  keys: string[];
  batches: ImportBatch[];
}

const EMPTY: ImportLog = { keys: [], batches: [] };

export const loadImportLog = (): ImportLog => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.keys)) {
      console.warn('[importStore] 未知版本的匯入紀錄（原樣保留，以空紀錄啟動）:', parsed?.version);
      return { ...EMPTY };
    }
    return { keys: parsed.keys, batches: Array.isArray(parsed.batches) ? parsed.batches : [] };
  } catch {
    return { ...EMPTY };
  }
};

export const saveImportLog = (log: ImportLog): boolean => {
  const trim = (l: ImportLog): ImportLog => ({
    keys: l.keys.length > MAX_KEYS ? l.keys.slice(l.keys.length - MAX_KEYS) : l.keys,
    batches: l.batches.slice(-50),
  });
  const attempt = (l: ImportLog): boolean => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, ...l }));
      return true;
    } catch {
      return false;
    }
  };
  if (attempt(trim(log))) return true;
  // quota 後備：只留最近半數鍵再試一次
  const halved: ImportLog = { keys: log.keys.slice(Math.floor(log.keys.length / 2)), batches: log.batches.slice(-10) };
  const ok = attempt(halved);
  if (!ok) console.warn('[importStore] 匯入紀錄寫入失敗（storage 滿或不可用）');
  return ok;
};

/** 追加本次匯入的鍵與批次摘要 */
export const appendImportBatch = (
  prev: ImportLog,
  keys: string[],
  batch: Omit<ImportBatch, 'count'>,
): ImportLog => ({
  keys: [...prev.keys, ...keys],
  batches: [...prev.batches, { ...batch, count: keys.length }],
});
