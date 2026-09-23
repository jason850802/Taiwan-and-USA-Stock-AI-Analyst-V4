# 上一輪效能修復的現況稽核

日期：2026-09-23。核對分支：`codex/reacceptance-fixes-p1-s1`；HEAD：`30dfdb2`。本輪只讀重算證據與制定計畫，沒有重新量真行情，也沒有修改產品。

規劃收尾盤點：本案指定埠的 listener 為 0；skip-worktree 為 1841 檔，其中當下實體缺檔 805（交接記錄為 806，以本輪盤點為準，未清 flags 或還原全樹）。本輪文件尚未提交；既有無關變更保留。

## 判斷

**已有局部修復，但使用者等待時間的主要來源尚未處理。** 最後一筆 `30dfdb2` 的 149 檔全在本案 `.scratch`，是工具、證據及文件整理；最後的產品提交仍是 `6eee87e`。不能把「收尾完成」解讀成「整體效能達標」。

上一輪最有效的產品修正是報價不再等中文名稱。可是單次報價 API 仍等約 4.1 秒才回應，十檔加匯率在三槽下約需四波，因此全部有效報價仍要 16.64 秒。K 線的真上游量測未見穩定提速。

## 七張票目前完成了什麼

| 原票 | 現況 | 已交付 | OPEN 或效能限制的真正原因 |
|---|---|---|---|
| 01 基準與紅燈 | OPEN／ready-for-human | 比較器、身分工具、名稱阻塞紅燈、原始證據 | E0 未完成兩次成功啟動與暖樣本，無法取得原協定的正式 before |
| 02 排除非產品目錄 | OPEN／ready-for-human | `c92dfa1`：Vercel／Vite 排除設定；E1／E2 接近同期 clean | 環境改善有證據；相對 E0 的 50% 無法計算。clean 自身仍約 1.8 秒，接近 clean 並不等於反應快 |
| 03 精簡 API root | OPEN／ready-for-human | `444d6b1`：當時選擇不實作的文件決定 | 沒有新增日常 API 執行入口；原本「不需實作」依賴的正式 E0 條件不足。精簡副本也沒有消除約 1.8 秒的空請求成本 |
| 04 報價與名稱解耦 | resolved | `e9fa1a2`：有效價格先發布，名稱另補；UI／快取世代防護 | 局部阻塞已修復，不能消除 API 本身的等待 |
| 05 三槽重新量測 | OPEN／ready-for-human | `2bd91f4`：FX 先入列；固定資料與三／四／六槽實驗 | 有效 v5 的首價 35.97%、全部報價＋FX 19.74%，均不足 40%。沒有採用新的降低單次 API 成本方案 |
| 06 K 線等待分類 | resolved | `6eee87e`：取消與失敗處理、短快取、籌碼缺值語意；可見畫面證據 | 這張票允許「安全收益不足則保留等待」結案；resolved 證明局部正確性與分類完成，不代表 K 線加速 |
| 07 最終驗收 | OPEN／ready-for-human | 結果報告、工具覆核、823 案 gate、清理 | 前置效能條件未過；合成 App 缺操作後五鍵原始字串。部署未驗證是範圍限制，並非本機修復的待辦 |

來源：[舊結果報告](../performance-fix-20260922/RESULTS.md)、[原票目錄](../performance-fix-20260922/issues/)、[OPTIONS 結案覆核](../performance-fix-20260922/evidence/02/formal-options-closure-review.md)。04／06 保持已完成的局部產品成果，不因其他票重新 OPEN 而重寫它們。

## 從 v5 raw 重新拆解的時間

本次直接讀六份 v5 JSON，以每支請求的 `bodyMs-startMs`、`headersMs-startMs`、`visible[symbol]-bodyMs` 重算；30 筆報價的中位數採排序中央兩值平均。這是保存樣本的再分析，沒有發新請求。

| 指標 | before | after | 意義 |
|---|---:|---:|---|
| 十檔首個有效價格（三批中位數） | 6901.8 ms | 4419.4 ms | 改善 35.97%，仍需等數秒 |
| 十檔全部有效價格＋FX（三批中位數） | 20729.8 ms | 16637.7 ms | 改善 19.74%，尾端仍慢 |
| 單支報價 HTTP 至 body（各 30 筆中位數） | 4091.8 ms | 4118.3 ms | 單次服務成本沒有明顯降低 |
| 台股 body 完成至價格可見（各 15 筆中位數） | 2382.9 ms | 1.9 ms | 名稱解耦確實有效 |
| after 報價 TTFB（30 筆中位數） | — | 4116.7 ms | 幾乎全部時間發生在 headers 到達前 |
| after body 讀取（30 筆中位數） | — | 0.95 ms | JSON 下載不是此報價樣本的主要成本 |
| after body 至價格可見（30 筆） | — | 中位 1.8／最大 4.3 ms | 報價 UI 發布已很快，優先再改 React 難以解決 16 秒尾端 |

