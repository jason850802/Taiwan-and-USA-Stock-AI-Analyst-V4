---
phase: 01-gemini
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - api/_lib/config.ts
  - api/_lib/http.ts
  - api/_lib/guard.ts
  - api/gemini.ts
  - services/gemini.ts
  - vite.config.ts
  - App.tsx
  - index.html
  - package.json
  - .env.example
  - vercel.json
autonomous: false
requirements: [CORE-01, CORE-02, CORE-03, KEY-01, KEY-02, KEY-03, KEY-04, PROXY-01, PROXY-02, FE-01]

must_haves:
  truths:
    - "使用者在 App 觸發 AI 分析（進場判斷／交易複盤／庫存健檢），行為與現在完全一致，只是資料改由 /api/gemini 取得"
    - "前端 bundle（dist/）不再含任何 Gemini 金鑰字串"
    - "後端沒有設定金鑰、模型不存在、上游逾時／5xx、請求參數不合法時，前端各自收到對應的中文分類錯誤訊息，而非籠統失敗或洩漏的上游原文"
    - "本地可以用單一開發流程同時跑前端與 /api/gemini（vercel dev 優先，退回雙進程備案）"
  artifacts:
    - path: "api/_lib/config.ts"
      provides: "讀取 GEMINI_API_KEY / GEMINI_MODEL_FAST / GEMINI_MODEL_THINKING 等環境變數與預設值、允許的 Origin 清單"
    - path: "api/_lib/http.ts"
      provides: "呼叫 Gemini 的 fetch 包裝：逾時控制、錯誤分類（MODEL_NOT_FOUND/RATE_LIMITED/UPSTREAM_ERROR/BAD_REQUEST/MISSING_KEY）、log 遮罩，避免金鑰外洩"
    - path: "api/_lib/guard.ts"
      provides: "最簡同源/Origin 檢查骨架（非裸奔），Phase 4 會擴充"
    - path: "api/gemini.ts"
      provides: "POST /api/gemini 薄轉發端點：收 { prompt, systemInstruction, mode }，回 { text } 或 { code, message }"
    - path: "services/gemini.ts"
      provides: "4 個既有匯出改呼叫 fetch('/api/gemini')，對外簽章與回傳型別不變"
    - path: ".env.example"
      provides: "列出本階段必要環境變數（金鑰、模型 ID 為佔位符，不含真實值）"
  key_links:
    - from: "services/gemini.ts"
      to: "/api/gemini"
      via: "fetch POST，body { prompt, systemInstruction, mode }"
      pattern: "fetch\\(['\"]\\/api\\/gemini['\"]"
    - from: "api/gemini.ts"
      to: "api/_lib/config.ts"
      via: "讀取模型 ID 與金鑰"
      pattern: "from ['\"]\\.\\/_lib\\/config"
    - from: "api/gemini.ts"
      to: "api/_lib/http.ts"
      via: "呼叫 Gemini 並取得分類後錯誤"
      pattern: "from ['\"]\\.\\/_lib\\/http"
---

<objective>
建立本專案第一層 Vercel Serverless 後端地基（`api/_lib/`）與單一 Gemini 代理端點（`/api/gemini`），把 `GEMINI_API_KEY` 從前端 bundle 永久移除，改由後端持有；前端 `services/gemini.ts` 改用 `fetch('/api/gemini')` 取代 `new GoogleGenAI(...)`，對外行為與回傳型別完全不變。

Purpose: 這是本里程碑唯一 CRITICAL 風險（金鑰外洩＝可被盜刷帳單）的修補，也是「前端 → /api → 第三方 → 回前端」整條鏈路在 Vercel 上是否可行的第一個端到端驗證切片。
Output: `api/_lib/config.ts`、`api/_lib/http.ts`、`api/_lib/guard.ts`、`api/gemini.ts`、改造後的 `services/gemini.ts`、移除金鑰注入的 `vite.config.ts`、`.env.example`、（如需要）`vercel.json`。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（沒有任何先前對話背景，請完整閱讀本節再動手）

你（執行者）沒有本次規劃討論的任何記憶。以下是已經拍板定案、不可更動的實作決策（來自 `.planning/phases/01-gemini/01-CONTEXT.md`，逐條引用 D-01～D-05）：

- **D-01（薄轉發，prompt 留前端）**：`/api/gemini` 只做「持金鑰、依 mode 選模型、轉發給 Gemini、回傳結果或分類錯誤」。**不要**把 `services/gemini.ts` 內任何 prompt／systemInstruction 組裝邏輯搬到後端。前端繼續組好 `prompt` 與 `systemInstruction` 字串，傳給後端。
- **D-02（單一通用端點）**：只建一個 `POST /api/gemini`，服務 `services/gemini.ts` 現有全部 4 個匯出（`analyzeStockWithGemini`、`analyzeEntryWithGemini`、`analyzeTradeDecision`、`analyzePortfolioHealth`）。不要為每個函式各開一個端點。
- **D-03（模型選擇後端映射）**：前端傳 `mode: 'fast' | 'thinking'`；後端依 mode 映射到實際模型 ID（環境變數 `GEMINI_MODEL_FAST` / `GEMINI_MODEL_THINKING`）。模型 ID 字串永遠不出現在前端程式碼或回應中。
- **D-04（錯誤呈現）**：後端統一回傳 `{ code: string, message: string }`；`message` 本身就是**繁體中文**、對使用者友善的完整句子（不是 key，不需要前端再查表）。前端只需把 `message` 原樣顯示，**不要**依 `code` 客製不同 UI／圖示（那是本里程碑明確排除的範圍）。
- **D-05（錯誤分類碼集合，固定為以下 5 種，不可增減／改名）**：
  - `MODEL_NOT_FOUND` — Gemini 回 404（模型不存在或已下架）
  - `RATE_LIMITED` — Gemini 回 429
  - `UPSTREAM_ERROR` — 逾時、5xx 或其他上游錯誤
  - `BAD_REQUEST` — 前端送來的請求參數不合法（例如缺 prompt / mode 不是 fast|thinking）
  - `MISSING_KEY` — 後端沒有設定 `GEMINI_API_KEY`（設定錯誤，非使用者可修）
  - 錯誤 body 與 Vercel function log **都不得**出現 `AIza`、`key=`、或完整的 Google API URL（呼應 KEY-04 與 PITFALLS.md Pitfall 1）。

