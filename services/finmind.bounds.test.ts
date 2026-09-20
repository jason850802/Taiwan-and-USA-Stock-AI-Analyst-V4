import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  return {
    get length() { return stored.size; },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  };
}

function deniedStorage() {
  return {
    get length() { throw new DOMException('denied', 'SecurityError'); },
    key: () => { throw new DOMException('denied', 'SecurityError'); },
    getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    setItem: () => { throw new DOMException('denied', 'SecurityError'); },
    removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
  };
}

function quotaStorage(maxFundKeys: number) {
  const stored = new Map([['sentinel', 'keep']]);
  return {
    get length() { return stored.size; },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const fundKeys = [...stored.keys()].filter(item => item.startsWith('tw_fund_'));
      if (!stored.has(key) && key.startsWith('tw_fund_') && fundKeys.length >= maxFundKeys) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      stored.set(key, value);
    },
    removeItem: (key: string) => { stored.delete(key); },
  };
}

function immediateNetwork(nameSize = 0) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const dataset = url.searchParams.get('dataset');
    const stockId = url.searchParams.get('data_id')!;
    let data: unknown[] = [];
    if (dataset === 'TaiwanStockInfo') {
      data = [{ stock_id: stockId, stock_name: nameSize ? `${stockId}:${'n'.repeat(nameSize)}` : `公司${stockId}` }];
    } else if (dataset === 'TaiwanStockPER') {
      data = [{ date: '2026-09-18', PER: 15, PBR: 2, dividend_yield: 3 }];
    }
    return new Response(JSON.stringify({ msg: 'success', data }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function controlledNetwork() {
  const valuations: Array<{ stockId: string; finish: (per: number) => void }> = [];
  const reply = (data: unknown[]) => new Response(JSON.stringify({ msg: 'success', data }));
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.searchParams.get('dataset') !== 'TaiwanStockPER') return Promise.resolve(reply([]));
    return new Promise<Response>(resolve => valuations.push({
      stockId: url.searchParams.get('data_id')!,
      finish: per => resolve(reply([{ date: '2026-09-18', PER: per, PBR: 2, dividend_yield: 3 }])),
    }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { valuations, fetchMock };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T04:00:00Z'));
  vi.stubGlobal('sessionStorage', memoryStorage({ sentinel: 'keep' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('基本面可重建快取容量', () => {
  it('前一日請求跨日才完成時只回原呼叫者，不發布成可再次命中的舊日快取', async () => {
    const { valuations, fetchMock } = controlledNetwork();
    const { getTwFundamentals } = await import('./finmind');
    const late = getTwFundamentals('2330');
    expect(valuations).toHaveLength(1);

    vi.setSystemTime(new Date('2026-09-21T04:00:00Z'));
    valuations[0].finish(15);
    expect((await late).valuation?.per).toBe(15);

    vi.setSystemTime(new Date('2026-09-20T04:00:00Z'));
    const refetch = getTwFundamentals('2330');
    expect(valuations).toHaveLength(2);
    valuations[1].finish(25);
    expect((await refetch).valuation?.per).toBe(25);
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });

  it('超過 128 個記憶體 entry 時淘汰最久未使用項目，近期讀取仍命中', async () => {
    vi.stubGlobal('sessionStorage', deniedStorage());
    const fetchMock = immediateNetwork();
    const { getTwFundamentals } = await import('./finmind');
    for (let i = 0; i < 128; i++) await getTwFundamentals(String(800000 + i));
    expect(fetchMock).toHaveBeenCalledTimes(128 * 7);
    await getTwFundamentals('800000');
    expect(fetchMock).toHaveBeenCalledTimes(128 * 7);
    await getTwFundamentals('800128');
    expect(fetchMock).toHaveBeenCalledTimes(129 * 7);

    await getTwFundamentals('800001');
    expect(fetchMock).toHaveBeenCalledTimes(130 * 7);
    await getTwFundamentals('800000');
    expect(fetchMock).toHaveBeenCalledTimes(130 * 7);
  });

  it('記憶體 2 MiB bytes 預算會在 entry 數上限前先淘汰 LRU', async () => {
    vi.stubGlobal('sessionStorage', deniedStorage());
    const fetchMock = immediateNetwork(110_000);
    const { getTwFundamentals } = await import('./finmind');
    for (let i = 0; i < 10; i++) await getTwFundamentals(String(810000 + i));
    const before = fetchMock.mock.calls.length;

    await getTwFundamentals('810000');
    expect(fetchMock.mock.calls.length).toBe(before + 7);
    await getTwFundamentals('810009');
    expect(fetchMock.mock.calls.length).toBe(before + 7);
  });

  it('超過 256 KiB 的單項仍回傳，但不進 memory 或 session 長期快取', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork(140_000);
    const { getTwFundamentals } = await import('./finmind');

    expect((await getTwFundamentals('820000')).valuation?.per).toBe(15);
    expect((await getTwFundamentals('820000')).valuation?.per).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(14);
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('session 1 MiB 總預算會淘汰舊項，重載後近期項仍可直接命中', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork(60_000);
    let module = await import('./finmind');
    for (let i = 0; i < 9; i++) await module.getTwFundamentals(String(830000 + i));
    const beforeReload = fetchMock.mock.calls.length;
    vi.resetModules();
    module = await import('./finmind');

    await module.getTwFundamentals('830000');
    expect(fetchMock.mock.calls.length).toBe(beforeReload + 7);
    await module.getTwFundamentals('830008');
    expect(fetchMock.mock.calls.length).toBe(beforeReload + 7);
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('session 最多保留 128 keys，重載不會由被淘汰的舊 key 復活', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork();
    let module = await import('./finmind');
    for (let i = 0; i < 129; i++) await module.getTwFundamentals(String(840000 + i));
    const beforeReload = fetchMock.mock.calls.length;
    vi.resetModules();
    module = await import('./finmind');

    await module.getTwFundamentals('840000');
    expect(fetchMock.mock.calls.length).toBe(beforeReload + 7);
    await module.getTwFundamentals('840128');
    expect(fetchMock.mock.calls.length).toBe(beforeReload + 7);
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('跨日讀取會清掉前一日 memory/session，回到舊日期也必須重抓', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork();
    const { getTwFundamentals } = await import('./finmind');
    await getTwFundamentals('850000');
    expect(fetchMock).toHaveBeenCalledTimes(7);

    vi.setSystemTime(new Date('2026-09-21T04:00:00Z'));
    await getTwFundamentals('850000');
    expect(fetchMock).toHaveBeenCalledTimes(14);
    vi.setSystemTime(new Date('2026-09-20T04:00:00Z'));
    await getTwFundamentals('850000');
    expect(fetchMock).toHaveBeenCalledTimes(21);
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('Storage denied 只失去持久化加速，當頁 memory 仍可命中', async () => {
    vi.stubGlobal('sessionStorage', deniedStorage());
    const fetchMock = immediateNetwork();
    const { getTwFundamentals } = await import('./finmind');

    expect((await getTwFundamentals('860000')).valuation?.per).toBe(15);
    expect((await getTwFundamentals('860000')).valuation?.per).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('壞 JSON 只清自家 key 並重新抓取，sentinel 保持原樣', async () => {
    const storage = memoryStorage({
      sentinel: 'keep',
      'tw_fund_870000_2026-09-20': '{broken',
    });
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork();
    const { getTwFundamentals } = await import('./finmind');

    expect((await getTwFundamentals('870000')).valuation?.per).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('初始化 session 索引時剔除超過 256 KiB 的歷史自家 entry，不清 sentinel', async () => {
    const storage = memoryStorage({
      sentinel: 'keep',
      'tw_fund_OLD_2026-09-20': JSON.stringify({ stockId: 'OLD', body: 'x'.repeat(150_000) }),
    });
    vi.stubGlobal('sessionStorage', storage);
    immediateNetwork();
    const { getTwFundamentals } = await import('./finmind');

    await getTwFundamentals('890000');
    expect(storage.getItem('tw_fund_OLD_2026-09-20')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('真實 quota 僅淘汰自家 LRU 後重試一次，不刪 sentinel', async () => {
    const storage = quotaStorage(1);
    vi.stubGlobal('sessionStorage', storage);
    const fetchMock = immediateNetwork();
    let module = await import('./finmind');
    await module.getTwFundamentals('880000');
    await module.getTwFundamentals('880001');
    const beforeReload = fetchMock.mock.calls.length;
    vi.resetModules();
    module = await import('./finmind');

    await module.getTwFundamentals('880001');
    expect(fetchMock.mock.calls.length).toBe(beforeReload);
    await module.getTwFundamentals('880000');
    expect(fetchMock.mock.calls.length).toBe(beforeReload + 7);
    expect(storage.getItem('sentinel')).toBe('keep');
  });
});
