// utils/dividendEstimator.test.ts — 配息推算行為鎖
// 權利判定的核心：除息交易日「當天買進不享權、當天賣出仍享權」。
import { describe, it, expect } from 'vitest';
import {
  estimateDividends, sharesBefore, toDividendTxns, dividendCumUpTo,
  type DividendAnnouncement,
} from './dividendEstimator';
import { StoredTxn } from './txnStore';

const tx = (o: Partial<StoredTxn>): StoredTxn => ({
  date: '2024-01-01', symbol: 'AAA', name: 'AAA', market: 'TW', kind: 'buy',
  shares: 0, price: 0, gross: 0, fee: 0, tax: 0, source: 'import', key: Math.random().toString(), ...o,
});
const ann = (o: Partial<DividendAnnouncement>): DividendAnnouncement => ({
  stock_id: 'AAA', date: '2024-06-25', CashEarningsDistribution: 0, ...o,
});

describe('sharesBefore｜除息日權利判定', () => {
  const txns = [
    tx({ date: '2024-01-10', kind: 'buy', shares: 1000 }),
    tx({ date: '2024-06-19', kind: 'buy', shares: 500 }),   // 除息當天買進
    tx({ date: '2024-06-19', kind: 'sell', shares: 200 }),  // 除息當天賣出
    tx({ date: '2024-07-01', kind: 'sell', shares: 300 }),
  ];
  it('除息日當天的交易一律不計（當天買進不享權、當天賣出仍享權）', () => {
    expect(sharesBefore(txns, 'AAA', '2024-06-19')).toBe(1000);
  });
  it('之後的日期會納入當日之前的所有交易', () => {
    expect(sharesBefore(txns, 'AAA', '2024-06-20')).toBe(1300);   // 1000+500-200
    expect(sharesBefore(txns, 'AAA', '2024-07-02')).toBe(1000);
  });
  it('未持有回 0，不回負數', () => {
    expect(sharesBefore(txns, 'AAA', '2024-01-05')).toBe(0);
    expect(sharesBefore([tx({ date: '2024-01-01', kind: 'sell', shares: 500 })], 'AAA', '2024-02-01')).toBe(0);
  });
  it('只算指定代號', () => {
    expect(sharesBefore([...txns, tx({ symbol: 'BBB', kind: 'buy', shares: 9999 })], 'AAA', '2024-06-20')).toBe(1300);
  });
});

