---
phase: quick-260713-len
plan: 01
subsystem: build-pipeline
tags: [tailwind, postcss, vite, purge, phase-d]
requires: [D-1a]
provides: [D-1b]
affects: [D-1c, D-1e]
tech-stack:
  added: [tailwindcss@3.4.19, postcss@8.5.18, autoprefixer@10.5.2]
  patterns: [build-time CSS extraction, ESM config files]
key-files:
  created: [tailwind.config.js, postcss.config.js, index.css]
  modified: [index.html, index.tsx, package.json, package-lock.json]
key-decisions:
  - "ESM export default 直接可用（Tailwind jiti＋Vite 6 postcss-load-config），無需 .cjs fallback"
  - "package-lock.json 與 package.json 脫鉤（缺 @upstash 兩件），npm ci 失敗改 npm install 同步（Rule 3）"
duration: ~12min
completed: 2026-07-13
---

# Quick 260713-len: D-1b Tailwind 改建置期 Summary

**One-liner:** Play CDN（123KB gzip 執行時 JIT）改為 tailwindcss v3.4.19 建置期靜態 CSS——26.7KB raw／5.5KB gzip，內聯 config 逐鍵遷 tailwind.config.js、內聯 style 遷 index.css，importmap 與 Google Fonts 原封。

## Commit

- `24a8135` feat(phase-d): D-1b Tailwind 改建置期（7 檔原子 commit：tailwind.config.js、postcss.config.js、index.css、index.html、index.tsx、package.json、package-lock.json）

## Tasks

| Task | 內容 | 結果 |
|---|---|---|
| 1 | 裝依賴＋建三新檔 | tailwindcss@3.4.19（主版本 3 驗證過）；config 三條 content globs＋colors 8 組／fontFamily 2 鍵／borderRadius 3 鍵逐鍵照搬；index.css＝三指令＋原內聯 style 原樣 |
| 2 | index.html 摘三件＋index.tsx 掛 CSS | Play CDN script／內聯 config／內聯 style 已刪；Google Fonts link 與 importmap 一字未動；index.tsx 首行 `import './index.css'` |
| 3 | 建置驗證＋purge 抽查＋commit | 全綠（見下） |

## Verification Results

- `npx tsc --noEmit`：綠
- `npm run build`：綠（6.98s）
- **CSS asset**：`dist/assets/index-BfaPHelp.css` = **26,737 B raw / 5,500 B gzip**（取代 twCDN 407,279 B raw / 123,343 B gzip → 淨省 ~117.8KB gzip 首屏）
- **主 chunk JS**：958,716 B raw / 291,760 B gzip（D-1a 基線 967.60KB raw；差 ~9KB 來自 lockfile 重新解析後的依賴版本，非本包程式碼改動）
- **dist/index.html**：cdn.tailwindcss.com **0**、esm.sh **6**（importmap 原封）、fonts.googleapis.com **1**
- **`grep -r AIza dist/`**：無結果（金鑰紅線通過）

## Purge 抽查（12/12 命中）

bg-surface / text-up / text-down / rounded-card / rounded-ctl / max-w-2xl / pointer-events-none / animate-spin / `w-\[92\%\]` / `h-\[450px\]` / `::-webkit-scrollbar` / 色值 `f0405a` — 全部命中 dist CSS。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm ci 失敗：基底 lockfile 與 package.json 脫鉤**
- **Found during:** Task 1 步驟 1
- **Issue:** package-lock.json 缺 `@upstash/ratelimit@2.0.8`、`@upstash/redis@1.38.0`（及傳遞依賴），`npm ci` 直接 EUSAGE 失敗——此為基底 commit 既有問題，非本包造成
- **Fix:** 改用 `npm install` 同步 lockfile 後再裝 tailwind 三件；lockfile 的 @upstash 補登隨本包 commit 一併入庫（package-lock.json 本就在 7 檔清單內）
- **Commit:** 24a8135

**（未觸發）** ESM config fallback：`export default` 的 tailwind.config.js／postcss.config.js 在 Vite 6 build 下直接可用，無需改 .cjs。

## Known Stubs

None.

## Threat Flags

None——移除 cdn.tailwindcss.com 執行時 script 反而消除一個供應鏈單點。

## Self-Check: PASSED

- tailwind.config.js / postcss.config.js / index.css：存在
- commit 24a8135：存在於 worktree-agent-a8d8b7a660faaf62e
- git status --porcelain：乾淨（僅本 SUMMARY 未追蹤，依約不 commit）
