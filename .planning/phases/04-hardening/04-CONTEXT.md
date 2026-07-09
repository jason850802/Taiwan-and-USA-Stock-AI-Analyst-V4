# Phase 4: 防濫用強化 ＋ 部署驗收 - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

在四個既有端點（`/api/gemini`、`/api/yahoo/chart`、`/api/yahoo/search`、`/api/finmind`）
統一套上防濫用層：Upstash 持久化 per-IP 速率限制、CORS allowlist＋OPTIONS preflight、
前端內嵌共享密鑰驗證、輸入參數白名單複核（SSRF 防護）；補齊 `.env.example` 與部署文件
（Vercel 設定、FinMind token、Upstash 建置、GCP Gemini 每日配額財務防線）。
涵蓋 GUARD-01/02/03/04、DEPLOY-01/02。

**對使用者的鐵則：** 自家前端行為完全不受影響；從 Postman/curl/不相干網站直呼 `/api/gemini`
無法消耗額度；限流跨 serverless 實例一致（非記憶體計數器）。

**併入本 phase 的 bugfix（見 Folded Todos）：** FinMind OTC dataset 名稱修正——
上櫃股籌碼從專案初始就因兩個不存在的 dataset 名稱靜默失敗，修法與 GUARD-04 白名單複核同檔同主題。
</domain>

<decisions>
## Implementation Decisions

### 限流策略與數值（使用者拍板，2026-07-09）
- **D-01（Gemini 端點雙層限流）**：`/api/gemini` per-IP **10 次/分鐘 ＋ 100 次/天**，
  兩層皆用 Upstash sliding window（`@upstash/ratelimit` 支援多實例組合）。
  單人使用寬裕（庫存健檢連發也夠），對腳本刷額度是硬上限。
- **D-02（行情端點單層限流）**：`/api/yahoo/*`、`/api/finmind` per-IP **60 次/分鐘**，
  不設日上限（行情不直接花錢；FinMind 另有 CDN 快取支擔，CDN 命中不進 function 不計數）。
- **D-03（fail-open）**：Upstash 連不上（故障、超免費額度）時**全部端點放行**。
  可用性優先；縱深防禦仍有共享密鑰＋Origin 檢查＋GCP 每日配額封頂財務風險。
  fail-open 時後端 log 警告（如 `[guard] ratelimit unavailable, failing open`）以便察覺。
- **D-04（production 網域未定）**：尚未部署過。CORS allowlist／`ALLOWED_ORIGIN` 用現有
  環境變數機制，部署文件明確指示「部署後把實際網域（如 `https://xxx.vercel.app`）回填
  Vercel 環境變數 `ALLOWED_ORIGIN`」。程式碼不硬編任何猜測的網域。

### Claude's Discretion（依研究建議裁量，planner 可在此範圍決定）
- **共享密鑰方案**：build-time 注入前端 bundle（如 Vite env `VITE_PROXY_SHARED_SECRET`＋
  自訂 header）。密鑰在 bundle 可見是**已接受的設計**（提高門檻、非密碼學保證——
  research FEATURES.md 專節已定調，HMAC 明列 Out of Scope）。header 名稱、驗證放
  `api/_lib/guard.ts` 或各端點、後端環境變數名（如 `PROXY_SHARED_SECRET`）由 planner 定。
  **注意**：金鑰紅線（`grep AIza dist/` = 0）只針對 GEMINI_API_KEY，共享密鑰入 bundle
  不違反紅線，但命名要能區分兩者用途，部署文件要說明這個差異。
- **本地開發行為**：後端未設 `PROXY_SHARED_SECRET` 時跳過密鑰檢查（優雅降級，
  `vercel dev` 開箱即用）；設了就強制驗。
- **無 Origin 請求的收緊**：目前 `guard.ts` 對「無 Origin/Referer」一律放行（curl 直接過）。
  收緊方式交 planner——建議「共享密鑰成為主防線後，Origin 檢查維持對瀏覽器的輔助防線」，
  但同源 GET fetch 可能不帶 Origin header，不可只靠 Origin 擋。