describe('estimateDividends', () => {
  const txns = [
    tx({ symbol: '00713', date: '2024-06-01', kind: 'buy', shares: 2000 }),
    tx({ symbol: '00713', date: '2024-08-01', kind: 'sell', shares: 1000 }),
  ];
  const anns = {
    '00713': [
      ann({ stock_id: '00713', date: '2024-06-25', CashEarningsDistribution: 1.5, CashExDividendTradingDate: '2024-06-19', CashDividendPaymentDate: '2024-07-15' }),
      ann({ stock_id: '00713', date: '2024-09-24', CashEarningsDistribution: 1.2, CashExDividendTradingDate: '2024-09-18' }),
    ],
  };

  it('依除息日當時持股計算，金額取整數元', () => {
    const { dividends } = estimateDividends(txns, anns);
    expect(dividends).toHaveLength(2);
    expect(dividends[0]).toMatchObject({ symbol: '00713', exDate: '2024-06-19', sharesHeld: 2000, perShare: 1.5, amount: 3000, payDate: '2024-07-15' });
    expect(dividends[1]).toMatchObject({ exDate: '2024-09-18', sharesHeld: 1000, perShare: 1.2, amount: 1200 });   // 已賣掉一半
  });

  it('買進之前的配息不計', () => {
    const { dividends } = estimateDividends(txns, {
      '00713': [ann({ CashEarningsDistribution: 9, CashExDividendTradingDate: '2024-01-05' })],
    });
    expect(dividends).toHaveLength(0);
  });

  it('除息時已清倉不計', () => {
    const sold = [...txns, tx({ symbol: '00713', date: '2024-09-01', kind: 'sell', shares: 1000 })];
    const { dividends } = estimateDividends(sold, anns);
    expect(dividends.map(d => d.exDate)).toEqual(['2024-06-19']);
  });

  it('現金股利為 0（純配股）不產生配息，但記入配股提醒', () => {
    const { dividends, stockDividendNotes } = estimateDividends(txns, {
      '00713': [ann({ CashEarningsDistribution: 0, StockEarningsDistribution: 0.05, StockExDividendTradingDate: '2024-07-10' })],
    });
    expect(dividends).toHaveLength(0);
    expect(stockDividendNotes[0]).toMatchObject({ symbol: '00713', exDate: '2024-07-10', perShare: 0.05, sharesHeld: 2000 });
  });

  it('缺除息交易日 → 不臆測，記入 skipped', () => {
    const { dividends, skipped } = estimateDividends(txns, {
      '00713': [ann({ CashEarningsDistribution: 1.5, CashExDividendTradingDate: '' })],
    });
    expect(dividends).toHaveLength(0);
    expect(skipped[0].reason).toContain('除息交易日');
  });

  it('從未持有的股票不計', () => {
    const { dividends } = estimateDividends(txns, {
      '9999': [ann({ stock_id: '9999', CashEarningsDistribution: 5, CashExDividendTradingDate: '2024-07-01' })],
    });
    expect(dividends).toHaveLength(0);
  });

  it('多檔依除息日排序', () => {
    const multi = [...txns, tx({ symbol: '00919', date: '2024-05-01', kind: 'buy', shares: 3000 })];
    const { dividends } = estimateDividends(multi, {
      ...anns,
      '00919': [ann({ stock_id: '00919', CashEarningsDistribution: 0.7, CashExDividendTradingDate: '2024-07-16' })],
    });
    expect(dividends.map(d => d.exDate)).toEqual(['2024-06-19', '2024-07-16', '2024-09-18']);
  });
});

describe('toDividendTxns｜冪等鍵', () => {
  it('同一檔同除息日只會有一個鍵（重複估算不重複累加）', () => {
    const list = [
      { symbol: '00713', exDate: '2024-06-19', sharesHeld: 2000, perShare: 1.5, amount: 3000 },
      { symbol: '00713', exDate: '2024-06-19', sharesHeld: 2000, perShare: 1.5, amount: 3000 },
    ];
    const out = toDividendTxns(list);
    expect(new Set(out.map(t => t.key)).size).toBe(1);
    expect(out[0]).toMatchObject({ kind: 'dividend', date: '2024-06-19', symbol: '00713', gross: 3000, fee: 0, tax: 0 });
  });
});

describe('dividendCumUpTo｜累計配息（含已清倉部位）', () => {
  const txns = [
    tx({ kind: 'dividend', symbol: 'AAA', date: '2024-06-19', gross: 3000 }),
    tx({ kind: 'dividend', symbol: 'BBB', date: '2024-09-18', gross: 1200 }),
    tx({ kind: 'sell', symbol: 'AAA', date: '2024-10-01', shares: 2000 }),   // 賣光也不影響已領股利
    tx({ kind: 'dividend', symbol: 'CCC', date: '2025-01-10', gross: 500 }),
  ];
  it('依日期累計，賣出不扣減', () => {
    expect(dividendCumUpTo(txns, 'TW', '2024-06-18')).toBe(0);
    expect(dividendCumUpTo(txns, 'TW', '2024-06-19')).toBe(3000);
    expect(dividendCumUpTo(txns, 'TW', '2024-12-31')).toBe(4200);
    expect(dividendCumUpTo(txns, 'TW', '2025-12-31')).toBe(4700);
  });
  it('市場隔離', () => {
    const us = [...txns, tx({ kind: 'dividend', market: 'US', date: '2024-06-19', gross: 10, netTwd: 320 })];
    expect(dividendCumUpTo(us, 'US', '2024-12-31')).toBe(320);   // 美股取台幣淨額
    expect(dividendCumUpTo(us, 'TW', '2024-12-31')).toBe(4200);
  });
});
