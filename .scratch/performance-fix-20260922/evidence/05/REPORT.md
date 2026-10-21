# 05 — 三槽重新量測與併發實驗

日期：2026-09-23  
原固定資料修正提交：`e9fa1a2`；本報告追加 v5 真行情判定時主工作區 HEAD：`6eee87e`（before `444d6b1`、after `6eee87e`）。
Node：`v26.4.0`

## 結論

**固定行情仍支持維持三槽；有效真行情 v5 的首價與全部報價＋匯率改善率分別為 35.97%／19.74%，雙 40% 門檻均未通過，本票保持 OPEN。**

正式 `useHoldingPrices` 的 FX enqueue 次序已修正：有美股時先把 `exchange-rate` 放入同一 queue，再放入各 quote；FX 數值、失敗沿用、快取與金融計算皆未改。修正後固定 upstream 的 10／30 檔各五個 force 回合都 `pass=true`，HTTP peak 全為 **3**，FX start rank 十輪全為 **1**。30 檔 quote/FX 最大排隊中位數為 **964.8 ms**、全部有效 quote+FX **1059.3 ms**、第一個有效報價 **103.6 ms**；仍可見三槽造成的尾端排隊。

隔離的 deterministic 3/4/6 實驗仍顯示，提高上限可縮短尾端，但會把 HTTP peak 由 3 提高到 4 或 6，因此目前保留三槽。歷史診斷單輪 `16.67 / 42.02 s` 與 04 後單輪 `3.057 / 11.962 s` 只能作方向觀察。原 v3 的 pair 2／3 混入同 origin 的瀏覽器快取，舊首價 65.59% PASS／全部 -0.39% FAIL **均撤銷**。正式判定改用每頁全新 port 的 v5：六輪 16/16 成功、HTTP peak=3、快取命中 0；首價 `6901.8 → 4419.4 ms`（**35.97%，FAIL**），全部報價＋匯率 `20729.8 → 16637.7 ms`（**19.74%，FAIL**）。

v3 raw 的結構可供方法稽核，但不能作效能門檻證據；其 contemporaneous serve 身分亦不完整。v5 的來源與服務身分見 `evidence/07/true-market-07-20260923-v4/identity.json`，before 為 `444d6b1`、after 為 `6eee87e` 的獨立 runtime 副本。

## 三槽正式固定 upstream 量測

量測頁：`tools/holdings-batch-probe.html` / `holdings-batch-probe.jsx`。正式 hook、正式 queue、正式 quote/name cache 路徑都保留；只有 `/api/yahoo/chart` 與 `/api/finmind` 被攔到本機 `holdings-fixed-upstream.mjs`。每批先 cold、再 warm，正式統計使用 **5 個 force 回合**，避免 cache hit 與舊 state 充數。force 完成前必須證明本輪預期 request 全部實際起跑；價格、FX 與名稱的 visible 時間只在本輪對應 body 完成後才可記錄。

| 批次 | 請求數/輪 | HTTP peak | 首個有效報價 | 全部有效報價+FX | quote/FX 排隊中位 | quote/FX 最大排隊 | 名稱全可見 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10 檔 | 16 | 3 | 96.2 ms (90.3–107.2) | 376.0 ms (372.0–385.4) | 95.6 ms (89.2–108.8) | 280.2 ms (278.2–288.5) | 566.2 ms (555.1–573.4) |
| 30 檔 | 46 | 3 | 103.6 ms (90.4–111.0) | 1059.3 ms (1042.3–1205.9) | 487.6 ms (475.5–497.9) | 964.8 ms (945.9–1108.9) | 1539.9 ms (1507.5–1671.6) |

兩批五輪皆 `pass=true`；10 檔每輪固定為 10 quote + 1 FX + 5 name = 16 requests，30 檔為 30 quote + 1 FX + 15 name = 46 requests。所有回合實際 HTTP peak 都是 3，FX start rank 全為 1；沒有靠漏項、取消或無界併發取得結果。warm 回訪保留 0 request cache-hit 行為，未混入 force 統計。

原始資料與 verifier：

- `evidence/05/fixed-three-slot-fx-priority-20260923-v1/holdings-10.json`
- `evidence/05/fixed-three-slot-fx-priority-20260923-v1/holdings-30.json`
- `evidence/05/fixed-three-slot-fx-priority-20260923-v1/summary.json`
- `tools/verify-holdings-concurrency.mjs`

## 真行情 paired protocol：v5 有效正式判定

