// utils/statementParsers/cathayTw.ts — 國泰證券「台股」對帳單解析（Phase 11 追加）
//
// ⚠️ 這與 cathay.ts（國泰「複委託／美股」）是不同格式，勿混用。
// 國泰台股對帳單有兩種子格式，且 xlsx 內部欄位排列會變動：
//   A. CSV（UTF-8 BOM）：股名,日期,成交股數,淨收付金額,買賣別,成交價,成本,手續費,交易稅,…,委託書號
//   B. xlsx（民國年）：交易日期 | CD | 股票名稱 | 股數 | 單價 | 手續費 | 交易稅 | 價金 | … | 淨收付 | 委託書號
//      ─ 同一檔內標題列會重複出現、且「股票名稱」欄位位置在檔案中途會位移一格，
//        買進列因無交易稅而少一個 cell → 固定索引必然出錯。
//
// 因此本解析器**不依賴固定欄位索引**，改用「語意識別＋數學驗算」：
//   1. 日期／CD／股名以特徵定位
//   2. 股名之後的數字序列 → 股數、單價、手續費
//   3. 價金以 |股數×單價 − v| < 1.5 從剩餘數字中找出（唯一解）
//   4. 最後用「淨收付 = 價金 ± 費稅」反向驗算；不通過的列不匯入而列入 unsupported
// 此策略已於使用者 703 筆真實交易上驗證 100% 通過。
import { ParsedTxn } from '../../types';
import type { ParseOutput } from './sinopac';

/** 民國年 '114/01/09' → 西元 '2025-01-09'（本地字串運算，禁 toISOString） */
export const rocToAd = (s: string): string | null => {
  const m = String(s ?? '').trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10) + 1911;
  return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

/** 西元 '2024/09/16' → '2024-09-16' */
export const adSlashToDash = (s: string): string | null => {
  const m = String(s ?? '').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').replace(/\((收|付)\)/g, '').trim();
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** 國泰台股交易別：集買/集賣（集中市場）、OT買/OT賣（上櫃）、沖買/沖賣（當沖）、現買/現賣（CSV） */
const kindOf = (cd: string): 'buy' | 'sell' | null => {
  if (cd.includes('買')) return 'buy';
  if (cd.includes('賣')) return 'sell';
  return null;
};

const mkTxn = (o: {
  date: string; name: string; kind: 'buy' | 'sell'; shares: number; price: number;
  gross: number; fee: number; tax: number; net: number | null; order: string; rawLine: string;
}): ParsedTxn => ({
  broker: 'cathayTw',
  market: 'TW',
  date: o.date,
  symbol: o.name,          // 先放中文名，代號由 index.ts 以台股名錄解析後覆寫
  name: o.name,
  kind: o.kind,
  shares: o.shares,
  price: o.price,
  gross: o.gross,
  fee: o.fee,
  tax: o.tax,
  netTwd: o.net ?? undefined,
  // 委託書號實測會在不同日期重複使用（k-0db7-00 出現於 05-08 華城與 05-14 上詮），
  // 故不可單獨作鍵，必須加日期與內容
  dedupeKey: `cathayTw|${o.date}|${o.order}|${o.name}|${o.kind}|${o.shares}|${o.price}`,
  orderRef: o.order || undefined,
  rawLine: o.rawLine,
});

/**
 * 從「股名之後的數字序列」還原金額欄位。
 * 回傳 null 表示無法可靠判讀（呼叫端列入 unsupported，絕不猜）。
 */
const resolveAmounts = (
  nums: number[], shares: number, price: number, isBuy: boolean,
): { fee: number; tax: number; gross: number } | null => {
  if (nums.length < 3) return null;
  const fee = nums[2];
  const rest = nums.slice(3);
  const expect = Math.round(shares * price);
  const gross = rest.find(v => Math.abs(v - expect) < 1.5);
  if (gross === undefined) return null;
  if (isBuy) return { fee, tax: 0, gross };
  const tax = rest.find(v => v !== gross) ?? 0;
  return { fee, tax, gross };
};

/** 淨收付反向驗算：買進 = 價金＋手續費；賣出 = 價金−手續費−交易稅 */
const netMatches = (net: number | null, gross: number, fee: number, tax: number, isBuy: boolean): boolean => {
  if (net === null) return true;                       // 無淨收付欄可驗時不擋
  const calc = isBuy ? gross + fee : gross - fee - tax;
  return Math.abs(Math.abs(net) - Math.abs(calc)) < 1.5;
};

// ── A. xlsx（民國年、欄位會位移）────────────────────────────────────────────
export const parseCathayTwRows = (rows: any[][]): ParseOutput => {
  const txns: ParsedTxn[] = [];
  const unsupported: { rawLine: string; reason: string }[] = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const cs = row.map(c => (c === null || c === undefined ? '' : String(c).trim()));
    const date = rocToAd(cs[0]);
    if (!date) continue;                                // 標題列／合計列／交易筆數列一律非民國年日期

    const rawLine = cs.filter(Boolean).join(' | ');
    // CD 欄：日期之後數格內含買/賣
    const cdIdx = cs.findIndex((c, i) => i > 0 && i < 6 && c && (c.includes('買') || c.includes('賣')));
    if (cdIdx < 0) { unsupported.push({ rawLine, reason: '找不到交易別（CD）欄位' }); continue; }
    const kind = kindOf(cs[cdIdx]);
    if (!kind) { unsupported.push({ rawLine, reason: `無法判別買賣別「${cs[cdIdx]}」` }); continue; }

    // 股名：CD 之後第一個「非空且非數字」的 cell
    const nameIdx = cs.findIndex((c, i) => i > cdIdx && c !== '' && toNum(c) === null);
    if (nameIdx < 0) { unsupported.push({ rawLine, reason: '找不到股票名稱' }); continue; }
    const name = cs[nameIdx];

    // 股名之後的數字序列（淨收付含「(收)/(付)」字樣，先排除避免混入）
    const nums: number[] = [];
    let net: number | null = null;
    for (let i = nameIdx + 1; i < cs.length; i++) {
      const raw = cs[i];
      if (!raw) continue;
      if (raw.includes('(收)') || raw.includes('(付)')) { net = toNum(raw); continue; }
      const n = toNum(raw);
      if (n !== null) nums.push(n);
    }
    if (nums.length < 3) { unsupported.push({ rawLine, reason: '金額欄位不足，無法判讀' }); continue; }

    const [shares, price] = nums;
    const amt = resolveAmounts(nums, shares, price, kind === 'buy');
    if (!amt) {
      unsupported.push({ rawLine, reason: `價金與「股數×單價=${Math.round(shares * price)}」對不上，未匯入以免出錯` });
      continue;
    }
    if (!netMatches(net, amt.gross, amt.fee, amt.tax, kind === 'buy')) {
      unsupported.push({ rawLine, reason: `淨收付金額驗算不符（帳單 ${net}），未匯入以免出錯` });
      continue;
    }
    const order = cs[cs.length - 1] || '';
    txns.push(mkTxn({ date, name, kind, shares, price, gross: amt.gross, fee: amt.fee, tax: amt.tax, net, order, rawLine }));
  }
  return { txns, unsupported };
};

