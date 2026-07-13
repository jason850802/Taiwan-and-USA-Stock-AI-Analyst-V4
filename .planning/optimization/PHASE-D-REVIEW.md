# Phase D 覆核報告（Sonnet）

**規格範圍：** `.planning/optimization/PLAN.md` §Phase D（D-1a～D-1e、D-2、D-3、D-4、共同驗收）＋「已拍板決策」第 4 點
**七個工作包：** 260713-kq2（D-1a）、260713-len（D-1b）、260713-mi1（D-1c）、260713-n11（D-1d/D-1e）、260713-nvg（D-2）、260713-ob4（D-3）、260713-oxf（D-4）
**Code commits 逐一 `git show`／`git log` 核對：** 24a8135、e6e4140、aa9dd4f、0dcb98b、d06bcb2、6ed7713、d5d8f57、f98aa56——全部存在且內容與 SUMMARY 宣稱一致
**日期：** 2026-07-13
**獨立重跑驗證（本次覆核，非僅信賴 SUMMARY 宣稱）：** `npx tsc --noEmit`（綠）、`npm run build`（綠，7 asset）、`grep -r AIza dist/`（0 結果）、`npm run test`（2 files/32 tests 全綠）、`npx vitest run`（無 exclude，重現 64 tests 證實 d5d8f57 修復必要性且有效）、`git status --porcelain`（除既有 .planning 修改外乾淨）

---

## 整體判定：**ACCEPT**

七個工作包全數 ACCEPT，0 個 CRITICAL、0 個 HIGH。發現 1 個 WARNING（D-3 vitest 排除機制以 CLI flag 而非 config 檔实作，跨平台/跨 shell 有脆弱性風險，但在本專案唯一支援環境 Windows+cmd 下已驗證正確運作）與 2 個 LOW（`.claude/worktrees` 殘留複本的repo衛生債務、ErrorBoundary 對懶載失效的復原顆粒度較粗）。所有 D-1b 的內聯設定遷移逐鍵位元對位元核對（`git show 24a8135^:index.html` 與現行 `tailwind.config.js` 手動 diff）完全一致；D-3 三個測試檔的斷言經本覆核獨立手算（K線 fractal 轉折偵測、RSI/MACD/KDJ warm-up 邊界、runEntryFilter GO/WAIT/NO_GO 決策鏈）全數與程式碼現行行為吻合，非虛設斷言。

---

## 逐包判定表

