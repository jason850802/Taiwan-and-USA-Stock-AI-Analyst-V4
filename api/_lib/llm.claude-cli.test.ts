// api/_lib/llm.claude-cli.test.ts — strict 票 02：claude-cli spawn 路徑行為鎖
//
// 本檔守什麼：LLM_PROVIDER='claude-cli' 時，generateText／generateTextStream 兩個既有匯出
// 邊界底下的子程序行為——CLI 參數與環境隔離、prompt 走 stdin、非串流 JSON 解析、串流逐段
// 解析與 onDelta、spawn 同步／非同步失敗、執行檔快取清除、timeout、取消、stdio stream error。
//
// 這是「行為鎖」（CONTEXT.md 詞條）：照現行行為寫斷言，不評判對錯。翻出的可疑點一律進
// findings 交使用者裁決，不順手改產線碼。本檔零產線碼變更、零新增 export、零測試鉤子。
//
// 隔離手法（對應票面「不呼叫真實 CLI、不讀訂閱憑證、不觸網」）：
//   - `node:child_process` 的 spawn 整支 mock 掉，永遠不會有真的子程序被啟動。
//   - CLAUDE_CLI_PATH 指向本測試檔／llm.ts 這兩個「一定存在」的真實檔案，只為了讓探索邏輯
//     第一步的 existsSync 為真就直接回傳；它們永遠不會被執行。用兩個不同路徑，才驗得出
//     「快取被清掉之後確實重新探索」——否則同一個路徑看不出差別。
//   - 每個案例前 vi.resetModules() 拿一份乾淨模組，避免 module 級的執行檔快取跨案例汙染。
//   - 全檔假時鐘：timeout 是 45／100／180 秒，真時鐘會讓測試套件等到天荒地老。
import { EventEmitter } from 'node:events';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 只當型別用：loadLlm() 走 vi.resetModules()，llm.js 底下的 http.js 會是另一份模組實體，
// 其 ClassifiedError 與這裡靜態 import 到的不是同一個 class——所以斷言一律比 code／message，
// 不用 instanceof（那會因為模組身分不同而假紅）。
import type { ClassifiedError, GeminiRequest } from './http.js';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const EXE_A = fileURLToPath(import.meta.url);
const EXE_B = fileURLToPath(new URL('./llm.ts', import.meta.url));

const REQ: GeminiRequest = {
  prompt: '測試用提示字串',
  systemInstruction: '測試用系統指令',
  mode: 'fast',
};

/** 子程序的三條 stdio pipe：只實作產線碼真正用到的介面 */
class MockStdio extends EventEmitter {
  setEncoding = vi.fn();
  write = vi.fn();
  end = vi.fn();
}

class MockChild extends EventEmitter {
  stdin = new MockStdio();
  stdout = new MockStdio();
  stderr = new MockStdio();
  kill = vi.fn();
}

let children: MockChild[] = [];
const lastChild = (): MockChild => children[children.length - 1];

/** 取一份乾淨的 llm 模組（連同乾淨的執行檔快取） */
async function loadLlm() {
  vi.resetModules();
  return import('./llm.js');
}

/** 收斂狀態探針：用於「這個 Promise 到底有沒有 settle」這類斷言，不會讓測試卡住 */
function track(p: Promise<unknown>) {
  const state = { settled: null as null | 'resolved' | 'rejected', value: undefined as unknown };
  p.then(
    (v) => { state.settled = 'resolved'; state.value = v; },
    (e) => { state.settled = 'rejected'; state.value = e; },
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const child = new MockChild();
    children.push(child);
    return child;
  });

  // 紅線：全程不設真金鑰、不留宿主 Claude 會話變數的殘值（各案例要用時自行 stub）
  vi.stubEnv('GEMINI_API_KEY', undefined);
  vi.stubEnv('LLM_PROVIDER', 'claude-cli');
  vi.stubEnv('CLAUDE_CLI_PATH', EXE_A);
  vi.stubEnv('CLAUDE_CLI_MODEL_FAST', undefined);
  vi.stubEnv('CLAUDE_CLI_MODEL_THINKING', undefined);
  vi.stubEnv('CLAUDE_CLI_EFFORT_FAST', undefined);
  vi.stubEnv('CLAUDE_CLI_EFFORT_THINKING', undefined);
});