三組交錯順序為 `before-1 → after-1 → before-2 → after-2 → before-3 → after-3`，每頁使用未用過的 port 建立全新 origin。六頁各有 16/16 個成功請求、10/10 個有效報價、5/5 個名稱、HTTP peak=3、0 個 429、0 個 page error，Resource Timing 快取命中均為 0。本體五鍵保持一致。來源身分與各頁 port、PID、工具雜湊存於 `evidence/07/true-market-07-20260923-v4/identity.json`；原始資料在 `evidence/05/true-market-paired-20260923-v5/`。

| 指標 | before 三輪 | before 中位數 | after 三輪 | after 中位數 | 改善 | 40% |
|---|---|---:|---|---:|---:|---|
| 首個有效報價 | 8448.4 / 6901.8 / 6696.5 ms | 6901.8 ms | 4602.5 / 4419.4 / 4172.3 ms | 4419.4 ms | 35.97% | FAIL |
| 全部有效報價＋匯率 | 23170.2 / 20729.8 / 20586.1 ms | 20729.8 ms | 17566.1 / 16637.7 / 16309.6 ms | 16637.7 ms | 19.74% | FAIL |

`verify-holdings-true-market.mjs --run-id true-market-paired-20260923-v5 --after-source-id 6eee87e` 得到 `problems=[]`、`thresholdPass=false`、exit 1。這是有效但未達標的結果；三槽與 peak=3 測試期望維持原樣。

## 真行情 paired protocol：v3 快取污染，數值無效

當時順序為 `before-1 → after-1 → before-2 → after-2 → before-3 → after-3`；雖清除 hook 的 session cache，仍重用瀏覽器 origin。`/api/yahoo/chart` 與 `/api/finmind` 的 `stale-while-revalidate` 讓後續頁面從 HTTP 快取取回舊資料。Resource Timing 的 `transferSize=0`、約 2 ms 回應確認此問題；經 Vercel dev 的真請求至少約 1.8 秒。下表逐頁統計 `bodyMs - startMs < 1000` 的請求，均為 16 支中的數量：

| 頁面 | <1 秒請求數 | 判定 |
|---|---:|---|
| before-1 | 0/16 | 只有此頁可作真上游觀察 |
| after-1 | 0/16 | 只有此頁可作真上游觀察 |
| before-2 | 11/16 | 快取污染 |
| after-2 | 16/16 | 快取污染；全頁約 349 ms |
| before-3 | 10/16 | 快取污染 |
| after-3 | 7/16 | 快取污染 |

pair 2／3 不具有效 cold 條件，三組中位數與改善率不得用於 40% 門檻。下表僅保留舊工具輸出作稽核，**PASS／FAIL 標記全數無效**：

| 指標 | before 三輪 | before 中位數 | after 三輪 | after 中位數 | 改善 | 40% |
|---|---|---:|---|---:|---:|---|
| 首個有效報價 | 7129.8 / 3514.9 / 334.8 ms | 3514.9 ms | 4280.1 / 268.3 / 1209.6 ms | 1209.6 ms | 65.59% | 無效 |
| 全部有效報價+FX | 21565.1 / 6411.4 / 10510.4 ms | 10510.4 ms | 17436.9 / 349.3 / 10551.8 ms | 10551.8 ms | -0.39% | 無效 |

### v3 尾端來源（歷史診斷，不能用於門檻判定）

下表由 v3 raw 的每支 request `bodyMs - startMs` 直接計算；「慢」指單支超過 3000 ms。quote/FX 每輪共 11 支、name 共 5 支。

| 回合 | 全部有效報價+FX | 慢 quote/FX 支數 | 最慢 quote/FX | 慢 name 支數 | 最慢 name |
|---|---:|---:|---|---:|---:|
| before-1 | 21565.1 ms | 11 | AAPL 4413.0 ms | 0 | 2773.8 ms |
| before-2 | 6411.4 ms | 0 | 2317.TW 227.1 ms | 3 | 3328.0 ms |
| before-3 | 10510.4 ms | 6 | AAPL 7021.5 ms | 0 | 125.1 ms |
| after-1 | 17436.9 ms | 11 | 2317.TW 4744.3 ms | 0 | 2832.3 ms |
| after-2 | 349.3 ms | 0 | 2317.TW 234.2 ms | 0 | 41.8 ms |
| after-3 | 10551.8 ms | 4 | AMZN 5513.6 ms | 0 | 2574.8 ms |

v3 的 4～7 秒單支延遲可作 pair 1 觀察，pair 2／3 的快請求受瀏覽器快取污染，不再據此推論三組尾端原因或效能改善。三槽下仍可從有效 v5 觀察到真上游批次尾端等待；本票沒有證據支持安全縮短單支上游延遲。

