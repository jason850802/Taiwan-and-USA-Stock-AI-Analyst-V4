// utils/statementParsers/cathayTw.test.ts — 國泰台股解析器行為鎖
// 隱私鐵則：fixture 為結構相同的合成資料，不含使用者真實交易。
import { describe, it, expect } from 'vitest';
import {
  parseCathayTwRows, parseCathayTwCsv, rocToAd, adSlashToDash, toNum,
  splitCsvLine, looksLikeCathayTwXlsx, looksLikeCathayTwCsv,
} from './cathayTw';
import { resolveTwSymbol, resolveTwSymbols, type DirEntry } from './twSymbolResolver';
import { ParsedTxn } from '../../types';

describe('日期與數字工具', () => {
  it('民國年轉西元（不使用 toISOString）', () => {
    expect(rocToAd('114/01/09')).toBe('2025-01-09');
    expect(rocToAd('113/12/31')).toBe('2024-12-31');
    expect(rocToAd('115/7/2')).toBe('2026-07-02');
    expect(rocToAd('合 計:')).toBeNull();
    expect(rocToAd('')).toBeNull();
  });
  it('西元斜線轉破折', () => {
    expect(adSlashToDash('2024/09/16')).toBe('2024-09-16');
    expect(adSlashToDash('114/01/09')).toBeNull();   // 民國年不得誤判為西元
  });
  it('toNum 去千分位與收付標記', () => {
    expect(toNum('3,000')).toBe(3000);
    expect(toNum('-100,300')).toBe(-100300);
    expect(toNum('23,129(收)')).toBe(23129);
    expect(toNum('24,984(付)')).toBe(24984);
    expect(toNum('')).toBeNull();
    expect(toNum(null)).toBeNull();
  });
  it('splitCsvLine 處理引號內逗號', () => {
    expect(splitCsvLine('台積電,2024/08/05,"1,000","-8,423",現買,842'))
      .toEqual(['台積電', '2024/08/05', '1,000', '-8,423', '現買', '842']);
  });
});

// ── xlsx：兩種欄位排列（真檔會在中途位移）＋買賣列欄數不同 ──────────────
const HDR_A = ['交易日期', '', 'CD', '', '股票名稱', '股數', '單價', '手續費', '交易稅', '證所稅', '融券手續費', '利息', '預收/留置款', '價', '金', '淨收付金額', '委託書號'];
const HDR_B = ['交易日期', '', 'CD', '股票名稱', '', '股數', '單價', '手續費', '交易稅', '證所稅', '融券手續費', '利息', '預收/留置款', '價', '金', '淨收付金額', '委託書號'];

