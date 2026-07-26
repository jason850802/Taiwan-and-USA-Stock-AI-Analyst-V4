// utils/geminiPrompts.test.ts — G6：prompt 端防漂移鎖（在出線處攔截）
//
// 補的是什麼：`utils/geminiRules.test.ts` 把 5 個 system instruction 逐位元組鎖住了，
// 但快取鍵是 `fnv1a(systemInstruction + ' ' + prompt)`——**prompt 那半邊沒鎖**。
// SI 動一字會紅、prompt 動一字不會紅，可是兩者讓 A3 分析快取與 Gemini implicit caching
// 失效的效果完全相同（＝使用者突然多付一輪費用）。gate 負向測試把這列為 G6。
//
// 為什麼在「出線處」攔而不是把 template 抽成 pure 函式：
// 四個 prompt 有三個是寫死在 async 函式裡的 template literal，測試從外面碰不到。抽成
// pure 函式要動到碰錢路徑的產品碼，且必須額外證明抽取前後**逐位元組相同**（差一個字
// 就讓所有使用者的快取失效一輪）。改成 mock global fetch、把送出去的 request body 攔下來：
// 產品碼零改動，而且鎖到的是**完整 prompt**——連 `analyzePortfolioHealth` 那句外層包裝詞
// （services/gemini.ts:960）一起，那正是 `formatHealthCheckData` 的快照鎖照不到的半邊。
//
// 為什麼不需要 localStorage stub：`readCache`／`writeCache` 都以
// `typeof localStorage === 'undefined'` 守衛，node 測試環境下整個快取層退化成 no-op，
// 所以每次呼叫都會真的走到 fetch，攔得到。
//
// **快照紅了不是壞事，是本檔的交付物**：它代表有人動了 prompt。prompt 是資料版面、
// 正當修改比 SI 頻繁，紅了先確認是刻意的（並意識到「所有人的快取會失效一輪」），再 -u。
//
// 分支涵蓋：entry 兩案（持有/空手 × 觸犯戒律/未觸犯）、trade decision 兩案
// （台股「張」＋買入當日命中 / 美股「股」＋查無買入當日）、健檢一案（台股＋美股同時）、
// 基本面一案（含 null 欄位走 N/A）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  analyzeEntryWithGemini,
  analyzeTradeDecision,
  analyzePortfolioHealth,
  analyzeFundamentals,
  type PortfolioHealthItem,
} from '../services/gemini';
import type { StockDataPoint, TwFundamentals } from '../types';
import type { EntryFilterResult } from './entryFilter';

// ── fetch 攔截 ────────────────────────────────────────────────────────────────

type CapturedPayload = {
  prompt: string;
  systemInstruction: string;
  mode: string;
  temperature?: number;
  thinkingConfig?: unknown;
};

let captured: { url: string; payload: CapturedPayload }[] = [];

beforeEach(() => {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body: string }) => {
    captured.push({ url: String(url), payload: JSON.parse(init.body) as CapturedPayload });
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: 'stub 回應（本測試不驗回應處理，只驗送出去的 prompt）' }),
    };
  }));
});

// vi.stubGlobal 由 vitest 在每個測試後自動還原（unstubEnvs/unstubAllGlobals 的預設行為
// 不含 globals，故顯式還原）
afterEach(() => {
  vi.unstubAllGlobals();
});

/** 取唯一一次送出的 payload；順便斷言沒有多送或漏送。 */
function onlyCall(): { url: string; payload: CapturedPayload } {
  expect(captured).toHaveLength(1);
  return captured[0];
}

/** payload 裡除了 prompt／systemInstruction 以外的欄位——全是計費旋鈕，一併鎖住。 */
function billingKnobs(p: CapturedPayload) {
  return { mode: p.mode, temperature: p.temperature, thinkingConfig: p.thinkingConfig };
}

// ── fixtures ────────────────────────────────────────────────────────────────

const bar = (over: Partial<StockDataPoint>): StockDataPoint => ({
  date: '2026-01-02', open: 100, high: 105, low: 99, close: 104, volume: 12_000_000,
  ma5: 102, ma10: 101, ma20: 100, ma60: 95,
  k: 70.5, d: 60.25, j: 90.75, macd: 1.234, macdSignal: 0.987, macdHist: 0.247,
  bbUpper: 110, bbMiddle: 100, bbLower: 90,
  ...over,
} as StockDataPoint);

