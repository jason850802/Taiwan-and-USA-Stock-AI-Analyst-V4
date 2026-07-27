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
import {
  BACKUP_KEYS, buildBackup, backupFileName, serializeBackup,
  BACKUP_SCHEMA_VERSION, BACKUP_APP_ID, BackupReadError,
  parseBackupFile, applyBackup, countBackupEntries, countStorageEntries, isEmptyBackup,
  type BackupFile,
} from './portfolioBackup';
// 防漂移用：各 store 自己的 key 常數（只 import 字串常數，不 import 任何領域型別）
import { KEY as ITEMS_KEY } from './portfolioItemsStore';
import { KEY as TXNS_KEY } from './txnStore';
import { KEY as IMPORT_LOG_KEY } from './importStore';
import { TRADES_KEY, SNAPSHOTS_KEY } from './portfolioHistoryStore';
import { KEY as CLOSE_CACHE_KEY } from './closeSeriesCache';

// ── 記憶體 Storage stub（比照 utils/persistentStore.test.ts） ──
// touched／failOnKey 是票 02 加的：回灌的兩條紅線都得靠它們才驗得出來——
// 「驗證失敗時一把 key 都沒被碰過」要數寫入次數，「寫到一半失敗要全數還原」要指定哪把爆掉。
const makeStorage = () => {
  const map = new Map<string, string>();
  const api = {
    map,
    /** 被寫入或移除過的 key（依實際發生順序）；只記成功的動作 */
    touched: [] as string[],
    /** 指定某把 key 的 setItem 拋 quota 錯，模擬「寫到第 N 把才失敗」 */
    failOnKey: null as string | null,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { api.touched.push(k); map.delete(k); },
    setItem: (k: string, v: string) => {
      if (api.failOnKey === k) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      api.touched.push(k);
      map.set(k, v);
    },
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
    expect(BACKUP_KEYS).not.toContain(CLOSE_CACHE_KEY);
    expect(BACKUP_KEYS.some(k => k.startsWith('gemini_cache_v1'))).toBe(false);
  });

  it('與各 store 自己的 key 常數逐一相符（防漂移）', () => {
    // 沒有這條的話：某個 store 改了自己的 key，備份會靜默停止保護那份資料，
    // 而本檔其他斷言都拿同一批硬編字面量比對，照樣全綠。
    expect([...BACKUP_KEYS].sort()).toEqual(
      [ITEMS_KEY, TXNS_KEY, IMPORT_LOG_KEY, TRADES_KEY, SNAPSHOTS_KEY].sort(),
    );
  });
});

describe('buildBackup — 信封', () => {
  it('帶 app 識別、schema 版本與 ISO 8601 匯出時間', () => {
    const st = makeStorage();
    const file = buildBackup(asStorage(st), NOW);
    expect(file.app).toBe(BACKUP_APP_ID);
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(file.exportedAt).toBe('2026-07-27T14:05:09.000Z');
  });

  it('全空 storage → data 是空物件（不拋錯，仍可備份）', () => {
    const st = makeStorage();
    expect(buildBackup(asStorage(st), NOW).data).toEqual({});
  });

  it('沒有壞資料時不長出 unparsed 欄位（正常備份檔看不到它）', () => {
    const st = makeStorage();
    seedRealData(st);
    expect('unparsed' in buildBackup(asStorage(st), NOW)).toBe(false);
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

  it('某把 key 是壞 JSON → 原字串收進 unparsed（位元組一個不少），其餘照收', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = makeStorage();
    seedRealData(st);
    const truncated = '{"version":1,"rows":[{"date":"2024-06-26","mark';  // 寫入被截斷的樣子
    st.map.set('portfolio_snapshots_v1', truncated);

    const file = buildBackup(asStorage(st), NOW);
    // 不進 data（那裡的東西回灌時要能直接套用），但**不得消失**
    expect('portfolio_snapshots_v1' in file.data).toBe(false);
    expect(file.unparsed?.portfolio_snapshots_v1).toBe(truncated);
    expect(file.data).toHaveProperty('portfolio_items');
    expect(warn).toHaveBeenCalled();
  });

  it('storage 讀不動 → 整包放棄丟 BackupReadError，不得產出殘缺卻看起來正常的檔案', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } } as unknown as Storage;
    expect(() => buildBackup(broken, NOW)).toThrow(BackupReadError);
  });

  it('讀到一半才失敗也一樣整包放棄（不得只備份到前幾把）', () => {
    const st = makeStorage();
    seedRealData(st);
    const partial = {
      getItem: (k: string) => {
        if (k === 'portfolio_import_log_v1') throw new Error('SecurityError');
        return st.getItem(k);
      },
    } as unknown as Storage;
    expect(() => buildBackup(partial, NOW)).toThrow(BackupReadError);
  });
});

