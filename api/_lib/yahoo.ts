export type YahooErrorCode =
  | 'BAD_REQUEST'
  | 'UPSTREAM_UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NOT_FOUND';

const errorMessages: Record<YahooErrorCode, string> = {
  BAD_REQUEST: '請求參數不正確，請確認股票代號與時間區間設定。',
  UPSTREAM_UNAUTHORIZED: 'Yahoo 行情服務暫時無法驗證，請稍後再試。',
  RATE_LIMITED: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。',
  UPSTREAM_ERROR: 'Yahoo 行情服務暫時無法回應，請稍後再試。',
  NOT_FOUND: '找不到該股票代號。',
};

export class YahooClassifiedError extends Error {
  code: YahooErrorCode;

  constructor(code: YahooErrorCode, message = errorMessages[code]) {
    super(message);
    this.name = 'YahooClassifiedError';
    this.code = code;
  }
}

// 每個週期只允許既有前端實際使用的封閉區間集合，避免成為任意行情代理。
const INTERVAL_RANGE_MAP: Record<string, string[]> = {
  '1d': ['10y', '5d', '2y'], // 2y 供前端兩段式首繪（BL-1）
  '1wk': ['5y'],
  '1mo': ['max'],
  '60m': ['1y'],
  '15m': ['60d'],
};

const TAIWAN_SYMBOL_PATTERN = /^\d{3,6}[A-Z]?\.TWO?$/;
const OVERSEAS_SYMBOL_PATTERN = /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/i;
const CURRENCY_SYMBOL_PATTERN = /^[A-Z]{3,8}=X$/i;

export function validateChartParams(query: {
  symbol?: unknown;
  interval?: unknown;
  range?: unknown;
}): { symbol: string; interval: string; range: string } {
  const symbol = typeof query.symbol === 'string'
    ? query.symbol.trim().toUpperCase()
    : '';
  const interval = typeof query.interval === 'string' ? query.interval.trim() : '';
  const range = typeof query.range === 'string' ? query.range.trim() : '';
  const allowedRanges = INTERVAL_RANGE_MAP[interval];
  const validSymbol = TAIWAN_SYMBOL_PATTERN.test(symbol)
    || OVERSEAS_SYMBOL_PATTERN.test(symbol)
    || CURRENCY_SYMBOL_PATTERN.test(symbol);

  if (!allowedRanges?.includes(range) || !validSymbol) {
    throw new YahooClassifiedError('BAD_REQUEST');
  }

  return { symbol, interval, range };
}

export function validateSearchParams(query: {
  q?: unknown;
  limit?: unknown;
}): { q: string; limit: number } {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const limit = query.limit === undefined ? 8 : Number(query.limit);

  if (!q || q.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new YahooClassifiedError('BAD_REQUEST');
  }

  return { q, limit };
}

const CRUMB_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 500;
// upstream fetch 逾時上界：最壞串行 cookie+crumb+main = 24s，留在 chart.ts maxDuration=30 內。
// 逾時 → classifyYahooError → UPSTREAM_ERROR（不重試）→ 前端走既有 FinMind fallback，整條請求有界。
const UPSTREAM_TIMEOUT_MS = 8000;
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

let cachedCookie: string | null = null;
let cachedCrumb: string | null = null;
let crumbFetchedAt = 0;

function classifyStatus(status: number): YahooClassifiedError {
  if (status === 401) {
    return new YahooClassifiedError('UPSTREAM_UNAUTHORIZED');
  }

  if (status === 429) {
    return new YahooClassifiedError('RATE_LIMITED');
  }

  return new YahooClassifiedError('UPSTREAM_ERROR');
}

function clearCrumbCache(): void {
  cachedCookie = null;
  cachedCrumb = null;
  crumbFetchedAt = 0;
}

async function fetchCookie(): Promise<string> {
  const response = await fetch('https://fc.yahoo.com', {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  const cookieHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = cookieHeaders.getSetCookie?.()
    || (response.headers.get('set-cookie')
      ? [response.headers.get('set-cookie') as string]
      : []);
  const cookie = setCookies
    .map(value => value.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ');

  if (!cookie) {
    throw new YahooClassifiedError('UPSTREAM_UNAUTHORIZED');
  }

  return cookie;
}

async function fetchCrumb(cookie: string): Promise<string> {
  const response = await fetch(
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
    {
      headers: {
        ...BROWSER_HEADERS,
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw classifyStatus(response.status);
  }

  const crumb = (await response.text()).trim();
  if (!crumb) {
    throw new YahooClassifiedError('UPSTREAM_UNAUTHORIZED');
  }

  return crumb;
}

async function ensureCrumb(forceRefresh = false): Promise<{
  cookie: string;
  crumb: string;
}> {
  const cacheIsFresh = Date.now() - crumbFetchedAt < CRUMB_TTL_MS;
  if (!forceRefresh && cachedCookie && cachedCrumb && cacheIsFresh) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }

  const cookie = await fetchCookie();
  const crumb = await fetchCrumb(cookie);
  cachedCookie = cookie;
  cachedCrumb = crumb;
  crumbFetchedAt = Date.now();

  return { cookie, crumb };
}

export async function fetchYahooWithHandshake(
  buildUrl: (params: { cookie: string; crumb: string }) => string,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { cookie, crumb } = await ensureCrumb(attempt > 0);
      const response = await fetch(buildUrl({ cookie, crumb }), {
        headers: {
          ...BROWSER_HEADERS,
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (response.status === 401 || response.status === 429) {
        throw classifyStatus(response.status);
      }

      return response;
    } catch (error) {
      const classifiedError = classifyYahooError(error);
      const canRetry = attempt === 0
        && (classifiedError.code === 'UPSTREAM_UNAUTHORIZED'
          || classifiedError.code === 'RATE_LIMITED');

      if (!canRetry) {
        throw classifiedError;
      }

      // Yahoo 可能使 cookie/crumb 同時失效；兩者必須一起清除後再握手一次。
      clearCrumbCache();
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  throw new YahooClassifiedError('UPSTREAM_ERROR');
}

export function classifyYahooError(error: unknown): YahooClassifiedError {
  if (error instanceof YahooClassifiedError) {
    return error;
  }

  const errorRecord = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const name = typeof errorRecord.name === 'string' ? errorRecord.name : '';
  const message = error instanceof Error ? error.message : String(error || '');

  // undici 對 AbortSignal.timeout 拋 DOMException name='TimeoutError'——顯式列名，不賭 message 措辭。
  // 覆核 L-1 註記：此分支目前與下方 fallback 殊途同歸（皆 UPSTREAM_ERROR），屬前瞻性佔位——
  // 日後若要把 timeout 獨立分類（例如回 504）就在這裡改，勿誤判此判斷式有現行分支效果。
  if (name === 'AbortError' || name === 'TimeoutError' || /aborted|aborterror|timed?\s*out/i.test(message)) {
    return new YahooClassifiedError('UPSTREAM_ERROR');
  }

  return new YahooClassifiedError('UPSTREAM_ERROR');
}
