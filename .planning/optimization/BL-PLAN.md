# Backlog 計畫：冷載入收尾（BL-1～BL-4）（2026-07-13 定案）

**承接**：`PLAN.md`「驗收後待修清單」四項採納項的完整執行規格。Phase A～D 已全數完成並通過 Sonnet 驗收，本計畫為全案最後一哩。
**分工（延續本案特例）**：Fable 5 規劃＋執行，Sonnet 驗收；不走 Codex。
**執行方式**：每個工作包走 `/gsd:quick`（原子 commit＋SUMMARY），包完成即 `npx tsc --noEmit`；改碼包全部完成後由 Sonnet subagent 依本檔驗收標準覆核。
**衝突警告**：BL-1/BL-2 都動 `services/yahoo.ts` 資料管線，**不要與其他改碼視窗同時執行**；依本檔順序序列執行。
**worktree 提醒**：殘留 agent worktree 會汙染 repo 工具鏈（LESSONS 2026-07-13）；每包收尾依手動三步合併流程清理，不走 cleanup-wave。

## 目標與現況

殘留瓶頸（2026-07-13 影片，localhost:3000 vercel dev）：

- 首次載入個股 **6-8 秒**、首次切換週期 **9-12 秒**——全部發生在**冷抓**路徑。
- 快取命中的切回已秒開（Phase B 成果），本計畫只處理「第一次抓取」。

已知成本組成（Phase B 沙盒實測）：chart 網路往返 ~4.1s ＋ FinMind 籌碼三件套 ~3.4s **串行** ≈ 7.5s。

兩支主槓桿＋一支量尺：

1. 籌碼與 chart 同時起跑（BL-2）——省下串行的 2-3 秒。
2. 首繪 payload 從 10 年縮到 2 年、背景補全（BL-1）——砍掉 chart 往返的大頭。
3. 影片數字含 vercel dev 本機開銷（per-endpoint 首次 esbuild 編譯、較慢代理、無 CDN——`s-maxage` 只在 prod 生效），**最終驗收以 Vercel 部署環境為準**（BL-4）。

## 執行順序

| 包 | 內容 | 改碼 | 狀態 |
|---|---|---|---|
| BL-4a | Production 冷載入基線**前測**（不改碼） | ✗ | ☐ |
| BL-2 | 台股 1d 籌碼三件套與 chart 並行起跑 | `services/finmind.ts`、`services/yahoo.ts` | ☐ |
| BL-1 | 1d 兩段式載入（2y 快繪 → 背景補全 10y） | `services/yahoo.ts`、`components/StockChart.tsx`、（近零）`App.tsx` | ☐ |
| BL-3 | 1mo range 收斂（max→15y）＋載入骨架屏 | `services/yahoo.ts`、`App.tsx` | ☐ |
| BL-4b | Production **後測**驗收（不改碼） | ✗ | ☐ |

順序理由：BL-4a 先把 before 基線釘死，之後每包的效益都有對照組。BL-2 diff 小、獨立可出貨，且是 BL-1 首繪速度的**地基**——兩段式的 stage-1 首繪要等籌碼一起上屏，籌碼不先並行，2y 快繪就被 3.4s 的籌碼扣住，BL-1 效益出不來。BL-3 的骨架屏放在 BL-1 之後，才能量到真實的殘餘等待長度。

---

## BL-4a：Production 基線前測（不改碼）

1. 確認 main 最新（含 Phase D 全部 commit）已部署 Vercel production；未部署先部署再量。
2. 量測情境（每項 **3 次取中位數**；Chrome DevTools Network＋Performance；無痕視窗＋Disable cache 模擬冷客戶端）：
   - 冷載入 6488（上櫃）1d：從搜尋選定到 K 線首繪完成。
   - 同 session 首次切 1wk、首次切 1mo。
   - 冷載入 2330（上市）1d、AAPL（美股）1d。
   - 每筆記錄 `/api/yahoo/chart` 與 `/api/finmind` 各請求的 timing 瀑布與 `x-vercel-cache` header（MISS/HIT/STALE）。
