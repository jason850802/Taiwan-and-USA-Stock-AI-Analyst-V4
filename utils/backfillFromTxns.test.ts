// utils/backfillFromTxns.test.ts — 流水式回推行為鎖
// 重點：已完全清倉的部位，其持有期間必須出現在歷史曲線上（舊的 lot 逆推做不到）。
import { describe, it, expect } from 'vitest';
import { buildBackfillFromTxns, buildChartSeries, TxnForBackfill } from './portfolioHistory';
import { DailyPnlSnapshot, RealizedTrade } from '../types';

const T = 1_700_000_000_000;
const series = (arr: [string, number][]) => arr.map(([date, close]) => ({ date, close }));

describe('buildBackfillFromTxns｜已清倉部位重建（核心修正）', () => {
  // 甲股：01/02 買 1000@10 → 01/05 全賣 @12（之後不再持有）
  const txns: TxnForBackfill[] = [
    { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 1000, gross: 10000, fee: 14, tax: 0 },
    { date: '2026-01-05', symbol: 'AAA', market: 'TW', kind: 'sell', shares: 1000, gross: 12000, fee: 17, tax: 36 },
  ];
  const closeSeries = {
    AAA: series([['2026-01-02', 10], ['2026-01-03', 11], ['2026-01-06', 13], ['2026-01-07', 14]]),
  };
  const rows = buildBackfillFromTxns({ market: 'TW', txns, closeSeries, capturedAt: T });

  it('買進日到賣出日之間有快照（清倉前的持有期間不缺席）', () => {
    const dates = rows.map(r => r.date);
    expect(dates).toContain('2026-01-02');
    expect(dates).toContain('2026-01-03');
  });

  it('持有期間市值＝當日收盤×股數、成本含買費', () => {
    const d3 = rows.find(r => r.date === '2026-01-03')!;
    expect(d3.marketValue).toBe(11000);
    expect(d3.totalCost).toBe(10014);
    expect(d3.symbolCount).toBe(1);
  });

  it('賣出當日起不再計入市值（清倉後從曲線消失）', () => {
    expect(rows.find(r => r.date === '2026-01-06')).toBeUndefined();
    expect(rows.find(r => r.date === '2026-01-07')).toBeUndefined();
    const d5 = rows.find(r => r.date === '2026-01-05');
    expect(d5).toBeUndefined();   // 當日已全數賣出 → 無持股
  });
});

describe('buildBackfillFromTxns｜多檔進出與部分賣出', () => {
  const txns: TxnForBackfill[] = [
    { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 1000, gross: 10000, fee: 14, tax: 0 },
    { date: '2026-01-03', symbol: 'BBB', market: 'TW', kind: 'buy', shares: 500, gross: 25000, fee: 35, tax: 0 },
    { date: '2026-01-06', symbol: 'AAA', market: 'TW', kind: 'sell', shares: 400, gross: 5200, fee: 7, tax: 15 },
  ];
  const closeSeries = {
    AAA: series([['2026-01-02', 10], ['2026-01-03', 11], ['2026-01-06', 13], ['2026-01-07', 12]]),
    BBB: series([['2026-01-03', 50], ['2026-01-06', 52], ['2026-01-07', 51]]),
  };
  const rows = buildBackfillFromTxns({ market: 'TW', txns, closeSeries, capturedAt: T });

  it('日期軸為各檔行情聯集，檔數逐日正確', () => {
    expect(rows.map(r => r.date)).toEqual(['2026-01-02', '2026-01-03', '2026-01-06', '2026-01-07']);
    expect(rows.map(r => r.symbolCount)).toEqual([1, 2, 2, 2]);
  });

  it('部分賣出後剩餘股數與等比成本正確', () => {
    const d7 = rows.find(r => r.date === '2026-01-07')!;
    // AAA 剩 600 股 @12 = 7200；BBB 500 股 @51 = 25500
    expect(d7.marketValue).toBe(32700);
    // AAA 成本 10014×0.6 = 6008.4；BBB 25035
    expect(d7.totalCost).toBeCloseTo(6008.4 + 25035, 2);
  });

  it('FIFO：多批買進時先進先出', () => {
    const multi: TxnForBackfill[] = [
      { date: '2026-01-02', symbol: 'CCC', market: 'TW', kind: 'buy', shares: 100, gross: 1000, fee: 1, tax: 0 },
      { date: '2026-01-03', symbol: 'CCC', market: 'TW', kind: 'buy', shares: 100, gross: 2000, fee: 2, tax: 0 },
      { date: '2026-01-06', symbol: 'CCC', market: 'TW', kind: 'sell', shares: 100, gross: 1500, fee: 2, tax: 4 },
    ];
    const r = buildBackfillFromTxns({
      market: 'TW', txns: multi,
      closeSeries: { CCC: series([['2026-01-02', 10], ['2026-01-03', 20], ['2026-01-06', 15]]) },
      capturedAt: T,
    });
    const last = r[r.length - 1];
    expect(last.date).toBe('2026-01-06');
    expect(last.totalCost).toBe(2002);   // 第一批（1001）先出，剩第二批 2002
  });
});

