# Project Research Summary

**Project:** Taiwan & USA Stock AI Analyst — Vercel Serverless 後端代理層
**Domain:** Vite/React 純前端 SPA 加一層 Vercel Serverless 代理（Gemini / Yahoo Finance / FinMind），金鑰移到伺服器端，端點加基本防濫用
**Researched:** 2026-06-01
**Confidence:** HIGH

---

## 研究不一致的明確結論（Reconcile）

### 1. Vercel Hobby 函式逾時上限：到底是 300s 還是 60s？

**結論：300s（Fluid Compute 預設開啟）是正確值；60s 是舊文件值，已過時。**

依據：Vercel 官方文件 functions/configuring-functions/duration（最後更新 2026-05-14）明確說明，**Fluid Compute 自 2025-04 起對所有新 Vercel 專案預設啟用**，啟用後 Hobby 方案的 maxDuration 上限為 **300 秒**。未啟用 Fluid Compute 的舊專案，Hobby 上限才是 60 秒。

研究員寫 60s 的來源是仍流通的舊比較表（Fluid Compute 普及前的資料）；寫 300s 的來源是 2026-05 官方文件，為當前正確值。

**對「Gemini thinking 長回應是否必須串流」的影響：**

300s 遠超 Gemini thinking/pro 模式的一般回應時間（通常 10-60 秒），因此：
- **串流不是繞過逾時的必要手段**，而是純 UX 升級（使用者邊看邊產生）。
- v1 可以非串流方式實作 Gemini 端點，只要每個函式設了 maxDuration = 120（gemini），就完全安全。
- 串流列為 v1.x differentiator，待安全地基穩固後再加，不在本里程碑強制要求。
- **仍必須設定 maxDuration**（避免使用預設 10s 被砍）：gemini 建議 60-120s，yahoo/finmind 建議 15-30s。

---

### 2. Gemini 模型 ID 是否有效（gemini-3.5-flash / gemini-3.1-pro-preview）？

**結論：模型 ID 目前有效；真正風險是 preview 不穩定性 + 寫死 + 錯誤分類缺失三者疊加。**

依據：ARCHITECTURE.md 引用 Gemini API 官方文件（ai.google.dev/gemini-api/docs/models，2026），gemini-3.5-flash 與 gemini-3.1-pro-preview 均為有效 ID（先前審計疑為失效屬訓練資料過時）。PITFALLS.md 同樣明確標注「目前是有效的 model ID」。

**本里程碑的明確立場：**

不應假設 ID 無效，而應做這三件事：
1. **集中到後端設定**：GEMINI_MODEL_FAST / GEMINI_MODEL_THINKING 存為 Vercel 環境變數，由 api/_lib/config.ts 讀取，改模型不動程式碼。
2. **加錯誤分類**：MODEL_NOT_FOUND（Gemini 404）獨立成一類錯誤回前端，前端可顯示可辨識訊息（非「分析失敗」）。
3. **production 改用 stable ID**：thinking 路徑的 gemini-3.1-pro-preview 在 production 預設應換成當期 stable（如 gemini-2.5-pro）；preview 模型可於部署 N+2 週後無通知下架。

---

## Executive Summary

本里程碑是一次「架構轉型」，而非新功能建造：將一個純前端 Vite/React SPA 演進為「前端 + 一層 Vercel Serverless 後端代理」。驅動因素是三個 CRITICAL/HIGH 問題：(1) GEMINI_API_KEY 透過 vite.config.ts 的 define 注入硬編入前端 bundle，任何已部署版本都已外洩，可被盜刷帳單；(2) 所有 Yahoo 行情都繞經公用 CORS proxy（corsproxy.io/allorigins.win），存在限流、停機、竄改財務資料風險；(3) Gemini 模型名稱寫死，失效或 preview 下架時整批分析靜默失敗。

