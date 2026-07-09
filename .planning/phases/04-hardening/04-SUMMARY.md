---
phase: 04-hardening
plan: [04-01, 04-02, 04-03, 04-04]
subsystem: api
tags: [rate-limit, upstash, cors, shared-secret, ssrf-whitelist, deployment-docs]

requires: [01-gemini, 02-yahoo, 03-finmind]
provides:
  - Unified applyGuards pipeline (CORS + OPTIONS + shared secret + per-IP rate limit) on all 4 endpoints
  - Upstash persistent per-IP rate limiting (gemini 10/min+100/day, market 60/min) with fail-open
  - Frontend X-Proxy-Secret injection via build-time VITE_PROXY_SECRET
  - .env.example + docs/DEPLOYMENT.md (Upstash, secret, GCP daily quota financial backstop)
affects: []

tech-stack:
  added: ["@upstash/ratelimit@^2.0.8", "@upstash/redis@^1.38.0"]
  patterns: [guard-pipeline, dual-sliding-window, fail-open-dual-protection, build-time-shared-secret]

key-files:
  created: [api/_lib/ratelimit.ts, services/_shared/apiClient.ts, docs/DEPLOYMENT.md]
  modified: [api/_lib/guard.ts, api/_lib/config.ts, api/_lib/finmind.ts, api/gemini.ts, api/yahoo/chart.ts, api/yahoo/search.ts, api/finmind.ts, services/gemini.ts, services/yahoo.ts, services/stockDirectory.ts, .env.example, package.json]

key-decisions:
  - "限流數值鎖定（使用者拍板）：gemini 10/分+100/天（雙 Ratelimit 實例）、行情 60/分（單實例）。"
  - "fail-open 雙保險：timeout:1000（慢/連不上）＋ try/catch+console.warn（超額/throw）——缺任一就變 fail-closed。"
  - "共享密鑰 build-time 注入前端 bundle（可見屬預期，非密碼學保證）；header X-Proxy-Secret、後端 PROXY_SHARED_SECRET、前端 VITE_PROXY_SECRET 同值；timingSafeEqual 比對。"
  - "無 Origin 路徑不收緊（同源 GET 可能不帶 Origin）；共享密鑰為主防線、Origin 為輔。"
  - "production 網域不硬編；部署文件指示部署後回填 ALLOWED_ORIGIN。"

patterns-established:
  - "applyGuards：四端點單一前置 pipeline（CORS→OPTIONS→Origin→secret→ratelimit），回 false 即短路已回應。"
  - "限流模組載入安全：Upstash env 未設時 limiter=null、checkRateLimit 直接放行，避免 Redis.fromEnv() 於本地 import 崩潰。"

requirements-completed: [GUARD-01, GUARD-02, GUARD-03, GUARD-04, DEPLOY-01, DEPLOY-02]

duration: n/a (backfilled)
completed: 2026-07-09
---

# Phase 4: 防濫用強化 ＋ 部署驗收 Summary

> **補記文件（backfilled 2026-07-09）**：本 phase 由 Fable 5 規劃、Codex 執行、Opus 4.8 覆核後合併 main（`684453d`）。
> 收尾文件於合併後補寫；本摘要依 git 提交紀錄、覆核實測與合併後程式碼重建。

**四端點統一套上防濫用層（Upstash 持久化限流／CORS allowlist／共享密鑰／輸入白名單），補齊 .env.example 與部署文件，並以 GCP 每日配額作為最後財務防線**

## Accomplishments

- 新增 `api/_lib/ratelimit.ts`：gemini 雙實例（10/分＋100/天）、行情單實例（60/分），`ephemeralCache` 熱路徑短路，fail-open 雙保險。
- 升級 `api/_lib/guard.ts`：`setCorsHeaders`（絕不 `*`、echo 對應 origin）、OPTIONS 204、`checkSharedSecret`（timing-safe、未設時降級）、`applyGuards` 單一 pipeline。
- 四端點（gemini/yahoo×2/finmind）改前置呼叫 `applyGuards`，gemini 帶 `[geminiPerMin, geminiPerDay]`、行情帶 `[marketPerMin]`。
- 前端新增 `services/_shared/apiClient.ts`（`proxyHeaders`），三個 service 五個 fetch 統一帶 `X-Proxy-Secret`。
- 白名單複核＋修正不存在的 FinMind OTC dataset（folded todo）；6488/2330 籌碼恢復真實顯示。
- `.env.example` 擴充 ＋ 新增 `docs/DEPLOYMENT.md`（Upstash 建置、密鑰產生、GCP 每日配額、網域回填）。

## Task Commits

依 git 紀錄（merge `684453d` 的分支側）：

1. `892532b` feat(04-01): add anti-abuse guard pipeline（GUARD-01/02/03）
2. `e885706` feat(04-02): send proxy shared secret header（GUARD-03 前端）
3. `08dfcc5` docs(04-04): document hardening deployment setup（DEPLOY-01/02）
4. `c7413ca` fix(04-03): tighten FinMind dataset whitelist（GUARD-04＋folded todo）

## Verification

見 `04-VERIFICATION.md`。覆核（Opus 4.8）為獨立重跑，非採信執行者自述——重點實測：
- 用測試密鑰實跑 `vite build`，確認 `VITE_PROXY_SECRET` **值**被注入 dist（研究標記的 A2 假設成立）。
- 自行 build 後 `grep -r "AIza" dist/` = 0（金鑰紅線）。
- `@upstash/*` 只在 package.json，未誤入 index.html importmap（CLAUDE.md 規則）。
- `isOTC`/`TaiwanOTC` 全清除，`.TWO` 的 K 線 fallback 等用途未誤動。

## Deviations from Plan

無。實作忠實對應四份 plan 與鎖定決策（限流數值、fail-open、CORS 無 `*`、無硬編網域）。

## User Setup Required（部署後手動）

- Vercel 環境變數：`PROXY_SHARED_SECRET`、`VITE_PROXY_SECRET`（同值）、`UPSTASH_REDIS_REST_URL/TOKEN`，部署後回填 `ALLOWED_ORIGIN`。
- **務必設 PROXY_SHARED_SECRET**——未設時端點降級放行（成功標準 #1 取決於此）。
- GCP 設 Gemini `GenerateContent` 每日配額（建議 ~200/天）。

## Next Phase Readiness

- 里程碑「後端 Serverless 代理層」四個 phase 全數完成，無後續 phase。剩部署與真環境驗收。

---
*Phase: 04-hardening*
*Completed: 2026-07-09（文件補記於同日稍晚）*
