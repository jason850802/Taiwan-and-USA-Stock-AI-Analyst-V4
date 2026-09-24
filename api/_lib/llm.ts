import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getGeminiApiKey, getModelForMode } from './config.js';
import {
  ClassifiedError,
  callGeminiWithTimeout,
  sanitizeErrorForLog,
  type GeminiRequest,
} from './http.js';

const CLAUDE_CLI_TIMEOUT_MS = 100_000;
// 串流總上限 300 秒（2026-08-13 由 180 秒調高，使用者拍板）。依據：庫存健檢實測
// 單檔 88～131 秒、三檔批次 176 秒——180 秒只剩約 4 秒餘裕，真實庫存（20 檔以上）
// 必撞穿。300 秒與 Vercel 函式的預設上限一致，部署環境同樣站得住。
const CLAUDE_CLI_STREAM_TIMEOUT_MS = 300_000;
// 首塊上限只用來偵測「CLI 卡死」：任何串流增量（含 thinking_delta）都算存活證明，
// 判定放寬處見 generateTextStream 的 parseLine。
const CLAUDE_CLI_FIRST_CHUNK_TIMEOUT_MS = 45_000;

/**
 * LLM provider adapter：依 LLM_PROVIDER 環境變數分流。
 * - 未設或 'gemini-api'：既有 Gemini API 路徑（部署環境永遠走這條，行為與原 handler 相同）。
 * - 'claude-cli'：橋接本機 Claude Code CLI（吃 Claude 訂閱，僅本機 vercel dev 用）。
 * - 其他值：明確設定錯誤，不靜默 fallback。
 */
export async function generateText(req: GeminiRequest, signal?: AbortSignal): Promise<{ text: string }> {
  const provider = (process.env.LLM_PROVIDER ?? '').trim();

  switch (provider) {
    case '':
    case 'gemini-api':
      return callGeminiApiProvider(req, signal);
    case 'claude-cli':
      return callClaudeCli(req, signal);
    // 未來擴充點（僅註記，不實作）：
    // case 'codex-cli':   // OpenAI Codex CLI 橋接
    // case 'gemini-cli':  // Google Gemini CLI 橋接
    default:
      throw new ClassifiedError(
        'MISSING_KEY',
        'LLM_PROVIDER 設定值無效（支援 gemini-api、claude-cli），請修正環境變數。',
      );
  }
}

export async function generateTextStream(
  req: GeminiRequest,
  onDelta: (text: string) => void,
  cancelRef: { cancel?: () => void },
): Promise<{ text: string }> {
  const provider = (process.env.LLM_PROVIDER ?? '').trim();

  switch (provider) {
    case '':
    case 'gemini-api':
      {
        const controller = new AbortController();
        cancelRef.cancel = () => controller.abort();
        return callGeminiApiProvider(req, controller.signal).finally(() => {
          cancelRef.cancel = undefined;
        });
      }
    case 'claude-cli':
      return callClaudeCliStream(req, onDelta, cancelRef);
    default:
      throw new ClassifiedError(
        'MISSING_KEY',
        'LLM_PROVIDER 設定值無效（支援 gemini-api、claude-cli），請修正環境變數。',
      );
  }
}

/**
 * 預設分支：既有 Gemini API 路徑，自 api/gemini.ts handler 原樣搬移。
 * GEMINI_API_KEY 邏輯零觸碰（紅線）。
 */
async function callGeminiApiProvider(req: GeminiRequest, signal?: AbortSignal): Promise<{ text: string }> {
  const { prompt, systemInstruction, mode, temperature, thinkingConfig } = req;
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    // errorMessages['MISSING_KEY'] 預設訊息與原 handler 硬編字串逐字相同
    throw new ClassifiedError('MISSING_KEY');
  }

  const model = getModelForMode(mode);
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const config = {
    systemInstruction,
    temperature: temperature ?? 0.1,
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  return callGeminiWithTimeout({ apiKey, model, contents, config, signal });
}

// ---------------------------------------------------------------------------
// claude-cli 橋接
// ---------------------------------------------------------------------------

/** 執行檔探索結果快取（module 級，同一 process 只探索一次） */
let cachedClaudeCliPath: string | null = null;

