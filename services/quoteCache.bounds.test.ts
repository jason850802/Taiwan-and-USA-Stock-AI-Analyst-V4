import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deniedStorage() {
  return {
    get length() { return 0; },
    key: () => null,
    getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    setItem: () => { throw new DOMException('denied', 'SecurityError'); },
    removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
  };
}

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

function quotaStorage(maxQuoteKeys: number) {
  const stored = new Map([['sentinel', 'keep']]);
  return {
    get length() { return stored.size; },
    key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const quoteKeys = [...stored.keys()].filter(item => item.startsWith('quote_cache_v1:'));
      if (!stored.has(key) && key.startsWith('quote_cache_v1:') && quoteKeys.length >= maxQuoteKeys) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      stored.set(key, value);
    },
    removeItem: (key: string) => { stored.delete(key); },
  };
}

function switchableStorage(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  let denied = false;
  const guard = () => { if (denied) throw new DOMException('denied', 'SecurityError'); };
  return {
    get length() { guard(); return stored.size; },
    key: (index: number) => { guard(); return [...stored.keys()][index] ?? null; },
    getItem: (key: string) => { guard(); return stored.get(key) ?? null; },
    setItem: (key: string, value: string) => { guard(); stored.set(key, value); },
    removeItem: (key: string) => { guard(); stored.delete(key); },
    setDenied: (value: boolean) => { denied = value; },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', deniedStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('行情可重建快取容量', () => {
  it('超過 160 個 payload 時淘汰最久未使用項目，近期讀取仍保留', async () => {
    const { readQuoteCache, writeQuoteCache } = await import('./quoteCache');
    const entry = (id: number) => ({ cachedAt: 1, shortTtlOnly: false, result: { id } });

    for (let i = 0; i < 160; i++) writeQuoteCache(`S${i}|1d`, entry(i));
    expect(readQuoteCache('S0|1d')?.result).toEqual({ id: 0 });
    writeQuoteCache('S160|1d', entry(160));

    expect(readQuoteCache('S0|1d')?.result).toEqual({ id: 0 });
    expect(readQuoteCache('S1|1d')).toBeNull();
    expect(readQuoteCache('S160|1d')?.result).toEqual({ id: 160 });
  });

  it('同 key 改寫成超過 8 MiB 的 payload 時舊別名與舊持久化都不會復活', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    const oldEntry = { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } };
    cache.writeQuoteCache('2330|1d', oldEntry);
    cache.writeMemoryAlias('2330.TW|1d', oldEntry);

    cache.writeQuoteCache('2330|1d', {
      cachedAt: 2,
      shortTtlOnly: false,
      result: { id: 'oversize', body: 'x'.repeat(4 * 1024 * 1024 + 32) },
    });

    expect(cache.readQuoteCache('2330|1d')).toBeNull();
    expect(cache.readQuoteCache('2330.TW|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
    vi.resetModules();
    const reloaded = await import('./quoteCache');
    expect(reloaded.readQuoteCache('2330|1d')).toBeNull();
  });

  it('記憶體 bytes 超過 128 MiB 時以 payload LRU 淘汰，單項仍低於 8 MiB', async () => {
    const cache = await import('./quoteCache');
    const body = 'x'.repeat(4_000_000);
    for (let i = 0; i < 17; i++) {
      cache.writeQuoteCache(`BIG${i}|1d`, { cachedAt: i, shortTtlOnly: false, result: { id: i, body } });
    }

    expect(cache.readQuoteCache('BIG0|1d')).toBeNull();
    expect(cache.readQuoteCache('BIG16|1d')?.result).toMatchObject({ id: 16 });
  });

  it('別名 key 超過 320 時淘汰整個最舊 payload，不留下同物件的其他別名', async () => {
    const cache = await import('./quoteCache');
    const oldEntry = { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } };
    cache.writeQuoteCache('OLD|1d', oldEntry);
    for (let i = 0; i < 199; i++) cache.writeMemoryAlias(`OLD-ALIAS-${i}`, oldEntry);
    const recentEntry = { cachedAt: 2, shortTtlOnly: false, result: { id: 'recent' } };
    cache.writeQuoteCache('RECENT|1d', recentEntry);
    for (let i = 0; i < 120; i++) cache.writeMemoryAlias(`RECENT-ALIAS-${i}`, recentEntry);

    expect(cache.readQuoteCache('OLD|1d')).toBeNull();
    expect(cache.readQuoteCache('OLD-ALIAS-198')).toBeNull();
    expect(cache.readQuoteCache('RECENT-ALIAS-119')?.result).toEqual({ id: 'recent' });
  });

  it('改寫既有別名時使舊 payload 的其他別名與持久化一起失效', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    const oldEntry = { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } };
    cache.writeQuoteCache('OLD|1d', oldEntry);
    cache.writeMemoryAlias('SHARED|1d', oldEntry);
    const nextEntry = { cachedAt: 2, shortTtlOnly: false, result: { id: 'next' } };
    cache.writeQuoteCache('NEXT|1d', nextEntry);
    cache.writeMemoryAlias('SHARED|1d', nextEntry);

    expect(cache.readQuoteCache('OLD|1d')).toBeNull();
    expect(cache.readQuoteCache('SHARED|1d')?.result).toEqual({ id: 'next' });
    vi.resetModules();
    const reloaded = await import('./quoteCache');
    expect(reloaded.readQuoteCache('OLD|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('循環新值不拋錯，且不讓同 key 的舊記憶體、別名或 session 值復活', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    const oldEntry = { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } };
    cache.writeQuoteCache('CYCLE|1d', oldEntry);
    cache.writeMemoryAlias('CYCLE.TW|1d', oldEntry);
    const circular: any = { cachedAt: 2, shortTtlOnly: false, result: { id: 'cycle' } };
    circular.result.loop = circular;

    expect(() => cache.writeQuoteCache('CYCLE|1d', circular)).not.toThrow();
    expect(cache.readQuoteCache('CYCLE|1d')).toBeNull();
    expect(cache.readQuoteCache('CYCLE.TW|1d')).toBeNull();
    vi.resetModules();
    const reloaded = await import('./quoteCache');
    expect(reloaded.readQuoteCache('CYCLE|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('session 最多保留 64 keys，重載仍能讀近期項且不碰 sentinel', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    for (let i = 0; i < 65; i++) {
      cache.writeQuoteCache(`P${i}|1wk`, { cachedAt: i, shortTtlOnly: false, result: { id: i } });
    }
    vi.resetModules();
    const reloaded = await import('./quoteCache');

    expect(reloaded.readQuoteCache('P0|1wk')).toBeNull();
    expect(reloaded.readQuoteCache('P64|1wk')?.result).toEqual({ id: 64 });
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('session 4 MiB 總預算與 2 MiB 單項上限獨立於 memory', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    const medium = 'm'.repeat(700_000);
    for (let i = 0; i < 3; i++) {
      cache.writeQuoteCache(`MED${i}|1wk`, { cachedAt: i, shortTtlOnly: false, result: { id: i, body: medium } });
    }
    cache.writeQuoteCache('SESSION-LARGE|1wk', {
      cachedAt: 4,
      shortTtlOnly: false,
      result: { id: 'memory-only', body: 'z'.repeat(1_100_000) },
    });
    expect(cache.readQuoteCache('SESSION-LARGE|1wk')?.result).toMatchObject({ id: 'memory-only' });
    vi.resetModules();
    const reloaded = await import('./quoteCache');

    expect(reloaded.readQuoteCache('MED0|1wk')).toBeNull();
    expect(reloaded.readQuoteCache('MED2|1wk')?.result).toMatchObject({ id: 2 });
    expect(reloaded.readQuoteCache('SESSION-LARGE|1wk')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('真實 quota 只淘汰自家 LRU 後重試一次，sentinel 不受影響', async () => {
    const storage = quotaStorage(1);
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    cache.writeQuoteCache('Q0|1d', { cachedAt: 1, shortTtlOnly: false, result: { id: 0 } });
    cache.writeQuoteCache('Q1|1d', { cachedAt: 2, shortTtlOnly: false, result: { id: 1 } });
    vi.resetModules();
    const reloaded = await import('./quoteCache');

    expect(reloaded.readQuoteCache('Q0|1d')).toBeNull();
    expect(reloaded.readQuoteCache('Q1|1d')?.result).toEqual({ id: 1 });
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('舊 canonical 已只剩 session 時，改成新 payload 的 memory alias 也會使舊持久化失效', async () => {
    const storage = switchableStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    cache.writeQuoteCache('CANON|1d', { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } });
    storage.setDenied(true);
    let recentEntry = { cachedAt: 2, shortTtlOnly: false, result: { id: -1 } };
    for (let i = 0; i < 160; i++) {
      recentEntry = { cachedAt: i + 2, shortTtlOnly: false, result: { id: i } };
      cache.writeQuoteCache(`R${i}|1d`, recentEntry);
    }
    storage.setDenied(false);
    cache.writeMemoryAlias('CANON|1d', recentEntry);
    expect(cache.readQuoteCache('CANON|1d')?.result).toEqual({ id: 159 });
    vi.resetModules();
    const reloaded = await import('./quoteCache');

    expect(reloaded.readQuoteCache('CANON|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('初始化 session 索引時剔除超過 2 MiB 的舊自家 entry，不清 sentinel', async () => {
    const oversized = JSON.stringify({ cachedAt: 1, shortTtlOnly: false, result: { body: 'x'.repeat(1_100_000) } });
    const storage = memoryStorage({
      sentinel: 'keep',
      'quote_cache_v1:LEGACY|1d': oversized,
    });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    cache.writeQuoteCache('NEW|1d', { cachedAt: 2, shortTtlOnly: false, result: { id: 'new' } });

    expect(storage.getItem('quote_cache_v1:LEGACY|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('初始化大量歷史 session keys 時立刻收斂索引與儲存到 64 keys', async () => {
    const initial: Record<string, string> = { sentinel: 'keep' };
    for (let i = 0; i < 65; i++) {
      initial[`quote_cache_v1:LEGACY${i}|1d`] = JSON.stringify({
        cachedAt: i,
        shortTtlOnly: false,
        result: { id: i },
      });
    }
    const storage = memoryStorage(initial);
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');

    expect(cache.readQuoteCache('MISS|1d')).toBeNull();
    const ownKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
      .filter(key => key?.startsWith('quote_cache_v1:'));
    expect(ownKeys).toHaveLength(64);
    expect(storage.getItem('quote_cache_v1:LEGACY0|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it('JSON.stringify 回傳 undefined 時視同不可序列化，不拋錯也不留舊值', async () => {
    const storage = memoryStorage({ sentinel: 'keep' });
    vi.stubGlobal('sessionStorage', storage);
    const cache = await import('./quoteCache');
    cache.writeQuoteCache('UNDEFINED|1d', { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } });
    const invalid = { cachedAt: 2, shortTtlOnly: false, result: { id: 'new' }, toJSON: () => undefined } as any;

    expect(() => cache.writeQuoteCache('UNDEFINED|1d', invalid)).not.toThrow();
    expect(cache.readQuoteCache('UNDEFINED|1d')).toBeNull();
    expect(storage.getItem('sentinel')).toBe('keep');
  });

  it.each(['oversize', 'circular'] as const)(
    'Storage denied 期間同 key 寫入 %s 新值，恢復後舊持久化與 alias 都不復活',
    async mode => {
      const storage = switchableStorage({ sentinel: 'keep' });
      vi.stubGlobal('sessionStorage', storage);
      const cache = await import('./quoteCache');
      const oldEntry = { cachedAt: 1, shortTtlOnly: false, result: { id: 'old' } };
      cache.writeQuoteCache('DENIED|1d', oldEntry);
      cache.writeMemoryAlias('DENIED.TW|1d', oldEntry);

      storage.setDenied(true);
      if (mode === 'oversize') {
        cache.writeQuoteCache('DENIED|1d', {
          cachedAt: 2,
          shortTtlOnly: false,
          result: { id: 'new', body: 'x'.repeat(4 * 1024 * 1024 + 32) },
        });
      } else {
        const circular: any = { cachedAt: 2, shortTtlOnly: false, result: { id: 'new' } };
        circular.result.loop = circular;
        cache.writeQuoteCache('DENIED|1d', circular);
      }
      expect(cache.readQuoteCache('DENIED|1d')).toBeNull();
      expect(cache.readQuoteCache('DENIED.TW|1d')).toBeNull();

      storage.setDenied(false);
      expect(cache.readQuoteCache('DENIED|1d')).toBeNull();
      expect(cache.readQuoteCache('DENIED.TW|1d')).toBeNull();
      expect(storage.getItem('sentinel')).toBe('keep');
    },
  );
});
