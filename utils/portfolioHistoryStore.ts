// utils/portfolioHistoryStore.ts — 庫存歷史損益的 localStorage 薄 IO 層（Phase 10 T4）
// 無業務邏輯；版本驗證：未知版本「原樣保留、回空啟動」不破壞資料；
// quota 守衛：快照寫入失敗先裁最舊 1/4 的 backfill 列重試一次，再失敗回 false 由 UI 提示。
import { RealizedTrade, DailyPnlSnapshot } from '../types';

const TRADES_KEY = 'portfolio_realized_trades_v1';
const SNAPSHOTS_KEY = 'portfolio_snapshots_v1';

const safeSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const loadRealizedTrades = (): RealizedTrade[] => {
  try {
    const raw = localStorage.getItem(TRADES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.trades)) {
      console.warn('[portfolioHistoryStore] 未知版本的已實現帳本（原樣保留，以空帳本啟動）:', parsed?.version);
      return [];
    }
    return parsed.trades as RealizedTrade[];
  } catch {
    return [];
  }
};

export const saveRealizedTrades = (trades: RealizedTrade[]): boolean => {
  const ok = safeSet(TRADES_KEY, JSON.stringify({ version: 1, trades }));
  if (!ok) console.warn('[portfolioHistoryStore] 已實現帳本寫入失敗（storage 滿或不可用）');
  return ok;
};

export const loadSnapshots = (): DailyPnlSnapshot[] => {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.rows)) {
      console.warn('[portfolioHistoryStore] 未知版本的快照檔（原樣保留，以空快照啟動）:', parsed?.version);
      return [];
    }
    return parsed.rows as DailyPnlSnapshot[];
  } catch {
    return [];
  }
};

export const saveSnapshots = (rows: DailyPnlSnapshot[]): boolean => {
  if (safeSet(SNAPSHOTS_KEY, JSON.stringify({ version: 1, rows }))) return true;
  // QuotaExceeded 後備：裁最舊 1/4 backfill（live 是實測史料，永不裁）
  const backfills = rows.filter(r => r.source === 'backfill').sort((a, b) => (a.date < b.date ? -1 : 1));
  if (backfills.length === 0) return false;
  const drop = new Set(
    backfills.slice(0, Math.max(1, Math.floor(backfills.length / 4))).map(r => `${r.market}|${r.date}`),
  );
  const trimmed = rows.filter(r => !(r.source === 'backfill' && drop.has(`${r.market}|${r.date}`)));
  const ok = safeSet(SNAPSHOTS_KEY, JSON.stringify({ version: 1, rows: trimmed }));
  if (!ok) console.warn('[portfolioHistoryStore] 快照寫入失敗（裁剪後仍不足）');
  return ok;
};
