import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GateTarget = 'name' | 'chips' | 'pv' | 'history';

const chartPayload = (symbol: string, range = '10y', price = 120) => {
  const count = range === '2y' ? 2 : 5;
  const closes = Array.from({ length: count }, (_, index) => price - count + index + 1);
  const timestamps = closes.map((_, index) => 1704207600 + index * 86400);
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          currency: symbol.endsWith('.TW') ? 'TWD' : 'USD',
          exchangeTimezoneName: symbol.endsWith('.TW') ? 'Asia/Taipei' : 'America/New_York',
          regularMarketPrice: price,
          previousClose: price - 1,
          longName: `Yahoo ${symbol}`,
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: closes.map(value => value - 1),
            high: closes.map(value => value + 2),
            low: closes.map(value => value - 2),
            close: closes,
            volume: closes.map(() => 1000),
          }],
        },
      }],
    },
  };
};

const finMindRows = (dataset: string | null) => {
  if (dataset === 'TaiwanStockInfo') return [{ stock_id: '2330', stock_name: '固定名稱 2330' }];
  if (dataset === 'TaiwanStockInstitutionalInvestorsBuySell') {
    return [
      { date: '2024-01-02', name: 'Foreign_Investor', buy: 200, sell: 100 },
      { date: '2024-01-02', name: 'Investment_Trust', buy: 80, sell: 30 },
    ];
  }
  if (dataset === 'TaiwanStockPrice') {
    return Array.from({ length: 5 }, (_, index) => ({
      date: `2024-01-0${index + 2}`,
      Trading_Volume: 5000 + index,
      open: 114 + index,
      max: 117 + index,
      min: 113 + index,
      close: 115 + index,
    }));
  }
  return [];
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T00:00:00+08:00'));
  const storage = new Map<string, string>();
  const storageLike = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  };
  vi.stubGlobal('sessionStorage', storageLike);
  vi.stubGlobal('localStorage', storageLike);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('K 線 FinMind context 固定上游契約', () => {
  it('A→B→A 回訪沿用 fresh cache，不增加第三次 chart 請求', async () => {
    const chartRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname !== '/api/yahoo/chart') throw new Error(`未定義固定請求：${url.pathname}`);
      const symbol = url.searchParams.get('symbol')!;
      chartRequests.push(symbol);
      return jsonResponse(chartPayload(symbol, url.searchParams.get('range') || '10y'));
    }));

    const { getStockData } = await import('./yahoo');
    const firstA = await getStockData('AAPL');
    await getStockData('MSFT');
    const secondA = await getStockData('AAPL');

    expect(secondA).toEqual(firstA);
    expect(chartRequests).toEqual(['AAPL', 'MSFT']);
  });

  it('FinMind 三路都失敗時照常發布 Yahoo 台股日線，且不誤入 FinMind fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallbackLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname === '/api/yahoo/chart') {
        return jsonResponse(chartPayload('2330.TW', url.searchParams.get('range') || '10y'));
      }
      if (url.pathname === '/api/finmind') {
        return jsonResponse({ message: '固定 FinMind 失敗' }, 503);
      }
      throw new Error(`未定義固定請求：${url.pathname}`);
    }));

    const { getStockData } = await import('./yahoo');
    const result = await getStockData('2330.TW', '1d', { forceRefresh: true });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.info.chipDataUnavailable).toBe(true);
    expect(fallbackLog).not.toHaveBeenCalledWith(expect.stringContaining('Attempting FinMind fallback'));
  });

  it('FinMind PV 單獨失敗時照常發布未校正量價，但快取只享短 TTL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chartRequests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname === '/api/yahoo/chart') {
        const symbol = url.searchParams.get('symbol')!;
        chartRequests.push(symbol);
        return jsonResponse(chartPayload(symbol, url.searchParams.get('range') || '10y'));
      }
      if (url.pathname === '/api/finmind') {
        const dataset = url.searchParams.get('dataset');
        // 對照組 2317 的 PV 成功；只有 2330 的 PV 明確失敗。
        if (dataset === 'TaiwanStockPrice' && url.searchParams.get('data_id') === '2330') {
          return jsonResponse({ message: '固定 PV 失敗' }, 503);
        }
        return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
      }
      throw new Error(`未定義固定請求：${url.pathname}`);
    }));

    const { getStockData } = await import('./yahoo');
    const failed = await getStockData('2330.TW', '1d');
    await getStockData('2317.TW', '1d');

    expect(failed.data.length).toBeGreaterThan(0);
    expect(failed.info.chipDataUnavailable).not.toBe(true);
    expect(failed.data.some(row => row.volume >= 5000)).toBe(false);
    expect(chartRequests).toEqual(['2330.TW', '2317.TW']);

    // 收盤後（台北 00:11）：一般結果沿用到下一交易日開盤，PV 未校正的結果 10 分鐘後即過期重抓。
    vi.setSystemTime(new Date('2026-09-23T00:11:00+08:00'));
    await getStockData('2330.TW', '1d');
    await getStockData('2317.TW', '1d');
    expect(chartRequests).toEqual(['2330.TW', '2317.TW', '2330.TW']);
  });

  it('台股 staged 2y 先到且 PV 失敗時照常交付並補全，不啟動 FinMind fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallbackLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    let releaseFull!: () => void;
    const fullGate = new Promise<void>(resolve => { releaseFull = resolve; });
    let pvRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname === '/api/yahoo/chart') {
        const range = url.searchParams.get('range') || '10y';
        if (range === '10y') await fullGate;
        return jsonResponse(chartPayload('2330.TW', range));
      }
      if (url.pathname === '/api/finmind') {
        const dataset = url.searchParams.get('dataset');
        if (dataset === 'TaiwanStockPrice') {
          pvRequests += 1;
          return jsonResponse({ message: '固定 PV 失敗' }, 503);
        }
        return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
      }
      throw new Error(`未定義固定請求：${url.pathname}`);
    }));

    const { getStockData } = await import('./yahoo');
    const onRevalidated = vi.fn();
    const partial = await getStockData('2330.TW', '1d', { onRevalidated });
    expect(partial.data).toHaveLength(2);

    releaseFull();
    await vi.waitFor(() => expect(onRevalidated).toHaveBeenCalledTimes(1));
    expect(onRevalidated.mock.calls[0][0].data).toHaveLength(5);
    expect(pvRequests).toBe(1);
    expect(fallbackLog).not.toHaveBeenCalledWith(expect.stringContaining('Attempting FinMind fallback'));
  });

  it('台股 staged 最後 subscriber 取消時保留 AbortError，且不啟動不可取消 FinMind fallback', async () => {
    const controller = new AbortController();
    let pvRequests = 0;
    let fallbackPvRequests = 0;
    const fallbackLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname === '/api/yahoo/chart') {
        const range = url.searchParams.get('range') || '10y';
        if (range === '10y') return new Promise<Response>(() => {});
        return jsonResponse(chartPayload('2330.TW', range, 110));
      }
      if (url.pathname === '/api/finmind') {
        const dataset = url.searchParams.get('dataset');
        if (dataset === 'TaiwanStockInfo' || dataset === 'TaiwanStockInstitutionalInvestorsBuySell') {
          return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
        }
        if (dataset === 'TaiwanStockPrice') {
          pvRequests += 1;
          if (init?.signal) {
            return new Promise<Response>((_resolve, reject) => {
              const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
              if (init.signal?.aborted) rejectAbort();
              else init.signal.addEventListener('abort', rejectAbort, { once: true });
            });
          }
          fallbackPvRequests += 1;
          return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
        }
      }
      throw new Error(`未定義固定請求：${url.pathname}`);
    }));

    const { getStockData } = await import('./yahoo');
    const pending = getStockData('2330.TW', '1d', {
      signal: controller.signal,
      onRevalidated: vi.fn(),
    }).catch(error => error);

    await flush();
    expect(pvRequests).toBe(1);
    controller.abort();
    const error = await pending;
    await flush();
    await flush();

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(pvRequests).toBe(1);
    expect(fallbackPvRequests).toBe(0);
    expect(fallbackLog).not.toHaveBeenCalledWith(expect.stringContaining('Attempting FinMind fallback'));
  });

  it('台股 speculative PV 尚未被 context 消費前取消，不產生 unhandled rejection 或 stale publish', async () => {
    const controller = new AbortController();
    let cancelled = false;
    let pvRequests = 0;
    let fallbackPvRequests = 0;
    const chartRequests: string[] = [];
    const releaseStaleCharts: Array<() => void> = [];
    const unhandled: unknown[] = [];
    const fallbackLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    try {
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://fixture');
        if (url.pathname === '/api/yahoo/chart') {
          const range = url.searchParams.get('range') || '10y';
          chartRequests.push(range);
          if (!cancelled) {
            return new Promise<Response>(resolve => {
              releaseStaleCharts.push(() => resolve(jsonResponse(chartPayload('2330.TW', range, range === '2y' ? 110 : 120))));
            });
          }
          return Promise.resolve(jsonResponse(chartPayload('2330.TW', range, 220)));
        }
        if (url.pathname === '/api/finmind') {
          const dataset = url.searchParams.get('dataset');
          if (dataset === 'TaiwanStockPrice') {
            pvRequests += 1;
            if (!cancelled && init?.signal) {
              return new Promise<Response>((_resolve, reject) => {
                const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
                if (init.signal?.aborted) rejectAbort();
                else init.signal.addEventListener('abort', rejectAbort, { once: true });
              });
            }
            if (!init?.signal) fallbackPvRequests += 1;
          }
          return Promise.resolve(jsonResponse({ msg: 'success', data: finMindRows(dataset) }));
        }
        throw new Error(`未定義固定請求：${url.pathname}`);
      }));

      const { getStockData } = await import('./yahoo');
      const pending = getStockData('2330.TW', '1d', {
        signal: controller.signal,
        onRevalidated: vi.fn(),
      }).catch(error => error);

      expect(chartRequests).toEqual(['2y', '10y']);
      expect(pvRequests).toBe(1);
      expect(releaseStaleCharts).toHaveLength(2);

      controller.abort();
      cancelled = true;
      const error = await pending;
      await flush();
      await flush();

      expect(error).toMatchObject({ name: 'AbortError' });
      expect(unhandled).toEqual([]);
      expect(fallbackPvRequests).toBe(0);
      expect(fallbackLog).not.toHaveBeenCalledWith(expect.stringContaining('Attempting FinMind fallback'));

      const fresh = await getStockData('2330.TW', '1d', { forceRefresh: true });
      expect(fresh.data.at(-1)?.close).toBe(220);
      expect(chartRequests).toEqual(['2y', '10y', '10y']);

      releaseStaleCharts.forEach(release => release());
      await flush();
      await flush();

      const requestCountBeforeCacheRead = chartRequests.length;
      const cached = await getStockData('2330.TW', '1d');
      expect(cached.data.at(-1)?.close).toBe(220);
      expect(chartRequests).toHaveLength(requestCountBeforeCacheRead);
      expect(unhandled).toEqual([]);
      expect(fallbackPvRequests).toBe(0);
      expect(fallbackLog).not.toHaveBeenCalledWith(expect.stringContaining('Attempting FinMind fallback'));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it.each<GateTarget>(['name', 'chips', 'pv', 'history'])(
    '%s 尚未到貨時，台股日線 final 仍保持 pending',
    async target => {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://fixture');
        if (url.pathname === '/api/yahoo/chart') {
          if (target === 'history') await gate;
          return jsonResponse(chartPayload('2330.TW', url.searchParams.get('range') || '10y'));
        }
        if (url.pathname === '/api/finmind') {
          const dataset = url.searchParams.get('dataset');
          const requestTarget = dataset === 'TaiwanStockInfo'
            ? 'name'
            : dataset === 'TaiwanStockInstitutionalInvestorsBuySell'
              ? 'chips'
              : 'pv';
          if (target === requestTarget) await gate;
          return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
        }
        throw new Error(`未定義固定請求：${url.pathname}`);
      }));

      const { getStockData } = await import('./yahoo');
      let settled = false;
      const pending = getStockData('2330.TW', '1d', { forceRefresh: true })
        .then(result => { settled = true; return result; });

      await flush();
      expect(settled).toBe(false);
      release();
      await expect(pending).resolves.toMatchObject({ info: { symbol: '2330.TW' } });
      expect(settled).toBe(true);
    },
  );

  it('2y 已先到時，必要 PV 尚未到貨仍不發布台股 partial', async () => {
    let releasePv!: () => void;
    const pvGate = new Promise<void>(resolve => { releasePv = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://fixture');
      if (url.pathname === '/api/yahoo/chart') {
        const range = url.searchParams.get('range') || '10y';
        return jsonResponse(chartPayload('2330.TW', range, range === '2y' ? 110 : 120));
      }
      if (url.pathname === '/api/finmind') {
        const dataset = url.searchParams.get('dataset');
        if (dataset === 'TaiwanStockPrice') await pvGate;
        return jsonResponse({ msg: 'success', data: finMindRows(dataset) });
      }
      throw new Error(`未定義固定請求：${url.pathname}`);
    }));

    const { getStockData } = await import('./yahoo');
    const onRevalidated = vi.fn();
    let initialSettled = false;
    const initial = getStockData('2330.TW', '1d', { onRevalidated })
      .then(result => { initialSettled = true; return result; });

    await flush();
    expect(initialSettled).toBe(false);
    expect(onRevalidated).not.toHaveBeenCalled();

    releasePv();
    const partial = await initial;
    expect(partial.data).toHaveLength(2);
    await flush();
    expect(onRevalidated).toHaveBeenCalledTimes(1);
    expect(onRevalidated.mock.calls[0][0].data).toHaveLength(5);
  });
});
