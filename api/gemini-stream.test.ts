// api/gemini-stream.test.ts — 串流端點取消收尾行為鎖（收口批次票 03）
//
// 本檔守什麼：generateTextStream 以取消分類（CANCELLED）reject 時，handler 必須
// 靜默收尾——不對已斷線的 response 寫任何內容（error 行／status/json 都不寫）、
// 不進錯誤 log，且 res.end 必被呼叫讓 async frame 確定結束（F-02/F-03 收口的呼叫端環節）。
// 對照組同時鎖住非取消錯誤的既有語意（已寫過→error 行＋end；未寫過→status+json）不漂移。
//
// 隔離手法：LLM 模組整支 mock（不碰真 CLI、不觸網）；ratelimit 模組 mock 成 null 限流器
// （等同未設 Upstash 的本機語意），guard 走真實邏輯（無 origin/secret → 放行）。
// ClassifiedError 從與 handler 同一份 http.js 模組實體 import，instanceof 判定才成立。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClassifiedError } from './_lib/http.js';
import handler from './gemini-stream.js';

const { llmMock } = vi.hoisted(() => ({
  llmMock: { generateTextStream: vi.fn() },
}));
vi.mock('./_lib/llm.js', () => llmMock);
// 只把兩個限流器換成 null（等同未設 Upstash 的本機語意），checkRateLimit 等其餘匯出照真跑
vi.mock('./_lib/ratelimit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib/ratelimit.js')>()),
  geminiPerMin: null,
  geminiPerDay: null,
}));

const VALID_BODY = {
  prompt: '測試用提示字串',
  systemInstruction: '測試用系統指令',
  mode: 'fast',
};

const makeReq = () => ({
  method: 'POST',
  headers: {} as Record<string, string | string[] | undefined>,
  body: { ...VALID_BODY },
  on: vi.fn(),
});

type MockRes = {
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
};

const makeRes = (): MockRes => {
  const res: Partial<MockRes> = {
    setHeader: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
    json: vi.fn(),
  };
  res.status = vi.fn(() => res);
  return res as MockRes;
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  llmMock.generateTextStream.mockReset();
  // 保證 guard 放行：無共享密鑰、無白名單需求（headers 也不帶 origin/referer）
  vi.stubEnv('PROXY_SHARED_SECRET', undefined);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe('gemini-stream handler — 取消分類的靜默收尾', () => {
  it('取消（尚未寫過任何內容）：零寫入、零 status/json、res.end 恰被呼叫一次、不進錯誤 log', async () => {
    llmMock.generateTextStream.mockRejectedValue(new ClassifiedError('CANCELLED'));
    const req = makeReq();
    const res = makeRes();

    await handler(req as any, res as any);

    expect(res.write).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('取消（已寫過 delta）：不再補寫 error 行、res.end 被呼叫、不進錯誤 log', async () => {
    llmMock.generateTextStream.mockImplementation(async (_req, onDelta) => {
      onDelta('第一段');
      throw new ClassifiedError('CANCELLED');
    });
    const req = makeReq();
    const res = makeRes();

    await handler(req as any, res as any);

    // 取消前的 delta 是正常串流輸出；取消後不得再有任何寫入
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.write.mock.calls[0][0] as string)).toEqual({ t: 'delta', text: '第一段' });
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('對照組：非取消錯誤且已寫過 → 照舊補寫 error 行＋end（既有語意不漂移）', async () => {
    llmMock.generateTextStream.mockImplementation(async (_req, onDelta) => {
      onDelta('第一段');
      throw new ClassifiedError('UPSTREAM_ERROR');
    });
    const req = makeReq();
    const res = makeRes();

    await handler(req as any, res as any);

    expect(res.write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(res.write.mock.calls[1][0] as string)).toMatchObject({
      t: 'error',
      code: 'UPSTREAM_ERROR',
    });
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('對照組：非取消錯誤且未寫過 → 照舊 status+json（既有語意不漂移）', async () => {
    llmMock.generateTextStream.mockRejectedValue(new ClassifiedError('UPSTREAM_ERROR'));
    const req = makeReq();
    const res = makeRes();

    await handler(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(res.write).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
