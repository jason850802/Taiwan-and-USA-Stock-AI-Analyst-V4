# 01 — B1 日常入口等待分解報告

日期：2026-09-23。執行：Claude Code（Opus 5.5）。正式證據＝`b1-fixed-20260923-r3`、`b1-real-20260923-r2`（本輪執行），皆由本票提交的工具產生（raw 內工具雜湊與提交檔相同）。除第 6 節的預算計數式外，所有中位數、占比與差額都取自判定器摘要（`verify-b1-breakdown.mjs` 內容雜湊 `01e3a84ba203`），沒有手算。證據索引見 [README](README.md)。

## 1. 結論：實際瓶頸與下一步

**單支報價約 4 秒，幾乎全部花在兩件「每支請求都重做」的事；上游 chart 本身只占約 0.3 秒。**

| 真行情單支報價（13 支中位數，ms；本輪執行） | 值 | 性質 |
|---|---:|---|
| client TTFB（總等待） | 4045.7 | — |
| 本機派送：父程序收件→代理進子程序（fork 前＋fork→子程序就緒＋就緒→代理） | 2224.5 | 可控，每請求重付 |
| 　其中子程序「探針→dev-server 開始 listen」（模組圖載入） | 2106.4 | 派送主體 |
| Yahoo cookie 起到 crumb 結束（13/13 各自握手） | 1511.9 | 可重用卻每次重做 |
| Yahoo chart | 292.3 | 上游延遲，近不可控下限 |
| handler 其他（guard、驗參、編碼）與未歸屬 | 個位數 | 可忽略 |

- **派送**：固定上游（每支 outbound 固定等 50 ms）下，扣掉固定等待的本機成本中位 **1836.1 ms**——完全不碰網路也要付。以它為分子，占真單支 TTFB 的 45.4%（`dispatchShare=0.454`，保守值）；以真上游三槽並行下實測的派送 2224.5 ms 為分子則是 55.0%（`realDispatchShare=0.55`）。
- **握手**：13 支真報價 **13 支都自己做 cookie＋crumb**，中位 1511.9 ms（37.4%，`handshakeShare=0.374`）。trace 證實 vercel dev 每支請求 fork 一個新子程序（13 支＝13 個子程序實例），`api/_lib/yahoo.ts` 的 10 分鐘握手世代快取存在模組變數裡，程序結束就消失。
- **十檔＋FX**：三槽分 4 波，全價＋FX **16221.1 ms**（上一輪 v5 after App 可見為 16637.7 ms，證據核對；B1 重現了使用者現況）。固定上游下同一批次仍要 **9762.6 ms**——上游幾乎瞬間回應，十檔還是要等近 10 秒。
- **已排除**：client body 讀取 0.1 ms、Vite 代理一跳 1.8 ms、父程序 fork 前約 20 ms（以上本輪執行）；UI 發布 ≤4.3 ms（v5 證據核對）。都不是秒級來源。

**選路決定（程式依驗收協定 3.5 算出）：不跳過長駐分支 → 下一票 02「驗證同 handler 長駐本機原型」。** 派送 1836.1 ms 既 ≥500 ms 也 ≥20%；握手未共享且 1511.9 ms 遠超 100 ms／10%。兩個因素**各自**就足以支持長駐，02 必須分開報兩者的收益。決定檔：[decision-…-01e3a84ba203.json](decision-b1-fixed-20260923-r3--b1-real-20260923-r2-01e3a84ba203.json)。

## 2. 凍結的定義與目標（本票凍結，後續不得在看候選成績後調低）

目標沿用 [PLAN](../../PLAN.md) 第 3 節與 [共同驗收](../../acceptance.md) 原值，凍結於計畫提交 `4ca3c3c`（與規劃輪原稿逐字相同）。判定器常數：OPTIONS warm 中位 ≤150 ms、每筆 warm ≤500 ms；固定上游 GET 本機成本中位 ≤200 ms（C 另須相對本票 B1 的 1836.1 ms 下降 ≥80%）。

