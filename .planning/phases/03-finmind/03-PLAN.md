---
phase: 03-finmind
plan: 01
type: execute
wave: 1
depends_on: [01-gemini, 02-yahoo]
files_modified:
  - api/_lib/finmind.ts
  - api/finmind.ts
  - services/yahoo.ts
  - services/stockDirectory.ts
  - types.ts
  - App.tsx
  - components/StockChart.tsx
  - .env.example
autonomous: false
requirements: [PROXY-04, PROXY-05, FE-03]
design_authority: .planning/phases/03-finmind/03-CONTEXT.md

must_haves:
  truths:
    - "前端不再直連 api.finmindtrade.com（services/ 內 grep 歸零）；token 只存在後端環境變數"
    - "/api/finmind 只接受 dataset 白名單（前端現用五個），非白名單回 400；回應為 FinMind 原始 JSON"
    - "所有 /api/finmind 成功回應帶 Cache-Control: s-maxage 到台北當日 24:00（快取是限流的承重牆）"
    - "籌碼整包抓取失敗時：欄位維持 undefined（不塞 0）、StockInfo.chipDataUnavailable=true、圖表顯示『籌碼暫不可用』徽章"
    - "台股搜尋/目錄/籌碼的正常行為與現在一致；gemini.ts 零改動（N/A 分支自動受益）"
    - "StockChart 雷區：只動 hasChipData/viewOptions/標題列 JSX/props，Bar/Cell/軸/拖曳零觸碰"
  artifacts:
    - path: "api/finmind.ts"
      provides: "GET 薄代理：dataset 白名單、token 選填注入、s-maxage 快取、{code,message} 錯誤"
      exports: ["default", "maxDuration"]
    - path: "api/_lib/finmind.ts"
      provides: "白名單驗證、FinMindClassifiedError/classify、到台北當日結束的秒數計算"
  key_links:
    - from: "services/yahoo.ts"
      to: "/api/finmind"
      via: "四個 FinMind fetcher 改接同源端點"
      pattern: "fetch\\(.*api/finmind"
    - from: "services/stockDirectory.ts"
      to: "/api/finmind"
      via: "ensureTaiwanDirectory 目錄抓取"
      pattern: "fetch\\(.*api/finmind"
    - from: "components/StockChart.tsx"
      to: "chipDataUnavailable prop"
      via: "App 下傳旗標，取代全 0 猜測"
      pattern: "chipDataUnavailable"
---

<objective>
GSD 後端里程碑第三棒：FinMind 全面代理化。前端五個直連呼叫改走 `/api/finmind`（dataset 白名單、
選填 token、CDN 快取到當日），並完成本期靈魂——**籌碼誠實化**：抓不到就說抓不到
（undefined＋明確旗標＋UI 徽章），不再把失敗偽裝成「外資買賣超 = 0」的假圖。

Purpose: token 與限流集中管理（PROXY-04/05）；把「看起來有資料其實是錯的」這種最危險的靜默失敗
變成可辨識狀態（FE-03/成功標準3）。
Output: api/_lib/finmind.ts、api/finmind.ts、改接後的 services 兩檔、types/App/StockChart 的
旗標傳遞、.env.example 補 FINMIND_TOKEN。
</objective>

<context_for_cold_start_executor>
## 給冷啟動執行者的前提（無對話背景，先讀完本節；設計權威＝03-CONTEXT.md）

**專案路徑 `E:\My Project\Taiwan-and-USA-Stock-AI-Analyst-V4`（E 槽，路徑含空格必加引號）。分支 `gsd/phase-3-finmind`。**

### 鐵則（前五期經驗）
1. **薄代理**：後端回 FinMind 原始 JSON，不 normalize；前端解析邏輯零變動（除了「失敗誠實化」
   明確指定的幾行）。
2. **誠實化的語意劃線（勿擴大）**：只有「該次 chips 整包抓取失敗」→ undefined＋旗標。
   chips 抓成功但某日期在 map 缺（非交易日）→ 維持現行塞 0。真實 0 的語意不動。
3. **StockChart 雷區**：只准動 `hasChipData` 判斷（556-559）、`viewOptions` show 條件（806-812）、
   標題/toggle 列 JSX（814-841）、`StockChartProps`。Bar/Cell/軸/拖曳/recharts hooks 一行不碰。
   改完 `git diff` 自檢。
