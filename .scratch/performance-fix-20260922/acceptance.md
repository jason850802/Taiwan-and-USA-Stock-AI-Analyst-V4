# 本機效能修復共同驗收手冊

本手冊把 PLAN 的量測口徑固定成可重跑流程。01 先凍結方法；後續票只能補充該票需要的資料，不能在看完候選結果後降低門檻。

## 1. 每一輪先固定身分

正式 run 必須先建立新的證據目錄，舊目錄不可覆寫。01 提供的身分工具以診斷 clean manifest 的 173 個產品／設定檔為既有來源集合，重新計算目前內容雜湊，並保存 HEAD、tracked diff、untracked 狀態摘要、package／lock 雜湊、工具雜湊、Node／Vercel 執行資訊、時區與 `.env` 變數名稱。

範例：

```powershell
node .scratch/performance-fix-20260922/tools/capture-baseline-identity.mjs --run-id 01-before-<唯一代號>
```

若輸出目錄已存在、來源清單遺失或來源檔無法讀取，命令必須非零退出。秘密值及其雜湊不得進證據。

## 2. 空 OPTIONS

正式原始資料每列至少要有：路由、狀態、總時間、cold／warm、服務啟動識別，以及 warm 配對識別。Yahoo chart 與 FinMind 分開統計；每個服務啟動的每條路由都要有 cold，再至少五個交錯 warm pair。同一服務啟動內，每條路由的 warm pairId 不可重複，Yahoo 與 FinMind 的 pairId 集合必須一對一相同；總共至少兩次獨立服務啟動。

每個 formal start 另需保存可機械核對的實際服務身分：owned spawn PID 必須等於實際 listener PID，並保存 port、完整 command、cwd、來源 HEAD／manifest、候選設定雜湊、量測工具雜湊、Node／Vercel（及同輪 Vite）版本與時區。兩個 start 的實際 PID 與 port 都必須不同；只靠呼叫端自填 `serviceStartId` 不算獨立啟動證據。

E0／E1／E2 的正式 OPTIONS 比較使用同一輪建立的同期 clean reference。clean reference 自身也必須符合兩次 independent starts、每 route cold + matched warm pairs、全 204 與上述 identity 契約，且與 E0／E1／E2 綁定同一份產品來源 manifest。歷史 diagnosis clean 只能用 `threshold-only` 作方向／比較器 sanity，不能作 formal reference。

Formal capture 採 fail-fast：任何 service 啟動失敗、HTTP timeout／error 或非 204 都要保存已取得的 identity、raw、log 與 status，立即停止該 start／variant 的 formal protocol；不得追加樣本、重跑同 protocol 或排除失敗列來湊綠。

比較器預設使用正式協定。它必須拒絕非 204、error、缺路由、缺時間、樣本不足或啟動識別不足；門檻逐路由判定，再給總體摘要。

```powershell
node .scratch/performance-fix-20260922/tools/compare-options.mjs --before <before.json> --candidate <candidate.json> --reference <clean.json> --output <result.json>
```

歷史診斷格式可用 port selector 讀取，但只允許 `--protocol threshold-only` 驗證比較器與歷史方向，不得標成 formal before：

```powershell
node .scratch/performance-fix-20260922/tools/compare-options.mjs --before .scratch/performance-diagnosis-20260922/http-probes.json --before-port 3001 --candidate .scratch/performance-diagnosis-20260922/http-probes.json --candidate-port 3002 --reference .scratch/performance-diagnosis-20260922/http-probes.json --reference-port 3002 --protocol threshold-only
```

正式通過條件：候選暖中位數 `<= clean * 1.25 + 250ms`；若同期 before 超過同一 clean 門檻而確實重現慢速，候選還需比 before 至少快 50%。逾時留在 raw 中並判失敗。

## 3. 名稱阻塞紅燈

