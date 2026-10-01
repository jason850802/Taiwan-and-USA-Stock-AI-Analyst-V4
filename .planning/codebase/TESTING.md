# Testing Patterns

**Analysis Date:** 2026-09-30

> 本版取代 2026-05-31 版。舊版寫「沒有任何自動化測試」在當時成立；vitest 跑道於 2026-07-13
> 建立（`6ed7713`），之後逐票累積行為鎖。每條敘述都附對證的指令或檔案；數字是 2026-09-30
> 的快照，會隨新測試增減，引用前請重跑對證指令。

## 摘要

| 項目 | 現況 | 對證 |
|---|---|---|
| 框架 | Vitest（devDependency `~3.2.7`，安裝版 3.2.7） | `package.json`；`npx --no -- vitest --version` |
| 跑測試 | `npm run test`（＝`vitest run`，跑一輪即結束） | `package.json` 的 `scripts.test` |
| 機械驗收 | `npm run gate`：五道，第 2 道就是 `npm run test` | `scripts/run-gate.mjs` |
| 規模 | 49 個測試檔、811 個案例，全綠 | `git ls-files '*.test.ts'`；`npm run test` 結尾的 `Tests … passed` |
| 執行環境 | vitest 預設的 `node`，沒有 DOM | `git grep -l '@vitest-environment' -- '*.test.ts'` 為空；`package.json` 沒有 jsdom／Testing Library |
| 立場 | 行為鎖（characterization）：照現行行為寫斷言；既有案例零修改 | `CORE_RULES.md`「機械驗收 gate」段；`docs/adr/0002-api-lib-test-colocation.md` |

沒有 lint、formatter、coverage（未安裝 ESLint／Prettier／`@vitest/coverage-*`）。要加就得裝新套件，
依 CORE_RULES 先問使用者。

## 指令

```bash
npm run test                    # 全部測試跑一輪（vitest run）
npx vitest run <檔名片段>        # 只跑檔名符合的測試檔，例：npx vitest run portfolioFees
npm run gate                    # 機械驗收五道，見「與機械 gate 的關係」
```

- 沒有 `test:watch`、`coverage` script。
- 更新 snapshot（`-u`）等於修改既有期望值，見「Snapshot 鎖」。

## 設定

- 沒有獨立的 `vitest.config.*`；設定寫在 `vite.config.ts` 的 `test` 區塊，目前只有一項：
  `exclude: [...configDefaults.exclude, '**/.claude/**']`，排除 agent worktree 裡的測試複本
  （曾讓 32 個案例被重複計成 64；`6aa5735`）。
- 沒有 `include` 白名單：vitest 預設收 `**/*.{test,spec}.?(c|m)[jt]s?(x)`，放在哪個目錄都收得到。
- **tsc 也型檢測試檔**：`tsconfig.json` 沒有 `include`，`exclude` 以外全部進型檢範圍，所以測試檔
  同樣要過 `npx tsc --noEmit`（gate 第 1 道）。`exclude` 的內容與理由見 `CONVENTIONS.md` 的
  TypeScript Configuration 節。
- 測試檔不進前端 bundle（`index.tsx` 的 import 鏈不會引用它們）。**`api/` 底下例外**：Vercel 零設定
  會把 `api/` 內非 `_`／`.` 開頭的 `.ts` 部署成函式，所以 `.vercelignore` 排除 `api/**/*.test.ts`，
  並由 `utils/vercelIgnoreGuard.test.ts` 鎖住。

## 放置與命名

- **就地放置**：測試檔與受測檔同目錄，檔名 `<模組>.test.ts`（例：`utils/portfolioFees.ts` ↔
  `utils/portfolioFees.test.ts`、`api/_lib/guard.ts` ↔ `api/_lib/guard.test.ts`）。後端由 ADR-0002
  （2026-07-28）拍板；2026-07-30 起 `services/`、`components/` 也開始有同目錄的測試。2026-10-01 第二次
  重算：59 檔中有 46 檔的同目錄就有同名受測檔（第一次更正寫 49 檔中 38 檔）。對證：對
  `git ls-files '*.test.ts' '*.test.tsx'` 的每支，取檔名第一段為 `<模組>`，檢查同目錄有沒有
  `<模組>.ts`／`<模組>.tsx`。
