import { spawn } from 'node:child_process';
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

/**
 * LLM provider adapter：依 LLM_PROVIDER 環境變數分流。
 * - 未設或 'gemini-api'：既有 Gemini API 路徑（部署環境永遠走這條，行為與原 handler 相同）。
 * - 'claude-cli'：橋接本機 Claude Code CLI（吃 Claude 訂閱，僅本機 vercel dev 用）。
 * - 其他值：明確設定錯誤，不靜默 fallback。
 */
export async function generateText(req: GeminiRequest): Promise<{ text: string }> {
  const provider = (process.env.LLM_PROVIDER ?? '').trim();

  switch (provider) {
    case '':
    case 'gemini-api':
      return callGeminiApiProvider(req);
    case 'claude-cli':
      return callClaudeCli(req);
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

/**
 * 預設分支：既有 Gemini API 路徑，自 api/gemini.ts handler 原樣搬移。
 * GEMINI_API_KEY 邏輯零觸碰（紅線）。
 */
async function callGeminiApiProvider(req: GeminiRequest): Promise<{ text: string }> {
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

  return callGeminiWithTimeout({ apiKey, model, contents, config });
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
function callClaudeCli(req: GeminiRequest): Promise<{ text: string }> {
  const exePath = findClaudeExecutable();
  const model = getClaudeCliModel(req.mode);

  const args = [
    '-p',
    '--output-format', 'json',
    '--tools', '',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--model', model,
    '--system-prompt', req.systemInstruction,
  ];

  return new Promise<{ text: string }>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    // Windows 對部分 spawn 失敗（如非 PE 執行檔 → ERROR_BAD_EXE_FORMAT）是同步 throw 而非 'error' 事件，
    // 必須 try/catch 讓同步/非同步失敗走同一條分類與快取清除路徑
    let child: ReturnType<typeof spawn>;
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
      child.kill();
      reject(new ClassifiedError('UPSTREAM_ERROR'));
    }, CLAUDE_CLI_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
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
          if (resultText.includes('Not logged in')) {
            reject(new ClassifiedError(
              'MISSING_KEY',
              '本機 Claude CLI 未登入：請在終端跑 claude /login（或 claude setup-token）後重試；或暫時移除 LLM_PROVIDER 改走 gemini-api。',
            ));
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
  });
}

/** 錯誤摘要截斷（~200 字，僅本機除錯用途） */
function truncateForMessage(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