4. **gemini.ts 一行不改**（73-90/725-726/775-779 的 N/A 分支對 undefined 已有處理，自動受益）。
5. 環境：驗證命令 Git Bash（PowerShell 用 `npx.cmd`/`Select-String`）；一任務一 commit 只動
   <files>；禁止安裝 npm 套件；git 大動作前 taskkill 收乾淨 node 程序；不裝 @vercel/node
   （本地最小型別，照 api/yahoo/chart.ts）。

### 現況事實（2026-07-08 偵查，行號為快照，動手前開檔確認）
- `services/yahoo.ts`：`FINMIND_BASE`（L13-14 附近）；`fetchInstitutionalData`（184-196，
  失敗回 `[]` 於 194）；`fetchFinMindPriceVolume`（198-209，失敗回 `[]`）；`fetchFinMindStockInfo`
  （211-227，失敗回 null）；`fetchFinMindDailyData`（230-261，無資料 throw）；chips 入口
  `shouldFetchFinMindChips`＝台股且 1d（606），`Promise.all`（616-619）；**塞假 0 的元兇：
  `chipMap.get(...) || {foreign:0, trust:0}`（666）**；`symbolInfo` 組裝（749-752）。
- `services/stockDirectory.ts`：`FINMIND` 常數（16 附近）；`ensureTaiwanDirectory`（26-40）
  直連抓 `TaiwanStockInfo`；localStorage 鍵 `tw_stock_directory_v1`(+`_ts_v1`) TTL 7 天——照舊。
- `types.ts`：`StockDataPoint`（1-63，`foreignBuySell`/`investmentTrustBuySell` 目前必填 number）；
  `StockInfo`（65-70）。
- `components/StockChart.tsx`：`hasChipData`（556-559）用「全部為 0」猜有沒有籌碼——本期改為
  讀旗標；`viewOptions`（806-812）`show: hasChipData`；標題列（824-841）。
- 後端範本：`api/_lib/yahoo.ts`（ClassifiedError/classify/errorMessages/validate 模式）、
  `api/yahoo/chart.ts`（GET/origin/maxDuration=30/statusByCode/log 前綴模式）、`api/_lib/guard.ts`。
- FinMind 事實：免 token 300/hr、有 token 600/hr、**皆按來源 IP**——部署後全用戶共用 Vercel
  出口 IP，快取是承重牆；限流錯誤為 402 或訊息含 `upper limit`。

### 設計決策速查（D-01~D-08 全文在 03-CONTEXT.md，執行前必讀）
單一端點白名單分流｜薄代理原始 JSON｜token 選填 env（沒有照常打）｜s-maxage 到台北當日 24:00｜
誠實化（undefined＋StockInfo.chipDataUnavailable＋UI 徽章）｜目錄改接快取照舊｜fallback K 線同軌｜
錯誤模型照 Phase 2。
</context_for_cold_start_executor>

<tasks>

<task type="auto">
  <name>Task 1: 後端 /api/finmind（白名單、token 選填、當日快取）</name>
  <files>api/_lib/finmind.ts, api/finmind.ts, .env.example</files>
  <action>
1. `api/_lib/finmind.ts`（照 api/_lib/yahoo.ts 模式）：
   - `FinMindErrorCode = 'BAD_REQUEST' | 'RATE_LIMITED' | 'UPSTREAM_ERROR'`；
     `errorMessages`（繁中：BAD_REQUEST=「請求參數不正確。」、RATE_LIMITED=
     「FinMind 資料服務請求已達上限，請稍後再試。」、UPSTREAM_ERROR=「FinMind 資料服務暫時
     無法回應，請稍後再試。」）；`FinMindClassifiedError`；`classifyFinMindError`
     （HTTP 402/429 或上游訊息含 `upper limit` → RATE_LIMITED；其餘含逾時 → UPSTREAM_ERROR）。
   - `ALLOWED_DATASETS`：**先開 services/yahoo.ts 與 stockDirectory.ts 把現用 dataset 字串
     逐一抄出**（法人買賣超上市/上櫃、TaiwanStockPrice、TaiwanStockInfo、TaiwanOTCStockInfo；
     以現碼為準，不要憑本計畫記憶）。附註解：「基本面分頁 todo 擴充時在此加項
     （如 TaiwanStockFinancialStatements）」。
   - `validateFinMindParams(query)`：dataset ∈ 白名單；`data_id` 選填但若有需符合台股代碼
     pattern（比照 api/_lib/yahoo.ts 的台股 regex，注意 TaiwanStockInfo 目錄抓取**不帶** data_id
     也合法）；`start_date` 選填、格式 `YYYY-MM-DD`。不合法 throw BAD_REQUEST。
   - `secondsUntilTaipeiMidnight(): number`：回傳現在到台北時區（UTC+8，無 DST）當日 24:00 的
     秒數（最少 60）。附註解說明為何快取到當日（盤後資料一天一變＋共用 IP 限流承重牆）。