describe('國泰台股 xlsx：語意識別＋數學驗算', () => {
  const rows: any[][] = [
    HDR_A,
    // 排列 A 買進（無交易稅欄）：1000 股 @20，價金 20000、費 8 → 淨付 20,008
    ['114/01/09', '', '集買', '', '甲公司', 1000, 20, 8, '', 20000, '', '', '', '', '', '20,008(收)', 'A-0001-00'],
    // 排列 A 賣出：500 股 @30，價金 15000、費 6、稅 45 → 淨收 14,949
    ['114/01/13', '', '集賣', '', '甲公司', 500, 30, 6, 45, 15000, '', '', '', '', '', '14,949(付)', 'A-0002-00'],
    // 上櫃 OT
    ['114/02/17', '', 'OT買', '', '乙公司', 200, 50, 5, '', 10000, '', '', '', '', '', '10,005(收)', 'k-0003-00'],
    HDR_B,                                   // 中途換排列（真檔行為）
    // 排列 B 買進（股名前移一格、且少一個 cell）
    ['114/04/09', '', '集買', '丙公司', '', 1000, 18.9, 7, 18900, '', '', '', '', '', '', '18,907(收)', 'a-0004-00'],
    // 排列 B 賣出
    ['114/07/29', '', '集賣', '丙公司', '', 2000, 48.17, 38, 96, 96340, '', '', '', '', '', '96,206(付)', 'A-0005-00'],
    // 當沖
    ['115/03/20', '', '沖賣', '丁公司', '', 1000, 74.1, 35, 222, 74100, '', '', '', '', '', '73,843(付)', 'B-0006-00'],
    ['合 計:', '', '', '', '', 5700, '', '', '', '', '', '', '', '', '', '999(收)', ''],
    ['交易筆數:', '', '6', '印表日期: 115/07/22', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const { txns, unsupported } = parseCathayTwRows(rows);

  it('跳過標題／合計／交易筆數列，只留交易', () => {
    expect(txns).toHaveLength(6);
    expect(unsupported).toHaveLength(0);
    expect(txns.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date))).toBe(true);
    expect(txns.every(t => t.broker === 'cathayTw' && t.market === 'TW')).toBe(true);
  });

  it('排列 A 買進：價金由「股數×單價」驗算定位，非固定索引', () => {
    expect(txns[0]).toMatchObject({ date: '2025-01-09', name: '甲公司', kind: 'buy', shares: 1000, price: 20, gross: 20000, fee: 8, tax: 0 });
    expect(txns[0].gross + txns[0].fee).toBe(20008);         // ＝帳單淨收付
  });

  it('排列 A 賣出：費 6／稅 45 正確分離', () => {
    expect(txns[1]).toMatchObject({ kind: 'sell', shares: 500, gross: 15000, fee: 6, tax: 45 });
    expect(txns[1].gross - txns[1].fee - txns[1].tax).toBe(14949);
  });

  it('排列 B（股名位移一格）同樣正確', () => {
    expect(txns[3]).toMatchObject({ date: '2025-04-09', name: '丙公司', kind: 'buy', shares: 1000, price: 18.9, gross: 18900, fee: 7, tax: 0 });
    expect(txns[4]).toMatchObject({ date: '2025-07-29', kind: 'sell', shares: 2000, gross: 96340, fee: 38, tax: 96 });
  });

  it('當沖（沖買/沖賣）視為一般買賣', () => {
    expect(txns[5]).toMatchObject({ date: '2026-03-20', name: '丁公司', kind: 'sell', shares: 1000, tax: 222 });
  });

  it('OT（上櫃）買賣正確判讀', () => {
    expect(txns[2]).toMatchObject({ name: '乙公司', kind: 'buy', shares: 200, gross: 10000 });
  });

  it('價金與股數×單價對不上 → 列入 unsupported 不匯入（0 失誤原則）', () => {
    const bad = parseCathayTwRows([HDR_A,
      ['114/01/09', '', '集買', '', '怪公司', 1000, 20, 8, '', 99999, '', '', '', '', '', '99,999(收)', 'X-1'],
    ]);
    expect(bad.txns).toHaveLength(0);
    expect(bad.unsupported[0].reason).toContain('對不上');
  });

  it('淨收付驗算不符 → 列入 unsupported', () => {
    const bad = parseCathayTwRows([HDR_A,
      ['114/01/09', '', '集買', '', '怪公司', 1000, 20, 8, '', 20000, '', '', '', '', '', '55,555(收)', 'X-2'],
    ]);
    expect(bad.txns).toHaveLength(0);
    expect(bad.unsupported[0].reason).toContain('淨收付');
  });

  it('去重鍵含日期與內容（委託書號實測會跨日重複使用）', () => {
    const dup = parseCathayTwRows([HDR_B,
      ['115/05/08', '', '集買', '戊公司', '', 20, 931, 7, 18620, '', '', '', '', '', '', '18,627(收)', 'k-0db7-00'],
      ['115/05/14', '', 'OT買', '己公司', '', 10, 864, 3, 8640, '', '', '', '', '', '', '8,643(收)', 'k-0db7-00'],
    ]);
    expect(dup.txns).toHaveLength(2);
    expect(dup.txns[0].dedupeKey).not.toBe(dup.txns[1].dedupeKey);
    expect(dup.txns[0].orderRef).toBe('k-0db7-00');
  });

  it('格式偵測：認得國泰台股 xlsx', () => {
    expect(looksLikeCathayTwXlsx(rows)).toBe(true);
    expect(looksLikeCathayTwXlsx([['成交日', '商品', '交易別', '數量']])).toBe(false);   // 永豐金
  });
});

// ── CSV（UTF-8 BOM、西元年）─────────────────────────────────────────────
const CSV = [
  '根據您篩選的結果，總計有3筆資料，當前資料為1-3筆，看更多請至國泰證券app查詢',
  '股名,日期,成交股數,淨收付金額,買賣別,成交價,成本,手續費,交易稅,融資金額/券擔保品,資自備款/券保證金,利息,稅款,券手續費/標借費,委託書號',
  '甲公司,2024/09/16,"3,000","-100,300",現買,33.42,"100,260",40,0,0,0,0,0,0,AQ421',
  '乙公司,2024/11/20,"5,000","122,080",現賣,24.45,"122,250",48,122,0,0,0,0,0,A7966',
  '丙公司,2024/08/05,10,"-8,423",現買,842,"8,420",3,0,0,0,0,0,0,k09Nh',
].join('\r\n');