01 的 browser fixture 只掛正式 `useHoldingPrices`，攔截所有相關 API，使用合成台股代碼與固定 Yahoo chart 回應。前三個 Yahoo 報價立即完成，三個名稱 Promise 保持 pending；第四個報價是 queue 是否被名稱占槽的觀察點。

在名稱尚未釋放時，同時成立才算綠：

- 前三檔已有正數價格、`loading=false`、`error=false`。
- 第四檔 Yahoo 價格工作已起跑。
- 名稱請求仍 pending，沒有靠先完成名稱取得綠燈。
- 五把本體資料在測試前後逐值一致。

fixture 會把判定保存到 `window.__holdingsNameBlocking` 並在頁面顯示 PASS／FAIL；之後才釋放名稱 Promise，讓頁面可乾淨收尾。驗證器接受 fixture 匯出的 JSON；狀態錯誤、缺欄位、名稱已先釋放、價格仍 loading 或第四筆未起跑都必須非零退出。

本 fixture 是 01 的 red-capable seam。當前產品預期在「名稱仍 pending」觀察點 FAIL；04 修正後同一 fixture 應 PASS。自測只驗證判定器能辨識合成 PASS／FAIL，不取代正式 hook 的 browser run。

## 4. 庫存批次量測

固定十檔沿用診斷的五台股＋五美股。三十檔清單在 01 正式執行時一次固定並寫進證據。每批分成全冷、同頁暖回訪與 force，不混算。

每檔至少記：任務入列、HTTP start、headers、body complete、有效價格可見、名稱補齊；匯率另記完成時間。逐列成功必須 `error=false` 且價格有效，不能把 loading 結束當成功。實際 HTTP 峰值需從 fetch 邊界量，不以 worker 數推估。

真行情只在 before 與選定 candidate 做有界批次；固定行情負責大量重跑、pending 順序、429／錯誤與競態。

## 5. K 線量測

正式搜尋操作記錄輸入／送出時間、第一批有效 K 線可見、完整歷史／必要 context 完成，以及 chart API TTFB。台／美股與日／週／月／分線需覆蓋；2y／10y 順序、失敗、背景刷新、A→B→A、多訂閱與個別取消使用固定回應驗證。

固定上游下比較最終完整輸出雜湊。若提前顯示需要新增 readiness 契約，先停在設計決策，不把未修正 OHLC 或未完成 context 當正式結果。

## 6. 本體資料與正式 App

正式 App 驗收使用隔離 origin／瀏覽器儲存與合成持股。每次操作前後保存以下五鍵原始字串並逐值比較：

- `portfolio_items`
- `portfolio_transactions_v1`
- `portfolio_import_log_v1`
- `portfolio_realized_trades_v1`
- `portfolio_snapshots_v1`

同時驗證快照與健檢失效邊界，保留既有 P1／S1 身分與世代防護。真行情 hook 實測與假資料 App 驗收分開陳述。

## 7. 自測與負向測試

01 工具自測命令：

```powershell
node .scratch/performance-fix-20260922/tools/self-test.mjs
```

自測至少證明：歷史 clean 作 candidate 時門檻方向可通過；故意把歷史慢原站作 candidate 時比較器非零；OPTIONS status／漏列可判紅；warm 不可跨服務啟動湊足數量，pairId 不一致、缺對應或重複可判紅；merged 同列數但內容與 raw 不同可判紅；overall 只作摘要、不額外形成門檻；名稱阻塞判定器對 PASS／FAIL 合成資料給出相反退出碼；既有輸出不可覆寫。

## 8. 每票共同收尾

改 TypeScript 的可驗證批次跑 `npx.cmd tsc --noEmit`；改碼票收尾跑 `npm.cmd run gate`。另核 package／lock 零變動、秘密掃描、來源／serve 身分、預期與非預期 console error，以及 Standards／Spec 雙軸覆核。

每票回報：狀態與 commit、實際行為、before→after 口徑與樣本、正確性／快取／匯率／本體資料、gate 與瀏覽器、證據入口與重跑命令、回復方式、未驗收限制，以及下一票前置是否滿足。