- **同一模組多支測試**：`<模組>.<面向>.test.ts`，例：`services/yahoo.loading.test.ts`、
  `services/yahoo.revalidation.test.ts`、`services/finmind.bounds.test.ts`、
  `api/_lib/llm.claude-cli.test.ts`。
- **副檔名用 `.test.ts`**；唯一例外是要寫 JSX 的畫面測試用 `.test.tsx`（2026-10-01 起 1 支，見下一點）。
  沒有 `.spec.*`。`api/` 底下**必須**是 `.test.ts`：`.vercelignore` 的規則只蓋得到這種命名，換成別的命名
  vitest 照收，卻會被部署成函式。
- **元件檔優先測匯出的純函式**：例 `components/fundamentals/QuarterlyTrendCharts.test.ts`
  測 `QuarterlyTrendCharts.tsx` 匯出的 `formatEpsLabel`。
  - **畫面測試**（2026-10-01 起）：要鎖住畫面上實際顯示的文字（例如碰錢的統計卡數字）時，用 react-dom
    內建的 `renderToStaticMarkup`（`react-dom/server`）在 node 環境把元件渲染成 HTML 字串再比對——不需要
    jsdom、不裝新套件。限制：只看得到第一次渲染的靜態輸出，`useEffect`／`useLayoutEffect` 不會執行，也不能
    點擊、輸入；會讀瀏覽器儲存或打網路的 hook／子元件要用 `vi.mock` 換成替身；以標題等文字定位、不要依賴
    樣式 class。例：`components/portfolio/quoteGapsDisplay.test.tsx`（統計卡與持股表群組小計在報價不齊時的顯示）。
- **測試標題**：`it` 用繁體中文描述行為；`describe` 常以受測函式名分組（核對時 947 行標題中
  894 行含中文，純英文的多是 `describe('getModelForMode', …)` 這類分組）。
- 同目錄沒有同名受測檔的 13 支（2026-10-01 第二次重算；第一次更正寫 11）：12 支在 `utils/`、1 支在
  `components/portfolio/`，分三類：
  1. **同目錄、以功能命名**（3 支）：`utils/backfillFromTxns.test.ts`（測 `utils/portfolioHistory.ts` 的回推）、
     `utils/statementParsers/parsers.test.ts`（同目錄的多個對帳單解析器合測）、
     `components/portfolio/quoteGapsDisplay.test.tsx`（畫面測試，同時測同目錄的 `HoldingsTable.tsx` 與上一層的
     `Portfolio.tsx`）。
  2. **早期放置，不搬**（5 支）：2026-07-28 以前的測試全放 `utils/`，受測物在 `services/` 也一樣——
     `fetchError`（測 `services/fetchError.ts`）、`geminiRules`／`geminiPrompts`（測 `services/gemini.ts`）、
     `geminiCache`（測 `services/_shared/geminiCache.ts`）。這幾支檔頭寫的「沿用現行 vitest 收錄範圍」
     描述的是當時現況、不是規定（ADR-0002 背景節）；ADR-0002 也決定不搬舊檔。之後同主題的
     `utils/portfolioHealthStreaming.test.ts`（測 `services/gemini.ts`）也放在這裡。
  3. **守門測試**（5 支）：受測物是根目錄的設定檔或跨檔結構，見下節。

## 守門測試（guard tests）

不測函式行為，而是讀設定檔或原始碼文字，鎖住「改了也不會讓任何其他測試變紅」的設定。
全部放在 `utils/`；改對應的設定前，先讀那支測試的說明。

| 測試 | 鎖什麼 | 起因 |
|---|---|---|
| `utils/viteConfigGuard.test.ts` | `vite.config.ts` 顯式設 `envPrefix: 'VITE_'`、沒有 `define` 曝出 env；分匯出設定、`resolveConfig` 之後、`loadEnv` 行為三層驗 | 金鑰紅線：放寬前綴或加 `define`，後端秘密就有資格進 bundle（gate-audit G3） |
| `utils/vercelIgnoreGuard.test.ts` | `.vercelignore` 保有 `api/**/*.test.ts` 且沒有 `!` 反向規則；`api/` 下的測試檔都是 `.test.ts` | 2026-07-31 正式部署曾把 `api/gemini-stream.test` 部署成函式，一呼叫就 500 |
| `utils/tsconfigScopeGuard.test.ts` | tsconfig 型檢範圍內的 JS 檔不得寫 `globalThis` 屬性 | 2026-09-30 量測腳本把 `fetch` 換成假函式，污染 Vercel 對 `api/` 的型別檢查（建置 log 多出 5 個 error TS） |
| `utils/appLazyBoundaries.test.ts` | `App.tsx` 以 `lazy()` 載入 `StockChart`／`AnalysisResult`；`vite.config.ts` 不用 manual chunk 破壞 lazy 邊界 | 2026-09 效能優化案的首屏基線（`ade5dca`） |
| `utils/vercelConfigGuard.test.ts` | `vercel.json` 讓每支 API 函式恰好被一個 functions 樣式命中、該樣式開 `supportsCancellation`，且不設 `maxDuration` | 使用者關頁時後端要停止呼叫 AI 與行情上游，而 Vercel 的請求取消是 opt-in（票 03 平台取消診斷，`9c6145f`） |

