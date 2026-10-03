// components/portfolio/quoteGapsDisplay.test.tsx — 報價不齊時的全局摘要與群組小計（行為鎖）
// 2026-10-01 使用者拍板：任一持股沒有可用報價 → 市值與總損益一律顯示「—」並列出缺哪幾檔，
// 報價齊全才出數字；群組小計比照、台美各自判斷。不以 0 計（＝假設歸零）、不排除兩邊（＝假設不賺不賠）。
// 匯率未取得時數字照舊以備用匯率估，但市值卡要標示出來。
// 持股列比照（2026-10-03 拍板）：有報價項目但不可用（含回應成功但價格無效）一律顯示「讀取失敗」、不顯示名稱，
// 與頁首、群組小計的「讀取失敗：代號」同一套判定；只改畫面，報價 hook 發佈的資料語意不動。
// 以 renderToStaticMarkup 在 Node 渲染成 HTML 字串驗卡片文字；報價 hook 與歷史圖表（會讀 localStorage）換成替身。
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import type { PortfolioItem } from '../../types';
import type { PriceData } from './useHoldingPrices';
import Portfolio from '../Portfolio';
import HoldingsTable from './HoldingsTable';

const state = vi.hoisted(() => ({ prices: {} as Record<string, PriceData>, rate: 0 }));
vi.mock('./useHoldingPrices', () => ({
  useHoldingPrices: () => ({
    prices: state.prices, usdTwdRate: state.rate,
    fetchAllPrices: () => {}, fetchExchangeRate: () => {},
  }),
}));
vi.mock('./useDailySnapshot', () => ({ useDailySnapshot: () => ({ historyTick: 0 }) }));
vi.mock('./PnlHistorySection', () => ({ default: () => null }));

const twLot = (id: string, symbol: string, avg: number, shares: number): PortfolioItem => ({
  id, symbol, avgCostPrice: avg, totalShares: shares, totalCost: avg * shares,
  brokerDiscount: 2.8, cashDividends: 0, stockDividends: 0,
});
const A = twLot('a', '2330', 500, 1000);   // 成本 500,000；報價 600 → 市值 600,000
const B = twLot('b', '1234', 100, 1000);   // 成本 100,000；報價狀態依情境
const U: PortfolioItem = {                 // 美股：USD 成本 1,000（買入匯率 30）；報價 150 → 市值 1,500 USD
  id: 'u', symbol: 'AAPL', avgCostPrice: 100, totalShares: 10, totalCost: 0, brokerDiscount: 0,
  cashDividends: 0, stockDividends: 0, purchaseCurrency: 'USD', totalCostUSD: 1000, exchangeRate: 30,
};

const ok = (price: number, name = 'X'): PriceData =>
  ({ price, name, loading: false, error: false, date: '2026-10-01', fetchedAt: 0 });
const LOADING: PriceData = { price: 0, name: '1234', loading: true, error: false };
const FAILED: PriceData = { price: 0, name: '1234', loading: false, error: true };
const INVALID = ok(undefined as unknown as number);   // 回應成功但價格無效（下市冷門股會回這種）

const noop = () => {};

const renderPage = (items: PortfolioItem[], prices: Record<string, PriceData>, rate = 0) => {
  state.prices = prices;
  state.rate = rate;
  return renderToStaticMarkup(
    <Portfolio items={items} onAdd={noop} onDelete={noop} onUpdate={noop} realizedTrades={[]}
      onSell={() => null} onUpdateMeta={noop} onDeleteTrade={noop} onStatementImport={noop} />,
  );
};

const renderTable = (market: 'TW' | 'US', items: PortfolioItem[], prices: Record<string, PriceData>, rate = 0) =>
  renderToStaticMarkup(
    <HoldingsTable market={market} items={items} prices={prices} includeDividend usdTwdRate={rate}
      deleteConfirm={null} setDeleteConfirm={noop} onDelete={noop} onUpdate={noop}
      onUpdateMeta={noop} onSellClick={noop} healthResults={{}} onHealthCheck={noop} onShowDetail={noop} />,
  );