- **B1**：主工作區以日常命令形狀 `vercel dev --listen <新埠>` 啟動。直接執行全域 `vercel/dist/vc.js`，與日常 `npx vercel dev --listen 3001` 解析到同一支程式；省去 npx 包裝層，讓 owned PID＝listener PID。runner 在起服務前核對產品樹：174 檔逐檔對 HEAD 與 `30dfdb2` 皆相同，未追蹤產品檔 0，不符即拒絕量測；結束時再核一次 HEAD、產品樹與工具雜湊。HEAD `4ca3c3c` 相對 `30dfdb2` 只多計畫文件。
- **C**：候選＝相同產品資料契約＋後續票選定的修復，服務來源與工具身分逐輪綁定（02 起適用）。
- **B0**：`444d6b1` 原產品路徑＋其既有 E2 排除設定；只在 07 重建 fresh 同期配對，本票未使用。
- **E0**：原 full root 啟動逾時，保留「可用性／無法量化」。本票**未重跑**、未延長 90 秒、未把它當前置；舊 01～03 的 50% 目標仍未證實。
- **歷史 v5**：只作證據核對與趨勢（第 5 節），不參與新 PASS。

量測定義的澄清（第一票允許修正矛盾；以下都在看任何候選成績前寫定，沒有調低任何數值）：

1. OPTIONS「每筆 ≤500 ms」只套在 warm 樣本；cold（每次啟動後每路由第 1 筆）另列、須 204、不設時間門檻，與原文「cold 另列」一致。
2. OPTIONS 只量 **vercel dev 直連**。經 Vite 的 preflight 由 Vite 自己的 CORS middleware 先回 204，不會到後端（開發期 r1 的經 Vite OPTIONS 只有幾 ms，已判為無效量法）；日常 App 的同源 GET 也不發 preflight。Vite 代理一跳改用固定上游 GET 量。
3. 固定上游 GET 的「本機成本」＝client TTFB −（同一請求在子程序內量到的固定等待區間總和）。兩者都是區間長度，不是跨程序時間戳相減。判定樣本＝單支 `2330.TW` 報價、vercel dev 直連；經 Vite、FinMind、批次內樣本只列診斷。
4. 固定上游只能在探針注入下進行，所以本機成本一律是「探針下」的量法。**C 必須沿用同一量法**（直連、探針下、扣固定等待）判 200 ms 與 80%；另報經 Vite 的值與探針開銷。本輪 traced−plain 的 OPTIONS warm 中位差為 −1.8／−3.0 ms（跨 start，屬雜訊量級）；長駐候選若探針開銷可見，02 要另外定量。
5. 本票的十檔＋FX 是 **API 層**（Node client 依 App 佇列規則：FX 先、三槽、有槽即補）；App 可見面板的 B1 成績留給 07 正式量，本票數字不能當 App 目標的成績。
6. 跨程序只用 trace ID 連結。父程序的 fork 區間從「fork 呼叫開始」算（`fork()` 同步耗時中位 3.3 ms，負載下更長），避免子程序時鐘已起算而父程序還沒記錄而出現負差。

## 3. 來源、環境與身分

| 項目 | 值 |
|---|---|
| 分支／HEAD | `codex/reacceptance-fixes-p1-s1`／`4ca3c3c`（計畫保存提交；產品＝`30dfdb2`＝`6eee87e` 產品內容） |
| 保留的產品修正 | `e9fa1a2`、`2bd91f4`、`6eee87e`（未動） |
| 隱藏狀態（每次 run 重算，存於 raw.identity.worktree） | skip-worktree 1841、其中實體缺檔 805；隱藏內容差異 1 檔＝`.scratch/performance-fix-20260922/tools/verify-holdings-name-blocking.mjs`（舊案已知的重寫版，不提交）；已追蹤修改 1 檔＝`.scratch/reacceptance-fixes/HANDOFF.md`（未碰） |
| 版本 | Node v26.4.0、Vercel CLI 55.0.0、@vercel/node 5.8.23、tsx 4.21.0（隨 CLI）、Vite 6.4.1 |
| 服務身分 | 每個 start 的 owned PID＝listener PID（不符即中止）、埠互不重複、停止後 listener 0；結束身分重核一致 |
| 環境 | vercel dev 直接讀主工作區 `.env`，**本票 .env 複本 0 份**。證據只記相關鍵是否存在：ALLOWED_ORIGIN、FINMIND_TOKEN 有；PROXY_SHARED_SECRET、Upstash 兩鍵沒有，所以本機 guard 不驗 secret、限流器為 null、不打 Redis。判定器以 `.env` 值、crumb／token 查詢與 cookie 欄位掃描全部證據，命中 0 |
| 未碰 | 使用者正在跑的 3000／3001 服務、真帳本／本體五鍵、真 AI、`.planning/`、Skills 鏡像、全樹 skip-worktree 旗標 |

