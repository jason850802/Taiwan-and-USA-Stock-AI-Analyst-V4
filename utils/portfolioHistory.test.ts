// utils/portfolioHistory.test.ts — Phase 10 T3：快照/upsert/逆推/回推/圖表序列對數測試
// Case 4/5 斷言值出自 10-PLAN.md「手算對數案例」節；回推情境為逐日手算（見各 it 註解）。
import { describe, it, expect } from 'vitest';
import { PortfolioItem, RealizedTrade, DailyPnlSnapshot } from '../types';
import {
  computeLiveSnapshot,
  upsertSnapshots,
  reconstructLotAsOf,
  buildBackfillRows,
  buildChartSeries,
  PriceInfo,
} from './portfolioHistory';

const lot = (over: Partial<PortfolioItem>): PortfolioItem => ({
  id: 'x', symbol: '2330.TW', avgCostPrice: 0, totalShares: 0, totalCost: 0,
  brokerDiscount: 10, cashDividends: 0, stockDividends: 0, ...over,
});
const T = 1_700_000_000_000;   // capturedAt 固定值

// ── computeLiveSnapshot ─────────────────────────────────────────────────────

describe('computeLiveSnapshot｜台股', () => {
  const lotsCase4 = [
    lot({ id: 'A', totalShares: 1000, totalCost: 600_855, cashDividends: 5000 }),
    lot({ id: 'B', totalShares: 500, totalCost: 310_441 }),
  ];
  const prices: Record<string, PriceInfo> = { '2330.TW': { price: 643, date: '2026-07-20' } };

  it('Case 4：兩批 2330@643 → mv 964,500／cost 911,296／est 4,267／div 5,000', () => {
    const s = computeLiveSnapshot('TW', lotsCase4, prices, undefined, T)!;
    expect(s).not.toBeNull();
    expect(s.date).toBe('2026-07-20');
    expect(s.marketValue).toBe(964_500);
    expect(s.totalCost).toBe(911_296);
    expect(s.estSellCosts).toBe(4_267);       // per-lot：916+1929＋458+964
    expect(s.cashDividends).toBe(5_000);
    expect(s.symbolCount).toBe(1);
    expect(s.source).toBe('live');
    expect(s.usdTwdRate).toBeUndefined();
  });

  it('Case 5：同 symbol 兩批各市值 100,000 → est 費採 per-lot 142×2（非合併 285）', () => {
    const lots = [
      lot({ id: 'A', totalShares: 1000, totalCost: 90_000 }),
      lot({ id: 'B', totalShares: 1000, totalCost: 95_000 }),
    ];
    const s = computeLiveSnapshot('TW', lots, { '2330.TW': { price: 100, date: '2026-07-20' } }, undefined, T)!;
    expect(s.estSellCosts).toBe((142 + 300) * 2);   // 884；合併一次 floor 會是 285+600=885
  });

  it('守衛 A：缺報價/錯誤/無日期/價格非正/空清單 → null', () => {
    const l = [lot({ id: 'A', totalShares: 100, totalCost: 1 })];
    expect(computeLiveSnapshot('TW', [], prices, undefined, T)).toBeNull();
    expect(computeLiveSnapshot('TW', l, {}, undefined, T)).toBeNull();
    expect(computeLiveSnapshot('TW', l, { '2330.TW': { price: 643, date: '2026-07-20', error: true } }, undefined, T)).toBeNull();
    expect(computeLiveSnapshot('TW', l, { '2330.TW': { price: 643, date: '2026-07-20', loading: true } }, undefined, T)).toBeNull();
    expect(computeLiveSnapshot('TW', l, { '2330.TW': { price: 643 } }, undefined, T)).toBeNull();   // 無 date
    expect(computeLiveSnapshot('TW', l, { '2330.TW': { price: 0, date: '2026-07-20' } }, undefined, T)).toBeNull();
  });

  it('快照日＝各 symbol 報價日的最大值', () => {
    const lots = [
      lot({ id: 'A', symbol: '2330.TW', totalShares: 1, totalCost: 1 }),
      lot({ id: 'B', symbol: '0050.TW', totalShares: 1, totalCost: 1 }),
    ];
    const s = computeLiveSnapshot('TW', lots, {
      '2330.TW': { price: 100, date: '2026-07-18' },
      '0050.TW': { price: 50, date: '2026-07-17' },   // 停牌沿用舊價
    }, undefined, T)!;
    expect(s.date).toBe('2026-07-18');
    expect(s.symbolCount).toBe(2);
  });
});

