// 06：在既有公開服務邊界鎖住握手與重試契約，網路與時間皆使用合成資料。
// 測試就地放置沿用 ADR-0002；不匯出或讀取私有憑證狀態。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const quoteUrl = ({ crumb }: { crumb: string }) => `https://fixture.invalid/quote?crumb=${crumb}`;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-09-21T04:00:00Z'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

function automaticNetwork(statuses: number[] = [200], crumbStatus = 200) {
  let cookies = 0, crumbs = 0;
  const quotes: Array<{ cookie: string; crumb: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const cookie = new Headers(init?.headers).get('Cookie') || '';
    if (url === 'https://fc.yahoo.com') {
      cookies++;
      return new Response('', { headers: { 'set-cookie': `fixture=${cookies}; Path=/` } });
    }
    if (url.endsWith('/v1/test/getcrumb')) {
      crumbs++;
      return new Response(`crumb-${cookie.split('=')[1]}`, { status: crumbStatus });
    }
    if (url.startsWith('https://fixture.invalid/quote')) {
      quotes.push({ cookie, crumb: new URL(url).searchParams.get('crumb')! });
      return new Response('合成行情', { status: statuses[Math.min(quotes.length - 1, statuses.length - 1)] });
    }
    throw new Error('不允許的測試網路');
  }));
  return { counts: () => ({ cookies, crumbs }), quotes };
}

function controlledNetwork() {
  const calls: Array<{
    stage: 'cookie' | 'crumb' | 'quote';
    cookie: string;
    crumb: string | null;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }> = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const stage = url === 'https://fc.yahoo.com' ? 'cookie'
      : url.endsWith('/v1/test/getcrumb') ? 'crumb'
        : url.startsWith('https://fixture.invalid/quote') ? 'quote' : null;
    if (!stage) throw new Error('不允許的測試網路');
    return new Promise<Response>((resolve, reject) => calls.push({
      stage, cookie: new Headers(init?.headers).get('Cookie') || '',
      crumb: new URL(url).searchParams.get('crumb'), resolve, reject,
    }));
  }));
  const of = (stage: 'cookie' | 'crumb' | 'quote') => calls.filter(call => call.stage === stage);
  const completeHandshake = async (index: number, label: string) => {
    of('cookie')[index].resolve(new Response('', { headers: { 'set-cookie': `fixture=${label}; Path=/` } }));
    await flush();
    const crumb = of('crumb').find(call => call.cookie === `fixture=${label}`)!;
    expect(crumb).toBeDefined();
    crumb.resolve(new Response(`crumb-${label}`));
    await flush();
  };
  return { of, completeHandshake };
}

describe('Yahoo 握手既有公開契約', () => {
  it.each([401, 429])('主請求 %s 只在 500ms 後重試一次，使用新配對', async status => {
    const network = automaticNetwork([status, 200]);
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const request = fetchYahooWithHandshake(quoteUrl);
    await flush();
    expect(network.quotes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(network.quotes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).status).toBe(200);
    expect(network.quotes).toEqual([
      { cookie: 'fixture=1', crumb: 'crumb-1' },
      { cookie: 'fixture=2', crumb: 'crumb-2' },
    ]);
  });

  it.each([[401, 'UPSTREAM_UNAUTHORIZED'], [429, 'RATE_LIMITED']] as const)('%s 第二次仍失敗則傳遞原分類，不增加嘗試', async (status, code) => {
    const network = automaticNetwork([status]);
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const request = fetchYahooWithHandshake(quoteUrl).catch(error => error);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(await request).toMatchObject({ code });
    expect(network.quotes).toHaveLength(2);
    expect(network.counts()).toEqual({ cookies: 2, crumbs: 2 });
  });

  it.each([403, 404, 500])('主請求 %s 原樣回傳 Response，由呼叫端判讀內容', async status => {
    const network = automaticNetwork([status]);
    const { fetchYahooWithHandshake } = await import('./yahoo');
    expect((await fetchYahooWithHandshake(quoteUrl)).status).toBe(status);
    expect(network.quotes).toHaveLength(1);
  });

  it('crumb 403 是 UPSTREAM_ERROR，不套用 401／429 的重試', async () => {
    const network = automaticNetwork([200], 403);
    const { fetchYahooWithHandshake } = await import('./yahoo');
    await expect(fetchYahooWithHandshake(quoteUrl)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(network.quotes).toHaveLength(0);
    expect(network.counts()).toEqual({ cookies: 1, crumbs: 1 });
  });

  it('暖請求沿用配對，十分鐘沿用窗結束才重新握手', async () => {
    const network = automaticNetwork();
    const { fetchYahooWithHandshake } = await import('./yahoo');
    await fetchYahooWithHandshake(quoteUrl);
    await vi.advanceTimersByTimeAsync(599999);
    await fetchYahooWithHandshake(quoteUrl);
    expect(network.counts()).toEqual({ cookies: 1, crumbs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    await fetchYahooWithHandshake(quoteUrl);
    expect(network.counts()).toEqual({ cookies: 2, crumbs: 2 });
  });

  it('網路逾時沿用 UPSTREAM_ERROR，不自行加重試', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; throw new DOMException('合成逾時', 'TimeoutError'); }));
    const { fetchYahooWithHandshake } = await import('./yahoo');
    await expect(fetchYahooWithHandshake(quoteUrl)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(calls).toBe(1);
  });
});

