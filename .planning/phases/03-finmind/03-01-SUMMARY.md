---
phase: 03-finmind
plan: 01
subsystem: api
tags: [vercel-functions, finmind, chip-data-honesty, cdn-cache, whitelist]

requires: [01-gemini, 02-yahoo]
provides:
  - Server-side FinMind proxy with optional token injection and dataset whitelist
  - Chip-data honesty (chipDataUnavailable) replacing fake-zero institutional values
  - s-maxage CDN cache to Taipei end-of-day for FinMind responses
affects: [04-hardening]

tech-stack:
  added: []
  patterns: [thin-serverless-proxy, dataset-whitelist, cdn-s-maxage-cache, honest-unavailable-state]

key-files:
  created: [api/finmind.ts, api/_lib/finmind.ts]
  modified: [services/yahoo.ts, services/stockDirectory.ts, components/StockChart.tsx, types.ts, App.tsx, .env.example]

key-decisions:
  - "單一 GET /api/finmind + dataset 封閉枚舉白名單（非自由轉發）；薄代理回原始 JSON。"
  - "FINMIND_TOKEN 選填：有就注入、沒有照常免 token 打（優雅降級）；token 永不接觸前端。"
  - "s-maxage 快取到台北當日 24:00 是承重牆——後端集中呼叫共用 IP，比前端 per-user IP 更易撞限流。"
  - "籌碼誠實化：整包抓取失敗→欄位維持 undefined（不塞 0）＋StockInfo.chipDataUnavailable=true＋UI 徽章。"

patterns-established:
  - "誠實 unavailable 狀態：只有『整包抓取失敗』算 unavailable；chips 成功但缺日維持現行塞 0，不擴大語意。"
  - "StockChart 雷區規則：只動 hasChipData/viewOptions/標題列 JSX/props，Bar/Cell/軸/拖曳零觸碰。"

requirements-completed: [PROXY-04, PROXY-05, FE-03]

duration: n/a (backfilled)
completed: 2026-07-09
---

# Phase 3 Plan 1: FinMind 代理端點（後端集中）Summary

> **補記文件（backfilled 2026-07-09）**：本 phase 於 2026-07-09 由 Codex 執行、合併 main（`a0a7767`），
> 當時未產出 GSD 收尾文件。本摘要依 git 提交紀錄與合併後程式碼重建，故省略精確工時。

**把所有 FinMind 呼叫搬到後端 `/api/finmind`，注入 token、dataset 白名單、快取到當日，並以誠實的 chipDataUnavailable 取代假 0**

## Accomplishments

- 建立 `api/finmind.ts`（GET 薄代理：dataset 白名單、選填 token 注入、s-maxage 快取、`{code,message}` 錯誤）與 `api/_lib/finmind.ts`（白名單驗證、錯誤分類、台北當日結束秒數計算）。
- 前端四個 FinMind fetcher 與目錄改接同源 `/api/finmind`；token 移出前端。
- 籌碼誠實化：`services/yahoo.ts` 整包抓取失敗改回 null、欄位維持 undefined；`types.ts` 加 `StockInfo.chipDataUnavailable`；`StockChart.tsx` 加 props 與「籌碼暫不可用」徽章（`gemini.ts` 零改動，既有 N/A 分支自動受益）。

## Task Commits

依 git 紀錄（merge `a0a7767` 的分支側）：

1. `e010538` feat(03-01): add FinMind proxy endpoint
2. `07ec1f7` feat(03-01): route FinMind calls through backend
3. `81b2ffb` feat(03-01): surface unavailable chip data state
4. `91f1b86` docs: capture todo — Fix invalid FinMind OTC dataset names（執行中發現，Phase 4 已修）

## Files Created/Modified

- `api/finmind.ts`（+111）— GET 薄代理，`maxDuration=30`、s-maxage 快取。
- `api/_lib/finmind.ts`（+142）— 白名單、classify、`secondsUntilTaipeiMidnight`。
- `services/yahoo.ts`（±94）— 四 fetcher 改接、籌碼誠實化。
- `components/StockChart.tsx`（+10）— chipDataUnavailable props＋徽章（雷區外 JSX）。
- `types.ts`（+1）— `StockInfo.chipDataUnavailable?: boolean`。
- `.env.example`（+3）— `FINMIND_TOKEN` 佔位符。

## Verification

見 `03-VERIFICATION.md`。人工＋助手雙軌驗證當時已做：2330（上市）正常、6488（上櫃）正確顯示誠實化徽章、白名單擋非法 dataset、Network 僅同源 `/api/finmind`。

## Deviations from Plan

執行中發現上櫃股用的 `TaiwanOTCStockInstitutionalInvestorsBuySell`/`TaiwanOTCStockInfo` 非真實 FinMind dataset（自專案初始即靜默失敗，非 Phase 3 回歸）。誠實化功能正確揭露此舊 bug，根因記為 todo（`91f1b86`），已於 **Phase 4（`c7413ca`）修正**。

## User Setup Required

- 選填設定 `FINMIND_TOKEN`（Vercel 環境變數）提高額度；未填走公開額度。
- s-maxage CDN 快取效果需部署後才完整生效（本機 vercel dev 無 CDN，只驗 header 正確）。

## Next Phase Readiness

- FinMind 端點就緒；四個端點（Gemini/Yahoo×2/FinMind）到位，Phase 4 統一套防濫用層。

---
*Phase: 03-finmind*
*Completed: 2026-07-09（文件補記於同日稍晚）*
