// utils/statementParsers/sinopac.ts — 永豐金證券（台股）對帳單 .xlsx 解析（Phase 11 T1）
// 格式事實見 11-PLAN.md「對帳單格式事實」與「T1 spike 結果」。
// 費用一律取帳單實數，不呼叫 App 的 calcTw* 公式（D-06）。
import { ParsedTxn } from '../../types';

export interface ParseOutput {
  txns: ParsedTxn[];
  unsupported: { rawLine: string; reason: string }[];
}

// spike 實測：readXlsxFile 可能回傳 [{sheet, data}] 包裝格式而非裸 rows，兩者都要吃
export const unwrapSheetRows = (res: any): any[][] => {
  if (!Array.isArray(res) || res.length === 0) return [];
  if (Array.isArray(res[0])) return res as any[][];
  if (res[0] && Array.isArray(res[0].data)) return res[0].data as any[][];
  return [];
};

/** '2026/07/02' 或 Date → 'YYYY-MM-DD'（本地欄位組字串，禁 toISOString） */
export const normalizeDate = (v: unknown): string | null => {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
};

/** '2327 國巨*' → { symbol: '2327', name: '國巨*' }；'00631L 元大台灣50正2' 同理 */
export const splitProduct = (raw: unknown): { symbol: string; name: string } => {
  const s = String(raw ?? '').trim();
  const i = s.indexOf(' ');
  if (i < 0) return { symbol: s, name: s };
  return { symbol: s.slice(0, i).trim(), name: s.slice(i + 1).trim() };
};

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const COL = { date: 0, product: 1, type: 2, qty: 3, price: 4, gross: 5, fee: 6, tax: 7, payable: 8, receivable: 9, orderRef: 14 } as const;

/**
 * 解析永豐金 xlsx 的已讀取列（由 index.ts 負責載入套件並 unwrap）。
 * 跳過：摘要列、標題列、合計列、空列。非「現買/現賣」交易別 → unsupported（不靜默吞）。
 */
export const parseSinopacRows = (rows: any[][]): ParseOutput => {
  const txns: ParsedTxn[] = [];
  const unsupported: { rawLine: string; reason: string }[] = [];

  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const date = normalizeDate(row[COL.date]);
    if (!date) continue;                       // 摘要列/標題列/合計列/空列一律不是日期開頭

    const rawLine = row.slice(0, 16).map(c => (c === null || c === undefined ? '' : String(c))).join(' | ');
    const type = String(row[COL.type] ?? '').trim();
    let kind: 'buy' | 'sell';
    if (type === '現買') kind = 'buy';
    else if (type === '現賣') kind = 'sell';
    else {
      unsupported.push({ rawLine, reason: `未支援的交易別「${type || '(空白)'}」（本期僅支援現買/現賣）` });
      continue;
    }

    const { symbol, name } = splitProduct(row[COL.product]);
    const shares = num(row[COL.qty]);
    const price = num(row[COL.price]);
    const gross = num(row[COL.gross]);
    if (!symbol || shares <= 0 || gross <= 0) {
      unsupported.push({ rawLine, reason: '缺少代號/股數/金額' });
      continue;
    }
    const orderRef = String(row[COL.orderRef] ?? '').trim();

    txns.push({
      broker: 'sinopac',
      market: 'TW',
      date,
      symbol,
      name,
      kind,
      shares,
      price,
      gross,
      fee: num(row[COL.fee]),
      tax: num(row[COL.tax]),
      netTwd: kind === 'buy' ? -num(row[COL.payable]) : num(row[COL.receivable]),
      // 委託單號實測全唯一；缺號時退化為複合鍵，避免不同筆撞在一起
      dedupeKey: orderRef
        ? `sinopac|${orderRef}`
        : `sinopac|${date}|${symbol}|${kind}|${shares}|${price}|${gross}`,
      orderRef: orderRef || undefined,
      rawLine,
    });
  }
  return { txns, unsupported };
};