describe('國泰台股 CSV', () => {
  const { txns, unsupported } = parseCathayTwCsv(CSV);

  it('跳過前置說明列，解析全部交易', () => {
    expect(txns).toHaveLength(3);
    expect(unsupported).toHaveLength(0);
  });

  it('千分位與負數淨收付正確解析（買進）', () => {
    expect(txns[0]).toMatchObject({ date: '2024-09-16', name: '甲公司', kind: 'buy', shares: 3000, price: 33.42, gross: 100260, fee: 40, tax: 0 });
    expect(txns[0].gross + txns[0].fee).toBe(100300);
  });

  it('賣出含交易稅', () => {
    expect(txns[1]).toMatchObject({ kind: 'sell', shares: 5000, gross: 122250, fee: 48, tax: 122 });
    expect(txns[1].gross - txns[1].fee - txns[1].tax).toBe(122080);
  });

  it('零股（非整張）正確', () => {
    expect(txns[2]).toMatchObject({ shares: 10, price: 842, gross: 8420, fee: 3 });
  });

  it('格式偵測：認得國泰台股 CSV', () => {
    expect(looksLikeCathayTwCsv(CSV)).toBe(true);
    expect(looksLikeCathayTwCsv('交易日期,商品代號,商品名稱')).toBe(false);   // 複委託
  });

  it('找不到「股名」標題列時回報原因', () => {
    const { txns: none, unsupported: why } = parseCathayTwCsv('隨便的檔案\n沒有標題');
    expect(none).toHaveLength(0);
    expect(why[0].reason).toContain('股名');
  });
});

// ── 中文股名 → 代號 ─────────────────────────────────────────────────────
describe('twSymbolResolver', () => {
  const dir: DirEntry[] = [
    { id: '2330', name: '台積電' },
    { id: '2327', name: '國巨*' },
    { id: '6415', name: '矽力*-KY' },
    { id: '00687B', name: '國泰20年美債' },
    { id: '2315', name: '神達' },
    { id: '3706', name: '神達' },       // 同名多碼
    { id: '1234', name: '甲甲' },
    { id: '5678', name: '甲甲' },       // 無裁定的歧義
    { id: '6757', name: '台灣虎航-創' }, // 創新板：名錄有「-創」、對帳單沒有
    { id: '9999', name: '某某-戰' },     // 戰略新板
    { id: '6415B', name: '矽力' },       // 陷阱：若誤剝 -KY 會與「矽力*-KY」相撞
  ];

  it('完全相同名稱', () => {
    expect(resolveTwSymbol('台積電', dir)).toBe('2330');
  });
  it('處置股 * 標記：名錄含 * 時原樣命中', () => {
    expect(resolveTwSymbol('國巨*', dir)).toBe('2327');
    expect(resolveTwSymbol('矽力*-KY', dir)).toBe('6415');
  });
  it('對帳單無 * 但名錄有 *（或反之）仍可對應', () => {
    expect(resolveTwSymbol('國巨', dir)).toBe('2327');
  });
  it('ETF 名稱', () => {
    expect(resolveTwSymbol('國泰20年美債', dir)).toBe('00687B');
  });
  it('神達歧義：以人工裁定表回 3706（2315 已下市，經歷史股價實證）', () => {
    expect(resolveTwSymbol('神達', dir)).toBe('3706');
  });
  it('無裁定的歧義 → null（絕不猜）', () => {
    expect(resolveTwSymbol('甲甲', dir)).toBeNull();
  });
  it('查無此名 → null', () => {
    expect(resolveTwSymbol('不存在公司', dir)).toBeNull();
  });
  it('創新板「-創」／戰略新板「-戰」後綴：名錄有、對帳單沒有時仍可對應', () => {
    expect(resolveTwSymbol('台灣虎航', dir)).toBe('6757');
    expect(resolveTwSymbol('台灣虎航-創', dir)).toBe('6757');
    expect(resolveTwSymbol('某某', dir)).toBe('9999');
  });
  it('-KY 不可被剝除（剝了會與同名台灣公司誤配）', () => {
    expect(resolveTwSymbol('矽力*-KY', dir)).toBe('6415');   // 非 6415B
    expect(resolveTwSymbol('矽力', dir)).toBe('6415B');
  });

  it('批次解析：換 symbol、重算去重鍵、無法解析者剔除並回報一次', () => {
    const mk = (name: string): ParsedTxn => ({
      broker: 'cathayTw', market: 'TW', date: '2025-01-09', symbol: name, name,
      kind: 'buy', shares: 1, price: 1, gross: 1, fee: 0, tax: 0,
      dedupeKey: `cathayTw|2025-01-09|A-1|${name}|buy|1|1`, rawLine: name,
    });
    const { txns, unresolved } = resolveTwSymbols([mk('台積電'), mk('甲甲'), mk('甲甲')], dir);
    expect(txns).toHaveLength(1);
    expect(txns[0].symbol).toBe('2330');
    expect(txns[0].dedupeKey).toContain('|2330|');
    expect(txns[0].name).toBe('台積電');            // 中文名保留供顯示
    expect(unresolved).toHaveLength(1);              // 同一股名只報一次
    expect(unresolved[0].reason).toContain('甲甲');
  });
});
