import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioItem } from '../../types';

const hookRuntime = vi.hoisted(() => {
  interface Slot {
    kind: 'state' | 'ref' | 'callback' | 'effect';
    value?: unknown;
    set?: (value: unknown) => void;
    deps?: unknown[];
    cleanup?: () => void;
    effect?: () => void | (() => void);
  }

  let slots: Slot[] = [];
  let cursor = 0;
  let layoutPending: number[] = [];
  let effectPending: number[] = [];

  const sameDeps = (a?: unknown[], b?: unknown[]) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  const useState = <T,>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] => {
    const index = cursor++;
    if (!slots[index]) {
      const slot: Slot = {
        kind: 'state',
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
      };
      slot.set = (next: unknown) => {
        slot.value = typeof next === 'function'
          ? (next as (prev: T) => T)(slot.value as T)
          : next;
      };
      slots[index] = slot;
    }
    const slot = slots[index];
    return [slot.value as T, slot.set as (value: T | ((prev: T) => T)) => void];
  };

  const useRef = <T,>(initial: T) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initial } };
    return slots[index].value as { current: T };
  };

  const useCallback = <T extends (...args: any[]) => any>(callback: T, deps: unknown[]): T => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || !sameDeps(previous.deps, deps)) {
      slots[index] = { kind: 'callback', value: callback, deps };
    }
    return slots[index].value as T;
  };

  const registerEffect = (
    effect: () => void | (() => void),
    deps: unknown[] | undefined,
    pending: number[],
  ) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && deps && sameDeps(previous.deps, deps)) return;
    previous?.cleanup?.();
    slots[index] = { kind: 'effect', deps, effect };
    pending.push(index);
  };

  const flushEffects = (pending: number[]) => {
    for (const index of pending.splice(0)) {
      const slot = slots[index];
      const cleanup = slot.effect?.();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  };

  return {
    useState,
    useRef,
    useCallback,
    useLayoutEffect: (effect: () => void | (() => void), deps?: unknown[]) =>
      registerEffect(effect, deps, layoutPending),
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) =>
      registerEffect(effect, deps, effectPending),
    render<T>(hook: () => T): T {
      cursor = 0;
      layoutPending = [];
      effectPending = [];
      const value = hook();
      flushEffects(layoutPending);
      flushEffects(effectPending);
      return value;
    },
    reset() {
      for (const slot of slots) slot?.cleanup?.();
      slots = [];
      cursor = 0;
      layoutPending = [];
      effectPending = [];
    },
  };
});

const yahoo = vi.hoisted(() => ({
  getLatestPrice: vi.fn(),
  getLatestPriceName: vi.fn(),
  patchLatestPriceName: vi.fn(),
  peekLatestPrice: vi.fn(),
}));

const history = vi.hoisted(() => ({
  computeLiveSnapshot: vi.fn(),
  upsertSnapshots: vi.fn(),
}));

const historyStore = vi.hoisted(() => ({
  loadSnapshots: vi.fn(),
  saveSnapshots: vi.fn(),
}));

vi.mock('react', () => ({
  useState: hookRuntime.useState,
  useRef: hookRuntime.useRef,
  useCallback: hookRuntime.useCallback,
  useLayoutEffect: hookRuntime.useLayoutEffect,
  useEffect: hookRuntime.useEffect,
}));

vi.mock('../../services/yahoo', () => yahoo);
vi.mock('../../utils/portfolioHistory', () => history);
vi.mock('../../utils/portfolioHistoryStore', () => historyStore);

import { useDailySnapshot } from './useDailySnapshot';
import { useHoldingPrices } from './useHoldingPrices';

const twItem = {
  id: 'tw-1',
  symbol: '2330.TW',
  totalShares: 1,
  avgCostPrice: 100,
  totalCost: 100,
  cashDividends: 0,
  stockDividends: 0,
} as PortfolioItem;

const usItems = Array.from({ length: 5 }, (_, index) => ({
  id: `us-${index}`,
  symbol: `PERF${index + 1}`,
  totalShares: 1,
  avgCostPrice: 100,
  totalCost: 100,
  cashDividends: 0,
  stockDividends: 0,
})) as PortfolioItem[];

const flushAsync = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};

