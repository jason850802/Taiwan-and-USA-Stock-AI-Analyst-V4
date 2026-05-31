# Taiwan & USA Stock AI Analyst

## What This Is

一個給個人投資者使用的台股／美股技術分析工具（繁體中文介面）。使用者搜尋股票後，App 抓取行情、計算技術指標、依朱家泓「六六大順」進場法則做出客觀的 GO/WAIT/NO_GO 判斷，再由 Google Gemini 產生中文分析報告；另含一個可做 AI 健檢的庫存（Portfolio）功能。目前為純前端 React 單頁應用，所有外部呼叫都在瀏覽器端進行、無後端。

## Core Value

讓使用者對任一檔台股／美股，得到一個「客觀進場判斷 ＋ AI 中文解讀」的可信分析 —— 而這份分析所依賴的金鑰與資料來源必須是安全、穩定、不會被盜用或竄改的。

## Requirements

### Validated

<!-- 由現有程式碼推斷，已實作並依賴中。 -->

- ✓ 股票搜尋：台股本地目錄（FinMind）＋ 美股 Yahoo 搜尋的自動完成 — existing
- ✓ 行情抓取與正規化：Yahoo 為主、FinMind 為輔（含 CORS proxy 輪替與 fallback） — existing
- ✓ 技術指標計算：SMA/EMA/RSI/MACD/KDJ/Bollinger，RAW 與還原權值雙套 — existing
- ✓ 朱家泓「六六大順」進場過濾器：純函式產出客觀 EntryFilterResult（趨勢/六步驟/SOP/戒律/決策/進出場價） — existing
- ✓ K 線／均線／指標圖表（Recharts） — existing
- ✓ Gemini 中文分析報告（方案C：AI 只解讀客觀判斷、不覆寫） — existing
- ✓ 庫存管理：持股表、成本/股數編輯、AI 健檢與個股操作決策分析 — existing
- ✓ localStorage 持久化（庫存、台股目錄快取） — existing

### Active

<!-- 本里程碑要建造的範圍：加一層 Vercel Serverless 後端代理，根治金鑰外洩與公用 proxy 風險。 -->

- [ ] 在 Vercel 上建立 Serverless 後端，把 `GEMINI_API_KEY` 移到伺服器端環境變數，前端 bundle 不再內嵌金鑰
- [ ] 後端代理所有 Gemini 呼叫；前端改為呼叫自家端點而非直接呼叫 Google
- [ ] 後端代理所有 Yahoo Finance 行情/搜尋呼叫，移除前端對公用 CORS proxy 的依賴
- [ ] 後端代理所有 FinMind 呼叫（目錄、籌碼、價量、中文名稱）
- [ ] 後端端點加上基本防濫用機制（驗證／速率限制，避免他人盜用金鑰額度）
- [ ] 把 Gemini 模型名稱集中到後端設定（修正寫死且疑似失效的模型 ID，避免分析整批失敗）
- [ ] 前端資料服務層（`services/yahoo.ts`、`services/stockDirectory.ts`、`services/gemini.ts`）改接後端端點，行為對使用者維持不變

### Out of Scope

<!-- 本里程碑明確不做，留待後續。 -->

- 資料正確性修正（量能基準不一致、盤中量能預估失真、股價 NaN 驗證） — 屬獨立主題，留待下個里程碑，避免本次範圍膨脹
- React Error Boundary 與錯誤訊息分類 — 穩定性主題，後續處理
- 全站強制免責聲明 UI — 後續 UX 里程碑
- 技術債清理（死碼移除、常數集中、拆分 gemini.ts） — 重構主題，獨立進行
- 自動化測試建置 — 獨立主題，待核心邏輯穩定後再補
- 使用者帳號／登入系統 — 這是個人工具，不需要多使用者身分
- 改用付費行情供應商 — 本次仍沿用 Yahoo/FinMind，只是改由後端呼叫

## Context

**現況技術環境：**
- React 19 + TypeScript 5.8 + Vite 6，純前端單頁應用，無 router（以 `currentView` 切換 dashboard/portfolio）
- 狀態集中於 `App.tsx`；`Portfolio.tsx` 為自帶狀態的大型功能元件
- 樣式走 Tailwind Play CDN；npm 依賴在部署的 `index.html` 以 esm.sh importmap 載入
- 來源自 Google AI Studio，目前主要在本機以 `start-stock-analyst.bat`（port 3000）執行

**驅動本里程碑的已知問題（來自 `.planning/codebase/CONCERNS.md`）：**
- CRITICAL：`vite.config.ts` 以 `define` 把 `GEMINI_API_KEY` 文字替換進前端 bundle，金鑰隨任何已部署版本公開外洩，可被盜刷 Google 帳單
- 所有 Yahoo 行情都繞經 `corsproxy.io` / `api.allorigins.win` 等公用代理，存在限流、停機、竄改財務資料的風險
- Gemini 模型名稱寫死為 `gemini-3.5-flash` / `gemini-3.1-pro-preview`（疑似非有效 ID），失效時每次分析直接失敗

**本里程碑的本質：** 架構轉型 —— 從「純前端靜態站」演進為「前端 ＋ 一層 Vercel Serverless 後端代理」，且對終端使用者的功能行為維持不變。

## Constraints

- **Security**: `GEMINI_API_KEY` 只能存在於 Vercel 環境變數，絕不可再出現在前端 bundle 或 git — 這是本里程碑的根本目的
- **Tech stack**: 後端採 Vercel Serverless 函式（非自管伺服器），與既有 Vite 靜態站整合 — 部署與維運成本最低
- **Compatibility**: 前端介面與分析行為對使用者維持不變；資料服務層改接後端端點但回傳的領域型別（`StockDataPoint[]` 等）保持相容 — 避免動到圖表、過濾器、提示詞
- **Dependencies**: 行情仍沿用 Yahoo Finance（非官方端點）與 FinMind 免費層，僅改由後端呼叫 — 本次不換供應商
- **Budget**: 盡量落在 Vercel 免費層額度內 — 個人專案

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 本里程碑聚焦「安全性：後端代理」 | 金鑰外洩是 CONCERNS 中唯一 CRITICAL、會直接造成金錢損失 | — Pending |
| 後端採 Vercel Serverless 函式 | 與 Vite 靜態站整合最順、免費層足夠、設定最少 | — Pending |
| 一次代理 Gemini ＋ Yahoo ＋ FinMind | 同時根治金鑰外洩與公用 proxy 依賴兩大風險 | — Pending |
| 端點加基本防濫用（驗證／速率限制） | 金鑰藏到後端後，需防止他人透過端點盜用 Gemini 額度 | — Pending |
| 順帶把 Gemini 模型名稱集中到後端設定 | 搬遷時自然一併修正寫死且疑似失效的模型 ID | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-01 after initialization*