afterEach(() => {
  // 有些案例刻意只檢查啟動契約、不讓 Promise 收斂，會留下 45／100／180 秒的待觸發計時器。
  // 不清掉的話，下一個推進時鐘的案例會把它們一起觸發，變成別人身上的未捕捉拒絕。
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 非串流路徑
// ---------------------------------------------------------------------------

describe('generateText / claude-cli — 子程序啟動契約', () => {
  it('spawn 完整執行檔路徑，argv 逐項為現行順序，且 prompt 不進 argv', async () => {
    const { generateText } = await loadLlm();
    void generateText(REQ).catch(() => {});

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [exe, args] = spawnMock.mock.calls[0];
    expect(exe).toBe(EXE_A);
    expect(args).toEqual([
      '-p',
      '--output-format', 'json',
      '--tools', '',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--model', 'sonnet',
      '--effort', 'medium',
      '--system-prompt', '測試用系統指令',
    ]);
    // 提示字串只走 stdin：argv 裡不得出現（避免進 process 列表／歷史紀錄）
    expect((args as string[]).some((a) => a.includes('測試用提示字串'))).toBe(false);
  });

  it('子程序 cwd 為系統暫存目錄、windowsHide 開啟——避免載入專案 hooks/CLAUDE.md/skills', async () => {
    const { generateText } = await loadLlm();
    void generateText(REQ).catch(() => {});

    const opts = spawnMock.mock.calls[0][2] as { cwd: string; windowsHide: boolean };
    expect(opts.cwd).toBe(os.tmpdir());
    expect(opts.windowsHide).toBe(true);
  });

  it('環境隔離：剔除宿主閘道與 API 金鑰／token 與所有 CLAUDE_CODE_* 旗標', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://宿主閘道');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-不該被繼承');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-不該被繼承');
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('PATH_KEEP_ME', '保留');

    const { generateText } = await loadLlm();
    void generateText(REQ).catch(() => {});

    const env = (spawnMock.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(Object.keys(env).some((k) => k.startsWith('CLAUDE_CODE_'))).toBe(false);
    // 其餘環境變數照常繼承（淺拷貝，不是白名單）
    expect(env.PATH_KEEP_ME).toBe('保留');
  });

  it('mode=thinking → opus/max；mode=fast → sonnet/medium', async () => {
    const { generateText } = await loadLlm();
    void generateText({ ...REQ, mode: 'thinking' }).catch(() => {});
    const thinkingArgs = spawnMock.mock.calls[0][1] as string[];
    expect(thinkingArgs[thinkingArgs.indexOf('--model') + 1]).toBe('opus');
    expect(thinkingArgs[thinkingArgs.indexOf('--effort') + 1]).toBe('max');

    void generateText({ ...REQ, mode: 'fast' }).catch(() => {});
    const fastArgs = spawnMock.mock.calls[1][1] as string[];
    expect(fastArgs[fastArgs.indexOf('--model') + 1]).toBe('sonnet');
    expect(fastArgs[fastArgs.indexOf('--effort') + 1]).toBe('medium');
  });

  it('env 可覆寫模型與 effort，且空白值 trim 後視同未設', async () => {
    vi.stubEnv('CLAUDE_CLI_MODEL_FAST', 'haiku');
    vi.stubEnv('CLAUDE_CLI_EFFORT_FAST', '   ');
    const { generateText } = await loadLlm();
    void generateText(REQ).catch(() => {});

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
  });

  it('prompt 立即寫入 stdin 並關閉（CLI 對 piped stdin 三秒無資料會發警告）', async () => {
    const { generateText } = await loadLlm();
    void generateText(REQ).catch(() => {});

    const child = lastChild();
    expect(child.stdin.write).toHaveBeenCalledWith('測試用提示字串');
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(child.stderr.setEncoding).toHaveBeenCalledWith('utf8');
  });
});

describe('generateText / claude-cli — 輸出解析與錯誤分類', () => {
  it('正常 result JSON → 解出 text', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ type: 'result', result: '一段中文分析' }));
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '一段中文分析' });
  });

  it('多段 stdout 會先累積再一次解析', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    const child = lastChild();
    child.stdout.emit('data', '{"type":"result",');
    child.stdout.emit('data', '"result":"分段送達"}');
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: '分段送達' });
  });

  it('exit code 非 0 但 stdout 有合法 result JSON → 以 JSON 為準（先 parse 再看 exit code）', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ type: 'result', result: '非零退出仍有結果' }));
    lastChild().emit('close', 1);
    await expect(p).resolves.toEqual({ text: '非零退出仍有結果' });
  });

  it('result 欄位缺漏 → 收斂成空字串而非丟錯', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ type: 'result' }));
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '' });
  });

  it('stdout 全空 → UPSTREAM_ERROR，訊息帶 stderr 內容', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stderr.emit('data', 'CLI 啟動失敗細節');
    lastChild().emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 無輸出：CLI 啟動失敗細節',
    });
  });

  it('stdout 全空且 stderr 也空 → 訊息用 "(stderr 空)" 佔位', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 無輸出：(stderr 空)',
    });
  });

  it('stdout 非 JSON → 輸出無法解析，訊息優先帶 stderr', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', '這不是 JSON');
    lastChild().stderr.emit('data', 'stderr 有話說');
    lastChild().emit('close', 0);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 輸出無法解析：stderr 有話說',
    });
  });

  it('stdout 非 JSON 且 stderr 空 → 訊息退而帶原始 stdout', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', '這不是 JSON');
    lastChild().emit('close', 0);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 輸出無法解析：這不是 JSON',
    });
  });

  it('is_error 且內容含 "Not logged in" → 升級成 MISSING_KEY 並給登入指引', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ is_error: true, result: 'Error: Not logged in' }));
    lastChild().emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'MISSING_KEY',
      message: '本機 Claude CLI 未登入：請在終端跑 claude /login（或 claude setup-token）後重試；或暫時移除 LLM_PROVIDER 改走 gemini-api。',
    });
  });

  it('is_error 但不是未登入 → UPSTREAM_ERROR，帶 CLI 回報內容', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ is_error: true, result: '額度用盡' }));
    lastChild().emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 回報錯誤：額度用盡',
    });
  });

  it('錯誤訊息超過 200 字會被截斷並補刪節號', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    const long = '長'.repeat(300);
    lastChild().stdout.emit('data', JSON.stringify({ is_error: true, result: long }));
    lastChild().emit('close', 1);
    const err = await p.catch((e: ClassifiedError) => e);
    expect((err as ClassifiedError).message).toBe(`claude CLI 回報錯誤：${'長'.repeat(200)}…`);
  });
});

