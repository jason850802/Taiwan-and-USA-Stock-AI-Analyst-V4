// components/portfolio/useHoldingPrices.test.ts — 報價抓取失敗時的狀態
//
// 鎖什麼（2026-10-01 使用者拍板：live 快照比照缺價日）：查無行情（NOT_FOUND）是永久的，
// 要跟限流、後端沒開這些暫時失敗分開標——每日快照據此只讓查無那檔不擋整個市場。
// 兩者對畫面都是「讀取失敗」（error: true），差別只在 notFound。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { DataFetchError } from '../../services/fetchError';
import { failedQuote } from './useHoldingPrices';

describe('failedQuote｜報價抓取失敗的狀態', () => {
  it('查無行情（NOT_FOUND）→ 讀取失敗，另標 notFound', () => {
    expect(failedQuote('XYZ', new DataFetchError('NOT_FOUND', 'Symbol XYZ not found.')))
      .toEqual({ price: 0, name: 'XYZ', loading: false, error: true, notFound: true });
  });

  it.each(['RATE_LIMIT', 'BACKEND_DOWN', 'NETWORK', 'PARSE', 'UNKNOWN'] as const)('%s → 讀取失敗，不標 notFound', kind => {
    expect(failedQuote('XYZ', new DataFetchError(kind, 'x')))
      .toEqual({ price: 0, name: 'XYZ', loading: false, error: true });
  });

  it('不是分類過的錯誤（例如斷網的 TypeError）→ 不猜成查無', () => {
    expect(failedQuote('XYZ', new TypeError('Failed to fetch')))
      .toEqual({ price: 0, name: 'XYZ', loading: false, error: true });
  });
});
