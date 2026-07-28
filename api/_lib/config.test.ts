// api/_lib/config.test.ts — api/_lib 首批行為鎖（票 01）：後端設定讀取
//
// 【放置決策】本專案既有測試檔全在 utils/，那是前端側的歷史沿革——utils/fetchError.test.ts
// 檔頭寫的「沿用現行 vitest 收錄範圍」是描述當時現況，不是原則。後端測試改與受測物同目錄，
// 決策理由與四項安全查證見 docs/adr/0002-api-lib-test-colocation.md（別在這裡重述，
// 兩份會不同步）。本檔即該決策的 tracer bullet：vitest 收得到、tsc 蓋得到、產物掃得乾淨。
//
// 【立場＝行為鎖】照現行行為寫斷言，不評對錯（詞彙見 CONTEXT.md「後端測試」節）。
// 本模組是後端讀環境變數的唯一入口，它的 fallback 決定了「漏設環境變數時後端會變成
// 什麼樣子」：用哪個模型、誰能跨站呼叫我方 API、shared secret 驗不驗。這些判錯了不會有
// 任何徵兆——沒有例外、沒有紅字，只是安靜地換掉行為，所以要有紅燈網。
//
// 【要改預設模型名的人請注意】兩個預設值在本檔逐字上鎖是刻意的：CORE_RULES 要求改型號
// 時三處要一起動（本模組、.env.example、geminiCache 的 ENGINE_TAG）。紅燈是提醒不是阻礙
// ——確認三處都改了，再更新這裡的期望值。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAllowedOrigins,
  getGeminiApiKey,
  getModelForMode,
  getSharedSecret,
} from './config.js';

// 這五把 env 由本檔全程掌控：每個案例開始前一律清空，結束後還原成 process 原值。
// 清空是必要的——本機跑測試時環境裡可能已經有真值，殘留會讓「未設」的案例假綠。
const MANAGED_KEYS = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_THINKING',
  'ALLOWED_ORIGIN',
  'PROXY_SHARED_SECRET',
] as const;

beforeEach(() => {
  // 值傳 undefined 即為刪除該變數。
  MANAGED_KEYS.forEach(key => vi.stubEnv(key, undefined));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getGeminiApiKey', () => {
  it('未設時回 undefined——呼叫端據此丟 MISSING_KEY', () => {
    expect(getGeminiApiKey()).toBeUndefined();
  });

  it('有值時原樣回傳，不 trim 也不正規化', () => {
    vi.stubEnv('GEMINI_API_KEY', '  test-key-not-a-real-secret  ');
    expect(getGeminiApiKey()).toBe('  test-key-not-a-real-secret  ');
  });

  it('空字串照樣回空字串——「算不算缺金鑰」的判定在呼叫端用 falsy 做，不在這裡', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(getGeminiApiKey()).toBe('');
  });
});

describe('getModelForMode', () => {
  it('fast 未設環境變數時落回預設型號', () => {
    expect(getModelForMode('fast')).toBe('gemini-3.5-flash');
  });

  it('thinking 未設環境變數時落回預設型號', () => {
    expect(getModelForMode('thinking')).toBe('gemini-3.1-pro-preview');
  });

  it('兩個模式各讀各的環境變數，互不干擾', () => {
    vi.stubEnv('GEMINI_MODEL_FAST', 'model-for-fast');
    expect(getModelForMode('fast')).toBe('model-for-fast');
    expect(getModelForMode('thinking')).toBe('gemini-3.1-pro-preview');

    vi.stubEnv('GEMINI_MODEL_THINKING', 'model-for-thinking');
    expect(getModelForMode('fast')).toBe('model-for-fast');
    expect(getModelForMode('thinking')).toBe('model-for-thinking');
  });

  it('空字串視同未設，落回預設型號', () => {
    vi.stubEnv('GEMINI_MODEL_FAST', '');
    vi.stubEnv('GEMINI_MODEL_THINKING', '');
    expect(getModelForMode('fast')).toBe('gemini-3.5-flash');
    expect(getModelForMode('thinking')).toBe('gemini-3.1-pro-preview');
  });

  it('只有空白的值視同未設，落回預設型號', () => {
    // 原行為是「原樣把空白當型號送出去」（findings 第 5(a) 條），2026-07-28 裁決收口：
    // 空白是 truthy、`||` 攔不住，無效型號會一路送到上游，使用者看到的是「模型無法使用」
    // 而不是「設定打錯」——症狀離原因太遠。改為取值後先去頭尾空白再判斷。
    vi.stubEnv('GEMINI_MODEL_FAST', '   ');
    expect(getModelForMode('fast')).toBe('gemini-3.5-flash');
    vi.stubEnv('GEMINI_MODEL_THINKING', '\t\n ');
    expect(getModelForMode('thinking')).toBe('gemini-3.1-pro-preview');
  });

  it('有值但前後帶空白時，去掉空白再回傳——不讓多餘空白混進型號名', () => {
    vi.stubEnv('GEMINI_MODEL_FAST', '  model-with-spaces  ');
    expect(getModelForMode('fast')).toBe('model-with-spaces');
  });

  it('每次呼叫都重新讀環境變數，不是模組載入時的快照', () => {
    expect(getModelForMode('fast')).toBe('gemini-3.5-flash');
    vi.stubEnv('GEMINI_MODEL_FAST', 'model-changed-later');
    expect(getModelForMode('fast')).toBe('model-changed-later');
  });
});

