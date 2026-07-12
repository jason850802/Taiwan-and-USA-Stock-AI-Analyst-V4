# 全 App 優化計畫（2026-07-12 定案）

**分工（本案特例）**：Fable 5 規劃＋執行，Sonnet 驗收；不走 Codex。
**執行方式**：每個工作包走 `/gsd:quick`（原子 commit＋SUMMARY），包完成即 `npx tsc --noEmit`；phase 收尾由 Sonnet subagent 依本檔驗收標準覆核。

## 已拍板決策

1. P4 LLM：本機預設 `claude-cli`（Claude 訂閱、Agent SDK/headless），雲端部署保留 `gemini-api` fallback；任何 OAuth token 不進 repo／不進 Vercel env。
2. P1 圖表：兩段式——先做低風險 A，量測後不夠再做 B（transform 平移）。
3. 行情快取 TTL：**盤中 10 分鐘／收盤後沿用到下一交易日開盤**（台美各依自己交易時段）；過期採 stale-while-revalidate（先顯示舊資料、背景刷新）。
4. 依賴單軌化（esm.sh importmap → Vite 單軌 bundle）：**留到下個里程碑**，本波不做。

## 執行順序

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase A | A1=P3 搜尋限縮；A2=P1-A 圖表快贏；A3=P4B 帳單瘦身（刪死碼／結果快取／降 thinkingBudget／批次健檢→延 Phase C） | ✅ 完成（2026-07-12；Sonnet 驗收 0 CRITICAL/HIGH，M-1 已修；e2e 實測：搜尋過濾 4/4、縮放鏈路 OK、gemini 快取兩輪僅 1 次 API） |
| Phase B | P2 載入速度全套（前端快取、並行化、後綴預解析、AbortController、後端 timeout＋CDN） | 待辦 |
| Phase C | P4A LLM provider adapter＋claude-cli 橋接＋健檢 JSON 化 | 待辦 |
| Phase D | （視情況）P1-B transform 平移；error boundary；math/entryFilter 最小測試 | 待辦 |

---

## A1（P3）搜尋限縮：美股＋台股、個股＋ETF

根因（`services/stockDirectory.ts:113-125`）：
- 過濾式 `quoteType==='EQUITY'||quoteType==='ETF'|| x.isYahooFinance`——最後一項把白名單旁路（期貨/選擇權/指數/匯率 isYahooFinance 皆 true）。
- 非美非台歸類 `OTHER`（顯示「海外」）但未排除 → 港日韓混入。
- `searchTaiwan` 對 FinMind 全名錄零過濾（名錄有 `type`=twse/tpex 與 `industry` 欄位可用）。

改法：
1. 移除 `|| x.isYahooFinance`；quoteType 嚴格 ∈ {EQUITY, ETF}。
2. 市場白名單：美股交易所（NMS/NYQ/NGM/NCM/ASE/PCX/BTS）＋ `.TW`/`.TWO`；`OTHER` 直接丟棄。
3. `searchTaiwan`：`type ∈ {twse, tpex}`＋以 industry_category／代碼型態排除受益證券、存託憑證、可轉債等（實作時對照名錄實際值訂規則）。
4. 合併結果數收斂（約 15 筆）。

驗收：搜「台積電／2330／AAPL／VOO／0050」正常；「NK／HSI／BTC／恒生／日經」等不出現期貨/指數/港日韓；純中文搜尋 0 網路請求；tsc 過。

## A2（P1-A）K 棒圖拖移快贏

根因（`components/StockChart.tsx`）：
1. `handleDragMove` 每次原生 mousemove 呼叫 `getBoundingClientRect()`（:720，rAF 之外）→ 強制 reflow。
2. `displayData` 每步全量重建 100 筆物件＋每筆 4 條 MA×8 欄位迴圈（:610-674）；`volumeCells` 重生 100 個 Cell（:775）。
3. 上述觸發 `MainPriceChart` 整張 Recharts 重繪（:380、:735）。

改法：
1. dragStart 量一次容器寬度存 ref；DragMove 不再碰 getBoundingClientRect。
2. 「全量 data→含 MA/priceChange 欄位的完整映射」抽成 useMemo（dep: data/settings/maResultsCache），`displayData` 只做 slice；`volumeCells` 改吃預映射資料。
3. 視量測微調 `PAN_STEP`。

驗收：Chrome Performance 拖曳無 >50ms long task、單步 scripting 明顯下降；三圖同步、放開位置正確、hover 十字線/週期切換不退化；tsc 過。
（若仍卡 → Phase D 做 P1-B：拖曳期間 CSS translateX＋放開吸附。）

