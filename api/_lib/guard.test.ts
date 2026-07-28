// api/_lib/guard.test.ts — api/_lib 行為鎖（票 06）：守門序（CORS／來源判定／shared secret／限流）
// 【立場＝行為鎖】照現行行為寫斷言，不評對錯，含 findings 第 2 條「來源雙缺放行」等怪行為
// （詞彙見 CONTEXT.md「後端測試」節）。放置決策與安全查證見 docs/adr/0002-api-lib-test-colocation.md，不在此重述。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Ratelimit } from '@upstash/ratelimit';
import { isAllowedOrigin, setCorsHeaders, checkSharedSecret, applyGuards } from './guard.js';

// guard.ts 內的 HeaderValue／GuardReq／GuardRes 型別未匯出，這裡照形狀重宣告一份——
// 重複優於耦合（spec.md「對映」決策），也符合「假 req 只是 { method, headers } 純物件」的要求。
type HeaderValue = string | string[] | undefined;

function req(
  headers: Record<string, HeaderValue>,
  method?: string,
): { method?: string; headers: Record<string, HeaderValue> } {
  return { method, headers };
}

// 假 res：status() 回自身可鏈 json()；每次呼叫都記進 calls，依序可查——
// 這是驗證「CORS header 恆先被設」與「各拒絕路徑只寫一次回應」的唯一手段。
interface ResCall {
  method: 'status' | 'json' | 'setHeader' | 'end';
  args: unknown[];
}

interface FakeRes {
  calls: ResCall[];
  status(code: number): FakeRes;
  json(data: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}

function fakeRes(): FakeRes {
  const calls: ResCall[] = [];
  const res: FakeRes = {
    calls,
    status(code: number) {
      calls.push({ method: 'status', args: [code] });
      return res;
    },
    json(data: unknown) {
      calls.push({ method: 'json', args: [data] });
    },
    setHeader(name: string, value: string) {
      calls.push({ method: 'setHeader', args: [name, value] });
    },
    end() {
      calls.push({ method: 'end', args: [] });
    },
  };
  return res;
}

function statusCode(res: FakeRes): number | undefined {
  const call = res.calls.find(c => c.method === 'status');
  return call ? (call.args[0] as number) : undefined;
}

function jsonBody(res: FakeRes): unknown {
  const call = res.calls.find(c => c.method === 'json');
  return call ? call.args[0] : undefined;
}

function headerMap(res: FakeRes): Record<string, string> {
  const map: Record<string, string> = {};
  for (const call of res.calls) {
    if (call.method === 'setHeader') {
      map[call.args[0] as string] = call.args[1] as string;
    }
  }
  return map;
}

// applyGuards 守門序斷言用：不論走到哪個關卡被擋，setCorsHeaders 都是全函式第一件事，
// 因此第一個 status() 呼叫之前只能是 setHeader。
function expectCorsHeadersSetBeforeStatus(res: FakeRes): void {
  const firstStatusIdx = res.calls.findIndex(c => c.method === 'status');
  expect(firstStatusIdx).toBeGreaterThan(0);
  expect(res.calls.slice(0, firstStatusIdx).every(c => c.method === 'setHeader')).toBe(true);
}

function fakeLimiter(success: boolean): Ratelimit {
  return { limit: async () => ({ success }) } as unknown as Ratelimit;
}

// applyGuards 守門序斷言用：一旦被前面關卡短路，限流器連呼叫都不該發生——
// 用一顆「被呼叫就丟錯」的假件佐證，比單看回應內容更硬。
function explodingLimiter(): { limiter: Ratelimit; fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async () => {
    throw new Error('guard.test.ts：此 limiter 不該被呼叫（守門序短路驗證用）');
  });
  return { limiter: { limit: fn } as unknown as Ratelimit, fn };
}

// 這兩把 env 由本檔全程掌控：每個案例開始前一律清空，結束後還原（沿用票 01 的形狀）。
const MANAGED_KEYS = ['ALLOWED_ORIGIN', 'PROXY_SHARED_SECRET'] as const;

