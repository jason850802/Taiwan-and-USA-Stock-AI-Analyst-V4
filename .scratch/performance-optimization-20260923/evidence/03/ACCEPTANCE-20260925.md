# 03 票第二輪補證：原 localhost:3000 候選 App、依賴重載與生命週期

日期：2026-09-25。起點 HEAD `c789bda`（動工前核對）。本輪補驗證與工具，並依使用者指示修正日常入口啟動器 `daily-dev.mjs` 的孤兒缺陷（第 7 節）；**沒有修改產品碼**；沒有 push、部署或發版，沒有執行真 AI、沒有打真行情、沒有碰真帳本。使用者已先讓出 3000／3001。

## 1. 真帳本保護（為何能安全使用原 3000 來源）

真帳本存在使用者 Chrome 的 `http://localhost:3000` localStorage。本輪三道保護，全部有 raw：

1. **隔離瀏覽器資料目錄**：每種視窗各啟動一個全新 `--user-data-dir` 的 headless Chrome（`%LOCALAPPDATA%\Temp\perf-opt-20260923\<run-id>\profile-*`），結束即刪除；raw 記錄 `profileRemoved=true`。
2. **舊分頁哨兵**：起服務前先占用 3000 八秒，完成 Vite 的 `vite-ping` 握手並回一張無腳本告示頁，讓仍開著的 App 分頁停在告示頁、不會自動重新整理進固定資料服務。所有使用 3000 的正式 run 哨兵事件皆為 0（沒有可見的舊分頁）。
3. **外部用戶端監看**：服務期間每 300 ms 列出連到 3000 的連線，擁有者不屬本工具或本輪 Chrome 程序樹就立即停服務、判無效。App r2 檢查 542 次、生命週期 r2 301 次，外部用戶端 0。

後端以固定上游模式執行：函式子程序封鎖非本機連線、claude CLI 一律換成假 CLI。App r2 的後端探針 `blocked.net／fetch／ai` 全為 0，outbound 類別只有 Yahoo cookie／crumb／chart／search 與 FinMind 固定回應。

## 2. 正式 App（原 `http://localhost:3000`）

> 本節是修正啟動器孤兒缺陷前的 r2；修正後以同一套 14 步重跑的 r3 見第 7 節，兩者結果一致。

正式證據：[`app03-localhost3000-20260925-r2`](app03-localhost3000-20260925-r2/raw.json)、[摘要](app03-localhost3000-20260925-r2/app-summary-90b92bc932dc.json)、[28 張截圖](app03-localhost3000-20260925-r2/screens/)。工具 `tools/app-03.mjs`。

- 入口：`node .scratch/performance-optimization-20260923/tools/daily-dev.mjs start`（不帶埠參數＝3000／3001），另加固定上游、假 AI 與名錄測試旗標（僅後端）。就緒 8.4 秒。3000 listener 只有本輪 Vite（`[::1]:3000`，PID 12660，監督程序 21244 的子程序）；3001 只有本輪 vercel（`127.0.0.1:3001`，PID 12768）；前後身分一致；長駐原型啟用並接手，函式子程序 5 個、未經原型者 0。
- 操作：以 CDP 的滑鼠與鍵盤原生事件操作；桌面 1280×720 與窄版 375×812 各一個全新資料目錄；每步保存五鍵 before／after 原始字串、截圖、DOM 事實、同源請求（含發起者堆疊）與 console。
- 結果：**桌面 14/14、窄版 14/14 PASS**，exit 0；非預期 console 0（預期 1：headless Chrome 自己要 `/favicon.ico` 的 404）；外部主機只有 Google Fonts。停止後狀態檔移除、監督程序結束、兩埠無 listener、監督程序／子程序／5 個函式子程序均無殘留；兩個 Chrome 正常關閉並刪除資料目錄。此工具的殘留檢查沒有涵蓋 vercel 的內部開發伺服器（見第 4 節）；本輪全部 run 結束後的全系統查詢，除兩個監督程序崩潰情境留下的內部 Vite 外沒有其他殘留，所以 App 的正常 stop 路徑確實乾淨。

