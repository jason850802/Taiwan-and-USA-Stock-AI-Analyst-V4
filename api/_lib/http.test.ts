// api/_lib/http.test.ts — api/_lib 行為鎖（票 04）：Gemini 錯誤分類／金鑰消毒／請求驗證
//
// 本檔守什麼：classifyGeminiError 的判定路徑、sanitizeErrorForLog 的三種金鑰消毒遮蔽（金鑰紅線
// 的 log 側防線）、validateGeminiRequest 的必填檢查與型別透傳現狀；callGeminiWithTimeout（真打
// SDK 網路）是首批外不碰。放置決策與安全查證見 docs/adr/0002-api-lib-test-colocation.md。
import { describe, it, expect } from 'vitest';
import {
  ClassifiedError,
  classifyGeminiError,
  sanitizeErrorForLog,
  validateGeminiRequest,
  type GeminiErrorCode,
} from './http.js';

// 統一用這支小工具取代 expect().toThrow() 再重呼一次的寫法——只呼叫受測函式一次，
// 沒丟出東西時 err 是 undefined，斷言會清楚地紅在「不是 ClassifiedError」而不是模糊地紅在別處。
function captureError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('ClassifiedError', () => {
  const DEFAULT_MESSAGES: Record<GeminiErrorCode, string> = {
    MODEL_NOT_FOUND: '目前設定的 AI 模型無法使用，請確認模型名稱設定是否正確。',
    RATE_LIMITED: 'Gemini 服務目前請求過於頻繁，請稍後再試一次。',
    UPSTREAM_ERROR: 'AI 服務暫時無法回應，請稍後再試。',
    BAD_REQUEST: '請求格式不正確，請重新整理頁面後再試一次。',
    MISSING_KEY: '後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。',
  };

  (Object.entries(DEFAULT_MESSAGES) as [GeminiErrorCode, string][]).forEach(([code, message]) => {
    it(`${code} 有逐字鎖住的預設繁中訊息`, () => {
      expect(new ClassifiedError(code).message).toBe(message);
    });
  });

  it('自訂訊息可覆寫預設文案', () => {
    const err = new ClassifiedError('BAD_REQUEST', '自訂錯誤訊息');
    expect(err.message).toBe('自訂錯誤訊息');
  });

  it('是 Error 的子類，name 固定為 ClassifiedError，code 保留原值', () => {
    const err = new ClassifiedError('MISSING_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClassifiedError);
    expect(err.name).toBe('ClassifiedError');
    expect(err.code).toBe('MISSING_KEY');
  });
});

describe('classifyGeminiError — status 數字路', () => {
  it('status 404 → MODEL_NOT_FOUND', () => {
    expect(classifyGeminiError({ status: 404 }).code).toBe('MODEL_NOT_FOUND');
  });

  it('status 429 → RATE_LIMITED', () => {
    expect(classifyGeminiError({ status: 429 }).code).toBe('RATE_LIMITED');
  });

  it('status 500 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError({ status: 500 }).code).toBe('UPSTREAM_ERROR');
  });

  it('status 503 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError({ status: 503 }).code).toBe('UPSTREAM_ERROR');
  });
});

describe('classifyGeminiError — status 字串會被 Number() 轉型（現行行為，照現狀鎖）', () => {
  it('{ status: "404" } 字串也命中 MODEL_NOT_FOUND', () => {
    expect(classifyGeminiError({ status: '404' }).code).toBe('MODEL_NOT_FOUND');
  });

  it('{ status: "429" } 字串也命中 RATE_LIMITED', () => {
    expect(classifyGeminiError({ status: '429' }).code).toBe('RATE_LIMITED');
  });
});

describe('classifyGeminiError — 訊息文字路（word boundary）', () => {
  it('訊息含獨立的 404 字樣 → MODEL_NOT_FOUND', () => {
    expect(classifyGeminiError(new Error('Request failed with status code 404')).code)
      .toBe('MODEL_NOT_FOUND');
  });

  it('訊息含獨立的 429 字樣 → RATE_LIMITED', () => {
    expect(classifyGeminiError(new Error('Error: 429 Too Many Requests')).code)
      .toBe('RATE_LIMITED');
  });

  it('訊息含獨立的 5xx 字樣 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(new Error('Service Unavailable (503)')).code)
      .toBe('UPSTREAM_ERROR');
  });

  it('word boundary：數字黏著其他數字時不算命中，落回預設 UPSTREAM_ERROR', () => {
    // "4045" 裡雖含連續字元 "404"，但緊接的 "5" 讓右邊界不成立，不會被 \b404\b 命中——
    // 這是現行 regex 的邊界行為，用來鎖住「用 word boundary 不是用 includes」這個判定路。
    expect(classifyGeminiError(new Error('error 4045 happened')).code).toBe('UPSTREAM_ERROR');
  });
});

