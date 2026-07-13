---
phase: quick-260713-nvg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [components/ErrorBoundary.tsx, index.tsx]
autonomous: true
requirements: [D-2]

must_haves:
  truths:
    - "任何子元件 render throw 不再整頁白屏，改顯示錯誤摘要＋「重新載入」鈕"
    - "「重新載入」鈕觸發 window.location.reload()，是 lazy chunk 載入失敗（D-1d 新失敗模式）的正確恢復動作"
    - "UI 只顯示 error.message 摘要；完整 error＋componentStack 走 console.error"
    - "fallback 關鍵樣式用 inline style，boundary 觸發時不依賴 CSS 健在"
  artifacts:
    - path: "components/ErrorBoundary.tsx"
      provides: "class ErrorBoundary（getDerivedStateFromError＋componentDidCatch）＋繁中 fallback UI"
      min_lines: 30
    - path: "index.tsx"
      provides: "<ErrorBoundary> 包住 <App/>（StrictMode 內層）"
      contains: "ErrorBoundary"
  key_links:
    - from: "index.tsx"
      to: "components/ErrorBoundary.tsx"
      via: "import ErrorBoundary from './components/ErrorBoundary'"
      pattern: "ErrorBoundary"
---

<objective>
D-2（Phase D 5/7）：index.tsx:11 直掛 `<App/>`——包一層可恢復 error boundary。任何 render throw（含 D-1d React.lazy 引入的新失敗模式：chunk 載入失敗以 render throw 呈現）不再整頁白屏，改顯示錯誤摘要＋「重新載入」鈕。

Purpose: D-1d 之後，網路斷線導致的 lazy chunk 載入失敗會直接 throw 到 root——目前沒有任何 boundary 接，使用者看到白屏且無法恢復。boundary 的 location.reload() 恰好是這個失敗模式的正確恢復動作（此動機寫進 SUMMARY）。
Output: `components/ErrorBoundary.tsx` 新檔＋`index.tsx` 兩行改動，1 個原子 commit。
</objective>

<context>
@./CLAUDE.md
@.planning/optimization/PLAN.md（「### D-2 React error boundary」章節，line 142-143）
@index.tsx（現行 16 行：D-1b 後首行 `import './index.css'`；line 7-9 有 root element 前置 throw；line 12-16 StrictMode 直掛 App）
@components/ui/Button.tsx（風格參考，但 fallback 不可 import 它——見 task 說明）
</context>

<coverage_audit>
| 來源 | 項目 | 覆蓋 |
|---|---|---|
| CONTEXT（optimization PLAN.md D-2） | index.tsx 包可恢復 fallback（錯誤摘要＋重新載入鈕），render throw 不白屏 | Task 1 COVERED |
| CONTEXT | 驗收「手動在子元件丟 throw 驗證 fallback、移除後正常」 | 分工至 orchestrator 合併後於 dev 環境執行（executor 無瀏覽器）——見 verification |

無 MISSING 項。
</coverage_audit>

<tasks>

<task type="auto">
  <name>Task 1: 建立 ErrorBoundary class 元件並包進 index.tsx 掛載樹</name>
  <files>components/ErrorBoundary.tsx, index.tsx</files>
  <action>
**Part A — 新檔 `components/ErrorBoundary.tsx`：**

建立 class component（全 codebase 唯一 class——合理例外：componentDidCatch／getDerivedStateFromError 沒有 hooks 等價物，在檔頭註解一行說明此例外原因）：

- `interface ErrorBoundaryProps { children: React.ReactNode }`、`interface ErrorBoundaryState { error: Error | null }`（interface 宣告在元件上方，依 CONVENTIONS）。
- `class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState>`，初始 state `{ error: null }`。
- `static getDerivedStateFromError(error: Error): ErrorBoundaryState` → 回傳 `{ error }`。
- `componentDidCatch(error, errorInfo)` → `console.error(...)` 輸出完整 error 與 `errorInfo.componentStack`（完整細節只進 console，不進 UI）。
- `render()`：`this.state.error` 為 null 時回傳 `this.props.children`；否則回傳 fallback UI。
- 檔尾 `export default ErrorBoundary`（依 CONVENTIONS export 慣例）。

**Fallback UI 規格（bulletproof 底線——boundary 觸發時不能假設 CSS/Tailwind 健在，關鍵樣式一律 inline style；Tailwind class 可疊加不可依賴；不可 import 任何專案元件如 Button，避免 fallback 自身再 throw）：**

