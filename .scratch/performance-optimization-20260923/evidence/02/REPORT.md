# 02 — 同 handler 長駐本機 API 原型報告

日期：2026-09-24。執行：Claude Code（Opus 5.5）。正式證據（本輪執行）＝`b1-fixed-20260924-r3`、`c-fixed-20260924-r4`、`b1-real-20260924-r3`、`c-real-20260924-r4`、`parity-20260924-r5`、`reload-20260924-r5`，全部由本票提交的工具產生（各 run 的 `raw.json` 內工具雜湊與提交檔相同）。表中中位數、差額都取自判定摘要（判定器雜湊 `f2bc858cc29b`、對等比對工具 `5755827d9d0e`、重載驗證工具 `ef084aa20386`），沒有手算；01 的數字標「證據核對」。產品碼沒改（仍是 `30dfdb2` 產品內容），日常入口沒換。證據索引見 [README](README.md)。

## 1. 結論：實際瓶頸與下一步

**原型把 01 找到的兩個「每支請求都重做」的成本移出了暖請求的路徑：本機派送從約 1.9 秒降到約 0.02 秒；Yahoo 握手從「每支報價一次」變成「每個子程序每 10 分鐘一次」。** 59 個契約案例中 58 個與 B1 完全等價；1 個是長駐本身造成的已知差異（限流封鎖在同一窗內沿用），兩邊各自符合預期形狀。取消契約兩個入口都不符合（既有缺陷，§7），03 採用前必須先解決。

| 同日、同工具（ms） | B1：每請求新子程序 | 候選 C：長駐原型 | 備註 |
|---|---:|---:|---|
| 空 OPTIONS warm 中位（chart／finmind，各 n=20） | 1863.1／1870.5 | 17.5／17.3 | 目標：中位 ≤150、每筆 ≤500；C 最慢 20.2 |
| 固定 GET 本機成本中位（扣固定等待，n=10） | 1886.8 | 20.6 | 目標：≤200 且降低 ≥80%；實際降低 98.9% |
| 真行情單支報價 TTFB 中位（n=13） | 4240.4 | 309.5 | — |
| 　暖報價（沒付啟動、沒自己握手，n=12） | —（13 支全冷） | 309.2 | C 的穩態 |
| 　冷報價（付子程序啟動＋一次握手） | 每支都是 | 3887.4（只有第 1 支） | 每條路由啟動一次 |
| 真行情自己握手的報價／握手總等待 | 13/13／20817.8 | 1/13／1469.4 | 這批省 19348.4（跨請求加總，非牆鐘） |
| 真行情十檔＋FX 三槽批次：首價／全價 | 4241.1／16643.4 | 244.1／1243.5 | C 這批已暖（見 §3.3） |
| 真上游 outbound（cookie／crumb／chart／FinMind） | 13／13／13／1＝40 | 1／1／13／1＝16 | 最壞預算 79，上游錯誤 0 |

- **派送收益（固定上游）**：暖請求從父程序收件到轉進子程序只要 16.2 ms（B1 為 2311.9 ms，含 fork 與子程序載入模組圖）。同樣 140 支固定 GET，B1 用了 140 個子程序，C 只用 4 個（每次啟動 chart、finmind 各一）。
- **握手重用收益（真上游）**：單次握手本身沒變（C 1469.4 ms、B1 中位 1462.0 ms），省下的是次數：C 整批只握手 1 次、B1 13 次。chart 本身兩邊相同（280.1 vs 281.1 ms），是上游延遲。
- **對 01 正式基準**（證據核對）：固定 GET 本機成本 1836.1 → 20.6 ms、真單支 TTFB 4045.7 → 309.5 ms、十檔全價 16221.1 → 1243.5 ms；比較檔見 README。
- **仍要付的成本**：每條路由第一支請求要啟動子程序（固定上游 cold OPTIONS 2114.5／1943.1 ms），報價路由的第一支還要做一次握手（約 1.5 秒）；之後同路由請求都走暖路徑。本批真行情的 FinMind 只有 1 支，所以它就是冷請求（TTFB 2269.2 ms）。
- **PLAN 第 3 節**：空 OPTIONS 與固定 GET 兩項對候選 PASS（固定 GET 的樣本都是暖請求，冷路徑另列於 §3.1）；十檔冷庫存、K 線冷載入、暖回訪都是「正式 App 可見」口徑，本票沒量，仍 OPEN；正確性列的取消契約兩個入口都 FAIL（§7）。
- **下一步**：03 先修好取消契約，再把候選接成可維護的日常入口（開／停／重載／錯誤可控、Vite 代理接通），並以正式 App 量使用者可見時間。本票沒有換掉日常預設入口。