const ENTRY_HOLDING: EntryFilterResult = {
  symbol: '2330.TW',
  asof: '2026-01-06',
  price: 1040,
  trend: '多頭',
  trendReason: '頭頭高底底高，近 3 波皆抬升',
  weeklyTrend: '多頭',
  steps: [
    { id: 1, key: 'trend', name: '趨勢研判', status: 'pass', verdict: '日線多頭', details: ['頭頭高', '底底高'] },
    { id: 2, key: 'position', name: '當下位置', status: 'warn', verdict: '主升段偏高檔', details: ['距波段起漲 +18%'] },
    { id: 3, key: 'kline', name: 'K線轉折', status: 'fail', verdict: '無關鍵進場K', details: ['實體過短', '未過前高'] },
  ],
  sop: [
    { label: '月線之上', ok: true },
    { label: '攻擊量', ok: false, note: '量能不足昨量 1.3 倍' },
  ],
  entryPattern: '回後買上漲',
  preceptHits: [
    { no: 3, text: '不可追高追價' },
    { no: 7, text: '不可在高檔爆量後進場' },
  ],
  decision: 'WAIT',
  confidence: 55,
  entryPrice: 1035,
  stopPrice: 983.25,
  maGuardPrice: 1000,
  guardMaLabel: '中長線MA20',
  takeProfitRule: '跌破 MA10 收盤出場，或漲幅達 20% 減半',
  summary: '多頭但位置偏高，等回測月線再看',
};

const ENTRY_EMPTY_HANDED: EntryFilterResult = {
  symbol: 'AAPL',
  asof: '2026-01-05',
  price: 325.89,
  trend: '盤整',
  trendReason: '近 20 日高低點交錯，無明確方向',
  steps: [
    { id: 1, key: 'trend', name: '趨勢研判', status: 'warn', verdict: '盤整', details: ['區間 310~330'] },
  ],
  sop: [{ label: '月線之上', ok: true }],
  entryPattern: '皆不符',
  preceptHits: [],
  decision: 'NO_GO',
  confidence: 30,
  entryPrice: 0,
  stopPrice: 0,
  takeProfitRule: '不進場，無停利規則',
  summary: '盤整無訊號，不進場',
};

const TW_HEALTH_ITEM: PortfolioHealthItem = {
  symbol: '2330.TW',
  name: '台積電',
  avgCostPrice: 900,
  currentPrice: 1040,
  totalShares: 1000,
  profitPct: 15.56,
  recentData: [
    bar({ date: '2026-01-02', close: 100, volume: 20_000_000, foreignBuySell: 3_000_000, investmentTrustBuySell: 500_000 }),
    bar({ date: '2026-01-03', close: 102, volume: 25_000_000, foreignBuySell: -1_000_000, investmentTrustBuySell: 200_000 }),
    bar({ date: '2026-01-06', close: 104, volume: 31_000_000, foreignBuySell: 4_000_000, investmentTrustBuySell: 800_000 }),
  ],
  volumeProjection: null,
};

const US_HEALTH_ITEM: PortfolioHealthItem = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  avgCostPrice: 250,
  currentPrice: 325.89,
  totalShares: 10,
  profitPct: 30.36,
  recentData: [
    bar({ date: '2026-01-02', close: 320, volume: 45_000_000 }),
    bar({ date: '2026-01-05', close: 325.89, volume: 52_000_000 }),
  ],
  volumeProjection: null,
};

const FUNDAMENTALS: TwFundamentals = {
  stockId: '2330',
  name: '台積電',
  industry: '半導體業',
  asOf: '2026-01-06',
  valuation: { date: '2026-01-05', per: 22.5, pbr: 6.1, dividendYieldPct: 1.42 },
  incomeQuarters: [
    {
      quarter: '2025Q3', revenueYi: 7593.2,
      grossProfitYi: 4388.9, operatingIncomeYi: 3606.8, pretaxIncomeYi: 3690.4,
      netIncomeYi: 3252.6, eps: 12.54,
      grossMarginPct: 57.8, operatingMarginPct: 47.5, netMarginPct: 42.8,
    },
    // 刻意留 null：驗 naFixed 的 N/A 分支（金融股等產業毛利率為 null）
    {
      quarter: '2025Q4', revenueYi: 8123.7,
      grossProfitYi: null, operatingIncomeYi: null, pretaxIncomeYi: null,
      netIncomeYi: null, eps: null,
      grossMarginPct: null, operatingMarginPct: null, netMarginPct: null,
    },
  ],
  balanceSheet: {
    date: '2025-12-31', cashYi: 21500.4, receivablesYi: 2800.1, inventoriesYi: 2600.9,
    currentAssetsYi: 28000.2, ppeYi: 41000.5, totalAssetsYi: 78000.3,
    totalLiabilitiesYi: 24000.1, equityYi: 54000.2, debtRatioPct: 30.77,
  },
  cashFlow: {
    date: '2025-12-31', operatingCfYi: 15200.8, investingCfYi: -9800.4,
    financingCfYi: -2100.6, capexYi: -9500.2, freeCashFlowYi: 5700.6,
  },
  monthlyRevenue: [
    { ym: '2025-11', revenueYi: 2760.3, yoyPct: 26.4 },
    { ym: '2025-12', revenueYi: 2890.1, yoyPct: null }, // null → N/A 分支
  ],
  dividends: [
    { period: '2025Q2', announceDate: '2025-08-14', cashDividend: 4.5, stockDividend: 0, exDate: '2025-09-18' },
    { period: '2025Q3', announceDate: '2025-11-13', cashDividend: 5.0, stockDividend: 0, exDate: null }, // null → N/A
  ],
  warnings: [],
};

