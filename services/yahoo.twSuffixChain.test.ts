// services/yahoo.twSuffixChain.test.ts — 台股裸代號 .TW／.TWO 試探鏈的錯誤種類
//
// 修掉的症狀（原記在 .planning/codebase/ARCHITECTURE.md 反模式，現為「NOT_FOUND 已可信，下游還沒用它決定處置」）：
// 試探鏈的兩層 catch 只放行 AbortError，兩個後綴都失敗就統一丟 NOT_FOUND「找不到台股代號」，
// 限流（429）、後端沒開（Vite proxy 連不到 3001 回空本文 500）也被說成查無代號，
// 下游因此不能拿 NOT_FOUND 決定處置（健檢文案、回推退避文案、回推要不要重試）。
//
// 2026-10-01 使用者拍板的語意：
// - 試探鏈只有 NOT_FOUND（這個後綴查無）才換下一個後綴；限流、後端沒開、使用者取消等其他失敗
//   代表「查不出來」，原樣上拋（保留種類與後端原文），不再多打請求。每個後綴都明說查無才算查無代號。
// - 名錄給得出後綴就先試它、再試另一個，不重打同一個後綴。
// - K 線路徑的台股：Yahoo 查無、FinMind 備援卻是其他失敗 → 丟 FinMind 的錯誤；兩邊都查無才是 NOT_FOUND。
//
// 入口照真實呼叫端：庫存報價走 getLatestPrice（裸代號不先換碼），健檢與歷史回推走
// getStockData(symbol, '1d')（不帶回呼＝單段路徑；名錄沒命中才會進試探鏈）。
//
// 假請求依 URL 路由（照抄 services/fetchError.wiring.test.ts）；vi.resetModules 之後
// DataFetchError 是新的 class 身分，錯誤一律攤成純欄位比對、不用 instanceof。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const chart = (symbol: string, price: number) => ({ chart: { error: null, result: [{
  meta: { symbol, currency: 'TWD', exchangeTimezoneName: 'Asia/Taipei', regularMarketPrice: price },
  timestamp: [1704207600],
  indicators: { quote: [{ open: [price], high: [price], low: [price], close: [price], volume: [1000] }] },
}] } });

