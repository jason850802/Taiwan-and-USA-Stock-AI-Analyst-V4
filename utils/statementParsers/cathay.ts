// utils/statementParsers/cathay.ts — 國泰證券複委託（美股）對帳單 .csv 解析（Phase 11 T1）
// 檔案為 Big5(CP950) 編碼、多區塊；只取「交易明細」區塊（標題以「交易日期」開頭）。
// 美股一律 USD 計價（D-10），匯率欄可為 '--' 不影響；費用取帳單實數（D-06）。
import { ParsedTxn } from '../../types';
import type { ParseOutput } from './sinopac';

const COL = {
  date: 0, symbol: 1, name: 2, market: 3, type: 4, txnCcy: 5, settleCcy: 6,
  shares: 7, price: 8, rate: 9, gross: 10, fee: 11, otherFee: 12, netTwd: 13,
} as const;

const num = (v: string): number => {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Big5 位元組 → 文字（瀏覽器與 Node 皆原生支援 big5，spike 已驗） */
export const decodeBig5 = (buf: ArrayBuffer): string => new TextDecoder('big5').decode(buf);

/**
 * 解析國泰複委託 CSV 全文。
 * 多區塊：掃描找到以「交易日期」開頭的標題列，其後連續的 YYYY/MM/DD 列為資料。
 */
export const parseCathayCsv = (text: string): ParseOutput => {
  const txns: ParsedTxn[] = [];
  const unsupported: { rawLine: string; reason: string }[] = [];

  const lines = text.split(/\r?\n/);
  const hdrIdx = lines.findIndex(l => l.replace(/\s/g, '').startsWith('交易日期'));
  if (hdrIdx < 0) return { txns, unsupported: [{ rawLine: '', reason: '找不到「交易日期」開頭的交易明細標題列' }] };

  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const p = line.split(',').map(s => s.trim());          // 每欄前有 tab/空白，必須 trim
    if (p.length < 14) continue;
    const m = p[COL.date].match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) continue;                                       // 非資料列（其他區塊標題等）跳過
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    const rawLine = p.slice(0, 14).join(' | ');

    const type = p[COL.type];
    let kind: 'buy' | 'sell' | 'dividend';
    if (type === '買進') kind = 'buy';
    else if (type === '賣出') kind = 'sell';
    else if (type === '除息') kind = 'dividend';
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

    txns.push({
      broker: 'cathay',
      market: 'US',
      date,
      symbol,
      name: p[COL.name] || symbol,
      kind,
      shares,
      price: num(p[COL.price]),
      gross,
      fee: num(p[COL.fee]),
      // 除息的「其他費用」是代扣稅；買賣的其他費用併入 tax 欄（美股無交易稅，實測恆 0）
      tax: num(p[COL.otherFee]),
      netTwd: num(p[COL.netTwd]),
      // 無委託單號 → 複合鍵（D-11）
      dedupeKey: `cathay|${date}|${symbol}|${kind}|${shares}|${p[COL.price]}|${p[COL.gross]}`,
      rawLine,
    });
  }
  return { txns, unsupported };
};
