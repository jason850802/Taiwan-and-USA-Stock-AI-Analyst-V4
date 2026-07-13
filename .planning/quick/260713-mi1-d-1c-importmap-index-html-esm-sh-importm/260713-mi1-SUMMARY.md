---
phase: quick-260713-mi1
plan: 01
subsystem: build-toolchain
tags: [importmap, esm.sh, vite, dependencies, docs, supply-chain]
requires: [D-1a（休眠死重判定）, D-1b（lockfile 修復＋build-time Tailwind）]
provides:
  - "index.html 純淨入口：無 importmap/esm.sh，僅 meta/title/fonts link/root div/index.tsx module script"
  - "依賴單軌：package.json＋package-lock.json 為唯一依賴來源，Vite 從 node_modules 解析"
  - "CLAUDE.md／STACK.md 單軌敘述，無殘留雙軌／CDN 模組載入描述"
affects: [D-1d, D-1e, Phase-D 收尾驗證]
tech-stack:
  added: []
  patterns: ["依賴單軌化：唯一來源 package.json＋lockfile，入口 HTML 零模組 CDN"]
key-files:
  created: []
  modified:
    - index.html
    - CLAUDE.md
    - .planning/codebase/STACK.md
key-decisions:
  - "importmap 整塊純刪除、不留降級路徑（D-1a 已證實雙環境 0 esm.sh 請求＝行為中性）"
  - "STACK.md 的 D-1b 遺留 Tailwind CDN 敘述順手改正為建置期敘述（planning context 預授權偏差）"
duration: ~12min
completed: 2026-07-13
---

# Quick Task 260713-mi1: D-1c importmap 移除＋依賴文件單軌化 Summary

刪除 index.html 休眠 esm.sh importmap（六個映射整塊），CLAUDE.md／STACK.md 依賴敘述單軌化為 package.json＋package-lock.json，npm ci＋vite build 全綠證實 Vite 自 node_modules 解析五件套無虞。

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | 刪 index.html importmap 區塊＋npm ci／build 驗證 | e6e4140 | index.html |
| 2 | CLAUDE.md＋STACK.md 單軌化＋tsc＋原子 commit | e6e4140 | CLAUDE.md, .planning/codebase/STACK.md |

（依 PLAN 規格收斂為 1 個原子 commit。）

## Changes

**index.html（-12 行）**：刪除第 8-19 行 `<script type="importmap">` 整塊（react-markdown／recharts／lucide-react／react-dom/／react/／react 六個 esm.sh 映射）。Google Fonts link、root div、`/index.tsx` module script 一字未動；git diff 僅一個刪除 hunk。

**CLAUDE.md（1 行改寫）**：「本專案關鍵事實」的雙軌條目改為：「依賴單軌：只維護 `package.json`＋`package-lock.json`（index.html 的 esm.sh importmap 已移除，Vite 從 node_modules 解析）。」

**STACK.md（4 處定點＋文末註記）**：
1. Runtime > Browser runtime：改為 Vite 打包進 bundle，不依賴 CDN 載入模組。
2. Styling 小節：標題「(not in package.json)」移除；改為建置期 Tailwind v3（tailwindcss ^3.4.19＋postcss ^8.5.18＋autoprefixer ^10.5.2，tailwind.config.js＋index.css）；Google Fonts 保留（D-1e 既定決策）。
3. Configuration > index.html：改為純淨入口敘述；順手刪除誤列的 @google/genai importmap 描述與「/index.css no such file」過時猜測。
4. Production：第三方 CDN 清單移除 esm.sh／cdn.tailwindcss.com，僅剩 Google Fonts＋public CORS proxies。
5. 文末補 `*Updated 2026-07-13: D-1b build-time Tailwind + D-1c importmap removal（依賴單軌化）*`。

## Verification Results

| # | 驗證 | 結果 |
|---|------|------|
| 1 | `npm ci`（worktree 乾淨安裝，D-1b lockfile 修復後首驗） | 退出碼 0，package-lock.json 零 diff |
| 2 | `npm run build` | 退出碼 0（2635 modules，dist 產出正常） |
| 3 | `tsc --noEmit` | 退出碼 0 |
| 4 | index.html／dist/index.html grep esm.sh＋importmap | 均 0（before 基線 dist 6 處） |
| 5 | `grep -r "AIza" dist/` | 無結果（金鑰紅線守住） |
| 6 | CLAUDE.md 無「依賴要同時維護兩處」、含 package-lock.json；STACK.md 全檔無 esm.sh／cdn.tailwindcss.com | 通過 |
| 7 | 入口 module script `src="/index.tsx"` 計數 | = 1（完好） |

未在本包範圍（orchestrator 合併後驗）：preview network 0 esm.sh 請求＋App 全功能 smoke。

## Deviations from Plan

### Auto-fixed Issues

**1. [預授權偏差] STACK.md D-1b 遺留 Tailwind CDN 敘述改正**
- **Found during:** Task 2
- **Issue:** STACK.md line 52／88 仍描述 Play CDN（cdn.tailwindcss.com），與 D-1b 後實況（建置期 Tailwind v3）不符
- **Fix:** 依 package.json devDependencies 實際版本改寫為建置期敘述（PLAN key_facts 已預授權，非臨場偏差）
- **Files modified:** .planning/codebase/STACK.md
- **Commit:** e6e4140

其餘 plan executed exactly as written。

備註（非偏差）：npm ci 出現 2 個 allow-scripts 警示（esbuild、protobufjs postinstall 未列入 allowScripts 白名單），不影響本次 build（vite build 全綠）；屬既有環境設定，未動。

## Known Stubs

None——本包為刪除＋文件更新，無新增元件或資料流。

## Threat Flags

None——本包縮減供應鏈面（移除 browser→esm.sh 潛在載入路徑），未新增任何安全面。

## Self-Check: PASSED

- index.html／CLAUDE.md／.planning/codebase/STACK.md 三檔存在且已修改 — FOUND
- Commit e6e4140 存在，恰含上列三檔 — FOUND
- 工作樹除本 SUMMARY 外乾淨 — 確認