## 2. 原型怎麼做

位置：`tools/persistent-functions.cjs`（340 行，無新套件）。只在以 `NODE_OPTIONS=--require <原型>` 注入的 `vercel dev` 父程序（`vc.js dev` 主執行緒）生效；函式子程序、tsx loader worker 與其他 node 程序載入它也不作用。

- **接縫**：`vercel dev` 對每支函式請求呼叫 `@vercel/node` 的 `startDevServer()`；回傳值沒有 `persistent` 時，回應一結束就殺掉子程序。原型預先載入 builder，只換掉 `require` 快取裡的 `startDevServer`：同一路由、同一組設定／環境（指紋＝entrypoint、workPath、config、publicDir、`meta.env`、`meta.buildEnv`）只保留一個子程序，並回傳 Builder API 既有的 `persistent: true`。同時到的請求共用同一個啟動中的 promise。
- **TypeScript 載入**：沿用 `@vercel/node` 自己的 dev-server（全域 CLI 內的 tsx 4.21.0），也就是和 B1 同一條轉譯、路由、`req.query`／`res.status().json()` 等 helpers、header 轉送、錯誤頁與 `.env` 載入。沒有另寫 API server，01 列出的 vite-node、esbuild、Node 型別剝除三條路都不需要。因為業務 handler、guard 與 adapter 全是原碼，差異只剩「程序活多久」一個因素。
- **失效**：監看 `api/` 整棵，以及根目錄 `.env`、`.env.build`、`tsconfig.json`、`package.json`、`package-lock.json`、`vercel.json`、`.vercelignore`。任一檔的大小或修改時間變了（含新增、刪除），就停用全部子程序，新請求改走新子程序。只看大小／修改時間，是因為 Windows 讀檔更新「上次存取時間」也會觸發 fs.watch（C: 的 NTFS 本機設定 `DisableLastAccess=2`）；不過濾的話，首次載入檔案就會被誤判成改碼。
- **停用不切斷在途請求**：舊子程序在 5 秒寬限後，等轉進它的請求全部結束才送 shutdown（上限 310 秒，略大於 Vercel 函式最長 300 秒）。這是必要的：dev-server 收到 shutdown 後最多再等 30 秒就結束程序（`WAIT_UNTIL_TIMEOUT = 30`），超過約 35 秒的 AI 串流會被切斷。
- **安全關閉與範圍**：vercel dev 停止時會對記過的 PID 呼叫 treeKill；已結束的子程序直接略過，避免對 Windows 重用的 PID 下手。版本鎖：只接受 vercel 55.0.0／@vercel/node 5.8.23，不符就拒絕啟動。若有函式子程序沒經原型啟動，log 會記警告，量測工具即判 run 無效（各正式 run 皆 0）。候選只綁 `127.0.0.1`，不記錄任何環境變數值。

## 3. 效能：兩個收益分開報

### 3.1 派送收益：固定上游（`b1-fixed-20260924-r3` vs `c-fixed-20260924-r4`，ms，中位（min～max））