3. CDN 兩態分開記：部署後首打（CDN 冷）vs 第二個無痕視窗 60 秒內重打同標的（CDN 熱，驗 `s-maxage` 是否如 Phase B 設計生效）。
4. 產出：SUMMARY 內 before 對照表。**不改碼、不 commit 程式**。

## BL-2：台股 1d 籌碼三件套與 chart 並行起跑

### 現況事實（2026-07-13 核實）

- `getStockData` 外殼在 chart 之前就完成 `.TW`/`.TWO` 名錄預解析（`services/yahoo.ts:889-895`）→ 進入 `fetchStockDataUncached` 時 symbol 已帶後綴＝**台股身分在 chart 起跑前已確立**。
- 但籌碼三件套（中文名 `fetchFinMindStockInfo`＋法人 `fetchInstitutionalData`＋量能 `fetchFinMindPriceVolume`）在步驟 3（`yahoo.ts:635-652`）才起跑——被 chart 的 ~4.1s 白白扣住。
- `fetchFinMindRows`（`services/finmind.ts:26-46`）目前不接 `AbortSignal`；三支籌碼函式內部 try/catch 吞錯回 null/[]、永不 reject。

### 改法

1. `fetchFinMindRows` 加選配 `signal?: AbortSignal` 透傳給 `fetch`；三支籌碼抓取函式（`yahoo.ts:193-236` 一帶）同樣加選配 signal 透傳。內部 catch 行為不變（AbortError 一樣被吞成 null/[]，由外殼守衛把關——見風險 1）。`getTwFundamentals` 等既有呼叫端零改動（參數選配、向後相容）。
2. `fetchStockDataUncached` 開頭（`fetchRawData` 之前）：若 `interval === '1d' && /\.TWO?$/i.test(symbol)`，以同一 cleanId＋同一 5 年 start_date **投機起跑**三件套（皆掛呼叫端 signal），存成 promise 變數；條件不符則為 null。
3. 步驟 3 改為：有投機 promise 就 await 它們；沒有（裸代碼未預解析成功、或名錄失敗）才照舊當場起跑。**fallback 路徑（`usedFallback=true`）投機結果仍有效**——cleanId 相同、該路徑本來就是台股，直接沿用，不重抓。
4. abort 語意升級：三件套掛 signal 後，使用者冷抓中切換標的，投機請求一併中止。Phase B H-1 的保證從「取消不再**觸發**FinMind 請求」升級為「取消會**中止已起跑**的 FinMind 請求」——投機不產生白打流量。

### 風險與守衛

1. 投機請求被 abort → catch 吞成 null/[] → `chipDataUnavailable: true` 的降級結果照常組完——外殼既有的寫快取前 abort 守衛（`yahoo.ts:926`）保證降級結果**不落快取**（planner_rulings #4 不變）。驗收必測。
2. 三件套只在「本來就會抓」的條件（台股 1d）下投機，**非新增流量**，唯一差異是提早 ~4 秒起跑；不影響 FinMind 限流總量。
3. 60m/15m/1wk/1mo／美股：條件不符、不投機，路徑零改動。

### 驗收

- 冷抓台股 1d：Network waterfall 中三支 `/api/finmind` 與 `/api/yahoo/chart` 同時起跑（首字節相差 <100ms）；vercel dev 下總時間較 BL-4a 同情境下降 ≥2 秒（prod 數字留 BL-4b）。
- 冷抓中快速切標的：被切走標的的 finmind 請求在 Network 顯示 canceled；新標的資料正確；sessionStorage 無被切走標的的殘留條目（比照 Phase B e2e #6 手法）。
- 美股／台股週月線／名錄未命中路徑行為不變；`chipDataUnavailable` 語意不變（法人 null 才 true）。
- `npx tsc --noEmit`。

## BL-1：1d 兩段式載入（2y 快繪 → 背景補全 10y）

### 現況事實

