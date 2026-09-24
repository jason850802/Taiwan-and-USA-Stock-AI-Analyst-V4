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
import { connectClientAbort } from './_lib/clientAbort.js';

interface GeminiReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  aborted?: boolean;
  on?(event: 'aborted', listener: () => void): void;
  off?(event: 'aborted', listener: () => void): void;
}

interface GeminiRes {
  status(code: number): GeminiRes;
  setHeader(name: string, value: string): void;
  end(): void;
  json(data: unknown): void;
  writableFinished?: boolean;
  destroyed?: boolean;
  on?(event: 'close', listener: () => void): void;
  off?(event: 'close', listener: () => void): void;
}

const statusByCode: Record<GeminiErrorCode, number> = {
  MODEL_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  BAD_REQUEST: 400,
  MISSING_KEY: 500,
  CANCELLED: 499, // 非串流路徑不產生取消分類，僅 Record 型別完整性
};

export const maxDuration = 120;

export default async function handler(req: GeminiReq, res: GeminiRes) {
  const client = connectClientAbort(req, res);
  try {
    if (client.signal.aborted) return;
    if (!(await applyGuards(req, res, [geminiPerMin, geminiPerDay])) || client.signal.aborted) return;

    if (req.method !== 'POST') {
      res.status(405).json({
        code: 'BAD_REQUEST',
        message: '僅支援 POST 請求。',
      });
      return;
    }

    const request = validateGeminiRequest(req.body);
    const result = await generateText(request, client.signal);
    if (client.signal.aborted) return;

    res.status(200).json(result);
  } catch (error) {
    if (client.signal.aborted) return;
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
  } finally {
    client.dispose();
  }
}
