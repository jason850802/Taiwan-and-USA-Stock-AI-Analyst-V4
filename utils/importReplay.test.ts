// utils/importReplay.test.ts — Phase 11 T2：FIFO 重播引擎手算對數案例
// 全部斷言值出自 11-PLAN.md Case A~I（數字取自使用者真實帳單但為公開市場價格，無個資）。
import { describe, it, expect } from 'vitest';
import { PortfolioItem, ParsedTxn, ImportGap } from '../types';
import { replayStatement, prevDay } from './importReplay';

const T = 1_700_000_000_000;

const tw = (o: Partial<ParsedTxn>): ParsedTxn => ({
  broker: 'sinopac', market: 'TW', date: '2026-07-02', symbol: '0000', name: 'x',
  kind: 'buy', shares: 0, price: 0, gross: 0, fee: 0, tax: 0,
  dedupeKey: Math.random().toString(), rawLine: '', ...o,
});
const us = (o: Partial<ParsedTxn>): ParsedTxn => ({
  broker: 'cathay', market: 'US', date: '2026-03-02', symbol: 'XXX', name: 'x',
  kind: 'buy', shares: 0, price: 0, gross: 0, fee: 0, tax: 0,
  dedupeKey: Math.random().toString(), rawLine: '', ...o,
});

describe('Case A｜台股買進建立 lot（成本含買費）', () => {
  it('2327 買 30@1115（價金 33450、費 47）→ 成本 33497、均價 1116.5667', () => {
    const r = replayStatement({
      txns: [tw({ symbol: '2327', name: '國巨*', kind: 'buy', shares: 30, price: 1115, gross: 33450, fee: 47 })],
      existingLots: [], now: T,
    });
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0]).toMatchObject({ symbol: '2327', totalShares: 30, totalCost: 33497, buyFee: 47, buyDate: '2026-07-02' });
    expect(r.lots[0].avgCostPrice).toBeCloseTo(1116.5667, 4);
    expect(r.applied.buys).toBe(1);
  });
});