2. `api/finmind.ts`（照 api/yahoo/chart.ts 模式：GET only、isAllowedOrigin、本地最小型別、
   `export const maxDuration = 30`、statusByCode、`[finmind:code]` log 且不透傳上游原文）：
   - 驗參 → 組上游 URL `https://api.finmindtrade.com/api/v4/data?dataset=…&data_id=…&start_date=…`
     ＋ **若 `process.env.FINMIND_TOKEN` 存在**則附 `&token=…`（token 絕不出現在回應與 log）。
   - AbortController 逾時（25s，小於 maxDuration）。
   - 上游 2xx → `res.setHeader('Cache-Control', \`public, s-maxage=${secondsUntilTaipeiMidnight()},
     stale-while-revalidate=60\`)` 後原樣回傳 JSON。非 2xx/例外 → 分類回 `{code,message}`
     （錯誤**不**帶快取 header）。
   - FinMind 慣例：HTTP 200 但 body `status` 非 200 也算失敗——檢查 body.status 並分類
     （msg 含 upper limit → RATE_LIMITED）。
3. `.env.example` 加：`# FinMind（選填：有 token 限流較寬 600/hr，無 token 300/hr，皆按伺服器 IP）`
   ＋ `FINMIND_TOKEN=`（空佔位）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "ALLOWED_DATASETS" api/_lib/finmind.ts && grep -q "FINMIND_TOKEN" .env.example && ! grep -q "FINMIND_TOKEN" services/yahoo.ts</automated>
  </verify>
  <done>端點存在且白名單/token/快取/錯誤分類齊備；tsc 0 錯誤；token 無前端蹤跡。</done>
</task>

<task type="auto">
  <name>Task 2: services 改接＋籌碼誠實化（不再塞假 0）</name>
  <files>services/yahoo.ts, services/stockDirectory.ts, types.ts</files>
  <action>
1. `types.ts`：`StockDataPoint.foreignBuySell`/`investmentTrustBuySell` 改選填（`?: number`，
   加註解：undefined=籌碼資料不可用；0=真實無買賣超或非交易日）；`StockInfo` 加
   `chipDataUnavailable?: boolean`。
2. `services/yahoo.ts`：
   - 移除 `FINMIND_BASE`；四個 fetcher（fetchInstitutionalData/fetchFinMindPriceVolume/
     fetchFinMindStockInfo/fetchFinMindDailyData）改打同源 `/api/finmind?dataset=…`（URLSearchParams
     組參數）；各自的回傳解析（data 陣列處理）**一行不動**。
   - **誠實化（僅動這幾處）**：`fetchInstitutionalData` 失敗改回 `null`（原 194 的 `[]`）；
     `getStockData` 中 chips 為 null 時：(a) L666 那行不再 `|| {foreign:0,trust:0}` 塞 0——
     整包失敗時兩欄位**不設值**（undefined）；chips 成功時維持原邏輯（含缺日塞 0）。
     (b) `symbolInfo`（749-752）加 `chipDataUnavailable: chips === null`（僅台股 1d 路徑有意義，
     其他路徑不設或設 false，依現碼結構最小改動）。
   - `fetchFinMindDailyData` 的 throw 語意照舊（Yahoo fallback 鏈不變）。
   - 改完 grep：`grep -n "finmindtrade" services/` 必須 0 命中。
3. `services/stockDirectory.ts`：`FINMIND` 常數移除，`ensureTaiwanDirectory` 改打
   `/api/finmind?dataset=TaiwanStockInfo`；localStorage 快取流程（鍵/TTL/memCache）一行不動。
