// utils/entryFilter.test.ts — D-3 最小單元測試：鎖住六六大順 GO/WAIT/NO_GO 決策路徑
// 全部為 (a) 解析案例：合成 K 棒 fixture 的決策鏈可手動推導（推導鏈見各 case 註解）。
// 末尾 steps 快照為 (b) 黃金值鎖（值取自現行實作）。
import { describe, it, expect } from 'vitest';
import { runEntryFilter } from './entryFilter';
import { StockDataPoint } from '../types';

/** 產生合成 K 棒：date 自 2026-01-01 依序遞增、open=前一根 close（首根=close）、
 *  high=close+1、low=close-1、volume 預設 1000 */
function makeBars(closes: number[]): StockDataPoint[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: i > 0 ? closes[i - 1] : close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }));
}

/** GO fixture：16 根合成多頭序列。
 *  detectSwings(k=2) → H@4(112)、L@7(106)、H@11(118)、L@13(114) → 頭頭高＋底底高＝多頭。
 *  末根推導鏈：chgPct=(121-117)/117≈3.42%>2、紅K(121>118)、收過前高(121>118=idx14.high)、
 *  過5均(121>116)、站上月線(bias≈10%)、3線多排向上、量比 1.5>=1.3 攻擊量、
 *  upStreak=2（idx13→12 下跌截斷）、KD 黃金交叉（55<=58 → 70>60）、MACD 柱 0.2→0.5 轉強
 *  → SOP 6/6、無戒律、entryPattern='回後買上漲' → GO、confidence 90（80+10）。 */
function makeGoFixture(): StockDataPoint[] {
  const closes = [100, 103, 106, 109, 112, 110, 108, 106, 109, 112, 115, 118, 116, 114, 117, 121];
  const data = makeBars(closes);
  Object.assign(data[14], { k: 55, d: 58, macdHist: 0.2 });
  Object.assign(data[15], {
    open: 118,
    volume: 1500,
    ma5: 116,
    ma10: 112,
    ma20: 110,
    ma60: 100,
    ma5Dir: 'up',
    ma10Dir: 'up',
    ma20Dir: 'up',
    k: 70,
    d: 60,
    macdHist: 0.5,
  });
  return data;
}

describe('runEntryFilter — GO（合成多頭 fixture，解析案例）', () => {
  const result = runEntryFilter('TEST', makeGoFixture());

  it('decision=GO、entryPattern=回後買上漲、confidence=90', () => {
    expect(result.decision).toBe('GO');
    expect(result.entryPattern).toBe('回後買上漲');
    expect(result.confidence).toBe(90); // 80（SOP 6/6）+ 10（口訣相符）
  });

  it('trend=多頭（頭頭高＋底底高）、無觸犯戒律', () => {
    expect(result.trend).toBe('多頭');
    expect(result.preceptHits).toEqual([]);
  });

  it('停損雙軌：stopPrice=114.95（121*0.95）、預設軌二=中長線MA20（110）', () => {
    expect(result.stopPrice).toBe(114.95);
    expect(result.guardMaLabel).toBe('中長線MA20');
    expect(result.maGuardPrice).toBe(110);
  });

  it('guardLevel=MA5 時軌二改用短線MA5（116）', () => {
    const r5 = runEntryFilter('TEST', makeGoFixture(), undefined, undefined, 'MA5');
    expect(r5.guardMaLabel).toBe('短線MA5');
    expect(r5.maGuardPrice).toBe(116);
    expect(r5.decision).toBe('GO'); // 操作級別不影響決策
  });

  it('（黃金值鎖）六步驟 status 快照全 pass — 值取自現行實作', () => {
    expect(result.steps.map(s => s.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(result.sop.every(s => s.ok)).toBe(true);
  });
});

describe('runEntryFilter — WAIT（GO fixture 去掉攻擊量，解析案例）', () => {
  // 末根 volume 改 1000 → 量比 1.0、5日均量比 1.0 → 無攻擊量 → SOP④✗（5/6）
  // 且「回後買上漲」「盤整突破」皆要求攻擊量 → entryPattern='皆不符' → WAIT
  const data = makeGoFixture();
  data[15].volume = 1000;
  const result = runEntryFilter('TEST', data);

  it('decision=WAIT、entryPattern=皆不符', () => {
    expect(result.decision).toBe('WAIT');
    expect(result.entryPattern).toBe('皆不符');
  });

  it('confidence < 90（SOP 5/6 且無口訣加分）', () => {
    expect(result.confidence).toBeLessThan(90);
  });
});

describe('runEntryFilter — NO_GO（嚴格遞減序列，解析案例）', () => {
  // 20 根自 140 起每根 -2：嚴格遞減無 fractal 轉折 → trend='資料不足' → 非多頭 → NO_GO
  const closes = Array.from({ length: 20 }, (_, i) => 140 - 2 * i);
  const result = runEntryFilter('TEST', makeBars(closes));

  it('decision=NO_GO、trend=資料不足', () => {
    expect(result.decision).toBe('NO_GO');
    expect(result.trend).toBe('資料不足');
  });

  it('confidence <= 30（NO_GO 上限）', () => {
    expect(result.confidence).toBeLessThanOrEqual(30);
  });
});
