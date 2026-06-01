# Phase 1: 後端骨架 ＋ Gemini 端點（金鑰封存） - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

建立後端共用地基（`api/_lib/`）與單一 Gemini 代理端點（`/api/gemini`），把 `GEMINI_API_KEY` 永久搬離前端 bundle，並驗通「前端 → /api → Gemini → 回前端」整條鏈路在 Vercel 上可行。涵蓋 CORE-01/02/03、KEY-01/02/03/04、PROXY-01/02、FE-01。

**對使用者的鐵則：** AI 分析行為完全不變，差別只在金鑰與呼叫改由後端處理。

</domain>

<decisions>
## Implementation Decisions

### 端點厚薄（prompt 放哪）
- **D-01:** `/api/gemini` 採「薄轉發」設計。前端 `services/gemini.ts` 繼續組裝 `prompt` 與 `systemInstruction`，傳給後端；後端只負責持有金鑰、依 mode 選模型、轉發給 Gemini、回傳結果。**本里程碑不搬動 `gemini.ts` 內的 prompt 邏輯**（降低風險、改動最小）。
- **D-02:** 單一通用端點。一個 `/api/gemini` 接收 `{ prompt, systemInstruction, mode }`，服務前端全部 4 個 Gemini 呼叫（entry / trade / health 等），不為每個功能各開端點（省 Vercel 函式數、與薄轉發一致）。
- **D-03:** 模型選擇由前端傳 `mode`（`'fast' | 'thinking'`），後端映射到實際模型 ID。**模型 ID 永不離開後端**，符合 PROXY-02 的集中設定原則。

### 錯誤訊息呈現
- **D-04:** 後端統一回傳 `{ code, message }`，其中 `message` 本身即為**繁體中文友善訊息**（文案由後端持有）。前端只負責渲染該 `message`，不依 `code` 客製不同 UI/圖示 —— 改動最小，且自動涵蓋所有分類碼，不踩本里程碑明確排除的「前端錯誤分類 UI」。
- **D-05:** 後端 Phase 1 即定義的錯誤分類碼集合：`MODEL_NOT_FOUND`（模型不存在/下架，Gemini 404）、`RATE_LIMITED`（429）、`UPSTREAM_ERROR`（逾時/5xx 等其他上游錯誤）、`BAD_REQUEST`（請求參數不合法）、`MISSING_KEY`（後端未設定金鑰的設定錯誤）。錯誤 body 與 Vercel log 皆不得含 `AIza` / `key=` / 完整 Google URL（呼應 KEY-04）。

### Claude's Discretion
使用者未選擇討論以下兩項，授權以下合理預設，planner 可在此範圍內決定：

- **thinking 模式的 production 模型（未討論）：** 模型 ID 一律來自環境變數 `GEMINI_MODEL_FAST` / `GEMINI_MODEL_THINKING`。**production 預設值採 stable ID**（`fast` → `gemini-3.5-flash`；`thinking` → 當期 stable pro，例如 `gemini-2.5-pro`），避免 preview 模型短期下架導致整批失敗；保留以環境變數覆寫為 preview 的彈性。並提供當設定模型回 404 時的 `MODEL_NOT_FOUND` 分類（D-05）與 fallback 模型常數。
- **Phase 1 端點的臨時防護（未討論）：** 完整防濫用排在 Phase 4，但 `api/_lib/guard` 骨架在 Phase 1 就建立，並先放**最簡 Origin/同源檢查**（非裸奔）。Phase 4 再補上 Upstash 限流、共享密鑰、CORS allowlist。
- **本地開發體驗（未討論）：** 先嘗試 `vercel dev` 單進程同時跑前端 + `/api/*`（CORE-03）；若遇 Vite 6 整合坑（研究標記 LOW-MEDIUM 信心），退回 `vite dev` + 另起後端、以 `server.proxy` 轉接 `/api` 的雙進程方案。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 本里程碑研究（最高優先）
- `.planning/research/SUMMARY.md` — 綜整結論，含 Vercel Hobby 300s 逾時、模型 ID 仍有效的 reconcile、四階段建置順序
- `.planning/research/STACK.md` — Node.js runtime、`@google/genai@^2.7.0`、原生 fetch、maxDuration 建議值
- `.planning/research/ARCHITECTURE.md` — 前後端切分、`api/_lib/` 配置、`/api/gemini` 契約、移除 `vite.config.ts` define 的關鍵動作
- `.planning/research/PITFALLS.md` — 金鑰三條外洩路徑（`VITE_` 前綴 / error 透傳 / log）、`grep AIza dist/` 驗收、模型寫死＋preview 下架＋無錯誤分類三疊加