`appLazyBoundaries` 沒有檔頭說明，其餘四支的檔頭都寫明守什麼、為什麼、邊界在哪。

## Snapshot 鎖

- 只有兩支用 snapshot，檔案在 `utils/__snapshots__/`（已進 git）：
  - `utils/geminiRules.test.ts`：`services/gemini.ts` 的 5 個 system instruction 逐位元組，
    加上 `formatHealthCheckData` 的輸出版面。
  - `utils/geminiPrompts.test.ts`：mock `fetch` 攔下送出的 request body，鎖完整 prompt。
- 快取鍵由 system instruction 與 prompt 組成，改一個字就讓 AI 分析快取與 Gemini implicit caching
  全數失效（使用者多付一輪費用）。所以 snapshot 紅燈代表有人動了規則書或 prompt。
  動 system instruction 前先讀 `.planning/phases/12-arch-deepening/12-CONTEXT.md` 的 D-06（CORE_RULES）。
- 用 `-u` 更新 snapshot＝修改既有期望值，受 gate 紅線管轄：確認變更是刻意的，並先問使用者。

## Mock 與測試資料

以下是核對時的實際用法；處數用 `git grep -o "<樣式>" -- '*.test.ts'` 數命中，檔數用 `git grep -l`：

- **網路**：`vi.stubGlobal('fetch', …)`（24 處）。測試不打真 API——Gemini 要花錢、也要金鑰。
  `api/_lib/http.test.ts`、`utils/fetchError.test.ts` 裡的 fetch 只出現在錯誤訊息字串，不發請求。
- **子程序／模組替換**：`vi.mock()` 有四支（2026-10-01 重算）——`api/_lib/llm.claude-cli.test.ts` 換掉
  `node:child_process`（不真的啟動 claude CLI），`api/gemini-stream.test.ts` 換掉 `./_lib/llm.js`
  與 `./_lib/ratelimit.js`，`api/_lib/http.cancel.test.ts` 換掉 `@google/genai` 與 `./config.js`，
  `components/portfolio/quoteGapsDisplay.test.tsx` 換掉報價 hook 與會讀 localStorage 的
  `useDailySnapshot`／`PnlHistorySection`。
- **環境變數**：`vi.stubEnv`＋`vi.unstubAllEnvs`（7 檔）；沒有測試直接賦值 `process.env`
  （ADR-0002：env 相依用框架的 stub 處理）。
- **瀏覽器全域**（node 環境沒有）：`sessionStorage`（26 處）、`localStorage`（5 處）、
  `requestAnimationFrame`／`cancelAnimationFrame` 都用 `vi.stubGlobal` 墊。
- **時間**：`vi.useFakeTimers`＋`vi.setSystemTime`，收尾 `vi.useRealTimers`。
- **還原要自己寫**：`vite.config.ts` 沒開 `unstubGlobals`／`unstubEnvs` 自動還原，所以要在 `afterEach`
  呼叫 `vi.unstubAllGlobals()`（13 檔）／`vi.unstubAllEnvs()`（7 檔）。
- **測試資料**：合成 fixture 直接寫在測試檔內，沒有共用的 fixture 目錄或資料檔。碰磁碟的只有 4 支
  守門測試（讀設定檔與原始碼；`viteConfigGuard` 另在系統暫存目錄寫一份 fixture `.env`）。
  對帳單解析器只用與真檔同結構的合成資料，**不放使用者真實帳單**
  （`utils/statementParsers/parsers.test.ts` 檔頭的隱私鐵則）。

