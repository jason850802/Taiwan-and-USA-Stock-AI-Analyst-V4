// utils/statementParsers/parsers.test.ts — Phase 11 T1：解析器行為鎖
// 隱私鐵則：fixture 一律為「結構與真實帳單相同、數字取自 11-PLAN 手算案例」的合成資料，
// 絕不放入使用者真實對帳單內容。
import { describe, it, expect } from 'vitest';
import { parseSinopacRows, unwrapSheetRows, normalizeDate, splitProduct } from './sinopac';
import { parseCathayCsv } from './cathay';
import { sortTxns } from './index';

// ── 永豐金 xlsx（合成，欄序與真檔一致）────────────────────────────────────
const SINOPAC_HEADER = ['成交日', '商品', '交易別', '數量', '成交價', '價金', '手續費', '交易稅', '應付金額', '應收金額', '融資金額', '保證金', '利息', '融券手續費', '委託單號', '幣別'];
const SINOPAC_SUMMARY = ['交易總價金:', '999,999', '客戶應付總額:', '999', null, null, null, null, null, null, null, null, null, null, null, null];
const SINOPAC_ROWS: any[][] = [
  SINOPAC_SUMMARY,
  SINOPAC_HEADER,
  // Case A：2327 買 30@1115 → 價金 33450、費 47、應付 33497
  ['2026/07/02', '2327 國巨*', '現買', 30, 1115, 33450, 47, 0, 33497, 0, 0, 0, 0, 0, 'Y02J1', 'TWD'],
  // Case B 買腳：2351 買 250@212
  ['2026/07/02', '2351 順德', '現買', 250, 212, 53000, 75, 0, 53075, 0, 0, 0, 0, 0, 'Y03LD', 'TWD'],
  // Case B 賣腳：2351 賣 250@203.5 → 費 72、稅 152、應收 50651
  ['2026/07/03', '2351 順德', '現賣', 250, 203.5, 50875, 72, 152, 0, 50651, 0, 0, 0, 0, 'Y05U9', 'TWD'],
  // ETF（代號含字母）
  ['2026/07/06', '00631L 元大台灣50正2', '現買', 1000, 39, 39000, 55, 0, 39055, 0, 0, 0, 0, 0, 'Y04AV', 'TWD'],
  // KY 股（名稱含 * 與 -KY）
  ['2026/07/07', '6415 矽力*-KY', '現買', 40, 620, 24800, 35, 0, 24835, 0, 0, 0, 0, 0, 'Y01Y4', 'TWD'],
  // 未支援交易別
  ['2026/07/08', '2330 台積電', '融資買', 10, 2430, 24300, 34, 0, 24334, 0, 0, 0, 0, 0, 'Y09ZZ', 'TWD'],
  // 合計行（必須跳過）
  ['合計', null, null, 1320, null, 175125, 283, 152, 150487, 50651, null, null, null, null, null, null],
];

describe('sinopac：xlsx 回傳格式兼容（spike 實測陷阱）', () => {
  it('裸 rows 與 [{sheet,data}] 包裝格式都要能解出同一份資料', () => {
    expect(unwrapSheetRows(SINOPAC_ROWS)).toHaveLength(SINOPAC_ROWS.length);
    expect(unwrapSheetRows([{ sheet: 'Sheet 1', data: SINOPAC_ROWS }])).toHaveLength(SINOPAC_ROWS.length);
    expect(unwrapSheetRows([])).toEqual([]);
    expect(unwrapSheetRows(null)).toEqual([]);
  });
});

