// services/fetchError.wiring.test.ts — HTTP 失敗分類的接線鎖
//
// 鎖的是什麼：前端四個 fetch 出口（queryYahoo、fetchFinMindRows、callGeminiApi、callGeminiApiStream）
// 遇到非 2xx 時，都照 classifyHttpStatus 這一套規則決定錯誤種類。
// 為什麼要鎖：queryYahoo 原本自己寫一份「429 以外一律 BACKEND_DOWN」，後端回 404（查無代號，
// 例如下市的美股）也被當成後端沒回應，健檢與歷史回推就叫使用者去檢查後端。
// 規則本身的逐碼測試在 utils/fetchError.test.ts；這裡只證明每個出口真的接上它。
//
// 另附台股 .TW → .TWO 試探鏈的回歸鎖：鏈的 catch 不看 kind，404 改分類成 NOT_FOUND 後
// 仍要照樣往下試 .TWO，兩個後綴都查不到才丟「找不到台股代號」。
//
// vi.resetModules 之後 DataFetchError 是新的 class 身分，所以錯誤一律攤成純欄位比對、不用 instanceof。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioHealthItem } from './gemini';
import type { StockDataPoint } from '../types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const chart = (symbol: string, price: number) => ({ chart: { error: null, result: [{
  meta: { symbol, currency: 'TWD', exchangeTimezoneName: 'Asia/Taipei', regularMarketPrice: price },
  timestamp: [1704207600],
  indicators: { quote: [{ open: [price], high: [price], low: [price], close: [price], volume: [1000] }] },
}] } });

// 後端分類錯誤的回應形狀一律 { code, message }（api/yahoo/chart.ts）
const yahooNotFound = () => json({ code: 'NOT_FOUND', message: '找不到該股票代號。' }, 404);

let routes: Record<string, (url: URL) => Response>;
let chartSymbols: string[];

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  chartSymbols = [];
  routes = {
    // 台股名錄與中文名預設空清單：名錄查不到 → 走 .TW → .TWO 試探鏈
    '/api/finmind': () => json({ msg: 'success', data: [] }),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input), 'http://fixture');
    if (url.pathname === '/api/yahoo/chart') chartSymbols.push(url.searchParams.get('symbol')!);
    const handler = routes[url.pathname];
    if (!handler) throw new Error(`未定義假請求：${url.pathname}`);
    return handler(url);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

/** 取出丟出來的錯誤；沒丟錯就讓測試失敗。 */
const rejectionOf = async (p: Promise<unknown>): Promise<any> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('預期失敗，卻成功回傳');
};

const summary = (e: any) => ({ name: e?.name, kind: e?.kind, message: e?.message });

