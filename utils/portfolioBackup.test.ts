// utils/portfolioBackup.test.ts — 庫存備份的行為鎖（票 01）
//
// 這組測試守的是保命功能的第一半：**備份檔裡到底有沒有你的東西**。
// 只測外部行為——給定 storage 的某個狀態，備份出來的內容是什麼。
// 不斷言模組內部怎麼迭代 key。
//
// 三件最要緊的事：
//  1. 五把本體資料 key 全部收得進去（漏一把＝那部分資料沒被保護，而且沒人會發現）。
//  2. 可重建資料（收盤價快取、AI 分析快取）不進備份——備份檔裡每個位元組都該是救不回來的。
//  3. 缺席的 key 在檔案裡就是缺席，不得長出 null／空值——回灌時「該移除就移除」靠這個語意。
//
// Storage stub 與斷言風格沿用 utils/persistentStore.test.ts，不另創寫法。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BACKUP_KEYS, buildBackup, backupFileName, BACKUP_SCHEMA, BACKUP_APP_ID } from './portfolioBackup';

// ── 記憶體 Storage stub（比照 utils/persistentStore.test.ts） ──
const makeStorage = () => {
  const map = new Map<string, string>();
  const api = {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  return api;
};
const asStorage = (s: ReturnType<typeof makeStorage>) => s as unknown as Storage;

/** 五把本體 key 的真實形狀字面量（@e465daa 現行格式） */
const seedRealData = (st: ReturnType<typeof makeStorage>) => {
  st.map.set('portfolio_items', '[{"id":"lot-1","symbol":"2330.TW","avgCostPrice":900,"totalShares":1000,"totalCost":901282,"brokerDiscount":2.8,"cashDividends":0,"stockDividends":0}]');
  st.map.set('portfolio_transactions_v1', '{"version":1,"txns":[{"date":"2024-06-26","symbol":"2330.TW","name":"台積電","market":"TW","kind":"buy","shares":1000,"price":900,"gross":900000,"fee":1282,"tax":0,"source":"import","key":"k1"}]}');
  st.map.set('portfolio_import_log_v1', '{"version":1,"keys":["k1"],"batches":[{"at":1721000000000,"broker":"cathay-tw","fileName":"x.csv","count":1}]}');
  st.map.set('portfolio_realized_trades_v1', '{"version":1,"trades":[{"id":"t1","symbol":"2330.TW","market":"TW","sellDate":"2025-01-02","sharesSold":1000,"sellPrice":1000,"grossProceeds":1000000,"sellFee":1425,"sellTax":3000,"costBasis":900000,"realizedPnl":95575}]}');
  st.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"date":"2024-06-26","market":"TW","source":"backfill","totalCost":900000,"marketValue":901000,"unrealizedPnl":1000,"realizedCum":0,"dividendCum":0}]}');
};

const NOW = new Date('2026-07-27T14:05:09.000Z');

describe('BACKUP_KEYS — 本體資料清單', () => {
  it('恰好是五把本體 key', () => {
    expect([...BACKUP_KEYS].sort()).toEqual([
      'portfolio_import_log_v1',
      'portfolio_items',
      'portfolio_realized_trades_v1',
      'portfolio_snapshots_v1',
      'portfolio_transactions_v1',
    ]);
  });

  it('不含可重建資料（收盤價快取、AI 分析快取）', () => {
    expect(BACKUP_KEYS).not.toContain('portfolio_close_cache_v1');
    expect(BACKUP_KEYS.some(k => k.startsWith('gemini_cache_v1'))).toBe(false);
  });
});

describe('buildBackup — 信封', () => {
  it('帶 app 識別、schema 版本與 ISO 8601 匯出時間', () => {
    const st = makeStorage();
    const file = buildBackup(asStorage(st), NOW);
    expect(file.app).toBe(BACKUP_APP_ID);
    expect(file.schema).toBe(BACKUP_SCHEMA);
    expect(file.exportedAt).toBe('2026-07-27T14:05:09.000Z');
  });

  it('全空 storage → data 是空物件（不拋錯，仍可備份）', () => {
    const st = makeStorage();
    expect(buildBackup(asStorage(st), NOW).data).toEqual({});
  });
});

