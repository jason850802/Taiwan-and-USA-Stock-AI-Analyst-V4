import { GoogleGenAI } from '@google/genai';
import type { GeminiMode } from './config';

export type GeminiErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'BAD_REQUEST'
  | 'MISSING_KEY';

export type GeminiRequest = {
  prompt: string;
  systemInstruction: string;
  mode: GeminiMode;
  temperature?: number;
  thinkingConfig?: {
    thinkingLevel?: 'MEDIUM';
    thinkingBudget?: number;
  };
};

const errorMessages: Record<GeminiErrorCode, string> = {
  MODEL_NOT_FOUND: '目前設定的 AI 模型無法使用，請確認模型名稱設定是否正確。',
  RATE_LIMITED: 'Gemini 服務目前請求過於頻繁，請稍後再試一次。',
  UPSTREAM_ERROR: 'AI 服務暫時無法回應，請稍後再試。',
  BAD_REQUEST: '請求格式不正確，請重新整理頁面後再試一次。',
  MISSING_KEY: '後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。',
};

export class ClassifiedError extends Error {
  code: GeminiErrorCode;

  constructor(code: GeminiErrorCode, message = errorMessages[code]) {
    super(message);
    this.name = 'ClassifiedError';
    this.code = code;
  }
}

export async function callGeminiWithTimeout(params: {
  apiKey: string;
  model: string;
  contents: unknown;
  config: unknown;
  timeoutMs?: number;
}): Promise<{ text: string }> {
  const { apiKey, model, contents, config, timeoutMs = 100000 } = params;
  const ai = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const requestConfig = {
    ...(config && typeof config === 'object' ? config : {}),
    abortSignal: controller.signal,
  };

  try {
    const response = await ai.models.generateContent({
      model,
      contents: contents as any,
      config: requestConfig,
    });

    return { text: response.text || '' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function classifyGeminiError(error: unknown): ClassifiedError {
  if (error instanceof ClassifiedError) {
    return error;
  }

  const errorRecord = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const status = typeof errorRecord.status === 'number'
    ? errorRecord.status
    : Number(errorRecord.status);
  const name = typeof errorRecord.name === 'string' ? errorRecord.name : '';
  const message = error instanceof Error ? error.message : String(error || '');

  if (status === 404 || /\b404\b/.test(message)) {
    return new ClassifiedError('MODEL_NOT_FOUND');
  }

  if (status === 429 || /\b429\b/.test(message)) {
    return new ClassifiedError('RATE_LIMITED');
  }

  if (name === 'AbortError' || /aborted|aborterror|timed?\s*out/i.test(message)) {
    return new ClassifiedError('UPSTREAM_ERROR');
  }

  if ((status >= 500 && status < 600) || /\b5\d{2}\b/.test(message)) {
    return new ClassifiedError('UPSTREAM_ERROR');
  }

  return new ClassifiedError('UPSTREAM_ERROR');
}

export function sanitizeErrorForLog(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);

  return rawMessage
    .replace(/https?:\/\/[^\s"'<>]*googleapis\.com[^\s"'<>]*/gi, '[REDACTED_GOOGLE_API_URL]')
    .replace(/key=[^&\s"'<>]+/gi, '[REDACTED_API_KEY_PARAM]')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_API_KEY]');
}

export function validateGeminiRequest(body: any): GeminiRequest {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const systemInstruction = typeof body?.systemInstruction === 'string'
    ? body.systemInstruction.trim()
    : '';
  const mode = body?.mode;

  if (!prompt || !systemInstruction || (mode !== 'fast' && mode !== 'thinking')) {
    throw new ClassifiedError('BAD_REQUEST');
  }

  return {
    prompt,
    systemInstruction,
    mode,
    temperature: body.temperature,
    thinkingConfig: body.thinkingConfig,
  };
}