| # | 操作 | 五鍵規則 | 桌面／窄版 | 實際變動的鍵 |
|---|---|---|---|---|
| 1 | 開啟 App（預設 2330 日線） | 全新目錄首次掛載：只准 `portfolio_items`→`[]`、已實現帳本→空帳本 | PASS／PASS | items＋realized |
| 2 | 搜尋 2317、點選名錄「固定資料鴻海」 | 只讀：五鍵逐字相同 | PASS／PASS | 無 |
| 3 | 台股切週線 | 只讀 | PASS／PASS | 無 |
| 4 | 輸入 AAPL 按 Enter | 只讀 | PASS／PASS | 無 |
| 5 | 美股切回日線 | 只讀 | PASS／PASS | 無 |
| 6 | AAPL 假 AI 技術分析（空手、快捷） | 只讀 | PASS／PASS | 無 |
| 7 | 切到我的庫存（空） | 只讀 | PASS／PASS | 無 |
| 8 | 新增 AAPL 1 股、均價 500 USD、買進日 2026-09-01 | items 原字串＋預期批次、流水＝一筆手動買進（原字串）、快照＝一列美股 live（僅 `capturedAt` 可變）；其餘逐字不變 | PASS／PASS | items＋txns＋snapshots |
| 9 | 新增 2330 1000 股、均價 900 | items＋預期批次、快照＝台股＋美股 live 列；流水等其餘不變 | PASS／PASS | items＋snapshots |
| 10 | AAPL 單筆假 AI 健檢 | 只讀 | PASS／PASS | 無 |
| 11 | 重新整理頁面 | 只讀；另核文件開始時五鍵＝重載前 | PASS／PASS | 無 |
| 12 | 回訪我的庫存 | 只准當日 live 列重寫 `capturedAt`；其餘逐字不變 | PASS／PASS | snapshots（僅 capturedAt） |
| 13 | 刪除 AAPL | items 只剩 2330、流水移除該批後為空、美股 live 列移除 | PASS／PASS | items＋txns＋snapshots |
| 14 | 刪除 2330 | items＝`[]`、快照清空、其餘不變 | PASS／PASS | items＋snapshots |

預期值在執行前由固定價格（2330.TW 901、2317.TW 668、AAPL 588、USDTWD=X 945）與 App 相同的算式寫定，例如新增 AAPL 後流水原字串必須是 `{"version":1,"txns":[{"date":"2026-09-01",…,"key":"manual|lot|<id>"}]}`、美股快照 `marketValue=588`、`totalCost=500.4`、`estSellCosts=0.47`、`totalCostTwd=472878`。畫面另核台股手續費自動試算 1282、美股 0.4、表單匯率帶入 945、兩表顯示固定價與 `USD/TWD 945.00`、假 AI 與健檢依序出現「假片段1～5」且無「報告生成中斷」字樣。後端假 CLI 共 4 次啟動、20 段、4 次完成、0 次被殺。

### 請求逐筆分類（本輪判定器規則，非協定凍結條文，請使用者裁定是否接受）

每個同源 `/api` 請求都記錄 HTTP 狀態、完成／失敗時刻（瀏覽器單調時鐘）與發起者堆疊。除成功外，r2 觀察到三類，逐筆列在 raw 的 `requests[].kind`：

| 類別 | r2 筆數（桌面／窄版） | 判定依據 |
|---|---|---|
| 協定 §4：10y 先完成後被取代的 2y | 1／0 | 同 symbol／週期的 10y 已 200 且較早完成；前端 `services/yahoo.ts` 的 `finish()` 依設計中止仍未回來的 2y。沿用共同驗收協定 §4 |
| 瀏覽器自發（含已取消） | 2／2 | 發起者類型 `other`、沒有任何頁面腳本堆疊；同網址另有腳本發起的 200。對應 `api/finmind.ts` 回應的 `stale-while-revalidate=60`，屬 Chrome 背景重新驗證，不是 App 發出的請求 |
| 串流完整送達後的傳輸層取消 | 1／2 | `/api/gemini-stream` 已 200，畫面證明完整收到 `done`；後端假 CLI 4 次皆完成、0 次被殺。串流處理端送完 `done` 後是正常 `res.end()`，前端讀取端也不主動取消；Chrome 標示取消的確切成因**未定位**，屬時序性（同一輪桌面兩次串流只有一次出現） |