/** StatCard 的「數值｜小字」；沒有小字只回數值。以卡片標題定位（標題、數值、小字三個相鄰的 <p>），不依賴樣式 class */
const stat = (html: string, label: string) => {
  const esc = label.replace(/[()]/g, '\\$&');
  const m = html.match(new RegExp(`${esc}</p><p[^>]*>([^<]*)</p>(?:<p[^>]*>([^<]*)</p>)?`));
  if (!m) throw new Error(`找不到卡片：${label}`);
  return m[2] ? `${m[1]}｜${m[2]}` : m[1];
};

/** 持股表卡片頭（表格之前）的純文字 */
const header = (html: string) =>
  html.split('<table')[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** 持股表某代號的逐檔列：表頭欄名 → 該格純文字。以代號定位列、以表頭文字對欄，不依賴樣式 class 與欄序。
 *  明細列要點開才渲染，靜態輸出裡沒有（它與逐檔列共用同一個股價格元件，實機另驗） */
const holdingRow = (html: string, symbol: string): Record<string, string> => {
  const plain = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const heads = [...html.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/gs)].map(m => plain(m[1]));
  const tr = html.split('<tr').find(seg => seg.includes(`>${symbol}</p>`));
  if (!tr) throw new Error(`找不到持股列：${symbol}`);
  const cells = [...tr.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/gs)].map(m => plain(m[1]));
  return Object.fromEntries(heads.map((h, i) => [h, cells[i]]));
};

describe('報價齊全：數字與改版前完全一致', () => {
  it('全局摘要', () => {
    const page = renderPage([A, B], { '2330': ok(600), '1234': ok(80) });
    expect(stat(page, '總投入成本 (TWD)')).toBe('600,000 元');
    expect(stat(page, '目前市值 (TWD)')).toBe('680,000 元');
    // 680,000 − 600,000 − 預估賣出費稅 (2,655＋354)
    expect(stat(page, '總損益 (TWD)')).toBe('+76,991 元｜+12.83% · 含息');
  });

  it('台股群組小計', () => {
    expect(header(renderTable('TW', [A, B], { '2330': ok(600), '1234': ok(80) }))).toContain('+76,991 (+12.83%)');
  });
});

describe('報價不齊：市值與總損益顯示「—」並列出缺哪幾檔', () => {
  const cases: [string, Record<string, PriceData>, string][] = [
    ['載入中', { '2330': ok(600), '1234': LOADING }, '1 檔報價載入中'],
    ['還沒有報價項目（請求未發出）', { '2330': ok(600) }, '1 檔報價載入中'],
    ['讀取失敗', { '2330': ok(600), '1234': FAILED }, '讀取失敗：1234'],
    ['回應成功但價格無效', { '2330': ok(600), '1234': INVALID }, '讀取失敗：1234'],
  ];

  it.each(cases)('全局摘要：%s', (_, prices, note) => {
    const page = renderPage([A, B], prices);
    expect(stat(page, '總投入成本 (TWD)')).toBe('600,000 元');   // 成本不看報價，照常顯示
    expect(stat(page, '目前市值 (TWD)')).toBe(`—｜${note}`);
    expect(stat(page, '總損益 (TWD)')).toBe(`—｜${note}`);
    expect(page).not.toContain('非數值');
  });

  it.each(cases)('台股群組小計：%s', (_, prices, note) => {
    const h = header(renderTable('TW', [A, B], prices));
    expect(h).toContain(`—（${note}）`);
    expect(h).not.toContain('%');
  });

  it('台股缺價不影響美股群組小計，全局仍顯示「—」', () => {
    const prices = { '2330': ok(600), '1234': FAILED, AAPL: ok(150) };
    expect(header(renderTable('TW', [A, B], prices, 31))).toContain('—（讀取失敗：1234）');
    // 1,500 − 1,000 − 手續費 1.2（USD 顯示）
    expect(header(renderTable('US', [U], prices, 31))).toContain('+$498.80 (+49.88%)');
    const page = renderPage([A, B, U], prices, 31);
    expect(stat(page, '總損益 (TWD)')).toBe('—｜讀取失敗：1234');
  });
});

