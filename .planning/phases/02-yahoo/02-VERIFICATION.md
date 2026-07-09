---
phase: 02-yahoo
verified: 2026-07-09T15:30:00+08:00
status: passed
score: 5/5 truths verified (1 deploy-time item deferred to human)
---

# Phase 2: Yahoo 代理端點（去公用 Proxy）Verification Report

**Phase Goal:** 把所有 Yahoo 行情/搜尋呼叫搬到後端 `/api/yahoo/*`，後端實作完整 cookie/crumb 握手，移除前端對公用 CORS proxy 的依賴，且 `StockDataPoint[]` 領域契約零變動
**Verified:** 2026-07-09T15:30:00+08:00（backfilled — 對合併後 main 程式碼複驗）
**Status:** passed

> **補記說明**：本 phase 已於 2026-07-06 合併 main（`7891fd6`）。此報告為事後補寫，對現有 main
> 程式碼做程式化複驗，並標明哪些成功標準只能在真 Vercel 環境驗證。

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 前端不再呼叫 corsproxy.io / allorigins.win | ✓ VERIFIED | `grep -rn "corsproxy\|allorigins" services/` = 0 命中 |
| 2 | 行情/搜尋改走同源 /api/yahoo/* | ✓ VERIFIED | `services/yahoo.ts:274` fetch `/api/yahoo/chart`；`services/stockDirectory.ts:98` fetch `/api/yahoo/search` |
| 3 | 非白名單 interval/range/symbol 回 400，不可當開放代理 | ✓ VERIFIED | `api/_lib/yahoo.ts` 含白名單/interval 驗證（22 處 crumb/whitelist/interval 匹配）；review 修正補齊 currency/latest range 缺口（`693052b`） |
| 4 | Yahoo 失敗時前端 FinMind fallback 仍運作 | ✓ VERIFIED | fallback 邏輯保留前端直連（Phase 2 刻意不碰，Phase 3 才代理化） |
| 5 | StockDataPoint[]/簽章零變動 | ✓ VERIFIED | 解析邏輯（processYahooResult 等）未改；`getStockData`/`getLatestPrice`/`searchYahoo` 對外簽章不變 |
| — | 部署後連續 ≥30 分鐘不出 401/429 | ? DEPLOY-TIME | 需真 Vercel datacenter IP 環境，本機不可重現，見下方 Human Verification |

**Score:** 5/5 可程式化驗證的 truths 通過；1 項真環境 truth 待部署驗收

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/_lib/yahoo.ts` | 握手＋白名單 | ✓ EXISTS + SUBSTANTIVE | 222 行；cookie/crumb 握手、記憶體短快取、白名單 |
| `api/yahoo/chart.ts` | 行情薄代理 | ✓ EXISTS + SUBSTANTIVE | 81 行；default + maxDuration=30 |
| `api/yahoo/search.ts` | 搜尋薄代理 | ✓ EXISTS + SUBSTANTIVE | 70 行；default + maxDuration=30 |

**Artifacts:** 3/3 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| services/yahoo.ts | /api/yahoo/chart | fetch | ✓ WIRED | `:274` fetch，取代 PROXIES 輪替 |
| services/stockDirectory.ts | /api/yahoo/search | fetch | ✓ WIRED | `:98` fetch |
| api/yahoo/chart.ts | api/_lib/yahoo.ts | import 握手/驗證 | ✓ WIRED | 端點呼叫共用握手層 |

**Wiring:** 3/3 connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| PROXY-03: Yahoo 呼叫走後端＋cookie/crumb 握手 | ✓ SATISFIED | - |
| PROXY-06: 領域型別契約零變動 | ✓ SATISFIED | - |
| FE-02: services/yahoo.ts 改接、契約不變 | ✓ SATISFIED | - |

**Coverage:** 3/3 requirements satisfied

## Anti-Patterns Found

None — 解析管線未被搬後端（避免重寫）、無單一萬用閘道、無殘留公用 proxy。

## Human Verification Required

### 1. Yahoo 握手部署後穩定性
**Test:** 部署 Vercel 後，對 `/api/yahoo/chart` 連續查詢 ≥30 分鐘（涵蓋 cookie ~10–20 分鐘過期週期）。
**Expected:** 不出現 401/429；crumb 短 TTL 快取與自動重取有效。
**Why human:** Vercel datacenter IP 的握手行為與本機 vercel dev 不同，本機無法重現。

## Gaps Summary

**No gaps found.** 所有可程式化驗證的成功標準通過，契約零變動確認。唯一未驗項為真環境握手穩定性，屬部署後人工驗收，非程式缺陷。

## Verification Metadata

**Verification approach:** Goal-backward（對合併後 main 複驗）
**Must-haves source:** 02-PLAN.md frontmatter
**Automated checks:** 11 passed, 0 failed
**Human checks required:** 1（部署後握手穩定性）
**Total verification time:** ~5 min（補記複驗）

---
*Verified: 2026-07-09T15:30:00+08:00*
*Verifier: Claude Opus 4.8（backfill 複驗）*