**Claude's Discretion（使用者未逐項討論，已授權的合理預設，執行時照做即可，不要重新設計）：**
- **production 模型預設維持現有 ID（使用者 2026-07-04 拍板）**：`GEMINI_MODEL_FAST` 預設 `gemini-3.5-flash`（fast 模式帶 `thinkingLevel: 'MEDIUM'`）；`GEMINI_MODEL_THINKING` 預設 `gemini-3.1-pro-preview`（與現有程式碼一致，維持既有分析行為零變動）。兩者皆可用環境變數覆寫；若該 preview 模型日後下架，改環境變數即可，並由 `MODEL_NOT_FOUND` 分類（D-05）明確回報，不會整批靜默失敗。
- **Phase 1 的防護是最簡骨架，非裸奔，但也非完整防濫用**：`api/_lib/guard.ts` 只做「檢查 request 的 `Origin`／`Referer` header 是否為允許清單（本地 `http://localhost:3000`、部署後的 production 網域）」。這**不是**強防線（可偽造），完整的 Upstash 限流／共享密鑰／CORS allowlist 排在 Phase 4，本階段不做。
- **本地開發**：先嘗試 `vercel dev`（單一 port 同時跑前端 + `/api/*`）。若遇到 Vite 6 整合問題（社群回報信心 LOW-MEDIUM，可能出現的症狀是 `/api` 內 import 語法錯誤、或 `vercel dev` 與 `vite` 各自佔用 port），退回**雙進程備案**：`vite dev`（前端，port 3000）+ 另開一個 `vercel dev`（後端，例如 port 3001），並在 `vite.config.ts` 加 `server.proxy` 把 `/api` 轉給 `vercel dev` 的 port。兩個方案都要在 PLAN 任務中準備好，執行者依實測結果擇一記錄在 SUMMARY。

**明確排除、不要做（deferred，出現即為範圍膨脹）：**
- Gemini 串流回應（`generateContentStream` / SSE）— v2 差異化功能，不在本階段。
- 清理 `services/gemini.ts` 內的死碼（`analyzeStockWithGemini` 與其專用的 `formatPromptData`，這兩者被匯入但目前未被任何元件呼叫）— 屬於獨立的技術債里程碑，**改接後端時仍要維護它的介面**（因為它是既有匯出），但不要主動刪除或重構它。
- 前端依錯誤 `code` 客製不同的 UI/圖示 — 本里程碑明確排除。
- Upstash 限流／共享密鑰／CORS allowlist 完整防濫用 — Phase 4 的工作，本階段只建 guard 骨架。

**既有程式碼事實（執行前務必確認，不要憑記憶重建）：**
- `services/gemini.ts`（約 1031 行）目前有 4 個 exported async 函式，每個各自：(1) 檢查 `if (!process.env.API_KEY) throw new Error("API Key is missing.")`；(2) `new GoogleGenAI({ apiKey: process.env.API_KEY })`；(3) 組一大段 `systemInstruction` + `promptData`/`promptText`；(4) 呼叫 `ai.models.generateContent({ model, contents, config })`；(5) `try/catch` 把任何錯誤壓成固定的英文字串（例如 `"Failed to analyze stock data."`）再 throw。
  - `analyzeStockWithGemini`（L141-234）：`mode` 參數決定 model，`fast`→`gemini-3.5-flash`、`thinking`→`gemini-3.1-pro-preview`；`fast` 模式額外帶 `thinkingConfig: { thinkingLevel: 'MEDIUM' }`。**此函式目前是死碼**（被 import 但未被任何元件呼叫），仍要照薄轉發模式改接，不要跳過。
  - `analyzeEntryWithGemini`（L241-314）：同樣 `mode` 決定 model 與可選 `thinkingConfig`；被 `App.tsx` 呼叫（唯一使用中的進場分析入口）。
  - `analyzeTradeDecision`（L316-700）：**沒有 `mode` 參數**，寫死用 `model: 'gemini-3.5-flash'`，固定帶 `thinkingConfig: { thinkingBudget: 8192 }`；被 `components/Portfolio.tsx` 呼叫。
  - `analyzePortfolioHealth`（L825-1031）：**沒有 `mode` 參數**，寫死用 `model: 'gemini-3.5-flash'`，固定帶 `thinkingConfig: { thinkingBudget: 10240 }`；被 `components/Portfolio.tsx` 呼叫。
  - 對這兩個沒有 `mode` 參數的函式，改接後端時一律傳 `mode: 'fast'` 給 `/api/gemini`（因為它們原本就寫死 `gemini-3.5-flash`，對應後端的 `GEMINI_MODEL_FAST`），**但要各自保留原本的 `thinkingConfig`／`thinkingBudget` 數值**（後端 `/api/gemini` 需要接受並轉發 `thinkingConfig` 欄位，見下方契約設計）。
  - 每個函式的 `catch` 區塊目前把錯誤壓成固定英文字串（如 `"Failed to analyze stock data."`）。**薄轉發後**：後端已經回傳分類後的 `{ code, message }`（`message` 為中文），前端 catch 到 fetch 失敗或非 2xx 時，應該直接 `throw new Error(message)`（使用後端給的中文訊息），**不要**再套用舊的英文固定字串蓋掉它。