describe('computeLiveSnapshot｜美股', () => {
  const usdLot = lot({ id: 'U', symbol: 'NVDA', totalShares: 10, purchaseCurrency: 'USD', totalCostUSD: 1800.14, isUsEtf: false });
  const twdLot = lot({ id: 'V', symbol: 'NVDA', totalShares: 10, totalCost: 64_000 });   // TWD 計價
  const p: Record<string, PriceInfo> = { 'NVDA': { price: 200, date: '2026-07-18' } };

  it('USD 購入且無股利：免匯率；成本取 totalCostUSD；費 round2', () => {
    const s = computeLiveSnapshot('US', [usdLot], p, undefined, T)!;
    expect(s).not.toBeNull();
    expect(s.marketValue).toBe(2000);
    expect(s.totalCost).toBeCloseTo(1800.14, 2);
    expect(s.estSellCosts).toBeCloseTo(0.16, 2);
    expect(s.usdTwdRate).toBeUndefined();
  });

  it('守衛 B：TWD 計價批次缺匯率 → null；有匯率 → 成本/32 並記錄匯率', () => {
    expect(computeLiveSnapshot('US', [twdLot], p, undefined, T)).toBeNull();
    expect(computeLiveSnapshot('US', [twdLot], p, 0, T)).toBeNull();
    const s = computeLiveSnapshot('US', [twdLot], p, 32, T)!;
    expect(s.totalCost).toBeCloseTo(2000, 2);      // 64,000 / 32
    expect(s.usdTwdRate).toBe(32);
  });

  it('守衛 B：USD 購入但有 TWD 股利、缺匯率 → null；有匯率 → 股利換 USD', () => {
    const withDiv = { ...usdLot, cashDividends: 640 };
    expect(computeLiveSnapshot('US', [withDiv], p, undefined, T)).toBeNull();
    const s = computeLiveSnapshot('US', [withDiv], p, 32, T)!;
    expect(s.cashDividends).toBeCloseTo(20, 2);
    expect(s.usdTwdRate).toBe(32);
  });
});

// ── upsertSnapshots ─────────────────────────────────────────────────────────

const row = (over: Partial<DailyPnlSnapshot>): DailyPnlSnapshot => ({
  date: '2026-07-01', market: 'TW', source: 'live',
  marketValue: 0, totalCost: 0, estSellCosts: 0, cashDividends: 0,
  symbolCount: 1, capturedAt: T, ...over,
});

describe('upsertSnapshots（live 覆蓋一切；backfill 永不覆蓋）', () => {
  it('live 覆蓋同鍵 backfill 與舊 live', () => {
    const existing = [row({ source: 'backfill', marketValue: 1 }), row({ date: '2026-07-02', marketValue: 2 })];
    const out = upsertSnapshots(existing, [row({ marketValue: 99 }), row({ date: '2026-07-02', marketValue: 88 })]);
    expect(out.find(r => r.date === '2026-07-01')!.marketValue).toBe(99);
    expect(out.find(r => r.date === '2026-07-02')!.marketValue).toBe(88);
    expect(out).toHaveLength(2);
  });
  it('backfill 不覆蓋既有 live 或既有 backfill；無同鍵才寫入', () => {
    const existing = [row({ marketValue: 1 }), row({ date: '2026-07-02', source: 'backfill', marketValue: 2 })];
    const out = upsertSnapshots(existing, [
      row({ source: 'backfill', marketValue: 99 }),                       // 撞 live → 跳過
      row({ date: '2026-07-02', source: 'backfill', marketValue: 88 }),   // 撞 backfill → 跳過
      row({ date: '2026-06-30', source: 'backfill', marketValue: 77 }),   // 新日期 → 寫入
    ]);
    expect(out.find(r => r.date === '2026-07-01')!.marketValue).toBe(1);
    expect(out.find(r => r.date === '2026-07-02')!.marketValue).toBe(2);
    expect(out.find(r => r.date === '2026-06-30')!.marketValue).toBe(77);
  });
  it('跨市場同日期互不干擾，輸出依 market,date 排序', () => {
    const out = upsertSnapshots([row({ market: 'US' })], [row({ marketValue: 5 })]);
    expect(out).toHaveLength(2);
    expect(out[0].market).toBe('TW');
    expect(out[1].market).toBe('US');
  });
});