## 4. 方法（只補計時缺口，不改產品碼、不改全域 CLI）

`trace-preload.cjs` 只經 runner 設定的 `NODE_OPTIONS=--require` 注入本票啟動的 vercel dev。父程序記收件、fork、子程序就緒、代理來回、回寫 header；子程序記開機、dev-server listen、handler listen、就緒、收件，以及每支 outbound 的分類與區間。固定上游模式在子程序內以固定 payload 取代 Yahoo／FinMind，並拒絕任何其他 outbound。真上游模式每支回應後讀 trace，遇上游 401／429／5xx／連線錯誤（包括被 handler 重試藏在 200 後面的）即停止後續起跑。

| run | 內容 | 結果 |
|---|---|---|
| `b1-fixed-20260923-r3`（正式） | 四次獨立啟動：A／C 未注入探針量 OPTIONS；B／D 探針＋固定上游，各 5 輪（直連單支、經 Vite 單支、FinMind、十檔＋FX 批次） | problems 0，判紅 exit 1 |
| `b1-real-20260923-r2`（正式） | 一次啟動、探針、真上游：2330.TW／AAPL／FinMind 名稱方向確認＋十檔＋FX 批次 | problems 0，exit 0；上游錯誤 0、未停止 |
| `smoke-01a`、`b1-fixed-20260923-r1／r2`、`b1-real-20260923-r1` | 開發期歷史（見 README），工具版本未提交 | 最終判定器判無效（缺結束身分重核）；數值與正式 run 同方向，僅作重現性對照 |

開發中修正過三個量測問題：tsx loader worker 重複記 boot（探針只在主執行緒安裝）；經 Vite 的 OPTIONS 不到後端（改用 GET 量代理）；Windows 在同一次啟動內重用 PID、先後兩個子程序寫進同一檔，舊判定器會把後者的啟動事件接到前者（改以 `child.boot` 切實例、以「收到該 trace 的實例」連結；自測內含變異版，證明舊連結法在同一份資料上會串錯）。覆核後再補上 PID 快速失敗、起服務前產品樹核對、結束身分重核、上游錯誤即停、退出碼存檔，然後用最終版重跑成正式證據。

## 5. 等待分解（本輪執行，除非註明證據核對）

### 5.1 單支報價：固定上游（r3，10 支直連，ms）

| 區段 | min／median／max |
|---|---|
| client TTFB | 1988.6／2011.3／2031.8 |
| 本機成本（TTFB−固定等待） | 1814／1836.1／1856 |
| 父程序 fork 前（路由、@vercel/node 在父程序讀靜態設定） | 17.1／19.4／26.9 |
| 父程序 fork 呼叫 | 3.1／3.3／4 |
| 父程序 fork→子程序就緒 | 1771.5／1789.7／1803.2 |
| 子程序 開機→探針 | 20／21.8／23.2 |
| 子程序 探針→dev-server listen（模組圖載入） | 1678.2／1698.5／1708.9 |
| 子程序 dev-server listen→handler 載入完成 | 53.3／54.6／57.1 |
| 子程序 handler 總時間（含 3×50 ms 固定等待） | 178.2／183.5／192 |
| 未歸屬：client TTFB−父程序總時間 | 0.9／1.1／1.7 |
| 未歸屬：父 fork→就緒−子程序自身啟動 | 14.5／15.4／18 |

經 Vite 的同一請求 TTFB 中位 2018.6 ms、本機成本 1842.8 ms；以兩者未歸屬差額算出的代理一跳 **1.8 ms**。FinMind 單支 TTFB 中位 1903 ms、本機成本 1848.7 ms，與報價付同一份派送成本。

### 5.2 單支報價：真上游（real-r2，13 支，ms）