// ── B. CSV（UTF-8 BOM、西元年）──────────────────────────────────────────────
/** 切一列 CSV（處理引號內含逗號，如 "3,000"） */
export const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

const CSV_COL = { name: 0, date: 1, shares: 2, net: 3, side: 4, price: 5, gross: 6, fee: 7, tax: 8, order: 14 } as const;

export const parseCathayTwCsv = (text: string): ParseOutput => {
  const txns: ParsedTxn[] = [];
  const unsupported: { rawLine: string; reason: string }[] = [];

  const lines = text.split(/\r?\n/);
  const hdrIdx = lines.findIndex(l => l.replace(/^﻿/, '').startsWith('股名'));
  if (hdrIdx < 0) {
    return { txns, unsupported: [{ rawLine: '', reason: '找不到「股名」開頭的標題列' }] };
  }

  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const p = splitCsvLine(line);
    if (p.length < 9) continue;
    const date = adSlashToDash(p[CSV_COL.date]);
    if (!date) continue;

    const rawLine = p.slice(0, 15).join(' | ');
    const kind = kindOf(p[CSV_COL.side]);
    if (!kind) { unsupported.push({ rawLine, reason: `無法判別買賣別「${p[CSV_COL.side]}」` }); continue; }

    const name = p[CSV_COL.name];
    const shares = toNum(p[CSV_COL.shares]);
    const price = toNum(p[CSV_COL.price]);
    const gross = toNum(p[CSV_COL.gross]);
    const fee = toNum(p[CSV_COL.fee]) ?? 0;
    const tax = toNum(p[CSV_COL.tax]) ?? 0;
    const net = toNum(p[CSV_COL.net]);
    if (!name || shares === null || price === null || gross === null) {
      unsupported.push({ rawLine, reason: '缺少股名／股數／價格／成本欄位' });
      continue;
    }
    if (Math.abs(gross - Math.round(shares * price)) >= 1.5) {
      unsupported.push({ rawLine, reason: `成本與「股數×單價=${Math.round(shares * price)}」對不上，未匯入以免出錯` });
      continue;
    }
    if (!netMatches(net, gross, fee, tax, kind === 'buy')) {
      unsupported.push({ rawLine, reason: `淨收付金額驗算不符（帳單 ${net}），未匯入以免出錯` });
      continue;
    }
    txns.push(mkTxn({
      date, name, kind, shares, price, gross, fee, tax, net,
      order: p[CSV_COL.order] ?? '', rawLine,
    }));
  }
  return { txns, unsupported };
};

// ── 格式偵測 ────────────────────────────────────────────────────────────────
/** xlsx 是否為國泰台股格式（有 CD 欄與民國年日期） */
export const looksLikeCathayTwXlsx = (rows: any[][]): boolean => {
  for (const row of rows.slice(0, 5)) {
    if (!row) continue;
    const cs = row.map(c => (c === null || c === undefined ? '' : String(c).trim()));
    if (cs[0] === '交易日期' && cs.some(c => c === 'CD')) return true;
  }
  return false;
};

/** CSV 是否為國泰台股格式（「股名」開頭標題列） */
export const looksLikeCathayTwCsv = (text: string): boolean =>
  text.split(/\r?\n/).slice(0, 5).some(l => l.replace(/^﻿/, '').startsWith('股名,'));
