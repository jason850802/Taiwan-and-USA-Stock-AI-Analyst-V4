import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePortfolioHealth, type PortfolioHealthItem } from '../services/gemini';
import type { StockDataPoint } from '../types';

type CapturedRequest = {
  url: string;
  payload: Record<string, unknown>;
};

const healthItem: PortfolioHealthItem = {
  symbol: '2330.TW',
  name: '台積電',
  avgCostPrice: 900,
  currentPrice: 1040,
  totalShares: 1000,
  profitPct: 15.56,
  recentData: [{
    date: '2026-08-13',
    open: 1030,
    high: 1050,
    low: 1025,
    close: 1040,
    volume: 20_000_000,
  } as StockDataPoint],
  volumeProjection: null,
};

describe('analyzePortfolioHealth 的傳輸路徑', () => {
  const captured: CapturedRequest[] = [];

  beforeEach(() => {
    captured.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body: string }) => {
      captured.push({
        url: String(url),
        payload: JSON.parse(init.body) as Record<string, unknown>,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: '完整健檢報告' }),
      };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('有部分結果 callback 時改走串流，且 payload 與非串流逐字相同', async () => {
    await analyzePortfolioHealth([healthItem]);
    expect(captured).toHaveLength(1);
    const nonStream = captured[0];

    captured.length = 0;
    await expect(analyzePortfolioHealth([healthItem], () => {})).rejects.toThrow();
    expect(captured).toHaveLength(1);
    const stream = captured[0];

    expect(nonStream.url).toBe('/api/gemini');
    expect(stream.url).toBe('/api/gemini-stream');
    expect(stream.payload).toEqual(nonStream.payload);
  });
});
