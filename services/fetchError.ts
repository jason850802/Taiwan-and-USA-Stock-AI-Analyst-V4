// services/fetchError.ts — 行情抓取錯誤的分類型別（Phase 12 T3）
//
// 為什麼需要：錯誤原本只是 `new Error(字串)`，消費端只好用 regex 猜
// （PnlHistorySection 的 diagnose）或乾脆不猜、一律寫「可能限流中」（Portfolio 健檢）。
// 後端沒開跟被限流的處置完全不同，猜錯會把使用者指去做錯的事。
// 這裡把「種類」變成型別的一部分，讓它能跨 service → UI 的 seam 傳過去。
//
// message 一律維持原文——既有的字串比對（diagnose 的 regex fallback）仍可用，
// 分類只是加上去的資訊，不是取代。
//
// 行為鎖：utils/fetchError.test.ts。

export type FetchErrorKind =
  | 'RATE_LIMIT'    // 429：來源限流，等一下再來
  | 'BACKEND_DOWN'  // 5xx：後端沒回應（多半是本機 vercel dev 沒開）
  | 'NOT_FOUND'     // 查無此代碼／回應無資料
  | 'PARSE'         // 回應格式不如預期
  | 'NETWORK'       // fetch 本身失敗（離線、proxy 掛掉）
  | 'UNKNOWN';      // 認不出來——**不要猜**

export class DataFetchError extends Error {
  readonly kind: FetchErrorKind;

  constructor(kind: FetchErrorKind, message: string) {
    super(message);
    this.name = 'DataFetchError';
    this.kind = kind;
  }
}

/** 把 catch 到的東西分類。認不出來就回 UNKNOWN，不做樂觀猜測。 */
export const classifyCaught = (e: unknown): FetchErrorKind => {
  if (e instanceof DataFetchError) return e.kind;

  // FinMind 會把 HTTP status 掛在錯誤物件上（services/finmind.ts）
  const status = (e as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number') {
    if (status === 429) return 'RATE_LIMIT';
    if (status >= 500) return 'BACKEND_DOWN';
  }

  const message = String((e as { message?: unknown } | null | undefined)?.message ?? '');
  if (e instanceof TypeError || /failed to fetch|networkerror/i.test(message)) return 'NETWORK';

  return 'UNKNOWN';
};