推薦做法是在現有 Vite 專案根目錄加一個 api/ 目錄，讓 Vercel 自動把每支 TypeScript 檔案編譯成 Serverless Function（Node.js runtime）。四個端點（/api/gemini、/api/yahoo/chart、/api/yahoo/search、/api/finmind）共享一個 api/_lib/ 共用層（CORS/同源檢查、速率限制、upstream fetch + 錯誤映射）。前端 services 層只改「呼叫誰」，回傳的領域型別（StockDataPoint[] 等）完全不動，對使用者行為透明。

關鍵風險有三：(1) 金鑰搬後仍從前端洩漏（VITE_ 前綴 / upstream error 透傳 / log），預防方式是移除所有 define 注入、建立錯誤分類層、build 後 grep AIza dist/ 驗收；(2) Yahoo 非官方端點從 Vercel datacenter IP 呼叫需 cookie/crumb 握手（本機測正常、部署後 401 是常見陷阱）；(3) FinMind 免費層從共用伺服器 IP 集中計數，比前端直連更快撞 300/hr 限流，需帶 token + 積極快取。

---

## Key Findings

### Recommended Stack

後端選 **Node.js runtime**（非 Edge），因為 @google/genai SDK 依賴鏈含 node-fetch/fetch-blob，Edge V8 isolate 最小 API 面不保證相容；Vercel 官方現在也建議從 Edge 遷回 Node。HTTP 轉發使用 Node 18+ 內建全域 fetch，不需要 axios/node-fetch。速率限制選 @upstash/ratelimit + @upstash/redis（HTTP-based、connectionless，適合 serverless 無常駐連線），優先於 in-memory 計數器（多實例 + 冷啟動下不可靠）。Gemini SDK 趁搬遷升級到 @google/genai@^2.7.0（2.x GA 版），同時把模型 ID 集中到環境變數。

**Core technologies:**