describe('serializeBackup', () => {
  it('兩空格縮排（檔案要人看得懂、可 diff），且 parse 回來與原物件相同', () => {
    const st = makeStorage();
    seedRealData(st);
    const file = buildBackup(asStorage(st), NOW);
    const text = serializeBackup(file);

    expect(text).toContain('\n  "app"');
    expect(JSON.parse(text)).toEqual(file);
  });

  it('序列化後每把 key 的值與 storage 原字串逐位元組相同（跨越序列化邊界的保真）', () => {
    const st = makeStorage();
    seedRealData(st);
    const parsed = JSON.parse(serializeBackup(buildBackup(asStorage(st), NOW)));

    for (const key of BACKUP_KEYS) {
      expect(JSON.stringify(parsed.data[key])).toBe(st.map.get(key));
    }
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

// ══ 回灌（票 02）═══════════════════════════════════════════════════════════
//
// 這組守的是保命功能的另一半：**把備份灌回去之後，storage 是不是就是備份檔**。
// 兩條紅線：
//  1. 往返鐵則——備份 → 清空 → 回灌後五把 key 逐位元組相同。紅了就是保命失效。
//  2. 驗證先於寫入且全有全無——被拒收的檔案一把 key 都不准碰（靠 stub 的 touched 數）。
// 回灌是**覆蓋式**（ADR-0001 第 3 條）：整包換掉、不合併。已實現帳本與每日快照沒有
// 去重鍵，合併會把同一筆賣出的損益算兩次，而畫面不會有任何徵兆。

/** 使用者手上那份檔案的文字（跨過序列化邊界，與他點下載拿到的位元組相同） */
const backupTextOf = (st: ReturnType<typeof makeStorage>) =>
  serializeBackup(buildBackup(asStorage(st), NOW));

/** 取出通過驗證的備份檔；驗不過就當場爆掉（fixture 自己寫錯要立刻知道） */
const parsedOf = (text: string): BackupFile => {
  const r = parseBackupFile(text);
  if (r.status !== 'ok') throw new Error(`這份 fixture 應該要能通過驗證：${r.message}`);
  return r.file;
};

/** 取出拒收理由；沒被拒收就當場爆掉 */
const rejectionOf = (text: string) => {
  const r = parseBackupFile(text);
  if (r.status === 'ok') throw new Error('這份檔案應該要被拒收');
  return r;
};

/** 信封合法、資料段任人擺布的 fixture 產生器 */
const envelope = (rest: string) =>
  `{"app":"${BACKUP_APP_ID}","schemaVersion":${BACKUP_SCHEMA_VERSION},`
  + `"exportedAt":"2026-07-27T14:05:09.000Z"${rest ? `,${rest}` : ''}}`;

describe('parseBackupFile — 驗證（先於任何寫入）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('App 自己產生的備份檔照收，信封與資料段原封不動', () => {
    const st = makeStorage();
    seedRealData(st);
    const file = parsedOf(backupTextOf(st));
    expect(file.exportedAt).toBe('2026-07-27T14:05:09.000Z');
    expect(Object.keys(file.data).sort()).toEqual([...BACKUP_KEYS].sort());
  });

  it('不是 JSON（選到圖片或別的文字檔）→ 拒收', () => {
    expect(rejectionOf('這才不是 JSON').code).toBe('not-json');
    expect(rejectionOf('').code).toBe('not-json');
  });

  it('不是本 App 產生的檔案 → 拒收（長得再像也不收）', () => {
    expect(rejectionOf('{"app":"other-app","schemaVersion":1,"data":{}}').code).toBe('not-our-file');
    expect(rejectionOf('{"schemaVersion":1,"data":{}}').code).toBe('not-our-file');   // 缺 app 識別
    expect(rejectionOf('[]').code).toBe('not-our-file');                              // 合法 JSON 但不是物件
    expect(rejectionOf('null').code).toBe('not-our-file');
    expect(rejectionOf('"字串"').code).toBe('not-our-file');
  });

  it('未知 schema 版本 → 拒收並 warn（沿用 txnStore 慣例），訊息要指向「更新 App」', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rej = rejectionOf(
      `{"app":"${BACKUP_APP_ID}","schemaVersion":${BACKUP_SCHEMA_VERSION + 1},`
      + '"exportedAt":"2026-07-27T14:05:09.000Z","data":{}}',
    );
    expect(rej.code).toBe('unknown-version');
    // 使用者要能分辨「檔案壞了」與「App 太舊」——後者去更新就救得回來
    expect(rej.message).toContain('更新');
    expect(warn).toHaveBeenCalled();
  });

  it('資料段形狀非法 → 拒收（陣列、null、原始值、缺席都不算物件）', () => {
    expect(rejectionOf(envelope('"data":[]')).code).toBe('bad-data');
    expect(rejectionOf(envelope('"data":null')).code).toBe('bad-data');
    expect(rejectionOf(envelope('"data":42')).code).toBe('bad-data');
    expect(rejectionOf(envelope('')).code).toBe('bad-data');                          // 沒有 data 段
  });

  it('unparsed 區形狀非法 → 拒收（信封任一段壞掉都不冒險去寫）', () => {
    expect(rejectionOf(envelope('"data":{},"unparsed":[]')).code).toBe('bad-data');
    expect(rejectionOf(envelope('"data":{},"unparsed":{"portfolio_items":42}')).code).toBe('bad-data');
  });

  it('exportedAt 壞掉不因此拒收——資料段完好就要讓使用者救得回來', () => {
    // 保命優先：時間欄位只影響顯示（顯示端自己退成「未知時間」）。
    // 為了一個看板欄位擋掉整份還救得回來的資料，是本末倒置。
    const r = parseBackupFile(
      `{"app":"${BACKUP_APP_ID}","schemaVersion":${BACKUP_SCHEMA_VERSION},"data":{"portfolio_items":[]}}`,
    );
    expect(r.status).toBe('ok');
  });
});