// ── reconstructLotAsOf ──────────────────────────────────────────────────────

describe('reconstructLotAsOf（Case 1b 逆推）', () => {
  const trade = { sellDate: '2026-07-01', sharesSold: 400, costBasis: 240_342, divCarried: 2000 } as RealizedTrade;
  const now = { shares: 600, cost: 360_513, cashDiv: 3000 };
  it('賣出日前一天：還原成 1000 股／600,855／5,000', () => {
    expect(reconstructLotAsOf(now, [trade], '2026-06-30')).toEqual({ shares: 1000, cost: 600_855, cashDiv: 5000 });
  });
  it('賣出當日與之後：維持現值（d==sellDate 視為已賣，與 live 快照一致）', () => {
    expect(reconstructLotAsOf(now, [trade], '2026-07-01')).toEqual(now);
    expect(reconstructLotAsOf(now, [trade], '2026-07-02')).toEqual(now);
  });
});

// ── buildBackfillRows ───────────────────────────────────────────────────────

describe('buildBackfillRows（逐日手算情境）', () => {
  const closeSeries = {
    '2330.TW': [
      { date: '2026-07-01', close: 100 },
      { date: '2026-07-02', close: 110 },
      { date: '2026-07-04', close: 120 },   // 7/03 缺（carry-forward 測試）
    ],
    '0050.TW': [
      { date: '2026-07-02', close: 50 },
      { date: '2026-07-03', close: 55 },
      { date: '2026-07-04', close: 60 },
    ],
  };
  const LX = { id: 'LX', symbol: '2330.TW', buyDate: '2026-07-01', shares: 1000, cost: 100_000, cashDiv: 0 };
  const LY = { id: 'LY', symbol: '0050.TW', buyDate: '2026-07-02', shares: 200, cost: 10_000, cashDiv: 0 };
  const LZ = { id: 'LZ', symbol: '2317.TW', shares: 50, cost: 5_000, cashDiv: 0 };   // 無 buyDate

  it('日期軸聯集＋buyDate 起算＋boundary 排除＋無日期批排除', () => {
    const { rows, excludedLots } = buildBackfillRows({
      market: 'TW', lots: [LX, LY, LZ], closeSeries, trades: [],
      boundaryDate: '2026-07-04', capturedAt: T,
    });
    expect(excludedLots).toEqual([{ id: 'LZ', symbol: '2317.TW', shares: 50 }]);
    expect(rows.map(r => r.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    // 7/01：僅 LX（100×1000）→ fee 142 tax 300
    expect(rows[0]).toMatchObject({ marketValue: 100_000, totalCost: 100_000, estSellCosts: 442, symbolCount: 1, source: 'backfill' });
    // 7/02：LX 110,000（156+330）＋ LY 10,000（14+10，ETF 稅 0.001）
    expect(rows[1]).toMatchObject({ marketValue: 120_000, totalCost: 110_000, estSellCosts: 486 + 24, symbolCount: 2 });
    // 7/03：LX carry-forward 110 → 同 486；LY 11,000（15+11）
    expect(rows[2]).toMatchObject({ marketValue: 121_000, totalCost: 110_000, estSellCosts: 486 + 26, symbolCount: 2 });
  });

  it('無 boundary → 填到最新 close（7/04：LX 120,000＋LY 12,000）', () => {
    const { rows } = buildBackfillRows({ market: 'TW', lots: [LX, LY], closeSeries, trades: [], capturedAt: T });
    const last = rows[rows.length - 1];
    expect(last.date).toBe('2026-07-04');
    expect(last.marketValue).toBe(132_000);
    expect(last.estSellCosts).toBe((171 + 360) + (17 + 12));   // 531＋29
  });

  it('帳本逆推：賣出日前用還原組成、賣出日起用現組成', () => {
    // LX 已於 7/03 賣 500 股（costBasis 50,000）→ 現持 500 股／50,000
    const LXsold = { ...LX, shares: 500, cost: 50_000 };
    const trade = {
      id: 't1', lotId: 'LX', symbol: '2330.TW', market: 'TW', sellDate: '2026-07-03',
      sharesSold: 500, sellPrice: 110, grossProceeds: 55_000, sellFee: 78, sellTax: 165,
      costBasis: 50_000, realizedPnl: 4_757, divCarried: 0, currency: 'TWD', createdAt: T,
    } as RealizedTrade;
    const { rows } = buildBackfillRows({
      market: 'TW', lots: [LXsold, LY], closeSeries, trades: [trade],
      boundaryDate: '2026-07-04', capturedAt: T,
    });
    // 7/01-7/02：還原 1000 股 → 與未賣情境相同
    expect(rows[0].marketValue).toBe(100_000);
    expect(rows[1].marketValue).toBe(120_000);
    // 7/03：已賣 → LX 500×110=55,000（fee 78 tax 165）＋LY 11,000（15+11）
    expect(rows[2].marketValue).toBe(66_000);
    expect(rows[2].totalCost).toBe(60_000);
    expect(rows[2].estSellCosts).toBe(243 + 26);
  });

  it('全部批次皆無 buyDate → 空 rows＋全列 excluded', () => {
    const { rows, excludedLots } = buildBackfillRows({
      market: 'TW', lots: [LZ], closeSeries, trades: [], capturedAt: T,
    });
    expect(rows).toEqual([]);
    expect(excludedLots).toHaveLength(1);
  });
});

// ── buildChartSeries ────────────────────────────────────────────────────────

describe('buildChartSeries（三線組合＋含息開關＋帳本階梯）', () => {
  const rows: DailyPnlSnapshot[] = [
    row({ date: '2026-07-01', source: 'backfill', marketValue: 1100, totalCost: 1000, estSellCosts: 10, cashDividends: 20 }),
    row({ date: '2026-07-02', source: 'live', marketValue: 1200, totalCost: 1000, estSellCosts: 12, cashDividends: 20 }),
    row({ date: '2026-07-02', market: 'US', marketValue: 999 }),   // 他市場，須被過濾
  ];
  const trades = [
    { market: 'TW', sellDate: '2026-07-02', realizedPnl: 100, divCarried: 5 } as RealizedTrade,
  ];

  it('不含息：未實現＝mv−cost−est；已實現階梯在 sellDate 起跳；總損益＝相加', () => {
    const pts = buildChartSeries(rows, trades, 'TW', false);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ date: '2026-07-01', unrealized: 90, realizedCum: 0, total: 90, source: 'backfill' });
    expect(pts[1]).toEqual({ date: '2026-07-02', unrealized: 188, realizedCum: 105, total: 293, source: 'live' });
  });

  it('含息（Phase 11 語意）：配息計入已實現側，未實現維持純價差', () => {
    // 舊語意把 snapshot.cashDividends 加進未實現側，清倉後會消失；
    // 新語意由呼叫端傳入配息流水，累計進已實現側，不隨賣股蒸發。
    const divs = [{ date: '2026-07-01', amount: 20 }, { date: '2026-07-02', amount: 30 }];
    const off = buildChartSeries(rows, trades, 'TW', false, divs);
    const on = buildChartSeries(rows, trades, 'TW', true, divs);

    expect(off[0].unrealized).toBe(90);          // 未實現不受含息影響
    expect(on[0].unrealized).toBe(90);
    expect(off[0].realizedCum).toBe(0);
    expect(on[0].realizedCum).toBe(20);          // 含息 → 加上當日前的累計配息
    expect(on[1].realizedCum).toBe(105 + 50);    // 賣出 105 ＋ 配息 20+30
    expect(on[1].total).toBe(188 + 155);
  });

  it('配息不因清倉而消失（與舊語意的關鍵差異）', () => {
    const divs = [{ date: '2026-07-01', amount: 500 }];
    const pts = buildChartSeries(rows, trades, 'TW', true, divs);
    expect(pts.every(p => p.realizedCum >= 500)).toBe(true);
  });

  it('補登早於首快照的歷史賣出：首點 cum 已含', () => {
    const early = [{ market: 'TW', sellDate: '2026-06-30', realizedPnl: 7, divCarried: 0 } as RealizedTrade];
    const pts = buildChartSeries(rows, early, 'TW', false);
    expect(pts[0].realizedCum).toBe(7);
  });

  it('無帳本：realizedCum 全 0（D-11 已實現線由 UI disabled）', () => {
    const pts = buildChartSeries(rows, [], 'TW', false);
    expect(pts.every(p => p.realizedCum === 0)).toBe(true);
  });
});
