// api/_lib/ratelimit.test.ts — api/_lib 行為鎖（票 05）：限流取 IP 序位＋fail-open
// 【立場＝行為鎖】照現行行為寫斷言，不評對錯（見 CONTEXT.md「後端測試」節）。
// 放置決策與安全查證見 docs/adr/0002-api-lib-test-colocation.md，不在此重述。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Ratelimit } from '@upstash/ratelimit';
import { checkRateLimit, getClientIp, type RateLimiter } from './ratelimit.js';

// 全檔共用：任何案例若動過 env（僅「模組載入期兩態」那組會動），一律在這裡收尾還原，
// 不留到下一個測試檔案。
afterEach(() => {
  vi.unstubAllEnvs();
});

// 假 limiter——checkRateLimit 的紅線是絕對不呼叫真 .limit()（那會打真網路）。
// 這裡只造出 { limit } 形狀相符的假件，cast 過型別即可，不需要真正的 Ratelimit 實例。
function fakeLimiter(success: boolean): Ratelimit {
  return { limit: async () => ({ success }) } as unknown as Ratelimit;
}

function throwingLimiter(): Ratelimit {
  return {
    limit: async () => {
      throw new Error('upstash unavailable（假件模擬）');
    },
  } as unknown as Ratelimit;
}

describe('getClientIp', () => {
  it('x-forwarded-for 逗號多段取首段，並去除前後空白', () => {
    const ip = getClientIp({
      headers: { 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' },
    });
    expect(ip).toBe('1.2.3.4');
  });

  it('x-forwarded-for 值是陣列時取首個元素', () => {
    const ip = getClientIp({
      headers: { 'x-forwarded-for': ['9.9.9.9', '8.8.8.8'] },
    });
    expect(ip).toBe('9.9.9.9');
  });

  it('無 x-forwarded-for 時落到 x-real-ip，並去除前後空白', () => {
    const ip = getClientIp({
      headers: { 'x-real-ip': '  7.7.7.7  ' },
    });
    expect(ip).toBe('7.7.7.7');
  });

  it('x-real-ip 值是陣列時取首個元素', () => {
    const ip = getClientIp({
      headers: { 'x-real-ip': ['5.5.5.5', '4.4.4.4'] },
    });
    expect(ip).toBe('5.5.5.5');
  });

  it('x-forwarded-for 與 x-real-ip 皆無時，回預設回環位址 127.0.0.1', () => {
    const ip = getClientIp({ headers: {} });
    expect(ip).toBe('127.0.0.1');
  });

  it('x-forwarded-for 是空字串時——split 後首段仍是空字串、trim 後 falsy，落到 x-real-ip', () => {
    // 現行行為鎖（怪行為，故意鎖住）：空字串不等於「沒有這個 header」，但空字串
    // 走過 split(',')[0]?.trim() 一樣會變成 falsy，效果上等同未設，會繼續往下一層找。
    const ip = getClientIp({
      headers: { 'x-forwarded-for': '', 'x-real-ip': '6.6.6.6' },
    });
    expect(ip).toBe('6.6.6.6');
  });

  it('x-forwarded-for 與 x-real-ip 皆為空字串時，同樣落回預設回環位址', () => {
    const ip = getClientIp({
      headers: { 'x-forwarded-for': '', 'x-real-ip': '' },
    });
    expect(ip).toBe('127.0.0.1');
  });
});

describe('checkRateLimit（全用假件，零真網路）', () => {
  it('空陣列時放行', async () => {
    await expect(checkRateLimit([], '1.2.3.4')).resolves.toBe(true);
  });

  it('全部是 null 時放行——濾掉 null 後沒有啟用中的 limiter', async () => {
    const limiters: RateLimiter[] = [null, null];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(true);
  });

  it('多個 limiter 全過才算過', async () => {
    const limiters: RateLimiter[] = [fakeLimiter(true), fakeLimiter(true)];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(true);
  });

  it('任一 limiter 回 success:false 就擋下', async () => {
    const limiters: RateLimiter[] = [fakeLimiter(true), fakeLimiter(false)];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(false);
  });

  it('任一 limiter 的 .limit() 丟錯時 fail-open 放行（外部限流服務掛掉不能整站被擋）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const limiters: RateLimiter[] = [fakeLimiter(true), throwingLimiter()];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('null 與假件混合、假件全過時，null 被忽略、結果放行', async () => {
    const limiters: RateLimiter[] = [null, fakeLimiter(true), null];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(true);
  });

  it('null 與假件混合、假件擋下時，null 被忽略、結果仍是擋下', async () => {
    const limiters: RateLimiter[] = [null, fakeLimiter(false)];
    await expect(checkRateLimit(limiters, '1.2.3.4')).resolves.toBe(false);
  });
});

describe('模組載入期兩態（限流設定在 import 當下讀 env 決定啟用與否）', () => {
  // 每個案例自己 reset＋stub＋import，不共用模組實例。
  beforeEach(() => {
    vi.resetModules();
  });

  it('未設 Upstash env 時，三個 limiter 匯出全為 null（停用態）', async () => {
    // 已實測 vitest 不會把 .env 灌進 process.env，但不信任宿主 shell 現值——
    // 兩把顯式 stub 成 undefined（等同刪除）再重載模組。
    vi.stubEnv('UPSTASH_REDIS_REST_URL', undefined);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', undefined);

    const mod = await import('./ratelimit.js');

    expect(mod.geminiPerMin).toBeNull();
    expect(mod.geminiPerDay).toBeNull();
    expect(mod.marketPerMin).toBeNull();
  });

  it('已設 Upstash env 時，三個 limiter 匯出全非 null（啟用態）——只驗有啟用，不發真請求', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token-not-a-real-secret');

    const mod = await import('./ratelimit.js');

    expect(mod.geminiPerMin).not.toBeNull();
    expect(mod.geminiPerDay).not.toBeNull();
    expect(mod.marketPerMin).not.toBeNull();
  });
});
