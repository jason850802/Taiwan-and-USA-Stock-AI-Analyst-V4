import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Request = {
  symbol: string;
  range: string;
  signal?: AbortSignal | null;
  finish: (price?: number, count?: number) => void;
  fail: () => void;
};
let requests: Request[];
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function chart(symbol: string, price: number, count: number) {
  const closes = Array.from({ length: count }, (_, index) => price - count + index + 1);
  return { chart: { error: null, result: [{
    meta: { symbol, currency: 'USD', exchangeTimezoneName: 'America/New_York', regularMarketPrice: price },
    timestamp: closes.map((_, index) => 1704207600 + index * 86400),
    indicators: { quote: [{ close: closes, open: closes.map(n => n - 1), high: closes.map(n => n + 2), low: closes.map(n => n - 2), volume: closes.map(() => 1000) }] },
  }] } };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T04:00:00Z'));
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  });
  requests = [];
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://fixture');
    if (url.pathname !== '/api/yahoo/chart') throw new Error(`未定義假請求：${url.pathname}`);
    return new Promise<Response>(resolve => {
      const symbol = url.searchParams.get('symbol')!;
      const range = url.searchParams.get('range')!;
      // 刻意不自動響應 abort，證明正確性來自訂閱身分，而非假設傳輸一定可取消。
      requests.push({
        symbol, range, signal: init?.signal,
        finish: (price = 120, count = range === '2y' ? 2 : 5) => resolve(new Response(JSON.stringify(chart(symbol, price, count)))),
        fail: () => resolve(new Response(JSON.stringify({ message: '驗收行情失敗' }), { status: 503 })),
      });
    });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('共用 K 線補全的使用端生命週期', () => {
  it('過期快取的第一位使用端離開後，後加入者仍收到共用背景刷新', async () => {
    const { getStockData } = await import('./yahoo');
    const seed = getStockData('AAPL', '1d', { forceRefresh: true });
    requests[0].finish(100);
    await seed;
    vi.setSystemTime(new Date('2026-09-24T04:00:00Z'));
    const first = new AbortController();
    const oldCallback = vi.fn();
    const callback = vi.fn();
    expect((await getStockData('AAPL', '1d', { signal: first.signal, onRevalidated: oldCallback })).data.at(-1)?.close).toBe(100);
    first.abort();
    expect((await getStockData('AAPL', '1d', { onRevalidated: callback })).data.at(-1)?.close).toBe(100);
    // 允許最後使用端離開後取消整個工作；新使用端必須接到一個仍有效的工作。
    requests.slice(1).forEach(request => request.finish(200));
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].data.at(-1).close).toBe(200);
    expect(oldCallback).not.toHaveBeenCalled();
  });

  it('兩個分段使用端共用 2y 與 10y，各收到一次完整補全', async () => {
    const { getStockData } = await import('./yahoo');
    const callbacks = [vi.fn(), vi.fn()];
    const initial = callbacks.map(onRevalidated => getStockData('AAPL', '1d', { onRevalidated }));
    expect(requests.map(request => request.range)).toEqual(['2y', '10y']);
    requests[0].finish(110);
    expect((await Promise.all(initial)).map(result => result.data.length)).toEqual([2, 2]);
    requests[1].finish(120);
    await flush();
    for (const callback of callbacks) {
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].data).toHaveLength(5);
    }
    expect((await getStockData('AAPL')).data).toHaveLength(5);
    expect(requests).toHaveLength(2);
  });

  it('10y 先到時一次 resolve 完整結果，不再通知補全或回退到晚到的 2y', async () => {
    const { getStockData } = await import('./yahoo');
    const callback = vi.fn();
    const initial = getStockData('AAPL', '1d', { onRevalidated: callback });
    requests[1].finish(120);
    expect((await initial).data).toHaveLength(5);
    requests[0].finish(110);
    await flush();
    expect(callback).not.toHaveBeenCalled();
    expect((await getStockData('AAPL')).data.at(-1)?.close).toBe(120);
  });

  it.each([0, 1])('取消第 %s 位分段使用端，不取消另一位的補全', async cancelled => {
    const { getStockData } = await import('./yahoo');
    const controllers = [new AbortController(), new AbortController()];
    const callbacks = [vi.fn(), vi.fn()];
    const initials = controllers.map((controller, index) => getStockData('AAPL', '1d', { signal: controller.signal, onRevalidated: callbacks[index] }));
    requests[0].finish(110);
    await Promise.all(initials);
    controllers[cancelled].abort();
    expect(requests[1].signal?.aborted).toBe(false);
    requests[1].finish(120);
    await flush();
    expect(callbacks[cancelled]).not.toHaveBeenCalled();
    expect(callbacks[1 - cancelled]).toHaveBeenCalledTimes(1);
  });

  it('首位初次結果前取消，其他使用端仍可取得完整結果', async () => {
    const { getStockData } = await import('./yahoo');
    const controller = new AbortController();
    const old = getStockData('AAPL', '1d', { signal: controller.signal }).catch(error => error);
    const current = getStockData('AAPL', '1d');
    expect(requests).toHaveLength(1);
    controller.abort();
    expect((await old).name).toBe('AbortError');
    expect(requests[0].signal?.aborted).toBe(false);
    requests[0].finish(200);
    expect((await current).data.at(-1)?.close).toBe(200);
  });

  it('後加入者共用尚未結束的完整歷史，不重送 2y／10y', async () => {
    const { getStockData } = await import('./yahoo');
    const first = new AbortController();
    const oldCallback = vi.fn();
    const initial = getStockData('AAPL', '1d', { signal: first.signal, onRevalidated: oldCallback });
    requests[0].finish(110);
    await initial;
    const later = getStockData('AAPL', '1d', { onRevalidated: vi.fn() });
    first.abort();
    requests[1].finish(120);
    expect((await later).data).toHaveLength(5);
    expect(requests).toHaveLength(2);
    expect(oldCallback).not.toHaveBeenCalled();
  });

  it('完整歷史呼叫端不會把共享工作的 2y 當作完整結果', async () => {
    const { getStockData } = await import('./yahoo');
    const initial = getStockData('AAPL', '1d', { onRevalidated: vi.fn() });
    let completed = false;
    const full = getStockData('AAPL', '1d').then(result => { completed = true; return result; });
    requests[0].finish(110);
    await initial;
    await flush();
    expect(completed).toBe(false);
    requests[1].finish(120);
    expect((await full).data).toHaveLength(5);
    expect(requests).toHaveLength(2);
  });

  it('完整歷史工作先起跑時，後加入的一般使用端也只等完整結果', async () => {
    const { getStockData } = await import('./yahoo');
    const full = getStockData('AAPL');
    const callback = vi.fn();
    const later = getStockData('AAPL', '1d', { onRevalidated: callback });
    expect(requests.map(request => request.range)).toEqual(['10y']);
    requests[0].finish(120);
    expect((await Promise.all([full, later])).map(result => result.data.length)).toEqual([5, 5]);
    expect(callback).not.toHaveBeenCalled();
  });

  it('force 尚未完成時加入的快取使用端仍訂閱新結果，不因舊快取尚新鮮而漏收', async () => {
    const { getStockData } = await import('./yahoo');
    const seed = getStockData('AAPL');
    requests[0].finish(100);
    await seed;
    const forced = getStockData('AAPL', '1d', { forceRefresh: true });
    const callback = vi.fn();
    expect((await getStockData('AAPL', '1d', { onRevalidated: callback })).data.at(-1)?.close).toBe(100);
    requests[1].finish(200);
    await forced;
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].data.at(-1).close).toBe(200);
    expect(requests).toHaveLength(2);
  });

  it('force 每次發出新工作，舊完成不覆寫快取或通知有效使用端', async () => {
    const { getStockData } = await import('./yahoo');
    const callback = vi.fn();
    const initial = getStockData('AAPL', '1d', { onRevalidated: callback });
    requests[0].finish(110);
    await initial;
    const forced = getStockData('AAPL', '1d', { forceRefresh: true });
    const newest = getStockData('AAPL', '1d', { forceRefresh: true });
    expect(requests.map(request => request.range)).toEqual(['2y', '10y', '10y', '10y']);
    requests[3].finish(300);
    expect((await Promise.all([forced, newest])).map(result => result.data.at(-1)?.close)).toEqual([300, 300]);
    requests[1].finish(120);
    requests[2].finish(200);
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].data.at(-1).close).toBe(300);
    expect((await getStockData('AAPL')).data.at(-1)?.close).toBe(300);
  });

  it('force 失敗後舊工作不得復活快取，下一次能重新請求', async () => {
    const { getStockData } = await import('./yahoo');
    const old = getStockData('AAPL').catch(error => error);
    const forced = getStockData('AAPL', '1d', { forceRefresh: true }).catch(error => error);
    requests[1].fail();
    expect((await forced).message).toContain('驗收行情失敗');
    expect((await old).message).toContain('驗收行情失敗');
    requests[0].finish(100);
    await flush();
    const retry = getStockData('AAPL');
    expect(requests).toHaveLength(3);
    requests[2].finish(300);
    expect((await retry).data.at(-1)?.close).toBe(300);
  });

  it('一個使用端的補全回呼出錯，不阻止另一個，也不讓成功快取失效', async () => {
    const { getStockData } = await import('./yahoo');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const callback = vi.fn();
    const initials = [getStockData('AAPL', '1d', { onRevalidated: () => { throw new Error('驗收回呼出錯'); } }), getStockData('AAPL', '1d', { onRevalidated: callback })];
    requests[0].finish(110);
    await Promise.all(initials);
    requests[1].finish(120);
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect((await getStockData('AAPL')).data).toHaveLength(5);
    expect(requests).toHaveLength(2);
  });

  it('最後一位取消即卸除訂閱，傳輸忽略取消的晚回應不得發布快取', async () => {
    const { getStockData } = await import('./yahoo');
    const controller = new AbortController();
    const pending = getStockData('AAPL', '1d', { signal: controller.signal }).catch(error => error);
    controller.abort();
    expect((await pending).name).toBe('AbortError');
    expect(requests[0].signal?.aborted).toBe(true);
    requests[0].finish(100);
    await flush();
    const next = getStockData('AAPL');
    expect(requests).toHaveLength(2);
    requests[1].finish(200);
    expect((await next).data.at(-1)?.close).toBe(200);
  });

  it('已取消的使用端不開啟網路工作', async () => {
    const { getStockData } = await import('./yahoo');
    const controller = new AbortController();
    controller.abort();
    await expect(getStockData('AAPL', '1d', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(0);
  });

  it('2y 失敗仍可由 10y 完成，不發重複終結回呼', async () => {
    const { getStockData } = await import('./yahoo');
    const callback = vi.fn();
    const initial = getStockData('AAPL', '1d', { onRevalidated: callback });
    requests[0].fail();
    requests[1].finish(120);
    expect((await initial).data).toHaveLength(5);
    expect(callback).not.toHaveBeenCalled();
  });

  it('partial 後完整歷史失敗保留初次結果，清理後可再重試', async () => {
    const { getStockData } = await import('./yahoo');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const callback = vi.fn();
    const initial = getStockData('AAPL', '1d', { onRevalidated: callback });
    requests[0].finish(110);
    expect((await initial).data).toHaveLength(2);
    requests[1].fail();
    await flush();
    expect(callback).not.toHaveBeenCalled();
    const retry = getStockData('AAPL');
    expect(requests).toHaveLength(3);
    requests[2].finish(120);
    expect((await retry).data).toHaveLength(5);
  });

  it('不同股票與週期不共用錯誤的網路工作', async () => {
    const { getStockData } = await import('./yahoo');
    const values = [getStockData('AAPL', '1wk'), getStockData('MSFT', '1wk'), getStockData('AAPL', '60m')];
    expect(requests.map(request => [request.symbol, request.range])).toEqual([['AAPL', '5y'], ['MSFT', '5y'], ['AAPL', '1y']]);
    requests.forEach((request, index) => request.finish(100 + index));
    expect((await Promise.all(values)).map(result => result.info.symbol)).toEqual(['AAPL', 'MSFT', 'AAPL']);
  });

  it('100 輪加入、取消、成功與失敗後，事件處理器與通知都已終結', async () => {
    const { getStockData } = await import('./yahoo');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const callbacks: ReturnType<typeof vi.fn>[] = [];
    let expectedCallbacks = 0;
    for (let round = 0; round < 100; round += 1) {
      vi.setSystemTime(new Date(Date.parse('2026-09-20T04:00:00Z') + round * 96 * 3600000));
      const start = requests.length;
      const controllers = [new AbortController(), new AbortController()];
      const add = controllers.map(controller => vi.spyOn(controller.signal, 'addEventListener'));
      const remove = controllers.map(controller => vi.spyOn(controller.signal, 'removeEventListener'));
      const currentCallbacks = [vi.fn(), vi.fn()];
      callbacks.push(...currentCallbacks);
      const initial = controllers.map((controller, index) => getStockData('LIFECYCLE', '1d', { signal: controller.signal, onRevalidated: currentCallbacks[index] }).catch(error => error));
      expect(requests.length - start).toBe(round === 0 ? 2 : 1);
      requests.slice(start).filter(request => request.range === '2y').forEach(request => request.finish());
      await Promise.all(initial);
      if (round % 4 === 1 || round % 4 === 2) controllers[0].abort();
      if (round % 4 === 2) controllers[1].abort();
      requests.slice(start).filter(request => request.range !== '2y').forEach(request => round % 4 === 3 ? request.fail() : request.finish(200 + round));
      await flush();
      expectedCallbacks += round % 4 === 0 ? 2 : round % 4 === 1 ? 1 : 0;
      expect(callbacks.reduce((sum, callback) => sum + callback.mock.calls.length, 0)).toBe(expectedCallbacks);
      controllers.forEach((controller, index) => {
        expect(add[index]).toHaveBeenCalledTimes(1);
        expect(remove[index]).toHaveBeenCalledTimes(1);
        controller.abort();
      });
      expect(requests.slice(start).every(request => request.signal?.aborted)).toBe(true);
    }
  });
});
