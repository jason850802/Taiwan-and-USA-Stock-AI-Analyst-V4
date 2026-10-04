// utils/quoteGaps.test.ts — 報價不齊判定的行為鎖（2026-10-01 使用者拍板：報價不齊 → 加總顯示「—」）
import { describe, it, expect } from 'vitest';
import { isUsableQuote, quoteGapKind, findQuoteGaps, describeQuoteGaps, summarizeQuoteGaps } from './quoteGaps';

const ok = (price: number) => ({ price, loading: false, error: false });

describe('isUsableQuote：已到貨、非錯誤、價格為正的有限數才算可用', () => {
  it('正常報價可用', () => {
    expect(isUsableQuote(ok(600))).toBe(true);
  });

  it('沒有項目、載入中、讀取失敗都不可用', () => {
    expect(isUsableQuote(undefined)).toBe(false);
    expect(isUsableQuote({ price: 0, loading: true, error: false })).toBe(false);
    expect(isUsableQuote({ price: 0, loading: false, error: true })).toBe(false);
  });

  it('回應成功但價格無效（undefined／NaN／0／負數／無限大）也不可用', () => {
    expect(isUsableQuote(ok(undefined as unknown as number))).toBe(false);
    expect(isUsableQuote(ok(NaN))).toBe(false);
    expect(isUsableQuote(ok(0))).toBe(false);
    expect(isUsableQuote(ok(-1))).toBe(false);
    expect(isUsableQuote(ok(Infinity))).toBe(false);
  });
});

describe('findQuoteGaps：盤點缺報價的代號', () => {
  it('報價齊全 → 兩個清單都空（同代號多批不影響）', () => {
    expect(findQuoteGaps(['2330', '2330', 'AAPL'], { '2330': ok(600), AAPL: ok(150) }))
      .toEqual({ loading: [], failed: [] });
  });

  it('沒有項目與載入中歸「載入中」；讀取失敗與價格無效歸「讀取失敗」', () => {
    const gaps = findQuoteGaps(['A', 'B', 'C', 'D', 'E'], {
      B: { price: 0, loading: true, error: false },
      C: { price: 0, loading: false, error: true },
      D: ok(NaN),
      E: ok(10),
    });
    expect(gaps).toEqual({ loading: ['A', 'B'], failed: ['C', 'D'] });
  });

  it('同代號只列一次，順序依第一次出現', () => {
    expect(findQuoteGaps(['B', 'A', 'B'], {})).toEqual({ loading: ['B', 'A'], failed: [] });
  });
});

describe('describeQuoteGaps：卡片底下列出缺哪幾檔', () => {
  it('報價齊全回 null', () => {
    expect(describeQuoteGaps({ loading: [], failed: [] })).toBeNull();
  });

  it('讀取失敗列代號；載入中只報檔數；兩者並存用分號隔開', () => {
    expect(describeQuoteGaps({ loading: [], failed: ['1234', '5678'] })).toBe('讀取失敗：1234、5678');
    expect(describeQuoteGaps({ loading: ['2330', 'AAPL'], failed: [] })).toBe('2 檔報價載入中');
    expect(describeQuoteGaps({ loading: ['2330', 'AAPL'], failed: ['1234'] })).toBe('讀取失敗：1234；2 檔報價載入中');
  });
});

describe('summarizeQuoteGaps：齊不齊由缺報價清單判斷，說明文字只負責顯示', () => {
  it('報價齊全 → complete 為 true、沒有說明', () => {
    expect(summarizeQuoteGaps(['2330', 'AAPL'], { '2330': ok(600), AAPL: ok(150) }))
      .toEqual({ complete: true, note: null });
  });

  it('有缺 → complete 為 false，附上說明', () => {
    expect(summarizeQuoteGaps(['2330', '1234'], { '2330': ok(600), '1234': ok(NaN) }))
      .toEqual({ complete: false, note: '讀取失敗：1234' });
    expect(summarizeQuoteGaps(['2330'], {})).toEqual({ complete: false, note: '1 檔報價載入中' });
  });
});