原始資料：`evidence/05/true-market-paired-20260923-v3/before-pair-{1,2,3}.json`、`after-pair-{1,2,3}.json`。舊 `summary-v2.json` 僅修正門檻 exit code，未檢查瀏覽器快取，不能升格為有效正式判定。

## 真行情 paired protocol：v1 歷史失敗嘗試

正式計畫順序為 `before-1 → after-1 → before-2 → after-2 → before-3 → after-3`。before 使用 `444d6b1` 的隔離 hook/services runtime，after 使用目前工作樹；兩者原定共用既存 `http://127.0.0.1:3001` backend，且各頁先移除十檔與 FX 的 latest quote session cache。請求預算每輪 16、最多 96。

實際只執行 `before-1`。開始前曾觀察到 3001 listener，但量測時它已退出；Vite proxy log 明確記錄 11 次 `connect ECONNREFUSED 127.0.0.1:3001`，因此瀏覽器收到的 1 FX + 10 quote 全數為本機 proxy 500，未真正送達行情 backend，也未產生 FinMind name。十檔成功數 0，`allValidQuotesFxMs=null`，五個本體 localStorage 鍵仍逐值不變。依 PLAN 的 5xx／環境失敗停止規則，未啟動任何 after 或後續 pair，也沒有密集重試。raw 與身分：`evidence/05/true-market-paired-20260923-v1/before-1.json`、`identity.json`。因此這次資料只能證明 formal protocol 被本機 backend 不可用阻塞，不能計算 40% 改善率。

## 3 / 4 / 6 隔離實驗

因三槽正式資料已顯示明顯排隊，才執行 `tools/holdings-concurrency-experiment.mjs`。它是 deterministic discrete-event 模擬，固定每支網路工作 80 ms，沿用現有 queue 的「工作占槽到完成、台股 quote 成功後名稱再入同一 queue」關係；**不改產品 `holdingPriceQueue.ts` 的三槽常數**。

正常延遲：

| 批次 | 槽位 | request | peak | first quote | all quote+FX | 最大排隊 | names complete |
|---|---:|---:|---:|---:|---:|---:|---:|
| 10 | 3 | 16 | 3 | 80 ms | 320 ms | 240 ms | 480 ms |
| 10 | 4 | 16 | 4 | 80 ms | 240 ms | 160 ms | 320 ms |
| 10 | 6 | 16 | 6 | 80 ms | 160 ms | 80 ms | 240 ms |
| 30 | 3 | 46 | 3 | 80 ms | 880 ms | 800 ms | 1280 ms |
| 30 | 4 | 46 | 4 | 80 ms | 640 ms | 560 ms | 960 ms |
| 30 | 6 | 46 | 6 | 80 ms | 480 ms | 400 ms | 640 ms |

429 情境固定讓 `PERF03` quote 回 429；三個上限在 10/30 檔都各得到 1 個錯誤，request 總數仍為 16/46，settled 時間與各自正常情境的 quote/FX 尾端相同。error 情境固定讓 `777705.TW` quote 失敗；該台股不再產生 name request，因此三個上限一致為 15/45 requests、1 個錯誤。失敗情境的 `allValidQuotesFxMs` 刻意為 `null`，另存 `allPrimarySettledMs`，避免把失敗 settled 冒充全部有效報價。

完整 18 組結果：`evidence/05/concurrency-experiment-20260923-v1/results.json`。

## 方法修正與限制

原 probe 有兩個會製造假快數字的方法問題，本票已在 scratch 工具修正：force 呼叫後 queue 由 microtask 起跑，舊版 `ready()` 可能先看到上一輪有效 state + `activeHttp=0` 而以 0 request 提早結束；另外上一輪的有效 state 也可能讓 force 的 visible time 被記成接近 0 ms。現在 force 要等本輪完整預期 request 起跑，且 visible time 要綁本輪 body completion。warm 仍允許 0 request，因為那正是 cache hit 契約。

瀏覽器內 `setTimeout(35/45)` 曾受背景 timer 節流，因此正式固定 upstream 移到獨立 Node HTTP server；瀏覽器只記正式 hook 的 HTTP start / headers / body / UI visible。cold 包含模組與瀏覽器啟動效應，只保存原始值，不拿來替代五輪 force 中位數。

本票維持三槽，未對真行情施加 4／6 候選上限，也不以假 upstream 宣稱長期不會 429。FX 首批契約已由正式 hook regression 與 fixed raw 補齊；有效真行情 v5 雙 40% 均未通過，故本票保持 OPEN，07 不得宣稱全案 acceptance 全綠。