- `vite.config.ts`（23 行）目前用 `define` 把 `process.env.API_KEY` 與 `process.env.GEMINI_API_KEY` 都字面注入成 `env.GEMINI_API_KEY` 的值——這是金鑰外洩進前端 bundle 的根因，必須整段移除。
- `App.tsx` 第 154 行有 `if(err.message?.includes("API Key is missing"))` 這個判斷——**這是目前唯一與金鑰錯誤相關的前端邏輯，不是死碼**。改接後端後，金鑰未設定會回傳 `MISSING_KEY` 分類、`message` 內容也會改變（不再是英文 "API Key is missing"），所以這個 `includes` 判斷會失效。**未決點**：是否要更新這個字串比對邏輯不在本計畫的必要範圍（D-04 已說前端不依 code 客製 UI），但若保留舊字串比對會永遠比對失敗、走向下方的 `else` 分支。執行者於任務 3 處理 `App.tsx` 時，請將此行的字串比對邏輯移除或改為單純顯示 `err.message`（因為後端已保證訊息本身即為中文友善文案，不需要前端再特判），並在 SUMMARY 中記錄此改動。**經查證：CONTEXT.md 提到的「`App.tsx:155` 參考 `REACT_APP_GEMINI_API_KEY`」在目前程式碼中找不到字面字串 `REACT_APP_GEMINI_API_KEY`**——這是規劃時的過時資訊或誤植，執行者不需要為此搜尋不存在的字串；真正需要處理的是上述第 154 行的 `"API Key is missing"` 字串比對。
- `App.tsx` 現有 `analysisMode` state（`useState<'fast' | 'thinking'>('fast')`，約 L51）已經是 D-03 所需 `mode` 參數的現成來源，`analyzeEntryWithGemini(filter, userPosition, analysisMode)` 呼叫已經在傳遞它，不需新增 state。
- `package.json` 目前 `@google/genai@^1.35.0` 只給前端用；`index.html` 的 `importmap` 也有 `"@google/genai": "https://esm.sh/@google/genai@^1.35.0"`。後端需要 `@google/genai` 作為**真正的 npm 依賴**（Vercel 用 `node_modules` 打包 function，不能用 importmap）。研究建議升級到 `^2.7.0`（GA 版），但**本計畫不強制升級**——若升級到 2.x 導致 API 介面變動（`ai.models.generateContent` 簽章、`GoogleGenAI` 建構子等），需要更多驗證，屬於未決點；預設策略是**維持 `@google/genai@^1.35.0`** 讓後端使用（與前端目前依賴的版本一致，行為最可預期），只有在 1.35.0 於 Node runtime 下有相容性問題時才考慮升級。
- 沒有測試 runner，`tsconfig.json` 非 strict。驗證手段是 `npx tsc --noEmit` + 實際跑 `npm run build` 後 `grep -r "AIza" dist/`（用 Bash 工具跑，PowerShell 沒有 grep）。
</context_for_cold_start_executor>

<preflight_resolutions>
## 彩排裁定（2026-07-04，Codex 彩排 + Claude 覆核後定案；本節權威高於下方任務裡的模糊寫法）

以下把計畫原本「擇一／未定」的地方定死，執行者照這裡做，不要再自行選擇：

1. **逾時用 `AbortController`，不要用 `Promise.race`**：在 `api/_lib/http.ts` 建 `AbortController`，`setTimeout` 觸發時 `controller.abort()`，並把 `abortSignal: controller.signal` 傳進 `ai.models.generateContent({ ..., config: { ..., abortSignal } })`（`@google/genai` 1.46 支援）。逾時 100000ms（略小於 maxDuration 120s）。理由：race 只讓本地 Promise 提早失敗，不會真的取消上游請求。

2. **`api/gemini.ts` 用 `@vercel/node` 傳統簽章**（因為要用 `req.body`/`req.method`/`res.status().json()`）：
   `export default async function handler(req: VercelRequest, res: VercelResponse) { ... }`。
   不要用 Web 標準 `handler(req: Request): Promise<Response>`（Vercel 的 Web 形式其實是 `export default { async fetch(request){} }`，與本計畫用法不符）。

3. **maxDuration 用具名匯出**：`export const maxDuration = 120;`。**不要**用 `export const config = { maxDuration: 120 }`。通常因此**不需要** `vercel.json`；若確認不需要就不要建，並在 SUMMARY 註明。

4. **本地開發首選方案（取代原「雙進程」模糊描述）**：
   - 後端：`npx vercel dev --listen 3001`（Vercel CLI 未全域安裝，用 npx 即可；**首次可能需要 `vercel login` 與 link 專案**——若環境無法登入/下載 CLI，於 Task 4 回報，改由人工在本機跑）。
   - 前端：Vite 維持 port 3000（現狀）。
   - 在 `.env` 的 `ALLOWED_ORIGIN` 同時放行 `http://localhost:3000,http://localhost:3001`。
   - 若走此雙進程，前端 `fetch('/api/gemini')` 需能到達 3001：可在 `vite.config.ts` 加 `server.proxy` 把 `/api` 轉給 `http://localhost:3001`。

