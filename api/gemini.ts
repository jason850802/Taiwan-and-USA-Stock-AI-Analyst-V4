import {
  ClassifiedError,
  classifyGeminiError,
  sanitizeErrorForLog,
  validateGeminiRequest,
  type GeminiErrorCode,
} from './_lib/http.js';
import { generateText } from './_lib/llm.js';
import { applyGuards } from './_lib/guard.js';
import { geminiPerDay, geminiPerMin } from './_lib/ratelimit.js';

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
    const request = validateGeminiRequest(req.body);
    const result = await generateText(request);

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
