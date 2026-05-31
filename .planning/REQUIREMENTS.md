# Requirements: Taiwan & USA Stock AI Analyst — Vercel Serverless 後端代理層

**Defined:** 2026-06-01
**Core Value:** 讓使用者對任一檔台股／美股得到「客觀進場判斷 ＋ AI 中文解讀」的可信分析，而其依賴的金鑰與資料來源必須安全、穩定、不被盜用或竄改。

## v1 Requirements

本里程碑的提交範圍。每項對應到路線圖階段。本里程碑的鐵則：**對終端使用者的功能行為維持不變**，差別只在金鑰與資料來源改由後端處理。

### 後端基礎建設（CORE）

- [ ] **CORE-01**: 後端建立 `api/_lib/` 共用層，提供同源/Origin 檢查、upstream fetch＋逾時、環境變數讀取與 upstream 錯誤映射
- [ ] **CORE-02**: 所有 Vercel 函式採 Node.js runtime（與 @google/genai 相容），並各自設定 `maxDuration`（Gemini 120s、行情端點 30s），避免落入預設逾時被砍
- [ ] **CORE-03**: `vercel dev` 能在本地單一 port 同時跑前端與 `/api/*` 端點

### 金鑰封存（KEY）

- [ ] **KEY-01**: 移除 `vite.config.ts` 的 `GEMINI_API_KEY` define 注入，前端 bundle 不再內嵌金鑰
- [ ] **KEY-02**: `GEMINI_API_KEY` 只存於 Vercel 環境變數、僅由後端讀取，且不使用 `VITE_` 前綴
- [ ] **KEY-03**: build 後對 `dist/` 掃描金鑰（grep `AIza`）結果為 0，作為金鑰未外洩的驗收
- [ ] **KEY-04**: 所有錯誤一律經後端分類層回傳 `{ code, message }`，不透傳 upstream 原文（避免金鑰或敏感資訊外洩）

### 代理端點（PROXY）

- [ ] **PROXY-01**: 所有 Gemini 呼叫改走 `/api/gemini`，前端不再 `new GoogleGenAI`、不再持有金鑰
- [ ] **PROXY-02**: Gemini 模型 ID 集中為環境變數（`GEMINI_MODEL_FAST` / `GEMINI_MODEL_THINKING`），production 預設用 stable ID，並提供 `MODEL_NOT_FOUND` 獨立錯誤分類與 fallback
- [ ] **PROXY-03**: 所有 Yahoo 行情/搜尋呼叫改走 `/api/yahoo/*`，後端實作完整 cookie/crumb 握手（含瀏覽器式 UA、crumb 短 TTL 快取），移除前端對公用 CORS proxy 的依賴
- [ ] **PROXY-04**: 所有 FinMind 呼叫改走 `/api/finmind`，後端注入 `FINMIND_TOKEN`，並以 dataset 白名單分流
- [ ] **PROXY-05**: FinMind 籌碼資料後端快取到當日；資料不可用時明確回傳 `chipDataUnavailable` 狀態，而非以空陣列假裝真實 0
- [ ] **PROXY-06**: 所有代理回傳維持既有領域型別契約（`StockDataPoint[]` 等），前端圖表/過濾器/提示詞無須改動

### 防濫用（GUARD）

- [ ] **GUARD-01**: 端點加上以 Upstash 持久化的 per-IP 速率限制（`/api/gemini` 嚴、行情端點較寬）
- [ ] **GUARD-02**: 後端 CORS allowlist 只允許自家 production 網域 origin，並正確處理 OPTIONS preflight
- [ ] **GUARD-03**: 端點加上共享密鑰驗證，阻擋非自家前端的呼叫
- [ ] **GUARD-04**: 端點對輸入參數做白名單/驗證（interval/range/dataset 等），防止被當成開放代理（SSRF）

### 前端改接（FE）

- [ ] **FE-01**: `services/gemini.ts` 改接 `/api/gemini`，回傳契約與既有行為不變
- [ ] **FE-02**: `services/yahoo.ts` 改接 `/api/yahoo/*`，`StockDataPoint[]` 契約不變
- [ ] **FE-03**: `services/stockDirectory.ts` 改接 `/api/finmind` 與 `/api/yahoo/search`，搜尋與目錄行為不變

### 部署與文件（DEPLOY）

- [ ] **DEPLOY-01**: 提供 `.env.example`，列出所有必要環境變數（Gemini 金鑰、模型 ID、FinMind token、Upstash、共享密鑰）
- [ ] **DEPLOY-02**: 部署文件涵蓋 Vercel 設定、FinMind token 取得方式、以及在 Google Cloud 設定 Gemini 每日配額上限（最後財務防線）的指引

## v2 Requirements

延後到後續釋出。已記錄但不在本次路線圖。

### 效能與體驗（差異化）

- **CACHE-01**: 後端快取 FinMind 目錄/籌碼與 FX 匯率（優先用 Vercel CDN `s-maxage`，必要才上 Upstash KV）
- **STREAM-01**: Gemini 串流回應（前端漸進渲染）—— 純 UX 升級，非繞逾時所需
- **VALID-01**: 上游 payload 的 schema 驗證（zod guard），上游格式變動時失敗於明處而非餵壞數字

## Out of Scope

明確排除，記錄以防範圍膨脹。

| Feature | Reason |
|---------|--------|
| 多金鑰輪替 | 單人用量用不到，徒增複雜度 |
| HMAC 請求簽章 | 個人工具用裸共享密鑰已足夠 |
| OAuth／帳號／登入系統 | 個人工具不需多使用者身分（PROJECT.md 明確排除） |
| 把指標計算搬到後端 | 會破壞 `StockDataPoint[]` 契約相容並撞 Vercel 執行時間限制；本里程碑只代理、不重構管線 |
| 資料正確性語意修正（量能基準不一致、盤中量能預估失真、股價 NaN 驗證） | 屬獨立主題，留待下個里程碑 |
| React Error Boundary 與錯誤訊息分類（前端 UI 層） | 穩定性主題，後續處理（後端已做錯誤分類） |
| 全站強制免責聲明 UI | 後續 UX 里程碑 |
| 技術債清理（死碼移除、常數集中、拆分 gemini.ts） | 重構主題，獨立進行 |
| 自動化測試建置 | 獨立主題，待核心邏輯穩定後再補 |
| 改用付費行情供應商 | 本次仍沿用 Yahoo/FinMind，只是改由後端呼叫 |

## Traceability

各階段覆蓋哪些需求。於路線圖建立時填入。

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | TBD | Pending |
| CORE-02 | TBD | Pending |
| CORE-03 | TBD | Pending |
| KEY-01 | TBD | Pending |
| KEY-02 | TBD | Pending |
| KEY-03 | TBD | Pending |
| KEY-04 | TBD | Pending |
| PROXY-01 | TBD | Pending |
| PROXY-02 | TBD | Pending |
| PROXY-03 | TBD | Pending |
| PROXY-04 | TBD | Pending |
| PROXY-05 | TBD | Pending |
| PROXY-06 | TBD | Pending |
| GUARD-01 | TBD | Pending |
| GUARD-02 | TBD | Pending |
| GUARD-03 | TBD | Pending |
| GUARD-04 | TBD | Pending |
| FE-01 | TBD | Pending |
| FE-02 | TBD | Pending |
| FE-03 | TBD | Pending |
| DEPLOY-01 | TBD | Pending |
| DEPLOY-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 0（待路線圖填入）
- Unmapped: 22 ⚠️

---
*Requirements defined: 2026-06-01*
*Last updated: 2026-06-01 after initial definition*
