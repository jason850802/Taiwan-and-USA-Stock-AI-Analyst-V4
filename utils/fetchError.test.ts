// utils/fetchError.test.ts — Phase 12 T3：行情錯誤分類的行為鎖
//
// 這組測試守的是「錯誤的種類能不能跨 seam 傳到 UI」——UI 的失敗文案（限流 vs 後端無回應
// vs 通用）全靠 kind 分流；kind 判錯，使用者就會被指去做錯的處置。
// 測試檔放 utils/ 是沿用現行 vitest 收錄範圍（現況測試全在 utils/）。
import { describe, it, expect } from 'vitest';
import { DataFetchError, classifyCaught } from '../services/fetchError';

describe('DataFetchError', () => {
  it('是 Error 的子類，kind 與 message 都留著', () => {
    const e = new DataFetchError('RATE_LIMIT', 'Fetch error (429)');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(DataFetchError);
    expect(e.kind).toBe('RATE_LIMIT');
    expect(e.message).toBe('Fetch error (429)');
    expect(e.name).toBe('DataFetchError');
  });

  it('穿過 try/catch 重丟後 instanceof 與 kind 不掉', () => {
    const rethrow = () => {
      try {
        throw new DataFetchError('BACKEND_DOWN', 'Fetch error (503)');
      } catch (err) {
        if (err instanceof DataFetchError) throw err;   // yahoo.ts:881 的穿透寫法
        throw new DataFetchError('UNKNOWN', 'wrapped');
      }
    };
    expect(rethrow).toThrow(DataFetchError);
    try { rethrow(); } catch (err: any) {
      expect(err.kind).toBe('BACKEND_DOWN');
      expect(err.message).toBe('Fetch error (503)');
    }
  });
});

describe('classifyCaught', () => {
  it('DataFetchError 直接沿用自己的 kind', () => {
    expect(classifyCaught(new DataFetchError('NOT_FOUND', 'x'))).toBe('NOT_FOUND');
    expect(classifyCaught(new DataFetchError('PARSE', 'x'))).toBe('PARSE');
  });

  it('掛了 status 的錯誤：429 → RATE_LIMIT', () => {
    const e = Object.assign(new Error('FinMind fetch error (429)'), { status: 429 });
    expect(classifyCaught(e)).toBe('RATE_LIMIT');
  });

  it('掛了 status 的錯誤：5xx → BACKEND_DOWN', () => {
    expect(classifyCaught(Object.assign(new Error('x'), { status: 500 }))).toBe('BACKEND_DOWN');
    expect(classifyCaught(Object.assign(new Error('x'), { status: 503 }))).toBe('BACKEND_DOWN');
  });

  it('其他 status（如 404）不猜，回 UNKNOWN', () => {
    expect(classifyCaught(Object.assign(new Error('x'), { status: 404 }))).toBe('UNKNOWN');
  });

  it('TypeError / failed to fetch / NetworkError → NETWORK', () => {
    expect(classifyCaught(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(classifyCaught(new Error('TypeError: failed to fetch'))).toBe('NETWORK');
    expect(classifyCaught(new Error('NetworkError when attempting to fetch resource'))).toBe('NETWORK');
  });

  it('認不出來的一律 UNKNOWN（不亂猜限流）', () => {
    expect(classifyCaught(new Error('something went wrong'))).toBe('UNKNOWN');
    expect(classifyCaught('429')).toBe('UNKNOWN');
    expect(classifyCaught(undefined)).toBe('UNKNOWN');
    expect(classifyCaught(null)).toBe('UNKNOWN');
  });
});