| 區段 | min／median／max |
|---|---|
| client TTFB | 3656.6／4045.7／4289.2 |
| 本機派送（fork 前＋fork→就緒＋就緒→代理） | 1809.3／2224.5／2274.2 |
| 　父程序 fork 前 | 18.3／19.8／84.2 |
| 　父程序 fork→子程序就緒 | 1784.5／2204.7／2240.7 |
| 　子程序 探針→dev-server listen | 1690.9／2106.4／2141.4 |
| 　子程序 dev-server listen→handler 載入 | 54.3／58.6／71.2 |
| handler 收件→第一支 outbound | 1.4／3.2／3.6 |
| Yahoo cookie | 633.8／636.9／650.1 |
| Yahoo crumb | 861.9／874.8／1078.8 |
| Yahoo cookie 起→crumb 完 | 1496.3／1511.9／1729.8 |
| Yahoo chart | 272／292.3／313.2 |
| handler 最後 outbound→回寫 | 1.1／1.2／1.4 |
| client body 讀取 | 0.1／0.1／0.7 |
| 未歸屬：client TTFB−父程序總時間 | 1.2／1.5／5.8 |

三槽並行時，子程序模組圖載入由單支時的約 1.70 秒升到約 2.1 秒（CPU 競爭；固定上游批次內中位 2152.2 ms）。FinMind 名稱單支 TTFB 2045.7 ms，其中上游 194.3 ms。

### 5.3 十檔＋FX 臨界路徑

| 來源 | 首價 | 全價＋FX | 結構 |
|---|---:|---:|---|
| B1 真上游 API 層（real-r2，本輪執行） | 4096.6 | 16221.1 | 4 波（起跑約 0／4.0／8.2／12.3 秒），peak 3 |
| B1 固定上游 API 層（r3，10 批中位，本輪執行） | 2495.4 | 9762.6 | 同 4 波；批次內每支 TTFB 中位 2491.8，其中固定等待 177.5，其餘是派送 |
| 上一輪 v5 after App 可見（證據核對） | 4419.4 | 16637.7 | 最後一支等槽 12621.5＋TTFB 4056.3；發布最大 4.3 ms |

排隊不是獨立成本，而是「單支 TTFB × 前面的波數」。v5 before 的發布最大 2870.9 ms 已由名稱解耦（`e9fa1a2`）消除，after 只剩 4.3 ms（證據核對）。重算檔：[v5-segments](v5-segments/v5-segments.md)。

### 5.4 空 OPTIONS（r3 plain 直連，ms）

| 路由 | cold（n=2） | warm（n=20） | 中位 ≤150 | 每筆 ≤500 |
|---|---|---|---|---|
| Yahoo chart | 1997.7／2016.5／2035.2 | 1807.1／1833.3／1967.3 | FAIL | FAIL |
| FinMind | 1820.3／1833.8／1847.3 | 1808／1839.9／1903 | FAIL | FAIL |

traced OPTIONS（n=44）：handler 內中位 2.7 ms（最大 3.9）就回 204；父程序總時間中位 1834.4 ms，其中 fork→子程序就緒 1796.3 ms、子程序模組圖載入 1703 ms。空請求的約 1.8 秒幾乎全是派送。

## 6. provider 預算表（每次冷載入）

本節是依 handler 路徑的計數式（列出算式）：每支 Yahoo 報價正常 3 支 outbound（cookie、crumb、chart），第一次 401／429 會清世代、等 500 ms 重做一次，最壞 6 支；FinMind handler 不重試。

| 情境 | browser API | outbound：現況每請求握手 | 最壞 | 長駐且握手共享（預測，未量） |
|---|---:|---:|---:|---:|
| 十檔庫存（11 Yahoo＋5 FinMind 名稱） | 16 | 11×3＋5＝38 | 11×6＋5＝71 | 2＋11＋5＝18 |
| 十檔 K 線（20 Yahoo 2y／10y＋15 FinMind） | 35 | 20×3＋15＝75 | 20×6＋15＝135 | 2＋20＋15＝37 |
| 本票 real-r2（2 方向報價＋11 批次＋1 FinMind，runner 由常數推導） | 14 | 39＋1 | 78＋1＝79 | — |

本票實際 outbound：cookie 13、crumb 13、chart 13、FinMind 1，合計 40（等於正常預算，無重試，上游錯誤 0）。取消是否阻止 outbound 本票未涉及，留待 K 線票在 server 邊界證明。

## 7. 可否證假設（依可控收益排序）

