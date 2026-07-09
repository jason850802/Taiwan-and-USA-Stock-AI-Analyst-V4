import { getGeminiApiKey, getModelForMode } from './_lib/config';
import {
  ClassifiedError,
  callGeminiWithTimeout,
  classifyGeminiError,
  sanitizeErrorForLog,
  validateGeminiRequest,
  type GeminiErrorCode,
} from './_lib/http';
import { applyGuards } from './_lib/guard';
import { geminiPerDay, geminiPerMin } from './_lib/ratelimit';

interface GeminiReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

interface GeminiRes {
  status(code: number): GeminiRes;
  setHeader(name: string, value: string): void;
  end(): void;
  json(data: unknown): void;
}

const statusByCode: Record<GeminiErrorCode, number> = {
  MODEL_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  BAD_REQUEST: 400,
  MISSING_KEY: 500,
};

export const maxDuration = 120;

export default async function handler(req: GeminiReq, res: GeminiRes) {
  if (!(await applyGuards(req, res, [geminiPerMin, geminiPerDay]))) return;

  if (req.method !== 'POST') {
    res.status(405).json({
      code: 'BAD_REQUEST',
      message: '僅支援 POST 請求。',
    });
    return;
  }

  try {
    const {
      prompt,
      systemInstruction,
      mode,
      temperature,
      thinkingConfig,
    } = validateGeminiRequest(req.body);
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
      res.status(500).json({
        code: 'MISSING_KEY',
        message: '後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。',
      });
      return;
    }

    const model = getModelForMode(mode);
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const config = {
      systemInstruction,
      temperature: temperature ?? 0.1,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    };
    const result = await callGeminiWithTimeout({
      apiKey,
      model,
      contents,
      config,
    });

    res.status(200).json(result);
  } catch (error) {
    const classifiedError = error instanceof ClassifiedError
      ? error
      : classifyGeminiError(error);

    console.error(
      `[gemini:${classifiedError.code}] ${sanitizeErrorForLog(error)}`,
    );
    res.status(statusByCode[classifiedError.code]).json({
      code: classifiedError.code,
      message: classifiedError.message,
    });
  }
}
