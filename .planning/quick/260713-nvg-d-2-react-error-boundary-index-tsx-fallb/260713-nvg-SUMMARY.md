---
phase: quick-260713-nvg
plan: 01
subsystem: frontend-shell
tags: [error-boundary, react, resilience, d-2]
requires: [D-1d lazy chunks（React.lazy 失敗以 render throw 呈現）]
provides: [root-level recoverable error boundary]
affects: [index.tsx 掛載樹]
tech-stack:
  added: []
  patterns: [class component error boundary（全 codebase 唯一 class——componentDidCatch 無 hooks 等價物）, bulletproof inline-style fallback]
key-files:
  created: [components/ErrorBoundary.tsx]
  modified: [index.tsx]
key-decisions:
  - "fallback 全 inline style、零專案元件 import：boundary 觸發時不能假設 CSS/Tailwind 健在，也避免 fallback 自身再 throw"
  - "UI 只顯示 error.message 一行摘要；完整 error＋componentStack 只進 console.error（T-D2-01 資訊洩漏緩解）"
  - "恢復動作採 window.location.reload()：對 D-1d lazy chunk 載入失敗是正確恢復（重抓 chunk）"
metrics:
  duration: ~12min
  completed: 2026-07-13
  tasks: 1/1
  commit: d06bcb2
---

# Quick 260713-nvg: D-2 React Error Boundary Summary

**One-liner:** Root 級可恢復 error boundary（class component＋繁中 inline-style fallback＋location.reload()），接住含 D-1d lazy chunk 載入失敗在內的所有 render throw，白屏改為錯誤摘要＋重新載入鈕。

## 動機（D-1d 失敗模式）

D-1d 引入 `React.lazy` code-splitting 後，網路斷線／部署換版導致的 lazy chunk 載入失敗會以 render throw 直接打到 root——先前沒有任何 boundary 接，使用者看到整頁白屏且無法恢復。boundary 的「重新載入」鈕觸發 `window.location.reload()`，恰好是這個失敗模式的正確恢復動作：整頁重載會重新請求 chunk（斷線恢復後）或載入新版部署的 chunk 檔名。

## 實作

- `components/ErrorBoundary.tsx`（78 行）：class component，`static getDerivedStateFromError` 設 `{ error }` state；`componentDidCatch` 把完整 error＋`errorInfo.componentStack` 送 `console.error`（不進 UI）。
- Fallback UI：全 inline style（`minHeight:100vh`、深色底 `#0f172a` 對齊 slate 主題、文字 `#e2e8f0`）；標題「頁面發生錯誤」；`error.message` 摘要（`#94a3b8`＋`wordBreak:break-word`）；「重新載入」鈕（`#2563eb` 藍底白字、`onClick={() => window.location.reload()}`）。不 import 任何專案元件（含 Button），避免 fallback 自身 throw。
- `index.tsx`：新增 import＋`<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>`。line 7-9 的 root element 前置 throw 不動（發生在 React render 之前，boundary 接不到，不在 D-2 範圍）。

## Verification

| 檢查 | 結果 |
|---|---|
| `npx tsc --noEmit` | PASS（零錯誤） |
| `npm run build` | PASS（✓ built in 4.67s） |
| `grep -r "AIza" dist/` | 無結果（金鑰紅線通過） |
| `grep -c "ErrorBoundary" index.tsx` | 3（import＋開閉 JSX 標籤） |
| throw 殘碼掃描 | 無新增臨時 throw（僅既有 root element 前置 throw＋註解字樣） |

## Deviations from Plan

None - plan executed exactly as written.

## 待 Orchestrator（合併後 dev 環境）

臨時在某子元件 render 插 `throw new Error('boundary test')` → 確認繁中 fallback 顯示 → 按「重新載入」→ 移除 throw → 確認 app 正常。（executor 無瀏覽器，依 PLAN 分工不在本包範圍。）

## Self-Check: PASSED

- components/ErrorBoundary.tsx 存在 ✓
- index.tsx 含 ErrorBoundary ✓
- commit d06bcb2 存在且僅含兩檔 ✓
