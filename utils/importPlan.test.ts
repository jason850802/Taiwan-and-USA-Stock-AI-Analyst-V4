// utils/importPlan.test.ts — Phase 11 T3：去重與匯入計畫（Case I）
import { describe, it, expect } from 'vitest';
import { ParsedTxn } from '../types';
import { buildImportPlan } from './importPlan';
import { appendImportBatch } from './importStore';

const T = 1_700_000_000_000;
const txn = (o: Partial<ParsedTxn>): ParsedTxn => ({
  broker: 'sinopac', market: 'TW', date: '2026-07-02', symbol: '2327', name: '國巨*',
  kind: 'buy', shares: 30, price: 1115, gross: 33450, fee: 47, tax: 0,
  dedupeKey: 'sinopac|Y02J1', rawLine: '', ...o,
});

describe('Case I｜去重', () => {
  const txns = [
    txn({ dedupeKey: 'sinopac|Y02J1' }),
    txn({ dedupeKey: 'sinopac|Y0735', shares: 20, price: 1070, gross: 21400, fee: 30 }),
  ];

  it('首次匯入：全部視為新交易', () => {
    const plan = buildImportPlan({ broker: 'sinopac', txns, unsupported: [], importedKeys: [], existingLots: [], now: T });
    expect(plan.txns).toHaveLength(2);
    expect(plan.skippedDuplicates).toBe(0);
    expect(plan.preview.buys).toBe(2);
    expect(plan.dateRange).toEqual({ from: '2026-07-02', to: '2026-07-02' });
  });

  it('第二次匯入同一份：全數略過、新增 0', () => {
    const plan = buildImportPlan({
      broker: 'sinopac', txns, unsupported: [],
      importedKeys: ['sinopac|Y02J1', 'sinopac|Y0735'], existingLots: [], now: T,
    });
    expect(plan.txns).toHaveLength(0);
    expect(plan.skippedDuplicates).toBe(2);
    expect(plan.preview).toEqual({ buys: 0, sells: 0, dividends: 0 });
    expect(plan.dateRange).toBeNull();
  });

  it('同一檔內若出現重複鍵也只算一次', () => {
    const plan = buildImportPlan({
      broker: 'sinopac', txns: [txns[0], txns[0]], unsupported: [], importedKeys: [], existingLots: [], now: T,
    });
    expect(plan.txns).toHaveLength(1);
    expect(plan.skippedDuplicates).toBe(1);
  });

  it('跨券商鍵不互撞（同日同股數但不同 broker 前綴）', () => {
    const plan = buildImportPlan({
      broker: 'cathay',
      txns: [txn({ broker: 'cathay', market: 'US', symbol: 'NVDA', dedupeKey: 'cathay|2026-07-02|NVDA|buy|30|1115|33450' })],
      unsupported: [], importedKeys: ['sinopac|Y02J1'], existingLots: [], now: T,
    });
    expect(plan.txns).toHaveLength(1);
    expect(plan.skippedDuplicates).toBe(0);
  });
});

describe('匯入計畫：預覽統計與缺口偵測', () => {
  it('乾跑偵測期初缺口，不落地', () => {
    const plan = buildImportPlan({
      broker: 'sinopac',
      txns: [txn({ symbol: '2484', name: '希華', kind: 'sell', date: '2026-07-03', shares: 1000, price: 91.3, gross: 91300, fee: 130, tax: 273, dedupeKey: 'sinopac|Y0477' })],
      unsupported: [], importedKeys: [], existingLots: [], now: T,
    });
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]).toMatchObject({ symbol: '2484', sharesMissing: 1000, buyDate: '2026-07-02' });
    expect(plan.preview.sells).toBe(0);   // 缺口未補 → 該賣出尚未計入
  });

  it('unsupported 原樣帶進計畫供 UI 顯示', () => {
    const plan = buildImportPlan({
      broker: 'sinopac', txns: [], unsupported: [{ rawLine: 'x', reason: '未支援的交易別「融資買」' }],
      importedKeys: [], existingLots: [], now: T,
    });
    expect(plan.unsupported[0].reason).toContain('融資買');
  });

  it('日期範圍取排序後首尾', () => {
    const plan = buildImportPlan({
      broker: 'sinopac',
      txns: [
        txn({ date: '2026-07-20', dedupeKey: 'a' }),
        txn({ date: '2026-07-02', dedupeKey: 'b' }),
        txn({ date: '2026-07-13', dedupeKey: 'c' }),
      ],
      unsupported: [], importedKeys: [], existingLots: [], now: T,
    });
    expect(plan.dateRange).toEqual({ from: '2026-07-02', to: '2026-07-20' });
    expect(plan.txns.map(t => t.date)).toEqual(['2026-07-02', '2026-07-13', '2026-07-20']);
  });
});

describe('importStore：批次追加', () => {
  it('appendImportBatch 累加鍵並記錄批次筆數', () => {
    const log = appendImportBatch({ keys: ['k1'], batches: [] }, ['k2', 'k3'], { at: T, broker: 'sinopac', fileName: 'a.xlsx' });
    expect(log.keys).toEqual(['k1', 'k2', 'k3']);
    expect(log.batches).toHaveLength(1);
    expect(log.batches[0]).toMatchObject({ broker: 'sinopac', fileName: 'a.xlsx', count: 2 });
  });
});