/**
 * 探索 claude 執行檔，優先序：
 * 1. CLAUDE_CLI_PATH 環境變數（存在且檔案存在）
 * 2. 掃 PATH 各目錄找 claude.exe（win32）／claude（非 win32）——刻意跳過 .cmd shim
 *    （Node spawn 不經 shell 無法執行 .cmd；shell:true 是引號地獄，禁用）
 * 3. 掃 %APPDATA%\Claude\claude-code 版本目錄，取最高版本內的 claude.exe
 */
function findClaudeExecutable(): string {
  if (cachedClaudeCliPath) return cachedClaudeCliPath;

  // (a) 顯式指定
  const explicit = (process.env.CLAUDE_CLI_PATH ?? '').trim();
  if (explicit && fs.existsSync(explicit)) {
    cachedClaudeCliPath = explicit;
    return explicit;
  }

  const exeName = process.platform === 'win32' ? 'claude.exe' : 'claude';

  // (b) 掃 PATH（只找原生執行檔，不收 .cmd）
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    try {
      const candidate = path.join(dir, exeName);
      if (fs.existsSync(candidate)) {
        cachedClaudeCliPath = candidate;
        return candidate;
      }
    } catch {
      // 個別目錄不可讀就跳過
    }
  }

  // (c) 掃 %APPDATA%\Claude\claude-code\<version>\claude.exe，取最高版本
  //     版本目錄隨 app 更新變動，不可硬編
  const appDataRoot = path.join(process.env.APPDATA ?? '', 'Claude', 'claude-code');
  try {
    if (process.env.APPDATA && fs.existsSync(appDataRoot)) {
      const versionDirs = fs
        .readdirSync(appDataRoot)
        .filter((name) => /^\d+(\.\d+)*$/.test(name))
        .filter((name) => fs.existsSync(path.join(appDataRoot, name, 'claude.exe')))
        .sort(compareVersionDesc);

      if (versionDirs.length > 0) {
        const found = path.join(appDataRoot, versionDirs[0], 'claude.exe');
        cachedClaudeCliPath = found;
        return found;
      }
    }
  } catch {
    // 探索失敗視同未找到
  }

  throw new ClassifiedError(
    'MISSING_KEY',
    '找不到 claude 執行檔：請設 CLAUDE_CLI_PATH 指向 claude.exe，或暫時移除 LLM_PROVIDER 改走 gemini-api。',
  );
}

