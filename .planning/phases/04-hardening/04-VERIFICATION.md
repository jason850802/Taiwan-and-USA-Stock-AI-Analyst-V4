---
phase: 04-hardening
verified: 2026-07-09T15:10:00+08:00
status: passed
score: 8/8 code-verifiable truths verified (5 deploy-time criteria deferred to human)
---

# Phase 4: 防濫用強化 ＋ 部署驗收 Verification Report

**Phase Goal:** 在四個端點到位後統一套上防濫用層（持久化限流／CORS allowlist／共享密鑰／輸入驗證），補齊 `.env.example` 與部署文件，並設定 GCP 每日配額作為最後財務防線
**Verified:** 2026-07-09T15:10:00+08:00（Opus 4.8 覆核，合併前）
**Status:** passed

> **說明**：本報告為 Opus 4.8 於合併前的獨立覆核（非採信 Codex 自述），含自行重跑 build 的實測。
> 需真 Vercel＋Upstash 環境才能驗的成功標準，誠實標為部署後人工驗收。

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 四端點統一前置 applyGuards | ✓ VERIFIED | gemini/yahoo×2/finmind 皆 `if (!(await applyGuards(...))) return`；gemini 帶 `[geminiPerMin, geminiPerDay]`，行情帶 `[marketPerMin]` |
| 2 | 限流雙實例、數值正確 | ✓ VERIFIED | `ratelimit.ts` slidingWindow(10,'1 m')＋(100,'1 d')＋(60,'1 m')，各自 prefix；`results.every(success)` deny-if-either |
| 3 | fail-open 雙保險 | ✓ VERIFIED | `timeout:1000` ＋ `try/catch` 回 true＋`console.warn('[guard] ratelimit unavailable, failing open')` |
| 4 | 共享密鑰 timing-safe＋降級 | ✓ VERIFIED | `checkSharedSecret` 先比長度再 `timingSafeEqual`；`getSharedSecret()` 未設回 true（降級） |
| 5 | CORS 絕不 `*`、OPTIONS 204 | ✓ VERIFIED | `setCorsHeaders` 只在 origin 命中 allowlist 才 echo，無 `*`；OPTIONS 回 204 並帶 CORS header |
| 6 | 前端 5 個 fetch 帶 X-Proxy-Secret | ✓ VERIFIED | apiClient.ts `proxyHeaders`；gemini/yahoo(chart)/finmind(rows)/directory/search 皆 `...proxyHeaders` |
| 7 | VITE_PROXY_SECRET 值注入 dist（A2）| ✓ VERIFIED | **實測**：`VITE_PROXY_SECRET=ZZTEST… vite build` 後 grep dist 命中該值 1 次（型別轉型未破壞 Vite 替換） |
| 8 | OTC dataset 修正；.TWO K線未誤動 | ✓ VERIFIED | `isOTC`/`TaiwanOTC` grep = 0；`.TWO` 殘留全為 cleanId/fallback/判斷等合法用途 |
| — | 外部無密鑰呼叫消耗不了額度 | ? DEPLOY-TIME | 需真環境 curl；程式邏輯正確（密鑰＋Origin），但取決於部署時有設 PROXY_SHARED_SECRET |
| — | 跨 serverless 實例限流一致、429 | ? DEPLOY-TIME | 需真 Vercel 多實例＋Upstash |
| — | production CORS 無 `*` | ? DEPLOY-TIME | 需 production 網域＋跨源請求 |
| — | GCP 每日配額 | ? DEPLOY-TIME | Google Cloud console 手動操作 |
| — | 6488/2330 籌碼真環境顯示 | ? DEPLOY-TIME | 需真 FinMind 呼叫 |

**Score:** 8/8 可程式化/build 驗證的 truths 通過；5 項真環境成功標準待部署驗收

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `api/_lib/ratelimit.ts` | 限流層 | ✓ EXISTS + SUBSTANTIVE | 82 行；雙/單實例、getClientIp、checkRateLimit fail-open |
| `api/_lib/guard.ts` | guard pipeline | ✓ EXISTS + SUBSTANTIVE | +88；setCorsHeaders/checkSharedSecret/applyGuards |
| `services/_shared/apiClient.ts` | proxyHeaders | ✓ EXISTS + SUBSTANTIVE | VITE_ 讀取＋條件 header |
| `docs/DEPLOYMENT.md` | 部署文件 | ✓ EXISTS + SUBSTANTIVE | 94 行；8 章涵蓋環境變數/Upstash/GCP 配額/驗收清單 |
| `.env.example` | 環境變數清單 | ✓ EXISTS + SUBSTANTIVE | +14；含 UPSTASH_*、PROXY_SHARED_SECRET、VITE_PROXY_SECRET |

