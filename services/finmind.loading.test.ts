import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T04:00:00Z'));
  const stored = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function controlledNetwork() {
  const valuations: Array<{ stockId: string; finish: (per: number | null) => void }> = [];
  const reply = (data: unknown[], status = 200) => new Response(JSON.stringify({ msg: 'success', data }), { status });
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.searchParams.get('dataset') !== 'TaiwanStockPER') return Promise.resolve(reply([]));
    return new Promise<Response>(resolve => valuations.push({
      stockId: url.searchParams.get('data_id')!,
      finish: per => resolve(per === null ? reply([], 503) : reply([{ date: '2026-09-18', PER: per, PBR: 2, dividend_yield: 3 }])),
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { valuations, fetchMock };
}

describe('基本面請求與快取歸屬', () => {
  it.each([true, false])('同股舊請求先完成=%s，後續記憶體與儲存快取仍屬於新請求', async oldFirst => {
    const { valuations, fetchMock } = controlledNetwork();
    const { getTwFundamentals } = await import('./finmind');
    const oldRequest = getTwFundamentals('2330');
    const newRequest = getTwFundamentals('2330', { force: true });
    expect(valuations).toHaveLength(2);
    if (oldFirst) {
      valuations[0].finish(11.11);
      await oldRequest;
      valuations[1].finish(21.11);
    } else {
      valuations[1].finish(21.11);
      await newRequest;
      valuations[0].finish(11.11);
    }
    const [oldResult, newResult] = await Promise.all([oldRequest, newRequest]);
    expect(oldResult.valuation?.per).toBe(11.11);
    expect(newResult.valuation?.per).toBe(21.11);
    expect((await getTwFundamentals('2330')).valuation?.per).toBe(21.11);
    vi.resetModules();
    const reloaded = await import('./finmind');
    expect((await reloaded.getTwFundamentals('2330')).valuation?.per).toBe(21.11);
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });

  it('新請求失敗後，舊成功不復活失效快取，下一次可重新取得資料', async () => {
    const { valuations, fetchMock } = controlledNetwork();
    const { getTwFundamentals } = await import('./finmind');
    const oldRequest = getTwFundamentals('2330');
    const newRequest = getTwFundamentals('2330', { force: true });
    const failed = expect(newRequest).rejects.toThrow();
    valuations[1].finish(null);
    await failed;
    valuations[0].finish(11.11);
    await oldRequest;
    const retry = getTwFundamentals('2330');
    expect(valuations).toHaveLength(3);
    valuations[2].finish(31.11);
    expect((await retry).valuation?.per).toBe(31.11);
    expect((await getTwFundamentals('2330')).valuation?.per).toBe(31.11);
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it('不同股票各自快取，不因其他股票請求較晚開始而失去快取', async () => {
    const { valuations, fetchMock } = controlledNetwork();
    const { getTwFundamentals } = await import('./finmind');
    const a = getTwFundamentals('2330');
    const b = getTwFundamentals('6488');
    valuations[1].finish(22.22);
    await b;
    valuations[0].finish(11.11);
    await a;
    expect((await getTwFundamentals('2330')).valuation?.per).toBe(11.11);
    expect((await getTwFundamentals('6488')).valuation?.per).toBe(22.22);
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });
});