describe('classifyGeminiError — abort／timeout → UPSTREAM_ERROR', () => {
  it('name 為 AbortError → UPSTREAM_ERROR', () => {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    expect(classifyGeminiError(err).code).toBe('UPSTREAM_ERROR');
  });

  it('訊息含 aborted 字樣 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(new Error('signal is aborted without reason')).code)
      .toBe('UPSTREAM_ERROR');
  });

  it('訊息含 timeout 字樣（無空格無 d）→ UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(new Error('Request timeout')).code).toBe('UPSTREAM_ERROR');
  });

  it('訊息含 timed out（有 d 有空格）字樣 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(new Error('connection timed out')).code).toBe('UPSTREAM_ERROR');
  });
});

describe('classifyGeminiError — 已分類錯誤原樣穿透', () => {
  it('傳入 ClassifiedError 實例時直接回傳原物件，code 不被覆蓋成別的值', () => {
    const original = new ClassifiedError('MISSING_KEY');
    const result = classifyGeminiError(original);
    expect(result).toBe(original);
    expect(result.code).toBe('MISSING_KEY');
  });
});

describe('classifyGeminiError — 其餘一律預設 UPSTREAM_ERROR', () => {
  it('undefined → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(undefined).code).toBe('UPSTREAM_ERROR');
  });

  it('null → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(null).code).toBe('UPSTREAM_ERROR');
  });

  it('一般字串 → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError('boom').code).toBe('UPSTREAM_ERROR');
  });

  it('無特徵字樣的一般 Error → UPSTREAM_ERROR', () => {
    expect(classifyGeminiError(new Error('something went wrong')).code).toBe('UPSTREAM_ERROR');
  });
});

describe('sanitizeErrorForLog — 三種金鑰消毒各自上鎖', () => {
  // 樣本紅線：以下所有 AIza 假樣本尾巴都短於 30 字元，故意避開專案金鑰掃描規則
  // （AIza 後接 ≥30 個 [0-9A-Za-z_-] 才會被 gate 攔下），同時尾巴 ≥1 字元就足以
  // 測到 production regex `AIza[0-9A-Za-z_-]+` 的遮蔽行為。

  it('googleapis URL 整段換成 [REDACTED_GOOGLE_API_URL]（含內嵌的 key= 與 AIza 一併吃掉）', () => {
    const message =
      'fetch failed: https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSampleTail1 details';
    const result = sanitizeErrorForLog(new Error(message));
    expect(result).toContain('[REDACTED_GOOGLE_API_URL]');
    expect(result).not.toContain('googleapis.com');
    expect(result).not.toContain('AIzaSampleTail1');
  });

  it('key= 參數換成 [REDACTED_API_KEY_PARAM]（不在 googleapis URL 內時單獨命中）', () => {
    const message = 'proxy call to https://example.com/api?key=plainParamValue failed';
    const result = sanitizeErrorForLog(new Error(message));
    expect(result).toContain('[REDACTED_API_KEY_PARAM]');
    expect(result).not.toContain('plainParamValue');
  });

  it('AIza 樣式金鑰換成 [REDACTED_API_KEY]', () => {
    const message = 'invalid credential AIzaFakeSample123 rejected';
    const result = sanitizeErrorForLog(new Error(message));
    expect(result).toContain('[REDACTED_API_KEY]');
    expect(result).not.toContain('AIzaFakeSample123');
  });

  it('一句訊息同時踩多雷：URL 吃掉內嵌的 key／AIza，另外兩個獨立出現的也各自被消毒', () => {
    const message =
      'Fetch https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaInUrlTail1 failed. ' +
      'Retry with key=plainParamTail2 or check AIzaStandaloneTail3.';
    const result = sanitizeErrorForLog(new Error(message));

    expect(result).toBe(
      'Fetch [REDACTED_GOOGLE_API_URL] failed. Retry with [REDACTED_API_KEY_PARAM] or check [REDACTED_API_KEY].'
    );
    expect(result).not.toContain('googleapis.com');
    expect(result).not.toContain('AIzaInUrlTail1');
    expect(result).not.toContain('plainParamTail2');
    expect(result).not.toContain('AIzaStandaloneTail3');
  });
});