describe('applyBackup — 覆蓋式回灌', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('五把 key 全部以備份檔的內容覆蓋', () => {
    const src = makeStorage();
    seedRealData(src);
    const text = backupTextOf(src);

    const dst = makeStorage();
    dst.map.set('portfolio_items', '[]');                       // 現況與備份不同
    expect(applyBackup(asStorage(dst), text)).toEqual({ status: 'ok' });
    for (const key of BACKUP_KEYS) expect(dst.map.get(key)).toBe(src.map.get(key));
  });

  it('備份檔缺席的 key → storage 中移除，不得寫成空值', () => {
    const src = makeStorage();
    src.map.set('portfolio_items', '[]');                       // 備份當下只有這一把
    const text = backupTextOf(src);

    const dst = makeStorage();
    seedRealData(dst);                                          // 現況五把都在
    expect(applyBackup(asStorage(dst), text).status).toBe('ok');
    expect(dst.map.get('portfolio_items')).toBe('[]');
    for (const key of BACKUP_KEYS.filter(k => k !== 'portfolio_items')) {
      expect(dst.map.has(key)).toBe(false);                     // 移除，而不是留下 '[]' 或 'null'
    }
  });

  it('不碰備份範圍以外的 key（可重建資料留在原地）', () => {
    const src = makeStorage();
    seedRealData(src);
    const text = backupTextOf(src);

    const dst = makeStorage();
    dst.map.set('portfolio_close_cache_v1', '{"version":1,"series":{}}');
    dst.map.set('gemini_cache_v1|e1|fast|2026-07-27|deadbeef', '{"text":"分析內容","ts":1}');
    applyBackup(asStorage(dst), text);
    expect(dst.map.get('portfolio_close_cache_v1')).toBe('{"version":1,"series":{}}');
    expect(dst.map.has('gemini_cache_v1|e1|fast|2026-07-27|deadbeef')).toBe(true);
  });

  it('unparsed 區不套用——當初就壞掉的內容不得被灌回 storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = makeStorage();
    seedRealData(src);
    src.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"date":"2024-06-26","mark');
    const text = backupTextOf(src);
    expect(JSON.parse(text).unparsed.portfolio_snapshots_v1).toBeTruthy();

    const dst = makeStorage();
    seedRealData(dst);
    applyBackup(asStorage(dst), text);
    // 覆蓋式：備份檔的 data 段沒有這把 → 回灌後就是沒有。
    // 壞字串既不套用（灌回去 App 一樣讀不出來），也不留著現況的舊值（那就變合併了）。
    expect(dst.map.has('portfolio_snapshots_v1')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('被拒收的檔案 → 一把 key 都沒被碰過（全有全無）', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = makeStorage();
    seedRealData(st);
    const before = new Map(st.map);

    for (const bad of [
      '這才不是 JSON',
      '{"app":"other-app","schemaVersion":1,"data":{}}',
      envelope('"data":[]'),
      `{"app":"${BACKUP_APP_ID}","schemaVersion":99,"exportedAt":"2026-07-27T14:05:09.000Z","data":{}}`,
    ]) {
      expect(applyBackup(asStorage(st), bad).status).toBe('rejected');
    }
    expect(st.touched).toEqual([]);            // setItem／removeItem 一次都沒發生
    expect(st.map).toEqual(before);
  });

  it('寫到一半 quota 爆掉 → 回報失敗，且已寫入的 key 全數還原（不留半殘狀態）', () => {
    const src = makeStorage();
    src.map.set('portfolio_items', '[{"id":"lot-9"}]');
    src.map.set('portfolio_transactions_v1', '{"version":1,"txns":[]}');
    src.map.set('portfolio_realized_trades_v1', '{"version":1,"trades":[]}');
    const text = backupTextOf(src);

    const dst = makeStorage();
    seedRealData(dst);
    const before = new Map(dst.map);
    dst.failOnKey = 'portfolio_realized_trades_v1';            // 前面幾把寫得進去，這把爆

    const r = applyBackup(asStorage(dst), text);
    if (r.status === 'ok') throw new Error('quota 爆掉時不該回報成功');
    expect(r.code).toBe('write-failed');
    expect(r.message).toContain('空間');                        // 不得靜默；要讓使用者知道去清空間
    // 五把 key 全數回到回灌前的位元組——半殘的庫存比回灌失敗更糟
    for (const key of BACKUP_KEYS) expect(dst.map.get(key)).toBe(before.get(key));
    expect(dst.map).toEqual(before);
  });

  it('storage 讀不動時直接放棄，不寫任何東西（連現況都讀不到就沒有退路）', () => {
    const src = makeStorage();
    seedRealData(src);
    const text = backupTextOf(src);
    const writes: string[] = [];
    const broken = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: (k: string) => { writes.push(k); },
      removeItem: (k: string) => { writes.push(k); },
    } as unknown as Storage;

    expect(applyBackup(broken, text).status).toBe('rejected');
    expect(writes).toEqual([]);
  });
});