// ── 出線 prompt 的位元組鎖 ───────────────────────────────────────────────────

describe('analyzeEntryWithGemini 的 prompt', () => {
  it('持有中＋觸犯戒律：逐字未變', async () => {
    await analyzeEntryWithGemini(ENTRY_HOLDING, { hasHolding: true, costPrice: 900 }, 'fast');
    const { url, payload } = onlyCall();
    expect(url).toBe('/api/gemini');
    expect(payload.prompt).toMatchSnapshot();
    expect(billingKnobs(payload)).toMatchSnapshot();
  });

  it('空手＋未觸犯戒律（無週線／無均線防守價）：逐字未變', async () => {
    await analyzeEntryWithGemini(ENTRY_EMPTY_HANDED, undefined, 'thinking');
    const { payload } = onlyCall();
    expect(payload.prompt).toMatchSnapshot();
    expect(billingKnobs(payload)).toMatchSnapshot();
  });

  it('串流路徑送出的 prompt 與非串流逐位元組相同（兩條路不得漂移分歧）', async () => {
    await analyzeEntryWithGemini(ENTRY_HOLDING, { hasHolding: true, costPrice: 900 }, 'fast');
    const nonStream = onlyCall();

    captured = [];
    // 串流路徑會在讀 response.body 時失敗（mock 沒有 body）——但 fetch 早已被攔下，
    // 要驗的 payload 在拋錯前就到手了。
    await expect(
      analyzeEntryWithGemini(ENTRY_HOLDING, { hasHolding: true, costPrice: 900 }, 'fast', () => {}),
    ).rejects.toThrow();
    const stream = onlyCall();

    expect(stream.url).toBe('/api/gemini-stream');
    expect(stream.payload.prompt).toBe(nonStream.payload.prompt);
    expect(stream.payload.systemInstruction).toBe(nonStream.payload.systemInstruction);
  });
});

describe('analyzeTradeDecision 的 prompt', () => {
  it('台股（量用「張」）＋買入當日命中日K：逐字未變', async () => {
    await analyzeTradeDecision(
      '2330.TW',
      '2026-01-03',
      950,
      '看到突破月線帶量，追了一張',
      1040,
      [
        bar({ date: '2026-01-02', close: 940, volume: 20_000_000 }),
        bar({ date: '2026-01-03', open: 945, close: 962, volume: 31_000_000 }),
        bar({ date: '2026-01-06', close: 1040, volume: 28_000_000 }),
      ],
    );
    const { url, payload } = onlyCall();
    expect(url).toBe('/api/gemini');
    expect(payload.prompt).toMatchSnapshot();
    expect(billingKnobs(payload)).toMatchSnapshot();
  });

  it('美股（量用「股」）＋查無買入當日：逐字未變（含 HIGH-1 的不得靜默頂替提示）', async () => {
    await analyzeTradeDecision(
      'AAPL',
      '2026-01-04', // 非交易日：recentData 裡沒有這天
      300,
      '', // 未填寫原因 → 走「（未填寫）」分支
      undefined, // 無目前市價 → priceLine 只有買入價一行
      [
        bar({ date: '2026-01-02', close: 320, volume: 45_000_000 }),
        bar({ date: '2026-01-05', close: 325.89, volume: 52_000_000 }),
      ],
    );
    const { payload } = onlyCall();
    expect(payload.prompt).toMatchSnapshot();
  });
});

describe('analyzePortfolioHealth 的 prompt', () => {
  it('完整 prompt 逐字未變（含 formatHealthCheckData 快照鎖不到的外層包裝詞）', async () => {
    await analyzePortfolioHealth([TW_HEALTH_ITEM, US_HEALTH_ITEM]);
    const { url, payload } = onlyCall();
    expect(url).toBe('/api/gemini');
    expect(payload.prompt).toMatchSnapshot();
    expect(billingKnobs(payload)).toMatchSnapshot();
  });

  it('外層包裝詞確實在 prompt 裡（不是只送 formatHealthCheckData 的輸出）', async () => {
    await analyzePortfolioHealth([TW_HEALTH_ITEM]);
    expect(onlyCall().payload.prompt.startsWith('以下是我目前的庫存持股')).toBe(true);
  });
});

describe('analyzeFundamentals 的 prompt', () => {
  it('含 null 欄位（走 N/A）：逐字未變', async () => {
    await analyzeFundamentals(FUNDAMENTALS);
    const { url, payload } = onlyCall();
    expect(url).toBe('/api/gemini');
    expect(payload.prompt).toMatchSnapshot();
    expect(billingKnobs(payload)).toMatchSnapshot();
  });
});