beforeEach(() => {
  MANAGED_KEYS.forEach(key => vi.stubEnv(key, undefined));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAllowedOrigin', () => {
  it('origin 與 referer 雙缺時放行——findings 第2條，curl／server-to-server 這類不帶表頭的請求會通過這一關（照現狀鎖，不評對錯）', () => {
    expect(isAllowedOrigin(req({}))).toBe(true);
  });

  it('origin 的 host 與 Host 表頭相同時放行（同源請求）', () => {
    expect(isAllowedOrigin(req({ origin: 'https://example.com', host: 'example.com' }))).toBe(true);
  });

  it('x-forwarded-host 存在時，同源判定用它而非 host 表頭——host 刻意設成不同值以證明優先序', () => {
    expect(
      isAllowedOrigin(
        req({
          origin: 'https://proxied.example.com',
          'x-forwarded-host': 'proxied.example.com',
          host: 'internal-host:3000',
        }),
      ),
    ).toBe(true);
  });

  it('origin 缺席時，同源判定改用 referer 的 host', () => {
    expect(
      isAllowedOrigin(
        req({ referer: 'https://example.com/some/page', host: 'example.com' }),
      ),
    ).toBe(true);
  });

  it('origin 存在但與 host 不同時，同源判定只認 origin、不回頭看 referer——即使 referer 的 host 與 Host 表頭相同也救不回，落到白名單且未中則拒絕（鎖住「origin 優先」的短路）', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://whitelisted.example.net');
    expect(
      isAllowedOrigin(
        req({
          origin: 'https://evil.com',
          referer: 'https://example.com/page', // host 與 Host 表頭相同，但救不回
          host: 'example.com',
        }),
      ),
    ).toBe(false);
  });

  it('origin 尾斜線正規化後命中白名單即放行', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    expect(
      isAllowedOrigin(
        req({
          origin: 'https://allowed.example.com/',
          host: 'unrelated-host.internal', // 確保不是靠同源放行
        }),
      ),
    ).toBe(true);
  });

  it('referer 與白名單項精確相等時放行', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://ref.example.com');
    expect(
      isAllowedOrigin(
        req({
          referer: 'https://ref.example.com',
          host: 'myapp.example.com', // 與 referer host 不同，排除同源途徑
        }),
      ),
    ).toBe(true);
  });

  it('referer 以「白名單項/」為前綴時放行（前綴比對）', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://ref.example.com');
    expect(
      isAllowedOrigin(
        req({
          referer: 'https://ref.example.com/some/deep/path',
          host: 'myapp.example.com',
        }),
      ),
    ).toBe(true);
  });

  it('origin 是無法解析的字串時，同源判定視為缺席而非拋例外，最終落到白名單比對（不等於任何白名單項，故拒絕）', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    expect(
      isAllowedOrigin(
        req({ origin: 'not a valid url', host: 'example.com' }),
      ),
    ).toBe(false);
  });

  it('referer 是無法解析的字串（且無 origin）時，同源判定視為缺席而非拋例外，落到白名單比對——原始字串比不中任何白名單項，故拒絕', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    expect(
      isAllowedOrigin(req({ referer: 'not a valid url', host: 'example.com' })),
    ).toBe(false);
  });

  it('origin 存在、不同源、不在白名單、無 referer 可用時拒絕（都不中的基準情境）', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://other.example.org');
    expect(
      isAllowedOrigin(req({ origin: 'https://random.com', host: 'example.com' })),
    ).toBe(false);
  });
});

describe('setCorsHeaders', () => {
  it('origin 命中白名單（含尾斜線正規化）時，設 Access-Control-Allow-Origin 與 Vary，並逐字送出恆定表頭', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    const res = fakeRes();
    setCorsHeaders(res, 'https://allowed.example.com/');
    const headers = headerMap(res);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://allowed.example.com');
    expect(headers['Vary']).toBe('Origin');
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Proxy-Secret');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('origin 不在白名單時，不送 Access-Control-Allow-Origin 也不送 Vary，但恆定表頭仍逐字送出', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    const res = fakeRes();
    setCorsHeaders(res, 'https://not-allowed.example.com');
    const headers = headerMap(res);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Vary']).toBeUndefined();
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Proxy-Secret');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('origin 為 undefined（如未帶 Origin 表頭的請求）時視同未命中，仍恆定送出三個表頭', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://allowed.example.com');
    const res = fakeRes();
    setCorsHeaders(res, undefined);
    const headers = headerMap(res);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Vary']).toBeUndefined();
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Proxy-Secret');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });
});

describe('checkSharedSecret', () => {
  const SECRET = 'shared-secret-123';
  const WRONG_SAME_LENGTH = 'shared-secret-456'; // 與 SECRET 逐字同長，只有末3碼不同

  it('PROXY_SHARED_SECRET 未設時放行——驗證等同停用', () => {
    expect(checkSharedSecret(req({}))).toBe(true);
  });

  it('已設但請求缺 x-proxy-secret 表頭時拒絕（長度不等，getHeaderValue 落回空字串）', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', SECRET);
    expect(checkSharedSecret(req({}))).toBe(false);
  });

  it('表頭值與正確值等長但內容不同時拒絕', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', SECRET);
    expect(checkSharedSecret(req({ 'x-proxy-secret': WRONG_SAME_LENGTH }))).toBe(false);
  });

  it('表頭值與正確值完全相同時通過', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', SECRET);
    expect(checkSharedSecret(req({ 'x-proxy-secret': SECRET }))).toBe(true);
  });

  it('x-proxy-secret 為陣列時取首個元素比對——首個相符即通過', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', SECRET);
    expect(checkSharedSecret(req({ 'x-proxy-secret': [SECRET, 'some-other-value'] }))).toBe(true);
  });

  it('x-proxy-secret 為陣列時只取首個元素——首個不符時，即使第二個相符也拒絕', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', SECRET);
    expect(
      checkSharedSecret(req({ 'x-proxy-secret': ['wrong-first-element', SECRET] })),
    ).toBe(false);
  });
});

