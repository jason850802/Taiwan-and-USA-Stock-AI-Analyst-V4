// utils/portfolioFees.test.ts — Phase 10 T1：費用/稅純函式行為鎖
// 手算對數案例來源：.planning/phases/10-portfolio-history/10-PLAN.md「手算對數案例」節
// Case 1/2/3/4 的費稅子步驟在此逐一釘死；rounding（floor / max(1,·)）不得改變。
import { describe, it, expect } from 'vitest';
import {
  isTwStock,
  getTwStockType,
  getTaxRate,
  calcTwBuyFee,
  calcTwSellFeeAndTax,
  calcUsFee,
} from './portfolioFees';

describe('isTwStock', () => {
  it('後綴與數字代號判定', () => {
    expect(isTwStock('2330.TW')).toBe(true);
    expect(isTwStock('6488.TWO')).toBe(true);
    expect(isTwStock('2330')).toBe(true);
    expect(isTwStock('00679B')).toBe(true);   // 數字＋單一英文字母
    expect(isTwStock('AAPL')).toBe(false);
    expect(isTwStock('NVDA')).toBe(false);
    expect(isTwStock('BRK.B')).toBe(false);   // 非 .TW/.TWO、非純數字開頭
  });
});

describe('getTwStockType / getTaxRate', () => {
  it('個股 0.003', () => {
    expect(getTwStockType('2330.TW')).toBe('stock');
    expect(getTaxRate('2330.TW')).toBe(0.003);
  });
  it('一般 ETF 0.001（00 開頭非 B/C 結尾，含槓桿 L）', () => {
    expect(getTwStockType('0050.TW')).toBe('etf');
    expect(getTaxRate('0050.TW')).toBe(0.001);
    expect(getTwStockType('00631L')).toBe('etf');
  });
  it('債券 ETF 0（B＝台幣計價、C＝外幣計價）', () => {
    expect(getTwStockType('00679B.TW')).toBe('bond-etf');
    expect(getTaxRate('00679B.TW')).toBe(0);
    expect(getTwStockType('00864C')).toBe('bond-etf');
    expect(getTaxRate('00864C')).toBe(0);
  });
});

describe('calcTwBuyFee（max(1, floor(base×0.001425))）', () => {
  it('Case 1 買進：1000股@600 → 855', () => {
    expect(calcTwBuyFee(600_000)).toBe(855);        // floor(855) = 855
  });
  it('Case 2 買進：2000股@190 → 541', () => {
    expect(calcTwBuyFee(380_000)).toBe(541);        // floor(541.5) = 541
  });
  it('Case 4 Lot B 買進：500股@620 → 441', () => {
    expect(calcTwBuyFee(310_000)).toBe(441);        // floor(441.75) = 441
  });
  it('最低 1 元邊界與非正數', () => {
    expect(calcTwBuyFee(100)).toBe(1);              // floor(0.1425)=0 → max(1,0)=1
    expect(calcTwBuyFee(0)).toBe(0);
    expect(calcTwBuyFee(-5)).toBe(0);
  });
});

describe('calcTwSellFeeAndTax（賣費 max(1,floor(v×0.001425))；稅 floor(v×taxRate)）', () => {
  it('Case 1 賣出：650,000 個股 → fee 926 / tax 1,950', () => {
    expect(calcTwSellFeeAndTax(650_000, '2330.TW')).toEqual({ sellFee: 926, tax: 1950 });
  });
  it('Case 1b 部分賣出：260,000 個股 → fee 370 / tax 780', () => {
    expect(calcTwSellFeeAndTax(260_000, '2330.TW')).toEqual({ sellFee: 370, tax: 780 });
  });
  it('Case 2 ETF 賣出：420,000 → fee 598 / tax 420', () => {
    expect(calcTwSellFeeAndTax(420_000, '0050.TW')).toEqual({ sellFee: 598, tax: 420 });
  });
  it('Case 4 per-lot 快照費稅：643,000 → {916, 1929}；321,500 → {458, 964}', () => {
    expect(calcTwSellFeeAndTax(643_000, '2330.TW')).toEqual({ sellFee: 916, tax: 1929 });
    expect(calcTwSellFeeAndTax(321_500, '2330.TW')).toEqual({ sellFee: 458, tax: 964 });
  });
  it('債券 ETF 稅恆 0', () => {
    expect(calcTwSellFeeAndTax(100_000, '00679B')).toEqual({ sellFee: 142, tax: 0 });
  });
  it('最低 1 元與非正數', () => {
    expect(calcTwSellFeeAndTax(500, '2330.TW')).toEqual({ sellFee: 1, tax: 1 }); // max(1,0)=1；floor(1.5)=1
    expect(calcTwSellFeeAndTax(0, '2330.TW')).toEqual({ sellFee: 0, tax: 0 });
  });
  it('Case 5 per-lot floor 粒度：兩批各 100,000 → 142×2=284（合併一次 floor 才是 285）', () => {
    const a = calcTwSellFeeAndTax(100_000, '2330.TW').sellFee;
    const b = calcTwSellFeeAndTax(100_000, '2330.TW').sellFee;
    expect(a + b).toBe(284);
    expect(calcTwSellFeeAndTax(200_000, '2330.TW').sellFee).toBe(285);
  });
});

