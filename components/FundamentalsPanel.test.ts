// components/FundamentalsPanel.test.ts — 基本面分頁搜尋閘門的行為鎖
//
// 本檔守什麼：搜尋框交來的字串哪些會被當成台股代碼去抓 FinMind、哪些改顯示「僅支援台股」提示。
// 輸入有兩條路：搜尋結果點選（本地名錄是純代碼；Yahoo 搜尋補進來的台股帶 .TW／.TWO）
// 與使用者自由輸入（只 trim 過，什麼都可能出現）。
// 主要防的回歸：把閘門裡的 isTwCode 換成 isTwStock。兩者只差在後綴——閘門只剝一層 .TW/.TWO，
// 「2330.TW.TW」剝完是「2330.TW」：isTwStock 會放行，FinMind 拿到帶後綴的 data_id 只會報錯；
// isTwCode 擋下，使用者看到的是「僅支援台股」提示。
// 放置決策同 docs/adr/0002-api-lib-test-colocation.md：測試與受測碼放一起。
import { describe, it, expect } from 'vitest';
import { toTwCode } from './FundamentalsPanel.js';

describe('toTwCode — 基本面分頁搜尋閘門', () => {
  it('台股純代碼原樣放行（本地名錄點選）', () => {
    expect(toTwCode('2330')).toBe('2330');
    expect(toTwCode('0050')).toBe('0050');
    expect(toTwCode('00631L')).toBe('00631L');
    expect(toTwCode('00981A')).toBe('00981A');
  });

  it('剝一層 .TW／.TWO，並統一大寫、去前後空白（Yahoo 搜尋結果、自由輸入）', () => {
    expect(toTwCode('2330.TW')).toBe('2330');
    expect(toTwCode('6488.TWO')).toBe('6488');
    expect(toTwCode(' 2330.tw ')).toBe('2330');
    expect(toTwCode('00631l')).toBe('00631L');
  });

  it('位數邊界：3～6 碼數字，可帶單一字母', () => {
    expect(toTwCode('123')).toBe('123');
    expect(toTwCode('123456')).toBe('123456');
    expect(toTwCode('12')).toBeNull();
    expect(toTwCode('1234567')).toBeNull();
    expect(toTwCode('0067BB')).toBeNull();
  });

  it('美股代碼、公司名等非台股代碼擋下', () => {
    expect(toTwCode('AAPL')).toBeNull();
    expect(toTwCode('BRK.B')).toBeNull();
    expect(toTwCode('AAPL.TW')).toBeNull();
    expect(toTwCode('台積電')).toBeNull();
  });

  it('雙後綴擋下——只剝一層，剩下的仍帶後綴（換成 isTwStock 會放行，是本鎖的主要目的）', () => {
    expect(toTwCode('2330.TW.TW')).toBeNull();
    expect(toTwCode('2330.TWO.TW')).toBeNull();
    expect(toTwCode('6488.TWO.TWO')).toBeNull();
  });
});