5. **驗證指令的環境相依（Codex 在 PowerShell，我方在 Git Bash）**：
   - TypeScript：PowerShell 下 `npx tsc` 會被 execution policy 擋 `npx.ps1`，改用 **`npx.cmd tsc --noEmit`**（Git Bash 下 `npx tsc --noEmit` 即可）。
   - 金鑰掃描：PowerShell 下沒有 `grep`，用 **`Select-String -Path dist\* -Pattern "AIza" -Recurse`**（或在 Git Bash 跑 `grep -r "AIza" dist/`）。兩者命中數都必須為 0。

6. **`@google/genai` 版本**：`package.json` 宣告 `^1.35.0`，本機實際解析為 `1.46.0`，Node 26 下已實測可 import 與建立 `GoogleGenAI`。**維持 `^1.35.0` 範圍即可**（它涵蓋 1.46.0），不要鎖死版本，除非 Vercel 打包出相容性問題再處理並記錄於 SUMMARY。

7. **【安全命脈】Task 4 必須實際觸發每一種錯誤路徑並確認不漏金鑰**（因為本專案無自動測試，tsc + 單一成功路徑不足以證明 5 種分類正確、更不足以證明錯誤路徑不洩漏金鑰——而金鑰封存正是本階段目的）。Task 4 至少要各觸發一次並記錄結果：
   - `MISSING_KEY`（暫時移除 `.env` 金鑰）、`BAD_REQUEST`（送缺 prompt 的請求，用 curl/Postman 打 `/api/gemini`）、`MODEL_NOT_FOUND`（把 `GEMINI_MODEL_THINKING` 暫設成不存在的模型 ID）。
   - 每種都確認：回應 body 只有 `{ code, message }`（中文）、**不含** `AIza`/`key=`/完整 googleapis URL；且 Vercel function log 也不含這些片段（log 已 redact）。
   - `RATE_LIMITED`/`UPSTREAM_ERROR` 難以穩定觸發，可用單元層級或人工說明覆蓋，於 SUMMARY 註記其驗證方式或未能實測的原因。
</preflight_resolutions>

<execution_context>
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-gemini/01-CONTEXT.md
@.planning/research/SUMMARY.md
@.planning/research/STACK.md
@.planning/research/ARCHITECTURE.md
@.planning/research/PITFALLS.md
@.planning/codebase/INTEGRATIONS.md
@services/gemini.ts
@vite.config.ts
@App.tsx
@package.json
</context>

<api_contract>
## `/api/gemini` 請求／回應契約（本計畫的唯一端點，所有任務必須遵守）

**請求：** `POST /api/gemini`
```
Content-Type: application/json

{
  "prompt": string,              // 必要。前端已組好的完整 user prompt 文字
  "systemInstruction": string,   // 必要。前端已組好的完整 system instruction 文字
  "mode": "fast" | "thinking",   // 必要。決定後端用哪個模型 ID
  "temperature"?: number,        // 選填。不同 analyze* 函式原本 temperature 不同（0.1/0.2/0.3），需可傳遞
  "thinkingConfig"?: {           // 選填。用來還原各函式原本的 thinkingConfig/thinkingBudget 行為
    "thinkingLevel"?: "MEDIUM",
    "thinkingBudget"?: number
  }
}
```

**成功回應：** `200 OK`
```
{ "text": string }
```

**失敗回應：** 對應的 HTTP status（400/404/429/500/502...皆可，前端只看 body，不依賴 status code 判斷分類）+ body：
```
{ "code": "MODEL_NOT_FOUND" | "RATE_LIMITED" | "UPSTREAM_ERROR" | "BAD_REQUEST" | "MISSING_KEY", "message": string }
```
`message` 為完整繁體中文句子，可直接顯示給使用者，例如：
- `MISSING_KEY` → "後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。"
- `MODEL_NOT_FOUND` → "目前設定的 AI 模型無法使用，請確認模型名稱設定是否正確。"
- `RATE_LIMITED` → "Gemini 服務目前請求過於頻繁，請稍後再試一次。"
- `UPSTREAM_ERROR` → "AI 服務暫時無法回應，請稍後再試。"
- `BAD_REQUEST` → "請求格式不正確，請重新整理頁面後再試一次。"

（以上四句範例文案為建議措辭，執行者可微調用字，但語意與繁中友善原則不可變。）
</api_contract>

<tasks>

<task type="auto">
  <name>Task 1: 建立 api/_lib/ 共用層（config、http、guard）</name>
  <files>api/_lib/config.ts, api/_lib/http.ts, api/_lib/guard.ts, .env.example, package.json</files>
  <action>
建立 3 個共用模組（全部使用底線前綴目錄 `api/_lib/`，Vercel 不會把它們當成路由）：

1. `api/_lib/config.ts`：
   - `export function getGeminiApiKey(): string | undefined` 讀 `process.env.GEMINI_API_KEY`（**不要**加任何前綴，不要 fallback 到 `process.env.API_KEY`——那是舊的前端注入變數，後端只認 `GEMINI_API_KEY`）。
   - `export function getModelForMode(mode: 'fast' | 'thinking'): string`：`fast` 讀 `process.env.GEMINI_MODEL_FAST`，預設值 `"gemini-3.5-flash"`；`thinking` 讀 `process.env.GEMINI_MODEL_THINKING`，預設值 `"gemini-3.1-pro-preview"`（與現有程式碼一致，使用者拍板）。
   - `export function getAllowedOrigins(): string[]`：讀 `process.env.ALLOWED_ORIGIN`（逗號分隔，若未設定則預設含 `http://localhost:3000`）供 guard.ts 使用。