describe('庫存 hook 延遲資料回填', () => {
  beforeEach(() => {
    hookRuntime.reset();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('名稱仍在途時的一般快取讀取不會吃掉稍後到貨的台股名稱', async () => {
    const name = deferred<string | null>();
    let cache: { price: number; name: string; date: string; fetchedAt: number } | null = null;
    yahoo.peekLatestPrice.mockImplementation(() => cache);
    yahoo.getLatestPrice.mockImplementation(async () => {
      cache = { price: 100, name: '2330.TW', date: '2026-09-22', fetchedAt: 1000 };
      return { ...cache };
    });
    yahoo.getLatestPriceName.mockReturnValue(name.promise);
    yahoo.patchLatestPriceName.mockImplementation((_symbol, fetchedAt, nextName) => {
      if (!cache || cache.fetchedAt !== fetchedAt) return false;
      cache = { ...cache, name: nextName };
      return true;
    });

    let result = hookRuntime.render(() => useHoldingPrices([twItem]));
    await flushAsync();
    result = hookRuntime.render(() => useHoldingPrices([twItem]));
    expect(result.prices['2330.TW']?.name).toBe('2330.TW');
    expect(yahoo.getLatestPriceName).toHaveBeenCalledTimes(1);

    result.fetchAllPrices();
    await flushAsync();
    expect(yahoo.getLatestPrice).toHaveBeenCalledTimes(1);

    name.resolve('台積電');
    await flushAsync();
    result = hookRuntime.render(() => useHoldingPrices([twItem]));
    expect(result.prices['2330.TW']).toMatchObject({ price: 100, name: '台積電', fetchedAt: 1000 });
  });

  it('多檔美股首批三槽會包含匯率請求', async () => {
    const gate = deferred<void>();
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    yahoo.peekLatestPrice.mockReturnValue(null);
    yahoo.getLatestPrice.mockImplementation(async symbol => {
      started.push(symbol);
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      return { price: 100, name: symbol, date: '2026-09-22', fetchedAt: 1000 };
    });

    hookRuntime.render(() => useHoldingPrices(usItems));
    await flushAsync();

    expect(started).toHaveLength(3);
    expect(started).toContain('USDTWD=X');
    expect(peak).toBe(3);

    gate.resolve();
    await flushAsync();
    expect(started).toHaveLength(6);
  });

  it('台股在名稱在途時移除再加入，仍會安全取得名稱且保留同代報價', async () => {
    const name = deferred<string | null>();
    let cache: { price: number; name: string; date: string; fetchedAt: number } | null = null;
    yahoo.peekLatestPrice.mockImplementation(() => cache);
    yahoo.getLatestPrice.mockImplementation(async () => {
      cache = { price: 100, name: '2330.TW', date: '2026-09-22', fetchedAt: 1000 };
      return { ...cache };
    });
    // 模擬服務層同代碼 in-flight dedupe：重新掛接名稱請求仍共用同一個網路結果。
    yahoo.getLatestPriceName.mockReturnValue(name.promise);
    yahoo.patchLatestPriceName.mockImplementation((_symbol, fetchedAt, nextName) => {
      if (!cache || cache.fetchedAt !== fetchedAt) return false;
      cache = { ...cache, name: nextName };
      return true;
    });

    hookRuntime.render(() => useHoldingPrices([twItem]));
    await flushAsync();
    hookRuntime.render(() => useHoldingPrices([]));
    await flushAsync();
    let result = hookRuntime.render(() => useHoldingPrices([twItem]));
    await flushAsync();
    result = hookRuntime.render(() => useHoldingPrices([twItem]));
    expect(result.prices['2330.TW']).toMatchObject({ price: 100, name: '2330.TW', fetchedAt: 1000 });
    expect(yahoo.getLatestPrice).toHaveBeenCalledTimes(1);

    name.resolve('台積電');
    await flushAsync();
    result = hookRuntime.render(() => useHoldingPrices([twItem]));
    expect(result.prices['2330.TW']).toMatchObject({ price: 100, name: '台積電', fetchedAt: 1000 });
  });
});

describe('每日快照觸發條件', () => {
  beforeEach(() => {
    hookRuntime.reset();
    vi.clearAllMocks();
    vi.useFakeTimers();
    history.computeLiveSnapshot.mockImplementation((market, lots) => lots.length ? {
      date: '2026-09-22',
      market,
      source: 'live',
      marketValue: 100,
      totalCost: 100,
      estSellCosts: 0,
      cashDividends: 0,
      symbolCount: 1,
      capturedAt: Date.now(),
    } : null);
    history.upsertSnapshots.mockImplementation((_old, incoming) => incoming);
    historyStore.loadSnapshots.mockReturnValue([]);
    historyStore.saveSnapshots.mockReturnValue(true);
  });

  it('台股名稱單獨晚到不會再持久化一次快照，價格變更仍會', async () => {
    const items = [twItem];
    const original = {
      '2330.TW': { price: 100, name: '2330.TW', loading: false, error: false, date: '2026-09-22', fetchedAt: 1000 },
    };
    hookRuntime.render(() => useDailySnapshot(items, original, 0));
    vi.advanceTimersByTime(800);
    await flushAsync();
    expect(historyStore.saveSnapshots).toHaveBeenCalledTimes(1);

    const nameOnly = {
      '2330.TW': { ...original['2330.TW'], name: '台積電' },
    };
    hookRuntime.render(() => useDailySnapshot(items, nameOnly, 0));
    vi.advanceTimersByTime(800);
    await flushAsync();
    expect(historyStore.saveSnapshots).toHaveBeenCalledTimes(1);

    const refreshedSameQuote = {
      '2330.TW': { ...nameOnly['2330.TW'], fetchedAt: 2000 },
    };
    hookRuntime.render(() => useDailySnapshot(items, refreshedSameQuote, 0));
    vi.advanceTimersByTime(800);
    await flushAsync();
    expect(historyStore.saveSnapshots).toHaveBeenCalledTimes(2);

    const priceChanged = {
      '2330.TW': { ...refreshedSameQuote['2330.TW'], price: 101 },
    };
    hookRuntime.render(() => useDailySnapshot(items, priceChanged, 0));
    vi.advanceTimersByTime(800);
    await flushAsync();
    expect(historyStore.saveSnapshots).toHaveBeenCalledTimes(3);
  });
});
