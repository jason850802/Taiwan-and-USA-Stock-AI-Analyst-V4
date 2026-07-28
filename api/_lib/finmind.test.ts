// api/_lib/finmind.test.ts — api/_lib 行為鎖（票 02）：FinMind 代理的參數驗證、快取秒數、錯誤分類
//
// 立場＝行為鎖：照現行行為寫斷言，不評對錯（含怪行為）。放置決策見
// docs/adr/0002-api-lib-test-colocation.md，不在此重述。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ALLOWED_DATASETS,
  validateFinMindParams,
  secondsUntilTaipeiMidnight,
  cacheSecondsForDataset,
  classifyFinMindError,
  FinMindClassifiedError,
} from './finmind.js';

describe('validateFinMindParams', () => {
  describe('dataset 白名單', () => {
    // 逐字鎖這 9 個，不從模組匯出反推——白名單被刪一項時，若拿模組自己的匯出值當
    // 測試資料來源，兩邊會一起變短，測試永遠綠。這裡改用寫死的字面陣列才鎖得住。
    const EXPECTED_ALLOWED_DATASETS = [
      'TaiwanStockInstitutionalInvestorsBuySell',
      'TaiwanStockPrice',
      'TaiwanStockInfo',
      'TaiwanStockFinancialStatements',
      'TaiwanStockBalanceSheet',
      'TaiwanStockCashFlowsStatement',
      'TaiwanStockPER',
      'TaiwanStockMonthRevenue',
      'TaiwanStockDividend',
    ];

    it('匯出的白名單常數逐字等於這 9 個，不多不少、順序也鎖住', () => {
      expect(ALLOWED_DATASETS).toEqual(EXPECTED_ALLOWED_DATASETS);
    });

    it('白名單內每一個 dataset 都放行', () => {
      EXPECTED_ALLOWED_DATASETS.forEach(dataset => {
        expect(() => validateFinMindParams({ dataset })).not.toThrow();
      });
    });

    it('白名單外的 dataset 丟 BAD_REQUEST——這是「不成為任意資料代理」的紅線', () => {
      expect(() => validateFinMindParams({ dataset: 'SomeRandomDataset' })).toThrow(FinMindClassifiedError);
      try {
        validateFinMindParams({ dataset: 'SomeRandomDataset' });
      } catch (err: any) {
        expect(err.code).toBe('BAD_REQUEST');
      }
    });

    it('dataset 未提供時視同不在白名單，丟 BAD_REQUEST', () => {
      expect(() => validateFinMindParams({})).toThrow(FinMindClassifiedError);
    });

    it('dataset 前後空白會被 trim 再比對白名單，回傳值也是 trim 過的', () => {
      const result = validateFinMindParams({ dataset: '  TaiwanStockPrice  ' });
      expect(result.dataset).toBe('TaiwanStockPrice');
    });
  });

  describe('data_id 代號樣式', () => {
    it('.TW 去尾＋大寫化', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '2330.TW' }).dataId).toBe('2330');
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '2330.tw' }).dataId).toBe('2330');
    });

    it('.TWO 去尾＋大寫化，含帶字母尾碼的代號', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '6488.TWO' }).dataId).toBe('6488');
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '2884a.two' }).dataId).toBe('2884A');
    });

    it('沒有 .TW／.TWO 尾碼時原樣大寫化', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '2330' }).dataId).toBe('2330');
    });

    it('樣式不符（無數字、位數不足、位數超界、超過一個字母尾碼）一律拒收', () => {
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: 'ABC' })).toThrow(FinMindClassifiedError);
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '12' })).toThrow(FinMindClassifiedError);
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '12345678' })).toThrow(FinMindClassifiedError);
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '2330AB' })).toThrow(FinMindClassifiedError);
    });

    it('data_id 未提供或空字串時不驗樣式，回傳 undefined', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice' }).dataId).toBeUndefined();
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '' }).dataId).toBeUndefined();
    });

    it('data_id 只有空白字元時 trim 後為空，等同未提供，不觸發樣式檢查', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', data_id: '   ' }).dataId).toBeUndefined();
    });
  });

  describe('start_date 日期樣式', () => {
    it('YYYY-MM-DD 樣式放行', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', start_date: '2024-01-01' }).startDate).toBe('2024-01-01');
    });

    it('樣式不符（用斜線分隔、月日非兩位數）一律拒收', () => {
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', start_date: '2024/01/01' })).toThrow(FinMindClassifiedError);
      expect(() => validateFinMindParams({ dataset: 'TaiwanStockPrice', start_date: '2024-1-1' })).toThrow(FinMindClassifiedError);
    });

    it('怪行為：只驗格式不驗真實曆法，「9999-99-99」結構符合就放行', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', start_date: '9999-99-99' }).startDate).toBe('9999-99-99');
    });

    it('start_date 未提供或空字串時不驗樣式，回傳 undefined', () => {
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice' }).startDate).toBeUndefined();
      expect(validateFinMindParams({ dataset: 'TaiwanStockPrice', start_date: '' }).startDate).toBeUndefined();
    });
  });

  describe('query 值為陣列時的取值行為', () => {
    it('陣列取第一個字串元素，其餘元素略過', () => {
      const result = validateFinMindParams({
        dataset: ['TaiwanStockPrice', 'ignored-second-item'],
        data_id: ['2330.TW'],
      });
      expect(result.dataset).toBe('TaiwanStockPrice');
      expect(result.dataId).toBe('2330');
    });

    it('陣列第一個元素不是字串時視同空字串，落到白名單拒收', () => {
      expect(() => validateFinMindParams({ dataset: [123] })).toThrow(FinMindClassifiedError);
    });

    it('空陣列視同空字串，落到白名單拒收', () => {
      expect(() => validateFinMindParams({ dataset: [] })).toThrow(FinMindClassifiedError);
    });
  });

  it('三個欄位都給時，回傳物件的完整形狀', () => {
    expect(validateFinMindParams({
      dataset: 'TaiwanStockPrice',
      data_id: '2330.TW',
      start_date: '2024-01-01',
    })).toEqual({
      dataset: 'TaiwanStockPrice',
      dataId: '2330',
      startDate: '2024-01-01',
    });
  });
});

