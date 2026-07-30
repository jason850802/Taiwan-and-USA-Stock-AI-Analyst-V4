// utils/portfolioLedger.test.ts — Phase 10 T2：賣出引擎手算對數案例
// 全部斷言值出自 10-PLAN.md「手算對數案例」節，覆核者須獨立重算對照。
import { describe, it, expect } from 'vitest';
import { PortfolioItem } from '../types';
import { assessDayTrade, buildSellResult, round2, todayLocalStr } from './portfolioLedger';

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

  it('Case 3：USD 購入個股全賣 10股@200（成本 1,801.44）→ 196.96，免匯率', () => {
    // 費率 0.08%（2026-07-23 修正）：買費 1800×0.0008=1.44、賣費 2000×0.0008=1.60
    const lot = usLot({ totalCostUSD: 1801.44, avgCostPrice: 180.144 });
    const { trade, updatedLot } = buildSellResult(lot, { sharesSold: 10, sellPrice: 200, sellDate: '2026-07-01' });
    expect(trade.grossProceeds).toBe(2000);
    expect(trade.sellFee).toBeCloseTo(1.6, 2);
    expect(trade.sellTax).toBe(0);
    expect(trade.costBasis).toBeCloseTo(1801.44, 2);
    expect(trade.realizedPnl).toBeCloseTo(196.96, 2);   // 2000 − 1.60 − 1801.44
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
    expect(trade.sellFee).toBeCloseTo(1.0, 2);          // 1250 × 0.08%
    expect(trade.costBasis).toBeCloseTo(1000, 2);       // (64000×5/10)=32000 TWD → /32
    expect(trade.realizedPnl).toBeCloseTo(249.00, 2);   // 1250 − 1.00 − 1000
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

// ── 現股當沖（ADR-0003；spec 見 .scratch/tw-day-trade/spec.md）────────────────
// 旗標為 optional 且預設＝現行為（未記 buyDate 的 twLot 一律判不成立），故上方既有案例零修改。
describe('assessDayTrade｜自動判定（純函式、不吃價格）', () => {
  const D = '2026-07-01';

  it('四判準全過 → eligible', () => {
    expect(assessDayTrade(twLot({ buyDate: D }), 1000, D)).toEqual({ eligible: true, reason: 'eligible' });
  });
  it('兩張一起沖也算整張（1000 的整數倍）', () => {
    const lot = twLot({ buyDate: D, totalShares: 2000, totalCost: 1_201_710 });
    expect(assessDayTrade(lot, 2000, D)).toEqual({ eligible: true, reason: 'eligible' });
  });
  it('美股 → not-tw-stock', () => {
    expect(assessDayTrade(twLot({ symbol: 'NVDA', buyDate: D }), 1000, D))
      .toEqual({ eligible: false, reason: 'not-tw-stock' });
  });
  it('一般 ETF／債券 ETF → etf-not-eligible', () => {
    expect(assessDayTrade(twLot({ symbol: '0050.TW', buyDate: D }), 1000, D))
      .toEqual({ eligible: false, reason: 'etf-not-eligible' });
    expect(assessDayTrade(twLot({ symbol: '00679B.TW', buyDate: D }), 1000, D))
      .toEqual({ eligible: false, reason: 'etf-not-eligible' });
  });
  it('賣出股數非 1000 整數倍 → odd-lot-sell', () => {
    expect(assessDayTrade(twLot({ buyDate: D }), 500, D))
      .toEqual({ eligible: false, reason: 'odd-lot-sell' });
    expect(assessDayTrade(twLot({ buyDate: D, totalShares: 2000 }), 1500, D))
      .toEqual({ eligible: false, reason: 'odd-lot-sell' });
  });
  it('該批未記買進日（舊資料）→ no-buy-date', () => {
    expect(assessDayTrade(twLot(), 1000, D)).toEqual({ eligible: false, reason: 'no-buy-date' });
  });
  it('買進日 ≠ 賣出日 → date-mismatch', () => {
    expect(assessDayTrade(twLot({ buyDate: '2026-06-30' }), 1000, D))
      .toEqual({ eligible: false, reason: 'date-mismatch' });
  });
  it('持有股數含零股（整張買＋零股買併批）→ odd-lot-holding', () => {
    expect(assessDayTrade(twLot({ buyDate: D, totalShares: 1137 }), 1000, D))
      .toEqual({ eligible: false, reason: 'odd-lot-holding' });
  });

  describe('reason 優先序固定（硬閘先於軟閘，UI 據此顯示唯一一條理由）', () => {
    it('零股賣出＋日期不符 → odd-lot-sell（硬閘勝）', () => {
      expect(assessDayTrade(twLot({ buyDate: '2026-06-30' }), 500, D).reason).toBe('odd-lot-sell');
    });
    it('美股＋零股賣出 → not-tw-stock（最先）', () => {
      expect(assessDayTrade(twLot({ symbol: 'NVDA' }), 500, D).reason).toBe('not-tw-stock');
    });
    it('ETF＋零股賣出 → etf-not-eligible', () => {
      expect(assessDayTrade(twLot({ symbol: '0050.TW' }), 500, D).reason).toBe('etf-not-eligible');
    });
    it('未記買進日＋持有零股 → no-buy-date', () => {
      expect(assessDayTrade(twLot({ totalShares: 1137 }), 1000, D).reason).toBe('no-buy-date');
    });
    it('日期不符＋持有零股 → date-mismatch', () => {
      expect(assessDayTrade(twLot({ buyDate: '2026-06-30', totalShares: 1137 }), 1000, D).reason)
        .toBe('date-mismatch');
    });
  });
});

describe('buildSellResult｜當沖三態留痕與硬閘夾制', () => {
  const D = '2026-07-01';

  it('undefined＋自動判定成立 → 稅減半 975、已實現 47,244、記 true', () => {
    // 手算：650,000 × 0.0015 = 975（一般 1,950）；650,000 − 926 − 975 − 600,855 = 47,244
    const { trade } = buildSellResult(twLot({ buyDate: D }), { sharesSold: 1000, sellPrice: 650, sellDate: D });
    expect(trade.sellTax).toBe(975);
    expect(trade.sellFee).toBe(926);          // 手續費恆不受旗標影響
    expect(trade.realizedPnl).toBe(47_244);
    expect(trade.isDayTrade).toBe(true);
  });
  it('undefined＋自動判定不成立 → 一般稅＋記 false（Case 1 的數字原封不動）', () => {
    const { trade } = buildSellResult(twLot({ buyDate: '2026-06-30' }), { sharesSold: 1000, sellPrice: 650, sellDate: D });
    expect(trade.sellTax).toBe(1950);
    expect(trade.realizedPnl).toBe(46_269);
    expect(trade.isDayTrade).toBe(false);
  });
  it('軟閘覆寫 true（date-mismatch：買進日填錯）→ 減半＋記 true', () => {
    const { trade } = buildSellResult(
      twLot({ buyDate: '2026-06-30' }),
      { sharesSold: 1000, sellPrice: 650, sellDate: D, isDayTrade: true },
    );
    expect(trade.sellTax).toBe(975);
    expect(trade.isDayTrade).toBe(true);
  });
  it('軟閘覆寫 true（no-buy-date：舊資料沒填）→ 減半＋記 true', () => {
    const { trade } = buildSellResult(twLot(), { sharesSold: 1000, sellPrice: 650, sellDate: D, isDayTrade: true });
    expect(trade.sellTax).toBe(975);
    expect(trade.isDayTrade).toBe(true);
  });
  it('軟閘覆寫 true（odd-lot-holding：整張買＋零股買併批）→ 減半＋記 true', () => {
    const lot = twLot({ buyDate: D, totalShares: 1137, totalCost: 683_172 });
    const { trade } = buildSellResult(lot, { sharesSold: 1000, sellPrice: 650, sellDate: D, isDayTrade: true });
    expect(trade.sellTax).toBe(975);
    expect(trade.isDayTrade).toBe(true);
  });
  it('硬閘夾制：odd-lot-sell 覆寫 true 被夾回 false（稅照一般、不拋錯）', () => {
    // 手算：975,000 × 0.003 = 2,925（減半會是 1,462）；費 floor(1,389.375) = 1,389
    const lot = twLot({ buyDate: D, totalShares: 2000, totalCost: 1_201_710, buyFee: 1710 });
    const { trade } = buildSellResult(lot, { sharesSold: 1500, sellPrice: 650, sellDate: D, isDayTrade: true });
    expect(trade.grossProceeds).toBe(975_000);
    expect(trade.sellFee).toBe(1389);
    expect(trade.sellTax).toBe(2925);
    expect(trade.isDayTrade).toBe(false);
  });
  it('硬閘夾制：ETF 覆寫 true 被夾回 false（稅仍 0.1%）', () => {
    const lot = twLot({ symbol: '0050.TW', avgCostPrice: 190.2705, totalShares: 2000, totalCost: 380_541, buyFee: 541, buyDate: D });
    const { trade } = buildSellResult(lot, { sharesSold: 2000, sellPrice: 210, sellDate: D, isDayTrade: true });
    expect(trade.sellTax).toBe(420);
    expect(trade.isDayTrade).toBe(false);
  });
  it('覆寫 false → 一般稅＋記 false（自動判定成立也蓋掉）', () => {
    const { trade } = buildSellResult(
      twLot({ buyDate: D }),
      { sharesSold: 1000, sellPrice: 650, sellDate: D, isDayTrade: false },
    );
    expect(trade.sellTax).toBe(1950);
    expect(trade.isDayTrade).toBe(false);
  });
  it('美股賣出：trade 上根本沒有 isDayTrade 欄位（三態的「不適用」）', () => {
    const lot: PortfolioItem = {
      id: 'lot-us', symbol: 'NVDA', avgCostPrice: 180.144, totalShares: 10, totalCost: 0,
      brokerDiscount: 10, cashDividends: 0, stockDividends: 0,
      purchaseCurrency: 'USD', totalCostUSD: 1801.44, isUsEtf: false, buyDate: D,
    };
    const { trade } = buildSellResult(lot, { sharesSold: 10, sellPrice: 200, sellDate: D, isDayTrade: true });
    expect('isDayTrade' in trade).toBe(false);
    expect(trade.sellTax).toBe(0);
  });
  it('同批同日分次整張賣兩筆 → 各自成立（剩餘股數仍為整張）', () => {
    const lot = twLot({ buyDate: D, totalShares: 2000, totalCost: 1_201_710, buyFee: 1710 });
    const first = buildSellResult(lot, { sharesSold: 1000, sellPrice: 650, sellDate: D });
    expect(first.trade.sellTax).toBe(975);
    expect(first.trade.isDayTrade).toBe(true);
    expect(first.updatedLot!.totalShares).toBe(1000);
    expect(first.updatedLot!.buyDate).toBe(D);          // 買進日隨批次留存，第二筆才判得到
    const second = buildSellResult(first.updatedLot!, { sharesSold: 1000, sellPrice: 650, sellDate: D });
    expect(second.trade.sellTax).toBe(975);
    expect(second.trade.isDayTrade).toBe(true);
    expect(second.updatedLot).toBeNull();
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
