// quoteCache.ts — 行情快取基座（B-1，quick-260712-vno）
//
// 純模組守則：不 import React；模組頂層絕不觸碰 sessionStorage/window——
// 一切瀏覽器 API 取用延遲到函式內並 try/catch，使 `npx tsx` 在 Node 下可直接 import 直測。
//
// 分層：memory Map 為權威層（同 session 內切週期/切回標的全覆蓋）；
// sessionStorage 為 best-effort 加值層（F5 存活）——一切讀寫失敗（配額滿/無痕模式/
// JSON 壞損）silent 全退化，絕不拋錯（比照 services/finmind.ts writeSessionCache 先例）。
//
// TTL 政策（.planning/optimization/PLAN.md 已拍板決策 3）：
// 盤中 10 分鐘／收盤後沿用到下一交易日開盤（台美各依自己交易時段）。

export type QuoteMarket = 'TW' | 'US';

export interface QuoteCacheEntry {
  cachedAt: number;      // 寫入時刻（ms epoch）
  shortTtlOnly: boolean; // true＝只享 10 分鐘短 TTL、不享收盤後沿用（chipDataUnavailable 結果）
  result: unknown;       // getStockData 管線終點的最終 {info, data}
}

// ── 市場歸屬 ──
export function marketForSymbol(symbol: string): QuoteMarket {
  const s = symbol.trim().toUpperCase();
  // .TW/.TWO 後綴、或裸台股代碼（2330 / 00679B / 2888A）→ 台股；其餘（AAPL、USDTWD=X）→ 美股時段
  if (/\.TWO?$/.test(s) || /^\d{3,6}[A-Z]?$/.test(s)) return 'TW';
  return 'US';
}

// ── 交易時段判定 ──
const MARKET_TZ: Record<QuoteMarket, string> = {
  TW: 'Asia/Taipei',
  US: 'America/New_York',
};

// 開收盤（交易所當地分鐘數，[open, close)）：TW 09:00–13:30、US 09:30–16:00
const MARKET_SESSION: Record<QuoteMarket, { open: number; close: number }> = {
  TW: { open: 9 * 60, close: 13 * 60 + 30 },
  US: { open: 9 * 60 + 30, close: 16 * 60 },
};

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

// Intl.DateTimeFormat 建構昂貴，isQuoteCacheFresh 的取樣迴圈會呼叫上百次——依 timeZone 快取重用
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isMarketOpen(msEpoch: number, market: QuoteMarket): boolean {
  // 模式照抄 services/yahoo.ts getExchangeTime（formatToParts 取交易所當地 weekday＋時分）。
  // DST 交給 Intl：America/New_York 自動處理 EST/EDT。
  const parts = getFormatter(MARKET_TZ[market]).formatToParts(new Date(msEpoch));
  const p: Record<string, string> = {};
  parts.forEach(({ type, value }) => { p[type] = value; });

  if (!WEEKDAYS.has(p.weekday)) return false;

  let h = p.hour ? parseInt(p.hour, 10) : 0;
  const m = p.minute ? parseInt(p.minute, 10) : 0;
  if (h === 24) h = 0; // hour12:false 下午夜可能回 '24'，正規化為 0（同 getExchangeTime）

  const minutes = h * 60 + m;
  const session = MARKET_SESSION[market];
  return minutes >= session.open && minutes < session.close;
}

// ── TTL 判定（已拍板決策 3：盤中 10 分鐘／收盤後沿用到下一交易日開盤）──
// 演算法順序即語意，勿重排。
export function isQuoteCacheFresh(
  cachedAtMs: number,
  nowMs: number,
  market: QuoteMarket,
  shortTtlOnly?: boolean,
): boolean {
  // 1. 盤中 10 分鐘規則（兼作萬用短窗）
  if (nowMs - cachedAtMs < 10 * 60_000) return true;
  // 2. planner_rulings #3：chipDataUnavailable 結果只享短 TTL、不享收盤後沿用
  if (shortTtlOnly) return false;
  // 3. 此刻盤中且已超過 10 分鐘 → 過期
  if (isMarketOpen(nowMs, market)) return false;
  // 4. 快取寫入時在盤中，其後已跨越收盤 → 資料缺當日尾盤 → 過期
  //   （覆蓋「盤中 10:00 快取、當日 15:00 讀」情境）
  if (isMarketOpen(cachedAtMs, market)) return false;
  // 5. 安全上界 72h：正常週末 TW 週五 13:30→週一 09:00 ≈ 67.5h、US ≈ 65.5h 都在界內；
  //    春節等長假提早過期只是多抓一次，無害
  if (nowMs - cachedAtMs > 72 * 3_600_000) return false;
  // 6. 自 cachedAt+30min 起每 30 分鐘取樣至 now：任一取樣點開盤 → 期間曾開盤 → 過期
  //   （30 分鐘步長遠小於最短交易時段 270 分鐘，不可能漏偵測整個時段）
  for (let t = cachedAtMs + 30 * 60_000; t <= nowMs; t += 30 * 60_000) {
    if (isMarketOpen(t, market)) return false;
  }
  // 7. 收盤後快取且期間未曾開盤 → 沿用到下一交易日開盤
  return true;
}

// ── 雙層快取存取 ──
const SS_PREFIX = 'quote_cache_v1:';
const memCache = new Map<string, QuoteCacheEntry>();

function isValidEntry(x: any): x is QuoteCacheEntry {
  return !!x && typeof x === 'object'
    && typeof x.cachedAt === 'number'
    && typeof x.shortTtlOnly === 'boolean'
    && x.result !== undefined && x.result !== null;
}

export function readQuoteCache(key: string): QuoteCacheEntry | null {
  const hit = memCache.get(key);
  if (hit) return hit;
  // sessionStorage 層（best-effort）：Node 環境/無痕模式/壞損 JSON 一律 silent 回 null
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidEntry(parsed)) {
      sessionStorage.removeItem(SS_PREFIX + key);
      return null;
    }
    memCache.set(key, parsed); // 讀到即回填 memory（權威層）
    return parsed;
  } catch {
    try { sessionStorage.removeItem(SS_PREFIX + key); } catch { /* ignore */ }
    return null;
  }
}

export function writeQuoteCache(key: string, entry: QuoteCacheEntry): void {
  memCache.set(key, entry); // memory 必寫（權威層）

  // sessionStorage best-effort：1d|10y 一檔約 1.5-2.5MB，~5MB 配額只放得下 1-2 檔大 entry——
  // 可接受，主要痛點（同 session 內切週期/切回標的）memory 層全覆蓋。
  let payload: string;
  try {
    payload = JSON.stringify(entry);
  } catch {
    return; // 序列化失敗（循環參照等理論情境）→ 放棄 sessionStorage 層
  }
  try {
    sessionStorage.setItem(SS_PREFIX + key, payload);
  } catch {
    // QuotaExceeded 之類：best-effort 清掉所有自家前綴 key 再重試一次，再失敗就放棄
    try {
      const own: string[] = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(SS_PREFIX)) own.push(k);
      }
      own.forEach(k => sessionStorage.removeItem(k));
      sessionStorage.setItem(SS_PREFIX + key, payload);
    } catch { /* silent，絕不 throw——memory 層仍有效 */ }
  }
}

// 只寫 memory 的別名（同一 entry 參照，零成本）——
// 供 yahoo.ts 把 `2330|1d` 與 `2330.TW|1d` 指向同一份快取。
export function writeMemoryAlias(aliasKey: string, entry: QuoteCacheEntry): void {
  memCache.set(aliasKey, entry);
}
