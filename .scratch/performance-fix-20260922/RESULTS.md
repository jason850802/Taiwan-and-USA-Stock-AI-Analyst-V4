# 本機 K 線與庫存報價效能修復結果（2026-09-23）

## 判定與範圍

**全案尚未完成。** 01～03 的 E0 formal 基準缺原協定所需的兩次成功 start 與暖樣本；05 的有效十檔真行情 v5 雙 40% 門檻均未達。04、06 的產品修正保留，三槽上限及 peak=3 測試期望不變。07 只交付目前可核對的正式介面證據與限制，保持 OPEN。下列數字是本機小樣本，不是正式部署 SLA。

## 本機環境已改善

`evidence/01/formal-options-v6-20260923/` 與 `evidence/02/formal-options-v6-20260923/` 在同源 manifest 下驗 E0、E1、E2、clean。E1 只排除 Vercel 的非產品目錄，E2 再排除 Vite watcher 的驗收證據。E1／E2／clean 各有兩個獨立 service start，每 start 每路由 cold 1 筆、交錯 warm 5 對，全 204；owned PID 等於 listener PID，port 各異，來源、設定、工具及版本身分可核對。

| OPTIONS 路由 | clean warm 中位數 | 門檻（clean×1.25＋250 ms） | E1 warm 中位數 | E2 warm 中位數 |
|---|---:|---:|---:|---:|
| Yahoo chart | 1775.93 ms | 2469.91 ms | 1945.51 ms（PASS） | 1804.07 ms（PASS） |
| FinMind | 1799.71 ms | 2499.64 ms | 1971.96 ms（PASS） | 1813.48 ms（PASS） |

E0 start-1 的 Vercel 在 90 秒內無 `Ready!`，留下 status／log 並依 fail-fast 停止；start-2 未跑。這支持「原 full root 啟動失敗／嚴重慢速」的觀察，但不能算 E0 warm 中位數，亦不能計算 E1／E2 相對 E0 至少 50% 的降幅。01～03 因凍結協定未滿足而 OPEN，03 的精簡 API root 未實作分支尚不可形式上結案。v1 的歷史 clean 及缺 per-start 身分的資料只作方向參照；比較器 v6 的 `--before` 候選自比只取 `referencePass`，不把 `slowReproduced=false` 包裝成 E0 通過。詳 `evidence/02/formal-options-closure-review.md`。

## 固定資料行為驗證

- 04 的正式 hook 已在 Yahoo 有效價格到達後先顯示報價、釋放 queue 槽，台股名稱稍後補入；名稱 pending／失敗、force、移除／重加、世代與快取競態由回歸及固定回應控制器覆蓋。產品提交 `e9fa1a2`。
- 05 的十／三十檔固定上游各 5 個 force 回合，每輪 16／46 支請求完整；HTTP peak 全為 3，FX 起跑順位全為 1。十檔首價／全部報價＋匯率／最大 quote+FX 排隊／名稱全可見中位數為 `96.2／376.0／280.2／566.2 ms`；三十檔為 `103.6／1059.3／964.8／1539.9 ms`。3／4／6 槽假上游實驗顯示尾端可縮短，但 peak 同步變為 3／4／6；未更改產品上限。產品提交 `2bd91f4`。
- 06 固定成功上游的十個 K 線情境，before／after 的最終完整輸出 combined SHA-256 均為 `516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3`。FinMind PV 失敗按已核准語意照常發布並只享 10 分鐘短 TTL；AbortError 保留取消身分；籌碼不可用送「資料暫時不可用」。回歸鎖 11 案，產品提交 `6eee87e`。
- 合成 App 桌面 1280×720 與窄版 375×812 驗搜尋、五種週期、暖回訪、強制更新、十檔庫存 16 支請求（匯率第 1 支）、快照、健檢輸入簽章、移除／重加，兩頁均 0 page error／0 unhandled。正式 App 只在全新隔離 origin 使用合成五鍵，不接觸真帳本或真 AI；功能 raw 未保存操作後五鍵原始字串，故不宣稱此 App 路徑完成逐值一致比對。只讀真行情 hook 的 raw 另記 `coreUnchanged=true`。原始檔在 `evidence/07/app-acceptance-20260923-v1/`。
- 06 的可見面板畫面時間以新探針補 before／after 各 14 項，同方法配對、1280×720、0 error；暖回訪 0 chart，兩側數值接近，未見穩定退化。v4 在量測前後核對 listener PID、實際探針內容與產品副本身分；v3 留作另一輪參照。舊 `screen-before-desktop-full.json` 因面板轉背景而無效；舊 `screen-after-desktop.json` 保留有效參照，但不與新探針計算跨方法改善率。詳 `evidence/07/app-screen-20260923-v4/REVIEW.md`。

## 真上游觀察

05 的 v3 曾回報首價 65.59% PASS／全部報價＋匯率 -0.39% FAIL，但 pair 2／3 同 origin 受瀏覽器 `stale-while-revalidate` 污染，逐頁有 7～16/16 支請求在 1 秒內完成；兩項舊判定均撤銷。v4 再次碰到快取即中止。正式改採每頁全新 port 的 v5，before `444d6b1`、after `6eee87e`，三組交錯、每頁 16/16 成功、HTTP peak=3、快取命中 0、429 為 0、page error 為 0、本體五鍵不變；來源及服務身分在 `evidence/07/true-market-07-20260923-v4/identity.json`。