- 1d 抓 `range=10y`（`yahoo.ts:482`）——全 App 最重 payload，冷抓等待的大頭。
- SWR 外殼已有現成管線可搭：`onRevalidated` 回呼（`yahoo.ts:862-878`；`App.tsx:136-140` 已有 reqId 守衛＋「不清 analysis」語意）、`inflightRevalidate` 去重 map。
- `StockChart` 以 `data.length` 為 dep 重置視窗（`components/StockChart.tsx:586-590`）；資料變更時安全拆除拖曳 session（Phase B 覆核 (d) 證實）。
- 指標 warm-up 數學：2 年日線 ~490 根遠超 MA60/MACD(10,20,10)/KD(5,3) 的需求；EMA 種子差異在最近端衰減至 (1-2/21)^490 ≈ 0，**首繪視窗的指標值與 10y 版本視覺不可分**。真正要防的是「交換時視窗跳動／閃爍」，不是指標數值。

### 核心設計決策

**兩段式做在 `fetchStockDataUncached` 內部，不是把整條管線呼叫兩次**——否則籌碼三件套會被重抓一遍（FinMind 429 是常態，流量翻倍不可接受）。一次籌碼、兩次 chart。

### 改法

1. `fetchStockDataUncached` 加選配 `onPartial?: (r: {info, data}) => void`：`interval==='1d'` 且走 Yahoo 成功路徑時，**t=0 同時發** `range=2y` 與 `range=10y` 兩個 chart 請求（皆掛 signal）。2y 先到 → 跑完整 enrich（含等籌碼 Promise.all——BL-2 已讓籌碼同時起跑，此時多半已到）→ 發射 `onPartial`；10y 到 → 用**同一批** chipMap/volumeMap/ohlcMap 重跑 enrich（含殭屍棒過濾、synthetic 覆寫，邏輯抽成可重用函式）→ resolve 完整結果。10y 比 2y 先到（CDN 熱）→ 跳過 partial 直接 resolve。2y 失敗不致命（靜默等 10y）；10y 失敗且 partial 已發射 → reject 帶標記的錯誤，讓外殼知道「畫面已有 2y、只是補全失敗」。
2. `getStockData` 外殼 miss 路徑改寫：
   - miss 時先查 `inflightRevalidate`——同 key 已有補全在飛就直接 await 共用（防「partial 上屏後切走再切回」觸發重複兩段式）。
   - 傳入 onPartial；partial 到 → 立即 resolve 給呼叫端（**不寫快取**）；full 到 → `writeQuoteCacheResult`＋`opts.onRevalidated(full)`——App.tsx 既有 reqId 守衛與語意直接沿用，App 端零或近零改動。
   - full 失敗 → console.warn、不寫快取（下次進場自然重試），使用者停留在 2y 視圖，無錯誤 UI。
   - 補全 promise 註冊進 `inflightRevalidate`（同 key 的 forceRefresh 路徑 :913-919 自動共享）。
   - abort 守衛不變：aborted 不寫快取、不發 onRevalidated。
   - **forceRefresh 走單段 10y**：「更新報價」時畫面已有完整資料，partial 會把 10y 換成 2y 是退化。
   - SWR 背景刷新（`revalidateInBackground`）維持單段 10y——背景路徑使用者看不到，兩段式只給 miss 的阻塞路徑。
3. `StockChart` 視窗重置條件修正：`:586-590` 的 dep 由 `data.length` 改為「標的|週期」identity（以 prop 傳入，如 `info.symbol`＋interval）。rightOffset 語意是「距右緣偏移」，10y 只在**左端**加歷史棒、右端兩序列相同 → 改 dep 後補全交換**天然零跳動**。附帶修好既有小毛病：SWR revalidate 多一根新棒也不再重置使用者的縮放/平移。
4. 拖曳中收到補全：沿用既有「資料變更安全拆 session」行為（冷載入頭幾秒內就拖曳、機率低；右錨定讓落點誤差最小）——記為接受的行為 delta，不另做 defer。

### 邊界

- FinMind fallback 路徑（Yahoo 全掛）維持單段（FinMind 一次回全部，無 range 概念）。
- 60m/15m/1wk/1mo 不做兩段（payload 小或由 BL-3 收斂）。
- 籌碼 5y 視窗 vs 2y 首繪：chipMap 以日期 join，10y 補全後 5y 內照常有籌碼、5y 前為 0——與今日行為完全一致。
- 使用者在 partial 階段就按 AI 分析：entryFilter 只用近端資料，2y 綽綽有餘；可接受，不擋。

