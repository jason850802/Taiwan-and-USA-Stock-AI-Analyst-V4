import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chartResponse = (symbol = 'AAPL', price = 123, timestamps = [1704207600]) => ({
  chart: { error: null, result: [{
    meta: { symbol, currency: 'USD', exchangeTimezoneName: 'America/New_York', regularMarketPrice: price },
    timestamp: timestamps,
    indicators: { quote: [{
      open: timestamps.map(() => price - 1), high: timestamps.map(() => price + 1),
      low: timestamps.map(() => price - 2), close: timestamps.map(() => price), volume: timestamps.map(() => 1000),
    }] },
  }] },
});
const response = (symbol = 'AAPL', price = 123, timestamps?: number[]) => ({
  ok: true, json: async () => chartResponse(symbol, price, timestamps),
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('庫存報價載入', () => {
  it('同代碼的同時讀取只送出一次請求，回傳各自獨立物件', async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice, peekLatestPrice } = await import('./yahoo');
    const values = await Promise.all(Array.from({ length: 10 }, (_, i) => getLatestPrice(i % 2 ? ' aapl ' : 'AAPL')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(values.every(v => v.price === 123 && v.date === '2024-01-02')).toBe(true);
    values[0].price = 999;
    expect(values[1].price).toBe(123);
    expect(peekLatestPrice('AAPL')?.price).toBe(123);
  });

  it('不同代碼各送出請求', async () => {
    const fetchMock = vi.fn(async input => {
      const symbol = new URL(String(input), 'http://localhost').searchParams.get('symbol')!;
      return response(symbol, symbol === 'AAPL' ? 123 : 456);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice } = await import('./yahoo');
    expect((await Promise.all([getLatestPrice('AAPL'), getLatestPrice('MSFT')])).map(r => r.price)).toEqual([123, 456]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('成功後沿用既有快取，強制更新仍重新請求', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response('AAPL', 140));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice } = await import('./yahoo');
    await getLatestPrice('AAPL');
    expect((await getLatestPrice('AAPL')).price).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await getLatestPrice('AAPL', { force: true })).price).toBe(140);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('強制更新不共用舊請求，舊請求先完成=%s 時快取仍屬於新一輪', async oldFirst => {
    const resolve: Array<(value: ReturnType<typeof response>) => void> = [];
    const fetchMock = vi.fn(() => new Promise(r => resolve.push(r)));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice, peekLatestPrice } = await import('./yahoo');
    const oldRequest = getLatestPrice('AAPL');
    const newRequest = getLatestPrice('AAPL', { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (oldFirst) {
      resolve[0](response('AAPL', 100));
      await oldRequest;
      resolve[1](response('AAPL', 200));
    } else {
      resolve[1](response('AAPL', 200));
      await newRequest;
      resolve[0](response('AAPL', 100));
    }
    await Promise.all([oldRequest, newRequest]);
    expect(peekLatestPrice('AAPL')?.price).toBe(200);
  });

  it('失敗不留住進行中請求，下一次可以重試', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('模擬離線')).mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice } = await import('./yahoo');
    await expect(Promise.all([getLatestPrice('AAPL'), getLatestPrice('AAPL')])).rejects.toThrow();
    expect((await getLatestPrice('AAPL')).price).toBe(123);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('無效報價仍不寫入快取', async () => {
    const fetchMock = vi.fn(async () => response('AAPL', NaN));
    vi.stubGlobal('fetch', fetchMock);
    const { getLatestPrice, peekLatestPrice } = await import('./yahoo');
    await getLatestPrice('AAPL');
    expect(peekLatestPrice('AAPL')).toBeNull();
    await getLatestPrice('AAPL');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('行情日期格式器重用', () => {
  it('美股夏令時間切換前後仍以交易所當地時間標示分時 K 棒', async () => {
    const timestamps = [Date.parse('2024-03-08T14:30:00Z') / 1000, Date.parse('2024-03-11T13:30:00Z') / 1000];
    vi.stubGlobal('fetch', vi.fn(async () => response('AAPL', 123, timestamps)));
    const { getStockData } = await import('./yahoo');
    const { data } = await getStockData('AAPL', '60m', { forceRefresh: true });
    expect(data.map(d => d.date)).toEqual(['03-08 09:30', '03-11 09:30']);
    expect(data.map(d => d.close)).toEqual([123, 123]);
  });
});
