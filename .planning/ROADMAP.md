# Roadmap: Taiwan & USA Stock AI Analyst — Vercel Serverless 後端代理層

## Overview

本里程碑是一次「架構轉型」而非新功能建造：把純前端 Vite/React SPA 演進為「前端 ＋ 一層 Vercel Serverless 後端代理」，對終端使用者的功能行為完全維持不變。旅程從「封住唯一 CRITICAL 金錢風險」（Gemini 金鑰外洩）出發，先以最小端到端切片驗通整條鏈路；接著依資料路徑依賴（Yahoo 主、FinMind 副）逐一把行情代理搬到後端、剝離公用 CORS proxy；最後統一套上防濫用層、補齊部署文件與財務防線。每個階段都交付一個可在 Vercel 上實測驗證的端到端切片，並以 PITFALLS.md 的「Looks Done But Isn't」清單作為驗收依據。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: 後端骨架 ＋ Gemini 端點（金鑰封存）** - 建 `api/_lib/` 共用層與 `/api/gemini`，移除前端金鑰注入，封住唯一 CRITICAL 金錢風險
- [ ] **Phase 2: Yahoo 代理端點（去公用 Proxy）** - 後端實作 cookie/crumb 握手，前端 `services/yahoo.ts` 改接，移除公用 CORS proxy 依賴
- [ ] **Phase 3: FinMind 代理端點（後端集中）** - 後端注入 token＋快取籌碼到當日，明確回傳 unavailable 狀態，前端目錄/搜尋改接
- [ ] **Phase 4: 防濫用強化 ＋ 部署驗收** - 統一套上 Upstash 限流／CORS／共享密鑰，補 `.env.example` 與 GCP 配額財務防線

## Phase Details

### Phase 1: 後端骨架 ＋ Gemini 端點（金鑰封存）
**Goal:** 建立後端共用地基與 Gemini 代理端點，把 `GEMINI_API_KEY` 永久搬離前端 bundle，並驗通「前端→/api→第三方→回前端」整條鏈路在 Vercel 上可行
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** CORE-01, CORE-02, CORE-03, KEY-01, KEY-02, KEY-03, KEY-04, PROXY-01, PROXY-02, FE-01
**Success Criteria** (what must be TRUE):
  1. 使用者在 App 觸發 AI 分析，前端透過 `/api/gemini` 取得中文報告，行為與既有完全一致（不再 `new GoogleGenAI`、前端不持有金鑰）
  2. build 後對 `dist/` 執行 `grep AIza` 命中數為 0，且 `vite.config.ts` 已無 `GEMINI_API_KEY` 的 `define` 注入
  3. Gemini 模型 ID 來自環境變數（`GEMINI_MODEL_FAST` / `GEMINI_MODEL_THINKING`），production 預設為 stable ID；模型不存在時前端收到可辨識的 `MODEL_NOT_FOUND` 訊息（非籠統「分析失敗」）
  4. 任何 upstream 錯誤都經後端分類為 `{ code, message }` 回前端，前端錯誤 body 與 Vercel log 皆無 `key=` / `AIza` / 完整 Google URL
  5. `vercel dev` 能在本地單一 port 同時跑前端與 `/api/*`，且 Gemini 函式設有 `maxDuration`（120s）不落入預設逾時
**Plans:** TBD

### Phase 2: Yahoo 代理端點（去公用 Proxy）
**Goal:** 把所有 Yahoo 行情/搜尋呼叫搬到後端 `/api/yahoo/*`，後端實作完整 cookie/crumb 握手，移除前端對公用 CORS proxy 的依賴，且 `StockDataPoint[]` 領域契約零變動
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** PROXY-03, PROXY-06, FE-02
**Success Criteria** (what must be TRUE):
  1. 使用者查詢任一檔台股/美股，行情與圖表正常顯示，且前端不再呼叫 corsproxy.io / allorigins.win（Network tab 只見同源 `/api/yahoo/*`）
  2. 部署到 Vercel（非本機）後，Yahoo 路徑連續實測 ≥30 分鐘不出 401/429（涵蓋 cookie 過期週期，證明 crumb 短 TTL 快取與自動重取有效）
  3. 後端對 `interval` / `range` 做白名單檢查，非白名單參數被拒，端點不可被當成開放代理
  4. 前端 `services/yahoo.ts` 解析的 `StockDataPoint[]` 與既有型別完全相容，圖表、過濾器、提示詞無須改動
**Plans:** TBD
**UI hint:** yes

### Phase 3: FinMind 代理端點（後端集中）
**Goal:** 把所有 FinMind 呼叫（目錄、籌碼、價量、中文名稱）搬到後端 `/api/finmind`，注入 token 並快取籌碼到當日，籌碼不可用時明確回傳狀態而非以空陣列假裝真實 0
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** PROXY-04, PROXY-05, FE-03
**Success Criteria** (what must be TRUE):
  1. 使用者搜尋台股與載入籌碼資料正常，前端目錄載入與搜尋行為與既有一致，且 FinMind 呼叫一律經後端（token 永不接觸前端）
  2. 連續查詢多檔台股後仍未撞 FinMind 限流；籌碼資料以 `Cache-Control` 快取到當日，重複查詢不重打上游
  3. 當籌碼資料不可用時，前端收到明確的 `chipDataUnavailable` 狀態並可辨識顯示，外資/投信不再以 `[]` 假裝為真實 0
  4. 後端對 `dataset` 做白名單分流，非白名單 dataset 被拒
**Plans:** TBD
**UI hint:** yes

### Phase 4: 防濫用強化 ＋ 部署驗收
**Goal:** 在四個端點到位後統一套上防濫用層（持久化限流／CORS allowlist／共享密鑰／輸入驗證），補齊 `.env.example` 與部署文件，並設定 GCP 每日配額作為最後財務防線
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** GUARD-01, GUARD-02, GUARD-03, GUARD-04, DEPLOY-01, DEPLOY-02
**Success Criteria** (what must be TRUE):
  1. 從不相干網站或 Postman/curl 直接呼叫 `/api/gemini` 無法成功消耗額度（共享密鑰驗證 ＋ Origin 檢查擋下），自家前端正常運作不受影響
  2. 端點以 Upstash 持久化 per-IP 速率限制（`/api/gemini` 嚴、行情端點較寬），限流跨 serverless 實例一致（非記憶體計數器），超限回可辨識訊息
  3. CORS allowlist 只允許自家 production 網域 origin、正確處理 OPTIONS preflight，回應 header 無 `Access-Control-Allow-Origin: *`
  4. 所有端點對輸入參數（interval/range/dataset 等）做白名單/驗證，無法被當成開放代理（SSRF）
  5. 倉庫含 `.env.example` 列出所有必要環境變數，部署文件涵蓋 Vercel 設定、FinMind token 取得、以及在 Google Cloud 設定 Gemini 每日配額上限的指引
**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. 後端骨架 ＋ Gemini 端點 | 0/TBD | Not started | - |
| 2. Yahoo 代理端點 | 0/TBD | Not started | - |
| 3. FinMind 代理端點 | 0/TBD | Not started | - |
| 4. 防濫用強化 ＋ 部署驗收 | 0/TBD | Not started | - |
