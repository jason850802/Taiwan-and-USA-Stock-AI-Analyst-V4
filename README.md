# Taiwan & USA Stock AI Analyst

給個人投資者的台股／美股技術分析工具（繁體中文介面）。使用流程：搜尋股票 → 抓行情、算技術指標 → 依朱家泓「六六大順」法則產出客觀的 **GO／WAIT／NO_GO** 進場判斷 → 交由 Google Gemini 產生中文分析報告；另有可對持股做 AI 健檢的庫存（Portfolio）功能。

專案目前為純前端 React SPA（無傳統後端），對外部服務的呼叫改由 **Vercel Serverless 函式**代理。`GEMINI_API_KEY` 只存在於 Vercel 環境變數，**絕不進入前端 bundle 或 git**——這是本專案的安全紅線。

## 核心價值與特色

- **客觀進場判斷＋AI 中文解讀**：對任一檔台股／美股，先用朱家泓法則機械化算出進場判斷，再由 Gemini 產生可讀的中文分析。
- **行情資料來源**：Yahoo Finance（非官方）為主，失敗時 fallback 到 FinMind 免費層；429 限流是常態。
- **金鑰後端代理保護**：Gemini 金鑰只放在 Vercel 環境變數，由 Serverless 函式代理呼叫，前端 bundle 與 git 內都不出現金鑰。
- **成本控制**：力求整體落在 Vercel 免費層。

## 在地執行（Run Locally）

**前置需求：** Node.js

1. 安裝相依套件：

   ```
   npm install
   ```

2. 設定環境變數：
   - 正式部署時，`GEMINI_API_KEY` 放在 **Vercel 環境變數**。
   - 本地開發時，放在專案根目錄的 `.env.local`／`.env`。除了金鑰，另可設定：
     - `GEMINI_MODEL_FAST`、`GEMINI_MODEL_THINKING`（Gemini 型號）
     - `ALLOWED_ORIGIN`（允許的來源）
     - `FINMIND_TOKEN`（選填）
   - 金鑰**不可**進入前端 bundle 或 git。

3. 啟動本地雙伺服器（前後端各一）：

   ```
   # 視窗 A：後端 Serverless 代理（listen 3001）
   npx vercel dev --listen 3001

   # 視窗 B：前端 Vite dev server（3000）
   npm run dev
   ```

   兩者都就緒後，瀏覽器開 **http://localhost:3000**；前端的 `/api` 請求由 Vite proxy 轉給後端 3001。
   固定的起環境流程請見 `start-dev` skill（助手會用 PowerShell `Start-Process` 開兩個獨立視窗並輪詢兩埠就緒）。

4. 金鑰外洩驗證：`npm run build` 後，對 `dist/` 掃描字串 `AIza`（Gemini 金鑰前綴）應**無任何結果**。

## Claude Code Skills（`.claude/skills/`）

本專案在 `.claude/skills/` 內放了一組 skill，讓 Claude／Codex 依朱家泓法則做技術分析，並固定住開發工作流。Codex 端讀取鏡像目錄 `.agents/skills/`（改動 skill 後需執行 `npm run sync:skills` 同步，白名單見 `scripts/sync_skills_mirror.py`）。

以下 10 個 skill 分三類：朱家泓 7 步驟進場分析 pipeline、台股基本面資料層、開發工作流。

### 朱家泓 7 步驟進場分析 pipeline

依序執行，每一步都以 `_shared/fetch_stock.py` 抓來的同一份 JSON 為資料源（整段分析只抓一次資料）：

