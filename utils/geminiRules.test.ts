// utils/geminiRules.test.ts — Phase 12 T5：AI 規則書（system instruction）防漂移鎖
//
// 這組測試不驗「規則對不對」——那是領域判斷，不是程式碼問題。它守的是「有沒有人不小心改到」：
//  1. 5 個 SI 常數逐位元組鎖住。SI 動一個字（含空白）就會讓 A3 分析快取與 Gemini implicit
//     caching 全數失效（快取鍵＝fnv1a(SI + ' ' + prompt)），使用者會突然多付一輪費用。
//  2. formatHealthCheckData 的輸出版面鎖住——欄位順序或單位一改，SI 裡的欄位說明就對不上。
//  3. 三條內容不變量，確保 snapshot 更新時人有看到「規則書還是那本規則書」。
//
// **snapshot 紅了不是壞事，是本卡的交付物**：它代表有人動了規則書。確認是刻意的，再 -u 更新。
//
// 測試檔放 utils/ 是沿用現行 vitest 收錄範圍（現況測試全在 utils/）；
// 已實測 import '../services/gemini' 在 node 測試環境無副作用（模組層只有常數與函式宣告，
// geminiCache 僅在呼叫期才碰 localStorage）。
import { describe, it, expect } from 'vitest';
import {
  ENTRY_SYSTEM_INSTRUCTION_FULL,
  ENTRY_SYSTEM_INSTRUCTION_FAST,
  TRADE_DECISION_SYSTEM_INSTRUCTION,
  HEALTH_CHECK_SYSTEM_INSTRUCTION,
  FUNDAMENTALS_SYSTEM_INSTRUCTION,
  formatHealthCheckData,
  type PortfolioHealthItem,
} from '../services/gemini';
import type { StockDataPoint } from '../types';

const SYSTEM_INSTRUCTIONS: [string, string][] = [
  ['ENTRY_SYSTEM_INSTRUCTION_FULL', ENTRY_SYSTEM_INSTRUCTION_FULL],
  ['ENTRY_SYSTEM_INSTRUCTION_FAST', ENTRY_SYSTEM_INSTRUCTION_FAST],
  ['TRADE_DECISION_SYSTEM_INSTRUCTION', TRADE_DECISION_SYSTEM_INSTRUCTION],
  ['HEALTH_CHECK_SYSTEM_INSTRUCTION', HEALTH_CHECK_SYSTEM_INSTRUCTION],
  ['FUNDAMENTALS_SYSTEM_INSTRUCTION', FUNDAMENTALS_SYSTEM_INSTRUCTION],
];

describe('system instruction 位元組鎖', () => {
  for (const [name, si] of SYSTEM_INSTRUCTIONS) {
    it(`${name} 逐字未變`, () => {
      expect(si).toMatchSnapshot();
    });
  }

  it('長度一併鎖住（純空白改動也會紅）', () => {
    const lengths = Object.fromEntries(SYSTEM_INSTRUCTIONS.map(([name, si]) => [name, si.length]));
    expect(lengths).toMatchSnapshot();
  });
});

describe('規則書內容不變量', () => {
  it('進場規則書仍有六大做多進場位置與買點 1-6', () => {
    expect(TRADE_DECISION_SYSTEM_INSTRUCTION).toContain('六大做多進場位置');
    const buyPoints = TRADE_DECISION_SYSTEM_INSTRUCTION.match(/^- 買點[1-6]：/gm) ?? [];
    expect(buyPoints).toHaveLength(6);
  });

  it('健檢規則書仍有加碼大忌區塊', () => {
    expect(HEALTH_CHECK_SYSTEM_INSTRUCTION).toContain('加碼大忌');
  });

  it('兩套戒律是刻意不同的規則，不得被合併成同一份（D-06）', () => {
    // 進場講「禁止做多進場條件」、加碼講「加碼大忌」——若哪天兩邊文字變成一樣，這條會紅
    expect(TRADE_DECISION_SYSTEM_INSTRUCTION).toContain('禁止做多進場條件');
    expect(HEALTH_CHECK_SYSTEM_INSTRUCTION).not.toContain('禁止做多進場條件');
  });

  it('entry 的完整版與快速版不相等（兩種模式各有各的規則書）', () => {
    expect(ENTRY_SYSTEM_INSTRUCTION_FULL).not.toBe(ENTRY_SYSTEM_INSTRUCTION_FAST);
    expect(ENTRY_SYSTEM_INSTRUCTION_FULL.length).toBeGreaterThan(ENTRY_SYSTEM_INSTRUCTION_FAST.length);
  });
});

// ── formatHealthCheckData 的版面鎖（固定 fixture：一台股一美股）──────────────
const bar = (over: Partial<StockDataPoint>): StockDataPoint => ({
  date: '2026-01-02', open: 100, high: 105, low: 99, close: 104, volume: 12_000_000,
  ma5: 102, ma10: 101, ma20: 100, ma60: 95,
  k: 70.5, d: 60.25, j: 90.75, macd: 1.234, macdSignal: 0.987, macdHist: 0.247,
  bbUpper: 110, bbMiddle: 100, bbLower: 90,
  ...over,
} as StockDataPoint);

const TW_ITEM: PortfolioHealthItem = {
  symbol: '2330.TW',
  name: '台積電',
  avgCostPrice: 900,
  currentPrice: 1040,
  totalShares: 1000,
  profitPct: 15.56,
  recentData: [
    bar({ date: '2026-01-02', close: 100, volume: 20_000_000, foreignBuySell: 3_000_000, investmentTrustBuySell: 500_000 }),
    bar({ date: '2026-01-03', close: 102, volume: 25_000_000, foreignBuySell: -1_000_000, investmentTrustBuySell: 200_000 }),
    bar({ date: '2026-01-06', close: 104, volume: 31_000_000, foreignBuySell: 4_000_000, investmentTrustBuySell: 800_000 }),
  ],
  volumeProjection: null,
};

const US_ITEM: PortfolioHealthItem = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  avgCostPrice: 250,
  currentPrice: 325.89,
  totalShares: 10,
  profitPct: 30.36,
  recentData: [
    bar({ date: '2026-01-02', close: 320, volume: 45_000_000 }),
    bar({ date: '2026-01-05', close: 325.89, volume: 52_000_000 }),
  ],
  volumeProjection: null,
};

describe('formatHealthCheckData 版面鎖', () => {
  it('台股＋美股各一檔的輸出逐字未變', () => {
    expect(formatHealthCheckData([TW_ITEM, US_ITEM])).toMatchSnapshot();
  });

  it('台股用「張」、美股用「股」（單位換算是 SI 欄位說明的前提）', () => {
    const out = formatHealthCheckData([TW_ITEM, US_ITEM]);
    expect(out).toContain('張');
    expect(out).toContain('股');
    // 台股籌碼欄位只出現在台股區塊
    expect(out).toContain('外資:');
    expect(formatHealthCheckData([US_ITEM])).not.toContain('外資:');
  });
});
