// utils/importStore.ts — 已匯入交易鍵的 localStorage 薄 IO（Phase 11 T3）
// 比照 portfolioHistoryStore：版本驗證（未知版本原樣保留、回空啟動）＋quota 守衛。
import { BrokerId } from '../types';
import { createPersistentStore } from './persistentStore';

export const KEY = 'portfolio_import_log_v1';
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

/** 儲存信封（位元組相容：`{"version":1,"keys":[...],"batches":[...]}`） */
interface ImportFile extends ImportLog { version: 1 }

const store = createPersistentStore<ImportFile>({
  key: KEY,
  fallback: () => ({ version: 1, keys: [], batches: [] }),
  decode: (raw: any) => {
    if (raw?.version !== 1 || !Array.isArray(raw.keys)) {
      console.warn('[importStore] 未知版本的匯入紀錄（原樣保留，以空紀錄啟動）:', raw?.version);
      return null;
    }
    return { version: 1, keys: raw.keys, batches: Array.isArray(raw.batches) ? raw.batches : [] };
  },
});

export const loadImportLog = (): ImportLog => {
  const f = store.load();
  return { keys: f.keys, batches: f.batches };
};

export const saveImportLog = (log: ImportLog): boolean => {
  // 兩段裁剪語意原樣保留：第一段是常態上限（keys 20000／batches 50），
  // 第二段 quota 後備的「只留最近半數鍵」是以**原始** log 計算而非常態裁剪後的結果——
  // 這是 @36c0f41 既有語意（keys 超過 MAX_KEYS 時兩者不同），故不走工廠的 trimForRetry。
  const capped: ImportFile = {
    version: 1,
    keys: log.keys.length > MAX_KEYS ? log.keys.slice(log.keys.length - MAX_KEYS) : log.keys,
    batches: log.batches.slice(-50),
  };
  if (store.save(capped)) return true;
  const halved: ImportFile = {
    version: 1,
    keys: log.keys.slice(Math.floor(log.keys.length / 2)),
    batches: log.batches.slice(-10),
  };
  const ok = store.save(halved);
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
