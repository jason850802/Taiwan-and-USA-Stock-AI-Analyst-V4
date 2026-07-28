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

  it('只有空白的值不會落回預設，會原樣被當成型號送出去（不 trim）', () => {
    // findings 第 5 條：空白字串是 truthy，`||` 攔不住它——設定打錯成空白會送出無效型號，
    // 錯誤要到上游才浮現。首批只鎖現狀，要不要修由使用者裁決。
    vi.stubEnv('GEMINI_MODEL_FAST', '   ');
    expect(getModelForMode('fast')).toBe('   ');
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

  it('去尾斜線只去一層——兩條斜線會留下一條', () => {
    vi.stubEnv('ALLOWED_ORIGIN', 'https://a.example.com/,https://b.example.com//');
    expect(getAllowedOrigins()).toEqual([
      'https://a.example.com',
      'https://b.example.com/',
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
    vi.stubEnv('PROXY_SHARED_SECRET', '');
    expect(getSharedSecret()).toBe('');
  });

  it('有值時原樣回傳，不 trim——尾隨空白是 secret 的一部分', () => {
    vi.stubEnv('PROXY_SHARED_SECRET', ' shared-secret-for-test ');
    expect(getSharedSecret()).toBe(' shared-secret-for-test ');
  });
});