4. **全讀取點掃描**：`grep -rn "foreignBuySell\|investmentTrustBuySell" components/ services/ utils/`
   逐點確認容 undefined（已知 gemini.ts 有 N/A 分支零改動；StockChart Cell 用 `(x||0)`；
   若發現任何一處會因 undefined 崩潰，用最小 `?? 0` 或條件處理並記入 SUMMARY——但**顯示層
   不得把 unavailable 又變回 0 的假象**，僅防崩潰）。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && ! grep -rq "finmindtrade" services/ && grep -q "chipDataUnavailable" types.ts && grep -q "chipDataUnavailable" services/yahoo.ts</automated>
  </verify>
  <done>services 全走 /api/finmind；整包失敗→undefined＋旗標、成功路徑語意零變化；gemini.ts 零 diff；tsc 0 錯誤。</done>
</task>

<task type="auto">
  <name>Task 3: StockChart 顯示「籌碼暫不可用」（雷區限定改動）</name>
  <files>components/StockChart.tsx, App.tsx</files>
  <action>
1. `StockChartProps` 加 `chipDataUnavailable?: boolean`；`App.tsx` 渲染 `<StockChart …/>` 處
   下傳 `chipDataUnavailable={info?.chipDataUnavailable}`（App 既有 info state，388-391 附近）。
2. `hasChipData`（556-559）：改為 `!chipDataUnavailable && <既有的全 0 判斷>`——旗標優先，
   全 0 猜測僅在旗標未設時沿用（相容舊資料流）。
3. 副圖 toggle 列（806-841）：當 `chipDataUnavailable` 為 true，在 toggle 按鈕群旁渲染
   `<Badge variant="neutral">籌碼暫不可用</Badge>`（import components/ui/Badge），
   讓使用者知道是「抓不到」而不是「沒動作」。
4. **僅止於此**：Bar/Cell/軸/拖曳/hooks 零觸碰；改完 `git diff` 自檢 diff 只含
   props/hasChipData/toggle 列 JSX/import Badge。
  </action>
  <verify>
    <automated>cd "E:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4" && npx tsc --noEmit && grep -q "chipDataUnavailable" components/StockChart.tsx && grep -q "籌碼暫不可用" components/StockChart.tsx && npm run build 2>&1 | tail -1</automated>
  </verify>
  <done>旗標貫通 services→StockInfo→App→StockChart；不可用時顯示中性徽章；雷區 diff 自檢乾淨；build 成功。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: 人工驗證（正常路徑＋誠實化路徑＋快取 header）</name>
  <what-built>
/api/finmind 代理（白名單/選填 token/當日快取）；services 全面改接；籌碼失敗誠實化
（undefined＋chipDataUnavailable＋「籌碼暫不可用」徽章）；gemini.ts 零改動。
  </what-built>
  <how-to-verify>
起環境：`npx.cmd vercel dev --listen 3001` ＋ `npm.cmd run dev`，開 http://localhost:3000。

**A. 正常路徑（行為零變化）**
1. 搜 2330：K 線、外資/投信副圖正常；切上櫃股（如 6488）籌碼也正常（OTC dataset 分流）。
2. 清空 localStorage 的 `tw_stock_directory_v1` 後重整：台股搜尋建議仍正常（目錄改走後端）。
3. Network 分頁：只見同源 `/api/finmind?...`，**無任何 api.finmindtrade.com 直連**；
   任一 `/api/finmind` 回應 Headers 的 `Cache-Control` 含 `s-maxage=`（數值≈到今晚 24:00 秒數）。
4. AI 分析跑一次：報告正常（提示詞層零受影響）。

**B. 誠實化路徑（一次性人為製造失敗）**
5. 停掉 `vercel dev`（讓 /api 掛掉）→ 前端重新搜 2330：Yahoo 也走後端所以會整體失敗——
   這驗不出籌碼獨立失敗。**改用計畫核可的方法**：暫時把 `api/_lib/finmind.ts` 白名單中
   「法人買賣超」那一項字串改錯一個字母 → 重啟 vercel dev → 搜 2330：
   K 線應正常（TaiwanStockPrice 沒壞），外資/投信副圖選項消失、出現「**籌碼暫不可用**」徽章，
   AI 分析的籌碼段落顯示 N/A 類文字而非 0。**驗完把字串改回、重啟、確認恢復正常。**
   （此臨時改動不 commit；驗證前後 `git status` 應乾淨。）
6. curl 白名單擋非法 dataset：
   `curl "http://localhost:3001/api/finmind?dataset=NotAllowed"` → 400 ＋ 中文 BAD_REQUEST。