| 十檔真行情指標 | before 三輪 | 中位數 | after 三輪 | 中位數 | 改善 | 40% |
|---|---|---:|---|---:|---:|---|
| 首個有效報價 | 8448.4／6901.8／6696.5 ms | 6901.8 ms | 4602.5／4419.4／4172.3 ms | 4419.4 ms | 35.97% | FAIL |
| 全部有效報價＋匯率 | 23170.2／20729.8／20586.1 ms | 20729.8 ms | 17566.1／16637.7／16309.6 ms | 16637.7 ms | 19.74% | FAIL |

verifier 對 v5 輸出 `problems=[]`、`thresholdPass=false`、exit 1。三十檔只是一組觀察：首價 `6545.8 → 4268.5 ms`（約 34.8%）、全部報價＋匯率 `54238.2 → 44882.9 ms`（約 17.2%）；before／after 各 46 請求、HTTP 200、0 個 429、peak=3。不得以三十檔單輪外推正式改善率。

十檔 K 線真上游各做 before／after 兩組（四頁）；每頁 35 請求、快取命中 0、429 為 0，cold／warm 各 10/10 有效，暖回訪 0 請求。pair 1 首批／完整中位數 `4613.8／5073.5 → 4646.7／4946.3 ms`；pair 2 為 `4758.5／5008.4 → 4598.0／5072.0 ms`，無穩定提速。原探針把 10y 先到後取消的同 symbol 2y AbortError 算為非 200；排除三筆設計內取消後，四頁均重判 PASS、其他錯誤 0。詳 `evidence/07/true-market-07-20260923-v4/CHART-REVIEW.md`。

## 正式部署未驗證

本輪只驗 localhost 的 Vercel dev、隔離 Vite runtime、真 Yahoo／FinMind 及合成 App；未推送、未部署、未發版。不能把本機 1.8 秒左右的空 OPTIONS 或真上游小樣本寫成部署 SLA，也不能以合成 App 全綠取代 05 的真行情雙 40% 失敗。真 AI、真帳本未使用。

## 驗證、啟停與回復

隔離 checkout `C:\pfv7`（detached `6eee87e`）執行 `npm.cmd run gate -- --require-env`，`GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=safe.directory`、`GIT_CONFIG_VALUE_0=C:/pfv7` 僅在該命令的環境變數設定；tsc 0 錯、49 files／823 tests 全綠、Vite build 成功、金鑰掃描涵蓋 dist 15 檔與追蹤原始碼 1560 檔，並從主工作區 `.env` 讀取 6 筆值，結果乾淨；package／lock 與 HEAD 相同。獨立 Standards／Spec 覆核發現 E0 失敗仍 exit 0、merged 只比列數、K 線服務未拒絕 listener PID 不一致、畫面來源標籤缺即時核對等問題；工具已修正，自測 16/16 通過，舊 v6 `validation.json` 保持當時版本，收尾另用修正版 validator 唯讀重驗 clean／E1／E2（各 2 starts、24 rows、0 failure）。已核實舊頁面 port 會 fail-fast 拒絕、非法 run-id 會拒絕。本輪補強工具不影響先前產品碼 gate 的結論。`package.json`／`package-lock.json`、Vitest 收錄、三槽常數與 peak=3 測試期望均未改；工具、文件與原始證據採精確路徑提交，`runtime/` 不提交。

重跑 OPTIONS：`node .scratch/performance-fix-20260922/tools/prepare-options-formal-v2.mjs --run-id <新代號>`，再執行 `node .scratch/performance-fix-20260922/tools/run-options-formal-all-v2.mjs <新代號>`。重跑真行情服務組：`node .scratch/performance-fix-20260922/tools/true-market-stack-07.mjs --run-id <新07代號> --holdings-run-id <新05代號> --page-port-base <未用過的連續十二個 port 起點>`，按該工具的 STOP 檔結束；工具會拒絕已在 identity 使用過的頁面 port，避免瀏覽器快取污染。重判十檔：`node .scratch/performance-fix-20260922/tools/verify-holdings-true-market.mjs --run-id <新05代號> --after-source-id 6eee87e`。重跑工具自測：`node .scratch/performance-fix-20260922/tools/self-test.mjs`。gate 只在隔離 checkout `C:\pfv7` 執行 `npm.cmd run gate -- --require-env`，`safe.directory` 只用 `GIT_CONFIG_COUNT／GIT_CONFIG_KEY_0／GIT_CONFIG_VALUE_0` 環境變數，不改全域設定。

逐票產品提交：01 `08a25be`、02 `c92dfa1`、03 `444d6b1`、04 `e9fa1a2`、05 `2bd91f4`、06 `6eee87e`；07 僅為本輪證據整理，OPEN 時無完成提交。若需回復產品行為，逐票用對應 commit 的 `git revert` 另開變更並重跑 gate；不要 `reset --hard`、`git clean` 或復原全樹，且保留 P1／S1 既有防護。服務停止只處理本案確認的 PID／STOP 檔；收尾核對本案埠 listener 為 0。已逐一刪除 `runtime/` 內 14 份 `.env` 複本，剩餘 0；主工作區根目錄 `.env` 保留，目錄與 log 未刪。