| 包 | 判定 | 關鍵證據 |
|---|---|---|
| D-1a（基線量測＋動態 className 稽核） | **ACCEPT** | 160→51 分解（109 為 `.claude/worktrees` 陳舊複本）經本覆核 `find`/`grep` 獨立重現；51 行安全分類的 5 個邊界例（StockChart:918、Portfolio:96、Modal:51、Skeleton:18、ui/* prop 透傳）人工核對值域可靜態追溯，判定成立 |
| D-1b（Tailwind 建置期化） | **ACCEPT** | `tailwind.config.js` 與 `git show 24a8135^:index.html` 內聯 config 逐鍵（colors 8 組／fontFamily 2 鍵／borderRadius 3 鍵）**位元對位元相同**；`index.css` 與原內聯 `<style>` 逐行相同；purge 抽查本次重跑 `dist/assets/*.css` 含 `bg-surface`／`text-up`／`::-webkit-scrollbar`／色值 `f0405a` 全命中 |
| D-1c（importmap 移除＋文件單軌化） | **ACCEPT** | `dist/index.html` 本次重 build 後 `esm.sh`／`cdn.tailwindcss.com` 皆 0 處；`CLAUDE.md`／`STACK.md` 重新 grep 無殘留雙軌敘述 |
| D-1d／D-1e（分包＋Google Fonts 拍板） | **ACCEPT** | 本次重 build：主 chunk 156,578 B raw（vs 967,600 B 基線，**-83.8%**，遠超 -40% 硬指標）；vendor/recharts/markdown 三 chunk 存在；Portfolio／FundamentalsPanel 為獨立 async chunk、`export default` 存在、不在 modulepreload 清單 |
| D-2（React error boundary） | **ACCEPT** | `components/ErrorBoundary.tsx` 為全 codebase 唯一 class component（`grep` 確認）；fallback 全 inline style、零專案元件依賴；orchestrator 已實測 throw→fallback→reload→恢復全鏈路 |
| D-3（最小單元測試） | **ACCEPT** | 32 個測試斷言經本覆核獨立手算驗證與程式碼行為完全吻合（詳見下方「正確性抽查」）；`d5d8f57` 補丁修復 `.claude/worktrees` 重複計數問題，本次重現「無 exclude→64 tests、有 exclude→32 tests」確認修復必要且有效 |
| D-4（ratelimit fail-open 查證） | **ACCEPT** | `api/_lib/ratelimit.ts:8-12/18-19/68-69/78-81` 逐行核對與 SUMMARY 描述完全一致；純查證未改碼，`git status` 確認零程式碼變動 |

---

## Findings

### WARNING

**WR-01｜D-3｜`package.json:10`（`"test": "vitest run --exclude .claude/**"`）——排除機制以 CLI flag 內嵌 glob 字面值實作，而非 vitest.config 的 `test.exclude` 陣列，跨 shell 環境有潛在脆弱性**

問題：`d5d8f57` 修復 `.claude/worktrees` 殘留複本被 vitest 重複收集執行的問題（本次覆核重現：拿掉 `--exclude` 旗標後測試從 32 個暴增為 64 個，兩份完全重複的 `utils/math.test.ts`／`utils/entryFilter.test.ts` 分別在 `utils/` 與 `.claude/worktrees/agent-*/utils/` 被同時執行），修法是在 npm script 字串中內嵌 `--exclude .claude/**`。

這個寫法把 glob pattern 的正確性交給「執行 `npm run test` 當下的 shell 是否會對 `**` 做 glob 展開」決定：
- 在 Windows `cmd.exe`（npm 預設 script shell）下，`**` 不會被展開，字面值原樣傳給 vitest CLI 解析——本次覆核重跑確認在本機環境正確運作（32 tests，無重複）。
- 但若日後開發者改用 Git Bash 執行 `npm run test`（本專案 CLAUDE.md 明確建議「跑驗證用 Bash 工具」），且該 bash 啟用 `shopt -s globstar` 或某些 bash 版本/設定下 `**` 展開行為不同，字面值 `.claude/**` 可能被 shell 展開成 `.claude` 目錄下的實際檔案/目錄列表（例如 `.claude/agents .claude/skills .claude/worktrees ...`），此時 `--exclude` 只會吃到展開後的第一個 token，其餘會被當成 vitest 的額外 positional 參數（測試檔案路徑過濾器），可能導致排除失效或測試收集範圍被意外窄化，且失效方式是靜默的（不會報錯，只會跑出錯誤的測試子集）。
- vitest 官方慣例是把測試排除規則放進 `vitest.config.ts`／`vite.config.ts` 的 `test.exclude` 陣列——該陣列由 vitest 自身以 micromatch 解析 glob 字串，完全不經過任何 shell，不受執行環境（cmd/bash/zsh/CI runner）影響，也更容易被下一位開發者發現與維護（不用去 package.json scripts 裡找隱藏的 CLI flag）。

**建議修法：**
```ts
// vite.config.ts 或新增 vitest.config.ts
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
  // ...既有設定
});
```
並將 `package.json` 的 `test` script 改回單純的 `"vitest run"`，排除規則收斂到 config 檔案，消除 shell 解析的不確定性。

---

### LOW

**LO-01｜跨包（D-1a／D-3）｜`.claude/worktrees/agent-*/`——陳舊 agent worktree 複本反覆造成稽核/測試計數污染，屬未償還的 repo 衛生債務**

D-1a 的 className grep（160→51，其中 109 行是複本）與 D-3 的 vitest 收集（64→32，其中一半是複本）是同一根因的兩次獨立症狀：`.claude/worktrees/` 下至少 3-4 個已合併但未清理的舊 agent worktree，內含完整的 `utils/`、`components/` 原始碼複本。這些複本目前被兩處 workaround 個別繞開（Vite content globs 明確排除、vitest exclude 明確排除），但只要新增下一個需要「掃描全 repo 原始碼」的稽核或工具（例如未來的 lint 規則、bundle analyzer、i18n key 掃描），就會第三次踩到同樣的計數污染問題。

**建議修法：** 排定一次 `git worktree remove` 清理（D-1a SUMMARY 已建議「可擇期清理，非本包範圍」），或在 repo 根目錄補一個 `.gitignore`／文件層級的「掃描工具一律加 `.claude/**` 排除」慣例註記，避免每個新工具都要重新發現這個坑。

**LO-02｜D-2｜`components/ErrorBoundary.tsx`——root 級單一 boundary 使任一分頁的 lazy chunk 載入失敗會讓整個 App（含其他分頁的既有狀態）一併顯示 fallback，而非僅該分頁降級**

問題：`index.tsx` 的 `<ErrorBoundary>` 包在 `<App/>` 最外層，`Suspense` 則分別包在 `Portfolio`／`FundamentalsPanel` 兩個分頁內部（App.tsx:350、:361）。React 的 `Suspense` 只接手「元件正在載入」的 pending 狀態，並不攔截 `import()` reject 之後的 render throw——該 throw 會穿透 `Suspense` 邊界，往上找最近的 error boundary，也就是直接跳到 root 級的 `ErrorBoundary`。實際效果：使用者正在「市場分析」分頁看 K 線圖（有效狀態），若此時切到「我的庫存」分頁剛好斷網導致 `Portfolio` chunk 載入失敗，整個 App（含市場分析頁面已抓到的行情/分析結果）會被 fallback 蓋掉，使用者按「重新載入」後這些已有的資料會遺失，而非僅「我的庫存」分頁單獨顯示局部錯誤、市場分析頁面資料保留。

這完全符合 D-2 規格文字（「index.tsx:11 直掛 `<App/>`——包一層可恢復 fallback」，規格本來就只要求 root 級），故不構成規格偏離，只是規格本身選擇了較粗顆粒度的復原範圍。orchestrator 已實測驗證此 root 級行為本身正確運作（throw→fallback→reload→恢復）。

**建議修法（非阻塞，未來優化方向）：** 若日後 lazy chunk 載入失敗的使用者抱怨增多，可考慮在 `Suspense` 外再加一層局部 `ErrorBoundary`（每個懶載分頁各自包一層），讓分頁級失敗不波及其他分頁已有狀態；root 級 boundary 保留作為最終防線（catch-all）。

---

## PASS 項目（逐項核對，附證據）

### D-1a
- 160→51 分解：本次覆核以 `find .claude -iname "*.test.ts" | wc -l` 等指令獨立重現複本存在事實（158 個 `.claude/worktrees` 內檔案，含 node_modules 與原始碼複本雙重來源）；51 行分類表逐檔核對至少 5 個邊界例，值域可靜態追溯的推理成立。
- content globs（`'./index.html'`、`'./*.{ts,tsx}'`、`'./components/**/*.{ts,tsx}'`）本次覆核以 `find components -name "*.tsx"` 確認涵蓋全部 14 個含 className 的檔案（含 `components/fundamentals/**` 與 `components/ui/**` 巢狀子目錄）。