**r1 保留為失敗歷史**：[`app03-localhost3000-20260925-r1`](app03-localhost3000-20260925-r1/app-summary-d9662d0eba9b.json) 桌面 14/14、窄版 13/14。失敗步驟 `narrow/interval-us-day` 的畫面與五鍵全部正確，失敗原因是當時判定器沒有實作協定 §4 的 2y 例外，也沒有記錄完成時刻；依新規則仍無法證明 10y 較早完成，所以不追認。修正判定器後以新 run-id 重跑成 r2。另有四次開發期冒煙（4741～4748 埠）只留在 runtime、不作證據。

## 3. 依賴刪除／恢復重載（隔離 checkout）

正式證據：[`reload03-deps-20260925-r1`](reload03-deps-20260925-r1/raw.json)、[判定](reload03-deps-20260925-r1/reload-summary-8b66827daa19-f2bc858cc29b.json)。在 `C:/pfv7` 同時起 B1（一般 vercel dev）與候選，固定上游，**exit 0、`diffs=[]`、`problems=[]`**：

| 步驟 | B1／候選 | 候選偵測變更 |
|---|---|---|
| 基準 chart 200、參數錯誤 400、search 200 | 相同 | — |
| 改共用依賴訊息 → 兩邊拿到新訊息 | 400／400 | 是 |
| chart 語法錯誤 → 不回舊碼 | 500／500 | 是 |
| 修回語法 | 200／200 | 是 |
| `.env` 加測試密鑰 → 缺密鑰拒絕；移除後放行 | 403／403 → 200／200 | 是 |
| 刪路由 → 404；還原 → 200 | 404／404 → 200／200 | 是 |
| 還原依賴訊息 | 400／400 原文 | 是 |
| **刪除共用依賴 `api/_lib/yahoo.ts`**：chart 與 search 都不得回舊碼 | 500／500、500／500 | 是 |
| **恢復共用依賴** | 200／200、200／200 | 是 |
| 串流進行中改碼：兩邊 26 行完整跑完 | 200／200 | 是 |

候選 0 次崩潰、14 個函式子程序、12 次失效、11 次停用、殘留 0；B1 在語法錯誤與刪依賴時崩潰 3 次並由工具換埠重起（一般 vercel dev 的既有行為）。14 個來源檔（13 個候選檔＋`scripts/start-dev.ps1`）與主工作樹逐檔同 SHA-256，執行後逐位元組還原，測試用 `.env`／`.vercel` 已刪除。

工具變更：`c-reload.mjs` 的 03 模式原本要求隔離 checkout 相對 `30dfdb2` 的產品差異恰為 13 個候選檔；HEAD 已提交的使用者啟動腳本 `scripts/start-dev.ps1`（vercel dev 與 Vite 都不載入）會讓它拒跑。改為把它列入「必須與主工作樹逐位元組相同」的附加來源，其他檢查不變；改在本 run 之前，run 記錄的是改後工具雜湊。

## 4. 日常入口生命週期（原 3000／3001、日常命令原樣）

> 本節是修正前的 r2 紀錄（發現孤兒缺陷）；修正、紅燈與綠燈重驗見第 7 節。

正式證據：[`life03-localhost3000-20260925-r2`](life03-localhost3000-20260925-r2/raw.json)、[摘要](life03-localhost3000-20260925-r2/lifecycle-summary-611e04e90f32.json)。工具 `tools/lifecycle-03.mjs`；移除所有測試旗標與預載，`.env` 照常只給後端；只送首頁 GET 與同源 OPTIONS，不碰上游。就緒後記下監督程序底下的**整棵子孫樹**（每次 11 個：vercel、其 `cmd.exe` 殼與內部 Vite＋esbuild、5 個函式子程序、前端 Vite＋esbuild），停止或崩潰後以 PID＋建立時間逐一核對。**6/7 PASS，`crash-supervisor` FAIL，exit 1（run 有效，`problems=[]`）**：