// 後端分類錯誤的回應形狀一律 { code, message }（api/yahoo/chart.ts、api/finmind.ts）
const yahooNotFound = () => json({ code: 'NOT_FOUND', message: '找不到該股票代號。' }, 404);
const yahooRateLimited = () => json({ code: 'RATE_LIMITED', message: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。' }, 429);
const finMindRateLimited = () => json({ code: 'RATE_LIMITED', message: 'FinMind 資料服務目前請求過於頻繁，請稍後再試一次。' }, 429);
const finMindUpstreamError = () => json({ code: 'UPSTREAM_ERROR', message: 'FinMind 資料服務暫時無法回應，請稍後再試。' }, 502);
const finMindEmpty = () => json({ msg: 'success', data: [] });
// 後端沒開：Vite proxy 的 error handler 回 500、Content-Type text/plain、空本文
const backendDown = () => new Response('', { status: 500 });

/** 名錄（不帶 data_id 的 TaiwanStockInfo）說 9999 是上市（twse）或上櫃（tpex）；其餘 FinMind 請求交給 other。
 *  真實環境後端沒開時名錄來自 localStorage 快取，這裡測試環境沒有 localStorage，改由假請求供應。 */
const directoryOr = (other: () => Response, type: 'twse' | 'tpex' = 'twse') => (url: URL) =>
  (url.searchParams.get('dataset') === 'TaiwanStockInfo' && !url.searchParams.has('data_id')
    ? json({ msg: 'success', data: [{ stock_id: '9999', stock_name: '測試股', industry_category: '電子工業', type }] })
    : other());

let routes: Record<string, (url: URL) => Response>;
let chartSymbols: string[];
let finmindDatasets: string[];

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  chartSymbols = [];
  finmindDatasets = [];
  routes = {
    // 台股名錄、中文名、FinMind 備援預設空清單：名錄查不到 → 走 .TW → .TWO 試探鏈
    '/api/finmind': finMindEmpty,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = new URL(String(input), 'http://fixture');
    if (url.pathname === '/api/yahoo/chart') chartSymbols.push(url.searchParams.get('symbol')!);
    if (url.pathname === '/api/finmind') finmindDatasets.push(url.searchParams.get('dataset')!);
    const handler = routes[url.pathname];
    if (!handler) throw new Error(`未定義假請求：${url.pathname}`);
    return handler(url);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 取出丟出來的錯誤；沒丟錯就讓測試失敗。 */
const rejectionOf = async (p: Promise<unknown>): Promise<any> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('預期失敗，卻成功回傳');
};

const kindOf = async (p: Promise<unknown>) => (await rejectionOf(p))?.kind;
const summary = (e: any) => ({ kind: e?.kind, message: e?.message });

/** 依後綴給 Yahoo 回應：.TW 與 .TWO 各自指定。 */
const bySuffix = (tw: () => Response, two: () => Response) => (url: URL) =>
  (url.searchParams.get('symbol')!.endsWith('.TWO') ? two() : tw());

describe('getLatestPrice（庫存報價：裸代號不先換碼）', () => {
  it('後端沒開（Yahoo、名錄全部 500）→ BACKEND_DOWN，不是查無代號', async () => {
    routes['/api/finmind'] = backendDown;
    routes['/api/yahoo/chart'] = backendDown;
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('BACKEND_DOWN');
  });

  it('名錄命中（.TW）但 Yahoo 回 500 → BACKEND_DOWN', async () => {
    routes['/api/finmind'] = directoryOr(backendDown);
    routes['/api/yahoo/chart'] = backendDown;
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('BACKEND_DOWN');
  });

  it('Yahoo 一律 429 → RATE_LIMIT', async () => {
    routes['/api/yahoo/chart'] = yahooRateLimited;
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('RATE_LIMIT');
  });

  it('.TW 查無、.TWO 被限流 → RATE_LIMIT（上櫃有沒有這檔還不知道）', async () => {
    routes['/api/yahoo/chart'] = bySuffix(yahooNotFound, yahooRateLimited);
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('RATE_LIMIT');
  });

  it('.TW 被限流、.TWO 查無 → RATE_LIMIT（上市有沒有這檔還不知道）', async () => {
    routes['/api/yahoo/chart'] = bySuffix(yahooRateLimited, yahooNotFound);
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('RATE_LIMIT');
  });
});

describe("getStockData(symbol, '1d')（健檢與歷史回推）", () => {
  it('後端沒開（Yahoo、名錄、FinMind 備援全部 500）→ BACKEND_DOWN', async () => {
    routes['/api/finmind'] = backendDown;
    routes['/api/yahoo/chart'] = backendDown;
    const { getStockData } = await import('./yahoo');
    expect(await kindOf(getStockData('9999', '1d'))).toBe('BACKEND_DOWN');
  });

  it('Yahoo 一律 429、FinMind 備援也 429 → RATE_LIMIT', async () => {
    routes['/api/finmind'] = finMindRateLimited;
    routes['/api/yahoo/chart'] = yahooRateLimited;
    const { getStockData } = await import('./yahoo');
    expect(await kindOf(getStockData('9999', '1d'))).toBe('RATE_LIMIT');
  });

  it('對照：名錄命中時先換成帶後綴代號、不進試探鏈 → BACKEND_DOWN', async () => {
    routes['/api/finmind'] = directoryOr(backendDown);
    routes['/api/yahoo/chart'] = backendDown;
    const { getStockData } = await import('./yahoo');
    expect(await kindOf(getStockData('9999', '1d'))).toBe('BACKEND_DOWN');
    expect(chartSymbols).toEqual(['9999.TW']);
  });

  it('對照：兩個後綴都查無、FinMind 也沒資料 → NOT_FOUND「找不到台股代號」', async () => {
    routes['/api/yahoo/chart'] = yahooNotFound;
    const { getStockData } = await import('./yahoo');
    expect(summary(await rejectionOf(getStockData('9999', '1d')))).toEqual({ kind: 'NOT_FOUND', message: '找不到台股代號: 9999' });
    expect(finmindDatasets).toContain('TaiwanStockPrice');   // 備援確實打過
  });
});

describe('試探鏈：只有查無才換後綴（2026-10-01 拍板）', () => {
  it('.TW 被限流 → 不再試 .TWO，後端的限流錯誤原樣上拋', async () => {
    routes['/api/yahoo/chart'] = yahooRateLimited;
    const { getLatestPrice } = await import('./yahoo');
    expect(summary(await rejectionOf(getLatestPrice('9999')))).toEqual({
      kind: 'RATE_LIMIT', message: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。',
    });
    expect(chartSymbols).toEqual(['9999.TW']);
  });

  it('後端沒開 → 打一次就回 BACKEND_DOWN', async () => {
    routes['/api/finmind'] = backendDown;
    routes['/api/yahoo/chart'] = backendDown;
    const { getLatestPrice } = await import('./yahoo');
    expect(summary(await rejectionOf(getLatestPrice('9999')))).toEqual({ kind: 'BACKEND_DOWN', message: 'Fetch error (500)' });
    expect(chartSymbols).toEqual(['9999.TW']);
  });

  it('名錄說上市、.TW 被限流 → 只打一次（修前是 .TW、.TW、.TWO 三次）', async () => {
    routes['/api/finmind'] = directoryOr(finMindEmpty);
    routes['/api/yahoo/chart'] = yahooRateLimited;
    const { getLatestPrice } = await import('./yahoo');
    expect(await kindOf(getLatestPrice('9999'))).toBe('RATE_LIMIT');
    expect(chartSymbols).toEqual(['9999.TW']);
  });

  it('名錄說上市但 .TW 查無 → 只改試 .TWO，不重打 .TW', async () => {
    routes['/api/finmind'] = directoryOr(finMindEmpty);
    routes['/api/yahoo/chart'] = bySuffix(yahooNotFound, () => json(chart('9999.TWO', 88)));
    const { getLatestPrice } = await import('./yahoo');
    expect((await getLatestPrice('9999')).price).toBe(88);
    expect(chartSymbols).toEqual(['9999.TW', '9999.TWO']);
  });

  it('名錄說上櫃但 .TWO 查無 → 改試 .TW', async () => {
    routes['/api/finmind'] = directoryOr(finMindEmpty, 'tpex');
    routes['/api/yahoo/chart'] = bySuffix(() => json(chart('9999.TW', 77)), yahooNotFound);
    const { getLatestPrice } = await import('./yahoo');
    expect((await getLatestPrice('9999')).price).toBe(77);
    expect(chartSymbols).toEqual(['9999.TWO', '9999.TW']);
  });

  it('使用者取消（AbortError）原樣上拋、不換後綴（H-1）', async () => {
    routes['/api/yahoo/chart'] = () => { throw new DOMException('Aborted', 'AbortError'); };
    const { getLatestPrice } = await import('./yahoo');
    expect((await rejectionOf(getLatestPrice('9999')))?.name).toBe('AbortError');
    expect(chartSymbols).toEqual(['9999.TW']);
  });
});

describe('K 線的 FinMind 備援：兩邊都查無才算查無（2026-10-01 拍板）', () => {
  it('Yahoo 兩個後綴都查無、FinMind 被限流 → RATE_LIMIT（這檔有沒有資料還不知道）', async () => {
    routes['/api/yahoo/chart'] = yahooNotFound;
    routes['/api/finmind'] = finMindRateLimited;
    const { getStockData } = await import('./yahoo');
    expect(summary(await rejectionOf(getStockData('9999', '1d')))).toEqual({
      kind: 'RATE_LIMIT', message: 'FinMind 資料服務目前請求過於頻繁，請稍後再試一次。',
    });
    expect(finmindDatasets).toContain('TaiwanStockPrice');
  });

  it('Yahoo 查無、FinMind 上游無回應（502）→ BACKEND_DOWN', async () => {
    routes['/api/yahoo/chart'] = yahooNotFound;
    routes['/api/finmind'] = finMindUpstreamError;
    const { getStockData } = await import('./yahoo');
    expect(summary(await rejectionOf(getStockData('9999', '1d')))).toEqual({
      kind: 'BACKEND_DOWN', message: 'FinMind 資料服務暫時無法回應，請稍後再試。',
    });
    expect(finmindDatasets).toContain('TaiwanStockPrice');
  });

  it('Yahoo 被限流、FinMind 查無資料 → 仍是 Yahoo 的 RATE_LIMIT', async () => {
    routes['/api/yahoo/chart'] = yahooRateLimited;
    const { getStockData } = await import('./yahoo');
    expect(summary(await rejectionOf(getStockData('9999', '1d')))).toEqual({
      kind: 'RATE_LIMIT', message: 'Yahoo 行情服務目前請求過於頻繁，請稍後再試一次。',
    });
    expect(finmindDatasets).toContain('TaiwanStockPrice');
  });
});
