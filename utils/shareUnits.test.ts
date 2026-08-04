import { describe, expect, it } from 'vitest';
import { fmtShares } from './shareUnits';

describe('fmtShares', () => {
  it.each([
    [2.8019999999999996, '2.802'],
    [1.08896, '1.08896'],
    [0.50824, '0.50824'],
    [3, '3'],
    [12000, '12,000'],
    [0.000001, '0.000001'],
  ])('%s 股顯示為 %s', (shares, expected) => {
    expect(fmtShares(shares)).toBe(expected);
  });
});
