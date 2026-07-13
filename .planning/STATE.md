---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: complete
stopped_at: Phase 4 merged to main (684453d) — milestone complete
last_updated: "2026-07-11T22:30:00+08:00"
last_activity: 2026-07-13 - Phase C 三子包（C-1 LLM adapter／C-2 健檢 JSON 化＋批次／C-3 SI 靜態化）全部完成併入 main，待 Sonnet 驗收
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 7
  completed_plans: 7
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-01)

**Core value:** 讓使用者對任一檔台股/美股得到「客觀進場判斷 ＋ AI 中文解讀」的可信分析，而其依賴的金鑰與資料來源必須安全、穩定、不被盜用或竄改。
**Current focus:** 里程碑完成 — 後端 Serverless 代理層 4 個 phase 全數合併 main

## Current Position

Phase: 4 of 4 (防濫用強化 ＋ 部署驗收) — Complete
Plan: 4 of 4 complete
Status: Milestone complete（所有 phase 已合併 main）
Last activity: 2026-07-13 - Phase C 三子包全部完成併入 main（C-1／C-2／C-3），待 Sonnet 驗收

Progress: [██████████] 100%

**里程碑收尾待辦（使用者手動，非 phase 範圍）：**
- 部署到 Vercel 並跑真環境驗收（需設 PROXY_SHARED_SECRET/UPSTASH_*/回填 ALLOWED_ORIGIN；無密鑰 curl→403、超限→429、CORS 無 `*`、6488/2330 籌碼正常）——詳 docs/DEPLOYMENT.md
- 作廢舊 Gemini 金鑰（Phase 1 前曾進 bundle）
- 文件債：Phase 2/3 缺 SUMMARY/VERIFICATION 收尾文件（功能無影響）

## Performance Metrics

**Velocity:**

- Total plans completed: 1
- Average duration: 126 min
- Total execution time: 2.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 1 | 1 | 126 min | 126 min |

**Recent Trend:**

- Last 5 plans: 126 min
- Trend: Baseline established

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [里程碑]: 聚焦「安全性：後端代理」——金鑰外洩是 CONCERNS 中唯一 CRITICAL、會直接造成金錢損失
- [里程碑]: 後端採 Vercel Serverless 函式（非自管伺服器），與 Vite 靜態站整合最順、免費層足夠
- [Phase 1]: Gemini 優先——唯一 CRITICAL 金錢風險、最小端到端切片，先驗通整條鏈路在 Vercel 上可行
- [架構]: 後端只做啞代理（Yahoo/FinMind 回原始 JSON），指標計算/normalize/prompt 全留前端，維持 `StockDataPoint[]` 契約零變動
- [Phase 1]: Gemini proxy 使用 AbortController 100 秒逾時，Vercel function `maxDuration=120`
- [Phase 1]: Handler 使用本地最小 request/response 型別，不依賴 `@vercel/node`
- [Phase 1]: 本地開發採 Vite 3000 + Vercel 3001，前端 `/api` 由 Vite proxy 轉發

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

- [ui] Add TW stock fundamentals tab（`2026-07-08-add-tw-stock-fundamentals-tab.md`）——
  台股個股月營收/EPS/財報整合進 App；資料層（tw-fundamentals skill）與設計文件已就緒，未排入 phase

- [api] Fix invalid FinMind OTC dataset names（`2026-07-09-fix-invalid-finmind-otc-dataset-names.md`）——
  `TaiwanOTCStockInstitutionalInvestorsBuySell`/`TaiwanOTCStockInfo` 非真實 dataset，上櫃股籌碼
  一直靜默失敗；Phase 3 誠實化功能正確揭露（顯示不可用而非假0），根因未修，改用統一 dataset 即可

### Blockers/Concerns

[Issues that affect future work]