| 情境 | 結果 |
|---|---|
| 第 1 次啟停 | PASS。9.6 秒就緒；監督程序 daily-dev.mjs、子程序 vc.js／vite.js 身分核對；3000 只有 Vite、3001 只有 vercel；status 執行中；首頁 200 且為 Vite 開發頁、同源 OPTIONS 204；5 條函式預熱；stop 回報 stopped、監督程序自行結束；11 個子孫程序全數結束 |
| 第 2 次啟停（同埠） | PASS。8.5 秒就緒，其餘同上，全部新 PID |
| 3000 被占用 | PASS。立即 exit 1「指定埠已有 listener；不接管其他服務。」；占用服務照常回應；3001 未啟動；無狀態檔 |
| 3001 被占用 | PASS。同上 |
| vercel 子程序崩潰 | PASS。只對核對過身分的 PID 下手；監督程序 0.65 秒內自行停掉 Vite、清狀態並結束；整棵樹無殘留；重新啟停 7.7 秒就緒且正常 |
| Vite 子程序崩潰 | PASS。0.65 秒內自行收尾；整棵樹無殘留；重新啟停正常 |
| 監督程序被強制結束（只殺監督程序） | **FAIL**。vercel、前端 Vite、`cmd.exe` 殼與 5 個函式子程序隨 job object 結束，兩埠無 listener；`status` exit 1「沒有可確認的本案日常服務」；下次 `start` 把殘留狀態改名 `state.json.stale-<時間戳>` 並正常啟停。**但 vercel 經 `cmd.exe` 啟動的內部 Vite（node）與其 esbuild 存活成孤兒，下次啟停後仍在**；工具結尾核對身分後清掉並記錄 |

**孤兒缺陷**：程序樹為 監督程序 → vercel（node）→ `cmd.exe` → 內部 Vite（node）→ esbuild。監督程序被殺時，Node 為子程序建立的 job object 只涵蓋各層以 Node 直接啟動的程序；由 `cmd.exe` 再啟動的內部 Vite 不在其中，所以沒被一併結束。它監聽 `0.0.0.0:<隨機埠>`（對區網開放開發伺服器），而啟動器的 `start`／`recover` 只核對狀態檔記錄的兩埠與子程序，看不到它。正常 `stop` 與子程序崩潰路徑用 `taskkill /T` 殺整棵樹，r2 以整棵樹核對證實乾淨。修正需改啟動器（例如就緒後把整棵子孫樹連建立時間寫進狀態，`start`／`recover` 發現監督程序已死時核對並清掉），屬新的實作，本輪未改。

**r1 的生命週期判定作廢（原樣保留）**：[`life03-localhost3000-20260925-r1`](life03-localhost3000-20260925-r1/raw.json) 報 7/7 PASS，但當時的殘留檢查只看監督程序、兩個子程序與函式子程序，漏了 vercel 的內部開發伺服器；`crash-supervisor` 的「零殘留」不成立。本輪結束後的全系統查詢找到兩個孤兒內部 Vite（PID 24416 建於 11:46:02＝生命週期冒煙 s1 的監督程序崩潰情境、PID 6916 建於 12:07:41＝r1 的同一情境），父程序皆已不存在、各帶一個 esbuild、分別監聽 `0.0.0.0:57424`／`0.0.0.0:62424`；以建立時間核對身分後用 `taskkill /T` 清除，兩埠隨即釋放。修正工具後以 r2 重跑。r1 其餘六個情境在 r2 整棵樹檢查下結果相同。

首輪只有文字敘述的兩次啟停與埠衝突，至此有原始紀錄；`recover03-20260924-r2`、`stale03-20260924-r1` 的失聯復原仍有效。

## 5. 正式部署路徑（靜態核對，未部署）

