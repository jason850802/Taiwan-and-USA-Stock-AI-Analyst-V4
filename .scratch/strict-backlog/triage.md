# TypeScript strict 欠帳分流清單

盤點日期：2026-07-29  
執行命令：`npx.cmd tsc --noEmit --strict`（Windows 下使用 `.cmd` 入口執行使用者指定的命令）  
結果：**exit code 1，共 24 個錯誤、4 個檔案、4 種錯誤碼**。

本文件只整理現況與建議順序；本次未修改任何程式碼、`tsconfig.json` 或套件檔。這次結果也與 `docs/gate-audit-findings.md` 在 2026-07-26 記錄的 strict 基線（24 錯／4 檔）一致，未見數量漂移。

## 摘要

| 建議順序 | 檔案 | 錯誤數 | 占比 | 錯誤碼 | 分類 | 排序理由 |
|---:|---|---:|---:|---|---|---|
| 1 | `api/_lib/llm.ts` | 18 | 75.0% | TS18047 | Node child process 的 nullable stdio | 數量最大，集中在兩條 CLI 執行路徑，且屬後端 AI 呼叫基礎設施；修法若選錯可能改變錯誤處理與串流行為，應先單獨處理並加強驗證。 |
| 2 | `index.tsx` | 1 | 4.2% | TS7016 | 第三方模組型別宣告缺漏 | App 入口仍把 `react-dom/client` 視為 implicit `any`。屬型別基礎設施欠帳，未來修正預期會牽涉 `package.json`／`package-lock.json`，適合獨立一票。 |
| 3 | `services/yahoo.ts` | 4 | 16.7% | TS2345 | `null` 與 `undefined` 的資料契約不一致 | 均線暖身區本來就會產生 `null`；需要先明確決定「無資料」契約，避免只為過型別而悄悄改變方向判定。 |
| 4 | `components/fundamentals/QuarterlyTrendCharts.tsx` | 1 | 4.2% | TS2322 | Recharts callback 參數型別過窄 | 單一 UI adapter 問題、影響面最小，可在前三項穩定後獨立收尾。 |

> 24 個 compiler diagnostics 可收斂成 **4 個實際修復單元**，不建議逐行拆成 24 張票。

## 依錯誤類型分類

| 錯誤碼 | 錯誤數 | 涉及檔案 | 類型說明 |
|---|---:|---|---|
| TS18047 | 18 | `api/_lib/llm.ts` | `child.stdin`、`child.stdout`、`child.stderr` 可能為 `null`。 |
| TS2345 | 4 | `services/yahoo.ts` | `(number \| null)` 被傳給只接受 `(number \| undefined)` 的參數。 |
| TS7016 | 1 | `index.tsx` | 找不到 `react-dom/client` 的 declaration file，模組被視為 implicit `any`。 |
| TS2322 | 1 | `components/fundamentals/QuarterlyTrendCharts.tsx` | 自訂 formatter 只接受 `number \| null`，比 Recharts `LabelFormatter` 可能傳入的 `RenderableText` 更窄。 |

## 依檔案分類與處理建議

### 1. `api/_lib/llm.ts` — 18 個 TS18047

錯誤位置：

- Claude CLI 非串流路徑：252–254、270–273、289–290。
- Claude CLI 串流路徑：391–393、464–466、472、486–487。

共同原因：兩處都先以 `let child: ReturnType<typeof spawn>` 宣告，再讀寫三條 stdio。`ReturnType<typeof spawn>` 是可包含 nullable stdio 的廣泛型別，因此 TypeScript 無法從實際的 `spawn(...)` 呼叫推導出「三條 pipe 一定存在」。

建議修復票範圍：

- 將兩條 Claude CLI 路徑視為同一票，先定義 child process 的 stdio 契約。
- 在「精確型別／明確指定 pipe」與「執行期 guard」之間選擇能反映真實 invariant 的方案；不要分散加入 18 個非空斷言來消音。
- 保留既有 spawn 失敗、stdio stream error、timeout、close 收斂與串流解析語意。

主要風險：這不是單純 UI 型別問題。這些行位於 CLI process 啟動、輸入、輸出與錯誤處理路徑；修復後除 strict 檢查外，還應覆蓋非串流、串流、spawn 失敗與 timeout 行為。

### 2. `index.tsx` — 1 個 TS7016

錯誤位置：3。

共同原因：專案直接 import `react-dom/client`，但目前沒有可供 TypeScript 解析的 `@types/react-dom`。`package.json` 未直接宣告 `@types/react` 或 `@types/react-dom`；`package-lock.json` 雖有 transitive `@types/react`，沒有 `@types/react-dom`。

