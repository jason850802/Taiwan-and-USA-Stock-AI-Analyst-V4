// utils/portfolioGrouping.test.ts — Phase 12 T6a：lots 分組的行為鎖
// groupLotsBySymbol 原本是 components/Portfolio.tsx 的 module 級函式（渲染期分組），
// 搬到 utils 後由本檔鎖行為：分組正確、首見順序保序、組內 lot 順序保序。
// 案例依現行實作行為寫（先讀函式再出題）：Map 保插入順序、不做任何排序或聚合。
import { describe, it, expect } from 'vitest';
import { groupLotsBySymbol } from './portfolioGrouping';
import type { PortfolioItem } from '../types';

const lot = (id: string, symbol: string): PortfolioItem =>
  ({ id, symbol, totalShares: 100, totalCost: 10000, cashDividends: 0, stockDividends: 0 } as PortfolioItem);

describe('groupLotsBySymbol', () => {
  it('多 lot 依 symbol 分組，組內順序＝原陣列順序', () => {
    const groups = groupLotsBySymbol([lot('a', '2330.TW'), lot('b', 'AAPL'), lot('c', '2330.TW')]);
    expect(groups.size).toBe(2);
    expect(groups.get('2330.TW')!.map(l => l.id)).toEqual(['a', 'c']);
    expect(groups.get('AAPL')!.map(l => l.id)).toEqual(['b']);
  });

  it('key 順序＝各 symbol 首見順序（Map 插入序，渲染依此排）', () => {
    const groups = groupLotsBySymbol([lot('a', '0050.TW'), lot('b', 'NVDA'), lot('c', '0050.TW'), lot('d', '2330.TW')]);
    expect([...groups.keys()]).toEqual(['0050.TW', 'NVDA', '2330.TW']);
  });

  it('單 lot 直通（一組一筆，物件參考不變）', () => {
    const only = lot('x', 'VT');
    const groups = groupLotsBySymbol([only]);
    expect(groups.get('VT')![0]).toBe(only);
  });

  it('空陣列 → 空 Map', () => {
    expect(groupLotsBySymbol([]).size).toBe(0);
  });

  it('不聚合不改寫：lot 物件原樣進組', () => {
    const a = lot('a', '2330.TW');
    const b = lot('b', '2330.TW');
    const groups = groupLotsBySymbol([a, b]);
    expect(groups.get('2330.TW')).toEqual([a, b]);
    expect(a.totalShares).toBe(100);   // 沒有被加總改寫
  });
});
