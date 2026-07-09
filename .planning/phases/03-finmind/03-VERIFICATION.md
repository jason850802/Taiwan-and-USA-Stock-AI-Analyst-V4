---
phase: 03-finmind
verified: 2026-07-09T15:35:00+08:00
status: passed
score: 6/6 truths verified (CDN cache effect deferred to deploy-time)
---

# Phase 3: FinMind 代理端點（後端集中）Verification Report

**Phase Goal:** 把所有 FinMind 呼叫搬到後端 `/api/finmind`，注入 token 並快取籌碼到當日，籌碼不可用時明確回傳狀態而非以空陣列假裝真實 0
**Verified:** 2026-07-09T15:35:00+08:00（backfilled — 對合併後 main 程式碼複驗）
**Status:** passed

> **補記說明**：本 phase 已於 2026-07-09 合併 main（`a0a7767`）。執行當時已做人工＋助手雙軌驗證
> （2330/6488 實測）；此報告事後補寫，對現有 main 程式碼做程式化複驗。

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 前端不再直連 finmindtrade；token 只在後端 | ✓ VERIFIED | `grep -rn "finmindtrade" services/` = 0 命中；token 讀 `process.env.FINMIND_TOKEN` |
| 2 | /api/finmind 只接受 dataset 白名單，非白名單 400 | ✓ VERIFIED | `api/_lib/finmind.ts` `ALLOWED_DATASETS`＋`validateFinMindParams`（Phase 4 已移除兩個不存在的 OTC 條目） |
| 3 | 成功回應帶 Cache-Control s-maxage 到台北當日 | ✓ VERIFIED | `api/finmind.ts:90-91` `public, s-maxage=${secondsUntilTaipeiMidnight()}, stale-while-revalidate=60` |
| 4 | 籌碼整包失敗→undefined＋chipDataUnavailable＋徽章 | ✓ VERIFIED | `services/yahoo.ts:633` 設 flag；`types.ts:70` 型別；`StockChart.tsx:559,830` hasChipData 判斷＋徽章 JSX |
| 5 | 搜尋/目錄/籌碼行為一致；gemini.ts 零改動 | ✓ VERIFIED | gemini.ts 不在 Phase 3 變更檔案清單（`a0a7767` diff）；既有 N/A 分支自動受益 |
| 6 | StockChart 雷區未觸碰（Bar/Cell/軸/拖曳） | ✓ VERIFIED | diff 僅 +10 行，集中在 props/hasChipData/徽章 JSX；圖形繪製區未變 |
| — | CDN s-maxage 命中減少上游重打 | ? DEPLOY-TIME | 本機 vercel dev 無 CDN，只驗 header 正確；命中率需部署後觀察 |

**Score:** 6/6 可程式化驗證的 truths 通過；CDN 快取實效待部署驗收

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/finmind.ts` | GET 薄代理＋快取＋錯誤 | ✓ EXISTS + SUBSTANTIVE | 111 行；default + maxDuration=30 + s-maxage |
| `api/_lib/finmind.ts` | 白名單＋classify＋秒數計算 | ✓ EXISTS + SUBSTANTIVE | 142 行；ALLOWED_DATASETS、classifyFinMindError、secondsUntilTaipeiMidnight |

**Artifacts:** 2/2 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| services/yahoo.ts (4 fetcher) | /api/finmind | fetch | ✓ WIRED | fetchFinMindRows 統一走 `/api/finmind` |
| services/stockDirectory.ts | /api/finmind?dataset=TaiwanStockInfo | fetch | ✓ WIRED | 目錄改接 |
| StockChart.tsx | chipDataUnavailable prop | props 傳遞 | ✓ WIRED | `:519` 接 prop、`:559` 控制副圖、`:830` 徽章 |

**Wiring:** 3/3 connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| PROXY-04: FinMind 走後端＋token 注入＋dataset 白名單 | ✓ SATISFIED | - |
| PROXY-05: 籌碼快取到當日、不可用時明確回傳狀態 | ✓ SATISFIED | - |
| FE-03: services/stockDirectory.ts 改接、行為不變 | ✓ SATISFIED | - |

**Coverage:** 3/3 requirements satisfied

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| api/_lib/finmind.ts | — | 白名單含不存在的 OTC dataset（執行當下） | ℹ️ Info | 非本 phase 引入的舊 bug；誠實化正確揭露，Phase 4 `c7413ca` 已修 |

**Anti-patterns:** 0 blocker（1 資訊性，已於後續 phase 修正）

## Human Verification Required

### 1. CDN 快取命中（部署後）
**Test:** 部署後對同一台股重複查詢，觀察第二次是否命中 CDN（不進 function、不重打 FinMind）。
**Expected:** s-maxage 期間內重複查詢由 Vercel CDN 承接。
**Why human:** 本機 vercel dev 無 CDN 層，快取實效僅部署後可測。

## Gaps Summary

**No gaps found.** 籌碼誠實化、dataset 白名單、s-maxage header、雷區保護全數確認。執行中揭露的 OTC dataset 舊 bug 已在 Phase 4 修正並回歸驗證（6488/2330 籌碼恢復真實顯示）。

## Verification Metadata

**Verification approach:** Goal-backward（對合併後 main 複驗）
**Must-haves source:** 03-PLAN.md frontmatter
**Automated checks:** 11 passed, 0 failed
**Human checks required:** 1（部署後 CDN 快取命中）
**Total verification time:** ~5 min（補記複驗）

---
*Verified: 2026-07-09T15:35:00+08:00*
*Verifier: Claude Opus 4.8（backfill 複驗）*
