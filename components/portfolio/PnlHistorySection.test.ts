// components/portfolio/PnlHistorySection.test.ts — 歷史回推的進度與失敗文案
//
// 鎖什麼（2026-10-01 使用者拍板）：
// - 退避等待期間的成因：只有限流才說「限流中」，後端沒回應／斷網說「後端無回應中」，
//   其他（查無代號、認不出的錯誤）不猜成因。
// - 失敗訊息：查無代號的標的不進重試，訊息不能說「已自動重試 2 次」；
//   與還要處置的失敗同時發生時分兩段寫。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { backfillFailMessage, progressLabel } from './PnlHistorySection';

type Kind = Parameters<typeof progressLabel>[0]['kind'];

describe('progressLabel｜退避等待期間的成因', () => {
  const waiting = (kind: Kind) =>
    progressLabel({ running: true, done: 1, total: 3, error: null, retrying: 2, waitSec: 45, kind });

  it('限流 → 限流中', () => {
    expect(waiting('RATE_LIMIT')).toBe('限流中，45 秒後重試 2 檔…');
  });

  it.each(['BACKEND_DOWN', 'NETWORK'] as const)('%s → 後端無回應中', kind => {
    expect(waiting(kind)).toBe('後端無回應中，45 秒後重試 2 檔…');
  });

  it.each(['NOT_FOUND', 'UNKNOWN', 'PARSE', undefined] as const)('%s → 不猜成因', kind => {
    expect(waiting(kind)).toBe('45 秒後重試 2 檔…');
  });

  it('不在等待時沿用原文字', () => {
    expect(progressLabel({ running: true, done: 1, total: 3, error: null, retrying: 2, waitSec: 0 })).toBe('重試 2 檔…');
    expect(progressLabel({ running: true, done: 1, total: 3, error: null })).toBe('回推中 1/3 檔…');
  });
});

describe('backfillFailMessage｜回推失敗訊息', () => {
  const NOT_FOUND_TEXT = '查無行情資料（可能已下市、更換代號或代號有誤）';

  it('失敗的全是查無：不說重試', () => {
    expect(backfillFailMessage({
      missedSymbols: ['XYZ'], notFoundSymbols: ['XYZ'], kind: 'NOT_FOUND', detail: '找不到該股票代號。',
    })).toBe(`XYZ ${NOT_FOUND_TEXT}`);
  });

  it('查無與限流同時發生：分兩段，限流那段照舊給處置提示', () => {
    expect(backfillFailMessage({
      missedSymbols: ['XYZ', 'ABC'], notFoundSymbols: ['XYZ'], kind: 'RATE_LIMIT', detail: 'Fetch error (429)',
    })).toBe(`XYZ ${NOT_FOUND_TEXT}；ABC 行情抓取失敗，已自動重試 2 次（被行情來源限流）請等幾分鐘再按一次重算`);
  });

  it('沒有查無：只有重試那段', () => {
    expect(backfillFailMessage({
      missedSymbols: ['ABC'], notFoundSymbols: [], kind: 'BACKEND_DOWN', detail: 'Fetch error (500)',
    })).toBe('ABC 行情抓取失敗，已自動重試 2 次（行情服務目前無回應，多半是本機後端未啟動或已中斷）請確認後端服務正常後再重算');
  });

  it('超過 6 檔只列前 6 檔再補總數', () => {
    const many = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];
    expect(backfillFailMessage({ missedSymbols: many, notFoundSymbols: many, kind: 'NOT_FOUND', detail: '' }))
      .toBe(`A1、A2、A3、A4、A5、A6 等 7 檔 ${NOT_FOUND_TEXT}`);
  });
});
