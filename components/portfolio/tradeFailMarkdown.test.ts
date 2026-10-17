// components/portfolio/tradeFailMarkdown.test.ts — 「新增並 AI 分析」失敗文案的行為鎖
//
// 這段文案出現時，持股早已寫進庫存（handleAddAndAnalyze 先新增、再呼叫 AI），
// 所以每一種失敗都必須先講「不必再加一次」；寫「請稍後再試」會讓人重開表單再按一次，
// 同一筆買進就被記兩次。只有限流與後端無回應補原因，其餘種類（含離線的 NETWORK）不寫原因。
// 文案經使用者 2026-10-01 逐字核准。
import { describe, expect, it } from 'vitest';
import type { FetchErrorKind } from '../../services/fetchError';
import { tradeFailMarkdown } from './tradeFailMarkdown';

const ALL_KINDS: FetchErrorKind[] = ['RATE_LIMIT', 'BACKEND_DOWN', 'NOT_FOUND', 'PARSE', 'NETWORK', 'UNKNOWN'];

describe('tradeFailMarkdown：新增並 AI 分析的失敗文案', () => {
  it('RATE_LIMIT 註明 AI 服務可能限流中', () => {
    expect(tradeFailMarkdown('RATE_LIMIT')).toBe(
      '**AI 分析失敗**\n\n持股已經加入庫存，不必再加一次；只是這次的 AI 買入評估沒有完成（AI 服務可能限流中）。',
    );
  });

  it('BACKEND_DOWN 註明後端無回應並請使用者確認網路', () => {
    expect(tradeFailMarkdown('BACKEND_DOWN')).toBe(
      '**AI 分析失敗**\n\n持股已經加入庫存，不必再加一次；只是這次的 AI 買入評估沒有完成（AI 服務後端目前無回應，請確認網路）。',
    );
  });

  it.each(['NOT_FOUND', 'PARSE', 'NETWORK', 'UNKNOWN'] as const)('%s 不在分流名單：不寫原因', kind => {
    expect(tradeFailMarkdown(kind)).toBe(
      '**AI 分析失敗**\n\n持股已經加入庫存，不必再加一次；只是這次的 AI 買入評估沒有完成。',
    );
  });

  it('每一種都先說持股已加入；不叫人「稍後再試」，也不提前端早已沒有的 API Key', () => {
    for (const kind of ALL_KINDS) {
      const text = tradeFailMarkdown(kind);
      expect(text).toContain('持股已經加入庫存，不必再加一次');
      expect(text).not.toContain('稍後再試');
      expect(text).not.toMatch(/API Key/i);
    }
  });
});