describe('buildBackfillFromTxns｜配息與邊界', () => {
  it('配息不掛在持股上（Phase 11 語意）：快照 cashDividends 保持 0，由圖表以流水累計計入已實現側', () => {
    // 理由：已入袋的現金不該因為之後賣股而消失。舊做法把配息加到 lot，
    // 賣出時等比扣減、清倉後歸零，導致已清倉部位的歷史配息憑空不見。
    const txns: TxnForBackfill[] = [
      { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 1000, gross: 10000, fee: 14, tax: 0 },
      { date: '2026-01-03', symbol: 'AAA', market: 'TW', kind: 'dividend', shares: 1000, gross: 500, fee: 0, tax: 0, divAmount: 500 },
    ];
    const rows = buildBackfillFromTxns({
      market: 'TW', txns,
      closeSeries: { AAA: series([['2026-01-02', 10], ['2026-01-03', 11]]) },
      capturedAt: T,
    });
    expect(rows.find(r => r.date === '2026-01-03')!.cashDividends).toBe(0);
    expect(rows.find(r => r.date === '2026-01-03')!.marketValue).toBe(11000);   // 配息不影響市值
  });

  it('boundaryDate 之後不產出（live 快照優先）', () => {
    const txns: TxnForBackfill[] = [
      { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 100, gross: 1000, fee: 1, tax: 0 },
    ];
    const rows = buildBackfillFromTxns({
      market: 'TW', txns,
      closeSeries: { AAA: series([['2026-01-02', 10], ['2026-01-03', 11], ['2026-01-06', 12]]) },
      boundaryDate: '2026-01-06', capturedAt: T,
    });
    expect(rows.map(r => r.date)).toEqual(['2026-01-02', '2026-01-03']);
  });

  it('賣超（期初部位缺口）不產生負部位', () => {
    const txns: TxnForBackfill[] = [
      { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 100, gross: 1000, fee: 1, tax: 0 },
      { date: '2026-01-03', symbol: 'AAA', market: 'TW', kind: 'sell', shares: 150, gross: 1650, fee: 2, tax: 4 },
    ];
    const rows = buildBackfillFromTxns({
      market: 'TW', txns,
      closeSeries: { AAA: series([['2026-01-02', 10], ['2026-01-03', 11], ['2026-01-06', 12]]) },
      capturedAt: T,
    });
    expect(rows.every(r => r.marketValue >= 0 && r.totalCost >= 0)).toBe(true);
    expect(rows.find(r => r.date === '2026-01-06')).toBeUndefined();
  });

  it('空流水回空陣列', () => {
    expect(buildBackfillFromTxns({ market: 'TW', txns: [], closeSeries: {}, capturedAt: T })).toEqual([]);
  });
});

describe('與已實現線合成：完整歷史', () => {
  it('清倉部位的未實現在持有期間有值，賣出後由已實現線接手', () => {
    const txns: TxnForBackfill[] = [
      { date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 1000, gross: 10000, fee: 14, tax: 0 },
      { date: '2026-01-06', symbol: 'AAA', market: 'TW', kind: 'sell', shares: 1000, gross: 13000, fee: 18, tax: 39 },
      { date: '2026-01-06', symbol: 'BBB', market: 'TW', kind: 'buy', shares: 100, gross: 5000, fee: 7, tax: 0 },
    ];
    const rows = buildBackfillFromTxns({
      market: 'TW', txns,
      closeSeries: {
        AAA: series([['2026-01-02', 10], ['2026-01-03', 12], ['2026-01-06', 13]]),
        BBB: series([['2026-01-06', 50], ['2026-01-07', 55]]),
      },
      capturedAt: T,
    });
    const trades: RealizedTrade[] = [{
      id: 't1', lotId: 'l1', symbol: 'AAA', market: 'TW', sellDate: '2026-01-06',
      sharesSold: 1000, sellPrice: 13, grossProceeds: 13000, sellFee: 18, sellTax: 39,
      costBasis: 10014, realizedPnl: 2929, divCarried: 0, currency: 'TWD', createdAt: T,
    }];
    const pts = buildChartSeries(rows as DailyPnlSnapshot[], trades, 'TW', false);

    const d3 = pts.find(p => p.date === '2026-01-03')!;
    expect(d3.unrealized).toBeGreaterThan(0);      // 持有期間有未實現損益
    expect(d3.realizedCum).toBe(0);

    const d6 = pts.find(p => p.date === '2026-01-06')!;
    expect(d6.realizedCum).toBe(2929);             // 賣出日已實現接手
    expect(d6.total).toBeCloseTo(d6.unrealized + 2929, 6);
  });
});