正式證據：[`deploy03-static-20260925-r1`](deploy03-static-20260925-r1/raw.json)、[摘要](deploy03-static-20260925-r1/deploy-summary-f962d76a7c99.json)。工具 `tools/deploy-static-03.mjs`，exit 0：

- 部署設定檔（`package.json`、lock、`.vercelignore`、`index.html`、`tsconfig.json`；無 `vercel.json`／`vercel.ts`）自 03 起點 `6a7b029` 零差異。
- 正式函式路由集合不變：`api/finmind.ts`、`api/gemini-stream.ts`、`api/gemini.ts`、`api/yahoo/chart.ts`、`api/yahoo/search.ts`。
- 本機長駐預載與探針只在 `.scratch`，`.vercelignore` 排除；產品檔沒有任何 `persistent-functions`／`trace-preload`／`PERF01_`／`PERF03_`／`NODE_OPTIONS` 引用。
- 在隔離 checkout 以 03 起點與目前的 `vite.config.ts` 各建置正式前端（不設本機 envDir）：15 個產物檔逐檔 SHA-256 相同，聚合 `37cfeed5…aff77`。03 對 `vite.config.ts` 的修改只作用於開發伺服器。

**無法在本機證明、仍 OPEN**：正式 Vercel Node runtime 是否在用戶端斷線時對 handler 發出 `res` close／`req` aborted；取消後上游是否實際停止；正式串流的 flush 與取消時序。新取消程式以可選呼叫接事件，平台若不發事件就退回「不取消」，與 03 前相同；但正式平台行為必須部署實測或取得平台日誌才能判定，本輪依指示不部署。本機標準 runtime 的 API 對等仍以 [`parity03-20260925-r5`](parity03-20260925-r5/raw.json) 的 59/59 為準。

## 6. 隔離 gate

先把 `c789bda` 已提交但隔離 checkout 缺的 10 檔（取提交 blob）與本輪主工作樹的 111 檔（5 修改＋106 新增）逐檔同步到 `C:/pfv7`，雜湊逐檔相符後以 pathspec 檔精確 stage；staged 相對 `c789bda` 共 112 筆，多出的 `gate03-final-20260924-r1.txt` 是先前就留在該 checkout 的舊 gate 輸出，非本輪產生、未動。safe.directory 只以 `GIT_CONFIG_COUNT/KEY_0/VALUE_0` 指向 `C:/pfv7`，執行 `npm.cmd run gate -- --require-env`：

- tsc 0 錯；Vitest 50 檔 **829/829**；build 成功（dist 15 檔）。
- 金鑰掃描乾淨：dist 15 檔、**追蹤原始碼 4451 檔**（上一輪 4342，多出的是本輪新檔）、主工作樹 `.env` 值 6 筆。
- package／lock 與該 checkout HEAD 一致。

[LF 複本](gate03-accept-20260925-r1-lf.txt)；原始終端輸出在 `%LOCALAPPDATA%\Temp\perf-opt-20260923\gate03-accept-20260925-r1.txt`，SHA-256 `1dbb0a009cf1abe7eea9fe5342980956c28c2e4ca584c21cde4edb358f7b79c3`，提交的複本只把 CRLF 換成 LF。

**第二次 gate（生命週期工具修正後）**：把提交 `3bf4159` 之後的 9 個變更檔（修正後的 `lifecycle-03.mjs`、生命週期 r2 兩檔、來源清單 r5、總覽、README、票面、PLAN、spec）同樣逐檔同步並精確 stage 後重跑：tsc 0 錯、829/829、build 成功、金鑰掃描乾淨（dist 15 檔、**追蹤原始碼 4455 檔**，較第一次多出本批新檔）、package／lock 一致。[LF 複本](gate03-accept-20260925-r2-lf.txt)；原始輸出 `%LOCALAPPDATA%\Temp\perf-opt-20260923\gate03-accept-20260925-r2.txt`，SHA-256 `171124e8abe29d69a780c8f9680185fba9b34bff558d2da22e5461d145c82988`。

