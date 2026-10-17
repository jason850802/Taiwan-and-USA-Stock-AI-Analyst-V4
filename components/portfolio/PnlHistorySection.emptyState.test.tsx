// components/portfolio/PnlHistorySection.emptyState.test.tsx — 每一筆快照都是缺價日時的空狀態（行為鎖）
// live 快照比照缺價日之後（2026-10-01 拍板），沒回推過的市場也可能只有缺價日列、畫不出任何點。
// 這時圖下除了缺價日提示，還要依現況給下一步：有買進日期 →「建立歷史曲線」；有持股但沒填買進日期 →
// 提示補填；持股已全部刪光 → 說目前無持股，不能叫使用者去補填不存在的買進日期（2026-10-05 code-review 收）。
// 以 renderToStaticMarkup 在 Node 渲染成 HTML 字串驗文字；快照與流水的 localStorage 讀取換成替身。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import type { DailyPnlSnapshot, PortfolioItem } from '../../types';
import PnlHistorySection from './PnlHistorySection';

const state = vi.hoisted(() => ({ rows: [] as DailyPnlSnapshot[] }));
vi.mock('../../utils/portfolioHistoryStore', () => ({
  loadSnapshots: () => state.rows, saveSnapshots: () => {},
}));
vi.mock('../../utils/txnStore', () => ({ loadTxns: () => [], saveTxns: () => {}, appendTxns: () => {} }));
vi.mock('./PnlHistoryChart', () => ({ default: () => null }));

// 台股 live 缺價日列：2330 查得到、9999 查無
const gapRow: DailyPnlSnapshot = {
  date: '2026-10-01', market: 'TW', source: 'live', marketValue: 600_000, totalCost: 500_000,
  estSellCosts: 0, cashDividends: 0, symbolCount: 1, capturedAt: 1, notFoundSymbols: ['9999.TW'],
};
const lot = (symbol: string, buyDate?: string): PortfolioItem => ({
  id: symbol, symbol, avgCostPrice: 500, totalShares: 1000, totalCost: 500_000,
  brokerDiscount: 2.8, cashDividends: 0, stockDividends: 0, ...(buyDate ? { buyDate } : {}),
});

/** 只取台股那張卡：美股卡沒資料時本來就說「目前無持股」，不切開會假綠 */
const twCard = (items: PortfolioItem[]) => {
  state.rows = [gapRow];
  const html = renderToStaticMarkup(
    <PnlHistorySection items={items} realizedTrades={[]} includeDividend={false} usdTwdRate={0} historyTick={0} />,
  );
  const start = html.indexOf('台股損益歷史');
  const end = html.indexOf('美股損益歷史');
  expect(start).toBeGreaterThanOrEqual(0);
  return html.slice(start, end > start ? end : undefined);
};

describe('PnlHistorySection｜每一筆都是缺價日、沒回推過的空狀態', () => {
  it('持股已全部刪光 → 說目前無持股，不叫人補填買進日期', () => {
    const card = twCard([]);
    expect(card).toContain('9999.TW 查無行情資料');
    expect(card).toContain('此市場目前無持股');
    expect(card).not.toContain('買進日期');
    expect(card).not.toContain('建立歷史曲線');
  });

  it('有持股但沒填買進日期 → 提示補填', () => {
    const card = twCard([lot('2330.TW')]);
    expect(card).toContain('持股尚未填「買進日期」');
    expect(card).not.toContain('建立歷史曲線');
  });

  it('有買進日期 → 給「建立歷史曲線」', () => {
    const card = twCard([lot('2330.TW', '2026-09-01')]);
    expect(card).toContain('建立歷史曲線');
    expect(card).not.toContain('此市場目前無持股');
  });
});
