// utils/statementParsers/index.ts — 對帳單格式偵測與分派（Phase 11）
// 支援四種格式，一律以「內容特徵」判別而非只看副檔名：
//   永豐金台股 .xlsx  ｜ 國泰台股 .xlsx（民國年＋CD 欄）
//   國泰台股 .csv（UTF-8 BOM，股名開頭）｜ 國泰複委託美股 .csv（Big5，交易日期開頭）
// xlsx 套件為動態 import（懶載，不進首屏 bundle，D-01）。
import { ParsedTxn, BrokerId } from '../../types';
import { parseSinopacRows, unwrapSheetRows, type ParseOutput } from './sinopac';
import { parseCathayCsv, decodeBig5 } from './cathay';
import {
  parseCathayTwRows, parseCathayTwCsv, looksLikeCathayTwXlsx, looksLikeCathayTwCsv,
} from './cathayTw';
import { resolveTwSymbols, type DirEntry } from './twSymbolResolver';

export type { ParseOutput };
export { unwrapSheetRows, normalizeDate, splitProduct } from './sinopac';
export { parseCathayCsv, decodeBig5 } from './cathay';
export { parseCathayTwRows, parseCathayTwCsv, rocToAd } from './cathayTw';
export { resolveTwSymbol, resolveTwSymbols, NAME_OVERRIDES } from './twSymbolResolver';

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementParseError';
  }
}

export interface StatementParseResult extends ParseOutput {
  broker: BrokerId;
  fileName: string;
}

const brokerLabel: Record<BrokerId, string> = {
  sinopac: '永豐金證券（台股）',
  cathay: '國泰證券複委託（美股）',
  cathayTw: '國泰證券（台股）',
};
export const getBrokerLabel = (b: BrokerId): string => brokerLabel[b] ?? b;

/** 需要中文股名→代號解析的券商（僅國泰台股） */
export const needsTwSymbolResolve = (b: BrokerId): boolean => b === 'cathayTw';

/**
 * 解析對帳單檔案。
 * @param loadTwDirectory 台股名錄取得函式（僅國泰台股格式需要；由呼叫端注入以便測試）
 */
export const parseStatementFile = async (
  file: File,
  loadTwDirectory?: () => Promise<DirEntry[]>,
): Promise<StatementParseResult> => {
  const lower = file.name.toLowerCase();

  // ── Excel ───────────────────────────────────────────────────────────────
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    let rows: any[][];
    try {
      // 懶載：只在使用者丟 xlsx 時才載入這個 chunk（D-01）。
      // 自有讀取器（非第三方套件）——券商匯出的 xlsx 常有非標準結構，
      // 例如永豐金新版把空儲存格寫成 `t="s"` 卻無 <v>，第三方套件會整份拒讀。
      const { readXlsxRows } = await import('./xlsxReader');
      rows = await readXlsxRows(file);
    } catch (e: any) {
      throw new StatementParseError(`Excel 檔讀取失敗：${e?.message || '檔案可能損毀或非 xlsx 格式'}`);
    }
    if (rows.length === 0) throw new StatementParseError('Excel 檔沒有可讀取的工作表內容');

    if (looksLikeCathayTwXlsx(rows)) {
      const out = parseCathayTwRows(rows);
      if (out.txns.length === 0) {
        throw new StatementParseError('這個國泰台股對帳單裡找不到可判讀的交易列');
      }
      return finishTw(out, 'cathayTw', file.name, loadTwDirectory);
    }

    const out = parseSinopacRows(rows);
    if (out.txns.length === 0) {
      throw new StatementParseError('這個 Excel 檔裡找不到任何「現買/現賣」交易列，請確認是永豐金或國泰的交易對帳單');
    }
    return { ...out, broker: 'sinopac', fileName: file.name };
  }

  // ── CSV ─────────────────────────────────────────────────────────────────
  if (lower.endsWith('.csv')) {
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (e: any) {
      throw new StatementParseError(`CSV 檔讀取失敗：${e?.message || '無法讀取檔案內容'}`);
    }
    const bytes = new Uint8Array(buf);
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

    // 國泰台股 CSV 為 UTF-8（含 BOM）；國泰複委託為 Big5。先按 BOM 判，再以內容確認。
    const utf8 = new TextDecoder('utf-8').decode(buf);
    if (hasBom || looksLikeCathayTwCsv(utf8)) {
      if (looksLikeCathayTwCsv(utf8)) {
        const out = parseCathayTwCsv(utf8);
        if (out.txns.length === 0) {
          throw new StatementParseError('這個國泰台股 CSV 裡沒有可匯入的交易紀錄');
        }
        return finishTw(out, 'cathayTw', file.name, loadTwDirectory);
      }
    }

    let text = decodeBig5(buf);
    const bad = (text.match(/�/g) || []).length;
    if (bad > 20) text = utf8;                       // Big5 解出大量替代字元 → 改用 UTF-8
    if (looksLikeCathayTwCsv(text)) {
      const out = parseCathayTwCsv(text);
      if (out.txns.length === 0) throw new StatementParseError('這個國泰台股 CSV 裡沒有可匯入的交易紀錄');
      return finishTw(out, 'cathayTw', file.name, loadTwDirectory);
    }

    const out = parseCathayCsv(text);
    if (out.txns.length === 0) {
      throw new StatementParseError(
        out.unsupported.length > 0 && !out.unsupported[0].rawLine
          ? '這個 CSV 找不到可辨識的交易明細區塊，請確認是國泰的對帳單'
          : '這個 CSV 裡沒有可匯入的交易紀錄',
      );
    }
    return { ...out, broker: 'cathay', fileName: file.name };
  }

  throw new StatementParseError(`不支援的檔案格式「${file.name}」——請上傳永豐金／國泰的 .xlsx 或 .csv 對帳單`);
};

/** 國泰台股：解析完再把中文股名換成代號（需名錄） */
const finishTw = async (
  out: ParseOutput,
  broker: BrokerId,
  fileName: string,
  loadTwDirectory?: () => Promise<DirEntry[]>,
): Promise<StatementParseResult> => {
  if (!loadTwDirectory) {
    throw new StatementParseError('無法取得台股名錄，暫時無法解析中文股名（請確認網路連線後重試）');
  }
  let dir: DirEntry[];
  try {
    dir = await loadTwDirectory();
  } catch (e: any) {
    throw new StatementParseError(`台股名錄載入失敗：${e?.message || '請確認網路連線後重試'}`);
  }
  if (!dir || dir.length === 0) {
    throw new StatementParseError('台股名錄是空的，無法把中文股名對應成代號（請稍後重試）');
  }
  const { txns, unresolved } = resolveTwSymbols(out.txns, dir);
  if (txns.length === 0) {
    throw new StatementParseError('所有股票名稱都無法對應到代號，請回報此問題');
  }
  return { txns, unsupported: [...out.unsupported, ...unresolved], broker, fileName };
};

/** 依日期升冪；同日維持原檔順序（券商實際成交順序） */
export const sortTxns = (txns: ParsedTxn[]): ParsedTxn[] =>
  txns.map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i))
    .map(x => x.t);