- **CORS 實作**：正確處理 OPTIONS preflight（自訂 header 會觸發跨源 preflight）、
  回應絕不出現 `Access-Control-Allow-Origin: *`、allowlist 來源沿用 `getAllowedOrigins()`。
- **超限體驗**：沿用既有 `{ code, message }` 錯誤模型（`RATE_LIMITED` code 已存在於
  FinMind 分類），回 429＋繁中訊息；前端不需新 UI（既有錯誤顯示路徑自動承接）。
- **Upstash 建置**：帳號區域選擇（建議與 Vercel function 區域相近）、免費層額度說明
  寫進部署文件；環境變數 `UPSTASH_REDIS_REST_URL`／`UPSTASH_REDIS_REST_TOKEN`。
- **部署文件位置與深度**：README 章節或獨立 `docs/DEPLOYMENT.md` 由 planner 定；
  必涵蓋：Vercel 環境變數清單、FinMind token 取得、Upstash 建立步驟、
  GCP Gemini API 每日配額上限設定指引（含建議值，例如以 100 次/天為基準）。
- **GCP 配額**：屬手動操作（無法用程式碼驗收），文件寫清楚步驟即可，建議值由 planner 依
  D-01 的 100 次/天推導。

### Folded Todos
- **Fix invalid FinMind OTC dataset names**（`.planning/todos/pending/2026-07-09-fix-invalid-finmind-otc-dataset-names.md`）：
  `TaiwanOTCStockInstitutionalInvestorsBuySell` 與 `TaiwanOTCStockInfo` 不是真實 FinMind
  dataset（2026-07-09 用上櫃股 6488 實測確認），上櫃股籌碼／中文名因此從專案初始就靜默失敗，
  Phase 3 誠實化正確揭露但未修根因。修法：
  1. `services/yahoo.ts`：`fetchInstitutionalData` 移除 `isOTC` 分支，統一用
     `TaiwanStockInstitutionalInvestorsBuySell`；`fetchFinMindStockInfo` 只查 `TaiwanStockInfo`。
  2. `api/_lib/finmind.ts`：`ALLOWED_DATASETS` 移除兩個不存在條目。
  3. 驗收：6488（上櫃）與 2330（上市）都顯示真實外資/投信買賣超，不再出現「籌碼暫不可用」。
  與 GUARD-04（輸入白名單複核）同檔同主題，故併入本 phase。
  **範圍提醒**：只改 dataset 名稱與白名單，不動 Phase 3 的快取/誠實化架構；
  `.TWO` 後綴判斷若用於 K 線 fallback 等其他用途不要順手改。
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 需求與成功標準
- `.planning/REQUIREMENTS.md` — GUARD-01~04（:34-37）、DEPLOY-01/02（:47-48）、
  Out of Scope 表（HMAC 簽章、多金鑰輪替、OAuth 明確排除）
- `.planning/ROADMAP.md` §Phase 4（:64-75）— Goal 與 5 條成功標準

### 研究（防濫用設計依據）
- `.planning/research/PITFALLS.md` :163-186 — Pitfall：serverless in-memory 計數器失效、
  Upstash 持久化限流才可靠；:254-256、:275、:288 — CORS 非防濫用、縱深防禦組合
- `.planning/research/FEATURES.md` :36-47、:69-81 — 共享密鑰對個人工具的強度分析
  （bundle 可見已接受）、建議組合：CORS allowlist＋共享密鑰＋IP 限流＋GCP 每日配額
- `.planning/research/SUMMARY.md` :65 — `@upstash/ratelimit@^2.0.8`＋`@upstash/redis@^1.35`
  版本建議（connectionless HTTP、跨實例共享）