| 區段 | B1 | C |
|---|---:|---:|
| 空 OPTIONS warm：chart（n=20） | 1863.1（1841.6～1949.3） | 17.5（16.2～19.9） |
| 空 OPTIONS warm：finmind（n=20） | 1870.5（1837.5～1983.9） | 17.3（16.0～20.2） |
| 空 OPTIONS cold：chart／finmind（各 n=2） | 2038.3／1878.6 | 2114.5／1943.1 |
| 單支報價本機成本（TTFB 扣固定等待，n=10） | 1886.8（1865.6～1958.8） | 20.6（19.6～27.6） |
| 單支報價 client TTFB（直連，n=10） | 2066.5 | 76.3 |
| 單支報價經 Vite 代理（n=10）／代理一跳 | 2066.9／1.7 | 78.7／1.9 |
| 單支 FinMind TTFB／本機成本（n=10） | 1948.2／1892.7 | 77.6／21.0 |
| 十檔＋FX 批次：首價／全價（各 n=10） | 2526.0／9946.7 | 81.8／342.0 |
| 父程序收件→轉進子程序（全部 140 支） | 2311.9 | 16.2 |
| 子程序實例／請求；付啟動成本的請求 | 140／140；140 | 4／140；0 |
| 報價握手（cookie／crumb／chart） | 130／130／130 | 2／2／130 |

- 判定：C 的 `thresholdPass=true`（OPTIONS 兩路由中位與每筆上限、固定 GET 中位 ≤200、相對同日 B1 降低 0.989 ≥0.8）；B1 判紅（exit 1，與 01 相同）。
- 固定等待：每支 outbound 固定 50 ms，B1 單支報價要 cookie、crumb、chart 三支（150 ms），C 暖報價只有 chart（50 ms）；「本機成本」已扣除這段，兩邊可直接比。
- 探針開銷（traced−plain 的 warm 中位差，跨 start、只作量級參考）：B1 2.0／−2.7 ms，C 2.6／2.9 ms。
- **冷路徑另列**：C 的固定 GET 全部是暖請求（每個 start 先跑 OPTIONS 協定，子程序在 cold OPTIONS 時就啟動了），所以上面的 PASS 只證明暖路徑。冷路徑＝每條路由第一支請求要啟動子程序，成本和 B1 同量級：cold OPTIONS 2114.5／1943.1 ms（B1 2038.3／1878.6 ms）；報價路由的第一支還要握手，真行情冷樣本 3887.4 ms（§3.2）。之後同一路由的請求都走暖路徑，直到改碼、改 `.env` 或重開 vercel dev。
- acceptance 第 4 節「固定行情涵蓋 cold／warm／force」中的 force（App 強制重新整理、略過前端快取）屬 App 層快取語意；API 層沒有伺服器端快取，每支 GET 都照打上游，本票不適用，留給 App 量測票。

### 3.2 握手重用收益：真行情小批（`b1-real-20260924-r3` vs `c-real-20260924-r4`，同日接連執行，ms）

| 區段 | B1（13 支報價） | C（13 支報價） |
|---|---:|---:|
| client TTFB 中位（min～max） | 4240.4（3794.9～4542.1） | 309.5（223.8～3887.4） |
| 　暖報價（n=12）中位 | — | 309.2（223.8～403.3） |
| 派送：父程序收件→轉進子程序 | 2288.3 | 15.6（暖 15.5） |
| 　其中子程序模組圖載入 | 2166.3（每支） | 1900.8（只有第 1 支） |
| Yahoo cookie／crumb／cookie→crumb 完成 | 613.5／842.6／1462.0 | 613.3／855.5／1469.4（只 1 次） |
| Yahoo chart | 280.1 | 281.1 |
| 暖報價子程序服務時間 | — | 285.8（≈chart） |
| 自己握手的報價／握手總等待 | 13/13／20817.8 | 1/13／1469.4 |
| 十檔＋FX 三槽：首價／全價／peak | 4241.1／16643.4／3 | 244.1／1243.5／3 |
| FinMind（1 支，冷）TTFB／outbound | 2149.7／173.9 | 2269.2／212.8 |
| browser API／outbound／上游錯誤 | 14／40／0 | 14／16／0 |

- 14 支 browser API 全部 200，未觸發停止條件。C 的正常預算為 16（2 支握手＋13 支 chart＋1 支 FinMind），實際 16。
- 握手次數由 trace 逐支對帳：C 的 13 支報價都由同一個 chart 子程序實例服務，該實例只 cookie 1、crumb 1。

### 3.3 冷／暖與使用者可感知的範圍