## 檔頭敘事慣例

多數測試檔（核對時 34／49）第 1 行是 `// <檔案路徑> — <鎖什麼>`，接著寫守的是什麼、為什麼
需要、邊界在哪。放置位置不直覺或守門類的測試尤其要寫，後人才不會以為放錯或多餘
（ADR-0002 後果節）。

## 與機械 gate 的關係

`npm run gate`（`scripts/run-gate.mjs`，只用 node 內建模組）依序跑五道，前一道紅了就停：

1. `npx tsc --noEmit`——測試檔也在範圍內
2. `npm run test`——vitest 全綠
3. `npm run build`
4. 金鑰掃描——`dist/`＋git 追蹤原始碼＋`.env*` 實際值。在 worktree 裡會一併讀主 worktree 的
   `.env*`；兩邊都讀不到時降級，並在結尾摘要標明（加 `-- --require-env` 則直接判紅）
5. `package.json`／`package-lock.json` 工作樹沒有未提交的變動（相對 HEAD 的差異只提示、不判紅）

- **紅線**（`CORE_RULES.md`「機械驗收 gate」段）：既有案例零修改；既有測試紅燈＝語意變更的訊號，
  停下來問使用者，不是把期望值改綠。
- gate 管不到 runtime：console 零紅字、UI 數字要量、快取類換乾淨代號，仍須人工。
- 各道的紅燈能力與剩餘缺口：`docs/gate-audit-findings.md`。
- **在 agent worktree 跑**：worktree 常沒有自己的 `node_modules`。本專案的 worktree 位在主 repo
  目錄底下（`.claude/worktrees/<名稱>/`），Node 與 npx 會往上層解析到主 repo 的 `node_modules`，
  gate 可以直接跑。先用 `npx --no -- tsc --version` 確認印出 5.8.x（`--no`＝本地解析不到就失敗、
  不安裝）；gate 內部呼叫的 `npx tsc` 沒帶 `--no`，解析不到時會改抓 npm 上同名的 `tsc` 套件
  （互動終端會先詢問、非互動環境直接裝）——那是已棄用的 2.0.4 版編譯器（`npm view tsc` 可查）。

## 已知缺口

- 沒有 React 元件的互動測試（點擊、輸入、effect 之後的狀態）——要 jsdom／Testing Library 得裝新套件＝先問
  使用者。靜態畫面可用 `renderToStaticMarkup` 鎖（見「放置與命名」），互動與 effect 仍靠實機驗證
  （CORE_RULES 的 runtime 人工項）。
- `api/_lib/` 的 7 個模組都有測試。5 支 API handler 中，`api/gemini-stream.ts`（`api/gemini-stream.test.ts`）
  與 `api/yahoo/chart.ts`（`api/_lib/yahoo.handshake.test.ts` 內）有 handler 層測試；`api/finmind.ts`、
  `api/gemini.ts`、`api/yahoo/search.ts` 沒有。
- `utils/volume.ts` 的 `estimateVolumeTrend`（盤中量能預估，舊版列為高價值目標）至今沒有測試；
  `utils/entryFilter.ts` 只 import 它的型別 `VolumeProjection`。
- 查某個模組有沒有被測：`git grep -l "<模組檔名>" -- '*.test.ts'`。

---

*Testing analysis: 2026-09-30*
*對證來源：`package.json`、`vite.config.ts`（`test` 區塊）、`tsconfig.json`、`.vercelignore`、
`scripts/run-gate.mjs`、`docs/adr/0002-api-lib-test-colocation.md`、`git ls-files '*.test.ts'`，
以及 2026-09-30 在 worktree 跑的 `npm run test`（49 檔／811 案例全綠）。*
*2026-10-01 更正：「放置與命名」的同名受測檔計數 39／10 → 38／11（原計數漏了守門測試
`utils/appLazyBoundaries.test.ts`；三類各標支數 2＋5＋4＝11）。其餘內容未變動。*
*2026-10-01 第二次增補：畫面測試寫法（`renderToStaticMarkup`）與 `.test.tsx` 例外、`vi.mock` 四支、同名受測檔
計數重算（59 檔中 46 有、13 沒有，三類 3＋5＋5）、守門測試表補 `vercelConfigGuard`。摘要表的規模數字仍是
2026-09-30 的快照。*