- **Vercel Functions（Node.js runtime）**：承載 /api/* 端點 — Node runtime 相容 @google/genai、Fluid Compute 預設開啟（Hobby 最長 300s）
- **@google/genai@^2.7.0**：後端呼叫 Gemini — 2025-05 GA，只在後端 import，前端不再知道金鑰
- **@upstash/ratelimit@^2.0.8 + @upstash/redis@^1.35**：持久化速率限制 — connectionless HTTP，跨 serverless 實例共享狀態
- **原生 fetch（Node 18+ 內建）**：轉發 Yahoo / FinMind — 不需要額外 HTTP client
- **zod@^3.24（建議）**：後端輸入驗證 — 防止端點被當開放代理（SSRF）
- **Vercel CLI（vercel dev）**：本地開發 — 單一 port 同時跑前端 + /api

### Expected Features

**Must have（v1 Table Stakes）：**
- **伺服器端金鑰注入** — 移除 vite.config.ts 的 define 注入；金鑰只存 Vercel 環境變數；build 後 grep AIza dist/ = 0
- **Gemini 代理端點（含模型名稱集中設定）** — 前端不再 new GoogleGenAI；模型 ID 存環境變數；MODEL_NOT_FOUND 獨立錯誤分類
- **Yahoo 代理端點（含 cookie/crumb 握手）** — 移除公用 CORS proxy；後端實作完整 Yahoo 握手（cookie → crumb → 帶參請求）
- **FinMind 代理端點（含 token + 快取）** — 目錄/籌碼/日線後端化；帶 token（600/hr）；籌碼快取到當日
- **CORS allowlist** — 只回應自家 production 網域 origin；正確處理 OPTIONS preflight
- **防濫用：IP 速率限制（Upstash）+ 共享密鑰** — 持久化限流；搭配 Google 端每日配額上限
- **回應正規化（維持領域型別）+ 錯誤分類** — 後端啞代理（Yahoo/FinMind 回原始 JSON）；Gemini 回 { text }；錯誤回 { code, message }
- **前端服務層改接後端** — services/yahoo.ts、stockDirectory.ts、gemini.ts 只換目標 URL，契約不變
- **.env.example + 部署文件** — 列出所有必要環境變數

**Should have（v1.x Differentiators）：**
- **後端快取（FinMind 目錄/籌碼 + FX）** — 優先用 Vercel CDN s-maxage（零額外服務）；必要才上 Upstash KV
- **Gemini 串流回應** — UX 升級（非繞 timeout）；需改前端漸進渲染；待 v1 安全地基穩固後
- **上游 schema 驗證（zod guard）** — 上游格式變動造成壞數字時升級

**Defer（v2+）：**
- 多金鑰輪替（單人用量用不到）
- HMAC 簽章（裸共享密鑰對個人工具已足夠）
- 完整 OAuth / 帳號系統（PROJECT.md 明確 Out of Scope）

### Architecture Approach

整體模式是「薄客戶端 + 薄後端代理」：前端 services 層只改目標 URL，後端只做轉發（Yahoo/FinMind 為啞代理，回原始 JSON；Gemini 持金鑰決定模型，回 { text }）。指標計算、normalize、prompt 組裝全部留前端，避免把低風險代理工作膨脹成高風險管線移植。

**Major components:**

1. **api/_lib/（後端共用，底線前綴不成路由）** — 同源/Referer 檢查、Upstash rate-limit、upstream fetch + 逾時 + 錯誤映射、環境變數讀取
2. **api/gemini.ts** — POST，持 GEMINI_API_KEY，mode 映射模型，回 { text }；Gemini 唯一金鑰所在地
3. **api/yahoo/chart.ts + api/yahoo/search.ts** — GET，完整 cookie/crumb 握手，參數白名單，啞代理回 Yahoo 原始 JSON
4. **api/finmind.ts** — GET，注入 FINMIND_TOKEN，dataset 白名單，快取響應，啞代理回 FinMind 原始 JSON
5. **services/*.ts（前端，唯一改動點）** — 把 PROXIES / 直連 Google 換成 fetch('/api/...')；回傳型別不變

### Critical Pitfalls

1. **金鑰搬後仍三條路徑洩漏** — 移除所有 VITE_ 前綴與 define 注入；錯誤永遠走分類（不透傳 upstream error 原文）；build 後 grep AIza dist/ = 0；上線後立即輪換舊金鑰
2. **Yahoo 從 Vercel datacenter IP 直連被 401/crumb 挑戰** — 必須實作完整握手（GET cookie → getcrumb → 帶 crumb 請求）+ 瀏覽器式 UA；crumb 快取短 TTL（~10 分）自動重取；本機正常不代表 Vercel 正常
3. **FinMind 共用 IP 快速撞 300/hr 免費限流** — 帶 FINMIND_TOKEN（升至 600/hr）；籌碼資料快取到當日；籌碼不可用時明確回 chipDataUnavailable: true（而非假裝 []）
4. **Gemini 模型寫死 + preview 下架 + 無錯誤分類三疊加** — 環境變數存模型 ID；production 用 stable（非 preview）；MODEL_NOT_FOUND 獨立分類 + fallback 模型常數
5. **防濫用用 in-memory 計數器（serverless 多實例失效）** — 一律改用 Upstash Redis 做 per-IP 持久化限流；同時在 GCP 設每日配額上限作為最後財務防線

---

## Implications for Roadmap

基於研究，建議四個實作階段（與 ARCHITECTURE.md 建議的建置順序吻合）：

### Phase 1：後端骨架 + Gemini 端點（金鑰封存）

**Rationale:** 唯一 CRITICAL 問題（金鑰外洩直接燒錢）；Gemini 端點是最小可驗證的端到端切片（一個端點、回傳單純字串）；先做能立刻封住金錢風險，並驗證「前端→/api→第三方→回前端」整條鏈路在 Vercel 上通。
**Delivers:** 建立 api/_lib/（http/guard/config）；實作 api/gemini.ts；移除 vite.config.ts 的 define 注入；前端 services/gemini.ts 改接後端；設好 maxDuration = 120；GEMINI_MODEL_FAST / GEMINI_MODEL_THINKING 環境變數；MODEL_NOT_FOUND 錯誤分類。
**Addresses:** Table stakes 1-2（金鑰注入、Gemini 代理）、Pitfall 1（金鑰洩漏）、Pitfall 6（模型寫死）。
**Avoids:** 把 define 忘了移除；用 VITE_ 前綴；upstream error 透傳前端；preview 模型做 production 預設。

### Phase 2：Yahoo 代理端點（去公用 Proxy）

**Rationale:** 影響最廣（主分析路徑全靠 Yahoo）；啞代理模式契約不變；完成後立即消除公用 CORS proxy 風險。Yahoo 的 cookie/crumb 握手是本里程碑技術複雜度最高的部分，獨立成 phase 便於集中解決。
**Delivers:** 實作 api/yahoo/chart.ts + api/yahoo/search.ts；完整 cookie/crumb 握手（帶瀏覽器式 UA）；crumb 記憶體快取（~10 分 TTL，過期自動重取）；interval/range 白名單；前端 services/yahoo.ts / stockDirectory.searchYahoo 改接後端；移除 corsproxy.io / allorigins.win 依賴。
**Addresses:** Table stakes 3（Yahoo 代理）、Pitfall 3（401/crumb 挑戰）。
**Avoids:** 只把 fetch 搬到後端不做 cookie/crumb 握手；本機測試忘了在 Vercel 上驗 >=30 分不出 401。

### Phase 3：FinMind 代理端點（後端集中）

**Rationale:** FinMind 是 Yahoo 的 fallback/enrichment，順序上在 Yahoo 穩定後做；風險最低，但共用 IP 限流問題必須處理，否則籌碼資料部署後靜默失效。
**Delivers:** 實作 api/finmind.ts；注入 FINMIND_TOKEN（環境變數）；籌碼/價量快取到當日（Cache-Control: s-maxage）；dataset 白名單；明確 chipDataUnavailable 狀態回前端（不用 [] 假裝真實 0）；前端 stockDirectory.ensureTaiwanDirectory 改接後端。
**Addresses:** Table stakes 4（FinMind 代理）、Pitfall 4（FinMind 共用 IP 限流）。
**Avoids:** 不帶 token 就上線；籌碼限流後靜默回 [] 誤導判斷。

### Phase 4：防濫用強化 + 部署驗收

**Rationale:** 四個端點到位後，統一套上防濫用層（而非每個端點各自寫）；最後做可確保規則一致、閾值合理，且可在真實流量下觀測再調整。
**Delivers:** Upstash per-IP sliding window（/api/gemini 嚴、行情端點較寬）；Origin/Referer 檢查；共享密鑰 header；CORS allowlist；.env.example；build 後 grep AIza dist/ = 0 驗收；GCP 每日配額上限設定指引；vercel.json 逾時設定；部署到 Vercel 的 smoke test 清單。
**Addresses:** Table stakes 5-9（CORS、防濫用、.env.example）、Pitfall 5（CORS）、Pitfall 7（防濫用弱/強）、Pitfall 8（冷啟動 skeleton）。
**Avoids:** 上線後端點裸奔；Access-Control-Allow-Origin: *；in-memory rate limit；忘了輪換舊金鑰。

### Phase Ordering Rationale

- **Gemini 優先**：唯一 CRITICAL 金錢風險，最小端到端切片，驗證基礎設施可行性。
- **Yahoo 次之**：主要資料路徑，技術最複雜（cookie/crumb），獨立處理更安全。
- **FinMind 第三**：是 Yahoo fallback，依賴關係明確，技術複雜度低。
- **防濫用最後**：api/_lib/guard 骨架在 Phase 1 就建好；Phase 4 只是統一補強、驗收並設 GCP 財務防線。

### Research Flags

需要較深研究的 phase：
- **Phase 2（Yahoo 代理）：** Yahoo 非官方端點的 cookie/crumb 握手行為隨時間可能改變；建議 Phase 2 實作後立即在 Vercel 環境（非本機）實測 >=30 分鐘驗證；可 review 最新 yahoo-finance2 社群 issue 取得最新握手技巧。

標準模式（可跳過深度研究）的 phase：
- **Phase 1（後端骨架 + Gemini）：** Vercel Functions 檔案式路由、Node runtime、環境變數讀取均有官方文件高可信度佐證。
- **Phase 3（FinMind）：** 啞代理 + FinMind 官方 API 文件（MEDIUM-HIGH）；Cache-Control: s-maxage 是 Vercel 標準用法。
- **Phase 4（防濫用）：** Upstash + Vercel 整合有完整官方範本；CORS 模式是 Web 標準。

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Vercel/Upstash/npm 官方文件查證；Node runtime 選擇、@google/genai 版本、Upstash 免費層均以官方文件驗證 |
| Features | HIGH | 功能取捨基於 PROJECT.md 一手約束 + 官方限制文件；個人工具防濫用強度判斷為工程慣例（MEDIUM） |
| Architecture | HIGH | 前後端切分依既有契約推導，Vercel 慣例有官方文件；Yahoo cookie/crumb 為社群實測（MEDIUM-HIGH） |
| Pitfalls | HIGH | Vercel 逾時、Vite 前綴外洩、FinMind 限流數字、Gemini 模型策略均有官方/一手來源；冷啟動延遲體感為社群觀察（MEDIUM） |

**Overall confidence:** HIGH

### Gaps to Address

- **Yahoo cookie/crumb 行為**：非官方端點的握手機制為社群實測（MEDIUM-HIGH），Phase 2 實作後須在 Vercel 環境驗測 >=30 分鐘，不能只靠本機。
- **vercel dev + Vite 6 整合**：社群回報有整合坑（LOW-MEDIUM）；先試單進程，遇問題退回 server.proxy + vercel dev 雙進程。
- **Gemini thinking 模式實際延遲**：Phase 1 需以真實技術分析提示測量 pro 模式回應時間，確認 maxDuration = 120 是否足夠或需調整 thinkingBudget。
- **FinMind token 申請流程**：Phase 3 需在 .env.example 與部署文件中清楚說明取得與設定方式。

---

## Sources

### Primary（HIGH confidence）

- https://vercel.com/docs/functions/configuring-functions/duration — Hobby Fluid Compute 預設 300s maxDuration（官方，2026-05-14）
- https://vercel.com/docs/functions/limitations — Hobby 限制：記憶體 2GB、4.5MB payload、Active CPU 不計 I/O（官方，2026-05-14）
- https://vercel.com/docs/plans/hobby — Hobby 額度：4 CPU-hrs、100 GB-Hours、WAF 規則上限（官方，2026-02-27）
- https://vercel.com/docs/functions/runtimes/node-js — Node.js runtime、/api 檔案式 function（官方，2026-05-19）
- https://vercel.com/docs/fluid-compute — Fluid Compute 2025-04 起預設（官方）
- https://ai.google.dev/gemini-api/docs/models — Gemini 模型清單、stable vs preview（官方，2026）
- https://ai.google.dev/gemini-api/docs/thinking — thinking 模式、generateContentStream（官方）
- https://www.npmjs.com/package/@google/genai — 2.7.0 GA、Node 18+（npm 官方）
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview — serverless rate limit 設計（官方）
- https://finmind.github.io/api_usage_count/ — 未登入 300/hr、登入 600/hr（官方）
- .planning/PROJECT.md、.planning/codebase/CONCERNS.md、.planning/codebase/INTEGRATIONS.md（一手稽核，HIGH）

### Secondary（MEDIUM-HIGH confidence）

- https://vite.dev/guide/env-and-mode — VITE_ 前綴字面替換外洩機制（官方）
- https://www.npmjs.com/package/@upstash/ratelimit — 2.0.8（npm 官方）
- https://upstash.com/blog/redis-new-pricing — 免費層 500K/月（官方部落格，2025-03）
- https://github.com/gadicc/yahoo-finance2/issues/741 — Yahoo cookie/crumb 握手與過期行為（社群一手實測）

### Tertiary（LOW-MEDIUM confidence）

- Vercel blog + GitHub discussions — vercel dev 與 Vite 整合已知坑（社群回報，需實測驗證）
- 社群 Gemini-on-Vercel proxy 專案 — 多金鑰、串流模式慣例（LOW-MEDIUM）

---

*Research completed: 2026-06-01*
*Ready for roadmap: yes*