- C 這批十檔＋FX 是暖的：批次前的方向確認（2330.TW、AAPL、FinMind）已經啟動 chart 子程序並完成握手。剛啟動的 vercel dev 第一次載入十檔時，第一波三支要共同等一次子程序啟動＋一次握手（本批冷樣本 3887.4 ms，與 B1 單支同量級），之後每波約 0.3 秒。本票沒有量這個「剛開機的冷批次」，也沒有量正式 App 可見時間；兩者都留給 03 接入後量。
- 不可控下限（真上游單次延遲，C 本批）：chart 中位 281.1、cookie 613.3、crumb 855.5 ms。C 暖報價的 TTFB 已接近 chart 本身。

## 4. 契約對等（`parity-20260924-r5`）

**方法**：同一份產品原始碼、同一份 `.env`、同一份固定上游控制檔；每個案例先打 B1、再打 C（兩邊都只綁 `127.0.0.1`）。比對狀態碼、正規化後的回應 header（去 `date`、`x-vercel-id` 只核格式、埠號換成代號）、body 雜湊、串流逐行內容、handler 實際收到的 header（guard 與限流的輸入；秘密類只記有無），以及非握手 outbound 的種類與狀態。握手次數是長駐的預期差異，另外對帳。不打真上游（固定上游＋網路層封鎖）、不啟動真 AI（假 CLI）。

**路由**：`/api/yahoo/chart`、`/api/yahoo/search`、`/api/finmind`、`/api/gemini`、`/api/gemini-stream`；另測不存在路由、`/api/_lib/*` 私有模組、`.ts` 副檔名與結尾斜線。

**request／response adapter 契約**（兩個入口都由同一份 vercel CLI 與 `@vercel/node` 5.8.23 原碼提供，原型沒有改動其中任何一項；右欄是對等比對怎麼驗）：

| 層 | 項目（來源） | 驗證方式 |
|---|---|---|
| vercel dev 入口 | 路由比對：`api/` 下檔案對應路由、`.ts` 副檔名與結尾斜線可達、`_lib` 等私有路徑 404 | 路由組 4 案例的狀態碼與 body |
| vercel dev 入口 | 轉送 header：`x-forwarded-host／proto／port／for`（http-proxy xfwd）、`x-real-ip`、`x-vercel-deployment-url`、`x-vercel-forwarded-for`、`x-vercel-id`、`connection: close` | handler 端 header 快照逐項比值（秘密類只比有無） |
| vercel dev 入口 | 回應 header：`cache-control`、`server: Vercel`、`x-vercel-id`、`x-vercel-cache` | 正規化後的回應 header 逐項比對 |
| dev-server helpers（`addHelpers`） | `req.query`：`URLSearchParams` 解析，重複參數成陣列 | 重複 symbol、URL 編碼 FX、小寫 symbol |
| dev-server helpers | `req.body`：有 content-type 時先讀完整個 body，JSON 解析失敗丟 400 `Invalid JSON`（handler 的 catch 把它分類成 502） | 錯 body、壞 JSON、5 MB body |
| dev-server helpers | `res.status()`、`res.json()`（未設 content-type 時補 `application/json; charset=utf-8`） | 所有 JSON 回應案例的狀態碼、content-type 與 body |
| dev-server helpers | `req.cookies`、`res.send()`、`res.redirect()` | handler 沒有使用，未設案例 |
| dev-server 串流 | handler 回應以 stream 轉出（逐段 flush） | SSE 逐段送達（首行明顯早於末行）與逐行內容 |
| dev-server 錯誤 | handler 模組載入失敗時子程序結束，請求回 500；執行期未捕捉例外回 500 與堆疊 | 語法錯誤步驟（§6）兩邊同為 500；執行期例外沒有案例（各 handler 以 try/catch 包住工作） |

