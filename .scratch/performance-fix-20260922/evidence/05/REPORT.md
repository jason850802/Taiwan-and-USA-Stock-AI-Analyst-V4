# 05 — 三槽重新量測與併發實驗

日期：2026-09-23  
HEAD：`e9fa1a200255d860e3166fad0e2636b49178b894`  
Node：`v26.4.0`

## 結論

**固定行情仍支持「維持三槽」，但本票尚不可結案：真行情三組同期 paired 已完成，首價 40% 門檻通過，全部有效報價+FX 的 40% 門檻失敗。**

正式 `useHoldingPrices` 的 FX enqueue 次序已修正：有美股時先把 `exchange-rate` 放入同一 queue，再放入各 quote；FX 數值、失敗沿用、快取與金融計算皆未改。修正後固定 upstream 的 10／30 檔各五個 force 回合都 `pass=true`，HTTP peak 全為 **3**，FX start rank 十輪全為 **1**。30 檔 quote/FX 最大排隊中位數為 **964.8 ms**、全部有效 quote+FX **1059.3 ms**、第一個有效報價 **103.6 ms**；仍可見三槽造成的尾端排隊。

隔離的 deterministic 3/4/6 實驗仍顯示，提高上限可縮短尾端，但會把 HTTP peak 由 3 提高到 4 或 6，因此目前保留三槽。先前引用的歷史診斷單輪 `16.67 / 42.02 s` 與 04 後單輪 `3.057 / 11.962 s` 只能作歷史方向觀察；正式判定改用 fresh v3 三組 interleaved before/after。六輪都 16/16 成功、HTTP peak=3、無 page error，但批次中位數為：首個有效報價 `3514.9 → 1209.6 ms`（改善 **65.59%**，PASS），全部有效報價+FX `10510.4 → 10551.8 ms`（改善 **-0.39%**，FAIL）。所以真行情雙 40% 門檻目前為 **未通過**，不是「未量」。

v3 raw 的結構與請求完整性可作負向效能證據，但本輪沒有 contemporaneous `identity.json` 綁定實際 serve PID/command/source manifest/tool hashes；v1 identity 記的是不同 origins 與較早工具版本，不能回填 v3。因此 v3 即使數字通過也不能事後宣稱完整 formal provenance。這個 provenance gap 不影響目前 all+FX 已明確失敗的結論。

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

## 真行情 paired protocol：v3 完整六輪

正式順序為 `before-1 → after-1 → before-2 → after-2 → before-3 → after-3`；before 使用 `444d6b1` 隔離來源，after 使用當時 working tree，兩者各自 cold 清除十檔與 FX 的 latest quote session cache，且每輪實際觀察到 10 quote + 1 FX + 5 name = 16 requests。六輪皆 `pass=true`、10/10 有效報價、5/5 名稱、HTTP 200、`httpPeak=3`、`pageErrors=[]`、`coreUnchanged=true`。

| 指標 | before 三輪 | before 中位數 | after 三輪 | after 中位數 | 改善 | 40% |
|---|---|---:|---|---:|---:|---|
| 首個有效報價 | 7129.8 / 3514.9 / 334.8 ms | 3514.9 ms | 4280.1 / 268.3 / 1209.6 ms | 1209.6 ms | 65.59% | PASS |
| 全部有效報價+FX | 21565.1 / 6411.4 / 10510.4 ms | 10510.4 ms | 17436.9 / 349.3 / 10551.8 ms | 10551.8 ms | -0.39% | FAIL |

### 尾端來源（2026-09-23 接手後由程式重算，不改判定）

下表由 v3 raw 的每支 request `bodyMs - startMs` 直接計算；「慢」指單支超過 3000 ms。quote/FX 每輪共 11 支、name 共 5 支。

| 回合 | 全部有效報價+FX | 慢 quote/FX 支數 | 最慢 quote/FX | 慢 name 支數 | 最慢 name |
|---|---:|---:|---|---:|---:|
| before-1 | 21565.1 ms | 11 | AAPL 4413.0 ms | 0 | 2773.8 ms |
| before-2 | 6411.4 ms | 0 | 2317.TW 227.1 ms | 3 | 3328.0 ms |
| before-3 | 10510.4 ms | 6 | AAPL 7021.5 ms | 0 | 125.1 ms |
| after-1 | 17436.9 ms | 11 | 2317.TW 4744.3 ms | 0 | 2832.3 ms |
| after-2 | 349.3 ms | 0 | 2317.TW 234.2 ms | 0 | 41.8 ms |
| after-3 | 10551.8 ms | 4 | AMZN 5513.6 ms | 0 | 2574.8 ms |

六輪中四輪的尾端由 quote/FX 上游單支 4～7 秒的延遲在三槽中排隊累積而成，名稱等待不是瓶頸；只有 before-2 呈現「價格快、名稱慢」的形狀，而同組 after-2 的全部完成為 349.3 ms。三組配對落在不同的上游延遲狀態，中位數取到兩邊都受慢 quote 主導的 pair 3，因此 all quote+FX 未改善。這是對失敗原因的觀察，不作為改判或重跑湊數的依據；在不提高 HTTP 上限的前提下，本票沒有可安全縮短上游單支延遲的產品手段。

原始資料：`evidence/05/true-market-paired-20260923-v3/before-pair-{1,2,3}.json`、`after-pair-{1,2,3}.json`。初版 verifier 曾因 `pass` 只看 raw 結構而在 `thresholdPass=false` 時錯誤 exit 0；已窄修為 `pass = raw contract && thresholdPass`，並新增 sourceId / HTTP peak 檢查。為避免覆寫舊摘要，修正版輸出為 `summary-v2.json`，對 v3 正確 `pass=false` / exit 1。

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

本票目前的產品決策仍是維持三槽，因此沒有對真行情施加 4／6 候選上限，也不以假 upstream 宣稱長期不會 429。FX 首批契約已由正式 hook regression 與 fixed raw 補齊；真行情 v3 已完成，但 all quote+FX 中位數未達 40% 改善，且 v3 缺 contemporaneous serve/PID/source identity manifest，所以本票保持 OPEN。若未另行授權改變 queue 上限或其他產品契約，07 只能把這個門檻列為未通過限制，不能宣稱全案 acceptance 全綠。
