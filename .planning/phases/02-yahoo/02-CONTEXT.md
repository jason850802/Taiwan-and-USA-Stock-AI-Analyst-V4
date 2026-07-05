# Phase 2: Yahoo 代理端點（去公用 proxy） - Context

**Gathered:** 2026-07-05（decisions 由使用者於本日拍板）
**Status:** Ready for planning

<domain>
## Phase Boundary

把前端對 Yahoo 的呼叫（`services/yahoo.ts` 的 `getStockData`/`getLatestPrice`、`services/stockDirectory.ts` 的 `searchYahoo`）改走後端 `/api/yahoo/*`。後端做完整 cookie/crumb 握手、回傳 Yahoo **原始 JSON**，前端解析邏輯零變動；徹底移除 `corsproxy.io`/`allorigins.win` 公用 proxy。涵蓋 PROXY-03、PROXY-06、FE-02。

**對使用者的鐵則：** 行情、圖表、搜尋行為與現在完全一致；`StockDataPoint[]` 等領域型別零變動。
</domain>

<decisions>
## Implementation Decisions（已拍板，不可更動）

- **D-01（雙端點）**：建立 `api/yahoo/chart.ts`（行情 OHLCV）與 `api/yahoo/search.ts`（海外搜尋）兩個端點，**不做**單一萬用 `/api/yahoo?target=` 閘道（研究 ARCHITECTURE.md 點名萬用閘道為 god-object 風險；chart/search 參數與快取策略不同，值得拆）。
- **D-02（薄代理，回原始 JSON）**：後端只負責「cookie/crumb 握手 + 帶握手打 Yahoo + 回傳 Yahoo 原始 JSON（`{ chart: {...} }` / 搜尋原始 JSON）」。**前端 `services/yahoo.ts` 的 800 行解析邏輯（`processYahooResult`、intraday shift、synthetic 補值、指標計算等）完全不動**，只把「透過 PROXIES 打 Yahoo」換成「fetch 同源 `/api/yahoo/*`」。理由：PROXY-06/FE-02 要求契約零變動，回原始 JSON 回歸風險最低；把解析搬後端＝重寫管線（撞 Anti-Pattern 1）。
- **D-03（cookie/crumb 握手）**：(1) GET Yahoo 頁（如 `https://fc.yahoo.com`）取 `Set-Cookie`；(2) 帶 cookie GET `https://query2.finance.yahoo.com/v1/test/getcrumb` 取 crumb；(3) chart/search 請求帶 cookie + `crumb` 參數。遇 401/429：清 crumb 快取、指數退避後重取一次；仍失敗才回錯誤。需設瀏覽器式 `User-Agent`/`Accept` header（缺省 UA 更易被擋）。
- **D-04（crumb 快取＝函式記憶體 short-TTL）**：crumb 快取在 function 記憶體，TTL 約 10 分鐘。**本階段不引入 Vercel KV/Upstash 外部儲存**（那是 Phase 4 防濫用的事）。多實例/冷啟動各自握手是已知可接受取捨。
- **D-05（參數白名單）**：`interval` ∈ `{1d, 1wk, 1mo, 60m, 15m}`；`range` 依 interval 綁定白名單（比照現有硬編：1d→10y、1wk→5y、1mo→max、60m→1y、15m→60d），非自由字串；`symbol` 做基本格式檢查（數字/字母 + `.TW`/`.TWO` 後綴或美股代碼 pattern）。非白名單一律回 400，端點不可被當開放行情代理。
- **D-06（逾時）**：`api/yahoo/*` 的 `maxDuration` 設 30s（行情端點類別，遠短於 Gemini 120s）。錯誤分類延續 Phase 1 `api/_lib` 風格回 `{ code, message }`（message 繁中），不透傳上游原文。

### Claude's Discretion（授權預設，planner 可在此範圍決定）
- **FinMind fallback 留在前端（使用者拍板）**：`services/yahoo.ts` 內「Yahoo 失敗 → FinMind 台股日線 fallback」邏輯，Phase 2 **維持前端直連**，不搬後端；Phase 3（FinMind 代理）再處理。故前端 `getStockData` 改為：打 `/api/yahoo/chart`，失敗時沿用既有 FinMind 直連 fallback。
- **不加回應層快取（使用者拍板）**：Phase 2 不加 30–60s 短期快取，成功標準只要求「不出 401/429」；快取留 Phase 3 CACHE-01 一起做。
- **共用層延續 Phase 1**：沿用 `api/_lib/`（config/http/guard）風格；Yahoo 專屬的 crumb 握手/白名單邏輯可放新檔（如 `api/_lib/yahoo.ts`）或端點內，planner 決定，但錯誤分類與 Origin 檢查沿用既有 `_lib`。
- **guard 沿用 Phase 1 最簡 Origin 骨架**，不在本階段加限流（Phase 4）。
</decisions>

<canonical_refs>
## Canonical References（planner 與執行者動手前必讀）
- `.planning/research/ARCHITECTURE.md`（約 99-136）— 依上游分端點、薄代理回原始 JSON、Pattern 1 與 Anti-Pattern 1/3
- `.planning/research/PITFALLS.md`（約 65-86、218）— cookie/crumb 一手實測方案、10–20 分鐘過期、datacenter IP 挑戰、「只搬 fetch 不握手」是絕不能做的捷徑
- `.planning/research/SUMMARY.md`、`STACK.md` — 行情端點 maxDuration 建議、Node runtime
- `.planning/ROADMAP.md` §Phase 2 — Goal 與 4 條成功標準（特別是第 2 條「部署後連續 ≥30 分鐘不出 401/429」、第 3 條參數白名單）
- `.planning/REQUIREMENTS.md` — PROXY-03、PROXY-06、FE-02
- Phase 1 既有後端：`api/_lib/config.ts`、`api/_lib/http.ts`、`api/_lib/guard.ts`、`api/gemini.ts`（延續慣例：薄轉發、參數驗證、錯誤分類、maxDuration、本地最小型別不裝 @vercel/node）
</canonical_refs>

<code_context>
## Existing Code Insights（動手前用 grep/讀檔實際確認，勿憑記憶）
- `services/yahoo.ts`（800 行）：`PROXIES` 陣列（約 L7-8，corsproxy.io / allorigins）與 proxy 輪替迴圈（約 L280）是本階段要移除的核心；interval/range 對照邏輯約 L495-509；FinMind fallback 約 L530-554（本階段**保留前端**）；`processYahooResult` 等解析邏輯**不動**。
- `services/stockDirectory.ts`：`searchYahoo` 是第二個 Yahoo 呼叫點，改接 `/api/yahoo/search`。
- 前端改接後對外簽章與回傳型別維持不變（FE-02）；本地開發沿用 Phase 1 的 `vercel dev --listen 3001` + Vite proxy `/api`→3001（vite.config.ts 已設）。
- Phase 1 的彩排裁定仍適用：PowerShell 用 `npx.cmd`；驗證金鑰/字串掃描用 Git Bash 的 grep 或 PowerShell Select-String；不裝 @vercel/node，用本地最小型別。
</code_context>

<deferred>
## Deferred（出現即為範圍膨脹）
- FinMind 呼叫代理化（getStockData 的 FinMind fallback、目錄、籌碼、中文名稱）— Phase 3。
- 回應層 `Cache-Control`/`s-maxage` 快取 — Phase 3 CACHE-01。
- Upstash 限流／共享密鑰／CORS allowlist 完整防濫用 — Phase 4。
</deferred>

---
*Phase: 2-Yahoo 代理端點（去公用 proxy）*
*Context gathered: 2026-07-05*
