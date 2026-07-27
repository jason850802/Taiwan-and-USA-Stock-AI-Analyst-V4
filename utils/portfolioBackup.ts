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
export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  /**
   * ISO 8601（UTC）匯出時間，供使用者分辨多個備份檔的新舊。
   * 刻意用 UTC——這欄是給機器讀的、要無歧義；**票 02 顯示給使用者時記得轉本地時間**
   * （備份檔名用的是本地時間，深夜產生的檔案兩者日期本來就會不同）。
   */
  exportedAt: string;
  /**
   * key → 該 key 的**解析後** JSON 值。刻意不存字串轉義版：檔案要人看得懂、可 diff。
   * 位元組保真沒問題——五把 key 現行寫入全部經由 JSON.stringify（persistentStore 工廠），
   * 故 parse→stringify 往返後位元組相同（行為鎖有此案例）。
   * **缺席的 key 不出現在這裡**（不寫成 null），回灌時「該移除就移除」靠這個語意。
   */
  data: Record<string, unknown>;
  /**
   * 內容不是合法 JSON 的 key（例如寫入被截斷），**原字串原封不動**收在這裡。
   * 為什麼不直接丟掉：這是使用者的最後一份副本，被截斷的內容往往還留著大半筆交易，
   * 是最需要帶出瀏覽器、之後手動搶救的東西——靜默丟棄正是保命功能不可接受的洞。
   * 回灌不會套用這一段（票 02）。無此情況時本欄位缺席，正常備份檔看不到它。
   */
  unparsed?: Record<string, string>;
}

/** storage 讀取失敗——備份必須整包放棄，不得產出殘缺卻看起來正常的檔案 */
export class BackupReadError extends Error {
  constructor(public readonly key: string) {
    super(`無法讀取「${key}」，備份已中止（瀏覽器可能處於無痕模式或封鎖了本站儲存空間）。`);
    this.name = 'BackupReadError';
  }
}

/**
 * 收集備份。三種情況三種處置，**沒有一種是靜默少一塊**：
 *  - key 缺席 → data 中亦缺席（回灌時「該移除就移除」靠這語意）
 *  - key 內容壞掉 → 原字串收進 unparsed，位元組一個不少
 *  - storage 讀不動 → 丟 BackupReadError，整包放棄；呼叫端須把錯誤顯示給使用者
 */
export function buildBackup(storage: Storage, now: Date): BackupFile {
  const data: Record<string, unknown> = {};
  const unparsed: Record<string, string> = {};

  for (const key of BACKUP_KEYS) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      // 只跳過這一把的話，會下載一個格式完整、內容殘缺、檔名正常的備份檔，
      // 而使用者毫無所覺——那比按了沒反應更糟。整包中止。
      throw new BackupReadError(key);
    }
    if (raw === null) continue; // 缺席就是缺席

    try {
      data[key] = JSON.parse(raw);
    } catch {
      unparsed[key] = raw;
      console.warn(`[portfolioBackup] ${key} 內容非合法 JSON，已以原始字串收進備份的 unparsed 區`);
    }
  }

  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data,
    ...(Object.keys(unparsed).length > 0 ? { unparsed } : {}),
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

// ── 回灌（票 02）────────────────────────────────────────────────────────────
//
// 回灌是**覆蓋式**（ADR-0001 第 3 條）：storage 的五把本體 key 整包換成備份檔的樣子。
// 不合併、不部分回灌——已實現帳本與每日快照沒有去重鍵，合併會把同一筆賣出的損益
// 算兩次，而畫面不會有任何徵兆。

export type BackupKey = typeof BACKUP_KEYS[number];

/** 拒收理由；每一種都要能讓使用者知道下一步該做什麼 */
export type RejectCode = 'not-json' | 'not-our-file' | 'unknown-version' | 'bad-data';

/**
 * 判別欄位刻意用字串而非 `ok: boolean`——本專案 tsconfig 非 strict，布林判別式
 * narrow 不進失敗分支（`if (r.ok) return` 之後 TS 仍看不到 message），呼叫端會被迫
 * 用 `as any` 才取得到錯誤訊息。字串判別式在非 strict 下照樣 narrow。
 */
export interface BackupRejection { status: 'rejected'; code: RejectCode; message: string }

export type ParseResult = { status: 'ok'; file: BackupFile } | BackupRejection;

