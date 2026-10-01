// utils/market.test.ts — Phase 12 T1：市場分類唯一權威的行為鎖
// 真值表來源：.planning/phases/12-arch-deepening/12-PLAN.md「Task 1 真值表（機械對數）」。
// 這裡鎖的是「哪些代碼算台股」——改 isTwCode／isTwStock 的 regex 前先跑 npm run test。
import { describe, it, expect } from 'vitest';
import { isTwCode, isTwStock, marketOf } from './market';
import { isTwStock as isTwStockFromFees } from './portfolioFees';

// [輸入, 期望市場]——PLAN 真值表逐條
const TRUTH_TABLE: Array<[string, 'TW' | 'US']> = [
  ['2330', 'TW'],
  ['0050', 'TW'],
  ['00631L', 'TW'],
  ['00679B', 'TW'],
  ['6488', 'TW'],
  ['2330.TW', 'TW'],
  ['6488.TWO', 'TW'],
  ['aapl', 'US'],
  ['AAPL', 'US'],
  ['NVDA', 'US'],
  ['BRK.B', 'US'],
  ['VT', 'US'],
];

describe('marketOf 真值表', () => {
  for (const [symbol, expected] of TRUTH_TABLE) {
    it(`${symbol} → ${expected}`, () => {
      expect(marketOf(symbol)).toBe(expected);
    });
  }
});

describe('isTwStock', () => {
  it('與 marketOf 互為表裡', () => {
    for (const [symbol, expected] of TRUTH_TABLE) {
      expect(isTwStock(symbol)).toBe(expected === 'TW');
    }
  });

  it('大小寫不敏感（後綴）', () => {
    expect(isTwStock('2330.tw')).toBe(true);
    expect(isTwStock('6488.two')).toBe(true);
  });

  it('大小寫不敏感（純代碼的字母結尾）', () => {
    expect(isTwStock('00631l')).toBe(true);
  });

  it('7 碼以上數字非台股（regex 上限 6 碼）', () => {
    expect(isTwStock('1234567')).toBe(false);
  });

  it('數字後兩個以上字母非台股', () => {
    expect(isTwStock('0067BB')).toBe(false);
  });
});

describe('isTwCode（純代碼，不含後綴）', () => {
  it('3～6 碼數字，可帶單一字母結尾', () => {
    for (const code of ['123', '2330', '0050', '6488', '123456', '00631L', '00679B', '00981A']) {
      expect(isTwCode(code)).toBe(true);
    }
  });

  it('位數或字母超出範圍、空字串皆否', () => {
    for (const code of ['12', '1234567', '0067BB', '']) {
      expect(isTwCode(code)).toBe(false);
    }
  });

  it('帶 .TW／.TWO 後綴回 false——這是與 isTwStock 唯一的差別', () => {
    // 期望值取真值表、不取 isTwStock：isTwStock 委派本函式，拿它當答案等於自己驗自己
    for (const [symbol, expected] of TRUTH_TABLE) {
      const hasSuffix = /\.TWO?$/i.test(symbol);
      expect(isTwCode(symbol)).toBe(!hasSuffix && expected === 'TW');
    }
    // 只剝一層後綴的呼叫端（基本面分頁）靠這條擋下「2330.TW.TW」
    expect(isTwCode('2330.TW')).toBe(false);
  });

  it('大小寫不敏感，與 isTwStock 一致', () => {
    expect(isTwCode('00631l')).toBe(true);
  });

  it('不 trim：前後空白由呼叫端正規化', () => {
    expect(isTwCode(' 2330')).toBe(false);
  });
});

describe('portfolioFees re-export', () => {
  it('與 market 是同一個函式參考（未複製一份實作）', () => {
    expect(isTwStockFromFees).toBe(isTwStock);
  });
});
