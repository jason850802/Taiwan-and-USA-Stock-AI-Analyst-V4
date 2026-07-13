---
phase: quick-260713-oxf
plan: 01
subsystem: backend-guard
tags: [ratelimit, upstash, fail-open, vercel-env, phase-d]
requires: [Phase 4 防濫用強化]
provides: [D-4]
affects: []
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/quick/260713-oxf-d-4-ratelimit-fail-open-vercel-productio/260713-oxf-SUMMARY.md
  modified: []
key-decisions:
  - "查證結論：production 限流啟用中，fail-open 路徑不適用於現行部署"
  - "純查證包由 orchestrator inline 執行（需本機 Vercel CLI 登入態，executor 無此能力）"
duration: ~5min
completed: 2026-07-13
---

# Quick 260713-oxf: D-4 ratelimit fail-open 查證 Summary

**One-liner:** Vercel production 的 UPSTASH_REDIS_REST_URL＋UPSTASH_REDIS_REST_TOKEN 皆已配置（4 天前隨部署建立）——`ratelimit.ts` 的 fail-open 路徑不適用，限流啟用中。零程式碼變更。

## 查證結果

### 程式碼事實（api/_lib/ratelimit.ts）

| 行號 | 行為 |
|---|---|
| :8-12 | `upstashIsConfigured` 需要 `UPSTASH_REDIS_REST_URL` 與 `UPSTASH_REDIS_REST_TOKEN` **兩者皆在**，否則 `redis = null` |
| :18-19 | `redis === null` → 各 limiter（geminiPerMin 10/min、geminiPerDay 100/day、marketPerMin 60/min）全為 `null` |
| :68-69 | 全 null → `checkRateLimit` 直接 `return true` ＝ **fail-open（完全無限流，靜默）** |
| :78-81 | Upstash 執行期錯誤（如憑證失效、網路斷）→ catch 後 `console.warn('[guard] ratelimit unavailable, failing open')` 並放行 |

### 部署環境實查（2026-07-13，`npx vercel env ls production`，唯讀名稱清單）

- 登入身分：jason70445-2807；專案：chuan0802/taiwan-and-usa-stock-ai-analyst-v4
- **`UPSTASH_REDIS_REST_URL`：存在（Encrypted，Preview＋Production，4 天前建立）✅**
- **`UPSTASH_REDIS_REST_TOKEN`：存在（Encrypted，Preview＋Production，4 天前建立）✅**
- 同時確認 Phase 4 全套 env 就位：GEMINI_API_KEY／GEMINI_MODEL_FAST／GEMINI_MODEL_THINKING／FINMIND_TOKEN／PROXY_SHARED_SECRET／VITE_PROXY_SECRET／ALLOWED_ORIGIN（皆 Encrypted、建立於同批）

### 結論

**D-4 通過**：部署環境 Upstash env 已配，`:18` 的 config-缺失 fail-open 不適用於現行 production；限流（gemini 10/min＋100/day、market 60/min sliding window）為啟用狀態。

## 殘餘風險（記錄，不在本包處理）

1. **憑證有效性未實測**：env 名稱存在不等於值有效。若 Upstash 專案被刪/token 失效，`:78` catch 仍會靜默 fail-open（僅 console.warn，Vercel logs 可見）。強驗證法＝對 production 發超限突發流量看 429——此步在 docs/DEPLOYMENT.md 真環境驗收清單中，屬使用者手動待辦（STATE「里程碑收尾待辦」既有項）。
2. **fail-open 是設計決策**（Phase 4 拍板：Upstash 掛掉不擋正常用戶），非缺陷；本查證只確認「不是因忘配 env 而長期裸奔」。

## 執行方式偏差

本包不走 planner→executor：純查證、零改碼，且需 orchestrator 本機的 Vercel CLI 登入態與已 link 專案（executor worktree 無）。quick 三保證（原子 commit＋SUMMARY＋STATE 登記）照舊。

## Self-Check: PASSED

- 兩 UPSTASH env 名稱在 production 清單 ✅
- 零程式碼變更（git status 僅本目錄 docs）✅
