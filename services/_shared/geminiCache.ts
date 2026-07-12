// ───────────────────────────────────────────────────────────────
// Gemini 分析結果透明快取（localStorage，同台北日期＋同輸入命中即免重打 API）
// 零 import 純模組：localStorage 只在函式內部觸碰並以 typeof 守衛，
// 模組頂層不得存取任何瀏覽器全域——本模組須可用 esbuild 轉 CJS 後在 node 直測。
// ───────────────────────────────────────────────────────────────

export const CACHE_PREFIX = 'gemini_cache_v1|';
const MAX_ENTRIES = 50;

/** FNV-1a 32-bit 雜湊，回傳 hex 字串（無依賴、對 prompt 級長度足夠） */
export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** 台北時區今日 YYYY-MM-DD（鏡像 services/finmind.ts 的 module-private Intl 實作） */
export function taipeiTodayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 快取 key：prefix|mode|日期|hash(systemInstruction + ' ' + prompt)。日期由呼叫端注入，讓「日期參與 key」可被直測斷言。 */
export function buildCacheKey(mode: string, dateStr: string, systemInstruction: string, prompt: string): string {
  return `${CACHE_PREFIX}${mode}|${dateStr}|${fnv1aHash(systemInstruction + ' ' + prompt)}`;
}

type CacheEntry = { text: string; ts: number };

/** 讀快取：localStorage 不可用／parse 失敗／text 非非空字串 → 一律 null（不拋錯） */
export function readCache(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (typeof entry.text === 'string' && entry.text.length > 0) return entry.text;
    return null;
  } catch {
    return null;
  }
}

/** 收集所有本快取 prefix 的 key（先收再處理，不可邊迭代邊刪） */
function collectCacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  return keys;
}

/** 依 ts 淘汰最舊條目，直到同 prefix 條目數 ≤ limit */
function evictOldest(limit: number): void {
  const entries = collectCacheKeys()
    .map(k => {
      let ts = 0;
      try {
        const parsed = JSON.parse(localStorage.getItem(k) ?? '') as CacheEntry;
        ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
      } catch {
        ts = 0; // 壞條目視為最舊，優先淘汰
      }
      return { k, ts };
    })
    .sort((a, b) => a.ts - b.ts);
  while (entries.length > limit) {
    const oldest = entries.shift();
    if (!oldest) break;
    localStorage.removeItem(oldest.k);
  }
}

/** 寫快取：跨日順手清舊日期條目→寫入→超過 50 筆淘汰最舊；任何失敗靜默放棄 */
export function writeCache(key: string, text: string): void {
  try {
    if (typeof localStorage === 'undefined') return;

    // 1. 跨日清理：日期段（key 以 | split 後 index 2）≠ 今日者一律移除
    const today = taipeiTodayStr();
    for (const k of collectCacheKeys()) {
      if (k.split('|')[2] !== today) localStorage.removeItem(k);
    }

    // 2. 寫入；quota 錯誤時淘汰最舊一筆後重試一次，再失敗即放棄
    const payload = JSON.stringify({ text, ts: Date.now() } satisfies CacheEntry);
    try {
      localStorage.setItem(key, payload);
    } catch {
      evictOldest(Math.max(0, collectCacheKeys().length - 1));
      localStorage.setItem(key, payload);
    }

    // 3. 上限控管：> MAX_ENTRIES 時依 ts 升冪淘汰最舊直到 ≤ MAX_ENTRIES
    if (collectCacheKeys().length > MAX_ENTRIES) evictOldest(MAX_ENTRIES);
  } catch {
    // 靜默放棄——快取層任何錯誤不得外洩到呼叫端
  }
}
