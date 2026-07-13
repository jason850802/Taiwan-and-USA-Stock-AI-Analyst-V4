// utils/math.test.ts — D-3 最小單元測試：鎖住技術指標計算的現行行為
// 測試分兩層（SUMMARY 依此誠實區分）：
//   (a) 解析案例＝手算可驗的已知輸入輸出（常數／線性序列的可推導性質）
//   (b) 黃金值回歸鎖＝用「現行實作」對固定種子序列跑出的輸出寫死——只鎖行為防改壞，不證明數學正確性
import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateKDJ,
} from './math';

// ---------- (a) 解析案例 ----------

describe('calculateSMA（解析案例）', () => {
  it('data 長度小於 period 時回傳全 null', () => {
    expect(calculateSMA([1, 2], 3)).toEqual([null, null]);
  });

  it('常數序列 [5,5,5,5,5] period 3 → [null,null,5,5,5]', () => {
    expect(calculateSMA([5, 5, 5, 5, 5], 3)).toEqual([null, null, 5, 5, 5]);
  });

  it('線性序列 [1..6] period 3 → [null,null,2,3,4,5]', () => {
    expect(calculateSMA([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });
});

describe('calculateEMA（解析案例）', () => {
  it('data 長度小於 period 時回傳全 null', () => {
    expect(calculateEMA([1, 2], 3)).toEqual([null, null]);
  });

  it('常數序列自 index period-1 起恆等於該常數', () => {
    const out = calculateEMA([7, 7, 7, 7, 7, 7], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    for (let i = 2; i < out.length; i++) expect(out[i]).toBeCloseTo(7, 10);
  });

  it('[1,2,3,4,5] period 3 → [null,null,2,3,4]（SMA 種子 2、k=0.5 手算）', () => {
    const out = calculateEMA([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 10);
    expect(out[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 10); // 5*0.5 + 3*0.5
  });
});

describe('calculateRSI（解析案例）', () => {
  it('data 長度 < period+1 時回傳全 null', () => {
    const out = calculateRSI([1, 2, 3], 14);
    expect(out).toEqual([null, null, null]);
  });

  it('嚴格遞增序列（1..17，period 14）自 index 14 起為 100（avgLoss=0 分支）', () => {
    const data = Array.from({ length: 17 }, (_, i) => i + 1);
    const out = calculateRSI(data, 14);
    for (let i = 0; i < 14; i++) expect(out[i]).toBeNull();
    for (let i = 14; i < 17; i++) expect(out[i]).toBeCloseTo(100, 10);
  });

  it('嚴格遞減序列自 index 14 起為 0', () => {
    const data = Array.from({ length: 17 }, (_, i) => 100 - i);
    const out = calculateRSI(data, 14);
    for (let i = 0; i < 14; i++) expect(out[i]).toBeNull();
    for (let i = 14; i < 17; i++) expect(out[i]).toBeCloseTo(0, 10);
  });
});

describe('calculateMACD（解析案例——鎖非標準參數 10,20,10）', () => {
  it('常數序列：macdLine 自 idx19 起 ~0、signalLine 自 idx28 起 ~0、histogram ~0', () => {
    const data = new Array(40).fill(50);
    const { macdLine, signalLine, histogram } = calculateMACD(data);
    for (let i = 19; i < 40; i++) expect(macdLine[i]).toBeCloseTo(0, 10);
    for (let i = 28; i < 40; i++) expect(signalLine[i]).toBeCloseTo(0, 10);
    for (let i = 28; i < 40; i++) expect(histogram[i]).toBeCloseTo(0, 10);
  });

  it('warm-up 邊界鎖參數：macdLine[18]=null/[19]≠null（slow=20）、signalLine[27]=null/[28]≠null（validStart 19＋signal 10）', () => {
    const data = new Array(40).fill(50);
    const { macdLine, signalLine } = calculateMACD(data);
    expect(macdLine[18]).toBeNull();
    expect(macdLine[19]).not.toBeNull();
    expect(signalLine[27]).toBeNull();
    expect(signalLine[28]).not.toBeNull();
  });

  it('線性遞增序列 warm-up 後 macdLine 每一項 > 0（快線減慢線對上升趨勢恆正）', () => {
    const data = Array.from({ length: 40 }, (_, i) => i + 1);
    const { macdLine } = calculateMACD(data);
    for (let i = 19; i < 40; i++) {
      expect(macdLine[i]).not.toBeNull();
      expect(macdLine[i]!).toBeGreaterThan(0);
    }
  });

  it('預設參數即 10,20,10：與顯式 (10,20,10) 逐項相等，且與 (12,26,9) 不同', () => {
    const data = Array.from({ length: 40 }, (_, i) => i + 1);
    const def = calculateMACD(data);
    const explicit = calculateMACD(data, 10, 20, 10);
    expect(def).toEqual(explicit);

    const standard = calculateMACD(data, 12, 26, 9);
    // warm-up 邊界不同（12/26/9 的 macdLine 自 idx25 才有值）
    expect(def.macdLine[19]).not.toBeNull();
    expect(standard.macdLine[19]).toBeNull();
    // warm-up 後至少一個 index 值不同
    expect(def.macdLine[30]).not.toBeNull();
    expect(standard.macdLine[30]).not.toBeNull();
    expect(def.macdLine[30]).not.toBeCloseTo(standard.macdLine[30]!, 6);
  });
});

describe('calculateBollingerBands（解析案例）', () => {
  it('data 長度小於 period 時回傳全 null', () => {
    const { upper, middle, lower } = calculateBollingerBands([1, 2], 3, 2);
    expect(upper).toEqual([null, null]);
    expect(middle).toEqual([null, null]);
    expect(lower).toEqual([null, null]);
  });

  it('常數序列 upper===middle===lower===常數', () => {
    const { upper, middle, lower } = calculateBollingerBands([4, 4, 4, 4], 3, 2);
    for (let i = 2; i < 4; i++) {
      expect(upper[i]).toBeCloseTo(4, 10);
      expect(middle[i]).toBeCloseTo(4, 10);
      expect(lower[i]).toBeCloseTo(4, 10);
    }
  });

  it('[1,2,3,4] period 3 multiplier 2 → middle[2]=2、upper[2]=2+2*sqrt(2/3)', () => {
    const { upper, middle, lower } = calculateBollingerBands([1, 2, 3, 4], 3, 2);
    expect(middle[2]).toBeCloseTo(2, 5);
    expect(upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 5);
    expect(lower[2]).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 5);
    expect(middle[3]).toBeCloseTo(3, 5);
  });
});

describe('calculateKDJ（解析案例——鎖非標準參數 period=5＋1/3,2/3 平滑）', () => {
  it('常數序列（maxHigh===minLow → rsv=50）K/D/J 全程 50', () => {
    const c = new Array(10).fill(30);
    const { K, D, J } = calculateKDJ(c, c, c);
    for (let i = 0; i < 10; i++) {
      expect(K[i]).toBeCloseTo(50, 10);
      expect(D[i]).toBeCloseTo(50, 10);
      expect(J[i]).toBeCloseTo(50, 10);
    }
  });

  it('warm-up 鎖參數：變動序列 index 0..3 的 K/D/J 維持初始值 50（loop 自 period-1=4 起）', () => {
    const c = Array.from({ length: 10 }, (_, i) => i + 1);
    const { K, D, J } = calculateKDJ(c, c, c);
    for (let i = 0; i <= 3; i++) {
      expect(K[i]).toBe(50);
      expect(D[i]).toBe(50);
      expect(J[i]).toBe(50);
    }
    expect(K[4]).not.toBe(50);
  });

  it('遞增序列手算：K[4]=200/3、D[4]=500/9、J[4]=3K-2D；K 單調遞增且 K/D 落在 [0,100]', () => {
    const c = Array.from({ length: 20 }, (_, i) => i + 1);
    const { K, D, J } = calculateKDJ(c, c, c);
    expect(K[4]).toBeCloseTo(200 / 3, 4);
    expect(D[4]).toBeCloseTo(500 / 9, 4);
    expect(J[4]).toBeCloseTo(3 * (200 / 3) - 2 * (500 / 9), 4);
    for (let i = 5; i < 20; i++) {
      expect(K[i]).toBeGreaterThan(K[i - 1]);
      expect(K[i]).toBeLessThanOrEqual(100);
      expect(K[i]).toBeGreaterThanOrEqual(0);
      expect(D[i]).toBeLessThanOrEqual(100);
      expect(D[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('預設 period 即 5：與顯式 period=5 相等、與 period=9 對變動序列不同', () => {
    const c = Array.from({ length: 20 }, (_, i) => i + 1);
    const def = calculateKDJ(c, c, c);
    const explicit = calculateKDJ(c, c, c, 5);
    expect(def).toEqual(explicit);

    const p9 = calculateKDJ(c, c, c, 9);
    // period=9 的 loop 自 idx8 起，idx4 仍為初始 50 → 與 period=5 不同
    expect(p9.K[4]).toBe(50);
    expect(def.K[4]).not.toBe(50);
  });
});

// ---------- (b) 黃金值回歸鎖 ----------
// golden regression lock — 以下數值取自「現行實作」對固定種子序列的輸出，非獨立推導。
// 只鎖行為防改壞，不證明數學正確性。

/** 固定種子 LCG（seed 42）：x=(x*1664525+1013904223)>>>0，price=100+(x/2^32)*10 */
function lcgSeries(n: number, seed = 42): number[] {
  const out: number[] = [];
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out.push(100 + (x / 2 ** 32) * 10);
  }
  return out;
}

describe('黃金值回歸鎖（golden regression lock — 值取自現行實作，非獨立推導）', () => {
  const closes = lcgSeries(60);
  const highs = closes.map(c => c + 1);
  const lows = closes.map(c => c - 1);

  it('calculateMACD(series) 預設參數對 LCG(seed 42, n=60) 的末端輸出', () => {
    const { macdLine, signalLine, histogram } = calculateMACD(closes);
    expect(macdLine[59]).toBeCloseTo(0.3429522172797874, 8);
    expect(signalLine[59]).toBeCloseTo(-0.011506701317399247, 8);
    expect(histogram[59]).toBeCloseTo(0.35445891859718665, 8);
  });

  it('calculateKDJ(highs,lows,closes) 預設 period 對 LCG(seed 42, n=60) 的末端輸出', () => {
    const { K, D, J } = calculateKDJ(highs, lows, closes);
    expect(K[59]).toBeCloseTo(58.37497993493505, 8);
    expect(D[59]).toBeCloseTo(58.48109504960816, 8);
    expect(J[59]).toBeCloseTo(58.16274970558882, 8);
  });

  it('calculateRSI 常數序列現行怪行為鎖（疑似 bug——僅鎖行為，見 SUMMARY「發現但不修」）', () => {
    // 常數序列：初始窗 gains=losses=0 → avgGain/avgLoss = 0/0 = NaN → rsi[14] = NaN；
    // 之後 avgLoss===0 分支 → 恆為 100。此為現行實作行為，非數學上合理的 RSI 定義。
    const data = new Array(20).fill(10);
    const out = calculateRSI(data, 14);
    expect(out[14]).toBeNaN();
    for (let i = 15; i < 20; i++) expect(out[i]).toBe(100);
  });
});