describe('quoteGapKind：單檔的缺報價種類（健檢守門與 findQuoteGaps 同一套分法）', () => {
  it('可用報價 → null', () => {
    expect(quoteGapKind(ok(600))).toBeNull();
  });

  it('沒有項目與載入中 → loading', () => {
    expect(quoteGapKind(undefined)).toBe('loading');
    expect(quoteGapKind({ price: 0, loading: true, error: false })).toBe('loading');
  });

  it('讀取失敗與回應成功但價格無效 → failed', () => {
    expect(quoteGapKind({ price: 0, loading: false, error: true })).toBe('failed');
    expect(quoteGapKind(ok(undefined as unknown as number))).toBe('failed');
    expect(quoteGapKind(ok(NaN))).toBe('failed');
    expect(quoteGapKind(ok(0))).toBe('failed');
  });
});

// ── 查無行情分開說（2026-10-05 使用者拍板 B）──────────────────────────────
// 查無（NOT_FOUND，多為已下市或代號有誤）是永久的、要使用者處理；限流這類讀取失敗等一下就好。
// 說明文字把查無拆出來列在最前面；處理提示只放總損益卡（notFoundHint），市值卡與群組小計只列代號。
// 判定不變：查無仍不可用（加總照舊「—」），健檢守門的 quoteGapKind 也照舊歸 failed。
describe('查無行情：與其他讀取失敗分開列', () => {
  const NF = { price: 0, loading: false, error: true, notFound: true };
  const FAILED = { price: 0, loading: false, error: true };
  const HINT = '（可能已下市或代號有誤，可刪除或改用正確代號重新新增）';

  it('findQuoteGaps：查無另列 notFound，不進讀取失敗；沒有查無時不帶這欄', () => {
    expect(findQuoteGaps(['A', 'B', 'C'], { A: NF, B: FAILED, C: ok(10) }))
      .toEqual({ loading: [], failed: ['B'], notFound: ['A'] });
    expect(findQuoteGaps(['B'], { B: FAILED })).toEqual({ loading: [], failed: ['B'] });
  });

  it('findQuoteGaps：載入中的不算查無（只認已定案的失敗）', () => {
    expect(findQuoteGaps(['A'], { A: { ...NF, loading: true } })).toEqual({ loading: ['A'], failed: [] });
  });

  it('describeQuoteGaps：查無列最前面，接讀取失敗、載入中', () => {
    expect(describeQuoteGaps({ loading: ['X'], failed: ['1234'], notFound: ['9999', '8888'] }))
      .toBe('查無行情：9999、8888；讀取失敗：1234；1 檔報價載入中');
  });

  it('describeQuoteGaps：notFoundHint 只在有查無時於查無清單後補處理提示', () => {
    expect(describeQuoteGaps({ loading: [], failed: ['1234'], notFound: ['9999'] }, { notFoundHint: true }))
      .toBe(`查無行情：9999${HINT}；讀取失敗：1234`);
    expect(describeQuoteGaps({ loading: [], failed: ['1234'] }, { notFoundHint: true })).toBe('讀取失敗：1234');
  });

  it('summarizeQuoteGaps：只有查無也不齊，提示依選項', () => {
    expect(summarizeQuoteGaps(['2330', '9999'], { '2330': ok(600), '9999': NF }))
      .toEqual({ complete: false, note: '查無行情：9999' });
    expect(summarizeQuoteGaps(['2330', '9999'], { '2330': ok(600), '9999': NF }, { notFoundHint: true }))
      .toEqual({ complete: false, note: `查無行情：9999${HINT}` });
  });

  it('quoteGapKind：查無照舊歸 failed（健檢「缺報價」徽章不受影響）', () => {
    expect(quoteGapKind(NF)).toBe('failed');
  });
});
