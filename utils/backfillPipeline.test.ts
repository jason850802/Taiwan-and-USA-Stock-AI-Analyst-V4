// utils/backfillPipeline.test.ts — Phase 12 T4：回推編排層的行為鎖
//
// 這段編排（快取先行 → 併發抓 → 退避重試 → 批次寫快取 → 選模式建列）原本綁在 React
// 元件裡一個 case 都測不到，卻是全專案跑最久、失敗成本最高的一段。
// 期望快照值一律**手排**（不看實作跑出來的數字回填），算法來源：
//   marketValue = Σ 當日 close × 持股；totalCost = Σ (gross + fee)；
//   estSellCosts(TW) = Σ per-symbol [max(1, floor(value×0.001425)) + floor(value×稅率)]，個股稅率 0.003。
import { describe, it, expect, vi } from 'vitest';
import { runBackfillPipeline, type BackfillPorts, type DailyBar, type BackfillProgress } from './backfillPipeline';
import { DataFetchError } from '../services/fetchError';
import type { StoredTxn } from './txnStore';
import type { CloseBar } from './closeSeriesCache';
import type { DailyPnlSnapshot, PortfolioItem } from '../types';

// ── fixture：兩檔台股，AAA 01/02 進場、BBB 01/05 進場 ──────────────────────
const txn = (over: Partial<StoredTxn>): StoredTxn => ({
  date: '2026-01-02', symbol: 'AAA', name: 'AAA', market: 'TW', kind: 'buy',
  shares: 1000, price: 10, gross: 10000, fee: 14, tax: 0, source: 'import', key: 'k',
  ...over,
});

const TXNS: StoredTxn[] = [
  txn({ date: '2026-01-02', symbol: 'AAA', shares: 1000, price: 10, gross: 10000, fee: 14, key: 'a1' }),
  txn({ date: '2026-01-05', symbol: 'BBB', shares: 500, price: 50, gross: 25000, fee: 35, key: 'b1' }),
];

const BARS: Record<string, DailyBar[]> = {
  AAA: [{ date: '2026-01-02', close: 10 }, { date: '2026-01-05', close: 11 }, { date: '2026-01-06', close: 12 }],
  BBB: [{ date: '2026-01-05', close: 50 }, { date: '2026-01-06', close: 52 }],
};

const tick = () => new Promise(r => setTimeout(r, 0));

interface FakeOpts {
  bars?: Record<string, DailyBar[]>;
  cache?: Record<string, CloseBar[]>;
  failTimes?: Record<string, number>;                 // symbol → 前 N 次抓取失敗
  errorFor?: (symbol: string) => unknown;             // 失敗時丟什麼
}

const makePorts = (opts: FakeOpts = {}) => {
  const bars = opts.bars ?? BARS;
  const failTimes = { ...(opts.failTimes ?? {}) };
  const cacheMap: Record<string, CloseBar[]> = { ...(opts.cache ?? {}) };
  const state = {
    fetched: [] as string[],
    sleeps: [] as number[],
    putMany: [] as { entries: { symbol: string; bars: CloseBar[] }[]; fromDate?: string }[],
    inFlight: 0,
    peakInFlight: 0,
    peakByRound: [] as number[],
  };
  const ports: BackfillPorts = {
    fetchDaily: async (symbol) => {
      state.fetched.push(symbol);
      state.inFlight++;
      state.peakInFlight = Math.max(state.peakInFlight, state.inFlight);
      await tick();
      state.inFlight--;
      if ((failTimes[symbol] ?? 0) > 0) {
        failTimes[symbol]--;
        throw (opts.errorFor ?? ((s: string) => new DataFetchError('RATE_LIMIT', `Fetch error (429) ${s}`)))(symbol);
      }
      return bars[symbol] ?? [];
    },
    closeCache: {
      get: (symbol) => cacheMap[symbol] ?? null,
      putMany: (entries, fromDate) => { state.putMany.push({ entries, fromDate }); },
    },
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.peakByRound.push(state.peakInFlight);
      state.peakInFlight = 0;   // 每輪重新量測併發峰值
    },
  };
  return { ports, state };
};

const run = (over: Partial<Parameters<typeof runBackfillPipeline>[0]> = {}, ports?: BackfillPorts) =>
  runBackfillPipeline({
    market: 'TW',
    items: [],
    txns: TXNS,
    realizedTrades: [],
    usdTwdRate: 0,
    loadExistingSnapshots: () => [],
    ports,
    ...over,
  });