describe('buildBackfillFromTxns｜美股台幣口徑', () => {
  // NVDA：03/03 買 5@179（費 0.72）匯率 31.77 → 台幣成本 (895+0.72)×31.77 = 28,467.02
  const txns: TxnForBackfill[] = [
    { date: '2026-03-03', symbol: 'NVDA', market: 'US', kind: 'buy', shares: 5, gross: 895, fee: 0.72, tax: 0, exchangeRate: 31.77 },
  ];
  const closeSeries = { NVDA: series([['2026-03-03', 179], ['2026-03-04', 185]]) };
  const fxSeries = series([['2026-03-03', 31.77], ['2026-03-04', 31.5]]);

  it('台幣成本用**成交當日**匯率，之後不隨匯率變動', () => {
    const rows = buildBackfillFromTxns({ market: 'US', txns, closeSeries, fxSeries, capturedAt: T });
    expect(rows).toHaveLength(2);
    expect(rows[0].totalCostTwd).toBeCloseTo((895 + 0.72) * 31.77, 2);
    expect(rows[1].totalCostTwd).toBe(rows[0].totalCostTwd);   // 隔日匯率變了但成本不動
  });

  it('fxRate 逐日取當日匯率（假日 carry-forward）', () => {
    const rows = buildBackfillFromTxns({
      market: 'US', txns, closeSeries: { NVDA: series([['2026-03-03', 179], ['2026-03-04', 185], ['2026-03-05', 186]]) },
      fxSeries, capturedAt: T,
    });
    expect(rows.map(r => r.fxRate)).toEqual([31.77, 31.5, 31.5]);   // 03/05 無匯率資料 → 沿用前值
  });

  it('賣出後剩餘部位的台幣成本等比縮減', () => {
    const rows = buildBackfillFromTxns({
      market: 'US',
      txns: [
        ...txns,
        { date: '2026-03-04', symbol: 'NVDA', market: 'US', kind: 'sell', shares: 2, gross: 370, fee: 0.3, tax: 0, exchangeRate: 31.5 },
      ],
      closeSeries, fxSeries, capturedAt: T,
    });
    const d4 = rows.find(r => r.date === '2026-03-04')!;
    expect(d4.totalCostTwd).toBeCloseTo((895 + 0.72) * 31.77 * 0.6, 2);   // 剩 3/5
  });

  it('買進流水缺匯率 → 該日不出 totalCostTwd（不猜；USD 欄位照常）', () => {
    const rows = buildBackfillFromTxns({
      market: 'US',
      txns: [{ date: '2026-03-03', symbol: 'NVDA', market: 'US', kind: 'buy', shares: 5, gross: 895, fee: 0.72, tax: 0 }],
      closeSeries, fxSeries, capturedAt: T,
    });
    expect(rows[0].totalCostTwd).toBeUndefined();
    expect(rows[0].totalCost).toBeCloseTo(895.72, 2);
    expect(rows[0].fxRate).toBe(31.77);
  });

  it('未提供 fxSeries → 無 fxRate（台幣曲線該日不畫，USD 不受影響）', () => {
    const rows = buildBackfillFromTxns({ market: 'US', txns, closeSeries, capturedAt: T });
    expect(rows[0].fxRate).toBeUndefined();
    expect(rows[0].marketValue).toBeCloseTo(895, 2);
  });

  it('台股不產生台幣專屬欄位（本來就是台幣）', () => {
    const rows = buildBackfillFromTxns({
      market: 'TW',
      txns: [{ date: '2026-01-02', symbol: 'AAA', market: 'TW', kind: 'buy', shares: 1000, gross: 10000, fee: 14, tax: 0 }],
      closeSeries: { AAA: series([['2026-01-02', 10]]) }, capturedAt: T,
    });
    expect(rows[0].totalCostTwd).toBeUndefined();
    expect(rows[0].fxRate).toBeUndefined();
  });
});