| 組別（案例數） | 內容與兩邊相同的結果 |
|---|---|
| CORS／OPTIONS（4） | 允許與不允許的 Origin、FinMind、串流路由：皆 204 |
| 來源守門（4） | 允許的 Referer、無來源 200；不允許的 Origin／Referer 403 |
| 參數與方法（6） | 錯區間、缺 symbol、重複 symbol 400；URL 編碼 FX、小寫 symbol 200；POST chart 405 |
| 上游錯誤、重試上限、逾時（6） | 401 一次後重試成功 200；429 兩次 429；500 → 502；Not Found 404；無 cookie 兩次 → 502；chart 8.6 秒 → 502 |
| FinMind 與搜尋（6） | 成功 200；錯 dataset／錯日期 400；額度用盡 429；上游 500 → 502；搜尋 200 |
| 路由（4） | 不存在 404、`_lib` 404、`.ts` 副檔名 200、結尾斜線 200 |
| AI 非串流（6） | GET 405；錯 body 400；壞 JSON 502；假 CLI 200；CLI 回報錯誤 502；5 MB 提示詞 200 |
| AI 串流 SSE（7） | 逐段送達 200；片段後失敗 → 200＋error 行；未寫出就失敗 502；登入過期 500；無 result → 200＋error 行；啟動失敗 502；用戶端取消 |
| 併發與握手（7） | 三檔併發不串台；pending join、熱命中、TTL 過期、三支同時 401、遲到的 401、取消隔離：皆 200 |
| 共享密鑰（4，另一組程序環境） | 缺／錯密鑰 403、正確 200、OPTIONS 不需密鑰 204 |
| 限流（5，程序環境指向假 Upstash） | 放行 200；AI 路由兩個限流器合併一次 pipeline 200；Upstash 故障 fail-open 200；超限 429；封鎖後同窗再請求（已知差異） |

**結果**：59 案中 58 案完全等價，1 案為已知差異且兩邊各自符合預期形狀；0 個非預期差異，run 有效（problems 0）。判定摘要把已知差異案例計入 `equal`（59/59），另在 `knownDifferences` 列出。

- **唯一已知差異**（`rl-after-block`）：超限後同一個限流窗內再請求，B1 的新子程序會再問 Upstash（假 Upstash 此時有額度 → 200）；C 的長駐限流器沿用 `ephemeralCache` 的本機封鎖，直接 429、不打任何上游。依 `@upstash/ratelimit` v2.0.8 原始碼，超限時會把識別碼寫進 `ephemeralCache` 封鎖到該窗結束，同一程序的下一次呼叫不再問 Redis；所以任何跨請求存活的程序都會如此（正式部署的暖實例是依此推論，本票未量）。本機 `.env` 沒設 Upstash，日常不受影響。判定器對兩邊各自的預期形狀把關（實際觀察＝`blocked-locally`）。
- **握手對帳**（cookie／crumb／chart，B1 → C）：pending join 3/3/3 → 1/1/3；熱命中 1/1/1 → 0/0/1；TTL 過期 1/1/1 → 1/1/1；401 一次 2/2/2 → 1/1/2；429 兩次 2/2/2 → 1/1/2；三支同時 401 6/6/6 → 2/2/6（第一支換新世代，其餘沿用，整組只重握手一次）；遲到的 401 5/5/5 → 2/2/5（慢 1.5 秒才回的 401 沒有清掉別人已換好的新世代）；取消隔離 2/2/2 → 1/1/2。
- **串流即時送達**（首行／末行，ms）：B1 2349.8／3905.5（首行含子程序啟動），C 339.7／1893.5；兩邊都逐段送出。
- **取消**：用戶端讀到第一行就斷線，兩邊的假 provider 都跑完（`provider-completed`）；取消隔離案例中被取消的請求也都照樣打完 chart（殘留 1 vs 1）。兩邊行為相同（沒有退化），但都不符合 spec「取消後不殘留本次工作」，見 §7 第 1 點。

## 5. 跨請求共享狀態清單

長駐後會跨請求存活的狀態，以及各自的驗證方式：

