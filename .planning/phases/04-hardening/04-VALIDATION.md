---
phase: 4
slug: hardening
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-09
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> 本專案刻意無自動化測試跑道（REQUIREMENTS Out of Scope「自動化測試建置」）；
> 驗證＝tsc ＋ build ＋ 金鑰掃描 ＋ 手動 curl／瀏覽器。planner 不得在本 phase 新建 test framework。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none（無 test runner／lint；tsconfig 非 strict） |
| **Config file** | none |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit && npm run build`，build 後（Bash）`grep -r "AIza" dist/` 須 0 |
| **Estimated runtime** | ~30 秒 |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit && npm run build` ＋ Bash `grep -r "AIza" dist/`＝0（並確認共享密鑰**有**進 dist 屬預期，勿誤判外洩）
- **Before `/gsd-verify-work`:** full suite 綠 ＋ `vercel dev` 本機 curl smoke（密鑰擋拒、非法參數 400、OPTIONS header）
- **Max feedback latency:** ~60 秒（本機）；跨實例限流與 CORS production 行為僅能部署後驗

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01/03 | 04-01 | 1 | GUARD-01 | — | per-IP 限流跨實例一致、超限回 429 | manual | 部署後 curl 連發觀察 429（本機無法驗跨實例）；每 task 另有 `npx tsc --noEmit` | ❌ 手動 | ⬜ pending |
| 04-01-02 | 04-01 | 1 | GUARD-02 | — | 無 `Allow-Origin: *`、OPTIONS 回正確 header | manual + smoke | `curl -X OPTIONS -i`／`curl -i` 檢查 header | ❌ 手動 | ⬜ pending |
| 04-01-02, 04-02-01 | 04-01, 04-02 | 1 | GUARD-03 | — | 帶密鑰 200、缺/錯密鑰 403、未設密鑰降級放行 | manual | `curl` 帶/不帶 `X-Proxy-Secret` 比對；`grep VITE_PROXY_SECRET dist/` 確認注入 | ❌ 手動 | ⬜ pending |
| 04-03-01/02 | 04-03 | 2 | GUARD-04 | — | 非法 interval/range/dataset 回 400；6488 籌碼恢復 | manual | `curl` 非白名單 dataset 回 400；6488/2330 實測 | ❌ 手動 | ⬜ pending |
| 04-04-01/02 | 04-04 | 1 | DEPLOY-01/02 | — | `.env.example` 齊全、文件可依循重建 | manual review | 人工核對 | ❌ 手動 | ⬜ pending |
| （全部 task） | 04-01..04 | 1-2 | （型別/建置） | — | 全端點編譯通過、GEMINI 金鑰未外洩 | automated | `npx tsc --noEmit && npm run build`＋Bash grep | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.（刻意無測試基礎設施；不新增。）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 跨實例限流一致性 | GUARD-01 | 需真 Vercel 多實例＋真 Upstash，本機不可重現 | 部署後對 `/api/gemini` 連發 >10 次/分，觀察第 11 次起回 429＋繁中訊息 |
| production CORS 行為 | GUARD-02 | 需 production 網域與跨源請求情境 | 從不相干網頁 fetch `/api/*`，確認被 CORS 擋；`curl -X OPTIONS -i` 驗 header |
| 共享密鑰擋拒 | GUARD-03 | 行為驗證（curl 模擬外部呼叫） | 無密鑰 curl `/api/gemini` 應 403；自家前端正常 |
| GCP 每日配額 | DEPLOY-02 | Google Cloud console 手動操作，無程式介面驗收 | 依部署文件步驟設定後截圖／人工確認 |
| Upstash fail-open | GUARD-01 | 需模擬 Upstash 故障 | 暫時填錯 UPSTASH_REDIS_REST_URL，確認請求放行且 log 出現 fail-open 警告 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies（每 task 皆含 `npx tsc --noEmit`）
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references（N/A — 無 Wave 0）
- [x] No watch-mode flags
- [x] Feedback latency < 60s（本機部分）
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-09（gsd-plan-checker VERIFICATION PASSED）