describe('Yahoo 握手共用與世代', () => {
  it('十個冷請求只做一組握手，全部使用相同 cookie／crumb 配對', async () => {
    const network = automaticNetwork();
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const results = await Promise.all(Array.from({ length: 10 }, () => fetchYahooWithHandshake(quoteUrl)));
    expect(results.every(response => response.status === 200)).toBe(true);
    expect(network.counts()).toEqual({ cookies: 1, crumbs: 1 });
    expect(network.quotes).toEqual(Array.from({ length: 10 }, () => ({ cookie: 'fixture=1', crumb: 'crumb-1' })));
  });

  it('十個認證錯誤的重試共用下一組握手，不各自刷新十次', async () => {
    const network = automaticNetwork([...Array(10).fill(401), 200]);
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const requests = Array.from({ length: 10 }, () => fetchYahooWithHandshake(quoteUrl));
    await flush();
    await vi.advanceTimersByTimeAsync(499);
    expect(network.counts()).toEqual({ cookies: 1, crumbs: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect((await Promise.all(requests)).every(response => response.ok)).toBe(true);
    expect(network.counts()).toEqual({ cookies: 2, crumbs: 2 });
    expect(network.quotes.slice(10)).toEqual(Array.from({ length: 10 }, () => ({ cookie: 'fixture=2', crumb: 'crumb-2' })));
  });

  it('共享握手失敗後清掉 rejected Promise，後續請求仍可成功', async () => {
    const network = controlledNetwork();
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const failed = Array.from({ length: 10 }, () => fetchYahooWithHandshake(quoteUrl).catch(error => error));
    expect(network.of('cookie')).toHaveLength(1);
    network.of('cookie')[0].resolve(new Response('', { headers: { 'set-cookie': 'fixture=bad' } }));
    await flush();
    network.of('crumb')[0].resolve(new Response('合成故障', { status: 503 }));
    expect((await Promise.all(failed)).every(error => error.code === 'UPSTREAM_ERROR')).toBe(true);
    const recovered = fetchYahooWithHandshake(quoteUrl);
    expect(network.of('cookie')).toHaveLength(2);
    await network.completeHandshake(1, 'recovered');
    network.of('quote')[0].resolve(new Response('合成行情'));
    expect((await recovered).ok).toBe(true);
  });

  it.each([false, true])('舊主請求 401 在新握手完成之後=%s，不使新握手失效或清掉新配對', async newHandshakeFirst => {
    const network = controlledNetwork();
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const old = fetchYahooWithHandshake(quoteUrl);
    await network.completeHandshake(0, 'old');
    await vi.advanceTimersByTimeAsync(600000);
    const fresh = fetchYahooWithHandshake(quoteUrl);
    expect(network.of('cookie')).toHaveLength(2);
    if (newHandshakeFirst) await network.completeHandshake(1, 'new');
    network.of('quote')[0].resolve(new Response('', { status: 401 }));
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    // 新握手在途時加入／舊認證錯誤均不能另起第三組，使較慢工作反序回寫。
    expect(network.of('cookie')).toHaveLength(2);
    if (!newHandshakeFirst) await network.completeHandshake(1, 'new');
    const currentQuotes = network.of('quote').slice(1);
    expect(currentQuotes).toHaveLength(2);
    expect(currentQuotes.map(({ cookie, crumb }) => ({ cookie, crumb }))).toEqual([
      { cookie: 'fixture=new', crumb: 'crumb-new' },
      { cookie: 'fixture=new', crumb: 'crumb-new' },
    ]);
    // 刻意反轉主回應完成順序；下一次暖請求仍使用新配對。
    currentQuotes[1].resolve(new Response('後發先到'));
    currentQuotes[0].resolve(new Response('先發後到'));
    await Promise.all([old, fresh]);
    const warm = fetchYahooWithHandshake(quoteUrl);
    await flush();
    expect(network.of('cookie')).toHaveLength(2);
    expect(network.of('quote').at(-1)).toMatchObject({ cookie: 'fixture=new', crumb: 'crumb-new' });
    network.of('quote').at(-1)!.resolve(new Response('暖請求'));
    await warm;
  });

  it('新握手失敗且舊認證錯誤晚到時，不會復活舊憑證', async () => {
    const network = controlledNetwork();
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const old = fetchYahooWithHandshake(quoteUrl);
    await network.completeHandshake(0, 'old');
    await vi.advanceTimersByTimeAsync(600000);
    const failed = fetchYahooWithHandshake(quoteUrl).catch(error => error);
    network.of('cookie')[1].reject(new Error('合成網路失敗'));
    expect(await failed).toMatchObject({ code: 'UPSTREAM_ERROR' });
    network.of('quote')[0].resolve(new Response('', { status: 429 }));
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await network.completeHandshake(2, 'recovered');
    expect(network.of('quote').at(-1)).toMatchObject({ cookie: 'fixture=recovered', crumb: 'crumb-recovered' });
    network.of('quote').at(-1)!.resolve(new Response('合成行情'));
    expect((await old).ok).toBe(true);
  });
});

describe('Yahoo 共用握手的用戶端取消', () => {
  it('兩位等待者中一位取消，不中止另一位正在使用的握手', async () => {
    let finishCookie: ((response: Response) => void) | undefined;
    let cookieSignal: AbortSignal | undefined;
    let cookies = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://fc.yahoo.com') {
        cookies += 1;
        cookieSignal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { finishCookie = resolve; });
      }
      if (url.endsWith('/getcrumb')) return Promise.resolve(new Response('fixture-crumb'));
      if (url.startsWith('https://fixture.invalid/quote')) return Promise.resolve(new Response('合成行情'));
      throw new Error('不允許的測試網路');
    }));
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const first = new AbortController();
    const second = new AbortController();
    const cancelled = fetchYahooWithHandshake(quoteUrl, first.signal).catch(error => error);
    const surviving = fetchYahooWithHandshake(quoteUrl, second.signal);
    expect(cookies).toBe(1);
    first.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(cookieSignal?.aborted).toBe(false);
    finishCookie?.(new Response('', { headers: { 'set-cookie': 'fixture=shared' } }));
    expect((await surviving).status).toBe(200);
    expect(cookies).toBe(1);
  });

  it('最後一位等待者取消會中止上游，下一支請求使用新世代', async () => {
    const cookieSignals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://fc.yahoo.com') {
        const signal = init?.signal as AbortSignal;
        cookieSignals.push(signal);
        if (cookieSignals.length > 1) return Promise.resolve(new Response('', { headers: { 'set-cookie': 'fixture=fresh' } }));
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      if (url.endsWith('/getcrumb')) return Promise.resolve(new Response('fixture-crumb'));
      if (url.startsWith('https://fixture.invalid/quote')) return Promise.resolve(new Response('合成行情'));
      throw new Error('不允許的測試網路');
    }));
    const { fetchYahooWithHandshake } = await import('./yahoo');
    const client = new AbortController();
    const cancelled = fetchYahooWithHandshake(quoteUrl, client.signal).catch(error => error);
    client.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(cookieSignals[0].aborted).toBe(true);
    expect((await fetchYahooWithHandshake(quoteUrl)).status).toBe(200);
    expect(cookieSignals).toHaveLength(2);
  });
});