- [Phase 2 研究旗標]: Yahoo 非官方端點的 cookie/crumb 握手行為可能隨時間改變；實作後須在 Vercel 環境（非本機）實測 ≥30 分鐘驗證，不能只靠本機。
- [Phase 1 待測量]: Gemini thinking/pro 模式實際延遲未知；需以真實技術分析提示測量，確認 `maxDuration=120` 是否足夠。
- [Phase 1 後續確認]: Codex 環境未直接保留 `vercel dev` 啟動輸出；部署前仍應依已核可的 Vite 3000 + Vercel 3001 流程再確認一次。

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260602-0u1 | 修正 services/yahoo.ts 最新一根日線 K 棒 close 為 null 時改用 regularMarketPrice 補上，使儀表板最新日期與盤中即時價正確更新 | 2026-06-01 | 31292c6 | [260602-0u1-services-yahoo-ts-k-close-null-regularma](./quick/260602-0u1-services-yahoo-ts-k-close-null-regularma/) |
| 260602-13g | 台股最新一根日線 close 為 null 時優先用 FinMind 真實 OHLC 補出 K 棒，FinMind 無資料才退回 regularMarketPrice 平盤補值 | 2026-06-01 | 73467de | [260602-13g-close-null-finmind-ohlc-k-finmind-regula](./quick/260602-13g-close-null-finmind-ohlc-k-finmind-regula/) |
| 260612-pdz | 修復程式碼審查 7 項 bug：volume.ts 時區日期、健檢決策 regex、盤中攻擊量改用預估全日量、錯誤訊息變數名、yahoo.ts 指標 nullish、切週期/更新報價用已解析 symbol、移除死碼 import | 2026-06-12 | 3251169 | [260612-pdz-fix-code-review-bugs-timezone-date-bug-h](./quick/260612-pdz-fix-code-review-bugs-timezone-date-bug-h/) |
| 260612-w4i | 用 50 檔大型權值股 60 日 5 分 K 實證校準台股盤中累積量權重曲線（2505 stock-days 中位數），getTaiwanVolumeWeight 改查表內插，Insufficient 窗口依實證誤差設 T*=105 分（美股不變） | 2026-06-12 | 4d61572 | [260612-w4i-calibrate-tw-intraday-volume-weight-curv](./quick/260612-w4i-calibrate-tw-intraday-volume-weight-curv/) |
| 260612-wyt | 用 50 檔 S&P 大型股 60 日 5 分 K 實證校準美股盤中累積量權重曲線（2800 stock-days 中位數），getUSVolumeWeight 改查表內插，美股 Insufficient 窗口設 T*=85 分；發現並繞過 Yahoo 美股 1d 量與 5m 加總不一致（改用 5m 自和，15:55 根已含收盤競價） | 2026-06-12 | 19df323 | [260612-wyt-calibrate-us-intraday-volume-weight-curv](./quick/260612-wyt-calibrate-us-intraday-volume-weight-curv/) |
| 260613-3ab | StockChart 效能重構：主圖/副圖抽成 React.memo、收盤價游標線改用 recharts 3.x 公開 hooks（useActiveTooltipDataPoints 等）在圖內訂閱，滑鼠查價時三圖零重繪（瀏覽器實測 80 次掃動 0 長任務）；修正十字線偏右（量能 Bar 移到獨立隱藏 XAxis，去除 barGap=-100%，實測偏移 0.03px） | 2026-06-13 | 03e4e21 | [260613-3ab-stockchart-performance-refactor-memoize-](./quick/260613-3ab-stockchart-performance-refactor-memoize-/) |
| 260613-if7 | StockChart 兩項互動：新增 rightOffset 狀態實作按住左鍵拖曳平移歷史股價（拖曳時抑制十字線、放開恢復、鉗位最新/最舊、切股票切週期歸位）；單根 K 棒浮動框改為頂端固定 OHLC/量資訊列（Tooltip content 設 null 保留十字線與游標價格線）。瀏覽器實測：拖曳方向正確、鉗位 OK、info bar 隨 hover 更新、浮動框已消除 | 2026-06-13 | 9e75132 | [260613-if7-stockchart-drag-to-pan-history-scrolling](./quick/260613-if7-stockchart-drag-to-pan-history-scrolling/) |
| 260613-ixg | 修正拖曳平移嚴重 lag：拖曳期間以 frozenSubDataRef 快照凍結兩張副圖（引用穩定→React.memo 跳過，放開才補正確視窗），主圖視窗粗化每 PAN_STEP=max(1,round(barsToShow/50)) 根才跳一步，單步成本由三圖重繪降為一圖且次數變少。build 通過；瀏覽器實測因 preview sandbox 的 Tailwind CDN 未載入（容器 0 寬）受阻，邏輯經 memo 正確性分析確認 | 2026-06-13 | 6e1ced1 | [260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan](./quick/260613-ixg-reduce-stockchart-pan-lag-freeze-sub-pan/) |
| 260629-ag1 | 新增專案 AGENTS.md（Codex 進入指引），採單一事實來源做法指向既有 CLAUDE.md（不複製），讓 Claude 與 Codex 在本專案層級同步；摘要安全紅線（GEMINI_API_KEY 不進前端/ git）、型別相容、程式風格與 GSD 流程。註：本機環境無 node，GSD 工具鏈無法自動執行，改以手動複刻結構＋git 原子提交完成 | 2026-06-29 | ac56a24 | [260629-ag1-add-agents-md-codex-sync](./quick/260629-ag1-add-agents-md-codex-sync/) |
| 260710-17a | 修正 api/ 後端 serverless function 在 Vercel production 部署時的 ERR_MODULE_NOT_FOUND 崩潰：package.json 設 "type":"module" 導致 Node 原生 ESM 執行 api/**/*.ts，但 tsconfig moduleResolution:"bundler" 允許的無副檔名相對匯入在原生 ESM 下不合法；為 6 個檔案（guard/http/finmind/gemini/yahoo-chart/yahoo-search）共 16 處相對匯入補上 .js 副檔名。今日首次真環境部署驗收時用 curl 對 production 實測發現（四個端點全 500 FUNCTION_INVOCATION_FAILED），非 Phase 4 引入、是 Phase 1 就存在的結構性 bug | 2026-07-10 | c977082 | [260710-17a-api-serverless-function-vercel-productio](./quick/260710-17a-api-serverless-function-vercel-productio/) |
| 260710-w7y | 修正前端 7 處 `.replace('.TW','').replace('.TWO','')` 後綴剝除 bug：對上櫃股 6488.TWO 會先吃掉 .TWO 內的 .TW 留下孤兒 O 變成 6488O，導致上櫃股 FinMind 中文名/籌碼/價量/K線fallback 全查無失效；改用 `.replace(/\.TWO?$/i,'')` 錨定字尾正確剝除（上市股不受影響）。真環境部署驗收搜尋上櫃股時發現 | 2026-07-10 | c8997fd | [260710-w7y-tw-two-bug](./quick/260710-w7y-tw-two-bug/) |
| 260710-wsq | 修正台股名錄快取中毒 bug：ensureTaiwanDirectory 抓取失敗仍把空目錄寫入 localStorage 快取 7 天（搜尋只剩 Yahoo 英文名且修好也不自癒）；改為失敗/空絕不寫入＋讀到空快取視同 miss 重抓（已中毒使用者自動痊癒）。另移除 index.html 指向不存在檔案的 /index.css 死引用（每次載入 404）。真環境部署驗收發現 | 2026-07-10 | 46a2464 | [260710-wsq-bug-index-css](./quick/260710-wsq-bug-index-css/) |
| 260711-0hf | 更新 docs/DEPLOYMENT.md 第 6 節「GCP Gemini 每日配額」，改為反映實測結果：付費層（Tier 1/Postpay）對一般 GenerateContent 沒有可調每日配額（per day 配額只涵蓋 free tier token 數與 Search/Map grounding，本專案未用），財務防線改採 Billing → 預算與快訊（月上限 $10、50/90/100% 門檻、純 email 快訊不自動斷線） | 2026-07-10 | dd09948 | [260711-0hf-docs-deployment-md-6-gcp-gemini-billing](./quick/260711-0hf-docs-deployment-md-6-gcp-gemini-billing/) |
| 260711-unf | 修復颱風假（臨時休市日）假 K 棒污染技術指標：7/10 颱風台股休市但 Yahoo 仍回傳平盤棒（O=H=L=C=前收、量0）、App 合成邏輯亦會補出同樣假棒，KD/MACD/RSI/布林/均線全失準。兩層修法——getStockData 新增 4.5 步日線殭屍棒過濾器（FinMind 覆寫後、指標計算前剔除「量0且O=H=L=C=前一保留棒收盤」的棒；首棒不殺、連續休市正確處理、漲跌停零量棒保留），processYahooResult 合成守衛加嚴（合成日期須嚴格晚於最後真實棒日期，颱風日 regularMarketTime 停在前一交易日故不合成）。實測依據：Yahoo 對 7/10 回傳非 null 假棒、FinMind 乾淨無 7/10、Yahoo 長期歷史自清（2024 凱米/山陀兒颱風假不存在）故無歷史污染、App 無行情快取即修即生效 | 2026-07-11 | 77a088c, 39e54aa | [260711-unf-k-yahoo-ts](./quick/260711-unf-k-yahoo-ts/) |
| 260711-v9f | 修正 StockChart 三項顯示問題：(1) 一字板 K 棒（O=H=L=C 漲跌停鎖死）因 CandleStickShape 對 height<=0 直接 return null 而完全不顯示，改畫最小 2px 可見水平線，顏色依前收漲紅跌綠平灰；(2) 外資/投信買賣超柱狀在小量時被大值主導的 YAxis 壓到 ~0px 看不見，改自訂 min-height shape 非零值撐到最小 2px、正負錨定零線、紅買綠賣；(3) 切換 K 棒週期時無任何載入回饋被誤認當機，App.tsx 在 loading 期間於圖表區疊加 Loader2 spinner＋「載入中…」覆蓋層。與 260711-unf 殭屍棒過濾器相容（漲跌停零量棒本就保留於資料層，本次僅動渲染層） | 2026-07-11 | 4cacb36, a029f8c, f534948 | [260711-v9f-stockchart-k](./quick/260711-v9f-stockchart-k/) |
| 260711-v9f 補修 | (2) 的 ChipBar 對 recharts 負值柱（height 為負、y 為值端）誤判 height<MIN 恆成立，所有賣超柱被壓成 2px 懸浮短線；改先正規化 top/|height| 再做最小高度錨定零線。瀏覽器 DOM 實測 2330 日K：外資/投信 200 根紅綠柱全數錨定零線、綠柱高度恢復多樣（最高 81.7px、小量 2px） | 2026-07-11 | 441948a | [260711-v9f-stockchart-k](./quick/260711-v9f-stockchart-k/) |
| 260711-wqe | 升級 start-dev skill：使用者說「起環境」時助手不再只給複製貼上指令，改直接用 PowerShell Start-Process 開兩個可見視窗（後端 vercel dev 3001＋前端 Vite 3000，-WorkingDirectory 繞開空格路徑轉義雷），新增 90 秒/3 秒間隔雙埠輪詢就緒後回報，原指令模式保留為 Fallback；sync:skills 確認 start-dev 不在 Codex 鏡像白名單（no-op），並依新流程實測啟動成功（3000/3001 皆活） | 2026-07-11 | 8b2c386 | [260711-wqe-start-dev-skill-powershell](./quick/260711-wqe-start-dev-skill-powershell/) |
| 260712-0dq | 依 .claude/skills 內 10 個 SKILL.md 重寫 README.md（繁中），取代 AI Studio 預設模板：專案介紹＋核心價值、在地執行說明（npm install、GEMINI_API_KEY 環境變數、vercel dev 3001＋Vite 3000、AIza 金鑰洩漏檢查）、10 個 skill 完整說明（朱家泓 7 步驟進場分析 pipeline＋tw-fundamentals＋phase-loop＋start-dev）；內容檢查 skills=10、AI Studio 殘留=0 | 2026-07-11 | 3421046 | [260712-0dq-claude-skills-10-skill-md-readme-md](./quick/260712-0dq-claude-skills-10-skill-md-readme-md/) |
| 260712-qfi | A1 搜尋限縮：搜尋結果限縮為美股＋台股的個股＋ETF——mapYahooQuote 移除 isYahooFinance 旁路（期貨/指數/匯率/加密不再混入）＋市場白名單（美 7 所＋.TW/.TWO，其餘丟棄不標「海外」）、Market 型別收斂 TW\|US；isSearchableTaiwanEntry 依 FinMind TaiwanStockInfo 實抓值域過濾名錄（排除興櫃/權證/DR 含 4 碼特例 9110/ETN/受益證券/指數，保留 2395/3116 檔、509 檔 ETF 零誤殺）；合併結果收斂 15 筆、中文搜尋仍 0 網路請求 | 2026-07-12 | e4068c4, d32aa7b | [260712-qfi-a1-search-scope-etf](./quick/260712-qfi-a1-search-scope-etf/) |
| 260712-qyf | A2 K 棒圖拖曳平移效能快贏：handleDragMove 熱路徑不再 per-mousemove 呼叫 getBoundingClientRect（dragStart 量測一次存 dragWidthRef，消除強制 reflow）；顯示資料改為 mappedData 全量預映射（Adj/Raw、MA 欄位、priceChange，deps 不含 barsToShow/rightOffset）＋windowBounds 夾止數學單一事實來源，displayData/volumeCells 降級為 O(視窗) slice——拖曳每步元素物件參照穩定、mappedData/volumeCellsFull/maResultsCache/macdHistCells 快取全命中。行為零變化（鉗位/十字線抑制/縮放/週期歸位/260613-ixg 副圖凍結/一字板/PAN_STEP 全照舊）；priceChange 讀碼確認舊版即取全量前一根，遷移語意逐位元相同 | 2026-07-12 | c2b91b5, 70905f7 | [260712-qyf-a2-chart-pan-quick-wins-k](./quick/260712-qyf-a2-chart-pan-quick-wins-k/) |
| 260712-rcf | A3 AI 帳單瘦身三件套：gemini.ts 刪 238 行死碼（analyzeStockWithGemini＋formatPromptData，保留 VolumeProjectionInfo）；callGeminiApi 咽喉點加 localStorage 透明分析快取（key=mode\|台北日期\|FNV-1a(systemInstruction+prompt)，同日同輸入 0 重複計費、輸入變 hash 即失效、僅非空成功回應寫入、50 筆上限＋跨日清理、storage 失敗全退化直打 API、UI 零改動）；三處 flash thinkingBudget 硬編（8192/10240/8192，第三處 analyzeFundamentals 為規格外 delta）統一 FLASH_THINKING_BUDGET=4096。裁決：免「重新分析」按鈕（hash 同＝輸入同，重打純重複計費）、批次健檢延 Phase C（regex 解析多檔合併更脆弱，JSON 結構化時一起做） | 2026-07-12 | 7bc35f1, 2c1107d | [260712-rcf-a3-ai-bill-slimming-thinkingbudget](./quick/260712-rcf-a3-ai-bill-slimming-thinkingbudget/) |
| 260712-v6l | B-2 搜尋 UX 三修（Phase B 1/3）：searchStocks 改兩段式 callback 發射——local 相位本地名錄命中立即上屏（不等 Yahoo 冷握手 3-8 秒）、final 無條件恰發一次收斂（Yahoo 空/失敗即本地原樣），函式內部自行 await ensureTaiwanDirectory 根除名錄就緒競態（消費端移除 dir state、useCallback deps 清為 []、兩相位皆過 reqId 防過期）；StockSearch 下拉面板三態化——!dirReady→「載入名錄中…」、searching→不渲染、終態才顯示「找不到符合」（誤閃三情境走讀封死）；CJK 0 網路請求維持、A1 過濾/白名單/15 筆上限 diff 證明零觸碰；14 項 tsx 斷言＋tsc 三次全過 | 2026-07-12 | 811db54, 98636cb | [260712-v6l-b-2-search-ux-three-fixes-local-first-re](./quick/260712-v6l-b-2-search-ux-three-fixes-local-first-re/) |
| 260712-vno | B-1 行情載入全套（Phase B 2/3）：新增 services/quoteCache.ts——台美各依交易時段的 TTL 純函式（盤中 10 分／收盤後沿用到下一交易日開盤，Intl 時區處理 DST）＋memory 權威層＋sessionStorage best-effort 雙層快取；yahoo.ts getStockData 加快取外殼＋SWR（stale 先渲染、背景刷新 onRevalidated）＋forceRefresh（更新報價按鈕）＋寫快取前 signal.aborted 守衛防中毒；台股三段串行改並行（中文名併入 Promise.all）；resolveTaiwanSuffix 名錄 type 預解析 .TW/.TWO（上櫃股直達零試錯，查無 fall through 原 try-chain）；App.tsx fetchData reqId＋AbortController 三處過期守衛；後端握手三段 8s AbortSignal.timeout（TimeoutError 擴列）＋chart 200 回應 s-maxage=60,swr=300；chipDataUnavailable 只享 10 分短 TTL；殭屍棒/close-null/後綴剝除/A1/B-2 全 diff 證明零退化；35 項純函式斷言＋tsc 全綠 | 2026-07-12 | 2abed37, 691dfef, 72e6204 | [260712-vno-b-1-quote-loading-speed-full-package](./quick/260712-vno-b-1-quote-loading-speed-full-package/) |
| 260712-wa0 | B-3 拖曳體感 transform 平移（Phase B 3/3）：新增 utils/panMath.ts 四純函式（computeWindowBounds/buildPanSession/clampTranslate/commitOffset，89 項斷言含與 A2 舊公式 50 點網格逐位元全等）；StockChart 拖曳管線改接——dragStart 建 1.5×~2× 加寬緩衝層（每側 ceil(barsToShow×0.5)）、mousemove 熱路徑只讀 ref＋純算術＋一行 translate3d style 寫入（零 setState/零 Recharts 重繪/零佈局量測/零 rAF）、緩衝耗盡 mid-drag re-base 一次重繪補緩衝、mouseup commitOffset 吸附整根＋鉗位提交 re-slice 三圖同視窗；pan 模式 bare ComposedChart 顯式尺寸＋YAxis hide＋右緣 60px 遮罩；PAN_STEP 量化全廢（目的被 transform 路徑取代，吸附顆粒度反而變細至 1 根）；拖曳中縮放忽略/data 變更安全中止/游標命令式管理；260613-ixg 副圖凍結、260613-if7 十字線抑制/鉗位、260613-3ab memo、260711-v9f 一字板與 ChipBar、A2 結構全數 diff/grep 證明零退化；tsc 過 | 2026-07-12 | 78ca076, 851e3bf | [260712-wa0-b-3-drag-pan-css-transform-translate](./quick/260712-wa0-b-3-drag-pan-css-transform-translate/) |
| 260713-1t8 | C-1 LLM provider adapter＋claude-cli 訂閱橋接（Phase C 1/3）：新增 api/_lib/llm.ts generateText 依 LLM_PROVIDER 分流——未設/gemini-api 走既有 callGeminiWithTimeout（部署行為逐字等價，僅 MISSING_KEY 改經 catch 多一行 log）、claude-cli 以 child_process spawn 本機 Claude Code CLI（-p --output-format json --tools ""，prompt 走 stdin、system 走 --system-prompt，吃 Claude 訂閱零 Gemini 帳單，僅本機 vercel dev 顯式設 env 才啟用）；執行檔三段探索（CLAUDE_CLI_PATH→PATH 跳過 .cmd→%APPDATA%\Claude\claude-code 最高版本目錄）＋子程序 env 清洗（剔 ANTHROPIC_BASE_URL/CLAUDECODE/CLAUDE_CODE_*）＋cwd=tmpdir＋100s 逾時 settled 旗標收斂＋五出口 JSON 解析（未登入→MISSING_KEY 含 claude /login 指引）；api/gemini.ts handler 改接 adapter（statusByCode/catch/maxDuration 零改動）；.env.example 新增 LLM_PROVIDER/CLAUDE_CLI_PATH/CLAUDE_CLI_MODEL_FAST/THINKING 說明。直測三情境 PASS（含未登入 e2e 1.5s settle 零殘留子程序）、tsc 綠、build 後 grep AIza 無結果 | 2026-07-13 | 0e6cb9a, ebc9655 | [260713-1t8-c-1-llm-provider-adapter-claude-cli-llm-](./quick/260713-1t8-c-1-llm-provider-adapter-claude-cli-llm-/) |
| 260713-2am | C-2 健檢決策 JSON 結構化＋一鍵批次健檢（Phase C 2/3）：新增 services/_shared/healthDecision.ts 純模組（parseHealthDecisions 取最後一個 ```json 圍欄→shape 驗證五值枚舉→回 decisions＋剝除 json 區塊的顯示文本；splitHealthReport 按「### 📋 持股健檢報告」切段、symbols 長度降冪認領防子字串誤配；extractDecisionByRegex 沿用舊 regex 當 fallback 下限）；analyzePortfolioHealth systemInstruction 末尾新增機器可讀決策區契約（報告末尾 json 圍欄、每檔恰一筆、五值不含 emoji）；Portfolio.tsx 抽 buildHealthItem 共用 helper、handleSingleHealthCheck 改接解析器（JSON 失敗退 regex 再退「分析完成」）、新增 header「全部健檢」按鈕（3-worker 併發池組全持股資料→一次 analyzePortfolioHealth→切段各給各的、總覽段附每檔段尾）；A3 快取因 systemInstruction 變更 hash 自然失效無中毒。解析器直測 29/29 PASS、tsc 綠、build 後 grep AIza 無結果；已知限制：>8 檔未 chunk（截斷時解析器回 null 退 regex 全文，可退化不會壞） | 2026-07-13 | 49bba67, 9ee609c | [260713-2am-c-2-json-regex](./quick/260713-2am-c-2-json-regex/) |
| 260713-buv | C-3 規則庫 systemInstruction 靜態化＋快取策略落地（Phase C 3/3）：services/gemini.ts 三個函式內 systemInstruction hoist 為 module const（ENTRY/TRADE_DECISION/HEALTH_CHECK_SYSTEM_INSTRUCTION），entry 版去除 5 處個股動態內插（decision/entryPrice/stopPrice/maGuardPrice/guardMaLabel 全數已在 promptData，改指涉輸入資料、恰 2 行改寫）——前綴位元組穩定＝Gemini implicit caching 可命中＋A3 hash 穩定；機制層偏差（已數字化文件化）：拒絕 PLAN 原名的 explicit context caching——本 App 呼叫間隔以小時計 >> TTL，儲存費（~$0.005-0.008/hr）＞命中省（~$0.001-0.002/次）需 ≥4-5 次/hr 才回本、entry SI ~1k tokens 低於 1024 門檻、serverless cache name 跨實例查找複雜度，無任何子情境划算；claude-cli 路徑（C-1）訂閱計費天然不看 token。位元組級驗證 14 項全過（trade 16,905B/health 14,470B 全等、promptData 全等含 5 值）、tsc 綠、build 後 grep AIza 無結果 | 2026-07-13 | 2d40726 | [260713-buv-c-3-systeminstruction](./quick/260713-buv-c-3-systeminstruction/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-09T12:28:50.653Z
Stopped at: Phase 4 context gathered
Resume file: .planning/phases/04-hardening/04-CONTEXT.md