| # | 狀態 | 位置 | 長駐後行為 | 驗證 | 風險與處置 |
|---|---|---|---|---|---|
| 1 | Yahoo 握手世代（cookie、crumb、取得時間、pending） | `api/_lib/yahoo.ts` 的 `crumbGeneration` | 每個路由子程序各一份（chart 與 search 分開，與正式部署每函式各自實例相同）；10 分鐘內重用、同時請求共用 pending | 對等：pending join、熱命中、TTL、401／429 重試上限、三支同時 401、遲到的 401、取消隔離；fixed／real 逐實例對帳 | 設計目的即重用；與既有單元測試一致 |
| 2 | 空密鑰只警告一次 | `api/_lib/config.ts` 的 `emptySecretWarned` | 每個子程序只警告一次（B1 每請求一次） | 程式閱讀 | 只影響 log |
| 3 | claude CLI 路徑探索快取 | `api/_lib/llm.ts` 的 `cachedClaudeCliPath` | 子程序存活期間沿用第一次找到的 CLI；啟動失敗時清掉重找 | 對等：啟動失敗 502 兩邊相同 | CLI 升級到新版本資料夾時，要等子程序重啟（改碼、改 `.env`、重開 vercel dev）才改用新版；舊版被移除時第一次呼叫失敗一次後重找。03 評估 |
| 4 | 限流器（Upstash client＋`ephemeralCache`） | `api/_lib/ratelimit.ts` | 本機未設 Upstash → 兩邊都是 null；若設定，同窗內沿用本機封鎖 | 對等限流組 5 案例（含已知差異） | 套件原始碼的設計行為，跨請求存活的程序都如此（正式部署暖實例為推論） |
| 5 | 環境變數快照 | 子程序的 `process.env` | 子程序啟動時定型 | 重載：`.env` 加入密鑰 → 兩邊都 403；還原 → 200 | 指紋含 `meta.env`，並監看 `.env`；變更即換新子程序 |
| 6 | 模組快取（handler 與 `_lib`） | Node 模組快取 | 子程序存活期間沿用 | 重載：改 `_lib` 訊息、語法錯誤、還原、刪／還原路由 | 監看 `api/**`；新請求不會拿到舊碼 |
| 7 | undici 連線池 | 子程序的全域 fetch | 對 Yahoo／FinMind 的 keep-alive 連線跨請求重用 | real run 的 chart 時間 | 只重用 TCP／TLS 連線；cookie 每次由請求帶入，不共用資料 |
| 8 | 每請求物件（req、res、cancelRef、AbortSignal.timeout） | handler 內 | 每請求各自建立 | 對等：併發不串台、取消隔離 | 無跨請求共用 |
| 9 | 程序層崩潰範圍 | 子程序 | 同路由的在途請求共用一個程序，未捕捉例外會連帶中斷同程序的其他在途請求（B1 每請求獨立程序） | 程式閱讀：各 handler 以 try/catch 包住工作 | 風險低；反過來，B1 的 vercel dev 在 API 語法錯誤後會整個崩潰，候選不會（§6） |

## 6. 重載與故障隔離（`reload-20260924-r5`，隔離 checkout `C:/pfv7`）

B1 每支請求都重新 fork，一定載入當下的檔案，所以當作「有沒有拿到新碼」的參照；候選每一步都必須與 B1 回應一致，並符合該步的預期條件（判定器從 raw 重算）。開始前核對隔離 checkout 的產品樹（追蹤中的產品檔含未提交修改逐檔對 30dfdb2、沒有未追蹤的函式檔或根目錄設定檔），結束還原後再核一次，兩次都乾淨。

| 步驟 | B1／C 狀態 | 預期條件 |
|---|---|---|
| 基準（chart、錯參數、搜尋） | 200／200、400／400、200／200 | — |
| 改 `_lib` 錯誤訊息 | 400／400 | 兩邊都拿到新訊息 |
| chart 語法錯誤 | 500／500 | 兩邊都不再回舊碼的成功結果 |
| 還原語法 | 200／200 | 兩邊恢復 |
| `.env` 加入共享密鑰 | 403／403 | 兩邊都因缺密鑰拒絕 |
| `.env` 還原 | 200／200 | 兩邊恢復放行 |
| 刪除搜尋路由 | 404／404 | 兩邊都找不到路由 |
| 還原路由 | 200／200 | 兩邊恢復 |
| 還原 `_lib` | 400／400 | 兩邊都回原文 |
| 串流進行中改碼 | 200／200 | 改碼發生在串流中；兩邊都完整跑完 |