### 驗收

- 冷抓台股 1d 到首繪 ≤5 秒（vercel dev；prod 由 BL-4b 覆驗）；首繪即含完整籌碼副圖與指標，非陽春圖。
- 補全交換：肉眼無閃爍、無視窗跳動；交換前後抽最近端 3 根比對 MA20/MA60/MACD/KD 值一致（允許 <0.01% 浮點差）；交換後可向左平移看到 10 年歷史。
- 交換前已縮放/平移 → 視窗保持不重置；交換時正在拖曳 → session 安全拆除、無崩潰無錯位。
- 10y 補全失敗（DevTools block 第二個 chart 請求模擬）：停留 2y 視圖、console.warn、無錯誤 UI、不寫快取；重新進場重試成功。
- 快取只寫 full：sessionStorage 該 key 的 data 長度為 10y 量級（~2400 根），絕無 2y 部分資料。
- 冷抓中切標的：兩個 chart 請求皆 canceled、快取無中毒。
- 回歸：連點 5 檔無資料錯置；週期切回 <300ms；`npx tsc --noEmit`。

## BL-3：1mo range 收斂＋首次切換骨架屏

### 現況事實

- 1mo 抓 `range=max`（`yahoo.ts:481`）：2330（1994 上市）~380 根月棒、AAPL（1980）~550 根——絕大多數在預設視窗（100 根）之外。
- 載入 UI：`App.tsx:447-450`——`loading` 時整圖 `backdrop-blur` 蓋舊圖＋Loader2 轉圈。首次切週期時蓋著的是**舊週期**的圖，誤導感最重。

### 改法

1. `1mo` 的 `mainRange` 由 `'max'` 改 `'15y'`（~180 根月棒）。指標安全邊際：月線 MA60 warm-up 後仍有 120 根有效值；MACD(10,20,10) 約 30-45 根後穩定；EMA 種子差異在最近端 ≈ (1-2/21)^160 ≈ 0。`1wk` 維持 5y 不動。
2. 載入覆蓋層改**骨架屏**：保留圖表容器既有尺寸，blur 舊圖改為 K 線骨架 shimmer＋「載入 K 線中…」字樣（dark 主題配色沿用 slate 系）。硬要求：容器高度不跳動、無白屏；視覺細節留實作包裁量。
3. **明確不做**：週/月線兩段式載入——range 收斂＋BL-2 並行後預期單段已夠快；若 BL-4b 後測顯示首次切換仍 >5s，再另立條目，不在本包加碼。

### 驗收

- 1mo response payload 較 max 明顯下降（Network 比對 2330/AAPL 改前後 size）；月線最左可平移至 ~15 年前；最近端 3 根 MA60/MACD 值與改前一致（<0.01%）。
- 切週期時骨架屏出現、無白屏、容器不跳高；快取命中的切回**不出現**骨架屏（loading 不觸發，既有行為）。
- `npx tsc --noEmit`；三分頁視覺 smoke。

## BL-4b：Production 後測驗收（不改碼）

1. 部署含 BL-1/2/3 的 main 至 production。
2. 重跑 BL-4a 完全相同的情境組（同標的、N=3 中位數、CDN 冷/熱兩態）。
3. 硬指標（prod、桌面寬頻）：
   - 冷載入台股 1d（上市＋上櫃各一）首繪 **≤5 秒**——Phase B 原始驗收目標在其正確環境的最終判定。
   - 首次切 1wk / 1mo **≤5 秒**。
   - 快取命中切回 **<300ms**（回歸確認）。
4. before（BL-4a）/after 對照表寫進 SUMMARY；未達標項**開新 backlog 條目收場，不無限加碼**。
5. Sonnet subagent 覆核本檔全部章節，出具總結報告。

---

## 全案共同驗收（沿用 PLAN.md）

每包：`npx tsc --noEmit` → 原子 commit。改碼包全部落地後：`npm run build`＋`grep -r "AIza" dist/` 無結果＋preview（3001 單埠）實跑各包驗收項＋`npm run test` 32 案例維持全綠＋Sonnet subagent 覆核本檔。