describe('buildBackup — 備份範圍', () => {
  it('五把本體 key 全部收得進去，值是解析後的 JSON（非字串）', () => {
    const st = makeStorage();
    seedRealData(st);
    const { data } = buildBackup(asStorage(st), NOW);

    expect(Object.keys(data).sort()).toEqual([...BACKUP_KEYS].sort());
    // 值必須是結構化資料，不是被轉義的字串——檔案要人看得懂、可 diff
    expect(Array.isArray(data.portfolio_items)).toBe(true);
    expect((data.portfolio_items as any[])[0].symbol).toBe('2330.TW');
    expect((data.portfolio_transactions_v1 as any).txns[0].fee).toBe(1282);
    expect((data.portfolio_realized_trades_v1 as any).trades[0].realizedPnl).toBe(95575);
    expect((data.portfolio_import_log_v1 as any).keys).toEqual(['k1']);
    expect((data.portfolio_snapshots_v1 as any).rows[0].date).toBe('2024-06-26');
  });

  it('可重建資料不進備份（storage 裡有也不收）', () => {
    const st = makeStorage();
    seedRealData(st);
    st.map.set('portfolio_close_cache_v1', '{"version":1,"series":{"2330.TW":{"d":["2025-01-02"],"c":[1000],"at":1}}}');
    st.map.set('gemini_cache_v1|e1|fast|2026-07-27|deadbeef', '{"text":"分析內容","ts":1}');

    const { data } = buildBackup(asStorage(st), NOW);
    expect(data).not.toHaveProperty('portfolio_close_cache_v1');
    expect(Object.keys(data).some(k => k.startsWith('gemini_cache_v1'))).toBe(false);
  });

  it('缺席的 key 在檔案裡就是缺席（不得長出 null 或空值）', () => {
    const st = makeStorage();
    st.map.set('portfolio_items', '[]');
    const { data } = buildBackup(asStorage(st), NOW);

    expect(Object.keys(data)).toEqual(['portfolio_items']);
    expect('portfolio_snapshots_v1' in data).toBe(false);
    expect(data.portfolio_snapshots_v1).toBeUndefined();
  });

  it('往返保真：備份的值再 stringify 後與 storage 原字串逐位元組相同', () => {
    const st = makeStorage();
    seedRealData(st);
    const { data } = buildBackup(asStorage(st), NOW);

    for (const key of BACKUP_KEYS) {
      expect(JSON.stringify(data[key])).toBe(st.map.get(key));
    }
  });
});

describe('buildBackup — 壞資料與不可用 storage', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('某把 key 是壞 JSON → 略過該把並警告，其餘照收（不拋錯）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = makeStorage();
    seedRealData(st);
    st.map.set('portfolio_snapshots_v1', '{壞掉的 json');

    const { data } = buildBackup(asStorage(st), NOW);
    expect('portfolio_snapshots_v1' in data).toBe(false);
    expect(data).toHaveProperty('portfolio_items');
    expect(warn).toHaveBeenCalled();
  });

  it('storage 本身不可用 → 回空 data，不拋錯', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } } as unknown as Storage;
    expect(() => buildBackup(broken, NOW)).not.toThrow();
    expect(buildBackup(broken, NOW).data).toEqual({});
  });
});

describe('backupFileName', () => {
  it('帶日期時間，可依檔名直接排序', () => {
    const early = backupFileName(new Date('2026-07-27T01:02:03.000Z'));
    const later = backupFileName(new Date('2026-12-31T23:59:00.000Z'));
    expect(early < later).toBe(true);
    expect(early.endsWith('.json')).toBe(true);
    // 檔名不得含 Windows 禁用字元（`:` 是 ISO 時間的預設分隔符，最容易踩）
    expect(/[\\/:*?"<>|]/.test(early)).toBe(false);
  });
});