- **串流進行中改碼**：兩邊同時開 25 段、每 2 秒一段的假串流（約 50 秒）；候選收到第 2 段後改 `api/_lib/yahoo.ts`。C 收完 25 段＋done（26 行、54.4 秒），內容與 B1 逐行相同。
- 失效紀錄：10 次失效＝10 次真實改檔（沒有讀檔造成的誤判），9 次停用關閉，10 次子程序啟動；停止後沒有殘留子程序；隔離 checkout 的產品檔逐位元組還原、測試用 `.env` 與 `.vercel` 連結已刪（刪除清單記在 raw）。
- **B1 崩潰**（既有行為）：chart 語法錯誤那步之後，B1 的 vercel dev 在收尾時對已結束的 PID 執行 `taskkill /pid 4124 /T /F` 失敗，整個 vercel dev 以 `An unexpected error occurred!` 結束。工具記錄後在新埠重起 B1 繼續；候選全程沒有崩潰（原型的安全關閉會略過已結束的子程序）。
- **轉紅紀錄**：新增「串流進行中改碼」這一步時，它先抓到原型兩個缺陷（`smoke-02b-reload`，候選串流在第 37 秒、25 段中的第 17 段被切斷）：vercel dev 轉送時 `host` 帶埠號（`127.0.0.1:<port>`），原型沒把串流算成在途請求；以及 NTFS 讀檔觸發 fs.watch，首次載入就被誤判成改碼。修正後同一協定轉綠（`smoke-02c-reload`、`smoke-02d-reload` 與正式 r5），兩項也加入自測。

## 7. 發現與仍 OPEN

1. **取消契約兩個入口都 FAIL（既有缺陷，阻擋 03 採用）**：spec 的長駐候選相容性契約要求「取消後不殘留本次工作」，PLAN 第 3 節也把取消契約列為硬門檻。實測用戶端讀到第一行就斷線後，trace 顯示斷線有傳到 vercel dev 入口（`parent.aborted`）與子程序裡 dev-server 的代理層（`child.aborted`，devProxy 層），但 handler 層的回應照常送完（`child.finish`），假 CLI 跑完全部 5 段；B1 與 C 完全相同。原始碼位置：`@vercel/node` 5.8.23 的 `dev-server.mjs` 用 `undiciRequest(url, { body, headers, method })` 把請求轉給 handler 伺服器，沒有傳 abort signal，所以 handler 的 `req` 永遠收不到 `close`，`cancelRef.cancel()` 不會觸發；真 CLI 會一直跑到完成、耗用訂閱額度。長駐原型只作用在父程序，沒有讓它更好或更壞。03 採用候選前必須先讓日常入口的取消能傳到 provider（例如在函式子程序補上斷線轉送），並以對等案例證明兩者不再殘留工作；做不到就不能採用。
2. **B1 在 API 語法錯誤後整個崩潰**（§6）：日常使用中改壞一次檔案就要重開 vercel dev；候選不會。
3. **綁定位址**：日常 B1 綁全部介面，handler 看到的來源 IP 是 `::ffff:127.0.0.1`；候選只綁 `127.0.0.1`，看到 `127.0.0.1`。只影響 `x-forwarded-for` 字串（限流識別鍵）；本機沒設 Upstash。Vite 代理目前連 `http://localhost:3001`，03 若只綁 `127.0.0.1` 須先驗 localhost 的解析。
4. **冷成本仍在**：每條路由第一支請求約 2 秒啟動（cold OPTIONS 2114.5／1943.1 ms）、報價路由第一次握手約 1.5 秒；剛開機的第一批十檔仍要付一次。03 可評估啟動後預熱。
5. **壞 JSON body 回 502**（兩邊相同，既有產品行為）：`/api/gemini` 收到無法解析的 JSON 時回 502，而不是 400。不在本票範圍，只記錄。
6. **PLAN 第 3 節仍 OPEN 的項目**：十檔冷庫存、K 線冷載入、暖回訪都要正式 App 可見量測，本票沒有候選日常入口可量；正確性列的取消契約見第 1 點（兩入口 FAIL）。E0 仍不可量；舊 v5 FAIL 與舊 01～03 的 OPEN 原樣保留。

## 8. 重跑命令與工具驗證