const reject = (code: RejectCode, message: string): BackupRejection => ({ status: 'rejected', code, message });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 驗證備份檔。任一項不過即**整包拒收**，回傳理由；呼叫端據此顯示訊息。
 *
 * 刻意**不驗各 key 的內容形狀**：本模組不認得領域型別，而且驗過頭會把
 * 「現行 decode() 收不了、但人還救得回來」的資料擋在門外——那正是備份存在的意義。
 * 驗的只有信封：是不是本 App 的檔、版本認不認得、資料段是不是物件。
 */
export function parseBackupFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reject('not-json', '這個檔案不是 JSON，看起來不是本 App 的備份檔。');
  }

  if (!isPlainObject(raw) || raw.app !== BACKUP_APP_ID) {
    return reject('not-our-file', '這不是本 App 產生的備份檔。為免蓋掉現有資料，已整包拒收。');
  }

  if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    // 未知版本的處置沿用 txnStore 的慣例：拒收並 warn，原資料保留
    console.warn('[portfolioBackup] 未知的備份檔 schema 版本（整包拒收，現有資料未動）:', raw.schemaVersion);
    const newer = typeof raw.schemaVersion === 'number' && raw.schemaVersion > BACKUP_SCHEMA_VERSION;
    // 使用者要分得出「檔案壞了」與「App 太舊」——後者去更新就救得回來
    return reject('unknown-version', newer
      ? `這個備份檔來自較新版本的 App（格式 v${raw.schemaVersion}），請先更新 App 再回灌。`
      : '無法辨識這個備份檔的格式版本，請確認檔案是否完整，或更新 App 後再試。');
  }

  const data = raw.data;
  if (!isPlainObject(data)) {
    return reject('bad-data', '備份檔的資料段損毀（不是預期的格式），已整包拒收，現有資料未被更動。');
  }

  // unparsed 區形狀壞掉**不拒收**：它從頭到尾不會被套用，只用來在確認框上告知
  // 「這幾把當初就壞了」。整份 data 還救得回來卻為了這一區擋下來，是本末倒置
  // （拒收的三道門就是 spec 寫的那三道：不是本 App 的檔、版本不認得、資料段非物件）。
  const unparsed = normalizeUnparsed(raw.unparsed);

  return {
    status: 'ok',
    file: {
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      // 時間欄位只影響顯示：壞掉就給空字串讓顯示端退成「未知時間」。
      // 為了一個看板欄位擋掉整份還救得回來的資料，是本末倒置。
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      data,
      ...(unparsed ? { unparsed } : {}),
    },
  };
}

