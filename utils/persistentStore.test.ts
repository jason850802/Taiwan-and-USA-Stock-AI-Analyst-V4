// utils/persistentStore.test.ts — Phase 12 T2：localStorage 持久層工廠的行為鎖
//
// 兩組斷言：
//  1. 工廠本身（注入記憶體 Storage stub）——parse 守衛、quota 重試骨架、序列化不加信封。
//  2. 五把 key 的「舊格式直接可讀」＋各自的裁剪策略——fixture 均為 @36c0f41 現行 JSON 形狀字面量，
//     這組測試紅了就代表儲存格式被動到，舊使用者的資料會讀不出來。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPersistentStore } from './persistentStore';
import { loadTxns, saveTxns, type StoredTxn } from './txnStore';
import { loadImportLog, saveImportLog } from './importStore';
import { loadRealizedTrades, saveRealizedTrades, loadSnapshots, saveSnapshots } from './portfolioHistoryStore';
import { getCachedSeries, putCachedSeriesMany } from './closeSeriesCache';
import type { DailyPnlSnapshot } from '../types';

// ── 記憶體 Storage stub（failTimes：前 N 次 setItem 拋 quota 錯） ──
const makeStorage = () => {
  const map = new Map<string, string>();
  const api = {
    map,
    failTimes: 0,
    writes: [] as string[],
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => {
      if (api.failTimes > 0) {
        api.failTimes--;
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      api.writes.push(v);
      map.set(k, v);
    },
  };
  return api;
};
const asStorage = (s: ReturnType<typeof makeStorage>) => s as unknown as Storage;

describe('createPersistentStore — 讀取', () => {
  it('缺 key 回 fallback', () => {
    const st = makeStorage();
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    expect(store.load()).toEqual([]);
  });

  it('壞 JSON 回 fallback（不拋錯）', () => {
    const st = makeStorage();
    st.map.set('k', '{壞掉的 json');
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    expect(store.load()).toEqual([]);
  });

  it('decode 回 null 視同 fallback', () => {
    const st = makeStorage();
    st.map.set('k', '{"version":99}');
    const store = createPersistentStore<{ v: number }>({
      key: 'k',
      fallback: () => ({ v: 0 }),
      decode: (raw: any) => (raw?.version === 1 ? raw : null),
      storage: asStorage(st),
    });
    expect(store.load()).toEqual({ v: 0 });
  });

  it('storage 本身不可用時回 fallback', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } } as unknown as Storage;
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: broken });
    expect(store.load()).toEqual([]);
  });

  it('每次 fallback 都是新物件（呼叫端改了不會污染下一次）', () => {
    const st = makeStorage();
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    const a = store.load();
    a.push(1);
    expect(store.load()).toEqual([]);
  });
});

describe('createPersistentStore — 寫入', () => {
  it('序列化就是 JSON.stringify(value)，工廠不加任何信封', () => {
    const st = makeStorage();
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    store.save([1, 2, 3]);
    expect(st.map.get('k')).toBe('[1,2,3]');
  });

  it('裸陣列 round-trip 後仍是裸陣列', () => {
    const st = makeStorage();
    const store = createPersistentStore<{ id: string }[]>({
      key: 'portfolio_items',
      fallback: () => [],
      decode: (raw) => (Array.isArray(raw) ? (raw as { id: string }[]) : null),
      storage: asStorage(st),
    });
    store.save([{ id: 'a' }]);
    expect(st.map.get('portfolio_items')).toBe('[{"id":"a"}]');
    expect(store.load()).toEqual([{ id: 'a' }]);
  });

  it('quota 失敗 → trimForRetry 恰被呼叫一次 → 重試成功回 true', () => {
    const st = makeStorage();
    st.failTimes = 1;
    const trim = vi.fn((v: number[]) => v.slice(-1));
    const store = createPersistentStore<number[]>({
      key: 'k', fallback: () => [], trimForRetry: trim, storage: asStorage(st),
    });
    expect(store.save([1, 2, 3])).toBe(true);
    expect(trim).toHaveBeenCalledTimes(1);
    expect(st.map.get('k')).toBe('[3]');
  });

  it('重試仍失敗 → 回 false 且不拋錯', () => {
    const st = makeStorage();
    st.failTimes = 2;
    const store = createPersistentStore<number[]>({
      key: 'k', fallback: () => [], trimForRetry: (v) => v.slice(-1), storage: asStorage(st),
    });
    expect(store.save([1, 2, 3])).toBe(false);
  });

  it('沒給 trimForRetry → 不重試，直接 false', () => {
    const st = makeStorage();
    st.failTimes = 1;
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    expect(store.save([1])).toBe(false);
    expect(st.writes).toHaveLength(0);
  });

  it('trimForRetry 回 null（無可裁）→ 不重試，直接 false', () => {
    const st = makeStorage();
    st.failTimes = 1;
    const trim = vi.fn(() => null);
    const store = createPersistentStore<number[]>({
      key: 'k', fallback: () => [], trimForRetry: trim, storage: asStorage(st),
    });
    expect(store.save([1])).toBe(false);
    expect(trim).toHaveBeenCalledTimes(1);
    expect(st.writes).toHaveLength(0);
  });

  it('clear 移除該 key', () => {
    const st = makeStorage();
    const store = createPersistentStore<number[]>({ key: 'k', fallback: () => [], storage: asStorage(st) });
    store.save([1]);
    store.clear();
    expect(st.map.has('k')).toBe(false);
  });
});