2. `api/_lib/http.ts`：
   - `export async function callGeminiWithTimeout(params: { apiKey: string; model: string; contents: unknown; config: unknown; timeoutMs?: number }): Promise<{ text: string }>`：內部 `new GoogleGenAI({ apiKey })`，用 `Promise.race` 或 `AbortController` 實作逾時（預設 100000ms，略小於後述 maxDuration=120s，留緩衝時間讓函式本身能回應錯誤而非被平台強制砍斷），呼叫 `ai.models.generateContent({ model, contents, config })`，回傳 `{ text: response.text || '' }`。
   - `export type GeminiErrorCode = 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'BAD_REQUEST' | 'MISSING_KEY'`
   - `export class ClassifiedError extends Error { code: GeminiErrorCode; constructor(code: GeminiErrorCode, message: string) }`
   - `export function classifyGeminiError(error: unknown): ClassifiedError`：檢查 error 物件（`@google/genai` 拋出的錯誤通常帶 `status` 或訊息含數字），對應規則：訊息或狀態碼含 `404` → `MODEL_NOT_FOUND`（中文訊息如上表）；含 `429` → `RATE_LIMITED`；逾時（`AbortError` 或 timeout 觸發）或其他 5xx → `UPSTREAM_ERROR`；其餘未知錯誤預設也歸類 `UPSTREAM_ERROR`（不要讓任何例外逃逸成未分類錯誤）。**函式內部絕對不可把原始 error 物件、error.message 中含 `key=`／`AIza`／完整 googleapis.com URL 的片段原樣塞進回傳的 message** — 一律用固定的中文分類文案（如上表範例），必要時把原始錯誤只寫入 `console.error`（Vercel log），且寫入前先用簡單的 regex 把 `key=[^&\s]+` 與 `AIza[0-9A-Za-z\-_]+` 取代為 `[REDACTED]` 再 log。
   - `export function validateGeminiRequest(body: any): { prompt: string; systemInstruction: string; mode: 'fast' | 'thinking'; temperature?: number; thinkingConfig?: any }`：檢查 `body.prompt`/`body.systemInstruction` 為非空字串、`body.mode` 為 `'fast'` 或 `'thinking'`，任一不合法就 `throw new ClassifiedError('BAD_REQUEST', '請求格式不正確，請重新整理頁面後再試一次。')`。

3. `api/_lib/guard.ts`：
   - `export function isAllowedOrigin(req: { headers: Record<string, string | string[] | undefined> }): boolean`：讀取 request 的 `origin` 或 `referer` header，與 `getAllowedOrigins()` 比對（用 `startsWith` 比對 referer，因為 referer 含完整路徑）；若兩個 header 都不存在（例如同源部署下瀏覽器可能不送 Origin），**允許放行**（因為這只是最簡骨架，不是強防線，避免擋到自己的合法前端請求）；若都存在且都不在允許清單內，回傳 `false`。這只是骨架，Phase 4 才會加上真正的限流與共享密鑰。

在 `package.json` 的 `dependencies` 新增 `@google/genai` 維持 `^1.35.0`（後端與前端共用同一版本，不要升級版本，降低本階段風險），並新增 `devDependencies` 的 `@vercel/node`（型別支援，版本用 `^5`，若 npm 當下無法解析到具體版號則使用 npm 建議的最新相容版）。

建立 `.env.example`（專案根目錄，覆蓋既有若有的話）列出：
```
# Google Gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL_FAST=gemini-3.5-flash
GEMINI_MODEL_THINKING=gemini-3.1-pro-preview

# 允許呼叫 /api/* 的前端來源（本地開發預設 3000）
ALLOWED_ORIGIN=http://localhost:3000
```
不要放入任何真實金鑰值，只用佔位符。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit</automated>
  </verify>
  <done>`api/_lib/config.ts`、`api/_lib/http.ts`、`api/_lib/guard.ts`、`.env.example` 皆存在；`npx tsc --noEmit` 通過（無新增型別錯誤）；`package.json` 含 `@google/genai` 於 dependencies（後端可 import）。</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: 建立 /api/gemini 薄轉發端點</name>
  <files>api/gemini.ts, vercel.json</files>
  <action>
建立 `api/gemini.ts`，實作 D-01/D-02/D-03/D-04/D-05 描述的單一薄轉發端點：