describe('持股列：有報價項目但不可用一律「讀取失敗」、不顯示名稱（與頁首、群組小計說法一致）', () => {
  const invalid: [string, PriceData][] = [
    ['undefined（下市冷門股會回這種）', INVALID],
    ['NaN', ok(NaN)],
    ['0', ok(0)],
  ];

  /** 逐檔列跟報價有關的四格；美股欄名帶幣別 */
  const quoteCells = (row: Record<string, string>, unit = '') => ({
    股價: row[`目前股價${unit}`], 名稱欄: row['代號 / 名稱'], 市值: row[`目前市值${unit}`], 損益: row[`總損益${unit}`],
  });
  const failedRow = (symbol: string) => ({ 股價: '讀取失敗', 名稱欄: `${symbol} 1 批`, 市值: '—', 損益: '—' });

  it.each(invalid)('台股價格 %s → 讀取失敗、不顯示名稱', (_, quote) => {
    const row = holdingRow(renderTable('TW', [A, B], { '2330': ok(600), '1234': quote }), '1234');
    expect(quoteCells(row)).toEqual(failedRow('1234'));
  });

  it('美股價格無效 → 讀取失敗、不顯示名稱', () => {
    const row = holdingRow(renderTable('US', [U], { AAPL: INVALID }, 31), 'AAPL');
    expect(quoteCells(row, ' (USD)')).toEqual(failedRow('AAPL'));
  });

  const unchanged: [string, PriceData | undefined, ReturnType<typeof quoteCells>][] = [
    ['讀取失敗', FAILED, failedRow('1234')],
    ['載入中（轉圈，沒有文字）', LOADING, { 股價: '', 名稱欄: '1234 1 批', 市值: '—', 損益: '—' }],
    // 請求發出前的一瞬間；頁首把它算載入中，列上不能說讀取失敗
    ['還沒有報價項目', undefined, { 股價: '—', 名稱欄: '1234 1 批', 市值: '—', 損益: '—' }],
    // 80,000 − 100,000 − 預估賣出費稅 354
    ['報價可用', ok(80), { 股價: '80.00', 名稱欄: '1234 X 1 批', 市值: '80,000', 損益: '-20,354 元 (-20.35%)' }],
  ];

  it.each(unchanged)('護欄：台股%s的顯示不變', (_, quote, expected) => {
    const prices: Record<string, PriceData> = { '2330': ok(600) };
    if (quote) prices['1234'] = quote;
    expect(quoteCells(holdingRow(renderTable('TW', [A, B], prices), '1234'))).toEqual(expected);
  });
});

describe('匯率未取得：數字照舊以備用匯率估，市值卡標示出來', () => {
  it('有美股、匯率未取得 → 標示暫以 32 估', () => {
    const page = renderPage([U], { AAPL: ok(150) }, 0);
    expect(stat(page, '目前市值 (TWD)')).toBe('48,000 元｜匯率未取得，暫以 32 估');
    expect(stat(page, '總損益 (TWD)')).toBe('+17,962 元｜+59.87% · 含息');
  });

  it('匯率已取得 → 照舊顯示即時匯率', () => {
    const page = renderPage([U], { AAPL: ok(150) }, 31);
    expect(stat(page, '目前市值 (TWD)')).toBe('46,500 元｜USD/TWD 31.00');
    expect(stat(page, '總損益 (TWD)')).toBe('+16,463 元｜+54.88% · 含息');
  });

  it('只有台股時匯率未取得不標示', () => {
    expect(stat(renderPage([A, B], { '2330': ok(600), '1234': ok(80) }, 0), '目前市值 (TWD)')).toBe('680,000 元');
  });
});
