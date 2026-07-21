// utils/portfolioLedger.test.ts — Phase 10 T2：賣出引擎手算對數案例
// 全部斷言值出自 10-PLAN.md「手算對數案例」節，覆核者須獨立重算對照。
import { describe, it, expect } from 'vitest';
import { PortfolioItem } from '../types';
import { buildSellResult, round2, todayLocalStr } from './portfolioLedger';

const twLot = (over: Partial<PortfolioItem> = {}): PortfolioItem => ({
  id: 'lot-tw', symbol: '2330.TW', avgCostPrice: 600.855, totalShares: 1000,
  totalCost: 600_855, brokerDiscount: 10, buyFee: 855,
  cashDividends: 0, stockDividends: 0, ...over,
});

describe('buildSellResult｜台股', () => {
  it('Case 1：1000股@650 全賣（成本 600,855）→ 已實現 46,269', () => {
    const { trade, updatedLot } = buildSellResult(twLot(), { sharesSold: 1000, sellPrice: 650, sellDate: '2026-07-01' });
    expect(trade.grossProceeds).toBe(650_000);
    expect(trade.sellFee).toBe(926);
    expect(trade.sellTax).toBe(1950);
    expect(trade.costBasis).toBe(600_855);
    expect(trade.realizedPnl).toBe(46_269);
    expect(trade.market).toBe('TW');
    expect(trade.currency).toBe('TWD');
    expect(trade.usdTwdRateUsed).toBeUndefined();
    expect(updatedLot).toBeNull();
  });

  it('Case 1b：部分賣 400股@650（含股利 5,000）→ 已實現 18,508；等比縮減', () => {
    const lot = twLot({ cashDividends: 5000 });
    const { trade, updatedLot } = buildSellResult(lot, { sharesSold: 400, sellPrice: 650, sellDate: '2026-07-01' });
    expect(trade.grossProceeds).toBe(260_000);
    expect(trade.sellFee).toBe(370);
    expect(trade.sellTax).toBe(780);
    expect(trade.costBasis).toBe(240_342);        // (600855×400)/1000 乘先除後，float64 精確
    expect(trade.realizedPnl).toBe(18_508);
    expect(trade.divCarried).toBe(2000);
    expect(updatedLot).not.toBeNull();
    expect(updatedLot!.totalShares).toBe(600);
    expect(updatedLot!.totalCost).toBe(360_513);
    expect(updatedLot!.avgCostPrice).toBe(600.855);   // 等比縮減的數學必然：均價不變
    expect(updatedLot!.buyFee).toBe(513);             // 855 − 342
    expect(updatedLot!.cashDividends).toBe(3000);
    expect(updatedLot!.stockDividends).toBe(0);       // 不移轉、留在原 lot
    // 股利守恆：賣出側＋持有側＝原值
    expect(trade.divCarried + updatedLot!.cashDividends).toBe(5000);
    // 成本守恆
    expect(trade.costBasis + updatedLot!.totalCost).toBe(600_855);
  });

  it('Case 2：ETF 0050 全賣 2000股@210（成本 380,541）→ 已實現 38,441', () => {
    const lot = twLot({ symbol: '0050.TW', avgCostPrice: 190.2705, totalShares: 2000, totalCost: 380_541, buyFee: 541 });
    const { trade } = buildSellResult(lot, { sharesSold: 2000, sellPrice: 210, sellDate: '2026-07-01' });
    expect(trade.sellFee).toBe(598);
    expect(trade.sellTax).toBe(420);   // ETF 稅 0.001
    expect(trade.realizedPnl).toBe(38_441);
  });
});