### D-1b
- **內聯設定逐鍵位元對位元核對**：`git show 24a8135^:index.html` 取出的原始 `tailwind.config`（colors 8 組、fontFamily 2 鍵、borderRadius 3 鍵）與現行 `tailwind.config.js` 逐字元比對，**完全相同，零改動**。`index.css` 的 body 樣式與四條 `::-webkit-scrollbar` 規則與原內聯 `<style>` 逐行相同。
- 本次重 build 後 purge 抽查：`bg-surface`／`text-up`／`::-webkit-scrollbar`／色值 `f0405a` 於 `dist/assets/*.css` 全命中。
- `postcss.config.js` 掛 `tailwindcss`＋`autoprefixer` 兩插件，ESM `export default` 語法與 `"type": "module"` 相容（本次 tsc／build 綠證實）。

### D-1c
- 本次重新 `npm run build` 後 `dist/index.html` grep `esm.sh`＝0、`cdn.tailwindcss.com`＝0（D-1a 基線各為 6/1）。
- `index.html` 現行內容僅 meta／title／Google Fonts link／root div／module script，一字未動非目標區塊。
- `CLAUDE.md:54`／`STACK.md:70,94` 本次重新 grep 確認無殘留「依賴要同時維護兩處」或 esm.sh／importmap 敘述。