const strip = (rows: DailyPnlSnapshot[]) => rows.map(({ capturedAt, ...rest }) => rest);

describe('runBackfillPipeline｜快取與抓取', () => {
  it('全快取命中時一次網路都不打', async () => {
    const { ports, state } = makePorts({
      cache: {
        AAA: BARS.AAA.map(b => ({ date: b.date, close: b.close as number })),
        BBB: BARS.BBB.map(b => ({ date: b.date, close: b.close as number })),
      },
    });
    const res = await run({}, ports);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(state.fetched).toEqual([]);
    expect(res.cacheHits).toBe(2);
    expect(res.fetched).toBe(0);
    expect(res.snapshots).toHaveLength(3);
  });

  it('全新抓取：快照值與手排結果逐欄相同', async () => {
    const { ports } = makePorts();
    const res = await run({}, ports);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 手排：01/02 只有 AAA（1000 股 @10）；成本 10000+14
    //       賣費 max(1,floor(10000×0.001425))=14、稅 floor(10000×0.003)=30 → 44
    expect(strip(res.snapshots)[0]).toEqual({
      date: '2026-01-02', market: 'TW', source: 'backfill',
      marketValue: 10000, totalCost: 10014, estSellCosts: 44, cashDividends: 0, symbolCount: 1,
    });
    // 手排：01/05 AAA 11×1000=11000（賣費 15＋稅 33＝48）＋BBB 50×500=25000（賣費 35＋稅 75＝110）
    expect(strip(res.snapshots)[1]).toEqual({
      date: '2026-01-05', market: 'TW', source: 'backfill',
      marketValue: 36000, totalCost: 35049, estSellCosts: 158, cashDividends: 0, symbolCount: 2,
    });
    // 手排：01/06 AAA 12×1000=12000（17＋36＝53）＋BBB 52×500=26000（37＋78＝115）
    expect(strip(res.snapshots)[2]).toEqual({
      date: '2026-01-06', market: 'TW', source: 'backfill',
      marketValue: 38000, totalCost: 35049, estSellCosts: 168, cashDividends: 0, symbolCount: 2,
    });
  });

  it('快取批次寫入只發生一次，且帶最早交易日作為裁切起點', async () => {
    const { ports, state } = makePorts();
    await run({}, ports);
    expect(state.putMany).toHaveLength(1);
    expect(state.putMany[0].fromDate).toBe('2026-01-02');
    expect(state.putMany[0].entries.map(e => e.symbol).sort()).toEqual(['AAA', 'BBB']);
  });
});

describe('runBackfillPipeline｜限流退避重試', () => {
  it('首輪失敗、重試補齊 → 快照與全成功時完全一致', async () => {
    const { ports: okPorts } = makePorts();
    const good = await run({}, okPorts);
    const { ports, state } = makePorts({ failTimes: { BBB: 1 } });
    const res = await run({}, ports);

    expect(res.ok).toBe(true);
    if (!res.ok || !good.ok) return;
    expect(strip(res.snapshots)).toEqual(strip(good.snapshots));
    expect(state.sleeps).toEqual([45000]);           // 只退避一輪
    expect(state.fetched.filter(s => s === 'BBB')).toHaveLength(2);
  });

  it('重試兩輪仍失敗 → ok:false、missedSymbols 與 kind 正確', async () => {
    const { ports, state } = makePorts({ failTimes: { BBB: 99 } });
    const res = await run({}, ports);

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missedSymbols).toEqual(['BBB']);
    expect(res.kind).toBe('RATE_LIMIT');
    expect(res.detail).toContain('Fetch error (429)');
    expect(state.sleeps).toEqual([45000, 45000]);    // 政策：重試兩輪
    expect(state.fetched.filter(s => s === 'BBB')).toHaveLength(3);   // 首輪＋兩次重試
    expect(state.fetched.filter(s => s === 'AAA')).toHaveLength(1);   // 成功的不重抓
  });

  it('非 DataFetchError 的失敗不硬猜 kind，原文交給 UI 比對', async () => {
    const { ports } = makePorts({ failTimes: { BBB: 99 }, errorFor: () => new Error('boom 500 internal') });
    const res = await run({}, ports);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBeUndefined();
    expect(res.detail).toBe('boom 500 internal');
  });

  it('併發政策：首輪 3 條線、重試輪降到 1 條', async () => {
    const many = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
    const bars = Object.fromEntries(many.map(s => [s, [{ date: '2026-01-02', close: 10 }]]));
    const txns = many.map((s, i) => txn({ symbol: s, key: `k${i}` }));
    const { ports, state } = makePorts({ bars, failTimes: { DDD: 1, EEE: 1 } });
    await run({ txns }, ports);
    expect(state.peakByRound[0]).toBe(3);   // 首輪
    expect(state.peakInFlight).toBe(1);     // 重試輪（最後一輪後未再 sleep）
  });
});