1. **H1 派送（最大、可控）**：每請求 fork＋子程序載入 dev-server 模組圖＋載入 handler，單支時約 1.8 秒、三槽並行約 2.2 秒。預測：同一 handler 在長駐程序內處理時，固定上游單支本機成本中位 ≤200 ms。**否證**：長駐原型的固定 GET 本機成本中位仍 >500 ms，或 trace 顯示時間移到其他本機段。
2. **H2 握手重做（第二、可控）**：模組變數的握手世代快取因每請求新程序而無法重用；13/13 各自握手，中位 1511.9 ms。預測：長駐後同一 10 分鐘視窗內，11 支報價的 cookie＋crumb outbound 由 22 支降為 2 支，熱命中的報價不再有 1.5 秒握手段。**否證**：長駐後 trace 仍逐支出現 cookie／crumb，或共用 pending 造成 401／429 世代錯亂。
3. **H3 三槽放大（放大器）**：全價＋FX≈波數×單支 TTFB（真上游 4 波 16.22 秒、固定上游 4 波 9.76 秒）。預測：H1、H2 成立後，全價縮短的比例接近單支縮短的比例。**否證**：單支大幅下降但全價沒有跟著降，代表還有其他序列化等待。
4. **H4 上游下限（不可控）**：chart 中位 292.3 ms、cookie 636.9 ms、crumb 874.8 ms 是本機到 Yahoo 的實際延遲；長駐只能減少次數，不能縮短單次。
5. **H5 已排除**：body 讀取、UI 發布、Vite 代理、父程序 fork 前段都在毫秒級，不列入優化。

## 8. 判紅命令與工具驗證

```powershell
# B1 固定上游分段（四次啟動、不打真上游），目前路徑預期 exit 1（判紅）
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode fixed --port-base <連續 6 個未占用埠起點>
# 預算內真行情小批（14 支 browser API），exit 0＝有效
node .scratch/performance-optimization-20260923/tools/b1-breakdown.mjs --run-id <新代號> --mode real --port-base <未占用埠>
# 重播（只讀 raw，不發請求）：r3 exit 1、real-r2 exit 0；合併選路
node .scratch/performance-optimization-20260923/tools/verify-b1-breakdown.mjs --run-id b1-fixed-20260923-r3
node .scratch/performance-optimization-20260923/tools/verify-b1-breakdown.mjs --fixed-run b1-fixed-20260923-r3 --real-run b1-real-20260923-r2
# 工具自測（合成 raw 故障注入）與 v5 證據核對
node .scratch/performance-optimization-20260923/tools/self-test.mjs
node .scratch/performance-optimization-20260923/tools/v5-segments.mjs
```

exit code：0＝有效且達標（real 模式沒有門檻，0 只代表有效）、1＝有效但未達標（判紅）、2＝run 無效。runner 當下的退出碼存在各 run 的 `runner-result.json`（r3＝1、real-r2＝0）。自測 46 項，涵蓋：快速合成 run 判 0、B1 量級判 1、門檻邊界、OPTIONS 非 204、listener PID 不符、trace 缺事件、固定輸出漂移、固定模式混入真 outbound、證據含 `.env` 值或 crumb 查詢、run 期間 HEAD 改變、真上游超預算、被 handler 重試藏住的上游 429、上游錯誤即停與預算推導、同／跨 start 的 PID 重用（含變異版串錯）、選路規則六種邊界、探針分類不含 crumb／token、摘要不覆寫。runner 拒絕重用 run-id、占用中的埠與非本 run 的 listener；raw 與既有摘要都不覆寫。

## 9. 限制與仍 OPEN

- 全案效能目標全數仍 OPEN：B1 的 OPTIONS 與固定 GET 本機成本都 FAIL（本票就是要證明它會判紅）。十檔／K 線 App 目標還沒有候選。
- 子程序約 2.1 秒的模組圖載入沒有再細拆（tsx 註冊、dev-server 相依的 ts-morph 與 TypeScript 等）。長駐原型會把整段移出每請求路徑，細拆不影響選路；若 02 的原型仍有秒級啟動才需要拆。
- 真上游只有一批 13 支，屬方向與分解證據，不是正式配對成績；Yahoo 延遲會隨時段變動。
- 選路的派送占比以無並行的固定上游本機成本為分子（保守）；真上游三槽並行下量到的派送占比更高（0.55），結論相同。
- 正式部署（Vercel 雲端）不一定逐請求重建程序；本結論只適用本機 vercel dev 日常入口。
- E0 仍不可量；舊 v5 FAIL 與舊 01～03 的 OPEN 原樣保留，沒有被新數據追認。