### D-1d／D-1e
- 本次獨立重 build：主 chunk `index-CX0JQqoe.js` = 156,578 B raw（較 967,600 B 基線 **-83.8%**，遠超 -40% 硬指標；與 SUMMARY 記錄的 155,575 B 有 ~1KB 差異，屬 build 環境間微幅依賴版本解析差異，不影響達標判定）。
- `vendor`／`recharts`／`markdown` 三個 manualChunks 存在；`vite.config.ts` 既有 `server.proxy`／`plugins`／`resolve.alias` 逐字保留，僅新增 `build.rollupOptions.output.manualChunks` 區塊。
- `Portfolio`／`FundamentalsPanel` 皆 `export default`（本次 grep 確認），`App.tsx` 用 `lazy(() => import(...))` 正確引用，`tabFallback` 為非空 Loader2 spinner（非白屏 fallback）。
- D-1e：Google Fonts 保留 CDN 的拍板記錄成立，`index.html` 唯一外部資源即此 link。

### D-2
- `components/ErrorBoundary.tsx`：`grep -rl "extends React.Component"` 本次覆核確認為**全 codebase 唯一** class component，符合檔頭註解宣稱。
- `getDerivedStateFromError`／`componentDidCatch` 實作正確；fallback 全 inline style（不依賴 Tailwind/CSS 健在）、不 import 任何專案元件（Button 等），避免 fallback 自身再 throw。
- UI 僅顯示 `error.message` 摘要，完整 error＋`componentStack` 只進 `console.error`——資訊揭露風險已緩解。
- `index.tsx` 掛載順序 `<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>` 正確；root element 前置 throw（發生於 React render 之前）不在 boundary 覆蓋範圍內，此為 React 架構限制而非本包缺陷，D-2 規格本身也明確排除此範圍。
- orchestrator 已實測完整 throw→fallback→reload→恢復鏈路，本覆核對程式碼靜態核驗與該實測結果一致。

### D-3
**本覆核對三個測試檔的斷言做獨立手算驗證（非僅信賴測試綠燈），逐一複算：**

