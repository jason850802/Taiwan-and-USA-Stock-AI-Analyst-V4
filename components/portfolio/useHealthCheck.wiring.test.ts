// components/portfolio/useHealthCheck.wiring.test.ts — 健檢 hook 的接線：缺資料的檔位個別標記、不送 AI、不拖垮同批
//
// 2026-10-03 起因：報價回應成功但價格無效時，formatHealthCheckData 對 undefined 呼叫 toFixed 丟 TypeError——
// 單檔被標成「分析失敗」（像 AI 掛了），批次則整輪送 AI 的檔位一起失敗；讀取失敗、載入中則把 0 當現價送 AI。
// 修法（使用者拍板）：沒有可用報價就不送 AI、標「缺報價」（文案逐字鎖在 useHealthCheck.test.ts）；
// 美股成本換算改走 lotCostUsd，口徑同持股表（2026-07-24：成本用買入匯率）。
//
// 寫法：vitest 沒有 DOM、禁裝新套件，所以不經 React 渲染器——以極簡假 dispatcher 取代 react 的 hooks
// （state／ref 依呼叫順序存在槽位裡，layout effect 只在第一次渲染執行），直接呼叫 hook 拿 handler 來驅動，
// 讀結果時再「渲染」一次取最新 state。真的 analyzePortfolioHealth → formatHealthCheckData 照跑，
// 只在 fetch 層攔 /api/gemini-stream（不打真 API、不花 AI 額度），K 線來源 getStockData 換成合成資料。
// 限制：hook 改用這裡沒模擬的 React API 會直接報錯（不會默默失效），屆時在假 dispatcher 補上；
// effect 依 deps 重跑與重新渲染的時機都沒模擬，只適合「渲染一次 → 呼叫 handler → 讀結果」的流程。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortfolioItem, StockDataPoint } from '../../types';
import type { PriceData } from './useHoldingPrices';

const h = vi.hoisted(() => {
  let slots: unknown[] = [];
  let idx = 0;
  return {
    reset() { slots = []; idx = 0; },
    beginRender() { idx = 0; },
    useState<T>(init: T | (() => T)) {
      const i = idx++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? (init as () => T)() : init;
      const set = (u: T | ((prev: T) => T)) => {
        slots[i] = typeof u === 'function' ? (u as (prev: T) => T)(slots[i] as T) : u;
      };
      return [slots[i] as T, set] as const;
    },
    useRef<T>(init: T) {
      const i = idx++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i] as { current: T };
    },
    useCallback<F>(fn: F) { idx++; return fn; },
    useMemo<T>(fn: () => T) { idx++; return fn(); },
    useLayoutEffect(fn: () => void | (() => void)) {
      const i = idx++;
      if (!(i in slots)) { slots[i] = true; fn(); }
    },
  };
});
vi.mock('react', () => ({
  useState: h.useState, useRef: h.useRef, useCallback: h.useCallback,
  useMemo: h.useMemo, useLayoutEffect: h.useLayoutEffect,
}));

const kline = vi.hoisted(() => ({ data: {} as Record<string, unknown[]> }));
vi.mock('../../services/yahoo', () => ({
  getStockData: async (symbol: string) => {
    const data = kline.data[symbol];
    if (!data) throw new Error(`no kline for ${symbol}`);
    return { data };
  },
}));

import { useHealthCheck, quoteGapMarkdown } from './useHealthCheck';
import { DECISION_EMOJI } from '../../services/_shared/healthDecision';

const SINGLE = '。';
const BATCH = '，或單獨對此檔重跑健檢。';
const DONE = { status: 'done', decision: DECISION_EMOJI['續抱'] + '續抱' };

const lot = (symbol: string, avg: number, shares: number): PortfolioItem => ({
  id: symbol, symbol, avgCostPrice: avg, totalShares: shares, totalCost: avg * shares,
  brokerDiscount: 2.8, cashDividends: 0, stockDividends: 0,
});
const KLINE = [{ date: '2026-10-02', open: 100, high: 100, low: 100, close: 100, volume: 1_000_000 } as StockDataPoint];

const ok = (price: number): PriceData => ({ price, name: 'X', loading: false, error: false });
const INVALID = ok(undefined as unknown as number);   // 回應成功但價格無效（下市冷門股會回這種）
const FAILED: PriceData = { price: 0, name: '9999', loading: false, error: true };
const LOADING: PriceData = { price: 0, name: '9999', loading: true, error: false };

/** 送到 /api/gemini-stream 的 prompt；長度＝打 AI 的次數 */
const prompts: string[] = [];

const mount = (items: PortfolioItem[], prices: Record<string, PriceData>, rate = 0) => {
  h.reset();
  const render = () => { h.beginRender(); return useHealthCheck(items, prices, rate); };
  return { hook: render(), results: () => render().healthResults };
};