- 使用 Node.js runtime（不要用 Edge，`@google/genai` 依賴 Node API，見 STACK.md）。可用 `@vercel/node` 的 `VercelRequest`/`VercelResponse` 型別，或 Web 標準 `export default async function handler(req: Request): Promise<Response>` 簽章——**擇一使用即可，兩者 Vercel 皆原生支援**；建議用 `@vercel/node` 型別以獲得 `req.body`/`req.method` 的直接存取，減少手動解析 JSON body 的樣板碼。
- `export const config = { maxDuration: 120 }`（或依你選擇的簽章方式，用 Vercel 官方支援的方式宣告 `maxDuration=120`，對應 CORE-02 的 Gemini 120s 要求；若使用 `@vercel/node` 慣例，可能需要改用 `export const maxDuration = 120;` 具名匯出——請依 Vercel 目前文件慣例擇一寫法，並在 SUMMARY 註明採用哪種寫法）。
- 流程：
  1. 只接受 `POST`，其他 method 回 405（body 可簡單回 `{ code: 'BAD_REQUEST', message: '僅支援 POST 請求。' }`）。
  2. 呼叫 `isAllowedOrigin(req)`（來自 `api/_lib/guard.ts`），若 `false`，回 403 + `{ code: 'BAD_REQUEST', message: '請求來源不被允許。' }`。
  3. 用 `validateGeminiRequest(req.body)`（來自 `api/_lib/http.ts`）驗證並取得 `{ prompt, systemInstruction, mode, temperature, thinkingConfig }`；驗證失敗時 catch `ClassifiedError` 並依其 `code` 回對應 HTTP status（`BAD_REQUEST`→400）+ `{ code, message }`。
  4. 呼叫 `getGeminiApiKey()`；若為 `undefined`，直接回 500 + `{ code: 'MISSING_KEY', message: '後端尚未設定 Gemini API 金鑰，請聯絡管理員設定環境變數。' }`（不要嘗試呼叫 Gemini）。
  5. 呼叫 `getModelForMode(mode)` 取得模型 ID。
  6. 組 `contents = [{ role: 'user', parts: [{ text: prompt }] }]`，`config = { systemInstruction, temperature: temperature ?? 0.1, ...(thinkingConfig ? { thinkingConfig } : {}) }`（若請求未帶 `temperature`，預設 0.1，對齊 `analyzeStockWithGemini` 原本的預設）。
  7. 呼叫 `callGeminiWithTimeout({ apiKey, model, contents, config })`；成功則回 200 + `{ text }`。
  8. 任何步驟 6/7 拋出的錯誤，用 `classifyGeminiError(error)` 分類後，依 code 對應 HTTP status（`MODEL_NOT_FOUND`→404、`RATE_LIMITED`→429、`UPSTREAM_ERROR`→502、`BAD_REQUEST`→400、`MISSING_KEY`→500）回傳 `{ code, message }`。
  9. 所有 catch 區塊在回應前，先用 `console.error`（已 redact 過金鑰片段）記錄錯誤方便除錯，但**回應 body 只含分類後的 `{ code, message }`，絕不含原始 error stack 或 error.message**。

若需要 `vercel.json` 才能讓 `maxDuration` 或 region 設定生效（依你研究/查證 Vercel 當前慣例決定是否需要此檔），建立最小化的 `vercel.json`（僅含必要欄位，不要塞入 Phase 4 才需要的 CORS/rewrite 規則）。若透過 `api/gemini.ts` 內的 `export const maxDuration = 120` 已足夠不需要 `vercel.json`，則不建立此檔並在 SUMMARY 說明原因。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit</automated>
  </verify>
  <done>`api/gemini.ts` 存在，涵蓋 5 種錯誤分類與 200 成功路徑；設有 `maxDuration=120`（或等效設定）；`npx tsc --noEmit` 通過。</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: 前端 services/gemini.ts 改接 /api/gemini + 移除金鑰注入</name>
  <files>services/gemini.ts, vite.config.ts, App.tsx, index.html, package.json</files>
  <action>
**3a. `services/gemini.ts`**（對外簽章與回傳型別完全不變，只換內部實作）：
- 移除頂部 `import { GoogleGenAI } from "@google/genai";`。
- 新增一個內部 helper（放在檔案頂部，供 4 個 export 函式共用）：
  ```
  const callGeminiApi = async (payload: {
    prompt: string;
    systemInstruction: string;
    mode: 'fast' | 'thinking';
    temperature?: number;
    thinkingConfig?: { thinkingLevel?: 'MEDIUM'; thinkingBudget?: number };
  }): Promise<string> => {
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || '分析失敗，請稍後再試。');
    }
    return data.text || 'No analysis generated.';
  };
  ```
  （型別與變數名可依你風格微調，但行為必須符合：非 2xx 一律 throw 後端給的中文 `message`；缺 `text` 時 fallback 既有的 `'No analysis generated.'` 字串，維持既有 UI 顯示一致。）
- 4 個既有 export 函式改造，**移除**各自的 `if (!process.env.API_KEY) throw new Error(...)` 守衛與 `new GoogleGenAI(...)` 建構，**移除**各自的 `ai.models.generateContent(...)` 呼叫與其 `try/catch` 內固定英文錯誤字串，改為呼叫上面的 `callGeminiApi`：
  - `analyzeStockWithGemini`：`modelName` 三元式（`mode === 'fast' ? "gemini-3.5-flash" : "gemini-3.1-pro-preview"`）整段移除（模型 ID 邏輯搬到後端）；改呼叫 `callGeminiApi({ prompt: promptData, systemInstruction, mode, temperature: 0.1, thinkingConfig: mode === 'fast' ? { thinkingLevel: 'MEDIUM' } : undefined })`。`formatPromptData` 呼叫與其邏輯**維持不動**（prompt 組裝留前端，D-01）。
  - `analyzeEntryWithGemini`：同樣移除 model 三元式與 SDK 呼叫，改呼叫 `callGeminiApi({ prompt: promptData, systemInstruction, mode, temperature: 0.2, thinkingConfig: mode === 'fast' ? { thinkingLevel: 'MEDIUM' } : undefined })`。
  - `analyzeTradeDecision`：原本寫死 `model: 'gemini-3.5-flash'`、`thinkingConfig: { thinkingBudget: 8192 }`，改呼叫 `callGeminiApi({ prompt: promptText, systemInstruction, mode: 'fast', temperature: 0.3, thinkingConfig: { thinkingBudget: 8192 } })`。
  - `analyzePortfolioHealth`：原本寫死 `model: 'gemini-3.5-flash'`、`thinkingConfig: { thinkingBudget: 10240 }`，改呼叫 `callGeminiApi({ prompt: promptText, systemInstruction, mode: 'fast', temperature: 0.2, thinkingConfig: { thinkingBudget: 10240 } })`。