describe('applyGuards（守門序：CORS → OPTIONS 短路 → 來源檢查 → shared secret → 限流）', () => {
  it('OPTIONS 請求短路：204＋end()，回傳 false，限流未被觸及，CORS header 仍先被設', async () => {
    const res = fakeRes();
    const { limiter, fn } = explodingLimiter();

    const result = await applyGuards(req({}, 'OPTIONS'), res, [limiter]);

    expect(result).toBe(false);
    expect(statusCode(res)).toBe(204);
    expect(res.calls.some(c => c.method === 'end')).toBe(true);
    expect(res.calls.some(c => c.method === 'json')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expectCorsHeadersSetBeforeStatus(res);
  });

  it('OPTIONS 短路發生在來源檢查之前——來源不合法時 OPTIONS 仍是 204，不會變成 403（順序本身就是行為）', async () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://only-this-is-allowed.example.com');
    const res = fakeRes();
    const { limiter, fn } = explodingLimiter();
    const badOriginReq = req(
      { origin: 'https://not-allowed.example.com', host: 'myapp.example.com' },
      'OPTIONS',
    );

    const result = await applyGuards(badOriginReq, res, [limiter]);

    expect(result).toBe(false);
    expect(statusCode(res)).toBe(204);
    expect(res.calls.some(c => c.method === 'json')).toBe(false); // 不是 403 的 json 回應
    expect(fn).not.toHaveBeenCalled();
    expectCorsHeadersSetBeforeStatus(res);
  });

  it('來源不合法時 403，回應體逐字鎖住，shared secret 檢查與限流都未被觸及', async () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://only-this-is-allowed.example.com');
    // secret 也刻意設一個值且不在表頭帶正確值：若 secret 檢查真的被跑到，仍會是 403，
    // 但訊息會變成「請求未通過驗證。」——斷言鎖住的是「來源」那則訊息，證明來源檢查先短路。
    vi.stubEnv('PROXY_SHARED_SECRET', 'some-secret-value');
    const res = fakeRes();
    const { limiter, fn } = explodingLimiter();
    const badOriginReq = req(
      { origin: 'https://not-allowed.example.com', host: 'myapp.example.com' },
      'POST',
    );

    const result = await applyGuards(badOriginReq, res, [limiter]);

    expect(result).toBe(false);
    expect(statusCode(res)).toBe(403);
    expect(jsonBody(res)).toEqual({ code: 'BAD_REQUEST', message: '請求來源不被允許。' });
    expect(fn).not.toHaveBeenCalled();
    expectCorsHeadersSetBeforeStatus(res);
  });

  it('來源合法但 shared secret 錯誤時 403，回應體逐字鎖住，限流未被觸及', async () => {
    vi.stubEnv('PROXY_SHARED_SECRET', 'shared-secret-123');
    const res = fakeRes();
    const { limiter, fn } = explodingLimiter();
    // 雙缺放行（findings 第2條）讓來源這關直接放行；不帶 x-proxy-secret 讓 secret 這關落空。
    const result = await applyGuards(req({}, 'POST'), res, [limiter]);

    expect(result).toBe(false);
    expect(statusCode(res)).toBe(403);
    expect(jsonBody(res)).toEqual({ code: 'BAD_REQUEST', message: '請求未通過驗證。' });
    expect(fn).not.toHaveBeenCalled();
    expectCorsHeadersSetBeforeStatus(res);
  });

  it('來源與 secret 都過，但限流擋下時 429，回應體逐字鎖住', async () => {
    const res = fakeRes();
    // PROXY_SHARED_SECRET 未設→停用；雙缺放行→來源過。只剩限流會擋。
    const result = await applyGuards(req({}, 'POST'), res, [fakeLimiter(false)]);

    expect(result).toBe(false);
    expect(statusCode(res)).toBe(429);
    expect(jsonBody(res)).toEqual({ code: 'RATE_LIMITED', message: '請求過於頻繁，請稍後再試。' });
    expectCorsHeadersSetBeforeStatus(res);
  });

  it('全部關卡都過時回傳 true，且從未呼叫 res.status()（res 上沒有被寫入狀態碼）', async () => {
    const res = fakeRes();
    const result = await applyGuards(req({}, 'POST'), res, []); // 空陣列＝視同無限流器，全放行

    expect(result).toBe(true);
    expect(res.calls.some(c => c.method === 'status')).toBe(false);
    expect(res.calls.some(c => c.method === 'json')).toBe(false);
    expect(res.calls.some(c => c.method === 'end')).toBe(false);
    expect(res.calls.length).toBeGreaterThan(0); // CORS 的 setHeader 仍被呼叫
    expect(res.calls.every(c => c.method === 'setHeader')).toBe(true);
  });

  it('限流器丟錯時 fail-open——這是 ratelimit 模組自己的行為，這裡在守門序這層再鎖一次端到端走向，applyGuards 仍回傳 true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = fakeRes();
    const throwing = {
      limit: async () => {
        throw new Error('upstash unavailable（假件模擬）');
      },
    } as unknown as Ratelimit;

    const result = await applyGuards(req({}, 'POST'), res, [throwing]);

    expect(result).toBe(true);
    expect(res.calls.some(c => c.method === 'status')).toBe(false);
    expect(res.calls.some(c => c.method === 'setHeader')).toBe(true);
    warnSpy.mockRestore();
  });
});