// ---------------------------------------------------------------------------
// 串流路徑
// ---------------------------------------------------------------------------

describe('generateTextStream / claude-cli — 串流參數與逐段解析', () => {
  it('串流 argv 走 stream-json 並要求 partial messages 與 verbose', async () => {
    const { generateTextStream } = await loadLlm();
    void generateTextStream(REQ, vi.fn(), {}).catch(() => {});

    expect(spawnMock.mock.calls[0][1]).toEqual([
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--tools', '',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--model', 'sonnet',
      '--effort', 'medium',
      '--system-prompt', '測試用系統指令',
    ]);
  });

  it('content_block_delta 依序觸發 onDelta，最終 result 收斂', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const child = lastChild();

    const delta = (text: string) => JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text } },
    });
    child.stdout.emit('data', `${delta('第一段')}\n${delta('第二段')}\n`);
    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: '完整結果' })}\n`);
    child.emit('close', 0);

    await expect(p).resolves.toEqual({ text: '完整結果' });
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['第一段', '第二段']);
  });

  it('跨 chunk 切斷的一行會被接回來，不會漏段也不會重複', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const child = lastChild();

    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: '被切斷的段落' } },
    });
    child.stdout.emit('data', line.slice(0, 30));
    child.stdout.emit('data', `${line.slice(30)}\n`);
    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: 'ok' })}\n`);
    child.emit('close', 0);

    await expect(p).resolves.toEqual({ text: 'ok' });
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(['被切斷的段落']);
  });

  it('尾端沒有換行的殘留 buffer 在 close 時才被解析——result 靠這條才收得到', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    const child = lastChild();
    // 刻意不帶結尾換行：這一行會留在 buffer，直到 close 才處理
    child.stdout.emit('data', JSON.stringify({ type: 'result', result: '尾端無換行' }));
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: '尾端無換行' });
  });

  it('無法解析的行被靜默略過，不影響後續解析', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const child = lastChild();
    child.stdout.emit('data', '這行不是 JSON\n\n');
    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: '照樣收斂' })}\n`);
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: '照樣收斂' });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('delta.text 不是字串就不觸發 onDelta', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const child = lastChild();
    child.stdout.emit('data', `${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: 123 } },
    })}\n`);
    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: 'ok' })}\n`);
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: 'ok' });
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('從頭到尾沒有 result event → 串流無 result，訊息優先帶 stderr', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    const child = lastChild();
    child.stderr.emit('data', 'CLI 中途死掉');
    child.emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 串流無 result：CLI 中途死掉',
    });
  });

  it('沒有 result 且 stderr 空時，訊息退而帶已串流出的文字', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    const child = lastChild();
    child.stdout.emit('data', `${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: '只串到一半' } },
    })}\n`);
    child.emit('close', 1);
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'claude CLI 串流無 result：只串到一半',
    });
  });

  it('串流的 is_error 走與非串流相同的分類（未登入 → MISSING_KEY）', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    lastChild().stdout.emit('data', `${JSON.stringify({
      type: 'result', is_error: true, result: 'Not logged in',
    })}\n`);
    lastChild().emit('close', 1);
    await expect(p).rejects.toMatchObject({ code: 'MISSING_KEY' });
  });
});