**第三次 gate（修正啟動器孤兒缺陷後）**：把提交 `94848ac` 之後的 49 個變更檔（修正後的 `daily-dev.mjs`、三支驗收工具、紅燈 r1／r2、生命週期 r3、App r3 含 28 張截圖、三個回歸 run、來源清單 r6 與文件）逐檔同步並精確 stage 後重跑：tsc 0 錯、829/829、build 成功、金鑰掃描乾淨（dist 15 檔、**追蹤原始碼 4496 檔**）、package／lock 一致。[LF 複本](gate03-accept-20260925-r3-lf.txt)；原始輸出 `%LOCALAPPDATA%\Temp\perf-opt-20260923\gate03-accept-20260925-r3.txt`，SHA-256 `606c367fba72223d3a9e8a24b71856a33c40f5ffddecf3e1c581c4c520056fc9`。

三次 gate 之後才補的只有本節文字、票面的 gate 敘述與三份 LF 複本，已另以本案工具較嚴的 `.env` 值掃描（所有 ≥6 字元的值，不分鍵名）檢查：唯一命中是 gate 輸出中 Vitest 列出的 claude CLI 橋接測試檔名，檔名含 `LLM_PROVIDER` 的供應商代號；它不是憑證，官方 gate 對追蹤原始碼只比對名稱像秘密的鍵，前兩輪已提交的 gate 複本也含同一字樣。`GEMINI_API_KEY`、`FINMIND_TOKEN` 等憑證類值零命中。gate 證明機械檢查，不代替正式平台行為或獨立覆核。

## 7. 啟動器孤兒缺陷修正與重驗（先紅後綠）

**測試方法先改得更貼近真實**（`tools/lifecycle-03.mjs`）：子程序崩潰只結束該程序本身（`taskkill /F`，不含 `/T`；真實崩潰不會連帶殺掉子孫），監督程序崩潰後輪詢到整棵樹消失才核對並記錄耗時，另加「看門程序也失效」情境，共 8 個情境。子孫樹改用驗收端獨立實作（`port-guard-03.mjs` 的 `launcherTree`），要求子程序建立時間不早於父程序，避免 Windows PID 重用把無關程序算進來。

**紅燈** [`life03-red-localhost3000-20260925-r2`](life03-red-localhost3000-20260925-r2/raw.json)：最終版驗收工具（與綠燈同雜湊）配上修正前的 `daily-dev.mjs`（暫時換回 `94848ac` 版本、跑完換回修正版並核對 SHA-256），5/8 PASS、3 FAIL——`crash-vercel`（**vercel 自己崩潰時內部 Vite＋esbuild 同樣逃出**，r2 用 `/T` 模擬所以沒抓到）、`crash-supervisor`（同前）、`crash-supervisor-no-watchdog`（舊啟動器沒有看門程序；殘留存在時 `start` 照樣成功，`recover` 無從清理）。工具結尾清掉這三棵孤兒。先前的 [`life03-red-localhost3000-20260925-r1`](life03-red-localhost3000-20260925-r1/raw.json) 用的是加建立時間守衛前的中間版工具，結論相同，只留時序。

**修正**（只改 `tools/daily-dev.mjs`，未改產品碼）：

1. 就緒後記錄監督程序底下的整棵子孫樹（PID、父 PID、程序名、建立時間）寫進狀態檔；子程序建立時間必須不早於父程序，監督程序與看門程序自己的查詢 PowerShell 不列入。記不到完整的樹就不宣告就緒。
2. 任何停止路徑（`stop`、Ctrl+C／SIGTERM／關閉終端機的 SIGHUP、子程序崩潰）都先補記仍在的子孫並與就緒樹合併，核對身分後以 `taskkill /T` 清到底，再結束看門程序、移除狀態檔。
3. 看門程序：同一支腳本的 `__watchdog` 模式，以 detached 啟動（不在監督程序的 job 內），透過 stdin 管道感知監督程序；管道結束而沒收到停止訊息，就核對身分清掉整棵樹並寫 log（`daily/watchdog-<token>.log`）。就緒前每 2 秒自行輪詢，啟動途中崩潰也有清單；看門程序起不來就拒絕啟動。
4. 後備：`start` 發現狀態檔記錄的樹、子程序、看門程序或 listener 仍在，就拒絕另起並指向 `recover`；`recover` 先停看門程序、清樹，再清子程序與監督程序，全部核對身分。沒有樹欄位的舊狀態檔照常可讀。