- **`calculateMACD` warm-up 邊界**：`slow=20` 時 `macdLine` 於 `emaSlow` 有效起點（index 19）才非 null，`signal=10` 對有效 MACD 序列（自 index 19 起共 21 筆）做 EMA，第 10 筆有效值落在原時間軸 index 19+9=28——與斷言 `macdLine[18]===null && macdLine[19]!==null`、`signalLine[27]===null && signalLine[28]!==null` 完全吻合實作邏輯（`utils/math.ts:94,104-108`）。
- **`calculateKDJ` warm-up 邊界**：迴圈自 `i = period-1 = 4` 起算，故 `K/D/J[0..3]` 維持初始值 50（`utils/math.ts:143-148`）——與斷言吻合。手算遞增序列 `K[4]`：`rsv=(closes[4]-minLow)/(maxHigh-minLow)*100`，5 日窗 `[1,2,3,4,5]` 之 `rsv=100`；`K[4]=(2/3)*50+(1/3)*100=200/3`；`D[4]=(2/3)*50+(1/3)*(200/3)=500/9`；`J[4]=3*(200/3)-2*(500/9)`——與斷言數值完全一致。
- **`runEntryFilter` GO fixture**：本覆核獨立以 `detectSwings(k=2)` 演算法逐 index 手算 16 根合成序列 `[100,103,106,109,112,110,108,106,109,112,115,118,116,114,117,121]`，得出轉折點 H@4(112)、L@7(106)、H@11(118)、L@13(114)，`classifyTrend`（頭頭高 118>112 且底底高 114>106）判定「多頭」——與測試/PLAN 推導鏈完全一致。續算 SOP 6 項（趨勢/均線/位置/量/K線/指標）全數為 `true`，`preceptHits=[]`，`entryPattern`（`isSidewaysBreakout` 逐 `s` 回溯確認無滿足橫盤突破的 box，故落入「回後買上漲」分支）、`confidence=90`（`round(6/6*80)+10`）、`stopPrice=114.95`（`121*0.95`）、`guardMaLabel/maGuardPrice`（預設 MA20=110、guardLevel='MA5' 時=116）——**全部逐項複算，與程式碼實際輸出及測試斷言三方一致，非虛設或湊數斷言**。
- WAIT／NO_GO 案例同樣手算複核（量比 1.0 使 `isAttackVol=false` 導致 SOP 5/6 且 `entryPattern='皆不符'`；20 根嚴格遞減序列因 fractal 演算法結構性質不會產生任何轉折點，`trend='資料不足'`直接觸發 NO_GO 分支）——與斷言吻合。
- 三個「發現但不修」的疑似 bug（`calculateRSI` 常數序列 NaN／diff=0 計入 gain／KDJ 註解與參數不符）記錄真實存在（本覆核讀碼確認 `utils/math.ts:59` 之 `0/0=NaN` 分支、`:52` 之 `diff>=0` 判準），且測試以黃金值鎖住現行行為、未擅自修改受測本體——符合「鎖行為不改行為」的紅線。
- `git diff HEAD~1 --stat`（對應 6ed7713）確認 `utils/math.ts`／`utils/entryFilter.ts` 零改動，僅新增兩個 `.test.ts` 檔＋`package.json`／`package-lock.json`。
- `d5d8f57` 修復必要性本次獨立重現：拿掉 `--exclude` 旗標後 `npx vitest run` 從 2 files/32 tests 變成 4 files/64 tests（`.claude/worktrees/agent-ad1b15075073b032b/utils/*.test.ts` 被重複收集執行），確認修復前確實存在問題、修復後確實解決（見上方 WR-01，對此修法本身的實作方式提出改進建議）。

### D-4
- `api/_lib/ratelimit.ts:8-12`（`upstashIsConfigured` 雙變數 AND 判定）、`:18-19`（`redis===null` 時 `createRateLimiter` 回 `null`）、`:68-69`（`enabledLimiters.length===0` 時 `checkRateLimit` 直接 `return true`）、`:78-81`（catch 區塊 `console.warn` 後 fail-open）——本覆核逐行讀碼核對，與 SUMMARY 描述的四個行為點完全一致。
- 純查證任務未改碼，`git status` 確認零程式碼變動；Production env 存在性查證依賴 orchestrator 本機 Vercel CLI 登入態（`npx vercel env ls production`），本覆核無法重現該項（需要使用者的 Vercel 帳號權限），視為已提供證據不重複驗證。

---

## 紅線核對（Phase D 共同驗收）