describe('secondsUntilTaipeiMidnight 與 cacheSecondsForDataset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('白天中段：UTC 04:00（台北 12:00）→ 距午夜 43200 秒', () => {
    vi.setSystemTime(new Date('2026-07-28T04:00:00.000Z'));
    expect(secondsUntilTaipeiMidnight()).toBe(43200);
  });

  it('跨日前極近午夜：實際只剩 30 秒時，地板頂到 60 秒', () => {
    // 台北 23:59:30，UTC 為同日 15:59:30。
    vi.setSystemTime(new Date('2026-07-28T15:59:30.000Z'));
    expect(secondsUntilTaipeiMidnight()).toBe(60);
  });

  it('午夜整點：台北 00:00:00 當下，距下一個午夜是完整一天 86400 秒', () => {
    // 台北 2026-07-28 00:00:00，UTC 為前一日 16:00:00。
    vi.setSystemTime(new Date('2026-07-27T16:00:00.000Z'));
    expect(secondsUntilTaipeiMidnight()).toBe(86400);
  });

  it('季更／年度公告類 dataset 固定 259200 秒，不隨時間變', () => {
    vi.setSystemTime(new Date('2026-07-28T04:00:00.000Z'));
    expect(cacheSecondsForDataset('TaiwanStockFinancialStatements')).toBe(259200);
    expect(cacheSecondsForDataset('TaiwanStockBalanceSheet')).toBe(259200);
    expect(cacheSecondsForDataset('TaiwanStockCashFlowsStatement')).toBe(259200);
    expect(cacheSecondsForDataset('TaiwanStockDividend')).toBe(259200);

    // 換到跨日前近午夜，長快取一樣不動——證明是固定值，不是剛好算出來的。
    vi.setSystemTime(new Date('2026-07-28T15:59:30.000Z'));
    expect(cacheSecondsForDataset('TaiwanStockDividend')).toBe(259200);
  });

  it('非長快取 dataset 沿用台北午夜到期的秒數', () => {
    vi.setSystemTime(new Date('2026-07-28T04:00:00.000Z'));
    expect(cacheSecondsForDataset('TaiwanStockPrice')).toBe(43200);
    expect(cacheSecondsForDataset('TaiwanStockInstitutionalInvestorsBuySell')).toBe(43200);
  });

  it('本函式不驗證 dataset 是否在白名單內，未知字串一樣走短快取路徑', () => {
    vi.setSystemTime(new Date('2026-07-28T04:00:00.000Z'));
    expect(cacheSecondsForDataset('NotARealDataset')).toBe(43200);
  });
});

