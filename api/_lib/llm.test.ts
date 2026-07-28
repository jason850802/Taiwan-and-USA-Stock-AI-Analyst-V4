// api/_lib/llm.test.ts — api/_lib 行為鎖（票 07）：LLM provider 分流錯誤路徑
//
// 本檔守什麼：generateText／generateTextStream 兩入口在「觸網前」就丟出的錯誤路徑
// （LLM_PROVIDER 未設／gemini-api／帶空白／空字串／無效值 → 缺金鑰或設定錯誤）；
// claude-cli 分支（執行檔探索、spawn、串流解析）是首批外，本檔不碰。放置決策見
// docs/adr/0002-api-lib-test-colocation.md。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateText, generateTextStream } from './llm.js';
import { ClassifiedError, type GeminiRequest } from './http.js';

// 兩則現行行為鎖的逐字基準：缺金鑰訊息、無效 provider 訊息。任何一句改了都代表行為變了，
// 要回頭裁決是否登記進 findings，不能順手改測試遷就。
const MISSING_KEY_MESSAGE = '後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。';
const INVALID_PROVIDER_MESSAGE = 'LLM_PROVIDER 設定值無效（支援 gemini-api、claude-cli），請修正環境變數。';

// 錯誤路徑在讀到 provider 字串當下就分流，req 內容本身不影響分流結果，全案例共用同一份。
const REQ: GeminiRequest = {
  prompt: '測試用提示字串',
  systemInstruction: '測試用系統指令',
  mode: 'fast',
};

beforeEach(() => {
  // 紅線：全程不設真金鑰。每個案例開始前顯式清空，不信任環境現值——
  // GEMINI_API_KEY 一旦有值，gemini 路徑會 new GoogleGenAI 打真網路（100 秒 timeout）。
  vi.stubEnv('GEMINI_API_KEY', undefined);
  vi.stubEnv('LLM_PROVIDER', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// 統一用這支小工具取代 expect().rejects 再重呼一次的寫法——只呼叫受測函式一次，
// 沒丟出東西時 err 是 undefined，斷言會清楚地紅在「不是 ClassifiedError」而不是模糊地紅在別處。
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('generateText — provider 分流錯誤路徑', () => {
  it('LLM_PROVIDER 未設（顯式 stub undefined）→ 走 gemini 路徑 → 缺金鑰丟 MISSING_KEY', async () => {
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
  });

  it('LLM_PROVIDER = "gemini-api" → 走 gemini 路徑 → 缺金鑰丟 MISSING_KEY', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini-api');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
  });

  it('LLM_PROVIDER 帶前後空白（" gemini-api "）→ trim 後照走 gemini 路徑 → MISSING_KEY', async () => {
    vi.stubEnv('LLM_PROVIDER', ' gemini-api ');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
  });

  it('LLM_PROVIDER 為空字串 → switch 落在空字串 case，走 gemini 路徑 → MISSING_KEY', async () => {
    vi.stubEnv('LLM_PROVIDER', '');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
  });

  it('LLM_PROVIDER = "codex-cli"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY（findings #4，照鎖不修）', async () => {
    vi.stubEnv('LLM_PROVIDER', 'codex-cli');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
  });

  it('LLM_PROVIDER = "gemini-cli"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY（findings #4，照鎖不修）', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini-cli');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
  });

  it('LLM_PROVIDER = "unknown-provider"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY（findings #4，照鎖不修）', async () => {
    vi.stubEnv('LLM_PROVIDER', 'unknown-provider');
    const err = await captureError(() => generateText(REQ));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
  });
});

describe('generateTextStream — provider 分流錯誤路徑（同 generateText，多驗 onDelta／cancelRef）', () => {
  it('LLM_PROVIDER 未設（顯式 stub undefined）→ MISSING_KEY，onDelta 未被呼叫，cancelRef 未掛 cancel', async () => {
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER = "gemini-api" → MISSING_KEY，onDelta 未被呼叫，cancelRef 未掛 cancel', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini-api');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER 帶前後空白（" gemini-api "）→ trim 後照走 gemini 路徑 → MISSING_KEY，onDelta／cancelRef 同上', async () => {
    vi.stubEnv('LLM_PROVIDER', ' gemini-api ');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER 為空字串 → switch 落在空字串 case，走 gemini 路徑 → MISSING_KEY，onDelta／cancelRef 同上', async () => {
    vi.stubEnv('LLM_PROVIDER', '');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(MISSING_KEY_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER = "codex-cli"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY，onDelta 未被呼叫，cancelRef 未掛 cancel', async () => {
    vi.stubEnv('LLM_PROVIDER', 'codex-cli');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER = "gemini-cli"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY，onDelta 未被呼叫，cancelRef 未掛 cancel', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini-cli');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('LLM_PROVIDER = "unknown-provider"（無效值）→ 丟設定錯誤，code 現狀掛 MISSING_KEY，onDelta 未被呼叫，cancelRef 未掛 cancel', async () => {
    vi.stubEnv('LLM_PROVIDER', 'unknown-provider');
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const err = await captureError(() => generateTextStream(REQ, onDelta, cancelRef));
    expect(err).toBeInstanceOf(ClassifiedError);
    expect((err as ClassifiedError).code).toBe('MISSING_KEY');
    expect((err as ClassifiedError).message).toBe(INVALID_PROVIDER_MESSAGE);
    expect(onDelta).not.toHaveBeenCalled();
    expect(cancelRef.cancel).toBeUndefined();
  });
});