- 每個函式的 fallback 文案（`'No analysis generated.'` / `'無法生成分析結果。'` / `'無法生成健檢結果。'`）維持原本各自的字串不變（在 `callGeminiApi` 呼叫端接住 `catch` 後，若你選擇讓各函式各自保留 try/catch 包一層以維持個別的 fallback 訊息差異，允許這樣做——但 catch 到的 `Error` 訊息一律是後端的中文 `message`，不要再蓋成舊的英文固定字串）。

**3b. `vite.config.ts`**：整段移除 `define` 區塊（`'process.env.API_KEY'` 與 `'process.env.GEMINI_API_KEY'` 兩行都要刪除），確認移除後檔案仍是合法的 `defineConfig` 結構（`server`/`plugins`/`resolve` 保留不動）。

**3c. `index.html`**：從 `importmap` 移除 `"@google/genai": "https://esm.sh/@google/genai@^1.35.0"` 這一行（前端不再需要在瀏覽器直接載入這個 SDK；後端改用 `node_modules` 的版本）。

**3d. `App.tsx`**：第 154 行附近 `if(err.message?.includes("API Key is missing"))` 這段判斷邏輯，因為後端已改回傳中文分類訊息（不再是英文 "API Key is missing"），這個字串比對會恆為 false。將其簡化為直接顯示 `err.message`（例如把該 if 分支與其對應的 else 分支合併成單一 `setError(err.message || '分析失敗，請稍後再試。')`），不要新增任何依 `code` 客製的 UI（D-04 明確排除）。閱讀該函式完整的 try/catch 區塊（約 L140-160）以確保修改後邏輯完整、沒有遺留無法到達的分支。

**3e. `package.json`**：確認 `@google/genai` 仍在 `dependencies`（前端 `services/gemini.ts` 已不再 import 它，但後端 `api/gemini.ts` 透過同一個 npm 套件匯入，所以套件本身要保留在 `dependencies`，只是不再出現在前端 import 語句與 `index.html` importmap 中）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit</automated>
  </verify>
  <done>`services/gemini.ts` 4 個匯出函式簽章與回傳型別不變，內部改用 `fetch('/api/gemini')`；`vite.config.ts` 無任何 `GEMINI_API_KEY`／`API_KEY` 的 `define`；`index.html` importmap 無 `@google/genai`；`App.tsx` 不再依賴英文字串 `"API Key is missing"` 判斷錯誤分支；`npx tsc --noEmit` 通過。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: 人工驗證本地端到端 AI 分析與金鑰未外洩</name>
  <what-built>
Claude 已完成：(1) `api/_lib/` 共用層＋`api/gemini.ts` 薄轉發端點；(2) `services/gemini.ts` 改接後端 fetch；(3) 移除 `vite.config.ts` 金鑰注入與 `index.html` importmap 的 `@google/genai`。以下自動化驗證已先執行並回報結果：
- `npx tsc --noEmit`：{Claude 執行時填入實際結果}
- `npm run build` 後 `grep -r "AIza" dist/`（Bash 工具跑，PowerShell 無 grep）：{Claude 執行時填入實際命中數，必須為 0}
- 已嘗試本地啟動流程：優先 `vercel dev`；若失敗則改用 `vite dev` + 第二個 `vercel dev` 進程 + `vite.config.ts` 的 `server.proxy` 轉接 `/api`（{Claude 填入實際採用哪個方案、遇到什麼錯誤訊息（如有）})
  </what-built>
  <how-to-verify>