### 既有後端（慣例範本與修改點）
- `api/_lib/guard.ts` — 現行 Origin 檢查（無 Origin/Referer 放行＝目前 curl 可直呼的洞）
- `api/_lib/config.ts` — `getAllowedOrigins()`（ALLOWED_ORIGIN 逗號分隔、去尾斜線）
- `api/gemini.ts`、`api/yahoo/chart.ts`、`api/yahoo/search.ts`、`api/finmind.ts` —
  四個要套防濫用層的端點；慣例：isAllowedOrigin 前置、maxDuration、`{code,message}`、
  `[scope:code]` log 前綴、不透傳上游原文
- `api/_lib/finmind.ts` — `ALLOWED_DATASETS` 白名單（folded todo 修改點）
- `.env.example` — 已存在，需擴充 Upstash／共享密鑰項目（DEPLOY-01）

### Folded todo 原始記錄
- `.planning/todos/pending/2026-07-09-fix-invalid-finmind-otc-dataset-names.md` —
  完整實測證據與修法（含 curl 驗證記錄）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `api/_lib/guard.ts` `isAllowedOrigin()`：四端點已統一呼叫，防濫用層最自然的擴充點
  （加 `checkSharedSecret()`／`checkRateLimit()` 同層並列或組合成單一 guard pipeline）。
- `api/_lib/config.ts`：環境變數讀取慣例（無值回 undefined／預設），新變數照抄模式。
- 錯誤模型：Phase 1-3 已建立 `{ code, message }`＋`statusByCode`，`RATE_LIMITED` code
  已在 FinMind 分類存在，可全端點共用。

### Established Patterns
- 端點皆為獨立 Vercel function（Node runtime、本地最小型別不裝 @vercel/node）。
- 依賴雷區：`@upstash/*` 是純後端依賴，**只進 `package.json`，不進 `index.html` importmap**
  （CLAUDE.md 的雙處維護規則僅適用於前端依賴）。
- 前端 fetch 呼叫點：`services/gemini.ts`、`services/yahoo.ts`、`services/stockDirectory.ts`
  ——共享密鑰 header 要在這三處統一加上（建議抽共用 helper 避免三處複製）。
- 驗證跑道：`npx tsc --noEmit` ＋ `npm run build` 後 `grep -r "AIza" dist/` 必須 0
  （共享密鑰會出現在 bundle 是預期行為，勿誤判為金鑰外洩）。

### Integration Points
- per-IP 識別：Vercel 上用 `x-forwarded-for` 第一段（或 `x-real-ip`）；本地 dev 無此 header
  需 fallback。
- CDN 快取與限流的互動：FinMind 命中 `s-maxage` 時請求不進 function、不計限流數——
  這是正確方向（重複查詢免費），計數只落在真正打上游的請求。
- OPTIONS preflight：加自訂密鑰 header 後，未來若前後端跨源部署會觸發 preflight；
  同源部署（現況規劃）瀏覽器不發 preflight，但 GUARD-02 仍要求正確處理 OPTIONS。
</code_context>

<specifics>
## Specific Ideas

- 限流數值明確拍板：gemini **10/分＋100/天**、行情 **60/分**、Upstash 掛掉 **fail-open**。
- 部署後才有 production 網域——文件要有「部署後回填 `ALLOWED_ORIGIN`」的明確步驟，
  程式不得硬編猜測網域。
- GCP 每日配額是「最後財務防線」的定位：即使密鑰外流＋限流失效，單日損失也被封頂。
</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- **Add TW stock fundamentals tab**（`2026-07-08-add-tw-stock-fundamentals-tab.md`）——
  UI 新功能，屬自己的 phase；FinMind 白名單已留擴充點（Phase 3 D-01），本 phase 不碰。

### 其他
- CACHE-01（FinMind 目錄/FX 後端快取擴充）、STREAM-01（Gemini 串流）、
  VALID-01（zod schema 驗證）——v2 requirements，非本 phase。
- HMAC 請求簽章——REQUIREMENTS.md 明列 Out of Scope，裸共享密鑰已足夠。

</deferred>

---

*Phase: 4-防濫用強化 ＋ 部署驗收*
*Context gathered: 2026-07-09*
