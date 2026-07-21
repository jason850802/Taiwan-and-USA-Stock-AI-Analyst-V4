// utils/statementParsers/index.ts — 對帳單格式偵測與分派（Phase 11 T1）
// xlsx 套件為動態 import（懶載，不進首屏 bundle，D-01）。
import { ParsedTxn, BrokerId } from '../../types';
import { parseSinopacRows, unwrapSheetRows, type ParseOutput } from './sinopac';
import { parseCathayCsv, decodeBig5 } from './cathay';

export type { ParseOutput };
export { unwrapSheetRows, normalizeDate, splitProduct } from './sinopac';
export { parseCathayCsv, decodeBig5 } from './cathay';

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

const brokerLabel: Record<BrokerId, string> = { sinopac: '永豐金證券（台股）', cathay: '國泰證券複委託（美股）' };
export const getBrokerLabel = (b: BrokerId): string => brokerLabel[b];

/**
 * 依副檔名分派：.xlsx→永豐金台股；.csv→國泰美股。
 * 解析失敗一律丟具名錯誤（不靜默回空陣列，避免使用者以為「檔案沒交易」）。
 */
export const parseStatementFile = async (file: File): Promise<StatementParseResult> => {
  const name = file.name.toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    let rows: any[][];
    try {
      // 懶載：只在使用者丟 xlsx 時才下載這個 chunk（D-01）。
      // 套件無根進入點，瀏覽器須指定 /browser 子路徑。
      const mod = await import('read-excel-file/browser');
      const readXlsxFile = (mod as any).default ?? mod;
      rows = unwrapSheetRows(await readXlsxFile(file));
    } catch (e: any) {
      throw new StatementParseError(`Excel 檔讀取失敗：${e?.message || '檔案可能損毀或非 xlsx 格式'}`);
    }
    if (rows.length === 0) throw new StatementParseError('Excel 檔沒有可讀取的工作表內容');
    const out = parseSinopacRows(rows);
    if (out.txns.length === 0) {
      throw new StatementParseError('這個 Excel 檔裡找不到任何「現買/現賣」交易列，請確認是永豐金的交易對帳單');
    }
    return { ...out, broker: 'sinopac', fileName: file.name };
  }

  if (name.endsWith('.csv')) {
    let text: string;
    try {
      const buf = await file.arrayBuffer();
      text = decodeBig5(buf);
      // 若 Big5 解出大量替代字元，改試 UTF-8（部分券商匯出可能改編碼）
      const bad = (text.match(/�/g) || []).length;
      if (bad > 20) text = new TextDecoder('utf-8').decode(buf);
    } catch (e: any) {
      throw new StatementParseError(`CSV 檔讀取失敗：${e?.message || '編碼無法解析'}`);
    }
    const out = parseCathayCsv(text);
    if (out.txns.length === 0) {
      throw new StatementParseError(
        out.unsupported.length > 0 && !out.unsupported[0].rawLine
          ? '這個 CSV 找不到「交易明細」區塊，請確認是國泰複委託的對帳單'
          : '這個 CSV 裡沒有可匯入的交易紀錄',
      );
    }
    return { ...out, broker: 'cathay', fileName: file.name };
  }

  throw new StatementParseError(`不支援的檔案格式「${file.name}」——請上傳永豐金 .xlsx 或國泰 .csv 對帳單`);
};

/** 依日期升冪；同日維持原檔順序（券商實際成交順序） */
export const sortTxns = (txns: ParsedTxn[]): ParsedTxn[] =>
  txns.map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i))
    .map(x => x.t);