describe('sinopac：欄位解析', () => {
  const { txns, unsupported } = parseSinopacRows(SINOPAC_ROWS);

  it('跳過摘要/標題/合計列，只留真實交易', () => {
    expect(txns).toHaveLength(5);
    expect(txns.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date))).toBe(true);
    expect(txns.some(t => t.symbol === '合計')).toBe(false);
  });

  it('Case A 買進：費用取帳單實數、成本＝價金＋手續費（交叉驗證應付金額）', () => {
    const t = txns[0];
    expect(t).toMatchObject({ broker: 'sinopac', market: 'TW', date: '2026-07-02', symbol: '2327', kind: 'buy', shares: 30, price: 1115, gross: 33450, fee: 47, tax: 0 });
    expect(t.name).toBe('國巨*');
    expect(t.gross + t.fee).toBe(33497);          // ＝帳單應付金額欄
    expect(t.dedupeKey).toBe('sinopac|Y02J1');
  });

  it('Case B 賣出：手續費 72／交易稅 152／應收 50651', () => {
    const s = txns.find(t => t.kind === 'sell')!;
    expect(s).toMatchObject({ symbol: '2351', shares: 250, price: 203.5, gross: 50875, fee: 72, tax: 152 });
    expect(s.gross - s.fee - s.tax).toBe(50651);  // ＝帳單應收金額欄
    expect(s.netTwd).toBe(50651);
  });

  it('代號含字母的 ETF 與名稱含 */-KY 都正確拆解', () => {
    expect(txns.find(t => t.symbol === '00631L')?.name).toBe('元大台灣50正2');
    expect(txns.find(t => t.symbol === '6415')?.name).toBe('矽力*-KY');
  });

  it('未支援交易別記入 unsupported，不靜默吞掉', () => {
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].reason).toContain('融資買');
  });

  it('委託單號全唯一 → dedupeKey 不互撞', () => {
    expect(new Set(txns.map(t => t.dedupeKey)).size).toBe(txns.length);
  });
});

