# 01 獨立 Code Review

日期：2026-09-20

固定比較點：`5f6b48a9e2a2077539ec8341b2dddb7d45e53d94`

供首次正式覆核的候選：`94f130154bc302d25c1165f0f7c598414522b7eb`

依使用者明確確認，worker 工具模型 ID `5.6` 視為本 PLAN 所指的 GPT-5.6 Sol；正式 reviewer 均使用 `5.6 + high`。先前 `model: null` 的試跑 worker 已停止，不計入正式驗收。

## Standards

首次完整覆核 `5f6b48a...94f1301` 有 2 項實質發現：

1. **HIGH — 保存版 browser fixture 無法重跑**：`evidence/01/preview-fixtures.mjs` 複製到較深目錄後仍使用舊 `../../dist/`，實際指向不存在的 `.scratch/optimization-followup/dist/`。
   - 處置：改為 `../../../../dist/`，直接從保存位置啟動 fixture，重新跑 browser 主要矩陣與 API 隔離；保存實際 request 序列為 `preview-rerun-requests.txt`。
2. **MEDIUM — 行情基準未完整符合共同量測規格**：原腳本未把 cold run、排除暖機、固定 clock/timezone/cache/fake delay 全部明確化。
   - 處置：`scripts/benchmark-market-data.mjs` 固定 `TZ=UTC` 與全域 `Date`，記錄固定 now、空 sessionStorage、forceRefresh、0 ms 假延遲；cold start 從 SSR module 載入前量到首次服務呼叫完成；每組先 1 次不計入暖機，再 5 次取中位數。

修正覆核：兩項均 **CLOSED**，`OPEN: 0`，`NEW: 0`。未發現需要回報的 Fowler smell、秘密外洩、金融語意變更、package/lock 變更或新的安全問題。

## Spec

首次完整覆核有 1 項實質發現：

1. **HIGH — 保存版 browser fixture 無法依證據重跑**：與 Standards 的 fixture 路徑問題相同，違反 01 票與驗收手冊的可重跑證據要求。
   - 處置：修正保存位置的 dist 路徑，使用該保存版 fixture fresh rerun 市場、鍵盤搜尋、週期、縮放、RETRY 首敗後成功、空庫存、基本面與 API isolation；fresh console/network 限制如實記錄。

最終獨立 Spec 修正覆核確認：**CLOSED**，`OPEN: 0`，`NEW: 0`。benchmark 修正仍屬 01 基準量測工具範圍，沒有 scope creep。

## 修正後驗證

- `npm.cmd run gate`：40 個測試檔／727 項全綠，build、金鑰掃描、package/lock gate 全綠；最後可提交輸出：`gate-review-fixes-final.txt`。
- `market-baseline.json`：固定 clock/timezone/cache/fake-delay、cold start、warm-up、5 次中位數均有原始欄位；四組完整輸出 SHA-256 與第一輪一致。
- `bundle-final.json`：283.17 KiB raw／92.82 KiB gzip。
- `source-audit-final.json`：91/91 可達、0 個孤立候選。
- 正式 source、既有 tests/snapshots、package/lock 的保存前 SHA-256 與修正後即時計算仍零差異；review 修正只動驗收工具與證據。

## 剩餘限制

- browser 正常／重試路徑仍可看到既有 Recharts 初掛載 width/height `-1` warning；本票沒有跨範圍修產品 UI。
- RETRY 的 503 是刻意故障注入，已與正常情境分開記錄。
- 本票只驗本機固定假資料，不宣稱真實市場網路延遲或真實 AI 品質已驗證；沒有呼叫真實 AI，也沒有寫入真實投資組合。