describe('runBackfillPipeline｜模式選擇與邊界', () => {
  it('有流水走流水模式（含已清倉部位）', async () => {
    const { ports } = makePorts({
      bars: {
        AAA: [{ date: '2026-01-02', close: 10 }, { date: '2026-01-05', close: 11 }],
      },
    });
    const sold: StoredTxn[] = [
      txn({ date: '2026-01-02', symbol: 'AAA', key: 'a1' }),
      txn({ date: '2026-01-05', symbol: 'AAA', kind: 'sell', shares: 1000, gross: 11000, fee: 15, tax: 33, key: 'a2' }),
    ];
    const res = await run({ txns: sold }, ports);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 01/02 有持股；01/05 當日全數賣出 → 該日無持股，不入列
    expect(res.snapshots.map(r => r.date)).toEqual(['2026-01-02']);
  });

  it('沒有流水時退回現存持股逆推（lots 模式）', async () => {
    const { ports, state } = makePorts({ bars: { AAA: BARS.AAA } });
    const items: PortfolioItem[] = [{
      id: 'l1', symbol: 'AAA', totalShares: 1000, totalCost: 10014, buyDate: '2026-01-02',
      cashDividends: 0, stockDividends: 0,
    } as PortfolioItem];
    const res = await run({ txns: [], items }, ports);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(state.fetched).toEqual(['AAA']);
    expect(res.snapshots.length).toBeGreaterThan(0);
    expect(res.snapshots.every(r => r.source === 'backfill')).toBe(true);
  });

  it('沒有任何可回推標的 → NO_DATA，不打網路', async () => {
    const { ports, state } = makePorts();
    const res = await run({ txns: [], items: [] }, ports);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe('NO_DATA');
    expect(state.fetched).toEqual([]);
  });

  it('live 快照存在時，回推只填第一筆 live 之前', async () => {
    const { ports } = makePorts();
    const live: DailyPnlSnapshot[] = [{
      date: '2026-01-05', market: 'TW', source: 'live',
      marketValue: 0, totalCost: 0, estSellCosts: 0, cashDividends: 0, symbolCount: 0, capturedAt: 1,
    }];
    const res = await run({ loadExistingSnapshots: () => live }, ports);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshots.map(r => r.date)).toEqual(['2026-01-02']);   // 01/05 起交給 live
  });

  it('現有快照是抓完才讀的（thunk 語意，避免長時間抓取期間讀到過期邊界）', async () => {
    const { ports, state } = makePorts();
    const loadOrder: number[] = [];
    await run({ loadExistingSnapshots: () => { loadOrder.push(state.fetched.length); return []; } }, ports);
    expect(loadOrder).toEqual([2]);   // 呼叫時兩檔都已抓完
  });
});

describe('runBackfillPipeline｜進度回報', () => {
  it('done 單調遞增且收在 total', async () => {
    const { ports } = makePorts();
    const seen: BackfillProgress[] = [];
    await run({ onProgress: p => seen.push({ ...p }) }, ports);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(p => p.total === 2)).toBe(true);
    const dones = seen.map(p => p.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));   // 不倒退
    expect(dones[dones.length - 1]).toBe(2);
  });

  it('退避等待期間回報 retrying 與 waitSec 給進度文字用', async () => {
    const { ports } = makePorts({ failTimes: { BBB: 1 } });
    const seen: BackfillProgress[] = [];
    await run({ onProgress: p => seen.push({ ...p }) }, ports);
    expect(seen.some(p => p.retrying === 1 && p.waitSec === 45)).toBe(true);
    expect(seen.some(p => p.retrying === 1 && p.waitSec === 0)).toBe(true);
  });

  it('快取命中的檔數在開跑時就計入進度', async () => {
    const { ports } = makePorts({ cache: { AAA: [{ date: '2026-01-02', close: 10 }] } });
    const seen: BackfillProgress[] = [];
    await run({ onProgress: p => seen.push({ ...p }) }, ports);
    expect(seen[0]).toEqual({ done: 1, total: 2 });
  });
});
