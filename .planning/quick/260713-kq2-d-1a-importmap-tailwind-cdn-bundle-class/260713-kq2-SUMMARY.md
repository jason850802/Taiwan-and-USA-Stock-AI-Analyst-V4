---
phase: quick-260713-kq2
plan: 01
subsystem: infra
tags: [tailwind, vite, importmap, esm.sh, bundle, code-splitting, purge]

# Dependency graph
requires:
  - phase: optimization Phase A/B/C
    provides: 現行 main（76e0b33）的 bundle 形態與 index.html 結構
provides:
  - D-1 依賴單軌化的 before 基線（bundle／twCDN／esm.sh 請求數）
  - importmap 活死判定（雙環境休眠死重，D-1c 純刪除綠燈）
  - 51 行模板字串 className 全量分類（危險=0）＋非模板動態模式 5 類掃描（全 0 命中）
  - D-1b content globs 與 safelist 建議、D-1d -40% 基線錨點
affects: [D-1b, D-1c, D-1d, optimization/PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/quick/260713-kq2-d-1a-importmap-tailwind-cdn-bundle-class/260713-kq2-SUMMARY.md
  modified: []

key-decisions:
  - "importmap 判定為雙環境休眠死重：D-1c 移除是行為中性純刪除"
  - "purge 風險母體修正為 51 行（160 為 worktree 複本汙染值），危險動態類名 0 條，D-1b 無需 safelist"
  - "D-1b content globs：'./index.html'、'./*.{ts,tsx}'、'./components/**/*.{ts,tsx}'，絕不含 .claude/**"

patterns-established:
  - "動態 className 一律用完整字面量映射（variant→class lookup），本 codebase 已全面遵循"

requirements-completed: [D-1a]

# Metrics
duration: 20min
completed: 2026-07-13
---

# Quick 260713-kq2: D-1a 基線量測與風險稽核 Summary

**importmap 雙環境休眠（死重）判定成立＋51 行模板字串 className 全量稽核零危險——D-1b 可零 safelist 動工、D-1c 純刪除綠燈、D-1d 錨點 967.60 kB raw／294.26 kB gzip**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-13
- **Tasks:** 2/2
- **Files modified:** 1（本 SUMMARY，唯一產出；零程式碼變動、零 commit）

## 1. Before 基線（orchestrator 2026-07-13 量測，main 76e0b33）

以下 7 點由 orchestrator 於 2026-07-13 在 main（76e0b33）量測，executor 照錄不重測：

1. **dev**（vercel dev @3001，Vite 6.4.3）：esm.sh 請求 **0**（importmap 休眠——Vite 把裸模組改寫為 /node_modules/.vite/deps/*，53 個資源全 localhost）；cdn.tailwindcss.com **1 請求（活）**；console 官方警告「cdn.tailwindcss.com should not be used in production」×6；Google Fonts css2 1 請求。
2. **prod**（npm run build → vite preview @4310）：esm.sh 請求 **0**（但 dist/index.html 內 importmap 區塊原樣存在——grep "esm.sh" 6 處、DOM 有 script[type=importmap] tag，0 fetch＝確認休眠死重）；cdn.tailwindcss.com 1 請求（活）；本地 assets 僅單一 chunk。
3. **bundle 基線**：dist/assets/index-QCyy2Nmt.js = **967.60 kB raw / 294.26 kB gzip**（07-12 記錄 954KB，經 Phase B/C 增長）；dist/index.html 2.44 kB / 1.01 kB gzip；2563 modules transformed、build 8.81s；Vite 出 >500kB chunk 警告。
4. **cdn.tailwindcss.com script 實測**：407,279 bytes raw / **123,343 bytes gzip**（每次頁面載入的執行時 JIT 引擎）。
5. **首屏 JS gzip 合計**：294.26（app）＋123.34（twCDN）≈ **417.6 kB**（另有 Google Fonts CSS）。
6. **模板字串 className grep**：`grep -rn 'className={\`' --include='*.tsx' --include='*.ts'`（排除 node_modules/dist）= **160 行**（本稽核分解為 51 真源＋109 worktree 複本，見第 3 節）。
7. vite preview 無後端故 /api 失敗（「找不到台股代號」）屬預期，不影響樣式／模組載入量測；UI 樣式正常渲染（Tailwind CDN 生效中）。

## 2. importmap 活死判定：雙環境休眠（死）

**結論：死重。** 證據鏈：

- **dev**：Vite 對裸模組匯入做預打包改寫（`/node_modules/.vite/deps/*`），瀏覽器根本不經 importmap 解析——esm.sh 請求 0。
- **prod**：Rollup 打包後所有依賴已內聯進單一 chunk，無裸模組 import 殘留——esm.sh 請求 0；但 `dist/index.html` 仍原樣攜帶 importmap 區塊（grep esm.sh 6 處、DOM 存在 `script[type=importmap]` tag），純屬無人消費的死標記。

**風險定性**：(1) 供應鏈死重——esm.sh URL 若在任何降級路徑被啟用，等於引入未經 lockfile 鎖定的第三方 CDN 執行碼；(2) 版本漂移——importmap 內 `^` 範圍由 esm.sh 於請求時解析 semver，與 package-lock.json 的鎖定版本可能分歧；(3) 誤導維護者——「依賴要同時維護兩處」的心智負擔完全是為一段死程式碼服務。

**D-1c 綠燈**：移除 importmap 區塊為**行為中性純刪除**（雙環境皆無消費者）。驗收標準：`dist/index.html` 無 esm.sh 字樣＋preview network 0 個 esm.sh 請求。

## 3. 稽核範圍修正（160 → 51）

**orchestrator「PLAN.md 約 51 處已過時」的判讀有誤——optimization/PLAN.md 的 51 仍準確；purge 風險母體＝51。**

executor 實測（2026-07-13，於 c9e4c54 checkout）分解證據：

| 母體 | 行數 | 說明 |
|---|---|---|
| grep 全 repo 總計 | 211 | ＝160（orchestrator 量測時點）＋51（本任務自身 worktree `agent-a945bc49a2af701df` 於量測後才建立，依交辦排除不計） |
| `.claude/worktrees/` 陳舊複本 | **109** | 分布於 3 個已合併的舊 agent worktree：`agent-a877463db24593c02`（9）、`agent-a8f07dc74072b4406`（50）、`agent-ae93e30034fed55bc`（50） |
| **建置參與真源** | **51** | App.tsx＋components/**，14 檔，與 optimization/PLAN.md「約 51 處」一致 |

**worktree 109 行整塊處置**：其 basename 檔名集合＝{App, Badge, Banner, Button, Card, ChartToolbar, EntryChecklist, Modal, Portfolio, Sidebar, Skeleton, StatCard, StockChart, StockSearch}.tsx——**恰為真源 14 檔的子集（實為同集合），無 worktree 獨有檔案**。這些複本不在 Vite 建置圖（建置入口：根 index.html → index.tsx → App.tsx → components/），永遠不會進 Tailwind content globs，**無 purge 風險**，不需逐行分類。附帶建議：`.claude/worktrees/` 下 3 個陳舊 worktree 可擇期以 `git worktree remove` 清理（非本包範圍）。

後續 Phase D 文件請引用 **51**，不要再引用被 worktree 複本汙染的 160。

## 4. 動態 className 稽核結果（51 行逐行分類）

**分類統計：安全 (a) = 51／危險 (b) = 0，總計 51。**

**0 條危險——全部 51 行為純字面量、完整字面量條件切換、或可靜態追溯至同檔完整字面量（映射物件／常數／字面量 prop），D-1b 無需 safelist。** 逐檔依據：

| 檔案 | 行號 | 分類依據 |
|---|---|---|
| App.tsx | 246, 258, 278, 287 | 三元切換，各分支皆完整字面量（`'border-accent bg-accent/10 text-white'` 等） |
| components/Portfolio.tsx | 117, 121, 203, 342, 474, 479, 485, 618, 656, 1246, 1251, 1267, 1272, 1286, 1291 | 三元切換完整字面量（含 `'text-up/70'`／`'text-down/70'` 亦為完整 token） |
| components/Portfolio.tsx | 96 | `${cls}`＝EditableCell prop：預設 `'text-slate-200'`（:83），9 個呼叫端全傳同檔完整字面量（`'text-amber-300'` :336/:637/:645、`'text-up'` :350/:666、`'text-accent'` :354/:670、`'text-slate-400'` :358） |
| components/Portfolio.tsx | 1447 | `${inputCls}`＝同檔常數（:1129），完整字面量長字串 |
| components/ChartToolbar.tsx | 60, 76, 125, 144, 145, 158 | 三元切換完整字面量 |
| components/ChartToolbar.tsx | 67 | 反引號內零插值（`` `w-2 h-2 rounded-full` ``），純字面量 |
| components/StockChart.tsx | 255 | `${dirColor}`←:250 三元，值域 {'text-up','text-down','text-slate-500'} 全字面量 |
| components/StockChart.tsx | 296 | `${changeColor}`←:277 三元，值域 {'text-up','text-down','text-slate-400'} 全字面量 |
| components/StockChart.tsx | 918 | `group${isDragging ? ' pointer-events-none' : ''}`——邊界案例，見下方邊界例 1 |
| components/StockChart.tsx | 948, 1011 | 三元切換完整字面量（:948 的 `h-[450px]`／`max-md:h-[320px]` 任意值為字面量，建置期可抽取） |
| components/EntryChecklist.tsx | 33, 37, 41, 88 | `${m.ring}`/`${m.chip}`/`${m.text}`/`${dm.cls}`←同檔 statusMeta（:5-9）／decisionMeta（:11-15）映射物件，映射值全為完整字面量 |
| components/Sidebar.tsx | 25, 35, 45 | 三元切換完整字面量 |
| components/StockSearch.tsx | 128 | 三元切換完整字面量 |
| components/StockSearch.tsx | 133 | `${b.cls}`←同檔 marketBadge 映射（:13-16），值全字面量 |
| components/ui/Skeleton.tsx | 14, 25 | 字面量＋`${className}` prop 透傳（呼叫端傳值均為字面量，見邊界例 5） |
| components/ui/Skeleton.tsx | 18 | `${lineWidths[index % ...]}`←同檔字面量陣列（:9），見邊界例 4 |
| components/ui/StatCard.tsx | 20 | `${toneClasses[tone]}`←同檔映射（:10-15），值全字面量 |
| components/ui/Modal.tsx | 51 | `${maxWidth}` prop：預設 `'max-w-2xl'`，見邊界例 3 |
| components/ui/Card.tsx | 11 | 字面量＋`${className}` prop 透傳 |
| components/ui/Button.tsx | 38 | `${variantClasses[variant]} ${sizeClasses[size]} ${className}`←同檔兩映射（:13-23）值全字面量＋prop 透傳 |
| components/ui/Banner.tsx | 18 | `${variantClasses[variant]}`←同檔映射（:12-15），值全字面量 |
| components/ui/Badge.tsx | 19 | `${variantClasses[variant]}`←同檔映射（:8-16），值全字面量 |

20 行跨行模板（Sidebar ×3、App ×4、ChartToolbar :60/:76/:125、StockChart :1011、Portfolio :96/:474/:479/:1246/:1251/:1267/:1272/:1286/:1291/:1447）均已讀取完整表達式至閉合反引號，無單行 grep 盲區遺漏。

### 最接近邊界的 5 例（供 D-1b 覆核）

1. **StockChart.tsx:918** `` `...relative group${isDragging ? ' pointer-events-none' : ''}` ``——唯一「`${` 緊貼 token 字元」的行。安全依據：三元分支為 `' pointer-events-none'`（帶前導空格）或 `''`，執行時 `group` 恆為完整 token；且 Tailwind 掃描器以非類名字元（`$`、`{`）切分候選字串，源碼文字中 `group` 與 `'pointer-events-none'` 皆為可抽取的完整字面量。**D-1b 衛生建議**（非必要）：改寫為 `` `...relative group ${isDragging ? 'pointer-events-none' : ''}` ``（空格移出三元），消除視覺歧義。
2. **Portfolio.tsx:96** `${cls}` 跨元件邊界——安全依據：全部 9 個呼叫端與預設值皆為同檔完整字面量（上表列點），文字位於 content glob 涵蓋檔案內即可被抽取。
3. **ui/Modal.tsx:51** `${maxWidth}` 跨元件邊界——安全依據：預設 `'max-w-2xl'`（同檔）＋全部 4 個呼叫端字面量：App.tsx:237 `"max-w-md"`、Portfolio.tsx:1220 `"max-w-md"`、:1476 `"max-w-sm"`、:1507 `"max-w-3xl"`，均在 globs 涵蓋檔內。
4. **ui/Skeleton.tsx:18** `${lineWidths[index % lineWidths.length]}`——索引為 runtime 計算，但值域＝同檔字面量陣列 `['w-[92%]', 'w-full', 'w-[84%]', 'w-[70%]']`（:9），任意值類名以完整字面量存在於被掃描檔案，JIT 建置期可抽取。
5. **ui/\* `${className}` prop 透傳**（Skeleton :14/:25、Card :11、Button :38、Modal 隱含）——安全依據：已全量掃描呼叫端傳給 ui 元件的 `className=` 值，非字面量者皆為「完整字面量三元／映射／同檔常數」（如 StockSearch.tsx:158 傳 `"flex items-center justify-center min-w-[80px]"` 字面量）。呼叫端若未來傳動態組字串，該呼叫端行才是風險點——D-1b 驗收時以視覺回歸兜底。

### 非模板動態模式 5 類掃描（範圍：App.tsx＋components/**）

1. **字串串接**（`className={'`／`className={...+...}`）：已掃、**0 命中**。
2. **陣列組類**（`join(' ')`）：已掃、**0 命中**。
3. **clsx/classnames**：package.json 0 命中、import 0 命中——未使用此類依賴。
4. **helper 回傳 class 字串**（`=>`／`return` 直接回傳 `'text-|bg-|border-|ring-'` 開頭字串）：已掃、**0 命中**。變數形式（`const x = cond ? 'text-up' : ...`）另行追溯：StockChart.tsx :152 `colorClass`、:269-271 `priceColor`、:250 `dirColor`、:277 `changeColor`、Portfolio.tsx :1129 `inputCls`——值域全為完整字面量，安全。
5. **index.html `class=` 屬性**：已掃、**0 命中**（樣式走內聯 style＋內聯 tailwind.config，無 class 屬性）。

附帶掃描（超出計畫最低要求）：`className={變數/運算式}`（非模板字串形式）共 23 處——全為完整字面量三元／映射／同檔常數（含未在 51 行母體的 QuoteHeader.tsx `'animate-spin'`/`'animate-pulse'`、fundamentals/MonthlyRevenueChart.tsx 三元字面量），無危險項；且這些檔案皆在 `components/**` glob 涵蓋範圍內。

## 5. className 檔案分布（14 檔）＋ D-1b content globs 建議

| 檔案 | 行數 |
|---|---|
| components/Portfolio.tsx | 17 |
| components/ChartToolbar.tsx | 7 |
| components/StockChart.tsx | 5 |
| components/EntryChecklist.tsx | 4 |
| App.tsx | 4 |
| components/ui/Skeleton.tsx | 3 |
| components/Sidebar.tsx | 3 |
| components/StockSearch.tsx | 2 |
| components/ui/StatCard.tsx、Modal.tsx、Card.tsx、Button.tsx、Banner.tsx、Badge.tsx | 各 1 |
| **合計** | **51** |

**D-1b content globs 建議**（tailwind.config.js）：

```js
content: [
  './index.html',
  './*.{ts,tsx}',            // 涵蓋 App.tsx、index.tsx
  './components/**/*.{ts,tsx}',
]
```

- 實測 51 行全落在 `App.tsx`＋`components/**`；`services/`、`utils/`、`types.ts`、`index.tsx` 零 Tailwind class 字串（grep 引號內 `text-|bg-|border-` 無結果）——納入 glob 無害但非必要，上列 `'./*.{ts,tsx}'` 已順帶涵蓋根層。
- **絕不含 `.claude/**`**——否則 109 行陳舊 worktree 複本會把已刪類名重新餵給 purge，且 worktree 目錄動態增減會讓建置不可重現。

## 6. D-1b / D-1c / D-1d 行動建議

### D-1b（Tailwind 改建置期）
- **content globs**：如第 5 節。**safelist：不需要**（危險項 0 條，無任何建置期抽不到的類名）。
- **內聯 config 遷移對象**（index.html:8-30 → tailwind.config.js `theme.extend` 逐鍵照搬）：`colors`（surface{DEFAULT,card,inset,line}、accent{DEFAULT,hover}、ai、up{DEFAULT,muted}、down{DEFAULT,muted}、ok{DEFAULT,muted}、danger{DEFAULT,muted}、warn）、`fontFamily`（sans: Inter/Noto Sans TC、mono: JetBrains Mono）、`borderRadius`（ctl 0.5rem／card 0.75rem／modal 1rem）。另 index.html:32-53 內聯 `<style>`（body 底色字體＋自訂卷軸）遷入 index.css。
- **預期收益**：twCDN **123,343 B gzip**（407,279 B raw）的執行時 JIT 引擎 → 建置期靜態 CSS；量測項改為「新產出 CSS 檔的 raw/gzip 大小」，並消除 console 警告 ×6 與 CDN 單點故障。

### D-1c（importmap 移除）
- 判定依據：第 2 節（雙環境 0 esm.sh 請求＝休眠死重，純刪除行為中性）。
- 文件同步對象：`CLAUDE.md`「依賴要同時維護兩處：package.json 與 index.html 的 esm.sh importmap」關鍵事實改為單軌敘述；`.planning/codebase/STACK.md` 如有 importmap 敘述一併更新。
- 驗收：dist/index.html 無 esm.sh 字樣（現為 6 處）＋preview network 0 esm.sh 請求＋App 全功能 smoke。

### D-1d（分包）
- **-40% 目標錨點**：主 chunk **967.60 kB raw / 294.26 kB gzip**（dist/assets/index-QCyy2Nmt.js，2563 modules）。達標線：raw ≤ 580.56 kB 或以 gzip ≤ 176.56 kB 對照（以 PLAN 驗收口徑為準）。
- **manualChunks 三分建議**（vite.config.ts `build.rollupOptions.output.manualChunks`）：`react`+`react-dom`（vendor）／`recharts`（最大宗）／`react-markdown`+`remark-gfm`（僅 AI 報告用）。
- 選配（量測後再決定）：`React.lazy` 懶載 Portfolio／FundamentalsPanel（非首屏分頁）。
- 首屏 gzip JS 總量的 before 對照值：≈417.6 kB（含 twCDN；D-1b 完成後此項會先行下降）。

## Decisions Made

- importmap 判定為雙環境休眠死重，D-1c 走純刪除路線（無需保留降級路徑）。
- purge 風險母體確立為 51（160 為汙染值），後續 Phase D 文件一律引用 51。
- 危險動態類名 0 條 → D-1b 免 safelist；唯一衛生建議為 StockChart.tsx:918 空格移位（非阻塞）。

## 7. 偏差記錄（Deviations from Plan）

1. **grep 總數 211 ≠ 計畫預期 160**：本任務自身的 agent worktree（`agent-a945bc49a2af701df`，於 orchestrator 量測後建立）額外貢獻 51 行複本。依交辦排除自身 worktree 後＝160，分解 51＋109 與計畫完全吻合——非 main 有新 commit，稽核結論不受影響。
2. **executor 未重測網路／未 build**（by design）：基線 7 點由 orchestrator 代測照錄。
3. 本包零程式碼變動、零 git commit（SUMMARY 由 orchestrator 統一收尾提交）。

## Issues Encountered

- Worktree 首次 git 操作遇 `dubious ownership`（exFAT/無 ownership 檔案系統），以 `git config --global --add safe.directory` 解除；worktree HEAD 落後基準 commit，以 `git merge --ff-only c9e4c54` 前滾（黑名單禁 reset --hard，未使用）。

## Next Phase Readiness

- **D-1b**：可直接動工——globs＋config 遷移清單＋零 safelist 皆備，驗收聚焦視覺回歸。
- **D-1c**：綠燈已給，驗收標準明確。
- **D-1d**：基線錨點與 manualChunks 三分建議已備。
- **D-1e**：Google Fonts 保留 CDN（PLAN 既定決策，本包無新事證推翻）。

---
*Phase: quick-260713-kq2*
*Completed: 2026-07-13*