- 外層 div：`minHeight: '100vh'`、深色底 `backgroundColor: '#0f172a'`（對齊 app slate 深色主題）、文字 `color: '#e2e8f0'`、flex 直向置中、適當 padding、`fontFamily: 'sans-serif'`。
- 標題（繁中）：「頁面發生錯誤」。
- 錯誤摘要：只顯示 `this.state.error.message` 一段文字（灰階次要色如 `#94a3b8`、`wordBreak: 'break-word'`）；**不 dump stack 到 UI**。
- 按鈕「重新載入」：`onClick={() => window.location.reload()}`，inline style 確保可見可點（如 `backgroundColor: '#2563eb'`、白字、padding、`borderRadius`、`border: 'none'`、`cursor: 'pointer'`）。

**Part B — 修改 `index.tsx`（兩行）：**

- 新增 `import ErrorBoundary from './components/ErrorBoundary';`（保持首行 `import './index.css'` 不動，D-1b 產物）。
- render 改為 `<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>`（boundary 放 StrictMode 內層、App 外層）。
- **不動** line 7-9 的 root element 前置 throw——它發生在 React render 之前，boundary 本來就接不到，不在 D-2 範圍。

**禁止事項：** 不在任何子元件插入測試用 throw（手動 throw 驗證是 orchestrator 合併後的工作，repo 不得留任何 throw 殘碼）。

**Commit（1 個原子 commit，僅此兩檔；SUMMARY 不 commit）：**
`feat(d-2): React error boundary——render throw 改顯示可恢復 fallback（錯誤摘要＋重新載入），不再白屏`
  </action>
  <verify>
    <automated>[ -d node_modules ] || npm ci; npx tsc --noEmit && npm run build && ! grep -rq "AIza" dist/ && grep -c "ErrorBoundary" index.tsx</automated>
  </verify>
  <done>tsc 零錯誤；`npm run build` 成功；`grep -r "AIza" dist/` 無結果；index.tsx 中 ErrorBoundary 出現 ≥2 次（import＋JSX 包裹）；repo 無任何臨時 throw 殘碼；單一 commit 含且僅含 components/ErrorBoundary.tsx 與 index.tsx。</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| runtime error → 使用者 UI | 例外訊息從程式內部流向畫面 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-D2-01 | Information Disclosure | ErrorBoundary fallback UI | mitigate | UI 只顯示 error.message 一行摘要；stack／componentStack 只進 console.error，不渲染到 DOM |
| T-D2-02 | Tampering (supply chain) | 無新依賴 | accept | 本包零 npm install，無供應鏈面 |
</threat_model>

<verification>
**Executor（無瀏覽器，全自動）：**
1. `npx tsc --noEmit` 零錯誤
2. `npm run build` 成功
3. `! grep -rq "AIza" dist/`（金鑰紅線）
4. `grep -rn "throw" components/ App.tsx` 目視確認無新增臨時 throw（既有業務 throw 不算）

**Orchestrator（合併後，dev 環境，executor 不做）：**
臨時在某子元件 render 插 `throw new Error('boundary test')` → 確認顯示繁中 fallback（錯誤摘要＋重新載入鈕，深色底可讀）→ 按「重新載入」恢復 → 移除 throw → 確認 app 正常。

**環境備忘：** worktree 無 node_modules 先 `npm ci`；Windows＋Git Bash（grep 用 Bash 工具跑，PowerShell 5.1 沒有 grep）。
</verification>

<success_criteria>
- components/ErrorBoundary.tsx 存在：class component、getDerivedStateFromError＋componentDidCatch、繁中 fallback（inline style 深色底＋error.message 摘要＋location.reload() 按鈕）
- index.tsx 的 <App/> 被 <ErrorBoundary> 包住（StrictMode 內層）
- tsc／build／grep AIza 三關全過
- 1 個原子 commit（兩檔），無 throw 殘碼，SUMMARY 未 commit
</success_criteria>

<output>
完成後建立 `.planning/quick/260713-nvg-d-2-react-error-boundary-index-tsx-fallb/260713-nvg-SUMMARY.md`（記載 D-1d lazy chunk 失敗模式與 boundary 的恢復動機；SUMMARY 不 commit）。
</output>
