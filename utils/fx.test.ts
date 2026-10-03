// utils/fx.test.ts — 「台幣成本要不要靠當下匯率換算」判定的行為鎖
// 2026-10-03 使用者拍板：總投入成本卡只有在「USD 計價、沒記買入匯率」的批次存在時才標示估算；
// TWD 計價批次的台幣成本就是實付台幣、不經任何匯率，沒記買入匯率也不算估。
import { describe, it, expect } from 'vitest';
import type { PortfolioItem } from '../types';
import { lotCostTwd, costTwdUsesLiveRate } from './fx';

const lot = (patch: Partial<PortfolioItem>): PortfolioItem => ({
  id: 'x', symbol: 'AAPL', avgCostPrice: 100, totalShares: 10, totalCost: 30000,
  brokerDiscount: 0, cashDividends: 0, stockDividends: 0, ...patch,
});

const shapes: [string, boolean, PortfolioItem][] = [
  ['USD 計價、沒記買入匯率', true, lot({ purchaseCurrency: 'USD', totalCost: 0, totalCostUSD: 1000 })],
  ['USD 計價、買入匯率為 0（視同沒記）', true, lot({ purchaseCurrency: 'USD', totalCost: 0, totalCostUSD: 1000, exchangeRate: 0 })],
  ['USD 計價、有買入匯率', false, lot({ purchaseCurrency: 'USD', totalCost: 0, totalCostUSD: 1000, exchangeRate: 30 })],
  ['TWD 計價、沒記買入匯率', false, lot({ purchaseCurrency: 'TWD' })],
  ['幣別未填（舊資料＝TWD 計價）、沒記買入匯率', false, lot({})],
  ['USD 計價但缺 USD 成本（異常資料，台幣成本退回 totalCost）', false, lot({ purchaseCurrency: 'USD' })],
];

describe('costTwdUsesLiveRate：台幣成本是否靠當下匯率換算', () => {
  it.each(shapes)('%s → %s', (_, expected, l) => {
    expect(costTwdUsesLiveRate(l)).toBe(expected);
  });

  // 判定為真 ⇔ 換一個當下匯率，lotCostTwd 算出的台幣成本就跟著變（兩者不得各說各話）
  it.each(shapes)('與 lotCostTwd 一致：%s', (_, __, l) => {
    expect(costTwdUsesLiveRate(l)).toBe(lotCostTwd(l, 31) !== lotCostTwd(l, 32));
  });
});