/** 只留下形狀正確（key → 原字串）的部分；全壞或不是物件就當作沒有這一區並 warn */
const normalizeUnparsed = (raw: unknown): Record<string, string> | null => {
  if (raw === undefined) return null;
  const entries = isPlainObject(raw)
    ? Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string')
    : [];
  if (!isPlainObject(raw) || entries.length !== Object.keys(raw).length) {
    console.warn('[portfolioBackup] 備份檔的 unparsed 區形狀異常，已忽略該區（不影響資料段的回灌）');
  }
  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

export type ApplyResult =
  | { status: 'ok' }
  | { status: 'rejected'; code: RejectCode | 'write-failed'; message: string };

/** 把已改動的 key 逐一還原成回灌前的位元組；全部成功才回 true */
const rollback = (storage: Storage, before: Record<string, string | null>, done: BackupKey[]): boolean => {
  let allOk = true;
  for (const key of done) {
    try {
      const prev = before[key];
      if (prev === null) storage.removeItem(key);
      else storage.setItem(key, prev);
    } catch {
      allOk = false;
    }
  }
  return allOk;
};

/**
 * 套用備份檔：五把本體 key 換成備份檔的樣子，回灌後的 storage 與備份當下等價。
 *
 * 刻意吃「使用者手上那份檔案的原始文字」而不是已解析的物件——**驗證先於寫入**
 * 因此是結構保證，而不是呼叫端要自律的事：沒有任何一條路徑能繞過 parseBackupFile
 * 去寫 storage。被拒收的檔案，一把 key 都不會被碰。
 *
 * 全有全無：先把五把 key 的現況原字串讀下來，任一步寫入失敗就逐一還原——
 * 「寫到一半」的半殘庫存比回灌失敗更糟，因為畫面看起來一切正常。
 */
export function applyBackup(storage: Storage, text: string): ApplyResult {
  const parsed = parseBackupFile(text);
  if (parsed.status !== 'ok') return parsed;   // 此時一把 key 都還沒被碰過

  const { data } = parsed.file;

  // 讀不到現況就沒有可還原的退路——寧可不動手
  const before: Record<string, string | null> = {};
  try {
    for (const key of BACKUP_KEYS) before[key] = storage.getItem(key);
  } catch {
    return {
      status: 'rejected',
      code: 'write-failed',
      message: '無法讀取現有資料，回灌已中止（瀏覽器可能封鎖了本站的儲存空間）。現有資料未被更動。',
    };
  }

  const done: BackupKey[] = [];
  try {
    for (const key of BACKUP_KEYS) {
      // 備份檔裡缺席的 key 就該從 storage 消失——寫成空值會讓「回灌後＝備份當下」破功。
      // 當初壞掉的 key 收在 unparsed 而不在 data，所以也走這條：不還原壞內容，
      // 也不留著現況的舊值（留著就變成合併了）。確認框會先告知使用者。
      if (Object.prototype.hasOwnProperty.call(data, key)) storage.setItem(key, JSON.stringify(data[key]));
      else storage.removeItem(key);
      done.push(key);
    }
  } catch {
    return {
      status: 'rejected',
      code: 'write-failed',
      message: rollback(storage, before, done)
        ? '回灌失敗：寫入被瀏覽器拒絕（多半是儲存空間不足）。現有資料已全數還原，請清出空間後再試。'
        : '回灌失敗：寫入被瀏覽器拒絕（多半是儲存空間不足），且還原現有資料時再次失敗——'
          + '請立刻用剛才下載的預備份檔重新回灌。',
    };
  }

  return { status: 'ok' };
}

/** 五把 key 各自的筆數；null＝形狀對不上，數不出來 */
export type EntryCounts = Record<BackupKey, number | null>;

/**
 * 各 key 的「筆數」要看哪個陣列：持股是裸陣列，其餘四把包在 `{version,…}` 信封裡。
 * 這不是領域型別知識，只是 key → 陣列欄位的位置表（本模組刻意不 import 任何 store 的
 * 型別，代價是欄位改名這裡不會 tsc 紅字——靠行為鎖那支真實 fixture 的筆數斷言守）。
 * 對不上就回 null（不明），**絕不拋錯、也不謊報 0**——確認框上的 0 會被讀成
 * 「本來就沒資料」，那是會害使用者按下去的誤導。
 */
const COUNT_FIELD: Record<BackupKey, string | null> = {
  portfolio_items: null,                    // 五把中唯一的裸陣列
  portfolio_transactions_v1: 'txns',
  portfolio_import_log_v1: 'keys',          // 去重鍵＝已匯入的交易筆數
  portfolio_realized_trades_v1: 'trades',
  portfolio_snapshots_v1: 'rows',
};

const countValue = (key: BackupKey, value: unknown): number | null => {
  const field = COUNT_FIELD[key];
  const arr = field === null ? value : (isPlainObject(value) ? value[field] : undefined);
  return Array.isArray(arr) ? arr.length : null;
};

/** 現況的筆數（確認框左半邊）。storage 讀不動或內容壞掉都只回 null，不拋錯 */
export function countStorageEntries(storage: Storage): EntryCounts {
  const out = {} as EntryCounts;
  for (const key of BACKUP_KEYS) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      out[key] = null;
      continue;
    }
    if (raw === null) { out[key] = 0; continue; }   // 缺席＝確實零筆
    try {
      out[key] = countValue(key, JSON.parse(raw));
    } catch {
      out[key] = null;
    }
  }
  return out;
}

/**
 * 備份檔的筆數（確認框右半邊）。口徑是**回灌之後 storage 會有幾筆**，不是檔案裡躺了幾筆：
 * 當初壞掉的 key 收在 unparsed 而不在 data，回灌時會被移除，所以是 0 筆而非「不明」——
 * 報「不明」會讓那一列失去「變少了」的黃字提示，正好是最該提醒的那一列。
 * （那些 key 為何歸零，確認框另有一段明講。）
 */
export function countBackupEntries(file: BackupFile): EntryCounts {
  const out = {} as EntryCounts;
  for (const key of BACKUP_KEYS) {
    out[key] = Object.prototype.hasOwnProperty.call(file.data, key) ? countValue(key, file.data[key]) : 0;
  }
  return out;
}

/** 現況五把 key 全缺席 → 預備份會是個空檔，不必下載（別塞垃圾進使用者的下載資料夾） */
export function isEmptyBackup(file: BackupFile): boolean {
  return Object.keys(file.data).length === 0 && Object.keys(file.unparsed ?? {}).length === 0;
}