beforeEach(() => {
  prompts.length = 0;
  kline.data = {};
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  // 假 AI：每檔回「續抱」並附 json 決策區（照 prompt 標頭的代號）
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { body: string }) => {
    const { prompt } = JSON.parse(init.body) as { prompt: string };
    prompts.push(prompt);
    const symbols = [...prompt.matchAll(/（([^（）]+)）==========/g)].map(m => m[1]);
    const report = symbols.map(s => `## ${s}\n續抱`).join('\n\n')
      + '\n```json\n' + JSON.stringify({ decisions: symbols.map(symbol => ({ symbol, decision: '續抱' })) }) + '\n```';
    return new Response(JSON.stringify({ t: 'done', text: report }) + '\n', { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('對照組：資料齊全照常送 AI', () => {
  it('單檔：完成、提示詞帶真的現價', async () => {
    kline.data['9999'] = KLINE;
    const { hook, results } = mount([lot('9999', 90, 1000)], { '9999': ok(100) });
    await hook.handleSingleHealthCheck('9999');
    expect(results()['9999']).toMatchObject(DONE);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('目前市價：100.00 TWD');
  });
});

describe('報價不可用：不送 AI、個別標「缺報價」', () => {
  it.each([
    ['回應成功但價格無效', INVALID, 'failed'],
    ['讀取失敗', FAILED, 'failed'],
    ['載入中', LOADING, 'loading'],
    ['還沒有報價項目', undefined, 'loading'],
  ] as const)('單檔＋%s', async (_label, quote, kind) => {
    kline.data['9999'] = KLINE;
    const { hook, results } = mount([lot('9999', 90, 1000)], quote ? { '9999': quote } : {});
    await hook.handleSingleHealthCheck('9999');
    expect(results()['9999']).toEqual({ status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown(kind, SINGLE) });
    expect(prompts).toHaveLength(0);
  });

  it('單檔＋K 線也抓不到：沿用行情抓取失敗（先看 K 線）', async () => {
    const { hook, results } = mount([lot('9999', 90, 1000)], { '9999': INVALID });
    await hook.handleSingleHealthCheck('9999');
    expect(results()['9999']).toMatchObject({ status: 'error', decision: '資料取得失敗' });
    expect(prompts).toHaveLength(0);
  });

  it('批次＋一檔價格無效：正常那檔照常完成，只有它送 AI', async () => {
    kline.data['2330'] = KLINE;
    kline.data['9999'] = KLINE;
    const { hook, results } = mount(
      [lot('2330', 500, 1000), lot('9999', 90, 1000)],
      { '2330': ok(600), '9999': INVALID },
    );
    await hook.handleBatchHealthCheck();
    expect(results()['2330']).toMatchObject(DONE);
    expect(results()['9999']).toEqual({ status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown('failed', BATCH) });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('（2330）');
    expect(prompts[0]).not.toContain('（9999）');
  });

  it('批次＋一檔載入中、一檔讀取失敗：各自標記，送 AI 的提示詞不會出現 0 元現價', async () => {
    kline.data['2330'] = KLINE;
    kline.data['1234'] = KLINE;
    kline.data['9999'] = KLINE;
    const { hook, results } = mount(
      [lot('2330', 500, 1000), lot('1234', 50, 1000), lot('9999', 90, 1000)],
      { '2330': ok(600), '1234': LOADING, '9999': FAILED },
    );
    await hook.handleBatchHealthCheck();
    expect(results()['2330']).toMatchObject(DONE);
    expect(results()['1234']).toEqual({ status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown('loading', BATCH) });
    expect(results()['9999']).toEqual({ status: 'error', decision: '缺報價', fullResult: quoteGapMarkdown('failed', BATCH) });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('目前市價：0.00');
  });

  it('批次全部缺報價：本輪不打 AI', async () => {
    kline.data['9999'] = KLINE;
    const { hook, results } = mount([lot('9999', 90, 1000)], { '9999': FAILED });
    await hook.handleBatchHealthCheck();
    expect(results()['9999']).toMatchObject({ status: 'error', decision: '缺報價' });
    expect(prompts).toHaveLength(0);
  });
});

describe('美股成本換算：口徑同持股表（成本用買入匯率）', () => {
  // 台幣成本 310,000、100 股、現價 110 USD；買入匯率 31（＝10,000 USD）、即時匯率 32.5
  const usLot = (over: Partial<PortfolioItem>): PortfolioItem => ({
    id: 'u', symbol: 'AAPL', avgCostPrice: 3100, totalShares: 100, totalCost: 310_000,
    brokerDiscount: 0, cashDividends: 0, stockDividends: 0, purchaseCurrency: 'TWD', ...over,
  });
  const promptFor = async (item: PortfolioItem, rate: number) => {
    kline.data['AAPL'] = KLINE;
    const { hook } = mount([item], { AAPL: ok(110) }, rate);
    await hook.handleSingleHealthCheck('AAPL');
    expect(prompts).toHaveLength(1);
    return prompts[0];
  };

  it('台幣計價、有買入匯率 → 用買入匯率：均價 100.00、損益 +10.00%、停損線 ① 95.00', async () => {
    const prompt = await promptFor(usLot({ exchangeRate: 31 }), 32.5);
    expect(prompt).toContain('買入均價：100.00 USD');
    expect(prompt).toContain('損益幅度：+10.00%');
    expect(prompt).toContain('① 95.00 USD（買入均價 × 95%）');
  });

  it('台幣計價、沒記買入匯率（舊資料）→ 退回即時匯率：均價 95.38', async () => {
    const prompt = await promptFor(usLot({ purchaseCurrency: undefined }), 32.5);
    expect(prompt).toContain('買入均價：95.38 USD');
  });

  it('台幣計價、沒記買入匯率、即時匯率也未取得 → 仍以 32 估：均價 96.88（使用者：實務上會等匯率到齊才按健檢，不另處理）', async () => {
    const prompt = await promptFor(usLot({ purchaseCurrency: undefined }), 0);
    expect(prompt).toContain('買入均價：96.88 USD');
  });

  it('USD 計價 → 固定美元成本，與匯率無關', async () => {
    const usd = usLot({ purchaseCurrency: 'USD', totalCostUSD: 10_000, totalCost: 0, avgCostPrice: 100, exchangeRate: 31 });
    expect(await promptFor(usd, 32.5)).toContain('買入均價：100.00 USD');
    prompts.length = 0;
    expect(await promptFor(usd, 0)).toContain('買入均價：100.00 USD');
  });
});