建議修復票範圍：

- 以 React 19 相容的官方型別套件補齊依賴，並把 React 相關型別依賴是否應直接宣告一次定清楚。
- 不建議用本地 `declare module 'react-dom/client'` 把整個模組降成 `any`，那只會隱藏入口型別。
- 這張票預期會合法地改到 `package.json` 與 `package-lock.json`；應與純程式碼修復分開，方便驗證套件 diff。

主要風險：修正型別套件後可能揭露目前被 implicit `any` 遮住的第二層錯誤，因此完成這張票後要立刻重跑 strict，重新量化剩餘數量。

### 3. `services/yahoo.ts` — 4 個 TS2345

錯誤位置：705–708（MA5、MA10、MA20、MA60 的方向判定）。

共同原因：`calculateSMA(...)` 明確回傳 `(number | null)[]`，其中 `null` 表示均線暖身期尚無值；局部函式 `getDir` 卻只接受 `number | undefined`。呼叫端的四組均線因此全部報同型錯誤。

建議修復票範圍：

- 先把 `null`／`undefined` 各自代表的資料狀態定清楚，再統一 `getDir` 與 `calculateSMA` 的契約。
- 維持暖身期方向為 `flat` 的既有行為，並覆蓋「current 無值」「prev 無值」「兩者都有值」三類測試。
- 四行應一次處理，不要為每條均線各建一票。

主要風險：若只做型別轉換而沒有保留無值語意，可能讓前幾筆 K 線的均線方向由 `flat` 變成錯誤的 `up`／`down`。

### 4. `components/fundamentals/QuarterlyTrendCharts.tsx` — 1 個 TS2322

錯誤位置：104。

共同原因：`LabelList.formatter` 的 library contract 是 `LabelFormatter`，輸入可為較廣的 `RenderableText`；目前 inline callback 把參數限制成 `number | null`，違反函式參數的反變性要求，且未涵蓋 `undefined`／非數字值。

建議修復票範圍：

- 讓 adapter 接受 Recharts 宣告的完整輸入範圍，再在函式內做數字 narrowing 與顯示格式化。
- 驗證 EPS 為正數、負數、0、`null`／`undefined` 時的 label 顯示，不要只以型別斷言繞過。

主要風險：低；範圍限於 EPS 圖表標籤，但需避免對非數字值呼叫 `toFixed`。

## 建議執行順序

1. **先處理 `api/_lib/llm.ts`**：一個共同契約可消除 18 個錯誤，且先隔離最高執行期風險。
2. **再補 `index.tsx` 的正式型別依賴**：建立可靠的 React DOM 型別基線，並確認是否揭露新錯誤。
3. **統一 `services/yahoo.ts` 的無值契約**：用測試鎖住均線暖身期語意後再改。
4. **最後修 `QuarterlyTrendCharts.tsx` adapter**：小範圍收尾。

若目標只是用最少票數清零，可維持上述 4 票；若要降低多人平行修改衝突，這 4 個檔案彼此獨立，也可平行處理，但 strict 的最終數量應由單一整合者重新盤點。

## 每票驗收基準

- 該票對應的錯誤群歸零，且沒有新增其他 strict diagnostics。
- 每票執行 `npx.cmd tsc --noEmit --strict --pretty false`。
- 涉及 `.ts`／`.tsx` 的票，同時執行專案最低 gate `npx.cmd tsc --noEmit`。
- 所有 4 票完成後，strict 命令應 exit code 0，再跑專案要求的完整測試與 build gate。
- 套件型別票應另外確認 `package.json`／`package-lock.json` 只出現預期的型別依賴變更；其餘票不應改動兩個套件檔。

## 原始診斷索引

| 檔案 | 行號 | 錯誤碼 | 訊息摘要 |
|---|---|---|---|
| `api/_lib/llm.ts` | 252, 253, 254, 270, 271, 272, 273, 289, 290, 391, 392, 393, 464, 465, 466, 472, 486, 487 | TS18047 | `child.stdin/stdout/stderr` is possibly `null` |
| `components/fundamentals/QuarterlyTrendCharts.tsx` | 104 | TS2322 | formatter 與 `LabelFormatter` 不相容 |
| `index.tsx` | 3 | TS7016 | 缺少 `react-dom/client` declaration file |
| `services/yahoo.ts` | 705, 706, 707, 708 | TS2345 | `number | null` 不能傳給 `number | undefined` |