**綠燈** [`life03-localhost3000-20260925-r3`](life03-localhost3000-20260925-r3/raw.json)（[摘要](life03-localhost3000-20260925-r3/lifecycle-summary-226adea969e7.json)）：原 3000／3001、日常命令原樣，**8/8 PASS、exit 0**，工具結尾的殘留清理找到 0 個；哨兵 0 事件、監看 463 次 0 外部用戶端。

| 情境 | 結果 |
|---|---|
| 兩次啟停 | 各 8.5 秒就緒，整棵 12 個程序（狀態檔 11 個＋看門程序）；stop 2.2／2.6 秒，看門 log「收到正常停止：清理存活 0 個」；0 殘留 |
| 3000／3001 被占用 | 立即 exit 1「指定埠已有 listener；不接管其他服務。」，占用服務照常回應 |
| vercel 自己崩潰（只結束 vercel） | 監督程序 2.7 秒內收尾，結束後 0.36 秒整棵樹清空（含逃出 job 的內部 Vite＋esbuild）；重啟 8.9 秒就緒 |
| Vite 自己崩潰 | 1.9 秒內收尾，0.37 秒後清空；重啟正常 |
| 監督程序被強制結束 | 看門程序在管道結束後清掉 `node.exe`＋`esbuild.exe` 兩個逃逸程序，1.7 秒內整棵樹清空；`status` exit 1「沒有可確認的本案日常服務」；下次 `start` 把殘留狀態改名 `state.json.stale-<時間戳>` 後正常；舊樹 0 殘留 |
| 看門程序也失效後再殺監督程序 | 殘留 `node.exe`＋`esbuild.exe`；`start` 拒絕「控制管道失聯…請先使用 recover」；`recover` 依狀態檔的樹清掉兩個程序（4.8 秒）；之後啟停正常 |

**App 重驗** [`app03-localhost3000-20260925-r3`](app03-localhost3000-20260925-r3/raw.json)（[摘要](app03-localhost3000-20260925-r3/app-summary-0ca50766a674.json)、[28 張截圖](app03-localhost3000-20260925-r3/screens/)）：修正後的啟動器、同一套 14 步，**桌面＋窄版 28/28 PASS、exit 0**。App 工具也改為核對整棵樹：就緒時 12 個程序（含看門程序），停止後 0 殘留；非預期 console 0、失敗請求 0；請求分類與 r2 同型（每個視窗瀏覽器自發 2、串流完整送達後取消 2）；後端只有固定上游類別，假 CLI 4 次各 5 段、0 次被殺。

**回歸**：失聯狀態保護 [`stale03-20260925-r2`](stale03-20260925-r2/raw.json) PASS；失聯復原 [`recover03-20260925-r3`](recover03-20260925-r3/raw.json) PASS（相容沒有樹欄位的舊狀態檔，錯誤建立時間的重用 PID 不殺）；固定成本 [`daily03-cost-20260925-r2`](daily03-cost-20260925-r2/raw.json)：OPTIONS 20/20 中位 15.48 ms、GET 20/20 中位 77.89 ms（固定等待內含）。修正後全系統查詢：無殘留的 dev 程序、esbuild 或隔離 Chrome。

**代價**：停止多了程序樹核對與看門程序收尾，`stop` 約 2.2～2.6 秒（CLI 等待上限由 15 秒放寬為 30 秒）；啟動多一次程序表查詢與一個常駐看門程序。

## 8. 03 驗收逐項判定