describe('classifyFinMindError', () => {
  it('已經是 FinMindClassifiedError 時原樣穿透，不重包也不改 code', () => {
    const original = new FinMindClassifiedError('BAD_REQUEST');
    const result = classifyFinMindError(original);
    expect(result).toBe(original);
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.name).toBe('FinMindClassifiedError');
  });

  it('status 402 → RATE_LIMITED', () => {
    const result = classifyFinMindError({ status: 402 });
    expect(result).toBeInstanceOf(FinMindClassifiedError);
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.name).toBe('FinMindClassifiedError');
  });

  it('status 429 → RATE_LIMITED', () => {
    const result = classifyFinMindError(Object.assign(new Error('x'), { status: 429 }));
    expect(result).toBeInstanceOf(FinMindClassifiedError);
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.name).toBe('FinMindClassifiedError');
  });

  it('status 為數字字串時，會被 Number() 轉型後一併參與限流判斷', () => {
    expect(classifyFinMindError({ status: '429' }).code).toBe('RATE_LIMITED');
  });

  it('訊息含 upper limit（不分大小寫）→ RATE_LIMITED', () => {
    const result = classifyFinMindError(new Error('You have reached the UPPER LIMIT for this API'));
    expect(result).toBeInstanceOf(FinMindClassifiedError);
    expect(result.code).toBe('RATE_LIMITED');
    expect(result.name).toBe('FinMindClassifiedError');
  });

  it('訊息含 rate limit（不分大小寫）→ RATE_LIMITED', () => {
    expect(classifyFinMindError(new Error('Rate Limit exceeded, try again later')).code).toBe('RATE_LIMITED');
  });

  it('AbortError name → UPSTREAM_ERROR', () => {
    const result = classifyFinMindError(Object.assign(new Error('x'), { name: 'AbortError' }));
    expect(result).toBeInstanceOf(FinMindClassifiedError);
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.name).toBe('FinMindClassifiedError');
  });

  it('訊息含 timeout／timed out → UPSTREAM_ERROR', () => {
    const result = classifyFinMindError(new Error('Request timeout'));
    expect(result).toBeInstanceOf(FinMindClassifiedError);
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.name).toBe('FinMindClassifiedError');
    expect(classifyFinMindError(new Error('The request timed out')).code).toBe('UPSTREAM_ERROR');
  });

  it('訊息含 aborted（name 不是 AbortError）→ UPSTREAM_ERROR——訊息路與 name 路是兩條獨立判定', () => {
    expect(classifyFinMindError(new Error('The operation was aborted')).code).toBe('UPSTREAM_ERROR');
  });

  it('其餘一律預設 UPSTREAM_ERROR，含 undefined／null／字串／無關欄位的物件', () => {
    expect(classifyFinMindError(undefined).code).toBe('UPSTREAM_ERROR');
    expect(classifyFinMindError(null).code).toBe('UPSTREAM_ERROR');
    expect(classifyFinMindError('boom').code).toBe('UPSTREAM_ERROR');
    expect(classifyFinMindError({}).code).toBe('UPSTREAM_ERROR');
    expect(classifyFinMindError(new Error('something unrelated went wrong')).code).toBe('UPSTREAM_ERROR');
  });
});
