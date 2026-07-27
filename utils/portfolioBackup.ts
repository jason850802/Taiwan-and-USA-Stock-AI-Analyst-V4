// utils/portfolioBackup.ts — 庫存備份（票 01；規格 .scratch/portfolio-backup/spec.md）
//
// 詞彙照 CONTEXT.md：這叫**備份**（不叫匯出）；讀回來的動作叫**回灌**（票 02）。
//
// 本模組**刻意不認得領域型別**（不 import PortfolioItem／StoredTxn…），只認 key 名字、
// 搬原始 JSON 值。理由是備份必須存「現場實際有什麼」而不是「現行 decode() 肯收什麼」——
// 走各 store 的 loadXxx() 的話，任何被 decode 拒收的資料（未來版本、形狀異常）會悄悄
// 不進備份，這對保命功能是不可接受的洞。
//
// 純模組守則（比照 utils/persistentStore.ts）：Storage 與時間都由呼叫端注入，
// 模組頂層不觸碰任何瀏覽器全域，Node 測試環境可安全 import。
//
// 行為鎖：utils/portfolioBackup.test.ts。

/**
 * **本體資料**——重建不回來的五把 key，本功能唯一的 key 來源。
 * 刻意排除**可重建資料**：portfolio_close_cache_v1（收盤價可重抓）、
 * gemini_cache_v1|*（AI 分析快取，當日即棄）。
 * 日後新增第六把本體 key 時改這裡，並同步更新 CONTEXT.md 的詞彙表。
 */
export const BACKUP_KEYS = [
  'portfolio_items',
  'portfolio_transactions_v1',
  'portfolio_import_log_v1',
  'portfolio_realized_trades_v1',
  'portfolio_snapshots_v1',
] as const;

/** 檔案來源識別——回灌時用來擋掉不是本 App 產生的檔案（票 02） */
export const BACKUP_APP_ID = 'taiwan-usa-stock-ai-analyst';

/** 備份檔 schema 版本；回灌只收認得的版本，未知版本整包拒收（票 02） */
export const BACKUP_SCHEMA = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  schema: typeof BACKUP_SCHEMA;
  /** ISO 8601 匯出時間，供使用者分辨多個備份檔的新舊 */
  exportedAt: string;
  /**
   * key → 該 key 的**解析後** JSON 值。刻意不存字串轉義版：檔案要人看得懂、可 diff。
   * 位元組保真沒問題——五把 key 現行寫入全部經由 JSON.stringify（persistentStore 工廠），
   * 故 parse→stringify 往返後位元組相同（行為鎖有此案例）。
   * **缺席的 key 不出現在這裡**（不寫成 null），回灌時「該移除就移除」靠這個語意。
   */
  data: Record<string, unknown>;
}

/** 收集備份：讀不到／壞 JSON 的 key 一律略過（不拋錯），其餘照收 */
export function buildBackup(storage: Storage, now: Date): BackupFile {
  const data: Record<string, unknown> = {};

  for (const key of BACKUP_KEYS) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue; // storage 不可用（無痕模式／SecurityError）：整批放棄，不讓備份鍵盤失效
    }
    if (raw === null) continue; // 缺席就是缺席

    try {
      data[key] = JSON.parse(raw);
    } catch {
      // 壞 JSON：該把資料其實已經救不回來了（各 store 的 load 也只會回 fallback），
      // 但不能靜默——沿用專案 store 的 console.warn 慣例讓它至少留下痕跡。
      console.warn(`[portfolioBackup] ${key} 內容非合法 JSON，已排除於備份之外`);
    }
  }

  return {
    app: BACKUP_APP_ID,
    schema: BACKUP_SCHEMA,
    exportedAt: now.toISOString(),
    data,
  };
}

/**
 * 備份檔名：`stock-analyst-backup-YYYYMMDD-HHmm.json`（本地時間）。
 * 用連字號而非 ISO 原字串——`:` 是 Windows 檔名禁用字元。
 * 形狀固定寬度，依檔名字串排序即等於依時間排序。
 */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    + `-${p(now.getHours())}${p(now.getMinutes())}`;
  return `stock-analyst-backup-${stamp}.json`;
}

/** 序列化備份檔：兩空格縮排，讓使用者打開看得懂、也能 diff */
export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}