| 步驟 | Skill | 說明 |
|---|---|---|
| 1 | `trend-analysis` | **趨勢研判**：判定多頭（頭頭高、底底高）／空頭／盤整，並比對日線與週線；盤整一律退出觀察、不做多。另看週線壓力空間（現價上方最近週線轉折高，距離 < 5% 時遇壓前勿做多）。 |
| 2 | `position-analysis` | **當下位置**：在多頭中定位打底／初升／主升／末升段，加上起漲／上漲中／高檔／回檔等行進狀態；套用回檔 1/2 法則（弱勢回檔續漲、強勢回檔警戒），評估追高風險。 |
| 3 | `kline-signal` | **K 線轉折**：判讀單一 K 棒與組合 K 棒（晨星／夜星／三法／吞噬／變盤線），並檢查多頭關鍵進場 K 線——價漲 > 2%、攻擊量（今量 > 昨量 ×1.3 或 > 5 日均量 ×1.2，雙軌擇一）、中長紅實體、突破 5 均並過前一日最高點。 |
| 4 | `ma-structure` | **均線架構**：檢查至少 3 線多排（MA5 > MA10 > MA20）、方向向上、收盤站上月線 MA20（未站上一律不做多）；偵測均線糾結突破與扣抵方向。 |
| 5 | `volume-analysis` | **量價關係**：確認價漲量增／攻擊量（雙軌擇一），辨識起漲量／換手量／出貨量／止跌量，並偵測量價背離；進場必須有攻擊量配合。 |
| 6 | `indicator-analysis` | **指標**：KD（5,3,3）黃金交叉且多排向上，高檔鈍化時回歸價量判斷；MACD 紅柱延長／綠柱縮短與背離；加分項為向上跳空缺口、底部型態（W 底／頭肩底等）。 |
| 7 | `entry-decision` | **進場決策彙總**：彙整前 6 步結果，比對選股 SOP 6 項必要條件、六大買點口訣、逐條檢核做多 10 大戒律，輸出 **GO／等待／NO-GO**，並附建議進場價、停損雙軌（進場價 −5% 或收盤跌破關鍵均線，擇一為主要防守）、停利規則與信心評分。這是整套分析的總入口與最終結論。 |

**使用方式**：使用者說「分析 XXXX」「XXXX 能不能買」時，從 `trend-analysis` 開始依序跑到 `entry-decision`；也可直接用 `entry-decision`，它會帶完步驟 1-6 再彙總。各步驟的判定細節請讀該 skill 的 SKILL.md，不要憑記憶重建規則。

### 台股基本面資料層

- **`tw-fundamentals`**：用 FinMind 免 token 公開 API 抓台股的損益表、資產負債表、現金流量表、PER／PBR／殖利率、月營收（YoY）、股利，整備成乾淨結構後，餵給美股估值 skill（`dcf-model`／`comps-analysis`／`initiating-coverage`／`earnings-analysis`）——補上台股缺、SEC/EDGAR 查不到的那一層財報資料。抓取腳本為 `.claude/skills/_shared/fetch_fundamentals.py`。純美股標的（AAPL 等）不需要本 skill，那些 skill 自己能從 SEC 取得資料。

### 開發工作流 skill

- **`phase-loop`**：本專案的三角開發迴圈 playbook，分四階段——規劃（寫 CONTEXT + PLAN）→ 交 Codex 執行 → Opus/Sonnet 依計畫內建 checklist 覆核 → 使用者人工驗證 → 合併回 main。內含 PLAN.md 必備結構、Codex 交接指令模板、覆核協議與合併儀式。
- **`start-dev`**：起開發環境的固定流程。助手先做前置檢查（殘留 node 程序、`.env` 變數名、埠占用），再直接用 PowerShell `Start-Process` 開兩個使用者看得見的獨立視窗（後端 `vercel dev` 3001 + 前端 Vite 3000），輪詢兩埠就緒後回報「瀏覽器開 http://localhost:3000」。

## 技術棧與資料鏈備註

- 相依套件需**同時維護兩處**：`package.json` 與 `index.html` 的 esm.sh importmap。
- 行情資料鏈：Yahoo Finance（走公共 CORS proxy 輪替）為主，失敗時 fallback 到 FinMind 免費層；遇到 429 先懷疑限流，再考慮改碼。
- 更完整的技術棧、架構、慣例與已知問題說明，見 `.planning/codebase/` 下的 `STACK.md`、`ARCHITECTURE.md`、`CONVENTIONS.md`、`CONCERNS.md`、`INTEGRATIONS.md`。