describe('queryYahoo（/api/yahoo/chart）', () => {
  it.each([
    { status: 404, code: 'NOT_FOUND', message: '找不到該股票代號。', kind: 'NOT_FOUND' },
    { status: 400, code: 'BAD_REQUEST', message: '請求參數不正確，請確認股票代號與時間區間設定。', kind: 'UNKNOWN' },
    { status: 403, code: 'BAD_REQUEST', message: '請求未通過驗證。', kind: 'UNKNOWN' },
    { status: 429, code: 'RATE_LIMITED', message: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。', kind: 'RATE_LIMIT' },
    { status: 502, code: 'UPSTREAM_ERROR', message: 'Yahoo 行情服務暫時無法回應，請稍後再試。', kind: 'BACKEND_DOWN' },
  ])('美股報價：後端回 $status（$code）→ $kind，訊息沿用後端原文', async ({ status, code, message, kind }) => {
    routes['/api/yahoo/chart'] = () => json({ code, message }, status);
    const { getLatestPrice } = await import('./yahoo');
    expect(summary(await rejectionOf(getLatestPrice('DLST')))).toEqual({ name: 'DataFetchError', kind, message });
  });

  it('K 線（健檢與歷史回推走的路徑）：下市美股的 404 原樣穿到呼叫端，不被當成後端沒回應', async () => {
    routes['/api/yahoo/chart'] = yahooNotFound;
    const { getStockData } = await import('./yahoo');
    expect(summary(await rejectionOf(getStockData('DLST', '1d')))).toEqual({
      name: 'DataFetchError', kind: 'NOT_FOUND', message: '找不到該股票代號。',
    });
  });
});

describe('台股裸代號的 .TW → .TWO 試探鏈（回歸鎖：鏈不看 kind）', () => {
  const onlyTwoListed = (url: URL) => (url.searchParams.get('symbol') === '9999.TWO'
    ? json(chart('9999.TWO', 88))
    : yahooNotFound());

  it('.TW 回 404 仍照樣改試 .TWO，成功就回 .TWO 的報價', async () => {
    routes['/api/yahoo/chart'] = onlyTwoListed;
    const { getLatestPrice } = await import('./yahoo');
    expect((await getLatestPrice('9999')).price).toBe(88);
    expect(chartSymbols).toEqual(['9999.TW', '9999.TWO']);
  });

  it('名錄說是上市（.TW）但 Yahoo 回 404：不中斷，退回試探鏈並在 .TWO 找到', async () => {
    routes['/api/finmind'] = () => json({ msg: 'success', data: [
      { stock_id: '9999', stock_name: '測試股', industry_category: '電子工業', type: 'twse' },
    ] });
    routes['/api/yahoo/chart'] = onlyTwoListed;
    const { getLatestPrice } = await import('./yahoo');
    expect((await getLatestPrice('9999')).price).toBe(88);
    expect(chartSymbols.at(-1)).toBe('9999.TWO');
  });

  it('.TW 與 .TWO 都 404 → NOT_FOUND「找不到台股代號」', async () => {
    routes['/api/yahoo/chart'] = yahooNotFound;
    const { getLatestPrice } = await import('./yahoo');
    expect(summary(await rejectionOf(getLatestPrice('9999')))).toEqual({
      name: 'DataFetchError', kind: 'NOT_FOUND', message: '找不到台股代號: 9999',
    });
  });
});

describe('fetchFinMindRows（/api/finmind）', () => {
  it('回 404 → NOT_FOUND，HTTP status 仍掛在錯誤上（基本面的 429 退避讀它）', async () => {
    // FinMind 後端本身不回 404；這裡模擬路由不存在時平台回的非 JSON 404
    routes['/api/finmind'] = () => new Response('Not Found', { status: 404 });
    const { fetchFinMindRows } = await import('./finmind');
    const err = await rejectionOf(fetchFinMindRows('TaiwanStockPrice', { data_id: '9999' }));
    expect(summary(err)).toEqual({ name: 'DataFetchError', kind: 'NOT_FOUND', message: 'FinMind fetch error (404)' });
    expect(err.status).toBe(404);
  });
});

describe('callGeminiApi／callGeminiApiStream（/api/gemini、/api/gemini-stream）', () => {
  const healthItem: PortfolioHealthItem = {
    symbol: '2330.TW',
    name: '台積電',
    avgCostPrice: 900,
    currentPrice: 1040,
    totalShares: 1000,
    profitPct: 15.56,
    recentData: [{
      date: '2026-08-13', open: 1030, high: 1050, low: 1025, close: 1040, volume: 20_000_000,
    } as StockDataPoint],
    volumeProjection: null,
  };
  // Gemini 後端的 404 只有一種來源：MODEL_NOT_FOUND（api/gemini.ts、api/gemini-stream.ts）
  const modelMessage = '目前設定的 AI 模型無法使用，請確認模型名稱設定是否正確。';
  const modelNotFound = () => json({ code: 'MODEL_NOT_FOUND', message: modelMessage }, 404);

  it('非串流：後端回 404（設定的模型不存在）→ NOT_FOUND，訊息沿用後端原文', async () => {
    routes['/api/gemini'] = modelNotFound;
    const { analyzePortfolioHealth } = await import('./gemini');
    expect(summary(await rejectionOf(analyzePortfolioHealth([healthItem])))).toEqual({
      name: 'DataFetchError', kind: 'NOT_FOUND', message: modelMessage,
    });
  });

  it('串流：後端回 404（設定的模型不存在）→ NOT_FOUND，訊息沿用後端原文', async () => {
    routes['/api/gemini-stream'] = modelNotFound;
    const { analyzePortfolioHealth } = await import('./gemini');
    expect(summary(await rejectionOf(analyzePortfolioHealth([healthItem], () => {})))).toEqual({
      name: 'DataFetchError', kind: 'NOT_FOUND', message: modelMessage,
    });
  });
});
