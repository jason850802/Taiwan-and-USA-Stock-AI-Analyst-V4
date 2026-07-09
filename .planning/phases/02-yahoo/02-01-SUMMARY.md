---
phase: 02-yahoo
plan: 01
subsystem: api
tags: [vercel-functions, yahoo-finance, cookie-crumb, cors-proxy-removal, whitelist]

requires: [01-gemini]
provides:
  - Server-side Yahoo chart/search proxy with cookie/crumb handshake
  - Public CORS proxy (corsproxy.io / allorigins.win) dependency removed
  - interval/range/symbol whitelist rejecting non-allowed params
affects: [03-finmind, 04-hardening]

tech-stack:
  added: []
  patterns: [thin-serverless-proxy, cookie-crumb-handshake, in-memory-short-ttl-cache, param-whitelist]

key-files:
  created: [api/_lib/yahoo.ts, api/yahoo/chart.ts, api/yahoo/search.ts]
  modified: [services/yahoo.ts, services/stockDirectory.ts]

key-decisions:
  - "雙端點 chart/search，不做單一萬用 /api/yahoo?target= 閘道（避免 god-object）。"
  - "薄代理回 Yahoo 原始 JSON；services/yahoo.ts 的 800 行解析邏輯完全不動（契約零變動）。"
  - "crumb 快取在 function 記憶體、TTL ~10 分鐘；不引入外部儲存（那是 Phase 4）。"
  - "FinMind fallback 與回應層快取留在前端，本階段不碰（Phase 3 處理）。"

patterns-established:
  - "cookie/crumb 握手：GET fc.yahoo.com 取 cookie → GET getcrumb 取 crumb → 帶 cookie+crumb 打 chart/search；401/429 清快取指數退避重取一次。"
  - "參數白名單：interval ∈ {1d,1wk,1mo,60m,15m}、range 依 interval 綁定、symbol 格式檢查，非白名單回 400。"

requirements-completed: [PROXY-03, PROXY-06, FE-02]

duration: n/a (backfilled)
completed: 2026-07-06
---

# Phase 2 Plan 1: Yahoo 代理端點（去公用 Proxy）Summary

> **補記文件（backfilled 2026-07-09）**：本 phase 於 2026-07-06 由 Codex 執行、合併 main（`7891fd6`），
> 當時未產出 GSD 收尾文件。本摘要依 git 提交紀錄與合併後程式碼重建，非執行當下即時記錄，故省略精確工時。

**把所有 Yahoo 行情/搜尋呼叫搬到後端 `/api/yahoo/*`，後端做 cookie/crumb 握手回原始 JSON，移除公用 CORS proxy 依賴**

## Accomplishments

- 建立 `api/_lib/yahoo.ts`（cookie/crumb 握手、記憶體 crumb 短快取、interval/range/symbol 白名單、瀏覽器式 UA fetch）。
- 建立兩個薄代理端點 `api/yahoo/chart.ts`、`api/yahoo/search.ts`，回傳 Yahoo 原始 JSON。
- 前端 `services/yahoo.ts`、`services/stockDirectory.ts` 改接同源 `/api/yahoo/*`，移除 `corsproxy.io`/`allorigins.win` 輪替迴圈；800 行解析邏輯不動。

## Task Commits

依 git 紀錄（merge `7891fd6` 的分支側）：

1. `6cb84a6` feat(02-01): add Yahoo handshake layer
2. `d586373` feat(02-01): add Yahoo proxy endpoints
3. `e7da3c7` feat(02-01): route Yahoo calls through API
4. `baee9b0`→`693052b` review 修正：白名單缺口（currency / latest range）
5. `c6fadf8`→`a51ad7c` review 修正：fc.yahoo.com cookie 握手 404 誤分類
6. `2b155ec`→`2e55aac` review 修正：NOT_FOUND 被非 2xx guard 遮蔽

## Files Created/Modified

- `api/_lib/yahoo.ts`（+222）— 握手、crumb 快取、白名單驗證。
- `api/yahoo/chart.ts`（+81）— GET 行情薄代理，`maxDuration=30`。
- `api/yahoo/search.ts`（+70）— GET 搜尋薄代理，`maxDuration=30`。
- `services/yahoo.ts`（−解析不動，改 fetch 目標）— 移除 PROXIES 輪替。
- `services/stockDirectory.ts` — `searchYahoo` 改接 `/api/yahoo/search`。

## Verification

見 `02-VERIFICATION.md`。程式化可驗項目（合併後 main 複驗）全數通過；「部署後連續 ≥30 分鐘不出 401/429」屬真環境項，未在本機驗。

## Deviations from Plan

執行中經三輪 review 修正（白名單缺口、cookie 握手 404、NOT_FOUND 遮蔽），皆為邊角案例補強，未偏離「薄代理回原始 JSON、契約零變動」的核心決策。

## User Setup Required

- 無新環境變數（沿用 Phase 1 的 `ALLOWED_ORIGIN`）。
- 部署後需在真 Vercel 環境驗證 cookie/crumb 握手穩定性（datacenter IP 可能更常被要求握手）。

## Next Phase Readiness

- Yahoo 端點就緒；FinMind 呼叫（fallback/目錄/籌碼）留待 Phase 3 代理化。

---
*Phase: 02-yahoo*
*Completed: 2026-07-06（文件補記於 2026-07-09）*