// ---------------------------------------------------------------------------
// spawn 失敗（同步 throw ／ 非同步 error）與執行檔快取
// ---------------------------------------------------------------------------

describe('claude-cli — spawn 失敗與執行檔快取清除', () => {
  it('同步 throw（Windows 的 ERROR_BAD_EXE_FORMAT 等）→ UPSTREAM_ERROR，訊息帶原因', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('spawn EFTYPE'); });
    const { generateText } = await loadLlm();
    await expect(generateText(REQ)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: '無法啟動 claude CLI：spawn EFTYPE',
    });
  });

  it('非同步 error 事件 → 同一條分類與訊息', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().emit('error', new Error('spawn ENOENT'));
    await expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: '無法啟動 claude CLI：spawn ENOENT',
    });
  });

  it('同步 throw 會清掉執行檔快取——下一次請求重新探索到新路徑', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('spawn EACCES'); });
    const { generateText } = await loadLlm();
    await expect(generateText(REQ)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    // 快取若沒被清掉，這裡會續用 EXE_A
    vi.stubEnv('CLAUDE_CLI_PATH', EXE_B);
    void generateText(REQ).catch(() => {});
    expect(spawnMock.mock.calls[1][0]).toBe(EXE_B);
  });

  it('非同步 error 同樣清掉快取', async () => {
    const { generateText } = await loadLlm();
    const first = generateText(REQ);
    lastChild().emit('error', new Error('spawn ENOENT'));
    await expect(first).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });

    vi.stubEnv('CLAUDE_CLI_PATH', EXE_B);
    void generateText(REQ).catch(() => {});
    expect(spawnMock.mock.calls[1][0]).toBe(EXE_B);
  });

  it('成功路徑不清快取——同一 process 內第二次請求沿用既有探索結果', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ result: '第一次' }));
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '第一次' });

    // 環境變數改了也不影響：快取還在，不會重新探索
    vi.stubEnv('CLAUDE_CLI_PATH', EXE_B);
    void generateText(REQ).catch(() => {});
    expect(spawnMock.mock.calls[1][0]).toBe(EXE_A);
  });

  it('串流路徑的 spawn 失敗走同一條分類', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('spawn EFTYPE'); });
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    await expect(generateTextStream(REQ, onDelta, {})).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: '無法啟動 claude CLI：spawn EFTYPE',
    });
    expect(onDelta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// stdio stream error
// ---------------------------------------------------------------------------

describe('claude-cli — stdio stream error 被接住', () => {
  it('三條 pipe 各自 emit error 都不形成未捕捉例外，結果仍由 close 收斂', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    const child = lastChild();

    // 無監聽器的 stream error 會以未捕捉例外打死整個 vercel dev 行程；產線碼掛了空監聽
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(() => child.stdout.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(() => child.stderr.emit('error', new Error('EPIPE'))).not.toThrow();

    // stream error 本身不收斂結果——仍由 close 決定
    child.stdout.emit('data', JSON.stringify({ result: 'stream error 之後照樣收斂' }));
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: 'stream error 之後照樣收斂' });
  });

  it('串流路徑的三條 pipe 同樣接住', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    const child = lastChild();
    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(() => child.stdout.emit('error', new Error('EPIPE'))).not.toThrow();
    expect(() => child.stderr.emit('error', new Error('EPIPE'))).not.toThrow();

    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: 'ok' })}\n`);
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: 'ok' });
  });

  it('stdin.write 同步拋錯（spawn 失敗後 stdin 已 destroyed）被攔下，結果由 close 收斂', async () => {
    const { generateText } = await loadLlm();
    spawnMock.mockImplementationOnce(() => {
      const child = new MockChild();
      child.stdin.write = vi.fn(() => { throw new Error('write after end'); });
      children.push(child);
      return child;
    });
    const p = generateText(REQ);
    // 沒有因為 write 拋錯而炸掉，也沒有提前收斂
    lastChild().stdout.emit('data', JSON.stringify({ result: '照常收斂' }));
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '照常收斂' });
  });
});

// ---------------------------------------------------------------------------
// timeout
// ---------------------------------------------------------------------------

describe('claude-cli — timeout 收斂', () => {
  it('非串流 100 秒逾時 → 殺子程序、以預設 UPSTREAM_ERROR 訊息拒絕', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    // 拒絕的斷言要在推進時鐘「之前」掛好：推進時鐘會同步觸發 reject，
    // 事後才 await 等於慢一個 microtask turn，Node 會先判定成未捕捉拒絕。
    const rejected = expect(p).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'AI 服務暫時無法回應，請稍後再試。',
    });
    const child = lastChild();

    await vi.advanceTimersByTimeAsync(99_999);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await rejected;
  });

  it('逾時後才到的 close 不會造成第二次收斂', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    const state = track(p);
    p.catch(() => {});

    await vi.advanceTimersByTimeAsync(100_000);
    expect(state.settled).toBe('rejected');

    // 遲到的成功輸出不得翻案
    lastChild().stdout.emit('data', JSON.stringify({ result: '遲到的結果' }));
    lastChild().emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe('rejected');
    expect((state.value as ClassifiedError).code).toBe('UPSTREAM_ERROR');
  });

  it('正常收斂會清掉逾時計時器——事後推進時鐘不會再殺子程序', async () => {
    const { generateText } = await loadLlm();
    const p = generateText(REQ);
    lastChild().stdout.emit('data', JSON.stringify({ result: '準時完成' }));
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '準時完成' });

    await vi.advanceTimersByTimeAsync(200_000);
    expect(lastChild().kill).not.toHaveBeenCalled();
  });

  it('串流首塊 45 秒未到 → 殺子程序並拒絕', async () => {
    const { generateTextStream } = await loadLlm();
    const p = generateTextStream(REQ, vi.fn(), {});
    const rejected = expect(p).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    const child = lastChild();

    await vi.advanceTimersByTimeAsync(44_999);
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await rejected;
  });

  it('收到第一段增量就解除首塊逾時——之後撐過 45 秒也不會被殺', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const child = lastChild();

    child.stdout.emit('data', `${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: '首段' } },
    })}\n`);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalledWith('首段');

    child.stdout.emit('data', `${JSON.stringify({ type: 'result', result: '慢慢跑完' })}\n`);
    child.emit('close', 0);
    await expect(p).resolves.toEqual({ text: '慢慢跑完' });
  });

  it('串流總逾時 180 秒——即使一路有增量也會被砍', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const p = generateTextStream(REQ, onDelta, {});
    const rejected = expect(p).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    const child = lastChild();

    // 每 30 秒來一段，持續解除首塊逾時，但總逾時不受影響
    for (let i = 0; i < 5; i++) {
      child.stdout.emit('data', `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { text: `第${i}段` } },
      })}\n`);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(child.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await rejected;
    expect(onDelta).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

describe('claude-cli — 取消收斂', () => {
  it('cancel 在 spawn 成功後才掛上 cancelRef', async () => {
    const { generateTextStream } = await loadLlm();

    const streamRef: { cancel?: () => void } = {};
    expect(streamRef.cancel).toBeUndefined();
    void generateTextStream(REQ, vi.fn(), streamRef).catch(() => {});
    expect(typeof streamRef.cancel).toBe('function');
  });

  it('spawn 同步失敗時 cancelRef 不會被掛上——呼叫端拿不到殘廢的 cancel', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('spawn EFTYPE'); });
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    await expect(generateTextStream(REQ, vi.fn(), cancelRef)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(cancelRef.cancel).toBeUndefined();
  });

  it('cancel 會殺子程序並清掉兩個計時器', async () => {
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    void generateTextStream(REQ, vi.fn(), cancelRef).catch(() => {});
    const child = lastChild();

    cancelRef.cancel!();
    expect(child.kill).toHaveBeenCalledTimes(1);

    // 計時器已清：撐過總逾時也不會再殺第二次
    await vi.advanceTimersByTimeAsync(200_000);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('取消後 Promise 立即以 CANCELLED 分類 reject，遲到 close 不改變結果（F-03 收口）', async () => {
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    const p = generateTextStream(REQ, vi.fn(), cancelRef);
    const state = track(p);
    p.catch(() => {});

    cancelRef.cancel!();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe('rejected');
    expect((state.value as ClassifiedError).code).toBe('CANCELLED');

    // 取消後推進時鐘＋遲到的 close 都不造成二次收斂、不改變分類
    await vi.advanceTimersByTimeAsync(200_000);
    lastChild().emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe('rejected');
    expect((state.value as ClassifiedError).code).toBe('CANCELLED');
  });

  it('取消後遲到的 result 不會造成第二次收斂——維持 CANCELLED、不得翻案成 resolved', async () => {
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    const p = generateTextStream(REQ, vi.fn(), cancelRef);
    const state = track(p);
    p.catch(() => {});

    cancelRef.cancel!();
    lastChild().stdout.emit('data', `${JSON.stringify({ type: 'result', result: '遲到' })}\n`);
    lastChild().emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe('rejected');
    expect((state.value as ClassifiedError).code).toBe('CANCELLED');
  });

  it('取消後遲到的增量不再觸發 onDelta（F-02 收口）', async () => {
    const { generateTextStream } = await loadLlm();
    const onDelta = vi.fn();
    const cancelRef: { cancel?: () => void } = {};
    const p = generateTextStream(REQ, onDelta, cancelRef);
    p.catch(() => {});

    cancelRef.cancel!();
    lastChild().stdout.emit('data', `${JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { text: '取消後才到的段落' } },
    })}\n`);

    // 取消已收斂：解析路徑檢查 settled，遲到增量靜默丟棄
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('取消後子程序 error 後到不再二次收斂——維持 CANCELLED 分類', async () => {
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    const p = generateTextStream(REQ, vi.fn(), cancelRef);
    const state = track(p);
    p.catch(() => {});

    cancelRef.cancel!();
    lastChild().emit('error', new Error('kill 之後的非同步 spawn error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe('rejected');
    expect((state.value as ClassifiedError).code).toBe('CANCELLED');
  });

  it('已收斂之後再呼叫 cancel 不會殺到子程序', async () => {
    const { generateTextStream } = await loadLlm();
    const cancelRef: { cancel?: () => void } = {};
    const p = generateTextStream(REQ, vi.fn(), cancelRef);
    lastChild().stdout.emit('data', `${JSON.stringify({ type: 'result', result: '早就好了' })}\n`);
    lastChild().emit('close', 0);
    await expect(p).resolves.toEqual({ text: '早就好了' });

    cancelRef.cancel!();
    expect(lastChild().kill).not.toHaveBeenCalled();
  });
});
