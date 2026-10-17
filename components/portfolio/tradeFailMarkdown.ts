// components/portfolio/tradeFailMarkdown.ts — 「新增並 AI 分析」的買入評估失敗文案
//
// 這段文案出現時，持股已經由 handleAdd 寫進庫存、表單也清空了（handleAddAndAnalyze 先新增、
// 再呼叫 AI），而且目前沒有「只重跑買入評估」的入口。所以第一句必須先講清楚不必再加一次——
// 寫「請稍後再試」會讓人重開表單再按一次，同一筆買進就被記兩次。
// 原因依錯誤種類分流（比照 useHealthCheck 的 analysisFailMarkdown）：只有限流與後端無回應補上原因，
// 其餘種類（含離線的 NETWORK）都不在名單內、一律不寫原因。
// 行為鎖：同目錄 tradeFailMarkdown.test.ts。
import type { FetchErrorKind } from '../../services/fetchError';

export const tradeFailMarkdown = (kind: FetchErrorKind): string => {
  const reason = kind === 'RATE_LIMIT' ? '（AI 服務可能限流中）'
    : kind === 'BACKEND_DOWN' ? '（AI 服務後端目前無回應，請確認網路）'
    : '';
  return `**AI 分析失敗**\n\n持股已經加入庫存，不必再加一次；只是這次的 AI 買入評估沒有完成${reason}。`;
};