// ── 現股當沖減半（ADR-0003 決策 3；spec 見 .scratch/tw-day-trade/spec.md）──────
// 旗標一律 optional 且預設＝現行為，故上方既有案例零修改。
describe('getTaxRate 的當沖旗標（只有個股減半）', () => {
  it('個股：true → 0.0015；false／缺參 → 0.003', () => {
    expect(getTaxRate('2330.TW', true)).toBe(0.0015);
    expect(getTaxRate('2330.TW', false)).toBe(0.003);
    expect(getTaxRate('2330.TW')).toBe(0.003);
  });
  it('縱深防禦最底層：ETF／債券 ETF 收到 true 仍回原檔次', () => {
    expect(getTaxRate('0050.TW', true)).toBe(0.001);
    expect(getTaxRate('00631L', true)).toBe(0.001);
    expect(getTaxRate('00679B.TW', true)).toBe(0);
    expect(getTaxRate('00864C', true)).toBe(0);
  });
});

describe('calcTwSellFeeAndTax 的當沖旗標（稅率替換、單次 floor）', () => {
  // 手算：650,000 × 0.0015 = 975（整除）；一般 650,000 × 0.003 = 1,950
  it('650,000 個股當沖 → tax 975（一般 1,950）、fee 仍 926', () => {
    expect(calcTwSellFeeAndTax(650_000, '2330.TW', true)).toEqual({ sellFee: 926, tax: 975 });
  });
  // 手算：321,500 × 0.0015 = 482.25 → floor 482；一般 964.5 → floor 964
  it('321,500 個股當沖 → tax 482（482.25 floor；一般 964）', () => {
    expect(calcTwSellFeeAndTax(321_500, '2330.TW', true)).toEqual({ sellFee: 458, tax: 482 });
  });
  // 手算：643,000 × 0.0015 = 964.5 → floor 964。
  // 本案鎖「稅額必為整數」：若誤實作成一般稅額除二不再取整（1929÷2 = 964.5）此案即紅。
  it('643,000 個股當沖 → tax 964（964.5 floor）、fee 仍 916', () => {
    expect(calcTwSellFeeAndTax(643_000, '2330.TW', true)).toEqual({ sellFee: 916, tax: 964 });
  });
  // 手算：500 × 0.0015 = 0.75 → floor 0（當沖小額稅可為 0）；
  // 同案鎖 sellFee 仍為 max(1, floor(0.7125)) = 1 → 旗標恆不影響手續費
  it('500 個股當沖 → tax 0（0.75 floor；一般 1）、fee 仍 1', () => {
    expect(calcTwSellFeeAndTax(500, '2330.TW', true)).toEqual({ sellFee: 1, tax: 0 });
  });
  it('ETF 帶 true 稅率不減半（縱深防禦）：420,000 → tax 仍 420', () => {
    expect(calcTwSellFeeAndTax(420_000, '0050.TW', true)).toEqual({ sellFee: 598, tax: 420 });
  });
  it('回歸鎖：同金額帶 false／缺參 一律等於現行行為', () => {
    expect(calcTwSellFeeAndTax(650_000, '2330.TW', false)).toEqual(calcTwSellFeeAndTax(650_000, '2330.TW'));
    expect(calcTwSellFeeAndTax(321_500, '2330.TW', false)).toEqual({ sellFee: 458, tax: 964 });
    expect(calcTwSellFeeAndTax(500, '2330.TW', false)).toEqual({ sellFee: 1, tax: 1 });
  });
  it('非正數不受旗標影響', () => {
    expect(calcTwSellFeeAndTax(0, '2330.TW', true)).toEqual({ sellFee: 0, tax: 0 });
    expect(calcTwSellFeeAndTax(-5, '2330.TW', true)).toEqual({ sellFee: 0, tax: 0 });
  });
});

describe('calcUsFee（個股 0.08% 無最低；ETF 固定 $3；無稅）', () => {
  it('Case 3 買進 1,800 → 1.44；賣出 2,000 → 1.60', () => {
    expect(calcUsFee(1_800, false)).toBeCloseTo(1.44, 9);
    expect(calcUsFee(2_000, false)).toBeCloseTo(1.6, 9);
  });

  it('費率鎖：與國泰對帳單實收逐筆吻合（round2 後）', () => {
    // 2026-07 對帳單樣本；原費率誤植 0.00008 會全部差 10 倍
    const cases: [number, number][] = [[1500, 1.20], [895, 0.72], [604, 0.48], [175.5, 0.14], [1643, 1.31]];
    for (const [gross, expected] of cases) {
      expect(Math.round(calcUsFee(gross, false) * 100) / 100).toBeCloseTo(expected, 2);
    }
  });
  it('ETF 固定 3 元（Case 3b）', () => {
    expect(calcUsFee(3_000, true)).toBe(3);
    expect(calcUsFee(50, true)).toBe(3);
  });
});
