// components/portfolio/useHealthCheck.test.ts — 健檢的行情抓取失敗文案
//
// 鎖什麼：quoteFailMarkdown 依錯誤種類給處置。查無代號（NOT_FOUND）2026-10-01 起有專屬文案
// （使用者拍板）：重試也是同樣結果，所以不叫人稍後再試，改請使用者確認代號，單檔與批次同一段。
// 其他種類照現行文案（行為鎖）。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { quoteFailMarkdown } from './useHealthCheck';

const SINGLE = '。';
const BATCH = '，或單獨對此檔重跑健檢。';

describe('quoteFailMarkdown', () => {
  it('查無代號：專屬標題、請使用者確認代號，單檔與批次同一段', () => {
    const expected = '**查無此代號的行情資料**\n\n行情來源找不到這個代號，可能已下市、更換代號，或代號有誤，請先確認代號。';
    expect(quoteFailMarkdown('NOT_FOUND', SINGLE)).toBe(expected);
    expect(quoteFailMarkdown('NOT_FOUND', BATCH)).toBe(expected);
  });

  it.each([
    ['RATE_LIMIT', '（Yahoo／FinMind 可能限流中）請稍後再試'],
    ['BACKEND_DOWN', '行情後端目前無回應，請確認網路或稍後再試'],
    ['NETWORK', '行情後端目前無回應，請確認網路或稍後再試'],
    ['UNKNOWN', '請稍後再試'],
    [null, '請稍後再試'],
  ] as const)('%s：照現行文案，尾句依單檔／批次', (kind, body) => {
    expect(quoteFailMarkdown(kind, SINGLE)).toBe(`**行情資料暫時無法取得**\n\n${body}${SINGLE}`);
    expect(quoteFailMarkdown(kind, BATCH)).toBe(`**行情資料暫時無法取得**\n\n${body}${BATCH}`);
  });
});