**Artifacts:** 5/5 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| 4 端點 | applyGuards | 前置呼叫 | ✓ WIRED | 各 handler 首行；正確 limiter 陣列 |
| applyGuards | checkRateLimit | getClientIp(XFF 首段) | ✓ WIRED | Vercel XFF 可信（研究驗證） |
| 3 services | apiClient proxyHeaders | fetch header 展開 | ✓ WIRED | 5 個 fetch 點 |
| VITE_PROXY_SECRET | dist bundle | Vite build-time 注入 | ✓ WIRED | 實測 grep 命中 |

**Wiring:** 4/4 connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| GUARD-01: Upstash 持久化 per-IP 限流 | ✓ SATISFIED | 跨實例一致性待真環境驗 |
| GUARD-02: CORS allowlist＋OPTIONS，無 `*` | ✓ SATISFIED | - |
| GUARD-03: 共享密鑰驗證 | ✓ SATISFIED | 部署需設 PROXY_SHARED_SECRET |
| GUARD-04: 輸入白名單/驗證（SSRF） | ✓ SATISFIED | - |
| DEPLOY-01: .env.example 完整 | ✓ SATISFIED | - |
| DEPLOY-02: 部署文件含 GCP 配額 | ✓ SATISFIED | - |

**Coverage:** 6/6 requirements satisfied

## Anti-Patterns Found

None — 無 in-memory 計數器（用 Upstash 持久化）、無硬編網域、無 `*` CORS、密鑰未進 git（僅 build-time 進 bundle 屬預期）。

## Human Verification Required

### 1. 外部無密鑰呼叫被擋
**Test:** 部署後（已設 PROXY_SHARED_SECRET）無密鑰 curl `/api/gemini`。**Expected:** 403。**Why human:** 需真部署環境。

### 2. 限流 429
**Test:** 一分鐘對 `/api/gemini` 連發 >10 次。**Expected:** 第 11 次起 429。**Why human:** 需真 Vercel＋Upstash 多實例。

### 3. CORS 無 `*`
**Test:** `curl -X OPTIONS -i` production 端點。**Expected:** 回對應 origin，無 `Access-Control-Allow-Origin: *`。**Why human:** 需 production 網域。

### 4. fail-open
**Test:** 故意填錯 UPSTASH_* 後請求。**Expected:** 放行＋log `[guard] ratelimit unavailable, failing open`。**Why human:** 需模擬 Upstash 故障。

### 5. 6488/2330 籌碼
**Test:** 部署後搜尋 6488（上櫃）與 2330（上市）。**Expected:** 兩者顯示真實外資/投信，無「籌碼暫不可用」。**Why human:** 需真 FinMind 呼叫。

## Gaps Summary

**No gaps found.** 程式碼層面所有可驗項目通過，實作忠實對應鎖定決策。研究標記的唯一風險（A2 Vite 密鑰注入）已由覆核者實跑 build 確認成立。剩餘為部署後人工驗收，非程式缺陷。

**部署時提醒（非 gap，屬 footgun）**：若 production 忘設 `PROXY_SHARED_SECRET`，加無 Origin 的 curl，端點會降級放行——成功標準 #1 取決於實際有設密鑰。DEPLOYMENT.md 已載明。

## Verification Metadata

**Verification approach:** Goal-backward（Opus 4.8 獨立覆核，含自行重跑 build）
**Must-haves source:** 04-01/02/03/04-PLAN.md frontmatter
**Automated checks:** tsc + build + grep（AIza=0、密鑰注入、無殘留 isOTC、importmap 純淨）皆通過
**Human checks required:** 5（全為真環境部署後驗收）
**Total verification time:** ~15 min（含重跑 build）

---
*Verified: 2026-07-09T15:10:00+08:00*
*Verifier: Claude Opus 4.8（三角分工之覆核者）*
