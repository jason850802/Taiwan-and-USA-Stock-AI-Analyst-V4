// utils/closeSeriesCache.ts — 回推用歷史收盤價快取（Phase 11 追加）
//
// 為什麼需要：每次「重算歷史回推」都要抓全部交易過的股票（實例 127 檔）的日線，
// 每檔連帶觸發籌碼請求，實際請求量約檔數 4 倍，逼近後端 marketPerMin=60 造成 429。
// 但歷史收盤價是不會變的事實——只有「最近幾天」需要更新。
// 因此把 {date, close} 序列快取，重算時只補抓快取未覆蓋的部分。
//
// 儲存最佳化：只留回推需要的區間（預設近 3 年），且價格取 4 位小數以內的原值，
// 以「date 陣列 + close 陣列」而非物件陣列存放，體積約少一半。
import { createPersistentStore } from './persistentStore';

const KEY = 'portfolio_close_cache_v1';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;   // 超過 3 天視為過期（需補抓近端）

export interface CloseBar { date: string; close: number }

interface PackedSeries { d: string[]; c: number[]; at: number }
interface CacheFile { version: 1; series: Record<string, PackedSeries> }

const store = createPersistentStore<CacheFile>({
  key: KEY,
  fallback: () => ({ version: 1, series: {} }),
  decode: (raw: any) => (raw?.version === 1 && raw.series ? (raw as CacheFile) : null),
  // 容量不足：丟棄最舊的一半再試一次，仍失敗就放棄（快取只是加速，不影響正確性）
  trimForRetry: (f) => {
    const keys = Object.keys(f.series);
    const series = { ...f.series };
    for (const k of keys.slice(0, Math.floor(keys.length / 2))) delete series[k];
    return { version: 1, series };
  },
});

/** 取快取；回傳 null 表示無快取或已過期（需重抓） */
export const getCachedSeries = (symbol: string): CloseBar[] | null => {
  const f = store.load();
  const p = f.series[symbol];
  if (!p || !Array.isArray(p.d) || !Array.isArray(p.c)) return null;
  if (Date.now() - (p.at ?? 0) > MAX_AGE_MS) return null;
  const out: CloseBar[] = [];
  for (let i = 0; i < p.d.length; i++) out.push({ date: p.d[i], close: p.c[i] });
  return out;
};

const pack = (bars: CloseBar[], fromDate?: string): PackedSeries => {
  const kept = fromDate ? bars.filter(b => b.date >= fromDate) : bars;
  return { d: kept.map(b => b.date), c: kept.map(b => b.close), at: Date.now() };
};

/**
 * 批次寫入快取。
 * ⚠️ 務必批次呼叫而非逐檔——逐檔寫會「載入整份→序列化整份→寫入」，
 * 快取變大後成本線性上升，實測抓 128 檔時把整體速度拖慢約 4 倍。
 */
export const putCachedSeriesMany = (
  entries: { symbol: string; bars: CloseBar[] }[],
  fromDate?: string,
): void => {
  if (entries.length === 0) return;
  const f = store.load();
  for (const e of entries) f.series[e.symbol] = pack(e.bars, fromDate);
  store.save(f);   // 失敗時工廠會走 trimForRetry 丟最舊一半再試一次；仍失敗即放棄
};

export const clearCloseCache = (): void => store.clear();
