# 全 App 優化計畫（2026-07-12 定案）

**分工（本案特例）**：Fable 5 規劃＋執行，Sonnet 驗收；不走 Codex。
**執行方式**：每個工作包走 `/gsd:quick`（原子 commit＋SUMMARY），包完成即 `npx tsc --noEmit`；phase 收尾由 Sonnet subagent 依本檔驗收標準覆核。

## 已拍板決策

1. P4 LLM：本機預設 `claude-cli`（Claude 訂閱、Agent SDK/headless），雲端部署保留 `gemini-api` fallback；任何 OAuth token 不進 repo／不進 Vercel env。
2. P1 圖表：兩段式——先做低風險 A，量測後不夠再做 B（transform 平移）。
3. 行情快取 TTL：**盤中 10 分鐘／收盤後沿用到下一交易日開盤**（台美各依自己交易時段）；過期採 stale-while-revalidate（先顯示舊資料、背景刷新）。
4. 依賴單軌化（esm.sh importmap → Vite 單軌 bundle）：~~留到下個里程碑~~ → **2026-07-13 使用者改判：納入 Phase D 完整執行**（規格見 §Phase D）。

## 執行順序

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase A | A1=P3 搜尋限縮；A2=P1-A 圖表快贏；A3=P4B 帳單瘦身（刪死碼／結果快取／降 thinkingBudget／批次健檢→延 Phase C） | ✅ 完成（2026-07-12；Sonnet 驗收 0 CRITICAL/HIGH，M-1 已修；e2e 實測：搜尋過濾 4/4、縮放鏈路 OK、gemini 快取兩輪僅 1 次 API） |
| Phase B | P2 載入速度全套（前端快取、並行化、後綴預解析、AbortController、後端 timeout＋CDN）＋搜尋 UX 三修＋拖曳 transform 平移 | ✅ 完成（2026-07-12；三包 260712-v6l/vno/wa0 全併 main；Sonnet 驗收 B-2/B-3 ACCEPT、B-1 ACCEPT_WITH_NOTES——H-1/M-1 當場修（49d5ac8）、M-2/L-1 更正（5c1866e）；e2e 實測：搜尋兩段式本地先上屏/CJK 0 請求/找不到僅終態、6488→.TWO 直達零試錯、週期切回 0 請求、2317 冷抓中切 2330 AbortError 取消無錯置且快取無中毒、拖曳 translate3d→放開提交正確、0 console errors、build+grep AIza 乾淨；待人工：60fps Performance 量測＋pan 模式 YAxis hide 視覺核對，步驟見 PHASE-B-REVIEW.md） |
| Phase C | P4A LLM provider adapter＋claude-cli 橋接＋健檢 JSON 化 | ✅ 完成（2026-07-13；三包 260713-1t8/2am/buv 全併 main；Sonnet 驗收 C-3 ACCEPT、C-1/C-2 ACCEPT_WITH_NOTES——CR-01/H-1/M-1/M-2 當場修（b49bd30，CR-01 修復期直測另揭露 Windows spawn 同步 throw 路徑一併處理）；C-3 機制層偏差經覆核 ACCEPT：拒 explicit context caching（儲存費＞命中省、entry SI 低於 1024 門檻、流量差兩個數量級），改 SI 靜態化＋依 implicit caching；**2026-07-13 後記**：使用者已完成 `claude /login`，橋接 live e2e 跑通（fast→sonnet／thinking→opus 皆成功回應），`.env` 已設 `LLM_PROVIDER=claude-cli`；live e2e 另揪出健檢分段 bug 當場修（8f901e6）。**尚待人工**：三功能報告品質對照 3-5 檔——步驟見 PHASE-C-REVIEW.md「需人工實跑驗證」） |
| Phase D | D-1 依賴單軌化（Tailwind 建置期＋importmap 移除＋分包）；D-2 error boundary；D-3 math/entryFilter 最小測試；D-4 ratelimit env 檢查 | ✅ 完成（2026-07-13；七包 260713-kq2/len/mi1/n11/nvg/ob4/oxf 全併 main；Sonnet 驗收 **ACCEPT，0 CRITICAL/0 HIGH**——WR-01 當場修（6aa5735，vitest exclude 入 config）；硬指標全過：preview network 0 esm.sh＋0 cdn.tailwindcss.com、雙環境視覺零回歸、grep AIza dist 無結果、tsc/build/test 32 案例全綠；成果：twCDN 407KB→建置期 CSS 26.8KB/5.5KB gzip、importmap 死重移除＋文件單軌化、主 chunk 967.6→156.6KB（-83.8%）＋Portfolio/基本面懶載、error boundary throw 實測過、vitest 跑道落地、production UPSTASH env 實查已配；本案特例 Fable 規劃＋執行、Sonnet 驗收；另修驗收期發現的 Vite watcher EBUSY 崩潰（f98aa56，dev watch 忽略 .claude/**）；詳 PHASE-D-REVIEW.md） |

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

## Phase B（P2）切換標的載入速度＋搜尋 UX（2026-07-12 依使用者實測影片擴充）

**影片實測基線**（錄製內容 2026-07-12 215827.mp4，cv2 量化＋逐格檢視）：6488（上櫃）從選定到出圖 **12 秒**；週/月切換各 **~7 秒**（整圖 blur＋載入中）；搜尋「6449」輸入後 **~6 秒**才出現下拉（結果最終來自本地名錄——不是過濾誤殺，是被 Yahoo 請求扣住）；拖曳段畫面凍結占比 93-94%、最長單次凍結 2-3 秒。

### B-1 行情載入（原 P2 全套）
- 前端行情快取：`services/yahoo.ts` 加 memory Map＋sessionStorage，key=`symbol|interval`，TTL 依決策 3；SWR 先渲染舊資料再背景刷新。**含週期切換**（日/週/月來回切換是影片實測痛點，切回看過的週期必須秒開）。
- 台股三段串行（chart→中文名→法人+量能，yahoo.ts:465/597/610）改並行：中文名併入 Promise.all。
- 用 `stockDirectory` 的 `type`（twse/tpex）預解析 `.TW`/`.TWO`（yahoo.ts:292-301）——6488 那 12 秒有一大段是 `.TW` 先失敗的整輪握手，上櫃股受害最深。
- `App.tsx fetchData` 加 AbortController＋reqId 防競態。
- 後端：`api/_lib/yahoo.ts:169-204` 握手每個 upstream fetch 加 8-10s timeout；chart 回應加 `Cache-Control s-maxage=60`＋swr。
- （選配後評估）1d 先抓 2y 快繪、背景補 10y——需驗證長週期指標正確性，不急。

### B-2 搜尋 UX 三修（影片新發現，根因已定位）
1. **本地結果被 Yahoo 扣住**：`searchStocks`（stockDirectory.ts）把本地名錄命中與 Yahoo 遠端結果 merge 後一次回傳——本機名錄命中是 0ms 的事，卻要等 Yahoo（冷握手 3-8 秒）才顯示。改**兩段式**：本地結果立即上屏，Yahoo 結果到了再併入（沿用既有 reqId 防過期）。
2. **「找不到符合」誤閃**：StockSearch.tsx:138 條件 `open && !searching && 空` 會在中間態（前一個 query 空結果、名錄未就緒）誤現。改：名錄載入中顯示「載入名錄中…」、查詢進行中不判找不到、只有終態空結果才顯示。
3. **名錄就緒競態**：`dir` 為 state（StockSearch.tsx:33,43），使用者在名錄載入完成前輸入 → 本地搜尋吃到空陣列且 dir 到貨後不重跑。改：`searchStocks` 內部自行 `await ensureTaiwanDirectory()`（有 memCache，第二次起零成本），不依賴外部傳入的 dir snapshot。

### B-3 拖曳體感（P1-B 提前，影片確認 A2 快贏不足）
- 拖曳期間改 CSS `translateX` 平移已渲染圖層（帶左右緩衝視窗），mousemove 零 React/Recharts 重繪；放開時 re-slice 提交＋吸附。副圖凍結機制保留。
- 註：A2 的三項快贏（reflow 消除/預映射/slice）仍有效且是 B-3 的地基，但每步整張 Recharts 重繪（~550 節點×BB 開啟時更多）在實機是 100ms+ 等級，量化步幅讓體感成「突發跳躍」——必須換掉重繪路徑本身。

驗收：冷抓上櫃股 ≤5 秒（消滅 .TW 試錯）；切回看過標的/週期 <300ms；搜尋輸入到本地結果上屏 <300ms；「找不到」只在真無結果時出現；拖曳 60fps（Chrome Performance 無 >50ms long task）；連點 5 檔無資料錯置。

## Phase C（P4A）LLM 訂閱橋接

- 後端 provider adapter：`generate(prompt, systemInstruction, mode) → markdown`；依 `LLM_PROVIDER` env 分流（`gemini-api`｜`claude-cli`；預留 codex-cli/gemini-cli）。
- `claude-cli` 路徑：child_process 呼叫本機已登入的 Claude Code（`claude -p --output-format json`）；僅本機 vercel dev 生效；Windows spawn 雷區照 ENVIRONMENT-GOTCHAS。
- 部署環境維持 gemini-api（金鑰只在 Vercel env，紅線不變）。
- 健檢決策改 JSON 結構化輸出，替換 Portfolio.tsx:965 的脆弱 regex；批次健檢若 A3 未做在此完成。
- 規則庫改快取式 systemInstruction（Gemini 路徑用 context caching；claude-cli 路徑天然不計費）。
- 政策風險註記：Anthropic 曾公告 headless/SDK 拆獨立 credit（2026-06-15 前暫緩）；adapter 抽象即為此保險。

驗收：本機日常分析 Gemini 帳單趨近 0；三種分析功能報告品質人工對照 3-5 檔；雲端部署行為不變；金鑰驗證 grep AIza 無結果。

## Phase D：依賴單軌化＋體質小項（2026-07-13 補完整規格）

註：原列「P1-B transform 平移」已於 B-3 完成，移除。

### 現況事實（2026-07-13 核實）

- `index.html:7-30`：Tailwind 走 **cdn.tailwindcss.com Play CDN（執行時 JIT）**＋內聯 `tailwind.config`（自訂 colors：surface/accent/ai/up/down/ok/danger/warn、fontFamily：Inter+Noto Sans TC/JetBrains Mono、borderRadius：ctl/card/modal）。prod console 有官方警告，CDN 掛掉＝全站無樣式。
- `index.html:54-65`：esm.sh importmap（react/react-dom/recharts/lucide-react/react-markdown，皆 `^` 範圍——esm.sh 於請求時解析 semver，有版本漂移風險）。**注意**：Vite 會改寫裸模組匯入，importmap 在 dev/prod 可能都是休眠狀態——D-1a 要先量測證實，但無論活死都該移除（休眠＝供應鏈死重＋誤導維護者）。
- `package.json`：importmap 五件套**都已在 dependencies**（版本範圍一致）＋remark-gfm；**package-lock.json 存在**——單軌化的依賴基礎已齊，不需補裝核心依賴。
- `index.html:31`：Google Fonts CDN（Inter/JetBrains Mono）。
- `index.html:32-53`：內聯 `<style>`（body 底色/字體＋自訂卷軸）。
- 全 repo 無根 CSS 檔；build 為單一 chunk（07-12 基線 954KB，以 D-1a 重測為準）；`className={\``（模板字串類名）**約 51 處**——Tailwind 改建置期 purge 的頭號風險點。

### D-1a 基線量測與風險稽核（先做，不改碼）
1. dev＋`npm run build`+preview 各一次，記錄 network：esm.sh 是否有實際請求（判定 importmap 活/死）、cdn.tailwindcss.com 請求大小、bundle 大小與 gzip 首屏 JS 總量 → 全部寫進 SUMMARY 當 before 基線。
2. 稽核 51 處模板字串 className：找出「插值出現在 class token 內部」的動態組類名（如 `text-${x}-500`）——這種建置期掃描器抓不到，逐一改為完整字面量映射或列入 safelist。條件切換（`${cond ? 'a' : 'b'}`，字面量完整）不受影響、不用改。

### D-1b Tailwind 改建置期（最大工項，獨立 commit）
1. 裝 **tailwindcss v3.4.x**＋postcss＋autoprefixer（**明確不用 v4**：v4 是 CSS-first 設定、與現行內聯 config 語法不相容，遷移風險無謂）。
2. 內聯 `tailwind.config` 全量遷至 `tailwind.config.js`（theme.extend 逐鍵照搬）；content globs 涵蓋 `./index.html`、`./*.{ts,tsx}`、`./components/**/*.{ts,tsx}`——以 grep className 的實際檔案分布為準，寧廣勿漏。
3. 建 `index.css`：`@tailwind base/components/utilities`＋把 index.html 內聯 `<style>`（body/卷軸）移入；`index.tsx` 頂部 import。
4. 移除 index.html 的 CDN script＋內聯 config。
5. 驗收：dev＋prod preview 逐頁視覺比對（市場分析/我的庫存/基本面/AI modal/圖表含 hover/拖曳/縮放/自訂卷軸/紅漲綠跌色）零回歸；console 無 Tailwind CDN 警告；D-1a 稽核出的動態類名全數有效。

### D-1c importmap 移除＋文件單軌化（獨立 commit）
1. 刪 `index.html` importmap 區塊；`npm ci` 後 dev/build 均正常（Vite 從 node_modules＋lockfile 解析）。
2. 同步文件：`CLAUDE.md`「依賴要同時維護兩處」關鍵事實改為單軌敘述；`.planning/codebase/STACK.md` 如有 importmap 敘述一併更新。
3. 驗收：dist/index.html 無 esm.sh 字樣；preview network 0 個 esm.sh 請求；App 全功能 smoke。

### D-1d 分包（code splitting，獨立 commit）
1. `vite.config.ts` 加 `build.rollupOptions.output.manualChunks`：`react`+`react-dom`（vendor）、`recharts`（最大宗）、`react-markdown`+`remark-gfm`（僅 AI 報告用）。
2. 選配（做完 1 量測後再決定）：`React.lazy`＋Suspense 懶載 `Portfolio`／`FundamentalsPanel`（非首屏分頁）。
3. 驗收：主 chunk 較 D-1a 基線 **-40% 以上**；首屏 gzip JS 總量記入 SUMMARY；切換分頁無白屏閃爍（lazy 有 fallback）。

### D-1e Google Fonts：**保留 CDN**（display=swap 漸進降級可接受，不在本包自托管）——記錄此決定即可。

### D-2 React error boundary
`index.tsx:11` 直掛 `<App/>`——包一層可恢復 fallback（顯示錯誤摘要＋「重新載入」鈕），任何 render throw 不再整頁白屏。驗收：手動在子元件丟一次 throw 驗證 fallback，移除後正常。

### D-3 最小單元測試
`utils/math.ts`（非標準 MACD 10,20,10／KD 5,3）與 `entryFilter.ts` 加最小斷言（node 直跑或 vitest 擇一，傾向 vitest 但不強制；≥每個關鍵函式 2-3 個已知輸入輸出案例）。驗收：npm script 一鍵可跑、全綠。

### D-4 Rate limit fail-open 確認
確認部署環境 Upstash env 有配（`ratelimit.ts:18,79` 未配時 fail-open）——查證並記錄，不改碼。

### Phase D 共同驗收
tsc；`npm run build`＋`grep -r "AIza" dist/` 無結果；preview network **0 esm.sh＋0 cdn.tailwindcss.com**；逐頁視覺 smoke；Sonnet 覆核本章節。
**執行順序**：D-1a→D-1b→D-1c→D-1d→D-2→D-3→D-4，每步獨立 commit 可單獨回滾。
**衝突警告**：D 動建置底座（index.html/vite.config/新增 CSS），**不要與 BL-1~4 或其他改碼視窗同時執行**；D 完成後再做 BL。

## 驗收後待修清單（Backlog——全部 Phase 跑完後彙整處理，暫不動工）

**→ 2026-07-13 已另立完整執行計畫：`BL-PLAN.md`（本節四項採納項的展開規格＋執行順序＋驗收標準，執行以該檔為準）。Phase A～D 成果統整見 `PHASE-A-D-REPORT.md`。**

**來源**：2026-07-13 使用者實測影片（錄製內容 2026-07-13 003306.mp4，localhost:3000）＋Gemini 影片分析回饋。
**回饋中已確認修復**：B-3 拖曳完全流暢（掉幀/跳躍消失）、B-2 搜尋即時且無「找不到」誤閃。
**殘留瓶頸**：首次載入個股 6-8 秒、首次切換週期 9-12 秒（皆為**冷抓**路徑；快取命中的切回已秒開——影片中的等待全發生在第一次抓取）。

### 採納項（依預期效益排序）

| # | 項目 | 說明 |
|---|---|---|
| BL-1 | **1d 兩段式載入**：先抓 2y 快繪、背景補全 10y | B-1 原「選配後評估」轉正。冷載入最大槓桿（10y 日線是最重 payload）。落地前須驗證長週期指標（MA60/MACD/KD warm-up）在 2y 首繪→10y 補全交換時的正確性與無閃爍 |
| BL-2 | **台股 1d 籌碼三件套與 chart 並行起跑** | 現況：中文名/法人/量能三支 FinMind 在 chart 回來後才並行（yahoo.ts 管線順序）。後綴預解析已在 chart 之前確立台股身分，可投機性同時起跑、條件不符（fallback 路徑）時丟棄——實測沙盒 chart 4.1s＋FinMind 3.4s 串接，並行可省 2-3 秒 |
| BL-3 | **1mo range=max 收斂＋首次切換體感** | 月線目前抓 `range=max`（yahoo.ts:481）；評估縮至 10y/15y。週/月首次切換的等待可配 BL-1 同款兩段式或至少骨架屏（現為整圖 blur＋轉圈） |
| BL-4 | **Production 重測冷載入基線** | 影片數字含 `vercel dev` 本機開銷（per-endpoint 首次 esbuild 編譯、較慢代理、無 CDN——s-maxage 只在 prod 生效）。「冷抓 ≤5s」驗收最終應以 Vercel 部署環境為準 |

### 不採納項（Gemini 建議，經程式碼事實排除）

- **「資料庫加 Index」**：本專案無資料庫，後端是啞代理（Yahoo/FinMind 原樣轉發），無此槓桿。
- **「檢查重複 fetch」**：Phase B e2e 已用 fetch instrumentation 證實每個 symbol|interval 恰發一次 chart 請求、無重複發送（PHASE-B-REVIEW.md e2e #4/#5）。
- **「前端 parse 效能低落」**：資料到手後的 parse/指標計算/渲染為次要成本（沙盒實測 chart 網路往返即佔 4s+，到手後渲染即刻）；瓶頸在上游網路往返。另後端 cookie/crumb 握手已有 module 級快取（api/_lib/yahoo.ts:85-87、:161-168），非每請求重握手。

## 全案共同驗收

每包：`npx tsc --noEmit` → 原子 commit。每 phase：`npm run build`＋`grep -r "AIza" dist/` 無結果＋preview（3001 單埠）實跑該 phase 驗收項＋Sonnet subagent 覆核本檔對應章節。