```powershell
# 固定上游（四次獨立啟動、不打真上游）：先量同日 B1，再量候選並以該 B1 為基準；候選 exit 0＝達標
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --entry b1 --ticket 02 --mode fixed --port-base <連續 6 個未占用埠>
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --entry c --mode fixed --port-base <連續 6 個未占用埠> --baseline-run <上一行的 run-id>
# 預算內真行情小批（各 14 支 browser API）；exit 0＝有效
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --entry b1 --ticket 02 --mode real --port-base <未占用埠>
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --entry c --mode real --port-base <未占用埠>
# 契約對等（連續 6 埠）與重載驗證（隔離 checkout，連續 12 埠）；exit 0＝等價
node .scratch/performance-optimization-20260923/tools/c-parity.mjs --run-id <新代號> --port-base <埠>
node .scratch/performance-optimization-20260923/tools/c-reload.mjs --run-id <新代號> --port-base <埠> --workdir C:/pfv7
# 重播（只讀 raw，不發請求）
node .scratch/performance-optimization-20260923/tools/verify-b1-breakdown.mjs --run-id c-fixed-20260924-r4
node .scratch/performance-optimization-20260923/tools/c-parity.mjs --verify parity-20260924-r5
node .scratch/performance-optimization-20260923/tools/c-reload.mjs --verify reload-20260924-r5
node .scratch/performance-optimization-20260923/tools/verify-b1-breakdown.mjs --candidate-fixed c-fixed-20260924-r4 --candidate-real c-real-20260924-r4 --baseline-fixed b1-fixed-20260924-r3 --baseline-real b1-real-20260924-r3
# 工具自測
node .scratch/performance-optimization-20260923/tools/self-test.mjs
node .scratch/performance-optimization-20260923/tools/self-test-02.mjs
```

- exit code：0＝有效且達標（真行情、對等、重載的 0 代表有效且一致）、1＝有效但未達標或有差異、2＝run 無效。各工具拒絕重用 run-id、占用中的埠與非本 run 的 listener；看到 vercel CLI 要求登入就中止（不代為登入）；raw 與既有摘要都不覆寫。
- 自測：01 的 46 項照舊全過；02 新增 95 項，涵蓋長駐池（重用、同時啟動只啟一次、環境變更換新、失效停用、啟動中被停用、子程序結束重啟、已結束不 treeKill、啟動失敗與回 null 不快取、在途請求等到結束才關、等待上限）、轉送目標 `host:port` 寫法、讀檔不算變更、log 標記解析、探針純函式、假 Upstash、假 CLI 五種出口、秘密掃描、身分前後核對、原型報告檢查、入口設定、探針環境與控制檔、判定器長駐模式，以及對等比對與重載驗證的判差能力（含已知差異的三種判讀、重載步驟表的預期條件）。兩支自測全部通過時會清掉自己的暫存目錄。
- 回復：本票只新增／修改 `.scratch/performance-optimization-20260923/` 下的檔案；`git revert` 本票提交即可，不影響產品與日常入口。

## 9. 給 03 的起點

1. **取消契約（採用前必修）**：dev-server 轉給 handler 時沒帶 abort signal（§7 第 1 點），用戶端取消傳不到 provider；日常入口必須先補上斷線轉送（修正要落在函式子程序那一側，原型只作用在父程序），用對等的取消案例先轉紅再轉綠，證明不再殘留工作，才可採用。
2. **日常入口形狀**：要讓 `NODE_OPTIONS` 只作用在 vercel dev 那一個程序（例如以小啟動器 spawn `vc.js dev` 並只在子程序環境加 `--require`），不要讓同一個 shell 的其他 node 程序都帶著它；啟停只作用於自己 spawn 的 PID。
3. **連線**：Vite 代理目前連 `http://localhost:3001`；候選只綁 `127.0.0.1`，要先驗連線（含 IPv6 優先解析）與 `x-forwarded-for` 形狀。
4. **退路**：原型有版本鎖，vercel CLI 更新後會拒絕啟用；日常入口要能退回一般 vercel dev，並把原因顯示給使用者。
5. **冷成本**：評估啟動後預熱各路由（例如送空 OPTIONS），讓第一批十檔不必等子程序啟動；握手只能在第一次真報價時做。
6. **正式 App 量測**：十檔冷庫存、K 線冷載入、暖回訪以正式 App 可見口徑、B1／C 交錯配對量；本票 API 層數字只作方向。
