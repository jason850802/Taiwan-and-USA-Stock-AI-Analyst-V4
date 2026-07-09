# Phase 3: FinMind 代理端點（後端集中） - Context

**Gathered:** 2026-07-08（偵查＋設計決策由 Fable 5 定案）
**Status:** Ready for planning（03-PLAN.md 同日產出）

<domain>
## Phase Boundary

把前端所有 FinMind 直連呼叫（`services/yahoo.ts` 四個 fetcher、`services/stockDirectory.ts` 目錄）
搬到後端 `/api/finmind`：後端注入選填 `FINMIND_TOKEN`、dataset 白名單分流、籌碼類回應以
`Cache-Control` 快取到當日；**籌碼抓取失敗時誠實回報 `chipDataUnavailable`，不再以空陣列讓
外資/投信顯示假 0**。涵蓋 PROXY-04、PROXY-05、FE-03。

**對使用者的鐵則：** 台股搜尋、目錄、籌碼載入行為與現在一致；token 永不接觸前端；
`StockDataPoint[]` 契約只做「必填→選填」的相容性放寬，不改語意。
</domain>

<decisions>
## Implementation Decisions（已拍板）

- **D-01（單一端點＋dataset 白名單）**：一個 `GET /api/finmind?dataset=…&data_id=…&start_date=…`。
  研究 ARCHITECTURE.md:34 已定案單一 handler（同上游/同認證/同錯誤模型）；與 Phase 2「反萬用閘道」
  不衝突——dataset 是**封閉枚舉白名單**，非自由轉發。初始白名單＝前端現用五個 dataset
  （法人買賣超上市/上櫃版、TaiwanStockPrice、TaiwanStockInfo、TaiwanOTCStockInfo——
  實際字串以 services/yahoo.ts 現碼為準）。**白名單註解需標明未來擴充點**：基本面 todo
  （TaiwanStockFinancialStatements 等）屆時加項即可。
- **D-02（薄代理回原始 JSON）**：後端不 normalize，前端解析零變動。
- **D-03（token 選填）**：後端讀 `process.env.FINMIND_TOKEN`，**有就注入、沒有照常免 token 打**
  （優雅降級）。加進 `.env.example`（佔位符）。token 永不出現在前端或回應中。
- **D-04（快取＝承重牆）**：後端集中呼叫共用伺服器 IP（免 token 300/hr、有 token 600/hr），
  比現在 per-user IP **更容易**撞限流——所以 `Cache-Control: public, s-maxage=<到台北當日24:00
  的秒數>` 是本期成敗關鍵，由 Vercel CDN 承接重複查詢。所有白名單 dataset 都是「盤後一天一變」
  性質，統一快取到台北時區當日結束即可（目錄類天然也適用）。**本地 vercel dev 無 CDN，
  快取效果部署後才能完整驗證**——本地只驗 header 正確。
- **D-05（籌碼誠實化，本期靈魂）**：
  - 後端：FinMind 402/`upper limit`→`RATE_LIMITED`；其他失敗→`UPSTREAM_ERROR`；照 Phase 2
    `{code,message}` 中文錯誤模型，不回假資料。
  - 前端 services：`fetchInstitutionalData` 失敗改回 `null`（不再回 `[]`）；`getStockData` 中
    chips 為 null 時**不塞 0**（`foreignBuySell`/`investmentTrustBuySell` 維持 `undefined`），
    並在回傳的 `symbolInfo` 設 `chipDataUnavailable: true`。
  - **語意劃線（精確，勿擴大）**：只有「整包抓取失敗」算 unavailable；chips 抓成功但某日期
    在 map 中缺（非交易日對不上）維持現行塞 0 的語意——真實 0 與缺日不在本期改。
  - 型別：`StockDataPoint.foreignBuySell`/`investmentTrustBuySell` 改為選填（`?: number`）；
    `StockInfo` 加 `chipDataUnavailable?: boolean`。讀取端已知相容：gemini.ts 有現成 N/A 分支
    （73-90、725-726、775-779，**零改動自動受益**）；StockChart 的 Cell 判斷 `(x||0)` 已容
    undefined——執行時仍要 grep 全部讀取點逐一確認。
  - UI 呈現：`StockChart` 加選填 prop `chipDataUnavailable`；`hasChipData`（556-559）改為
    「旗標為 true → 不顯示法人副圖選項，並在副圖 toggle 列（806-841 非雷區 JSX）顯示
    `Badge variant="neutral"`『籌碼暫不可用』」。**StockChart 雷區規則沿用：只准動
    hasChipData 判斷、viewOptions show 條件、標題/toggle 列 JSX、props 介面——Bar/Cell/軸/
    拖曳一行不碰。**
- **D-06（目錄改接）**：`ensureTaiwanDirectory` 改打 `/api/finmind?dataset=TaiwanStockInfo`；
  localStorage 7 天快取（`tw_stock_directory_v1`）照舊。`searchYahoo` 已走 `/api/yahoo/search`，
  本期不碰。
- **D-07（fallback K 線同軌）**：`fetchFinMindDailyData`（Yahoo 全掛時的 K 線後備）同樣改走
  `/api/finmind`（dataset=TaiwanStockPrice），其 throw 語意照舊。
- **D-08（後端慣例延續）**：`api/_lib/finmind.ts` 照 `api/_lib/yahoo.ts` 模式
  （ClassifiedError/classify/errorMessages/validate 白名單）；`api/finmind.ts` 照
  `api/yahoo/chart.ts` 模式（GET only、isAllowedOrigin、maxDuration=30、statusByCode、
  `[finmind:code]` log 前綴、不透傳上游原文）。
</decisions>

<canonical_refs>
- `.planning/REQUIREMENTS.md`：PROXY-04(:28)、PROXY-05(:29)、FE-03(:43)
- `.planning/ROADMAP.md` §Phase 3 成功標準（:56-60）
- `.planning/research/`：SUMMARY.md:57,136；PITFALLS.md:90-110,223,310（限流數字、402 雷、快取建議）
- 範本：`api/_lib/yahoo.ts`、`api/yahoo/chart.ts`、`api/_lib/guard.ts`
- 現碼：`services/yahoo.ts`（fetcher 群 184-261、chips 入口 606-619、塞 0 處 666、symbolInfo 749-752）、
  `services/stockDirectory.ts`（16-40）、`components/StockChart.tsx`（556-559、806-841）、
  `types.ts`（StockDataPoint 1-63、StockInfo 65-70）
</canonical_refs>

<deferred>
- 基本面 dataset 擴充（todo `2026-07-08-add-tw-stock-fundamentals-tab.md`）——白名單留擴充點即可。
- 「chips 成功但缺日」的真實 0 vs 缺日語意細分——非本期。
- Upstash 限流/共享密鑰——Phase 4。
- `.claude/skills/_shared/*.py`（skill 腳本直連 FinMind）——那是對話工具非 App，不改。
</deferred>

---
*Phase: 3-FinMind 代理端點（後端集中）｜Context gathered: 2026-07-08*