### 專案層
- `.planning/PROJECT.md` — Core Value、Constraints（金鑰只在 Vercel 環境變數）、Key Decisions
- `.planning/REQUIREMENTS.md` §v1（CORE/KEY/PROXY/FE）— 本階段需求 CORE-01/02/03, KEY-01/02/03/04, PROXY-01/02, FE-01
- `.planning/ROADMAP.md` §Phase 1 — Goal 與 5 條成功標準

### 既有程式碼地圖
- `.planning/codebase/INTEGRATIONS.md` — 既有 Gemini 呼叫點、`process.env.API_KEY` 注入路徑
- `.planning/codebase/ARCHITECTURE.md` §Anti-Patterns — client-side API key injection、inconsistent fast/thinking model handling

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/gemini.ts`：既有 4 個匯出（`analyzeEntryWithGemini`、`analyzeStockWithGemini`、`analyzeTradeDecision`、`analyzePortfolioHealth`）各自組 prompt + systemInstruction。薄轉發設計下，這些函式的 prompt 組裝**留著不動**，只把「`new GoogleGenAI(...)` + `ai.models.generateContent(...)`」換成一次 `fetch('/api/gemini', ...)`。
- `analyzeStockWithGemini` + `formatPromptData` 為死碼（匯入但未呼叫）— 本階段不主動清理（屬技術債里程碑），但改接時不需為它接後端。
- 既有 `analysisMode: 'fast' | 'thinking'` state（`App.tsx`）已是現成的 mode 來源，直接對應 D-03 的 `mode` 參數。

### Established Patterns
- 既有 services 皆為 async 函式回傳領域型別/markdown 字串；薄轉發後 `services/gemini.ts` 對外簽章維持不變（FE-01：契約不變）。
- 既有金鑰守衛 `if (!process.env.API_KEY) throw new Error("API Key is missing.")` 將被後端的 `MISSING_KEY` 分類取代。

### Integration Points
- `vite.config.ts` 的 `define`（`process.env.API_KEY` / `process.env.GEMINI_API_KEY`）— KEY-01 要移除的注入點。
- `App.tsx:155` 參考的 `REACT_APP_GEMINI_API_KEY`（Vite 未定義）一併清理，避免殘留死引用。
- 前端 fetch 目標：本地 `vercel dev` 與 production 皆走同源 `/api/gemini`。

</code_context>

<specifics>
## Specific Ideas

- 薄轉發＋單一端點＋前端傳 mode：三者一致，端點只做「持金鑰 / 選模型 / 轉發 / 回傳或回分類錯誤」。
- 後端錯誤 `message` 為繁體中文，前端原樣顯示即可，無需前端 i18n 或錯誤碼對照表。

</specifics>

<deferred>
## Deferred Ideas

- Gemini 串流回應（STREAM-01）— v2，純 UX 升級，非本階段。
- 清理 `analyzeStockWithGemini` / `formatPromptData` 死碼 — 技術債里程碑。
- 前端依 `code` 客製錯誤 UI/圖示 — 本里程碑明確排除的「前端錯誤分類 UI」。
- Upstash 限流 / 共享密鑰 / CORS allowlist 完整防濫用 — Phase 4。

None outside roadmap — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-後端骨架 ＋ Gemini 端點（金鑰封存）*
*Context gathered: 2026-06-01*