describe('Case B｜台股單 lot 全賣', () => {
  it('2351 買 250@212（成本 53075）→ 賣 250@203.5（費72稅152）→ 已實現 −2,424', () => {
    const r = replayStatement({
      txns: [
        tw({ symbol: '2351', name: '順德', kind: 'buy', shares: 250, price: 212, gross: 53000, fee: 75 }),
        tw({ symbol: '2351', name: '順德', kind: 'sell', date: '2026-07-03', shares: 250, price: 203.5, gross: 50875, fee: 72, tax: 152 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.newTrades).toHaveLength(1);
    const t = r.newTrades[0];
    expect(t).toMatchObject({ symbol: '2351', sharesSold: 250, sellFee: 72, sellTax: 152, costBasis: 53075, realizedPnl: -2424, currency: 'TWD' });
    expect(t.grossProceeds - t.sellFee - t.sellTax).toBe(50651);   // ＝帳單應收
    expect(r.lots).toHaveLength(0);                                 // 全賣後 lot 移除
  });
});

describe('Case C｜台股跨 lot 賣出（D-09 核心：拆多筆＋費稅末筆吃餘數）', () => {
  const txns = [
    tw({ symbol: '3711', name: '日月光投控', kind: 'buy', date: '2026-07-02', shares: 50, price: 726, gross: 36300, fee: 51 }),
    tw({ symbol: '3711', name: '日月光投控', kind: 'buy', date: '2026-07-06', shares: 30, price: 685, gross: 20550, fee: 29 }),
    tw({ symbol: '3711', name: '日月光投控', kind: 'buy', date: '2026-07-08', shares: 20, price: 636, gross: 12720, fee: 18 }),
    tw({ symbol: '3711', name: '日月光投控', kind: 'sell', date: '2026-07-14', shares: 70, price: 623, gross: 43610, fee: 62, tax: 130 }),
  ];
  const r = replayStatement({ txns, existingLots: [], now: T });

  it('FIFO 吃 lot1 全 50 股＋lot2 的 20 股，拆成 2 筆 trade', () => {
    expect(r.newTrades).toHaveLength(2);
    expect(r.newTrades.map(t => t.sharesSold)).toEqual([50, 20]);
  });

  it('費稅等比分攤且總和等於帳單（44+18=62、93+37=130）', () => {
    const [a, b] = r.newTrades;
    expect(a.sellFee).toBe(44);
    expect(a.sellTax).toBe(93);
    expect(b.sellFee).toBe(18);
    expect(b.sellTax).toBe(37);
    expect(a.sellFee + b.sellFee).toBe(62);
    expect(a.sellTax + b.sellTax).toBe(130);
  });

  it('costBasis 乘先除後：lot1=36351、lot2=13719.3333', () => {
    expect(r.newTrades[0].costBasis).toBe(36351);
    expect(r.newTrades[1].costBasis).toBeCloseTo(13719.3333, 3);
  });

  it('已實現：lot1 −5,338／lot2 −1,314.3333／合計 −6,652.3333（＝應收 43,418 − 成本 50,070.33）', () => {
    expect(r.newTrades[0].realizedPnl).toBe(-5338);
    expect(r.newTrades[1].realizedPnl).toBeCloseTo(-1314.3333, 3);
    const total = r.newTrades.reduce((s, t) => s + t.realizedPnl, 0);
    expect(total).toBeCloseTo(-6652.3333, 3);
    expect(total).toBeCloseTo(43418 - (36351 + 13719.3333), 3);
  });

  it('剩餘部位：lot2 剩 10 股成本 6859.6667、lot3 完整 20 股', () => {
    expect(r.lots).toHaveLength(2);
    const l2 = r.lots.find(l => l.buyDate === '2026-07-06')!;
    expect(l2.totalShares).toBe(10);
    expect(l2.totalCost).toBeCloseTo(6859.6667, 3);
    expect(r.lots.find(l => l.buyDate === '2026-07-08')!.totalShares).toBe(20);
  });
});

describe('Case D/E/G｜美股（USD 計價、費用取帳單實數）', () => {
  it('Case D 買進 NVDA 5@179 費 0.72 → totalCostUSD 895.72（非公式的 0.07）', () => {
    const r = replayStatement({
      txns: [us({ symbol: 'NVDA', kind: 'buy', date: '2026-03-03', shares: 5, price: 179, gross: 895, fee: 0.72 })],
      existingLots: [], now: T,
    });
    expect(r.lots[0]).toMatchObject({ purchaseCurrency: 'USD', totalCostUSD: 895.72, totalCost: 0, buyFee: 0.72 });
    expect(r.lots[0].totalCostUSD).not.toBeCloseTo(895 + 895 * 0.00008, 4);
  });

  it('Case E MRVL 買 20@82.15 → 賣 20@85.10 → 已實現 +56.33 USD', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'MRVL', kind: 'buy', date: '2026-03-02', shares: 20, price: 82.15, gross: 1643, fee: 1.31 }),
        us({ symbol: 'MRVL', kind: 'sell', date: '2026-03-09', shares: 20, price: 85.1, gross: 1702, fee: 1.36 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.newTrades[0]).toMatchObject({ currency: 'USD', sellFee: 1.36, sellTax: 0 });
    expect(r.newTrades[0].costBasis).toBeCloseTo(1644.31, 2);
    expect(r.newTrades[0].realizedPnl).toBeCloseTo(56.33, 2);
  });

  it('Case G 碎股 MU 2.3209 股（無其他費用）→ 已實現 +90.77 USD', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'MU', kind: 'buy', date: '2026-05-26', shares: 2.3209, price: 861.7368, gross: 2000, fee: 1.6 }),
        us({ symbol: 'MU', kind: 'sell', date: '2026-05-27', shares: 2.3209, price: 902.2611, gross: 2094.05, fee: 1.68 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.newTrades[0].realizedPnl).toBeCloseTo(90.77, 2);
    expect(r.lots).toHaveLength(0);
  });

  it('Case G 真檔版：帳單「其他費用」0.05（SEC/TAF）必須扣除 → +90.72 USD', () => {
    // T6 真檔端到端發現：規劃期 Case G 手算漏計此欄，實作正確扣除，於此鎖住行為
    const r = replayStatement({
      txns: [
        us({ symbol: 'MU', kind: 'buy', date: '2026-05-26', shares: 2.3209, price: 861.7368, gross: 2000, fee: 1.6 }),
        us({ symbol: 'MU', kind: 'sell', date: '2026-05-27', shares: 2.3209, price: 902.2611, gross: 2094.05, fee: 1.68, tax: 0.05 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.newTrades[0].sellTax).toBeCloseTo(0.05, 2);
    expect(r.newTrades[0].realizedPnl).toBeCloseTo(90.72, 2);
  });
});

describe('Case F｜除息計入已領股利（美股取應收台幣）', () => {
  it('GOOGL 2 股除息，應收台幣 9 → cashDividends +9', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'GOOGL', kind: 'buy', date: '2026-03-16', shares: 2, price: 304.848, gross: 609.7, fee: 0.49 }),
        us({ symbol: 'GOOGL', kind: 'dividend', date: '2026-03-17', shares: 2, price: 0.21, gross: 0.42, tax: 0.13, netTwd: 9 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.lots[0].cashDividends).toBe(9);
    expect(r.applied.dividends).toBe(1);
  });

  it('已清倉時除息無處可加 → 記 note 並略過，不崩潰', () => {
    const r = replayStatement({
      txns: [us({ symbol: 'ZZZ', kind: 'dividend', shares: 5, price: 0.1, gross: 0.5, netTwd: 15 })],
      existingLots: [], now: T,
    });
    expect(r.applied.skipped).toBe(1);
    expect(r.notes[0]).toContain('無對應持股');
  });

  it('多 lot 時依股數等比分配股利', () => {
    const r = replayStatement({
      txns: [
        tw({ symbol: '2330', kind: 'buy', date: '2026-01-02', shares: 30, price: 100, gross: 3000, fee: 4 }),
        tw({ symbol: '2330', kind: 'buy', date: '2026-01-03', shares: 10, price: 110, gross: 1100, fee: 1 }),
        tw({ symbol: '2330', kind: 'dividend', date: '2026-01-10', shares: 40, price: 2, gross: 80 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.lots[0].cashDividends).toBe(60);   // 80 × 30/40
    expect(r.lots[1].cashDividends).toBe(20);   // 80 × 10/40
  });
});

describe('Case H｜期初部位缺口（D-02：不猜成本）', () => {
  const sellTxn = tw({ symbol: '2484', name: '希華', kind: 'sell', date: '2026-07-03', shares: 1000, price: 91.3, gross: 91300, fee: 130, tax: 273 });

  it('未補成本 → 產生 gap、整筆略過、不產生 trade', () => {
    const r = replayStatement({ txns: [sellTxn], existingLots: [], now: T });
    expect(r.newTrades).toHaveLength(0);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ symbol: '2484', sharesMissing: 1000, sellPrice: 91.3, sellDate: '2026-07-03', buyDate: '2026-07-02' });
    expect(r.applied.skipped).toBe(1);
  });

  it('補成本均價 85 → 已實現 +5,897，synthetic lot 用前一日為買進日', () => {
    const filled: ImportGap[] = [{ txnIndex: 0, symbol: '2484', name: '希華', market: 'TW', sellDate: '2026-07-03', sharesMissing: 1000, sellPrice: 91.3, costPerShare: 85 }];
    const r = replayStatement({ txns: [sellTxn], existingLots: [], gapsFilled: filled, now: T });
    expect(r.gaps).toHaveLength(0);
    expect(r.newTrades).toHaveLength(1);
    expect(r.newTrades[0]).toMatchObject({ costBasis: 85000, realizedPnl: 5897, sharesSold: 1000 });
    expect(r.lots).toHaveLength(0);
  });

  it('部分缺口：既有 400 股＋補 600 股 → 兩筆 trade，總股數對得上', () => {
    const existing: PortfolioItem[] = [{
      id: 'old', symbol: '2484', avgCostPrice: 80, totalShares: 400, totalCost: 32000,
      brokerDiscount: 10, cashDividends: 0, stockDividends: 0, buyDate: '2026-06-01',
    }];
    const filled: ImportGap[] = [{ txnIndex: 0, symbol: '2484', name: '希華', market: 'TW', sellDate: '2026-07-03', sharesMissing: 600, sellPrice: 91.3, costPerShare: 85 }];
    const r = replayStatement({ txns: [sellTxn], existingLots: existing, gapsFilled: filled, now: T });
    expect(r.newTrades).toHaveLength(2);
    expect(r.newTrades.reduce((s, t) => s + t.sharesSold, 0)).toBe(1000);
    expect(r.newTrades.reduce((s, t) => s + t.sellFee, 0)).toBe(130);
    expect(r.newTrades.reduce((s, t) => s + t.sellTax, 0)).toBe(273);
  });
});

describe('D-08｜lot 池含既有庫存（使用者要的「自動從庫存賣出」）', () => {
  it('對帳單的賣出會扣減手動 key 的既有持股並計入損益', () => {
    const existing: PortfolioItem[] = [{
      id: 'manual-1', symbol: '2330', avgCostPrice: 600.855, totalShares: 1000, totalCost: 600855,
      brokerDiscount: 10, buyFee: 855, cashDividends: 5000, stockDividends: 0, buyDate: '2026-04-21',
    }];
    const r = replayStatement({
      txns: [tw({ symbol: '2330', kind: 'sell', date: '2026-07-03', shares: 400, price: 650, gross: 260000, fee: 370, tax: 780 })],
      existingLots: existing, now: T,
    });
    expect(r.newTrades).toHaveLength(1);
    expect(r.newTrades[0]).toMatchObject({ lotId: 'manual-1', costBasis: 240342, realizedPnl: 18508, divCarried: 2000 });
    expect(r.lots[0]).toMatchObject({ totalShares: 600, totalCost: 360513, cashDividends: 3000 });
    expect(r.lots[0].avgCostPrice).toBeCloseTo(600.855, 6);   // 等比縮減：均價不變
  });

  it('無 buyDate 的既有 lot 視為最早，FIFO 先被賣掉', () => {
    const existing: PortfolioItem[] = [
      { id: 'dated', symbol: 'AAA', avgCostPrice: 10, totalShares: 100, totalCost: 1000, brokerDiscount: 10, cashDividends: 0, stockDividends: 0, buyDate: '2026-01-01' },
      { id: 'undated', symbol: 'AAA', avgCostPrice: 5, totalShares: 100, totalCost: 500, brokerDiscount: 10, cashDividends: 0, stockDividends: 0 },
    ];
    const r = replayStatement({
      txns: [tw({ symbol: 'AAA', kind: 'sell', date: '2026-07-01', shares: 100, price: 20, gross: 2000, fee: 2, tax: 6 })],
      existingLots: existing, now: T,
    });
    expect(r.newTrades[0].lotId).toBe('undated');
    expect(r.lots.map(l => l.id)).toEqual(['dated']);
  });

  it('買進日晚於賣出日的 lot 不得被該賣出吃掉（時序正確）', () => {
    const r = replayStatement({
      txns: [
        tw({ symbol: 'BBB', kind: 'sell', date: '2026-07-01', shares: 10, price: 50, gross: 500, fee: 1, tax: 1 }),
        tw({ symbol: 'BBB', kind: 'buy', date: '2026-07-05', shares: 10, price: 40, gross: 400, fee: 1 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.gaps).toHaveLength(1);          // 賣出當下無持股 → 缺口
    expect(r.lots).toHaveLength(1);          // 之後的買進正常建立
    expect(r.lots[0].totalShares).toBe(10);
  });
});

describe('工具與整體', () => {
  it('prevDay 跨月正確且不使用 toISOString', () => {
    expect(prevDay('2026-07-03')).toBe('2026-07-02');
    expect(prevDay('2026-07-01')).toBe('2026-06-30');
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
  });

  it('applied 統計正確', () => {
    const r = replayStatement({
      txns: [
        tw({ symbol: 'A', kind: 'buy', shares: 10, price: 10, gross: 100, fee: 1 }),
        tw({ symbol: 'A', kind: 'sell', date: '2026-07-05', shares: 10, price: 12, gross: 120, fee: 1, tax: 1 }),
        tw({ symbol: 'B', kind: 'sell', date: '2026-07-06', shares: 5, price: 3, gross: 15, fee: 1, tax: 1 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.applied).toEqual({ buys: 1, sells: 1, dividends: 0, skipped: 1 });
  });
});

describe('匯率留痕（美股買入／賣出匯率隨批次與帳本走）', () => {
  it('買進帶匯率 → lot.exchangeRate；賣出產生 buy/sellExchangeRate', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'NVDA', kind: 'buy', date: '2026-03-03', shares: 5, price: 179, gross: 895, fee: 0.72, exchangeRate: 31.77 }),
        us({ symbol: 'NVDA', kind: 'sell', date: '2026-04-16', shares: 5, price: 197.34, gross: 986.7, fee: 0.79, exchangeRate: 31.48 }),
      ],
      existingLots: [], now: T,
    });
    const t = r.newTrades[0];
    expect(t.buyExchangeRate).toBe(31.77);
    expect(t.sellExchangeRate).toBe(31.48);
    // 台幣實現損益（含匯差）＝ 淨收美元×賣出匯率 − 成本美元×買入匯率
    const twd = (t.grossProceeds - t.sellFee - t.sellTax) * t.sellExchangeRate! - t.costBasis * t.buyExchangeRate!;
    expect(twd).toBeCloseTo(985.91 * 31.48 - 895.72 * 31.77, 2);
  });

  it('帳單匯率為「--」時不猜：lot 與帳本都不寫匯率', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'MU', kind: 'buy', date: '2026-05-26', shares: 2, price: 1000, gross: 2000, fee: 1.6 }),
        us({ symbol: 'MU', kind: 'sell', date: '2026-05-27', shares: 2, price: 1050, gross: 2100, fee: 1.68 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.newTrades[0].buyExchangeRate).toBeUndefined();
    expect(r.newTrades[0].sellExchangeRate).toBeUndefined();
  });

  it('部分賣出後，剩餘批次保留買入匯率', () => {
    const r = replayStatement({
      txns: [
        us({ symbol: 'GLW', kind: 'buy', date: '2026-05-28', shares: 10, price: 192.8, gross: 1928, fee: 1.54, exchangeRate: 31.39 }),
        us({ symbol: 'GLW', kind: 'sell', date: '2026-06-30', shares: 4, price: 200, gross: 800, fee: 0.64, exchangeRate: 31.86 }),
      ],
      existingLots: [], now: T,
    });
    expect(r.lots[0].exchangeRate).toBe(31.39);
    expect(r.lots[0].totalShares).toBe(6);
  });
});