describe('sinopac：工具函式', () => {
  it('normalizeDate 吃字串與 Date，輸出本地 YYYY-MM-DD', () => {
    expect(normalizeDate('2026/07/02')).toBe('2026-07-02');
    expect(normalizeDate('2026/7/2')).toBe('2026-07-02');
    expect(normalizeDate(new Date(2026, 6, 2))).toBe('2026-07-02');
    expect(normalizeDate('合計')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
  it('splitProduct 以第一個空白切分', () => {
    expect(splitProduct('2327 國巨*')).toEqual({ symbol: '2327', name: '國巨*' });
    expect(splitProduct('00988A 主動統一全球創新')).toEqual({ symbol: '00988A', name: '主動統一全球創新' });
    expect(splitProduct('2330')).toEqual({ symbol: '2330', name: '2330' });
  });
});

// ── 國泰 CSV（合成，含多區塊與前導 tab）───────────────────────────────────
const CATHAY_CSV = [
  '商品代號,\t商品名稱,\t交易市場,\t交易所,\t持有股數',   // 庫存明細區塊（空）
  '',
  '商品代號,\t商品名稱,\tISIN CODE,\t計價幣別',            // 債券區塊（空）
  '',
  '交易日期,\t商品代號,\t商品名稱,\t交易市場,\t交易種類,\t交易幣別,\t交割幣別,\t股數,\t價格,\t匯率,\t成交金額,\t手續費,\t其他費用,\t應收/付(-)金額',
  // Case D 買進：NVDA 5@179 成交 895 費 0.72（App 公式會算成 0.07 → 必須用帳單值）
  '2026/03/03,NVDA,NVIDIA Corp,美國,買進,美金,美金,5.000000,179.0000,31.77,895.000000,0.72,0.00,-28453.00',
  // Case E：MRVL 買 20@82.15 → 賣 20@85.10
  '2026/03/02,MRVL,Marvell Technology Inc,美國,買進,美金,美金,20.000000,82.1500,31.54,1643.000000,1.31,0.00,-51853.00',
  '2026/03/09,MRVL,Marvell Technology Inc,美國,賣出,美金,美金,20.000000,85.1000,31.86,1702.000000,1.36,0.00,54174.00',
  // Case F 除息：GOOGL 應收台幣 9
  '2026/03/17,GOOGL,Alphabet Inc,美國,除息,美金,美金,2.000000,0.2100,31.89,0.420000,0.00,0.13,9.00',
  // Case G 碎股＋匯率 '--'
  '2026/05/26,MU,Micron Technology Inc,美國,買進,美金,美金,2.320900,861.7368,31.43,2000.000000,1.60,0.00,-62900.00',
  '2026/05/27,MU,Micron Technology Inc,美國,賣出,美金,美金,2.320900,902.2611,--,2094.050000,1.68,0.05,0.00',
  // 未支援種類
  '2026/06/01,XXXX,Some Corp,美國,現金增資,美金,美金,1.000000,10.0000,31.00,10.000000,0.00,0.00,-310.00',
  '',
  '交易日期,\t商品名稱,\t交易種類,\t計價幣別',              // 尾端另一區塊
].join('\r\n');

describe('cathay：多區塊 CSV 與欄位解析', () => {
  const { txns, unsupported } = parseCathayCsv(CATHAY_CSV);

  it('只取交易明細區塊，忽略其他區塊標題', () => {
    expect(txns).toHaveLength(6);
    expect(txns.every(t => t.market === 'US' && t.broker === 'cathay')).toBe(true);
  });

  it('Case D：手續費取帳單的 0.72（非 App 公式的 0.07）', () => {
    const t = txns.find(x => x.symbol === 'NVDA')!;
    expect(t).toMatchObject({ date: '2026-03-03', kind: 'buy', shares: 5, price: 179, gross: 895, fee: 0.72 });
    expect(t.fee).not.toBeCloseTo(895 * 0.00008, 4);   // 反向鎖：不得用 calcUsFee 重算
  });

  it('Case E 賣出：費 1.36、稅 0', () => {
    const s = txns.find(x => x.symbol === 'MRVL' && x.kind === 'sell')!;
    expect(s).toMatchObject({ shares: 20, price: 85.1, gross: 1702, fee: 1.36, tax: 0 });
  });

  it('Case F 除息：kind=dividend，netTwd 為應收台幣 9，代扣稅進 tax', () => {
    const d = txns.find(x => x.kind === 'dividend')!;
    expect(d).toMatchObject({ symbol: 'GOOGL', date: '2026-03-17', shares: 2, price: 0.21, gross: 0.42, tax: 0.13, netTwd: 9 });
  });

  it('Case G 碎股與匯率 -- 都不影響解析', () => {
    const buy = txns.find(x => x.symbol === 'MU' && x.kind === 'buy')!;
    const sell = txns.find(x => x.symbol === 'MU' && x.kind === 'sell')!;
    expect(buy.shares).toBeCloseTo(2.3209, 6);
    expect(buy.gross).toBe(2000);
    expect(sell.gross).toBe(2094.05);
    expect(sell.fee).toBe(1.68);
  });

  it('未支援種類記入 unsupported', () => {
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0].reason).toContain('現金增資');
  });

  it('無委託單號 → 複合去重鍵且互不相撞', () => {
    expect(txns[0].dedupeKey.startsWith('cathay|')).toBe(true);
    expect(new Set(txns.map(t => t.dedupeKey)).size).toBe(txns.length);
  });

  it('找不到交易明細區塊時回報原因', () => {
    const { txns: none, unsupported: why } = parseCathayCsv('隨便一個檔案\n沒有標題');
    expect(none).toHaveLength(0);
    expect(why[0].reason).toContain('交易日期');
  });
});

describe('sortTxns：依日期升冪、同日保原檔序', () => {
  it('國泰 CSV 實測非嚴格日期排序，必須排序後才能重播', () => {
    const { txns } = parseCathayCsv(CATHAY_CSV);
    const sorted = sortTxns(txns);
    const dates = sorted.map(t => t.date);
    expect(dates).toEqual([...dates].sort());
    // 同日兩筆維持原順序
    const sameDay = sortTxns([
      { ...txns[0], date: '2026-01-01', symbol: 'A' },
      { ...txns[0], date: '2026-01-01', symbol: 'B' },
    ]);
    expect(sameDay.map(t => t.symbol)).toEqual(['A', 'B']);
  });
});
