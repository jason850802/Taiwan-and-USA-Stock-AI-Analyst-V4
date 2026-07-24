// utils/statementParsers/cathay.ts — 國泰證券複委託（美股）對帳單 .csv 解析（Phase 11 T1）
// 檔案為 Big5(CP950) 編碼、多區塊；只取「交易明細」區塊（標題以「交易日期」開頭）。
// 美股一律 USD 計價（D-10）；費用取帳單實數（D-06）。
//
// 欄位一律「照標題列的欄名定位」，不寫死索引——實測 2026 年真檔比舊格式多一欄「交易所」，
// 寫死索引會整批位移成 unsupported（2026-07-24 修）。同批修正：
//   ・交易種類實際字串是「一般除息」而非「除息」→ 改用 includes 比對
//   ・6 月檔日期是 2026/6/1（單位數）且標題欄被雙引號包住 → 放寬正則、去引號
//   ・「匯率」欄擷取進 exchangeRate，供庫存批次記錄買入匯率
import { ParsedTxn } from '../../types';
import type { ParseOutput } from './sinopac';

const num = (v: string): number => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** 去掉每欄前導 tab／空白與 CSV 雙引號（6 月檔標題列整欄被引號包住） */
const cell = (v: string): string => String(v ?? '').trim().replace(/^"|"$/g, '').trim();

/** Big5 位元組 → 文字（瀏覽器與 Node 皆原生支援 big5，spike 已驗） */
export const decodeBig5 = (buf: ArrayBuffer): string => new TextDecoder('big5').decode(buf);

type ColMap = Record<string, number>;

/** 依標題列的欄名建索引；找不到的欄回 -1 */
const buildColMap = (header: string[]): ColMap => {
  const idxOf = (...names: string[]): number =>
    header.findIndex(h => names.some(n => h.includes(n)));
  return {
    date:     idxOf('交易日期'),
    symbol:   idxOf('商品代號'),
    name:     idxOf('商品名稱'),
    type:     idxOf('交易種類', '交易類別'),
    shares:   idxOf('股數'),
    price:    idxOf('價格'),
    rate:     idxOf('匯率'),
    gross:    idxOf('成交金額', '交易金額'),
    fee:      idxOf('手續費'),
    otherFee: idxOf('其他費用'),
    net:      idxOf('應收/付', '應收'),
  };
};

const REQUIRED: (keyof ReturnType<typeof buildColMap>)[] = ['date', 'symbol', 'type', 'shares', 'gross'];

/**
 * 解析國泰複委託 CSV 全文。
 * 多區塊：掃描找到以「交易日期」開頭的標題列，其後連續的 YYYY/M/D 列為資料。
 */
export const parseCathayCsv = (text: string): ParseOutput => {
  const txns: ParsedTxn[] = [];
  const unsupported: { rawLine: string; reason: string }[] = [];

  const lines = text.split(/\r?\n/);
  const hdrIdx = lines.findIndex(l => l.replace(/["\s]/g, '').startsWith('交易日期'));
  if (hdrIdx < 0) return { txns, unsupported: [{ rawLine: '', reason: '找不到「交易日期」開頭的交易明細標題列' }] };

  const header = lines[hdrIdx].split(',').map(cell);
  const COL = buildColMap(header);
  const missing = REQUIRED.filter(k => COL[k] < 0);
  if (missing.length > 0) {
    return { txns, unsupported: [{ rawLine: lines[hdrIdx], reason: `交易明細標題列缺少必要欄位：${missing.join('、')}` }] };
  }

  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const p = line.split(',').map(cell);
    const m = (p[COL.date] ?? '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (!m) continue;                                       // 非資料列（其他區塊標題等）跳過
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const rawLine = p.join(' | ');

    const type = p[COL.type] ?? '';
    let kind: 'buy' | 'sell' | 'dividend';
    if (type.includes('除息') || type.includes('配息')) kind = 'dividend';
    else if (type.includes('買')) kind = 'buy';
    else if (type.includes('賣')) kind = 'sell';
    else {
      unsupported.push({ rawLine, reason: `未支援的交易種類「${type || '(空白)'}」` });
      continue;
    }

    const symbol = p[COL.symbol];
    const shares = num(p[COL.shares]);
    const gross = num(p[COL.gross]);
    if (!symbol || shares <= 0) {
      unsupported.push({ rawLine, reason: '缺少代號或股數' });
      continue;
    }

    const price = COL.price >= 0 ? num(p[COL.price]) : 0;
    const fee = COL.fee >= 0 ? num(p[COL.fee]) : 0;
    // 除息的「其他費用」是代扣稅；買賣的其他費用併入 tax 欄（美股無交易稅，實測恆 0）
    const tax = COL.otherFee >= 0 ? num(p[COL.otherFee]) : 0;
    const rawRate = COL.rate >= 0 ? num(p[COL.rate]) : 0;    // '--' → 0 → 視為缺
    const exchangeRate = rawRate > 0 ? rawRate : undefined;

    // 「應收/付(-)金額」在不同版本的檔案裡幣別不同：舊檔是台幣，2026 年真檔是美元。
    // 用金額量級判斷（≈ 美元側的 gross±費用 就是美元），美元時以匯率換回台幣，
    // 避免美股除息把美元數字直接寫進以台幣計價的 cashDividends（差 32 倍）。
    const netRaw = COL.net >= 0 ? Math.abs(num(p[COL.net])) : 0;
    const usdMagnitude = kind === 'dividend' ? gross - tax : gross + fee;
    const netIsUsd = usdMagnitude > 0 && Math.abs(netRaw - usdMagnitude) <= Math.max(0.05, usdMagnitude * 0.002);
    const netTwd = netIsUsd
      ? (exchangeRate ? Math.round(netRaw * exchangeRate * 100) / 100 : 0)
      : netRaw;

    txns.push({
      broker: 'cathay',
      market: 'US',
      date,
      symbol,
      name: p[COL.name] || symbol,
      kind,
      shares,
      price,
      gross,
      fee,
      tax,
      netTwd,
      ...(exchangeRate !== undefined ? { exchangeRate } : {}),
      // 無委託單號 → 複合鍵（D-11）
      dedupeKey: `cathay|${date}|${symbol}|${kind}|${shares}|${price}|${gross}`,
      rawLine,
    });
  }
  return { txns, unsupported };
};
