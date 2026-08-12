import { describe, expect, it } from 'vitest';
import { isLatestPriceCacheFresh, latestPriceCacheKey } from './quoteCache';
import { peekLatestPrice } from './yahoo';

describe('latestPriceCacheKey', () => {
  it('報價鍵使用獨立命名空間且正規化代碼', () => {
    const key = latestPriceCacheKey(' 2330.tw ');

    expect(key).toBe('latest|2330.TW');
    expect(key).not.toBe('2330.TW|1d');
  });
});

describe('isLatestPriceCacheFresh', () => {
  it('匯率代碼固定沿用 60 分鐘', () => {
    const cachedAt = Date.UTC(2026, 7, 13, 12, 0);

    expect(isLatestPriceCacheFresh(cachedAt, cachedAt + 59 * 60_000, 'usdtwd=x')).toBe(true);
    expect(isLatestPriceCacheFresh(cachedAt, cachedAt + 61 * 60_000, 'USDTWD=X')).toBe(false);
  });

  it('匯率旁路不受美股盤中或盤後影響', () => {
    const marketOpenCachedAt = Date.UTC(2026, 7, 13, 14, 0); // 紐約夏令時間 10:00
    const marketClosedCachedAt = Date.UTC(2026, 7, 13, 22, 0); // 紐約夏令時間 18:00

    expect(isLatestPriceCacheFresh(
      marketOpenCachedAt,
      marketOpenCachedAt + 30 * 60_000,
      'USDTWD=X',
    )).toBe(true);
    expect(isLatestPriceCacheFresh(
      marketClosedCachedAt,
      marketClosedCachedAt + 30 * 60_000,
      'USDTWD=X',
    )).toBe(true);
  });

  it('匯率代碼與一般美股在同一組盤中時刻走不同沿用窗', () => {
    const cachedAt = Date.UTC(2026, 7, 13, 14, 0); // 紐約夏令時間 10:00
    const now = cachedAt + 30 * 60_000;

    expect(isLatestPriceCacheFresh(cachedAt, now, 'USDTWD=X')).toBe(true);
    expect(isLatestPriceCacheFresh(cachedAt, now, 'AAPL')).toBe(false);
  });

  it('台股盤中只沿用 10 分鐘', () => {
    const cachedAt = Date.UTC(2026, 7, 13, 2, 0); // 台北 10:00

    expect(isLatestPriceCacheFresh(cachedAt, cachedAt + 9 * 60_000, '2330.TW')).toBe(true);
    expect(isLatestPriceCacheFresh(cachedAt, cachedAt + 11 * 60_000, '2330.TW')).toBe(false);
  });

  it('台股週五收盤後寫入可沿用到週六', () => {
    const fridayAfterClose = Date.UTC(2026, 7, 14, 6, 0); // 台北週五 14:00
    const saturdayNoon = Date.UTC(2026, 7, 15, 4, 0); // 台北週六 12:00

    expect(isLatestPriceCacheFresh(fridayAfterClose, saturdayNoon, '2330.TW')).toBe(true);
  });

  it('台股週五收盤後快取跨越下週一開盤即過期', () => {
    const fridayAfterClose = Date.UTC(2026, 7, 14, 6, 0); // 台北週五 14:00
    const mondayAfterOpen = Date.UTC(2026, 7, 17, 1, 1); // 台北週一 09:01

    expect(isLatestPriceCacheFresh(fridayAfterClose, mondayAfterOpen, '2330.TW')).toBe(false);
  });

  it('台股盤中寫入但讀取時已收盤即過期', () => {
    const marketOpenCachedAt = Date.UTC(2026, 7, 13, 2, 0); // 台北 10:00
    const afterClose = Date.UTC(2026, 7, 13, 6, 0); // 台北 14:00

    expect(isLatestPriceCacheFresh(marketOpenCachedAt, afterClose, '2330.TW')).toBe(false);
  });
});

describe('peekLatestPrice', () => {
  it('快取全空時同步回傳 null', () => {
    expect(peekLatestPrice('__NO_LATEST_PRICE_CACHE__')).toBeNull();
  });
});