describe('Yahoo 真實 handler 的合成請求鏈', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('PROXY_SHARED_SECRET', 'fixture-shared-secret');
  });

  it('十個合法 handler 共用握手且保留成功回應與 CDN 標頭，不洩漏配對', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://fc.yahoo.com') return new Response('', { headers: { 'set-cookie': 'fixture=handler' } });
      if (url.endsWith('/getcrumb')) return new Response('fixture-crumb-handler');
      if (url.startsWith('https://query2.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: 'AAPL' } }], error: null } }));
      }
      throw new Error('禁止真實網路');
    }));
    const { default: handler } = await import('../yahoo/chart');
    const responses = Array.from({ length: 10 }, () => {
      const result = { code: 0, body: null as unknown, headers: {} as Record<string, string> };
      return { result, response: {
        status(code: number) { result.code = code; return this; },
        json(body: unknown) { result.body = body; },
        setHeader(name: string, value: string) { result.headers[name] = value; },
        end() {},
      } };
    });
    await Promise.all(responses.map(({ response }) => handler({ method: 'GET',
      headers: { host: 'fixture.invalid', origin: 'https://fixture.invalid', 'x-proxy-secret': 'fixture-shared-secret' },
      query: { symbol: 'AAPL', interval: '1d', range: '10y' },
    }, response)));
    expect(requests.filter(url => url === 'https://fc.yahoo.com')).toHaveLength(1);
    expect(requests.filter(url => url.endsWith('/getcrumb'))).toHaveLength(1);
    expect(requests.filter(url => url.includes('/v8/finance/chart/'))).toHaveLength(10);
    for (const { result } of responses) {
      expect(result.code).toBe(200);
      expect(result.headers['Cache-Control']).toBe('s-maxage=60, stale-while-revalidate=300');
      expect(result.body).toEqual({ chart: { result: [{ meta: { symbol: 'AAPL' } }], error: null } });
      expect(JSON.stringify(result)).not.toContain('fixture-crumb');
      expect(JSON.stringify(result)).not.toContain('fixture=handler');
    }
  });
});
