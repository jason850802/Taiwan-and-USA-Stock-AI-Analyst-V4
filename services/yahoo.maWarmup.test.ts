// 均線暖身期無值契約行為鎖（收口批次票 02）
// 鎖住 getStockData 管線終點對「均線暖身期」的可觀察輸出：
//   1. 值的無值語意：暖身期 ma5/ma10/ma20/ma60 一律是 undefined（不是 null）。
//   2. 方向欄位：暖身期（含 i=0）一律 'flat'。
//   3. 邊界日（均線第一個有值日）：方向是 'up'——現行實作走「數字 vs null」的
//      ToNumber 強制轉換路徑（null→+0，正股價必大於 0）。這一案是本鎖的解析度來源：
//      若型別收斂誤用「null 視同 undefined 走守衛」的改法，邊界日會翻成 'flat'，此案即紅。
// 資料經 mock fetch 注入（不觸網、不碰真 Yahoo），美股代號走單段路徑避開台股名錄與籌碼抓取。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getStockData } from './yahoo';
import type { StockDataPoint } from '../types';

// 25 根日棒：i=0..21 收盤 100+i（嚴格遞增），i=22..24 收 110/100/90（回落段製造 'down'）。
// 25 < 60 → ma60 全程暖身，鎖「整段無值」情境；ma5/ma10/ma20 各自有暖身、邊界、有值三段。
const CLOSES = [
  100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
  110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
  120, 121, 110, 100, 90,
];

const DAY = 86_400;
const BASE_TS = 1_704_207_600; // 2024-01-02 15:00 UTC（美東盤中，逐日遞增）

const buildChartResponse = () => ({
  chart: {
    result: [
      {
        meta: {
          symbol: 'TSLA',
          longName: 'Tesla, Inc.',
          currency: 'USD',
          exchangeTimezoneName: 'America/New_York',
          regularMarketPrice: CLOSES[CLOSES.length - 1],
        },
        timestamp: CLOSES.map((_, i) => BASE_TS + i * DAY),
        indicators: {
          quote: [
            {
              open: CLOSES.map(c => c - 1),
              high: CLOSES.map(c => c + 2),
              low: CLOSES.map(c => c - 2),
              close: [...CLOSES],
              volume: CLOSES.map((_, i) => 1_000_000 + i),
            },
          ],
        },
      },
    ],
  },
});

describe('均線暖身期無值契約（行為鎖）', () => {
  let data: StockDataPoint[];

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      if (!url.includes('/api/yahoo/chart')) {
        throw new Error(`行為鎖以外的網路請求：${url}`);
      }
      return { ok: true, json: async () => buildChartResponse() };
    }));
    // forceRefresh：繞過快取讀取，保證資料來自本檔注入的 mock fetch
    const result = await getStockData('TSLA', '1d', { forceRefresh: true });
    data = result.data;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('管線不增減棒數：25 根進 25 根出（索引斷言的前提）', () => {
    expect(data.length).toBe(25);
  });

  it('ma5 暖身期（i=0..3）值是 undefined、方向是 flat', () => {
    for (let i = 0; i <= 3; i += 1) {
      expect(data[i].ma5).toBeUndefined();
      expect(data[i].ma5Dir).toBe('flat');
    }
  });

  it('ma5 邊界日（i=4，第一個有值日）：值正確、方向是 up（數字 vs 無值的現行轉換路徑）', () => {
    expect(data[4].ma5).toBe(102); // (100+101+102+103+104)/5
    expect(data[4].ma5Dir).toBe('up');
  });

  it('ma5 有值段方向跟隨數列：遞增段 up、回落段 down', () => {
    for (let i = 5; i <= 21; i += 1) expect(data[i].ma5Dir).toBe('up');
    for (let i = 22; i <= 24; i += 1) expect(data[i].ma5Dir).toBe('down');
  });

  it('ma10 暖身（i=0..8）undefined/flat、邊界日 i=9 值 104.5 且 up、其後 up 至 21、22..24 down', () => {
    for (let i = 0; i <= 8; i += 1) {
      expect(data[i].ma10).toBeUndefined();
      expect(data[i].ma10Dir).toBe('flat');
    }
    expect(data[9].ma10).toBe(104.5); // (100+...+109)/10
    expect(data[9].ma10Dir).toBe('up');
    for (let i = 10; i <= 21; i += 1) expect(data[i].ma10Dir).toBe('up');
    for (let i = 22; i <= 24; i += 1) expect(data[i].ma10Dir).toBe('down');
  });

  it('ma20 暖身（i=0..18）undefined/flat、邊界日 i=19 值 109.5 且 up、20..22 up、23..24 down', () => {
    for (let i = 0; i <= 18; i += 1) {
      expect(data[i].ma20).toBeUndefined();
      expect(data[i].ma20Dir).toBe('flat');
    }
    expect(data[19].ma20).toBe(109.5); // (100+...+119)/20
    expect(data[19].ma20Dir).toBe('up');
    for (let i = 20; i <= 22; i += 1) expect(data[i].ma20Dir).toBe('up');
    for (let i = 23; i <= 24; i += 1) expect(data[i].ma20Dir).toBe('down');
  });

  it('ma60 整段暖身（序列 25 < 60）：全程 undefined、全程 flat', () => {
    for (let i = 0; i < data.length; i += 1) {
      expect(data[i].ma60).toBeUndefined();
      expect(data[i].ma60Dir).toBe('flat');
    }
  });
});
