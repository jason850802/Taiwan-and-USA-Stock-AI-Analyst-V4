import { describe, expect, it, vi } from 'vitest';

const generateContent = vi.hoisted(() => vi.fn());
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
vi.mock('./config.js', () => ({
  getGeminiApiKey: () => '測試用假值',
  getModelForMode: () => '假模型',
}));

import { callGeminiWithTimeout } from './http.js';
import { generateTextStream } from './llm.js';

describe('Gemini API 取消訊號', () => {
  it('用戶端中止會傳至 SDK 的 abortSignal，停止尚未完成的請求', async () => {
    let sdkSignal: AbortSignal | undefined;
    generateContent.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) => {
      sdkSignal = config.abortSignal;
      return new Promise((_resolve, reject) => {
        sdkSignal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
      });
    });
    const controller = new AbortController();
    const result = callGeminiWithTimeout({
      apiKey: '測試用假值', model: '假模型', contents: [], config: {}, signal: controller.signal,
    });
    expect(sdkSignal?.aborted).toBe(false);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(sdkSignal?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('串流入口的取消參照會中止 Gemini API 分支，並清除參照', async () => {
    const before = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'gemini-api';
    try {
      let sdkSignal: AbortSignal | undefined;
      generateContent.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) => {
        sdkSignal = config.abortSignal;
        return new Promise((_resolve, reject) => {
          sdkSignal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
        });
      });
      const cancelRef: { cancel?: () => void } = {};
      const result = generateTextStream({ prompt: '假提示詞', systemInstruction: '假系統指令', mode: 'fast' },
        vi.fn(), cancelRef);
      expect(cancelRef.cancel).toBeTypeOf('function');
      cancelRef.cancel?.();
      await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      expect(sdkSignal?.aborted).toBe(true);
      expect(cancelRef.cancel).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = before;
    }
  });
});