describe('buildSellResult｜美股', () => {
  const usLot = (over: Partial<PortfolioItem> = {}): PortfolioItem => ({
    id: 'lot-us', symbol: 'NVDA', avgCostPrice: 180.014, totalShares: 10,
    totalCost: 0, brokerDiscount: 10, cashDividends: 0, stockDividends: 0,
    purchaseCurrency: 'USD', totalCostUSD: 1800.14, isUsEtf: false, ...over,
  });

  it('Case 3：USD 購入個股全賣 10股@200（成本 1,800.14）→ 199.70，免匯率', () => {
    const { trade, updatedLot } = buildSellResult(usLot(), { sharesSold: 10, sellPrice: 200, sellDate: '2026-07-01' });
    expect(trade.grossProceeds).toBe(2000);
    expect(trade.sellFee).toBeCloseTo(0.16, 2);
    expect(trade.sellTax).toBe(0);
    expect(trade.costBasis).toBeCloseTo(1800.14, 2);
    expect(trade.realizedPnl).toBeCloseTo(199.70, 2);
    expect(trade.currency).toBe('USD');
    expect(trade.usdTwdRateUsed).toBeUndefined();   // USD 購入且無股利：不需匯率
    expect(updatedLot).toBeNull();
  });

  it('Case 3b：ETF 固定 $3 費——SPY 5股@600（成本 2,903）→ 94.00', () => {
    const lot = usLot({ symbol: 'SPY', totalCostUSD: 2903, totalShares: 5, isUsEtf: true });
    const { trade } = buildSellResult(lot, { sharesSold: 5, sellPrice: 600, sellDate: '2026-07-01' });
    expect(trade.sellFee).toBe(3);
    expect(trade.realizedPnl).toBeCloseTo(94.00, 2);
  });

  it('TWD 計價批次：以即時匯率換算成本並記錄 usdTwdRateUsed', () => {
    const lot = usLot({ purchaseCurrency: undefined, totalCostUSD: undefined, totalCost: 64_000 });
    const { trade, updatedLot } = buildSellResult(lot, { sharesSold: 5, sellPrice: 250, sellDate: '2026-07-01' }, 32);
    expect(trade.grossProceeds).toBe(1250);
    expect(trade.sellFee).toBeCloseTo(0.10, 2);
    expect(trade.costBasis).toBeCloseTo(1000, 2);       // (64000×5/10)=32000 TWD → /32
    expect(trade.realizedPnl).toBeCloseTo(249.90, 2);
    expect(trade.usdTwdRateUsed).toBe(32);
    expect(updatedLot!.totalCost).toBe(32_000);         // 批次縮減用原幣 TWD
    expect(updatedLot!.totalShares).toBe(5);
  });

  it('TWD 計價批次缺匯率 → 拋錯', () => {
    const lot = usLot({ purchaseCurrency: undefined, totalCostUSD: undefined, totalCost: 64_000 });
    expect(() => buildSellResult(lot, { sharesSold: 5, sellPrice: 250, sellDate: '2026-07-01' })).toThrow(/匯率/);
  });

  it('USD 購入但有 TWD 股利且缺匯率 → 拋錯；有匯率則股利換 USD', () => {
    const lot = usLot({ cashDividends: 640 });   // TWD 計價股利
    expect(() => buildSellResult(lot, { sharesSold: 10, sellPrice: 200, sellDate: '2026-07-01' })).toThrow(/匯率/);
    const { trade } = buildSellResult(lot, { sharesSold: 10, sellPrice: 200, sellDate: '2026-07-01' }, 32);
    expect(trade.divCarried).toBeCloseTo(20, 2);        // 640 TWD / 32
    expect(trade.usdTwdRateUsed).toBe(32);
  });
});

describe('buildSellResult｜輸入驗證', () => {
  it('超量／零股數／負價／未來日期／壞格式全數拋錯', () => {
    const lot = twLot();
    expect(() => buildSellResult(lot, { sharesSold: 1001, sellPrice: 650, sellDate: '2026-07-01' })).toThrow(/超過/);
    expect(() => buildSellResult(lot, { sharesSold: 0, sellPrice: 650, sellDate: '2026-07-01' })).toThrow(/大於 0/);
    expect(() => buildSellResult(lot, { sharesSold: 100, sellPrice: 0, sellDate: '2026-07-01' })).toThrow(/大於 0/);
    expect(() => buildSellResult(lot, { sharesSold: 100, sellPrice: 650, sellDate: '2999-01-01' })).toThrow(/晚於今天/);
    expect(() => buildSellResult(lot, { sharesSold: 100, sellPrice: 650, sellDate: '2026/07/01' })).toThrow(/格式/);
  });
});

describe('工具函式', () => {
  it('round2 清除浮點尾數（半分錢邊界依 IEEE754 表示，本案金額不受影響）', () => {
    expect(round2(0.144)).toBe(0.14);
    expect(round2(0.16000000000000003)).toBe(0.16);   // 2000×0.00008 的實際浮點值
    expect(round2(199.70000000000002)).toBe(199.7);
  });
  it('todayLocalStr 格式為 YYYY-MM-DD（本地）', () => {
    expect(todayLocalStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