| 紅線 | 結果 |
|---|---|
| `GEMINI_API_KEY` 不在 bundle/git | 本次獨立 `npm run build && grep -r AIza dist/` → 0 結果 |
| 型別相容（`StockDataPoint` 等契約未動） | Phase D 七包均未觸碰 `types.ts`／領域型別；D-3 測試檔僅 import 既有型別，未新增/修改 interface |
| 依賴決策符合「已拍板決策」第 4 點（esm.sh importmap → Vite 單軌 bundle，2026-07-13 改判納入 Phase D） | D-1c 已完整執行，`dist/index.html` 0 esm.sh、CLAUDE.md/STACK.md 單軌敘述已同步 |
| `npx tsc --noEmit` | 本次獨立重跑：綠 |
| `npm run build`＋`grep -r AIza dist/` | 本次獨立重跑：綠／0 結果 |
| preview network 0 esm.sh＋0 cdn.tailwindcss.com | orchestrator 已提供瀏覽器實測證據（dev＋preview 皆 0/0），本覆核以 dist 靜態 grep 交叉驗證一致 |
| 逐頁視覺 smoke | orchestrator 已提供（三分頁渲染正常、自訂色/卷軸實測、console 無 Tailwind CDN 警告），本覆核不重複執行瀏覽器動作 |

---

## 需人工實跑驗證的項目（無法靜態驗證，Phase D 範圍內）

以下項目 orchestrator 已於 `<orchestrator_verified_evidence>` 提供瀏覽器實測證據，本覆核採信、不重複執行：

1. **D-1b/D-1c/D-1d 逐頁視覺回歸**（市場分析/我的庫存/基本面/AI modal/圖表 hover/拖曳/縮放/自訂卷軸/紅漲綠跌）——orchestrator 已實測通過。
2. **D-1d lazy 分頁切換無白屏**——orchestrator 已實測（首屏 4 chunk、切分頁載入且無白屏）。
3. **D-2 throw→fallback→reload→恢復完整鏈路**——orchestrator 已實測通過，Sidebar.tsx 驗畢乾淨無殘留。
4. **D-4 Production Upstash env 存在性**——orchestrator 已用 `npx vercel env ls production` 實查兩鍵存在（Encrypted，Preview＋Production）。

以下為本覆核建議但未強制要求的後續動作（不影響本次 ACCEPT 判定）：
5. **WR-01 修復**：將 `--exclude .claude/**` 移入 `vitest.config.ts`／`vite.config.ts` 的 `test.exclude` 陣列，消除 shell glob 解析的不確定性（建議下次 quick task 順手處理）。
6. **LO-01 清理**：擇期 `git worktree remove` 清除 `.claude/worktrees/` 下 3-4 個陳舊 agent worktree（已合併、無新事證需要保留）。

---

## Findings 處置附錄（orchestrator，2026-07-13 覆核後當場）

| Finding | 處置 | Commit |
|---|---|---|
| WR-01（vitest exclude 以 CLI flag 內嵌 glob） | **當場修**：`vite.config.ts` 加 `test.exclude = [...configDefaults.exclude, '**/.claude/**']`（`/// <reference types="vitest/config" />`），`package.json` test script 還原 `vitest run`；修後重跑 test（32/32）／tsc／build 全綠 | 6aa5735 |
| LO-01（`.claude/worktrees/` 陳舊複本衛生債） | **移交使用者**：使用者已指示 worktree 目錄由其手動刪除（agent 只做 prune/刪分支）；目前殘留 4 個目錄（a9d17da2da129c7a9／aa16b49ea040e932d／a288bba135519023c／ad1b15075073b032b），皆已合併＋detach，刪除後跑 `git worktree prune` 即可；另 dev watcher（f98aa56）與 vitest exclude（6aa5735）已讓殘留目錄不再影響工具鏈 | — |
| LO-02（ErrorBoundary root 級顆粒度） | **接受現狀**：符合 D-2 規格（index.tsx 包一層）；「per-tab boundary 細化」記為未來 UX 精修候選，不排程 | — |

---

_Reviewed: 2026-07-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep（含跨包驗證：七個工作包 PLAN/SUMMARY 全讀＋8 個 code commit 逐一 git show/git log 核對＋本機獨立重跑 tsc/build/test/grep AIza/vitest 無 exclude 重現，未僅信賴各包 SUMMARY 宣稱；D-1b 內聯設定遷移做位元對位元 diff；D-3 三測試檔斷言做獨立手算複核）_
