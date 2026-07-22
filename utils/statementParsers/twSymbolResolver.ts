// utils/statementParsers/twSymbolResolver.ts — 台股「中文股名 → 代號」解析（Phase 11 追加）
//
// 國泰台股對帳單只有中文股名沒有代號，但 App 全靠代號抓報價，故必須可靠對應。
// 資料來源：FinMind TaiwanStockInfo 名錄（services/stockDirectory 已快取於 localStorage）。
// 對不上或有歧義者一律回傳 null 由呼叫端列入 unsupported——絕不猜代號。
import { ParsedTxn } from '../../types';

export interface DirEntry { id: string; name: string }

/**
 * 同名多碼的人工裁定表。
 * 「神達」在名錄同時對到 2315 與 3706：2315（神達電腦）已下市、當日無報價；
 * 3706（神達投控）於使用者交易日 2025-10-01 的價格區間 89.0~91.9 涵蓋成交價 91.0，
 * 已用歷史股價實證，故裁定為 3706。
 */
export const NAME_OVERRIDES: Record<string, string> = {
  神達: '3706',
};

/**
 * 正規化：移除券商／交易所加註的「市場別標記」，只留公司名本體。
 * - `*`：處置股／注意股標記（對帳單與名錄都可能出現，且不一定同步）
 * - `-創`：創新板（名錄有、對帳單沒有，如名錄「台灣虎航-創」vs 對帳單「台灣虎航」）
 * - `-戰`：戰略新板
 * ⚠️ `-KY`（境外註冊公司）是正式名稱的一部分，雙方都會出現，**不可移除**，
 *    移除會讓「矽力-KY」與同名台灣公司產生誤配。
 */
const stripMarketTags = (s: string): string =>
  s.replace(/\*/g, '').replace(/-(創|戰)$/u, '').trim();

/**
 * 以名錄解析單一中文股名。
 * 比對順序：人工裁定 → 完全相同 → 雙方去除處置股「*」後相同。
 * 命中多個不同代號視為歧義 → null（不猜）。
 */
export const resolveTwSymbol = (name: string, dir: DirEntry[]): string | null => {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  if (NAME_OVERRIDES[raw]) return NAME_OVERRIDES[raw];
  const bare = stripMarketTags(raw);
  if (NAME_OVERRIDES[bare]) return NAME_OVERRIDES[bare];

  const exact = new Set<string>();
  const loose = new Set<string>();
  for (const e of dir) {
    if (!e?.id || !e?.name) continue;
    if (e.name === raw) exact.add(e.id);
    if (stripMarketTags(e.name) === bare) loose.add(e.id);
  }
  if (exact.size === 1) return [...exact][0];
  if (exact.size === 0 && loose.size === 1) return [...loose][0];
  return null;   // 0 筆或多筆 → 交由呼叫端提示，不臆測
};

export interface ResolveResult {
  txns: ParsedTxn[];
  unresolved: { rawLine: string; reason: string }[];
}

/** 批次把 ParsedTxn.symbol（暫存中文名）換成代號；解析不出的整筆剔除並回報 */
export const resolveTwSymbols = (txns: ParsedTxn[], dir: DirEntry[]): ResolveResult => {
  const cache = new Map<string, string | null>();
  const out: ParsedTxn[] = [];
  const unresolved: { rawLine: string; reason: string }[] = [];
  const reported = new Set<string>();

  for (const t of txns) {
    const key = t.name;
    if (!cache.has(key)) cache.set(key, resolveTwSymbol(key, dir));
    const sym = cache.get(key)!;
    if (!sym) {
      if (!reported.has(key)) {
        reported.add(key);
        unresolved.push({ rawLine: t.rawLine, reason: `找不到「${key}」對應的股票代號（該股全部交易未匯入）` });
      }
      continue;
    }
    out.push({
      ...t,
      symbol: sym,
      // 去重鍵原以中文名組成，換成代號後重算，確保同股同鍵
      dedupeKey: t.dedupeKey.replace(`|${key}|`, `|${sym}|`),
    });
  }
  return { txns: out, unresolved };
};
