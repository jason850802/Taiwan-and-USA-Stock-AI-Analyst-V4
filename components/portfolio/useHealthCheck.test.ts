// components/portfolio/useHealthCheck.test.ts — 健檢送 AI 前的資料守門與文案
//
// 鎖什麼：quoteFailMarkdown 依錯誤種類給處置。查無代號（NOT_FOUND）2026-10-01 起有專屬文案
// （使用者拍板）：重試也是同樣結果，所以不叫人稍後再試，改請使用者確認代號，單檔與批次同一段。
// 其他種類照現行文案（行為鎖）。
// 缺報價（2026-10-03 使用者拍板）：K 線抓得到、但沒有可用報價時不送 AI——拿 0 或無效價當現價，
// AI 會據此判斷停損／續抱。徽章「缺報價」，文案逐字照使用者核准的版本；守門先看 K 線、再看報價，
// 所以 K 線抓不到時的既有文案（含查無代號）不受影響。hook 接線（批次不被拖垮）另見 useHealthCheck.wiring.test.ts。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { quoteFailMarkdown, quoteGapMarkdown, healthDataGapResult } from './useHealthCheck';
import type { PortfolioHealthItem } from '../../services/gemini';
import type { StockDataPoint } from '../../types';

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

describe('quoteGapMarkdown：缺報價文案（講明是報價問題、本次沒送 AI）', () => {
  it('載入中（含還沒有報價項目）：請等報價載入，尾句依單檔／批次', () => {
    const lead = '**報價尚未載入完成**\n\n為避免用不完整的現價判斷停損或續抱，本次未送 AI 分析。請等報價載入後再試';
    expect(quoteGapMarkdown('loading', SINGLE)).toBe(`${lead}${SINGLE}`);
    expect(quoteGapMarkdown('loading', BATCH)).toBe(`${lead}${BATCH}`);
  });

  it('讀取失敗（含回應成功但價格無效）：請按更新報價，一直失敗可能已停牌或下市', () => {
    const lead = '**最新報價無法取得**\n\n為避免用錯的現價判斷停損或續抱，本次未送 AI 分析。請按「更新報價」後再試';
    const end = '若一直失敗，這檔可能已停牌或下市。';
    expect(quoteGapMarkdown('failed', SINGLE)).toBe(`${lead}${SINGLE}${end}`);
    expect(quoteGapMarkdown('failed', BATCH)).toBe(`${lead}${BATCH}${end}`);
  });
});

describe('healthDataGapResult：送 AI 前的資料守門（先看 K 線、再看報價）', () => {
  const item = (recentData: StockDataPoint[]): PortfolioHealthItem => ({
    symbol: '9999', name: '9999', avgCostPrice: 90, currentPrice: 0, totalShares: 1000,
    profitPct: 0, recentData, volumeProjection: null,
  });
  const KLINE = [{ date: '2026-10-02', open: 100, high: 100, low: 100, close: 100, volume: 1_000_000 } as StockDataPoint];
  const ok = (price: number) => ({ price, loading: false, error: false });

  it('K 線與報價都可用 → null（送 AI）', () => {
    expect(healthDataGapResult(item(KLINE), ok(100), null, SINGLE)).toBeNull();
  });

  it('K 線抓不到 → 沿用行情抓取失敗文案，即使報價也不可用（查無代號的專屬文案不被蓋掉）', () => {
    expect(healthDataGapResult(item([]), ok(NaN), 'NOT_FOUND', SINGLE)).toEqual({
      status: 'error', decision: '資料取得失敗', fullResult: quoteFailMarkdown('NOT_FOUND', SINGLE),
    });
    expect(healthDataGapResult(null, undefined, 'RATE_LIMIT', BATCH)).toEqual({
      status: 'error', decision: '資料取得失敗', fullResult: quoteFailMarkdown('RATE_LIMIT', BATCH),
    });
  });

  it('K 線有、報價載入中或還沒有項目 → 缺報價（載入中文案）', () => {
    const expected = { status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown('loading', BATCH) };
    expect(healthDataGapResult(item(KLINE), { price: 0, loading: true, error: false }, null, BATCH)).toEqual(expected);
    expect(healthDataGapResult(item(KLINE), undefined, null, BATCH)).toEqual(expected);
  });

  it('K 線有、報價讀取失敗或價格無效 → 缺報價（讀取失敗文案）', () => {
    const expected = { status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown('failed', SINGLE) };
    expect(healthDataGapResult(item(KLINE), { price: 0, loading: false, error: true }, null, SINGLE)).toEqual(expected);
    expect(healthDataGapResult(item(KLINE), ok(undefined as unknown as number), null, SINGLE)).toEqual(expected);
  });
});
