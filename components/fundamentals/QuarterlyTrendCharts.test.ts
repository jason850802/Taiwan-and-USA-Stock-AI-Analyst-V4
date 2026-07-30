// components/fundamentals/QuarterlyTrendCharts.test.ts — strict 票 03 行為鎖
//
// 本檔守什麼：EPS 長條圖數值標籤 formatter 對 recharts `RenderableText` 全輸入範圍的顯示結果。
// 票 03 把參數由 `number | null` 放寬成函式庫宣告的完整範圍以修 TS2322，這組案例確保
// 那次放寬**沒有動到任何一個輸入的顯示字串**，並鎖住兩個容易回歸的點：
//   1. 0 是有效 EPS——收斂條件若從 typeof 退化成真值判斷，0 會從 '0.00' 變成空字串。
//   2. 非數字輸入（型別上進得來）不得呼叫數字方法，否則是執行期 TypeError 而非空標籤。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { formatEpsLabel } from './QuarterlyTrendCharts.js';

describe('formatEpsLabel — EPS 數值標籤格式化', () => {
  describe('數字輸入 → 固定小數兩位', () => {
    it('正數（一般情況）', () => {
      expect(formatEpsLabel(12.345)).toBe('12.35');
      expect(formatEpsLabel(1)).toBe('1.00');
    });

    it('負數（虧損季）不被當成無值', () => {
      expect(formatEpsLabel(-0.87)).toBe('-0.87');
      expect(formatEpsLabel(-12.5)).toBe('-12.50');
    });

    it('0 顯示 0.00——真值判斷會誤殺這格，是本鎖的主要目的', () => {
      expect(formatEpsLabel(0)).toBe('0.00');
      expect(formatEpsLabel(-0)).toBe('0.00');
    });
  });

  describe('無值輸入 → 空字串（標籤不出現）', () => {
    it('null（該季無 EPS 資料，實際資料形狀）', () => {
      expect(formatEpsLabel(null)).toBe('');
    });

    it('undefined（recharts 型別範圍內，缺 dataKey 時可能發生）', () => {
      expect(formatEpsLabel(undefined)).toBe('');
    });
  });

  describe('非數字輸入 → 空字串，且不得丟例外', () => {
    it('字串不呼叫數字方法（放寬前這裡是 TypeError）', () => {
      expect(() => formatEpsLabel('3.14')).not.toThrow();
      expect(formatEpsLabel('3.14')).toBe('');
    });

    it('boolean 同樣安全落到空字串', () => {
      expect(formatEpsLabel(true)).toBe('');
      expect(formatEpsLabel(false)).toBe('');
    });
  });
});