/** 版本段逐位數值比較（遞減排序用），如 2.1.205 > 2.1.30 */
function compareVersionDesc(a: string, b: string): number {
  const as = a.split('.').map(Number);
  const bs = b.split('.').map(Number);
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const diff = (bs[i] ?? 0) - (as[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 模式對應 CLI model 別名；env 可覆寫 */
function getClaudeCliModel(mode: GeminiRequest['mode']): string {
  if (mode === 'thinking') {
    return (process.env.CLAUDE_CLI_MODEL_THINKING ?? '').trim() || 'opus';
  }
  return (process.env.CLAUDE_CLI_MODEL_FAST ?? '').trim() || 'sonnet';
}

/** 模式對應 CLI effort；env 可覆寫 */
function getClaudeCliEffort(mode: GeminiRequest['mode']): string {
  if (mode === 'thinking') {
    return (process.env.CLAUDE_CLI_EFFORT_THINKING ?? '').trim() || 'max';
  }
  return (process.env.CLAUDE_CLI_EFFORT_FAST ?? '').trim() || 'medium';
}

/**
 * CLI 認證失敗的特徵字串。除了「從未登入」，訂閱 OAuth 的 refresh token 也會到期
 * （實測約 4 週），過期後 CLI 回 "Failed to authenticate: OAuth session expired and
 * could not be refreshed"——同樣只能靠使用者重跑一次登入，不該落入 generic 上游錯誤。
 */
const CLAUDE_CLI_AUTH_FAILURE_MARKERS = [
  'Not logged in',
  'OAuth session expired',
  'Failed to authenticate',
];

/** is_error 內容屬於「要使用者重新登入」時回對應分類錯誤，否則回 null */
function claudeCliAuthError(resultText: string): ClassifiedError | null {
  const isAuthFailure = CLAUDE_CLI_AUTH_FAILURE_MARKERS.some(
    (marker) => resultText.includes(marker),
  );
  if (!isAuthFailure) return null;

  return new ClassifiedError(
    'MISSING_KEY',
    '本機 Claude CLI 未登入或登入已過期：請在終端跑 claude /login（或 claude setup-token）後重試；或暫時移除 LLM_PROVIDER 改走 gemini-api。',
  );
}

/**
 * 建立子程序環境：process.env 淺拷貝後剔除宿主 Claude Code 會話變數，
 * 避免從 Claude Code 會話啟動的 vercel dev 讓子 CLI 繼承宿主閘道／遞迴旗標。
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  // 訂閱紅線：宿主環境若殘留 API 金鑰/token，CLI 會優先改走 API 直接計費而非訂閱 OAuth——
  // 呼叫仍成功、回應正確，但計費對象悄悄改變且無任何徵兆，必須一併清除
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_CODE_')) {
      delete env[key];
    }
  }
  return env;
}

/**
 * 橋接本機 Claude Code CLI。
 * - spawn 完整執行檔路徑（不經 shell），prompt 走 stdin（不進 argv）。
 * - temperature/thinkingConfig 在此路徑靜默丟棄（CLI 不支援）。
 * - 100s 逾時＋settled 旗標：任何出口（close/error/timeout）不遺留子程序、不重複 settle。
 * - 紅線：禁用任何「跳過 OAuth 讀取」的 CLI 旗標，一律走已登入的訂閱憑證。
 */
function callClaudeCli(req: GeminiRequest, signal?: AbortSignal): Promise<{ text: string }> {
  signal?.throwIfAborted();
  const exePath = findClaudeExecutable();
  const model = getClaudeCliModel(req.mode);
  const effort = getClaudeCliEffort(req.mode);

  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--model', model,
    '--effort', effort,
    '--system-prompt', req.systemInstruction,
  ];

  return new Promise<{ text: string }>((resolve, reject) => {
    let settled = false;
    let onAbort: (() => void) | undefined;
    let stdout = '';
    let stderr = '';

    // Windows 對部分 spawn 失敗（如非 PE 執行檔 → ERROR_BAD_EXE_FORMAT）是同步 throw 而非 'error' 事件，
    // 必須 try/catch 讓同步/非同步失敗走同一條分類與快取清除路徑。
    // 型別標成 ChildProcessWithoutNullStreams（不用 ReturnType<typeof spawn>，那會取到最寬的
    // overload 使三條 stdio 變 nullable）：下面的 spawn 未指定 stdio，依 Node 契約三條 pipe 必然存在。
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(exePath, args, {
        cwd: os.tmpdir(), // 避免載入專案 hooks/CLAUDE.md/skills
        env: buildChildEnv(),
        windowsHide: true,
      });
    } catch (err) {
      cachedClaudeCliPath = null; // 探索快取可能已 stale——下一次請求重新探索
      reject(new ClassifiedError(
        'UPSTREAM_ERROR',
        `無法啟動 claude CLI：${truncateForMessage(sanitizeErrorForLog(err))}`,
      ));
      return;
    }

    // spawn 失敗（TOCTOU／EACCES／app 更新移除舊版本目錄）時各 stdio pipe 會獨立 emit 'error'；
    // 無監聽器的 stream error 會以未捕捉例外打死整個 vercel dev 行程——一律接住，
    // 結果收斂統一由 child 的 'error'/'close' 事件負責
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      child.kill();
      reject(new ClassifiedError(
        'UPSTREAM_ERROR',
        truncateForMessage(sanitizeErrorForLog(
          `claude CLI 逾時 ${CLAUDE_CLI_TIMEOUT_MS / 1000} 秒（stdout ${stdout.length} 字、stderr ${stderr.length} 字）`,
        )),
      ));
    }, CLAUDE_CLI_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      fn();
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (err) => {
      // 探索快取可能已 stale（如 app 更新後舊版本目錄被移除）——清空讓下一次請求重新探索
      cachedClaudeCliPath = null;
      settle(() => {
        reject(new ClassifiedError(
          'UPSTREAM_ERROR',
          `無法啟動 claude CLI：${truncateForMessage(sanitizeErrorForLog(err))}`,
        ));
      });
    });

    // CLI 對 piped stdin 3 秒無資料會發警告——spawn 後立即寫入避開；
    // spawn 失敗時 stdin 可能已 destroyed，同步拋錯在此攔下（結果由 'error'/'close' 收斂）
    try {
      child.stdin.write(req.prompt);
      child.stdin.end();
    } catch { /* 由 child 'error'/'close' 事件收斂結果 */ }

    child.on('close', () => {
      settle(() => {
        // exit code 非 0 但 stdout 有合法 result JSON → 以 JSON 為準（先 parse 再看 exit code）
        const raw = stdout.trim();
        if (!raw) {
          reject(new ClassifiedError(
            'UPSTREAM_ERROR',
            `claude CLI 無輸出：${truncateForMessage(sanitizeErrorForLog(stderr || '(stderr 空)'))}`,
          ));
          return;
        }

        let json: { type?: string; subtype?: string; is_error?: boolean; result?: unknown };
        try {
          json = JSON.parse(raw);
        } catch {
          reject(new ClassifiedError(
            'UPSTREAM_ERROR',
            `claude CLI 輸出無法解析：${truncateForMessage(sanitizeErrorForLog(stderr || raw))}`,
          ));
          return;
        }

        if (json.is_error === true) {
          const resultText = String(json.result ?? '');
          const authError = claudeCliAuthError(resultText);
          if (authError) {
            reject(authError);
            return;
          }
          reject(new ClassifiedError(
            'UPSTREAM_ERROR',
            `claude CLI 回報錯誤：${truncateForMessage(sanitizeErrorForLog(resultText))}`,
          ));
          return;
        }

        resolve({ text: String(json.result ?? '') });
      });
    });
    onAbort = () => {
      settle(() => {
        child.kill();
        reject(new ClassifiedError('CANCELLED'));
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function callClaudeCliStream(
  req: GeminiRequest,
  onDelta: (text: string) => void,
  cancelRef: { cancel?: () => void },
): Promise<{ text: string }> {
  const exePath = findClaudeExecutable();
  const model = getClaudeCliModel(req.mode);
  const effort = getClaudeCliEffort(req.mode);

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools', '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--model', model,
    '--effort', effort,
    '--system-prompt', req.systemInstruction,
  ];

  return new Promise<{ text: string }>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let streamedText = '';
    let stderr = '';
    let streamDeltaCount = 0;
    let resultEvent: {
      type?: string;
      subtype?: string;
      is_error?: boolean;
      result?: unknown;
    } | null = null;

    // Windows 對部分 spawn 失敗（如非 PE 執行檔 → ERROR_BAD_EXE_FORMAT）是同步 throw 而非 'error' 事件，
    // 必須 try/catch 讓同步/非同步失敗走同一條分類與快取清除路徑。
    // 型別同非串流路徑：未指定 stdio 的 spawn 依契約三條 pipe 必然存在（見 callClaudeCli 註解）。
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(exePath, args, {
        cwd: os.tmpdir(), // 避免載入專案 hooks/CLAUDE.md/skills
        env: buildChildEnv(),
        windowsHide: true,
      });
    } catch (err) {
      cachedClaudeCliPath = null; // 探索快取可能已 stale——下一次請求重新探索
      reject(new ClassifiedError(
        'UPSTREAM_ERROR',
        `無法啟動 claude CLI：${truncateForMessage(sanitizeErrorForLog(err))}`,
      ));
      return;
    }

    // spawn 失敗時三條 stdio pipe 可能各自 emit 'error'；空監聽避免未捕捉例外打死 vercel dev。
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const totalTimeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(firstChunkTimeoutId);
      child.kill();
      reject(new ClassifiedError(
        'UPSTREAM_ERROR',
        // 增量數與文字字數要一起印：只看「已產出文字 0 字」分不出「上游卡死」與
        // 「一路在思考但沒吐字」——後者的增量數會很大，這正是 2026-08-13 那次
        // 診斷繞遠路的關鍵資訊。
        truncateForMessage(sanitizeErrorForLog(
          `claude CLI 串流總逾時 ${CLAUDE_CLI_STREAM_TIMEOUT_MS / 1000} 秒`
          + `（串流增量 ${streamDeltaCount} 個、已產出文字 ${streamedText.length} 字）`,
        )),
      ));
    }, CLAUDE_CLI_STREAM_TIMEOUT_MS);

    const firstChunkTimeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeoutId);
      child.kill();
      reject(new ClassifiedError(
        'UPSTREAM_ERROR',
        // 這裡的增量數在現行語意下恆為 0（任何增量都會先清掉本計時器），看似冗贅——
        // 但它是絆線：哪天有人把 parseLine 的閘門改回只認文字增量，這個數字就會變成
        // 非 0，一眼揭穿「CLI 明明有動靜卻被砍」。**不要當成死碼刪掉。**
        truncateForMessage(sanitizeErrorForLog(
          `claude CLI 首塊逾時 ${CLAUDE_CLI_FIRST_CHUNK_TIMEOUT_MS / 1000} 秒（串流增量 ${streamDeltaCount} 個）`,
        )),
      ));
    }, CLAUDE_CLI_FIRST_CHUNK_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeoutId);
      clearTimeout(firstChunkTimeoutId);
      fn();
    };

    cancelRef.cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeoutId);
      clearTimeout(firstChunkTimeoutId);
      child.kill();
      // 取消也是一種收斂（F-03 收口）：讓 await 端能往下走做收尾；
      // settled 已設，後到的 close/error/result 不會二次 settle。
      reject(new ClassifiedError('CANCELLED'));
    };

    const parseLine = (line: string) => {
      const raw = line.trim();
      if (!raw) return;

      let event: {
        type?: string;
        subtype?: string;
        is_error?: boolean;
        result?: unknown;
        event?: {
          type?: string;
          delta?: { text?: unknown };
        };
      };
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      if (
        event.type === 'stream_event'
        && event.event?.type === 'content_block_delta'
      ) {
        // 已收斂（取消／逾時）後才到的增量靜默丟棄（F-02 收口）：
        // 唯一呼叫端的 onDelta 是往 client response 寫入，收斂後對端已斷線。
        if (settled) return;
        streamDeltaCount += 1;
        // 首塊閘門的本意是「偵測 CLI 卡死」，不是「偵測有沒有文字」。庫存健檢那種
        // 長提示詞實測會先吐 23 個 thinking_delta（3.8 秒就到）、直到 37 秒才吐出
        // 第一個 text_delta——若只認 text，閘門會在模型正常思考時誤砍。
        // 任何增量都是「活著且在工作」的確證，故一律解除首塊計時器。
        clearTimeout(firstChunkTimeoutId);
        // 但只有 text 增量才轉發：thinking_delta 沒有 text 欄位，思考內容不外流。
        if (typeof event.event.delta?.text === 'string') {
          streamedText += event.event.delta.text;
          onDelta(event.event.delta.text);
        }
        return;
      }

      if (event.type === 'result') {
        clearTimeout(firstChunkTimeoutId);
        resultEvent = event;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      lines.forEach(parseLine);
    });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });

    child.on('error', (err) => {
      cachedClaudeCliPath = null;
      settle(() => {
        reject(new ClassifiedError(
          'UPSTREAM_ERROR',
          `無法啟動 claude CLI：${truncateForMessage(sanitizeErrorForLog(err))}`,
        ));
      });
    });

    // prompt 走 stdin，spawn 後立即寫入；失敗由 child 'error'/'close' 統一收斂。
    try {
      child.stdin.write(req.prompt);
      child.stdin.end();
    } catch { /* 由 child 'error'/'close' 事件收斂結果 */ }

    child.on('close', () => {
      if (stdoutBuffer) parseLine(stdoutBuffer);

      settle(() => {
        if (!resultEvent) {
          reject(new ClassifiedError(
            'UPSTREAM_ERROR',
            `claude CLI 串流無 result：${truncateForMessage(sanitizeErrorForLog(stderr || streamedText || '(stderr 空)'))}`,
          ));
          return;
        }

        if (resultEvent.is_error === true) {
          const resultText = String(resultEvent.result ?? '');
          const authError = claudeCliAuthError(resultText);
          if (authError) {
            reject(authError);
            return;
          }
          reject(new ClassifiedError(
            'UPSTREAM_ERROR',
            `claude CLI 回報錯誤：${truncateForMessage(sanitizeErrorForLog(resultText))}`,
          ));
          return;
        }

        resolve({ text: String(resultEvent.result ?? '') });
      });
    });
  });
}

/** 錯誤摘要截斷（~200 字，僅本機除錯用途） */
function truncateForMessage(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