原始檔：[v5 三組配對](../performance-fix-20260922/evidence/05/true-market-paired-20260923-v5/)。本次也重跑既有驗證器：

```powershell
node .scratch/performance-fix-20260922/tools/verify-holdings-true-market.mjs --run-id true-market-paired-20260923-v5 --after-source-id 6eee87e
```

結果：`problems=[]`、`thresholdPass=false`、exit 1；沒有覆寫摘要。這是已保存真行情 trace 的可判紅重播，不能取代下一輪 fresh 實測。

以舊 v5 before 估算，原 40% 線是首價 4141.1 ms、全價＋FX 12437.9 ms；目前分別還差 278.3 ms、4199.8 ms。這只是規劃估算，下一輪不能拿歷史數值當同期通過門檻。

## 為何原計畫卡住

1. **進度入口過期。** 本輪稽核前，原 PLAN 首頁仍寫尚未採用／實作；原票 03 的歷史註記也與頁首狀態不同。實際狀態在票面與 RESULTS，讀者容易混淆。本輪已修正原 PLAN 的入口摘要並連到新計畫，原始門檻與歷史紀錄保留。
2. **E0 啟動失敗沒有結案分支。** v6 的內層 Vite 約 418 ms 就緒，但外層 Vercel 90 秒內沒有 Ready，沒有 raw／identity。這證明整體啟動逾時，尚不能斷言卡在檔案掃描。fail-fast 是正確保護；問題在於後續票只能接受成功 E0 暖樣本，形成無法計算的依賴。
3. **門檻只要求接近另一個慢環境。** E2 空 OPTIONS 約 1.8 秒已通過相對 clean 門檻，於是沒有進入更深入的本機 runtime 改善；這不能保證十多支請求排隊後仍夠快。
4. **缺少 handler 內部與入口之前的分段計時。** 現有 browser trace 把本機派送、模組載入、guard、Yahoo 握手／重試、上游等待都包在 TTFB 裡。不能直接把 4.1 秒全怪 Yahoo，或把 OPTIONS 1.8 秒直接從每支 GET 相減當因果證明。
5. **K 線票偏向正確性收斂。** 保留必要價量與籌碼是對的，但名稱仍可能 gate 首屏；沒有新數值目標去要求繼續消除安全可控的等待。
6. **證據修復反覆消耗工時。** v3 快取污染、背景面板、來源身分不足、合成 App 五鍵缺口都使驗收重跑；下一輪先一次凍結最小工具，再把工時集中在改變請求成本。

## 本輪重新核對的本機執行機制

除了讀歷史診斷，本輪直接檢查目前安裝的 `Vercel 55.0.0` 與其 `@vercel/node 5.8.23`。安裝根為 `C:\Users\jason\AppData\Roaming\npm\node_modules\vercel`，核對點如下：

- `dist/commands/dev/index.js:20283`：HTTP function 路徑呼叫 `builder.startDevServer()`；`20322–20327`：沒有 `persistent` 時，在 response close 關閉子程序。
- `node_modules/@vercel/node/dist/index.js:73024`：Node 分支呼叫 `child_process.fork()`；`73218`：每次 `startDevServer` 呼叫該建立程序函式；`73258`：回傳 port／pid／shutdown，沒有 `persistent`。
- `node_modules/@vercel/node/dist/dev-server.mjs:1138`：子程序重新 `import(id)` 載入 handler。
- 專案 `api/_lib/yahoo.ts:75,93,160–185`：10 分鐘 cookie／crumb 世代與 pending 共用保存在模組變數。它可以在同一實例共享，但不能跨已被銷毀的子程序保留。

因此，已核對的 Node dev 路徑確實具有逐次建立程序／載入 handler 的機制；既有握手快取在此邊界無法跨 HTTP 保留，是優先驗證長駐候選的依據。這不代表已測出各段耗時或新的加速百分比。本輪沒有啟站；下一票仍須綁定實際 CLI／builder 身分，記錄每請求的 handler 實例及 cookie／crumb／chart outbound，以確認執行路徑與成本。不能由本機結論推論正式部署也會逐次重建。

## 下一輪優先順序

先拆出本機固定成本，再以同一套正式 handler 驗證長駐本機執行是否能消除該成本；通過相容性後接入日常入口。之後才處理 Yahoo 握手／重複請求、K 線純名稱等待及已證實的繪圖成本。三槽維持，已證明正常的報價發布路徑不重寫。詳細工作、數值目標與停手分支見 [新 PLAN](PLAN.md)。