## A3（P4B）AI 帳單瘦身（不換供應商也生效）

根因（`services/gemini.ts`、`components/Portfolio.tsx`）：
- 死碼 `analyzeStockWithGemini`＋`formatPromptData`（gemini.ts:46-282，~235 行）無人呼叫。
- 覆盤/健檢兩本硬編規則庫（:439-717、:856-1034）每次每檔原封重送，單次 input 1.3-1.7 萬字元。
- 功能 1/2/3 無結果快取，同標的同日重跑重複計費。
- flash 上掛 thinkingBudget 8192/10240（:724、:1043），thinking tokens 計費。

改法（Phase A 範圍）：
1. 刪死碼（gemini.ts:46-282）。
2. 分析結果快取：key=`功能|symbol|台北當日|interval`，localStorage 持久化（比照 FundamentalsPanel 記憶體快取模式），提供「重新分析」按鈕強制略過。
3. thinkingBudget 降至 4096（留常數好調）。
4. 批次健檢：評估「一鍵全部健檢」合併一次呼叫；若回應解析（regex 抓決策）風險過高則明記延到 Phase C（JSON 化時一起做）。

驗收：單次健檢 input 字元數下降 ≥60%（規則庫快取化留 Phase C，本包先靠快取＋降 budget＋批次）；同日重按同標的 0 次 API 呼叫；分析品質人工抽查 3 檔無退化；tsc＋`npm run build` 後 `grep -r "AIza" dist/` 無結果。

---

## Phase B（P2）切換標的載入速度

- 前端行情快取：`services/yahoo.ts` 加 memory Map＋sessionStorage，key=`symbol|interval`，TTL 依決策 3；SWR 先渲染舊資料再背景刷新。
- 台股三段串行（chart→中文名→法人+量能，yahoo.ts:465/597/610）改並行：中文名併入 Promise.all。
- 用 `stockDirectory` 的 `type`（twse/tpex）預解析 `.TW`/`.TWO`，消滅上櫃股先失敗一次的試錯（yahoo.ts:292-301）。
- `App.tsx fetchData` 加 AbortController＋reqId 防競態（比照 StockSearch.tsx:59-62）。
- 後端：`api/_lib/yahoo.ts:169-204` 握手每個 upstream fetch 加 8-10s timeout；chart 回應加 `Cache-Control s-maxage=60`＋swr。
- （選配後評估）1d 先抓 2y 快繪、背景補 10y——需驗證長週期指標正確性，不急。

驗收：冷抓台股時間減半；切回看過標的 <300ms 出圖；連點 5 檔無資料錯置；Yahoo 掛時 10s 內 fallback FinMind。

## Phase C（P4A）LLM 訂閱橋接

- 後端 provider adapter：`generate(prompt, systemInstruction, mode) → markdown`；依 `LLM_PROVIDER` env 分流（`gemini-api`｜`claude-cli`；預留 codex-cli/gemini-cli）。
- `claude-cli` 路徑：child_process 呼叫本機已登入的 Claude Code（`claude -p --output-format json`）；僅本機 vercel dev 生效；Windows spawn 雷區照 ENVIRONMENT-GOTCHAS。
- 部署環境維持 gemini-api（金鑰只在 Vercel env，紅線不變）。
- 健檢決策改 JSON 結構化輸出，替換 Portfolio.tsx:965 的脆弱 regex；批次健檢若 A3 未做在此完成。
- 規則庫改快取式 systemInstruction（Gemini 路徑用 context caching；claude-cli 路徑天然不計費）。
- 政策風險註記：Anthropic 曾公告 headless/SDK 拆獨立 credit（2026-06-15 前暫緩）；adapter 抽象即為此保險。

驗收：本機日常分析 Gemini 帳單趨近 0；三種分析功能報告品質人工對照 3-5 檔；雲端部署行為不變；金鑰驗證 grep AIza 無結果。

## Phase D（視情況）

- P1-B transform 平移（若 A2 後仍不順）。
- React error boundary（index.tsx:11）。
- `utils/math.ts`／`entryFilter.ts` 最小單元測試。
- Rate limit fail-open：確認 Upstash env 有配（ratelimit.ts:18,79），不改碼。

## 全案共同驗收

每包：`npx tsc --noEmit` → 原子 commit。每 phase：`npm run build`＋`grep -r "AIza" dist/` 無結果＋preview（3001 單埠）實跑該 phase 驗收項＋Sonnet subagent 覆核本檔對應章節。