describe('往返鐵則 — 備份 → 清空 → 回灌', () => {
  it('五把 key 逐位元組相同（這條紅了就是保命失效）', () => {
    const st = makeStorage();
    seedRealData(st);
    st.map.set('portfolio_close_cache_v1', '{"version":1,"series":{}}');   // 可重建資料也在場
    const before = new Map(st.map);

    const text = backupTextOf(st);        // 使用者下載的那份檔案
    st.map.clear();                       // 清瀏覽器資料／換一台新電腦

    expect(applyBackup(asStorage(st), text).status).toBe('ok');
    for (const key of BACKUP_KEYS) expect(st.map.get(key)).toBe(before.get(key));
    // 可重建資料不進備份，所以回灌後它不會回來——這是刻意的（曲線頁自己重抓）
    expect(st.map.has('portfolio_close_cache_v1')).toBe(false);
  });

  it('回灌兩次結果相同（重複回灌不累積、不長出東西）', () => {
    const st = makeStorage();
    seedRealData(st);
    const text = backupTextOf(st);
    applyBackup(asStorage(st), text);
    const once = new Map(st.map);
    applyBackup(asStorage(st), text);
    expect(st.map).toEqual(once);
  });
});

describe('筆數統計 — 確認框的對照數字', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('五把 key 的真實 fixture 回報正確筆數', () => {
    const st = makeStorage();
    seedRealData(st);
    // 每把刻意給不同筆數——全部都是 1 的話，數錯欄位也照樣綠
    st.map.set('portfolio_items', '[{"id":"a"},{"id":"b"}]');
    st.map.set('portfolio_transactions_v1', '{"version":1,"txns":[{"key":"1"},{"key":"2"},{"key":"3"}]}');
    st.map.set('portfolio_import_log_v1', '{"version":1,"keys":["a","b","c","d"],"batches":[{"at":1}]}');
    st.map.set('portfolio_realized_trades_v1', '{"version":1,"trades":[{"id":"1"},{"id":"2"},{"id":"3"},{"id":"4"},{"id":"5"}]}');
    st.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"d":1},{"d":2},{"d":3},{"d":4},{"d":5},{"d":6}]}');

    expect(countStorageEntries(asStorage(st))).toEqual({
      portfolio_items: 2,
      portfolio_transactions_v1: 3,
      portfolio_import_log_v1: 4,
      portfolio_realized_trades_v1: 5,
      portfolio_snapshots_v1: 6,
    });
  });

  it('缺席的 key 回報 0（確實就是零筆，不是不明）', () => {
    const st = makeStorage();
    expect(countStorageEntries(asStorage(st)).portfolio_items).toBe(0);
  });

  it('形狀怪異或壞 JSON 的 key 回報「不明」而不拋錯（也不謊報 0）', () => {
    const st = makeStorage();
    seedRealData(st);
    st.map.set('portfolio_items', '{"version":1,"items":[]}');          // 有人硬加了信封
    st.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"da');  // 寫入被截斷
    const counts = countStorageEntries(asStorage(st));
    expect(counts.portfolio_items).toBeNull();
    expect(counts.portfolio_snapshots_v1).toBeNull();
    expect(counts.portfolio_transactions_v1).toBe(1);                   // 其餘照數
  });

  it('storage 讀不動時不拋錯（確認框仍畫得出來）', () => {
    const broken = { getItem: () => { throw new Error('SecurityError'); } } as unknown as Storage;
    expect(() => countStorageEntries(broken)).not.toThrow();
  });

  it('備份檔的筆數從 data 段算；當初壞掉的 key 算「不明」而非 0', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = makeStorage();
    seedRealData(st);
    st.map.set('portfolio_snapshots_v1', '{"version":1,"rows":[{"date":"2024-06-26","mark');
    const counts = countBackupEntries(parsedOf(backupTextOf(st)));
    expect(counts.portfolio_items).toBe(1);
    // 檔案裡有這把（在 unparsed 區）但回灌不會還原它，報 0 會讓使用者以為當初就沒資料
    expect(counts.portfolio_snapshots_v1).toBeNull();
  });
});

describe('isEmptyBackup — 全新使用者不下載空的預備份', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('五把 key 全缺席 → 是空備份（跳過預備份，不塞垃圾檔）', () => {
    const st = makeStorage();
    expect(isEmptyBackup(buildBackup(asStorage(st), NOW))).toBe(true);
  });

  it('任一把 key 有東西（哪怕是空陣列）→ 不算空', () => {
    const st = makeStorage();
    st.map.set('portfolio_items', '[]');
    expect(isEmptyBackup(buildBackup(asStorage(st), NOW))).toBe(false);
  });

  it('只有壞掉的 key 也不算空——那正是最需要留副本的情況', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = makeStorage();
    st.map.set('portfolio_items', '[{"id":"lot-1"');
    expect(isEmptyBackup(buildBackup(asStorage(st), NOW))).toBe(false);
  });
});