| 驗收項 | 判定 | 證據 |
|---|---|---|
| 日常入口與量測入口同源、同 handler、同設定，來源 manifest 可證明 | **PASS** | [來源清單 r6](SOURCE-MANIFEST-20260925-r6.json)（26 檔，提交後逐檔對 blob；r4／r5 為修正啟動器前的版本）；App r3 與重載 r1 的 raw 各自記錄候選來源 SHA-256；日常與量測共用 `daily-dev.mjs`，量測僅多後端測試預載 |
| 連續兩次啟停／restart、埠衝突、語法錯誤、依賴刪除／恢復、環境變更都有明確結果 | **PASS** | 生命週期 r3（兩次啟停、雙埠衝突、vercel／Vite／監督程序崩潰、看門程序也失效，共 8 情境）；重載 r1（語法錯誤、環境、刪路由、刪／復依賴、串流中改碼） |
| 無 orphan child、無舊碼服務、無秘密洩漏，其他服務未被關閉 | **PASS**（修正後；修正前 r2 與紅燈 run 為 FAIL，原樣保留） | 生命週期 r3 每個情境停止或崩潰後整棵程序樹 0 殘留，工具結尾清理找到 0 個；App r3 停止後 12 個程序 0 殘留；紅燈 `life03-red-…-r2` 證明修正前三個崩潰情境會留孤兒。無舊碼：重載 r1 語法錯誤／刪依賴不回舊碼。秘密：各工具 `.env` 值掃描 0 命中、gate 金鑰掃描乾淨。其他服務：只終止身分核對過的本案 PID，占用測試服務照常回應 |
| 採用候選：正式 App 端到端打到候選，固定 GET 與 OPTIONS 低成本仍成立 | **PASS** | App r3（修正後啟動器，原 3000、28/28）與 r2；低成本 [`daily03-cost-20260925-r2`](daily03-cost-20260925-r2/raw.json)（修正後啟動器，OPTIONS 中位 15.48 ms、GET 中位 77.89 ms，各 20/20；量於備用埠 4791） |
| 原 Vercel 部署配置及 API 行為保留；有一個可驗證的回復命令 | **部分 PASS／正式平台 OPEN** | 部署設定、路由、正式前端產物：deploy r1 PASS；本機標準 runtime API：parity r5 59/59；正式平台 API／取消：**未實測，OPEN**。回復：日常入口改回原入口（`scripts/start-dev.ps1`，或 `npx vercel dev --listen 3001` 加 `npm run dev`）於 09-25 由使用者啟動並經重驗核對 200／204；產品碼回復為 `git revert` 03 的產品提交，本輪未演練 |
| 隔離完整 gate、獨立 Standards／Spec 覆核、精確提交與日常命令文件 | **部分完成／覆核 OPEN** | gate 見第 6 節；精確提交見本輪 commit；日常命令見 [REPORT](REPORT.md) §6 與本檔第 7 節（看門程序與 `recover` 行為）；**本輪增量（含啟動器修正）尚未做獨立雙軸覆核** |

## 9. 剩餘缺口

1. 正式 Vercel 部署的 API 與取消行為未實測（需部署或平台日誌，依指示未做）。
2. 本輪增量尚未由未參與者做獨立 Standards／Spec 覆核：`daily-dev.mjs` 的孤兒修正（程序樹、看門程序、後備清理，屬實作變更）、`app-03.mjs`、`port-guard-03.mjs`、`lifecycle-03.mjs`、`deploy-static-03.mjs`、`c-reload.mjs` 修改與本文件。
3. 請求分類中「瀏覽器自發」與「串流完整送達後取消」兩類是本輪判定器新增的分類規則；後者成因未定位。是否接受為非失敗，請使用者裁定。
4. 全案效能目標（十檔冷庫存、K 線冷載入、暖回訪、舊 05 雙 40%）仍屬 04～07，未因本票變動。

已修正：啟動器孤兒缺陷（第 7 節，紅燈→綠燈）；App 工具殘留檢查改為核對整棵樹（App r3）。

所以 03 的原來源 App、依賴重載、生命週期原始紀錄、部署路徑靜態核對與啟動器孤兒修正都已完成，但 **03 仍為 OPEN**：正式平台行為未實測、本輪增量待獨立覆核、請求分類待裁定；04 不自動解鎖。