// ── 各 store：舊格式直接可讀（位元組相容鐵則） ────────────────────────────
describe('舊格式相容（@36c0f41 現行 JSON 形狀字面量）', () => {
  let st: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    st = makeStorage();
    vi.stubGlobal('localStorage', asStorage(st));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('portfolio_transactions_v1 讀得出交易流水', () => {
    st.map.set('portfolio_transactions_v1', '{"version":1,"txns":[{"date":"2024-06-26","symbol":"2330.TW","name":"台積電","market":"TW","kind":"buy","shares":1000,"price":900,"gross":900000,"fee":1282,"tax":0,"source":"import","key":"k1"}]}');
    const txns = loadTxns();
    expect(txns).toHaveLength(1);
    expect(txns[0].symbol).toBe('2330.TW');
    expect(txns[0].fee).toBe(1282);
  });

  it('未知版本的交易流水 → 空陣列（原資料不動）', () => {
    const raw = '{"version":2,"txns":[{"date":"2024-06-26"}]}';
    st.map.set('portfolio_transactions_v1', raw);
    expect(loadTxns()).toEqual([]);
    expect(st.map.get('portfolio_transactions_v1')).toBe(raw);
  });

  it('portfolio_import_log_v1 讀得出鍵與批次', () => {
    st.map.set('portfolio_import_log_v1', '{"version":1,"keys":["a","b"],"batches":[{"at":1721000000000,"broker":"cathay-tw","fileName":"x.csv","count":2}]}');
    const log = loadImportLog();
    expect(log.keys).toEqual(['a', 'b']);
    expect(log.batches[0].fileName).toBe('x.csv');
  });

  it('portfolio_realized_trades_v1 / portfolio_snapshots_v1 讀得出', () => {
    st.map.set('portfolio_realized_trades_v1', '{"version":1,"trades":[{"id":"t1","symbol":"2330.TW","market":"TW","sellDate":"2025-01-02","sharesSold":1000,"sellPrice":1000,"grossProceeds":1000000,"sellFee":1425,"sellTax":3000,"costBasis":900000,"realizedPnl":95575}]}');
    st.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"date":"2024-06-26","market":"TW","source":"backfill","totalCost":900000,"marketValue":901000,"unrealizedPnl":1000,"realizedCum":0,"dividendCum":0}]}');
    expect(loadRealizedTrades()).toHaveLength(1);
    expect(loadRealizedTrades()[0].realizedPnl).toBe(95575);
    expect(loadSnapshots()).toHaveLength(1);
    expect(loadSnapshots()[0].date).toBe('2024-06-26');
  });

  it('portfolio_close_cache_v1 讀得出壓縮序列', () => {
    st.map.set('portfolio_close_cache_v1', `{"version":1,"series":{"2330.TW":{"d":["2025-01-02","2025-01-03"],"c":[1000,1010],"at":${Date.now()}}}}`);
    expect(getCachedSeries('2330.TW')).toEqual([
      { date: '2025-01-02', close: 1000 },
      { date: '2025-01-03', close: 1010 },
    ]);
  });

  it('寫出的位元組形狀與舊版一致（信封欄位順序不變）', () => {
    const txn = { date: '2024-06-26', symbol: '2330.TW', name: '台積電', market: 'TW', kind: 'buy', shares: 1000, price: 900, gross: 900000, fee: 1282, tax: 0, source: 'manual', key: 'k1' } as StoredTxn;
    saveTxns([txn]);
    expect(st.map.get('portfolio_transactions_v1')!.startsWith('{"version":1,"txns":[')).toBe(true);

    saveImportLog({ keys: ['a'], batches: [] });
    expect(st.map.get('portfolio_import_log_v1')).toBe('{"version":1,"keys":["a"],"batches":[]}');

    saveRealizedTrades([]);
    expect(st.map.get('portfolio_realized_trades_v1')).toBe('{"version":1,"trades":[]}');

    saveSnapshots([]);
    expect(st.map.get('portfolio_snapshots_v1')).toBe('{"version":1,"rows":[]}');

    putCachedSeriesMany([{ symbol: 'AAPL', bars: [{ date: '2025-01-02', close: 250 }] }]);
    const cache = JSON.parse(st.map.get('portfolio_close_cache_v1')!);
    expect(cache.version).toBe(1);
    expect(cache.series.AAPL.d).toEqual(['2025-01-02']);
    expect(cache.series.AAPL.c).toEqual([250]);
  });
});

