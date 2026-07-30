import {
  ClassifiedError,
  classifyGeminiError,
  sanitizeErrorForLog,
  validateGeminiRequest,
  type GeminiErrorCode,
} from './_lib/http.js';
import { generateTextStream } from './_lib/llm.js';
import { applyGuards } from './_lib/guard.js';
import { geminiPerDay, geminiPerMin } from './_lib/ratelimit.js';

interface GeminiStreamReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  on(event: 'close', listener: () => void): void;
}

interface GeminiStreamRes {
  status(code: number): GeminiStreamRes;
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(): void;
  json(data: unknown): void;
}

const statusByCode: Record<GeminiErrorCode, number> = {
  MODEL_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  BAD_REQUEST: 400,
  MISSING_KEY: 500,
  CANCELLED: 499, // client 已斷線（nginx 慣例碼）；實際上取消分支不寫回應，僅型別完整性
};

export const maxDuration = 200;

export default async function handler(req: GeminiStreamReq, res: GeminiStreamRes) {
  if (!(await applyGuards(req, res, [geminiPerMin, geminiPerDay]))) return;

  if (req.method !== 'POST') {
    res.status(405).json({
      code: 'BAD_REQUEST',
      message: '僅支援 POST 請求。',
    });
    return;
  }

  let hasWritten = false;
  const cancelRef: { cancel?: () => void } = {};
  req.on('close', () => cancelRef.cancel?.());

  try {
    const request = validateGeminiRequest(req.body);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    const result = await generateTextStream(
      request,
      (text) => {
        res.write(`${JSON.stringify({ t: 'delta', text })}\n`);
        hasWritten = true;
      },
      cancelRef,
    );

    res.write(`${JSON.stringify({ t: 'done', text: result.text })}\n`);
    hasWritten = true;
    res.end();
  } catch (error) {
    const classifiedError = error instanceof ClassifiedError
      ? error
      : classifyGeminiError(error);

    // 取消分類＝client 已斷線觸發（req 'close' → cancelRef.cancel）：靜默收尾——
    // 不對已斷線的 response 寫任何內容（error 行／status/json 都不寫），
    // 只 res.end() 讓 handler 的 async frame 確定結束（F-02/F-03 收口）。
    if (classifiedError.code === 'CANCELLED') {
      res.end();
      return;
    }

    console.error(
      `[gemini-stream:${classifiedError.code}] ${sanitizeErrorForLog(error)}`,
    );

    if (!hasWritten) {
      res.status(statusByCode[classifiedError.code]).json({
        code: classifiedError.code,
        message: classifiedError.message,
      });
      return;
    }

    res.write(`${JSON.stringify({
      t: 'error',
      code: classifiedError.code,
      message: classifiedError.message,
    })}\n`);
    res.end();
  }
}
