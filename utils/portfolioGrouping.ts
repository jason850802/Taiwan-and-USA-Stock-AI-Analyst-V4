// utils/portfolioGrouping.ts — 庫存 lots 的渲染期分組（Phase 12 T6a 自 components/Portfolio.tsx 原樣搬出）
// 行為鎖：portfolioGrouping.test.ts。保序（symbol 首見順序＋組內原順序）、不聚合不改寫。
import { PortfolioItem } from '../types';

// lots 維持逐筆儲存，只在渲染時依 symbol 保序分組。
export const groupLotsBySymbol = (items: PortfolioItem[]): Map<string, PortfolioItem[]> => {
  const groups = new Map<string, PortfolioItem[]>();
  items.forEach(item => {
    const lots = groups.get(item.symbol) ?? [];
    lots.push(item);
    groups.set(item.symbol, lots);
  });
  return groups;
};
