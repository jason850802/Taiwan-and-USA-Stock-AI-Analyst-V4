// stockDirectory.ts — 股票名錄與搜尋（支援中文公司名子字串搜尋）
// 台股：FinMind TaiwanStockInfo 全清單（瀏覽器直連，快取於 localStorage）
// 美股/海外：Yahoo Finance search 端點（透過同源後端即時查詢）

import { proxyHeaders } from './_shared/apiClient';

export type Market = 'TW' | 'US';

export interface StockDirEntry {
  id: string;        // 代碼（台股純數字；美股代碼）
  name: string;      // 公司名稱（台股中文）
  industry?: string; // 產業別（台股）/ 交易所（美股）
  type?: string;     // twse / tpex …
  market: Market;
}

const LS_KEY = 'tw_stock_directory_v1';
const LS_TS = 'tw_stock_directory_ts_v1';
const TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

let memCache: StockDirEntry[] | null = null;
let loadingPromise: Promise<StockDirEntry[]> | null = null;

const hasCJK = (s: string) => /[一-鿿]/.test(s);

// ── 載入台股名錄（記憶體 → localStorage → FinMind）──
export async function ensureTaiwanDirectory(): Promise<StockDirEntry[]> {
  if (memCache) return memCache;
  try {
    const ts = Number(localStorage.getItem(LS_TS) || 0);
    const cached = localStorage.getItem(LS_KEY);
    if (cached && Date.now() - ts < TTL) {
      const parsed = JSON.parse(cached) as StockDirEntry[];
      // 空陣列視同 cache miss：歷史版本曾把抓取失敗的空目錄快取 7 天（中毒），
      // 這裡不採用空快取、續走重抓路徑，讓已中毒的使用者自動痊癒
      if (Array.isArray(parsed) && parsed.length > 0) {
        memCache = parsed;
        return memCache;
      }
    }
  } catch { /* ignore */ }

  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const res = await fetch('/api/finmind?dataset=TaiwanStockInfo', {
        headers: { ...proxyHeaders },
      });
      const json = await res.json();
      const map = new Map<string, StockDirEntry>();
      if (json.msg === 'success' && Array.isArray(json.data)) {
        for (const d of json.data) {
          if (!d.stock_id || !d.stock_name) continue;
          if (!map.has(d.stock_id)) {
            map.set(d.stock_id, {
              id: d.stock_id, name: d.stock_name,
              industry: d.industry_category, type: d.type, market: 'TW',
            });
          }
        }
      }
      const list = Array.from(map.values());
      // 只在真的抓到資料才快取——失敗/空結果絕不寫入，
      // 避免把暫時性故障（403/502/限流）固化成 7 天的空目錄（快取中毒）
      if (list.length > 0) {
        memCache = list;
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(list));
          localStorage.setItem(LS_TS, String(Date.now()));
        } catch { /* localStorage 滿了就略過 */ }
      }
      return list;
    } catch (e) {
      console.warn('載入台股名錄失敗', e);
      return memCache || [];
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}

// ── 台股本地子字串搜尋（名稱 OR 代碼）──
export function searchTaiwan(dir: StockDirEntry[], query: string, limit = 20): StockDirEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const idHit: StockDirEntry[] = [];   // 代碼開頭
  const nameHit: StockDirEntry[] = []; // 名稱包含
  const idIn: StockDirEntry[] = [];    // 代碼包含
  for (const e of dir) {
    const id = e.id.toLowerCase();
    const name = e.name.toLowerCase();
    if (id.startsWith(q)) idHit.push(e);
    else if (name.includes(q)) nameHit.push(e);
    else if (id.includes(q)) idIn.push(e);
    if (idHit.length + nameHit.length + idIn.length > 300) break;
  }
  return [...idHit, ...nameHit, ...idIn].slice(0, limit);
}

// ── Yahoo quote → StockDirEntry 過濾映射（純函式，可獨立測試）──
// 規則（§A1 改法1、2）：
//   1. quoteType 嚴格限定 EQUITY / ETF——移除 isYahooFinance 旁路
//      （期貨/選擇權/指數/匯率/加密該欄位皆為 true，是雜訊混入根因）
//   2. 市場白名單：.TW/.TWO 後綴 → TW；美股七大交易所 → US；其餘直接丟棄（回 null）
const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'NCM', 'ASE', 'PCX', 'BTS']);

export function mapYahooQuote(x: any): StockDirEntry | null {
  if (!x || !x.symbol) return null;
  if (x.quoteType !== 'EQUITY' && x.quoteType !== 'ETF') return null;
  const sym: string = x.symbol;
  let market: Market;
  if (sym.endsWith('.TW') || sym.endsWith('.TWO')) market = 'TW';
  else if (US_EXCHANGES.has(x.exchange)) market = 'US';
  else return null; // 非台股非美股白名單 → 丟棄（港/日/韓等不再以「海外」顯示）
  return {
    id: sym,
    name: x.shortname || x.longname || sym,
    industry: x.exchDisp || x.exchange,
    market,
  };
}

// ── Yahoo 搜尋（美股/台股，英文名或代碼）──
export async function searchYahoo(query: string, limit = 8): Promise<StockDirEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const qs = new URLSearchParams({ q, limit: String(limit) }).toString();
  try {
    const res = await fetch(`/api/yahoo/search?${qs}`, {
      headers: { ...proxyHeaders },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const quotes: any[] = json.quotes || [];
    return quotes.map(mapYahooQuote).filter((e): e is StockDirEntry => e !== null);
  } catch {
    return [];
  }
}

// ── 整合搜尋：台股本地 +（英文/代碼時）Yahoo 海外 ──
export async function searchStocks(dir: StockDirEntry[], query: string): Promise<StockDirEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const tw = searchTaiwan(dir, q, 20);
  // 含中文 → 只用台股本地（最快、最準）
  if (hasCJK(q)) return tw;
  // 純英文/代碼 → 併入 Yahoo 海外結果（去重）
  let yahoo: StockDirEntry[] = [];
  try { yahoo = await searchYahoo(q, 8); } catch { /* ignore */ }
  const seen = new Set(tw.map(e => e.id));
  const merged = [...tw];
  for (const y of yahoo) {
    const bare = y.id.replace(/\.TWO?$/i, '');
    if (!seen.has(y.id) && !seen.has(bare)) { merged.push(y); seen.add(y.id); }
  }
  return merged.slice(0, 24);
}