**部署後才能完整驗證**（本期記錄、不擋合併）：CDN 快取實效（連續查多檔不撞限流）、
token 設定後的 600/hr 上限——比照 Phase 2 的部署後驗收項。
  </how-to-verify>
  <resume-signal>輸入 "approved" 或描述問題（哪一步、預期 vs 實際）</resume-signal>
</task>

</tasks>

<review_checklist>
## 給 fresh-context 覆核者的固定清單（逐條執行，不即興）

1. `npx tsc --noEmit`＝0；`npm run build` 成功；`grep -rn "AIza" dist/`＝0。
2. **範圍**：diff 只含 8 個計畫檔；`git diff main -- services/gemini.ts`＝0（N/A 分支自動受益
   是本期驗收點）；utils/ 零 diff。
3. **token 安全**：`grep -rn "FINMIND_TOKEN" services/ components/ App.tsx index.html`＝0
   （只准出現在 api/ 與 .env.example）；api/finmind.ts 的 log 與錯誤回應不含 token 與上游 URL 原文。
4. **白名單**：ALLOWED_DATASETS 與 services 現用 dataset 逐一對照（開兩邊檔案比對字串），
   不多不少；非白名單 400；含「基本面擴充」註解。
5. **誠實化語意劃線**：(a) fetchInstitutionalData 失敗回 null 非 []；(b) 整包失敗→兩欄位
   undefined＋chipDataUnavailable=true；(c) **chips 成功時的缺日塞 0 邏輯未被改動**
   （對照 main 版 L666 附近，成功路徑逐字等價）；(d) types 兩欄位為選填且註解寫明語意。
6. **快取**：s-maxage 計算函式是台北時區（UTC+8 固定偏移）到當日 24:00；錯誤回應不帶快取 header。
7. **StockChart 雷區 diff**：`git diff main -- components/StockChart.tsx` 只含
   props/hasChipData/toggle 列 JSX/Badge import；Bar/Cell/軸/拖曳/hooks 零觸碰。
8. **讀取點掃描複核**：`grep -rn "foreignBuySell|investmentTrustBuySell" components/ services/ utils/`
   逐點看 undefined 安全；任何為防崩潰加的 `?? 0` 不得出現在「向使用者呈現數值」的位置以外亂加。
9. runtime 交使用者 Task 4；未實跑就明說。判定：必修退 Codex 附行號；同題最多 2 輪。
</review_checklist>

<verification>
1. 每任務後 tsc＝0；Task 3 後 build 成功＋dist 無 AIza。
2. Task 4 人工驗證（正常＋誠實化＋header＋白名單 curl）通過。
3. 合併前 taskkill 收乾淨 node 程序再 merge。
</verification>

<success_criteria>
- [ ] services 零直連 FinMind；token 選填且無前端蹤跡；.env.example 已補
- [ ] dataset 白名單分流、非法 400、含擴充註解
- [ ] 全部成功回應帶 s-maxage 到台北當日 24:00；錯誤不帶快取
- [ ] 籌碼誠實化：整包失敗→undefined＋旗標＋「籌碼暫不可用」徽章；成功路徑語意零變化；gemini.ts 零 diff
- [ ] StockChart 雷區 diff 乾淨；目錄/搜尋/K線/AI 分析行為與現在一致
- [ ] tsc 0、build 成功、人工 checkpoint 核可
</success_criteria>

<output>
Create `.planning/phases/03-finmind/03-01-SUMMARY.md`. 必記錄：
- 最終白名單 dataset 清單（實際字串）
- 誠實化改動的確切行（塞 0 處前後對照）
- 本地驗證誠實化路徑的方法與結果（含臨時改動已還原的確認）
- s-maxage 實測值範例；部署後待驗項（CDN 快取實效、token 上限）
</output>

## 未決點（誠實列出）
1. 使用者是否註冊 FinMind token 未定——設計為選填 env，沒有也能上線（300/hr＋CDN 快取撐個人
   流量應足夠）；有 token 時只需在 Vercel env 加 `FINMIND_TOKEN`，零程式改動。
2. CDN 快取實效（成功標準「連續查多檔不撞限流」）本地無 CDN 無法完整驗證——列部署後驗收，
   比照 Phase 2 的 30 分鐘標準。
3. OTC 法人 dataset 的實際字串（上市/上櫃兩個 dataset 名）以現碼為準抄錄——規劃期未逐字驗證，
   Task 1 第一步就是開檔抄字串，抄錯白名單會讓上櫃籌碼壞掉（Task 4 有 6488 驗證點兜底）。