1. 確認 `.env` 檔案（專案根目錄，git-ignored）內有真實的 `GEMINI_API_KEY`、`GEMINI_MODEL_FAST=gemini-3.5-flash`、`GEMINI_MODEL_THINKING=gemini-3.1-pro-preview`（若沒有請先建立，內容可從既有 `.env` 的 `GEMINI_API_KEY` 沿用）。
2. 依 Claude 記錄的方案啟動本地開發環境（`vercel dev` 或雙進程備案）。
3. 開啟瀏覽器造訪本地網址，搜尋任一檔股票（例如台積電 2330 或美股 AAPL），觸發「進場判斷」AI 分析（對應 `analyzeEntryWithGemini`）。
4. 確認：分析報告正常產生、中文內容格式與過去一致（六六大順分析格式），沒有出現「API Key is missing」或英文錯誤訊息。
5. 打開瀏覽器開發者工具 Network 分頁，確認請求是打 `/api/gemini`（同源，非 `generativelanguage.googleapis.com`），且回應 body 不含 `AIza` 或任何 `key=` 字樣。
6. （若時間允許）到 Portfolio 頁面測試「交易複盤」（`analyzeTradeDecision`）與「庫存健檢」（`analyzePortfolioHealth`）任一個，確認同樣正常運作。
7. 故意暫時把 `.env` 的 `GEMINI_API_KEY` 註解掉、重啟開發伺服器，再次觸發分析，確認前端顯示的是後端回傳的中文訊息（例如「後端尚未設定 Gemini API 金鑰...」），而不是空白或當機；驗證完成後記得把 `.env` 改回來。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述遇到的問題（例如「vercel dev 啟動失敗，錯誤訊息是...」）</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| 瀏覽器 → `/api/gemini` | 不受信任輸入：任何人皆可對此端點發送任意 HTTP 請求（同源部署下瀏覽器發出，但也可被 curl/Postman 直接打） |
| `/api/gemini` → Google Gemini API | 受信任輸出邊界：後端須避免把金鑰或上游敏感細節透傳回前端 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|--------------|------------------|
| T-01-01 | Information Disclosure | `api/gemini.ts` / `api/_lib/http.ts` | mitigate | 錯誤一律經 `classifyGeminiError` 分類後回傳固定中文 `{code,message}`，絕不透傳 upstream error 原文；log 前 redact `key=`/`AIza` pattern |
| T-01-02 | Information Disclosure | 前端 bundle（`vite.config.ts`、`index.html`） | mitigate | 移除 `define` 金鑰注入與 importmap 的 `@google/genai`；build 後 `grep AIza dist/` 驗收為 0 |
| T-01-03 | Denial of Service（額度盜刷） | `/api/gemini` | accept | 本階段只做最簡 Origin/Referer 檢查（`api/_lib/guard.ts`），可被偽造繞過；完整 per-IP 限流與共享密鑰排在 Phase 4，本階段風險可接受（研究已確認：唯一 CRITICAL 是金鑰外洩，非額度濫用；且個人工具流量低） |
| T-01-04 | Tampering（請求參數） | `api/gemini.ts` 輸入 | mitigate | `validateGeminiRequest` 驗證 `prompt`/`systemInstruction`/`mode` 型別與必要性，不合法直接 400 `BAD_REQUEST`，避免非預期輸入傳入 `@google/genai` SDK |
| T-01-05 | Spoofing（Origin 偽造） | `api/_lib/guard.ts` | accept | Origin/Referer 可被偽造，本階段僅作為最低阻擋，非主防線；風險延後到 Phase 4 的共享密鑰+持久化限流處理 |
| T-01-SC | Tampering | npm 套件安裝（`@vercel/node`） | mitigate | 僅新增 1 個 devDependency（`@vercel/node`，Vercel 官方套件，非第三方無名套件）；`@google/genai` 已是既有相依，版本不升級。無需額外 slopcheck 人工驗證清單，因套件來源為 Vercel/Google 官方且非新增未知套件 |

</threat_model>

<verification>
## Overall Phase Verification（每項任務完成後、以及全部任務完成後都要跑）

1. `npx tsc --noEmit`（Bash 工具執行，在專案根目錄）— 必須 0 錯誤。
2. `npm run build`（Bash 工具執行）— 必須成功產出 `dist/`。
3. `grep -r "AIza" dist/`（Bash 工具執行，**不要用 PowerShell**，PowerShell 5.1 沒有 grep）— 命中數必須為 0。額外可執行 `grep -r "GEMINI_API_KEY" dist/` 與 `grep -rn "GoogleGenAI" dist/` 交叉確認前端 bundle 不含金鑰變數名稱與 SDK 建構呼叫的殘留字串（後者若命中純粹是字串常數殘留，非漏金鑰，但仍應確認不是完整金鑰值本身）。
4. 本地啟動驗證（`vercel dev` 優先，失敗則雙進程備案）並實際觸發一次 AI 分析，比對輸出格式與遷移前一致（見 checkpoint 任務的詳細步驟）。
</verification>

<success_criteria>
- [ ] `api/_lib/config.ts`、`api/_lib/http.ts`、`api/_lib/guard.ts` 存在且各自匯出本計畫描述的函式
- [ ] `api/gemini.ts` 存在，為單一 `POST /api/gemini` 端點，涵蓋 D-05 五種錯誤分類與 200 成功路徑，設有 `maxDuration=120`
- [ ] `services/gemini.ts` 4 個既有匯出（`analyzeStockWithGemini`、`analyzeEntryWithGemini`、`analyzeTradeDecision`、`analyzePortfolioHealth`）簽章與回傳型別完全不變，內部已改為呼叫 `fetch('/api/gemini')`，不再 `new GoogleGenAI`
- [ ] `vite.config.ts` 不含任何 `GEMINI_API_KEY`／`API_KEY` 的 `define` 注入
- [ ] `index.html` importmap 不含 `@google/genai`
- [ ] `.env.example` 存在且只含佔位符（無真實金鑰）
- [ ] `npx tsc --noEmit` 通過
- [ ] `npm run build` 成功，且 `grep -r "AIza" dist/` 命中數為 0
- [ ] 本地環境（`vercel dev` 或雙進程備案）實測一次 AI 分析行為與遷移前一致
- [ ] 人工 checkpoint 已核可（"approved" 或問題已處理完成）
</success_criteria>

<output>
Create `.planning/phases/01-gemini/01-01-SUMMARY.md` when done. 在 SUMMARY 中務必記錄：
- 本地開發最終採用 `vercel dev` 單進程或雙進程備案（含遇到的實際錯誤訊息，若有）
- `api/gemini.ts` 採用 `@vercel/node` 型別或 Web 標準 `Request/Response` 簽章、`maxDuration` 實際宣告方式
- 是否建立了 `vercel.json`（及原因）
- `@google/genai` 後端使用版本（維持 1.35.0 或因相容性問題升級，若升級需說明原因與驗證方式）
- Gemini thinking 模式（`gemini-3.1-pro-preview`）實際回應延遲的粗略測量結果（呼應 STATE.md 的「Phase 1 待測量」blocker）
</output>
