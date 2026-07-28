// api/_lib/yahoo.test.ts — api/_lib 行為鎖（票 03）：Yahoo 參數驗證＋錯誤分類
//
// 鎖 validateChartParams／validateSearchParams／classifyYahooError 三個純函式的現行行為
// （立場＝行為鎖，不評對錯；放置決策見 docs/adr/0002-api-lib-test-colocation.md）。
// cookie+crumb 握手（fetchYahooWithHandshake 及其私有輔助函式）是首批外，本檔不碰、零網路呼叫。
import { describe, it, expect } from 'vitest';
import {
  validateChartParams,
  validateSearchParams,
  classifyYahooError,
  YahooClassifiedError,
} from './yahoo.js';

// 呼叫 fn() 預期丟出 YahooClassifiedError：先驗 instanceof 與 name，再回傳供呼叫端斷言 code。
function captureYahooError(fn: () => unknown): YahooClassifiedError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(YahooClassifiedError);
    expect((error as YahooClassifiedError).name).toBe('YahooClassifiedError');
    return error as YahooClassifiedError;
  }
  throw new Error('預期呼叫會丟出 YahooClassifiedError，但沒有丟出任何錯誤');
}

describe('validateChartParams', () => {
  describe('INTERVAL_RANGE_MAP 封閉集合內的合法組合逐一上鎖', () => {
    it('1d + 10y', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1d', range: '10y' }))
        .toEqual({ symbol: 'AAPL', interval: '1d', range: '10y' });
    });

    it('1d + 5d', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1d', range: '5d' }))
        .toEqual({ symbol: 'AAPL', interval: '1d', range: '5d' });
    });

    it('1d + 2y', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1d', range: '2y' }))
        .toEqual({ symbol: 'AAPL', interval: '1d', range: '2y' });
    });

    it('1wk + 5y', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1wk', range: '5y' }))
        .toEqual({ symbol: 'AAPL', interval: '1wk', range: '5y' });
    });

    it('1mo + max', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1mo', range: 'max' }))
        .toEqual({ symbol: 'AAPL', interval: '1mo', range: 'max' });
    });

    it('1mo + 15y', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1mo', range: '15y' }))
        .toEqual({ symbol: 'AAPL', interval: '1mo', range: '15y' });
    });

    it('60m + 1y', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '60m', range: '1y' }))
        .toEqual({ symbol: 'AAPL', interval: '60m', range: '1y' });
    });

    it('15m + 60d', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '15m', range: '60d' }))
        .toEqual({ symbol: 'AAPL', interval: '15m', range: '60d' });
    });
  });

  it('interval 與 range 錯配時拒收（1d 搭 1wk 專屬的 5y）', () => {
    const err = captureYahooError(() =>
      validateChartParams({ symbol: 'AAPL', interval: '1d', range: '5y' }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('不在封閉集合內的 interval 拒收', () => {
    const err = captureYahooError(() =>
      validateChartParams({ symbol: 'AAPL', interval: '1h', range: '1y' }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  describe('三種代號樣式各取合法例（固定用 1d/10y，只變動 symbol）', () => {
    it('台股：2330.TW', () => {
      expect(validateChartParams({ symbol: '2330.TW', interval: '1d', range: '10y' }))
        .toEqual({ symbol: '2330.TW', interval: '1d', range: '10y' });
    });

    it('台股（上櫃）：6547.TWO', () => {
      expect(validateChartParams({ symbol: '6547.TWO', interval: '1d', range: '10y' }))
        .toEqual({ symbol: '6547.TWO', interval: '1d', range: '10y' });
    });

    it('海外：AAPL', () => {
      expect(validateChartParams({ symbol: 'AAPL', interval: '1d', range: '10y' }))
        .toEqual({ symbol: 'AAPL', interval: '1d', range: '10y' });
    });

    it('海外含後綴：BRK.B', () => {
      expect(validateChartParams({ symbol: 'BRK.B', interval: '1d', range: '10y' }))
        .toEqual({ symbol: 'BRK.B', interval: '1d', range: '10y' });
    });

    it('匯率：TWD=X', () => {
      expect(validateChartParams({ symbol: 'TWD=X', interval: '1d', range: '10y' }))
        .toEqual({ symbol: 'TWD=X', interval: '1d', range: '10y' });
    });
  });

  it('小寫代號被大寫化後通過，回傳值是大寫', () => {
    expect(validateChartParams({ symbol: 'aapl', interval: '1d', range: '10y' }))
      .toEqual({ symbol: 'AAPL', interval: '1d', range: '10y' });
  });

  describe('非法代號拒收', () => {
    it('過長的海外代號（7 碼，超過樣式上限 6 碼）', () => {
      const err = captureYahooError(() =>
        validateChartParams({ symbol: 'ABCDEFG', interval: '1d', range: '10y' }));
      expect(err.code).toBe('BAD_REQUEST');
    });

    it('含數字的海外碼（三種樣式都不匹配）', () => {
      const err = captureYahooError(() =>
        validateChartParams({ symbol: 'ABC1', interval: '1d', range: '10y' }));
      expect(err.code).toBe('BAD_REQUEST');
    });

    it('空字串代號', () => {
      const err = captureYahooError(() =>
        validateChartParams({ symbol: '', interval: '1d', range: '10y' }));
      expect(err.code).toBe('BAD_REQUEST');
    });
  });
});

describe('validateSearchParams', () => {
  it('q 為空字串時拒收（必填）', () => {
    const err = captureYahooError(() => validateSearchParams({ q: '' }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('q 只有空白時 trim 後為空字串，視同未填，拒收', () => {
    const err = captureYahooError(() => validateSearchParams({ q: '   ' }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('q 前後空白會被 trim 掉，只留中間內容', () => {
    expect(validateSearchParams({ q: '  AAPL  ' })).toEqual({ q: 'AAPL', limit: 8 });
  });

  it('q 長度剛好 100 通過', () => {
    const q = 'A'.repeat(100);
    expect(validateSearchParams({ q })).toEqual({ q, limit: 8 });
  });

  it('q 長度 101 拒收（超過上限）', () => {
    const q = 'A'.repeat(101);
    const err = captureYahooError(() => validateSearchParams({ q }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('limit 未給時預設 8', () => {
    expect(validateSearchParams({ q: 'AAPL' })).toEqual({ q: 'AAPL', limit: 8 });
  });

  it('limit 下界 1 通過', () => {
    expect(validateSearchParams({ q: 'AAPL', limit: 1 })).toEqual({ q: 'AAPL', limit: 1 });
  });

  it('limit 上界 20 通過', () => {
    expect(validateSearchParams({ q: 'AAPL', limit: 20 })).toEqual({ q: 'AAPL', limit: 20 });
  });

  it('limit 0 拒收（低於下界）', () => {
    const err = captureYahooError(() => validateSearchParams({ q: 'AAPL', limit: 0 }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('limit 21 拒收（超過上界）', () => {
    const err = captureYahooError(() => validateSearchParams({ q: 'AAPL', limit: 21 }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('limit 1.5 拒收（非整數）', () => {
    const err = captureYahooError(() => validateSearchParams({ q: 'AAPL', limit: 1.5 }));
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('limit 是數字字串時會被 Number() 轉型後通過——現行行為，照鎖不評對錯', () => {
    // query 物件實際來自 URL query string、型別是 unknown；字串 '5' 經 Number() 轉型為 5，
    // 通過整數界線檢查。回傳值是數字 5，不是字串 '5'。
    expect(validateSearchParams({ q: 'AAPL', limit: '5' })).toEqual({ q: 'AAPL', limit: 5 });
  });
});

describe('classifyYahooError', () => {
  it('name 為 AbortError → UPSTREAM_ERROR', () => {
    const error = Object.assign(new Error('x'), { name: 'AbortError' });
    const result = classifyYahooError(error);
    expect(result).toBeInstanceOf(YahooClassifiedError);
    expect(result.name).toBe('YahooClassifiedError');
    expect(result.code).toBe('UPSTREAM_ERROR');
  });

  it('name 為 TimeoutError → UPSTREAM_ERROR', () => {
    const error = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(classifyYahooError(error).code).toBe('UPSTREAM_ERROR');
  });

  it('訊息含 aborted（不分大小寫）→ UPSTREAM_ERROR', () => {
    expect(classifyYahooError(new Error('The operation was Aborted')).code).toBe('UPSTREAM_ERROR');
  });

  it('訊息含 timed out → UPSTREAM_ERROR', () => {
    expect(classifyYahooError(new Error('request timed out')).code).toBe('UPSTREAM_ERROR');
  });

  it('已是 YahooClassifiedError（RATE_LIMITED）原樣穿透，code 不被蓋掉', () => {
    const original = new YahooClassifiedError('RATE_LIMITED');
    const result = classifyYahooError(original);
    expect(result).toBe(original);
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('已是 YahooClassifiedError（NOT_FOUND）原樣穿透，code 不被蓋掉', () => {
    const original = new YahooClassifiedError('NOT_FOUND');
    const result = classifyYahooError(original);
    expect(result).toBe(original);
    expect(result.code).toBe('NOT_FOUND');
  });

  it('認不出來的一般錯誤，一律 fallback 成 UPSTREAM_ERROR', () => {
    expect(classifyYahooError(new Error('something else')).code).toBe('UPSTREAM_ERROR');
  });

  it('undefined／null／純字串等非 Error 物件，一律 UPSTREAM_ERROR', () => {
    expect(classifyYahooError(undefined).code).toBe('UPSTREAM_ERROR');
    expect(classifyYahooError(null).code).toBe('UPSTREAM_ERROR');
    expect(classifyYahooError('plain string error').code).toBe('UPSTREAM_ERROR');
  });

  it('任何輸入的回傳值都是 YahooClassifiedError 實例', () => {
    expect(classifyYahooError(new Error('x'))).toBeInstanceOf(YahooClassifiedError);
    expect(classifyYahooError('x')).toBeInstanceOf(YahooClassifiedError);
  });
});