describe('sanitizeErrorForLog — 非 Error 輸入走 String(error)', () => {
  it('傳入一般字串且無雷時原樣輸出', () => {
    expect(sanitizeErrorForLog('plain string without secrets')).toBe('plain string without secrets');
  });

  it('傳入非字串、非 Error 值時走 String() 轉型', () => {
    expect(sanitizeErrorForLog(12345)).toBe('12345');
    expect(sanitizeErrorForLog(null)).toBe('null');
    expect(sanitizeErrorForLog(undefined)).toBe('undefined');
  });

  it('字串輸入若含金鑰樣式，一樣會被消毒——消毒不挑輸入型別', () => {
    expect(sanitizeErrorForLog('token AIzaPlainStringTail1 leaked')).toBe('token [REDACTED_API_KEY] leaked');
  });
});

describe('validateGeminiRequest — 合法請求', () => {
  it('回傳 trim 後的 prompt 與 systemInstruction，mode 原樣帶出', () => {
    const result = validateGeminiRequest({
      prompt: '  分析台積電  ',
      systemInstruction: '  你是分析師  ',
      mode: 'fast',
    });
    expect(result.prompt).toBe('分析台積電');
    expect(result.systemInstruction).toBe('你是分析師');
    expect(result.mode).toBe('fast');
  });

  it('mode 為 thinking 時原樣通過', () => {
    expect(validateGeminiRequest({ prompt: 'a', systemInstruction: 'b', mode: 'thinking' }).mode)
      .toBe('thinking');
  });

  it('未給 temperature 時回傳值裡是 undefined', () => {
    const result = validateGeminiRequest({ prompt: 'a', systemInstruction: 'b', mode: 'fast' });
    expect(result.temperature).toBeUndefined();
  });
});

describe('validateGeminiRequest — 缺必填或格式不符 → ClassifiedError(BAD_REQUEST)', () => {
  it('缺 prompt', () => {
    const err = captureError(() => validateGeminiRequest({ systemInstruction: 'b', mode: 'fast' }));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('缺 systemInstruction', () => {
    const err = captureError(() => validateGeminiRequest({ prompt: 'a', mode: 'fast' }));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('mode 不在 fast|thinking 白名單', () => {
    const err = captureError(() =>
      validateGeminiRequest({ prompt: 'a', systemInstruction: 'b', mode: 'creative' })
    );
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('mode 缺漏（undefined）', () => {
    const err = captureError(() => validateGeminiRequest({ prompt: 'a', systemInstruction: 'b' }));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('prompt 全空白，trim 後為空', () => {
    const err = captureError(() =>
      validateGeminiRequest({ prompt: '   ', systemInstruction: 'b', mode: 'fast' })
    );
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('systemInstruction 全空白，trim 後為空', () => {
    const err = captureError(() =>
      validateGeminiRequest({ prompt: 'a', systemInstruction: '   ', mode: 'fast' })
    );
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });

  it('body 本身是 undefined 也不會炸，一樣落到 BAD_REQUEST', () => {
    const err = captureError(() => validateGeminiRequest(undefined));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('BAD_REQUEST');
  });
});

describe('validateGeminiRequest — temperature／thinkingConfig 不驗型別直接透傳（findings #1，照現狀鎖，勿修）', () => {
  it('字串型別的 temperature 原樣透傳，不會被擋下或轉型', () => {
    const result = validateGeminiRequest({
      prompt: 'a',
      systemInstruction: 'b',
      mode: 'fast',
      temperature: 'not-a-number',
    });
    expect(result.temperature).toBe('not-a-number');
  });

  it('數字型別的 temperature 原樣透傳', () => {
    const result = validateGeminiRequest({
      prompt: 'a',
      systemInstruction: 'b',
      mode: 'fast',
      temperature: 0.7,
    });
    expect(result.temperature).toBe(0.7);
  });

  it('thinkingConfig 不論形狀直接透傳，同一物件參照', () => {
    const weirdThinkingConfig = { thinkingLevel: 'NOT_A_VALID_LEVEL', extra: 123 };
    const result = validateGeminiRequest({
      prompt: 'a',
      systemInstruction: 'b',
      mode: 'fast',
      thinkingConfig: weirdThinkingConfig,
    });
    expect(result.thinkingConfig).toBe(weirdThinkingConfig);
  });
});
