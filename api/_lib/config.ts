export type GeminiMode = 'fast' | 'thinking';

export function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY;
}

// 型號名先 trim 再判斷：只有空白的設定值是 truthy，`||` 攔不住，會讓無效型號一路送到
// 上游，使用者看到的是「模型無法使用」而不是「設定打錯」——症狀離原因太遠。
export function getModelForMode(mode: GeminiMode): string {
  if (mode === 'thinking') {
    return process.env.GEMINI_MODEL_THINKING?.trim() || 'gemini-3.1-pro-preview';
  }

  return process.env.GEMINI_MODEL_FAST?.trim() || 'gemini-3.5-flash';
}

export function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.ALLOWED_ORIGIN;
  if (!configuredOrigins) {
    return ['http://localhost:3000'];
  }

  const origins = configuredOrigins
    .split(',')
    // 尾斜線要去到底（不是只去一層）：留下來的那條永遠比不中瀏覽器送的 Origin
    // （Origin 不帶尾斜線），該白名單項會實質失效而部署方不知情。
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return origins.length > 0 ? origins : ['http://localhost:3000'];
}

/** 「設定存在但為空」只喊一次，避免每個請求都刷一行 log（每個 serverless 實例各喊一次）。 */
let emptySecretWarned = false;

export function getSharedSecret(): string | undefined {
  const secret = process.env.PROXY_SHARED_SECRET;

  // 空字串與未設同路——共享密鑰驗證會無聲停用，而 Vercel 環境變數貼上失敗、或寫成
  // `PROXY_SHARED_SECRET=`，就正好是這個狀態，部署方通常以為它開著。
  // 放行行為刻意維持不變（serverless 沒有啟動期，載入期 throw 會讓所有端點冷啟動即 500），
  // 只留一道看得見的痕跡。未設不喊：那是本機 dev 的正常降級路徑。
  if (secret === '' && !emptySecretWarned) {
    emptySecretWarned = true;
    console.warn('[config] PROXY_SHARED_SECRET 已設定但值為空字串——共享密鑰驗證等同停用。');
  }

  return secret;
}
