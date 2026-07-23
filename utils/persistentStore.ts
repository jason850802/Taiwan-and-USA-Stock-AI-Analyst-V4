// utils/persistentStore.ts — localStorage 持久層工廠（Phase 12 T2）
//
// 只管「殼」：讀（try/catch＋JSON.parse＋decode 驗形＋fallback）、
// 寫（try/catch＋quota 時呼叫注入的 trimForRetry 裁一次再試）、清除。
// **域內策略一律由呼叫端注入**——哪個版本算合法、裁哪些列、失敗要不要出警告，
// 都是各 store 自己的領域知識，工廠不代為決定。
//
// 位元組相容鐵則：序列化就是 `JSON.stringify(value)`，工廠不加任何信封。
// 各 store 的 `{version:1,...}` 信封／裸陣列由呼叫端的 T 自帶，舊資料必須直接可讀、不做遷移。
//
// 純模組守則（比照 services/quoteCache.ts）：模組頂層絕不觸碰 localStorage——
// 一切 storage 取用延遲到 load/save/clear 內並包在 try/catch，Node 測試環境下可安全 import。
//
// 行為鎖：utils/persistentStore.test.ts（工廠骨架＋五把 key 的舊格式 fixture＋各自裁剪策略）。

export interface PersistentStore<T> {
  load(): T;
  save(value: T): boolean;
  clear(): void;
}

export interface PersistentStoreOptions<T> {
  /** localStorage key（逐字沿用既有字串，不得改動） */
  key: string;
  /** 缺值／壞 JSON／驗形失敗時回傳；每次呼叫都要給新物件 */
  fallback: () => T;
  /** 驗形；回傳 null 視同 fallback。未知版本要出警告的，在這裡自己 warn */
  decode?: (raw: unknown) => T | null;
  /** quota 失敗時裁一次再試；回傳 null＝無可裁，直接放棄 */
  trimForRetry?: (value: T) => T | null;
  /** 測試注入；預設 localStorage */
  storage?: Storage;
}

export const createPersistentStore = <T>(opts: PersistentStoreOptions<T>): PersistentStore<T> => {
  const { key, fallback, decode, trimForRetry } = opts;
  const storage = (): Storage => opts.storage ?? localStorage;

  const write = (value: T): boolean => {
    try {
      storage().setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    load(): T {
      try {
        const raw = storage().getItem(key);
        if (!raw) return fallback();
        const parsed = JSON.parse(raw);
        if (!decode) return parsed as T;
        const decoded = decode(parsed);
        return decoded === null ? fallback() : decoded;
      } catch {
        return fallback();
      }
    },

    save(value: T): boolean {
      if (write(value)) return true;
      if (!trimForRetry) return false;
      const trimmed = trimForRetry(value);
      if (trimmed === null) return false;
      return write(trimmed);
    },

    clear(): void {
      try {
        storage().removeItem(key);
      } catch { /* ignore */ }
    },
  };
};