describe('getAllowedOrigins', () => {
  it('未設時只允許本機開發來源', () => {
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000']);
  });

  it('空字串視同未設，落回本機開發來源', () => {
    vi.stubEnv('ALLOWED_ORIGIN', '');
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000']);
  });

  it('單一來源原樣成為唯一白名單項', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://app.example.com');
    expect(getAllowedOrigins()).toEqual(['https://app.example.com']);
  });

  it('逗號分隔多個來源，逐項去除前後空白', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://a.example.com , https://b.example.com');
    expect(getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('尾斜線一律去到底——多打幾條都不會留下殘骸', () => {
    // 原行為是「只去一層」（findings 第 5(b) 條），2026-07-28 裁決收口：留下來的那條
    // 尾斜線永遠比不中瀏覽器送的 Origin（Origin 不帶尾斜線），該白名單項會實質失效，
    // 而部署方以為自己把整個網域設好了。
    vi.stubEnv(
      'ALLOWED_ORIGIN',
      'https://a.example.com/,https://b.example.com//,https://c.example.com///',
    );
    expect(getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });

  it('空項會被濾掉，不會變成空字串白名單項', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://a.example.com,,  ,https://b.example.com');
    expect(getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('濾完一項不剩時落回本機開發來源，不回空陣列', () => {
    // 空陣列會讓來源檢查對任何跨站來源都不放行；落回本機值是刻意的保底。
    vi.stubEnv('ALLOWED_ORIGIN', ' , , ');
    expect(getAllowedOrigins()).toEqual(['http://localhost:3000']);
  });

  it('大小寫原樣保留——來源比對是嚴格字串相等，大小寫不同就是不同來源', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://APP.Example.COM');
    expect(getAllowedOrigins()).toEqual(['https://APP.Example.COM']);
  });
});

describe('getSharedSecret', () => {
  it('未設時回 undefined——呼叫端據此放行，等於停用這道驗證', () => {
    expect(getSharedSecret()).toBeUndefined();
  });

  it('空字串回空字串——同樣是 falsy，呼叫端一樣視為停用', () => {
    // 這條路現在會順帶噴一行警告（見下面的 describe）；這裡只驗回傳值，
    // 把 warn 接住免得測試輸出多一行雜訊。
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PROXY_SHARED_SECRET', '');
    expect(getSharedSecret()).toBe('');
    warnSpy.mockRestore();
  });

  it('有值時原樣回傳，不 trim——尾隨空白是 secret 的一部分', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', ' shared-secret-for-test ');
    expect(getSharedSecret()).toBe(' shared-secret-for-test ');
  });
});

describe('getSharedSecret 對「設定存在但為空」的警告', () => {
  // findings 第 6 條，2026-07-28 裁決收口：空字串與未設同路、驗證無聲停用，
  // 而 Vercel 環境變數貼上失敗或寫成 `PROXY_SHARED_SECRET=` 就會是這個狀態，
  // 部署方以為它開著。**放行行為刻意不動**（serverless 不做 fail-fast，見票面），
  // 只多一行 log 讓它在 Vercel 記錄裡看得見。
  //
  // 警告用 module 級旗標做到「每個 process 只喊一次」，所以每個案例都要重載模組才測得準。
  beforeEach(() => {
    vi.resetModules();
  });

  it('值為空字串時警告一次，且同一個 process 內不重複刷', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PROXY_SHARED_SECRET', '');
    const mod = await import('./config.js');

    expect(mod.getSharedSecret()).toBe(''); // 回傳值與改動前逐字相同
    expect(warnSpy).toHaveBeenCalledTimes(1);

    mod.getSharedSecret();
    mod.getSharedSecret();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('未設時不警告——那是本機 dev 的正常降級路徑，不該被當成問題喊', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PROXY_SHARED_SECRET', undefined);
    const mod = await import('./config.js');

    expect(mod.getSharedSecret()).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('有正常值時不警告', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('PROXY_SHARED_SECRET', 'a-real-secret-value');
    const mod = await import('./config.js');

    expect(mod.getSharedSecret()).toBe('a-real-secret-value');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
