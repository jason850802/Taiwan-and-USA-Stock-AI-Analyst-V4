// utils/portfolioHistoryStore.ts — 庫存歷史損益的 localStorage 薄 IO 層（Phase 10 T4）
// 無業務邏輯；版本驗證：未知版本「原樣保留、回空啟動」不破壞資料；
// quota 守衛：快照寫入失敗先裁最舊 1/4 的 backfill 列重試一次，再失敗回 false 由 UI 提示。
import { RealizedTrade, DailyPnlSnapshot } from '../types';
import { createPersistentStore } from './persistentStore';

const TRADES_KEY = 'portfolio_realized_trades_v1';
const SNAPSHOTS_KEY = 'portfolio_snapshots_v1';

/** 儲存信封（位元組相容：`{"version":1,"trades":[...]}`／`{"version":1,"rows":[...]}`） */
interface TradesFile { version: 1; trades: RealizedTrade[] }
interface SnapshotsFile { version: 1; rows: DailyPnlSnapshot[] }

// 已實現帳本無裁剪策略（是史料，不砍）
const tradesStore = createPersistentStore<TradesFile>({
  key: TRADES_KEY,
  fallback: () => ({ version: 1, trades: [] }),
  decode: (raw: any) => {
    if (raw?.version !== 1 || !Array.isArray(raw.trades)) {
      console.warn('[portfolioHistoryStore] 未知版本的已實現帳本（原樣保留，以空帳本啟動）:', raw?.version);
      return null;
    }
    return raw as TradesFile;
  },
});

const snapshotsStore = createPersistentStore<SnapshotsFile>({
  key: SNAPSHOTS_KEY,
  fallback: () => ({ version: 1, rows: [] }),
  decode: (raw: any) => {
    if (raw?.version !== 1 || !Array.isArray(raw.rows)) {
      console.warn('[portfolioHistoryStore] 未知版本的快照檔（原樣保留，以空快照啟動）:', raw?.version);
      return null;
    }
    return raw as SnapshotsFile;
  },
  // QuotaExceeded 後備：裁最舊 1/4 backfill（live 是實測史料，永不裁）；無 backfill 可裁則放棄
  trimForRetry: (f) => {
    const backfills = f.rows.filter(r => r.source === 'backfill').sort((a, b) => (a.date < b.date ? -1 : 1));
    if (backfills.length === 0) return null;
    const drop = new Set(
      backfills.slice(0, Math.max(1, Math.floor(backfills.length / 4))).map(r => `${r.market}|${r.date}`),
    );
    return { version: 1, rows: f.rows.filter(r => !(r.source === 'backfill' && drop.has(`${r.market}|${r.date}`))) };
  },
});

export const loadRealizedTrades = (): RealizedTrade[] => tradesStore.load().trades;

export const saveRealizedTrades = (trades: RealizedTrade[]): boolean => {
  const ok = tradesStore.save({ version: 1, trades });
  if (!ok) console.warn('[portfolioHistoryStore] 已實現帳本寫入失敗（storage 滿或不可用）');
  return ok;
};

export const loadSnapshots = (): DailyPnlSnapshot[] => snapshotsStore.load().rows;

export const saveSnapshots = (rows: DailyPnlSnapshot[]): boolean => {
  const ok = snapshotsStore.save({ version: 1, rows });
  // 原語意：只有「裁剪過仍寫不進去」才出警告；完全無 backfill 可裁時靜默回 false
  if (!ok && rows.some(r => r.source === 'backfill')) {
    console.warn('[portfolioHistoryStore] 快照寫入失敗（裁剪後仍不足）');
  }
  return ok;
};