// ── 各 store 的裁剪策略（域內策略，工廠不得代為決定） ──────────────────────
describe('quota 裁剪策略維持原樣', () => {
  let st: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    st = makeStorage();
    vi.stubGlobal('localStorage', asStorage(st));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('txnStore：不裁剪，quota 直接回 false', () => {
    st.failTimes = 5;
    expect(saveTxns([])).toBe(false);
    expect(st.map.has('portfolio_transactions_v1')).toBe(false);
  });

  it('snapshots：裁最舊 1/4 backfill，live 一列不動', () => {
    const rows: DailyPnlSnapshot[] = [];
    for (let i = 1; i <= 8; i++) {
      rows.push({ date: `2025-01-0${i}`, market: 'TW', source: 'backfill' } as DailyPnlSnapshot);
    }
    rows.push({ date: '2025-02-01', market: 'TW', source: 'live' } as DailyPnlSnapshot);
    st.failTimes = 1;
    expect(saveSnapshots(rows)).toBe(true);
    const kept = JSON.parse(st.map.get('portfolio_snapshots_v1')!).rows as DailyPnlSnapshot[];
    // 8 筆 backfill → 裁掉最舊 floor(8/4)=2 筆；live 留著
    expect(kept).toHaveLength(7);
    expect(kept.map(r => r.date)).not.toContain('2025-01-01');
    expect(kept.map(r => r.date)).not.toContain('2025-01-02');
    expect(kept.some(r => r.source === 'live')).toBe(true);
  });

  it('snapshots：全是 live 時無可裁 → 回 false（不重試）', () => {
    st.failTimes = 1;
    const rows = [{ date: '2025-02-01', market: 'TW', source: 'live' }] as DailyPnlSnapshot[];
    expect(saveSnapshots(rows)).toBe(false);
    expect(st.writes).toHaveLength(0);
  });

  it('closeSeriesCache：quota 後丟棄最舊一半', () => {
    st.failTimes = 1;
    putCachedSeriesMany([
      { symbol: 'A', bars: [{ date: '2025-01-02', close: 1 }] },
      { symbol: 'B', bars: [{ date: '2025-01-02', close: 2 }] },
      { symbol: 'C', bars: [{ date: '2025-01-02', close: 3 }] },
      { symbol: 'D', bars: [{ date: '2025-01-02', close: 4 }] },
    ]);
    const series = JSON.parse(st.map.get('portfolio_close_cache_v1')!).series;
    expect(Object.keys(series).sort()).toEqual(['C', 'D']);
  });

  it('importStore：batches 常態上限 50；quota 後只留最近半數鍵', () => {
    const batches = Array.from({ length: 60 }, (_, i) => ({ at: i, broker: 'cathayTw' as const, fileName: `f${i}`, count: 1 }));
    saveImportLog({ keys: ['a', 'b', 'c', 'd'], batches });
    expect(JSON.parse(st.map.get('portfolio_import_log_v1')!).batches).toHaveLength(50);

    st.failTimes = 1;
    expect(saveImportLog({ keys: ['a', 'b', 'c', 'd'], batches: [] })).toBe(true);
    expect(JSON.parse(st.map.get('portfolio_import_log_v1')!).keys).toEqual(['c', 'd']);
  });
});
