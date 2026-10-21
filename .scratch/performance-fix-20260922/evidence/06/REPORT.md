# Ticket 06 — 固定上游驗證與等待分類

日期：2026-09-23（Asia/Taipei）

本報告覆核 ticket 06 的最終產品修法與驗證證據。本 worker 沒有修改產品程式，只更新本 feature 的 evidence／票據。

## 結論

**Ticket 06 的產品 blocker 已關閉；targeted 驗證完成，等待 prime 執行正式 gate／雙軸覆核與 commit 後再標記 resolved。**

兩個先前 correctness 缺口都已有最小產品修正，而且主路徑修法成立：

1. `chipDataUnavailable` 已由 `getStockData().info` 傳入 `PortfolioHealthItem`；`formatHealthCheckData()` 遇到 `true` 會輸出「近5日籌碼：資料暫時不可用」，不再把缺值聚合成 0 張。
2. `fetchFinMindPriceVolume()` 對明確請求失敗改回 `null`；`resolveChipContext()` 在 Yahoo 台股 1d、且不是 FinMind fallback 時遇 `null` 會丟 `DataFetchError`，因此不發布未經 FinMind PV 校正的 Yahoo 量價／指標。HTTP 成功但資料為空陣列仍保留原語意，不會被誤判成 transport failure。

取消回歸也已以最小修正關閉：`fetchFinMindPriceVolume()` 遇到 `AbortError` 會保留 identity 原樣上拋；只有一般 transport failure 才維持 `warn + null`。speculative PV 建立當下另掛旁路 rejection observer，但 `ChipSpec` 保存的仍是原 promise，因此 context 尚未開始消費 PV 就取消時不會出現 unhandled rejection，而後續 await 仍會收到原本的 `AbortError`。shared work 被主動取消時，外層 H-1 因而直接終止，不再誤啟動不可取消的 FinMind fallback。

## 產品修法覆核

### 籌碼 unavailable 不再變成 0

- `components/portfolio/useHealthCheck.ts` 現在解構 `{ data, info }`，並把 `info.chipDataUnavailable === true` 帶進 health item。
- `services/gemini.ts` 的 `PortfolioHealthItem` 已新增 `chipDataUnavailable?: boolean`。
- `formatHealthCheckData()` 在該旗標為 true 時輸出「近5日籌碼：資料暫時不可用」，不走外資／投信加總。
- `utils/geminiRules.test.ts` 有 regression：確認 unavailable 文案存在，且不含「近5日外資合計：0張」與「近5日投信合計：0張」。

此修法與票面「未到不能當成 0 或標示分析完整」一致。

### FinMind PV transport failure 不再發布未校正結果

- `fetchFinMindPriceVolume()`：成功回 `any[]`；明確請求失敗回 `null`。
- `ChipSpec.pv` 與 `resolveChipContext()` 已接受 `Promise<any[] | null>`／`any[] | null`。
- Yahoo 台股 1d 且 `usedFallback === false` 時，`finMindPriceData === null` 直接丟 `DataFetchError('UNKNOWN', 'FinMind 台股價量資料暫時無法取得，請稍後再試。')`。
- FinMind fallback 已直接使用 `TaiwanStockPrice` 作主行情，所以 `usedFallback === true` 時不重複要求同一個 PV 校正結果。
- HTTP 成功但 `data: []` 仍是空陣列，不等同 transport failure，維持原本「沒有可覆寫列」的語意。

`chart-ticket06.test.ts` 的兩個 503 案都已改為驗證拒絕未校正結果：FinMind 三路同時失敗，以及只有 PV 失敗、name／institutional 成功。

## cancellation blocker 修復

原問題只出現在 staged 2y 路徑，而且需要工作本身被 abort：

1. 台股 1d 冷抓且有 `onRevalidated`，2y 先到後在 `resolveChipContext()` 等 FinMind PV。
2. 最後一位 subscriber 取消，`cancelSubscriber()` 使 shared `work.controller.abort()`。
3. 修正前，PV fetch 的 `AbortError` 會被 catch 成 `null`，再由 `resolveChipContext()` 轉成 `DataFetchError`，使外層誤進 fallback。
4. 修正後，`fetchFinMindPriceVolume()` 先檢查 `e.name === 'AbortError'` 並原樣上拋；外層 H-1 因而直接終止工作。
5. 一般 5xx／網路 transport failure 仍回 `null`，再由 Yahoo 台股 1d 非 fallback 路徑轉成 `DataFetchError`，既有 PV 完整性語意沒有改變。
6. 後續覆核另發現更早的取消窗：speculative PV 已起跑、但 chart 尚未推進到 `resolveChipContext()`。現以 `void speculativePv.catch(() => {})` 只掛 observer，未替換 `ChipSpec.pv` 原 promise，避免 early abort 先產生未處理 rejection，同時保留之後 await 的原錯誤 identity。

修正前用 stdin `tsx` 固定探針重現：

```text
subscriberError = AbortError
pvRequests = 2
fallbackPvRequests = 1
console: Yahoo failed (FinMind 台股價量資料暫時無法取得，請稍後再試。). Attempting FinMind fallback for 2330...
```

現在 `chart-ticket06.test.ts` 已新增正式 deterministic regression：台股 1d staged 2y 先到、PV 等待中，最後 subscriber 取消。修後斷言為：

```text
subscriber error.name = AbortError
pvRequests = 1
fallbackPvRequests = 0
console 不含 Attempting FinMind fallback
```

因此取消後不再增加不可取消的 `TaiwanStockPrice` fallback 請求。

另新增 context 消費前的 deterministic early-abort regression：2y／10y transport 都保持 pending，確認 speculative PV 已起跑後立即取消最後 subscriber；斷言 subscriber 收 `AbortError`、process 沒有 `unhandledRejection`、`fallbackPvRequests=0`，且取消後新工作成功寫入的 220 結果不會被晚到舊 transport 覆寫，後續讀取直接命中新快取。

## 固定上游輸出

`chart-fixed-probe.ts` 在最新產品程式上重跑為 `fixed-current-v4.json`：

- 10 個情境：TW/US × `1d`、`1wk`、`1mo`、`60m`、`15m`。
- `combinedSha256 = 516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3`。
- 與 `fixed-current-v1.json`、`fixed-clean-v1.json`、`fixed-current-v2.json`、`fixed-current-v3.json` 完全相同。

因此成功上游下的最終完整輸出沒有因這輪 correctness 修法漂移。

## 生命週期與情境覆蓋

`services/yahoo.revalidation.test.ts` + `services/yahoo.loading.test.ts` 本輪重跑 **29/29 passed**，包含：

| 要求 | 覆蓋 |
|---|---|
| 2y 先到 | 有 |
| 10y 先到 | 有 |
| 2y 失敗 | 有 |
| 10y 補全失敗 | 有 |
| 背景刷新 | 有 |
| 多訂閱／個別取消 | 有；另補台股 staged 最後 subscriber abort regression，取消後不觸發 FinMind fallback |
| 不同股票／週期隔離 | 有 |

feature 專用 `chart-ticket06.test.ts` 本輪新增保存 `ticket06-vitest-early-abort-final.json`，**10/10 passed**，包含 A→B→A fresh-cache、FinMind failure、name/chips/PV/history gating、2y + PV 等待、台股 staged 最後 subscriber 取消不啟動 fallback，以及 context 消費前 early abort 無 unhandled rejection／fallback／stale publish-cache。

## 剩餘等待分類

目前 App 的台股 1d staged 首屏仍近似：

`max(Yahoo 2y, FinMind name, FinMind institutional, FinMind PV) + enrich/indicator`

完整補全另需 Yahoo 10y。

| 等待 | 分類 | 最終判定 |
|---|---|---|
| 中文名稱 | metadata | 失敗可退 Yahoo 名稱；目前仍 gate 首屏。沒有既定 late-name chart 契約，本票不為省等待而另擴設計。 |
| FinMind institutional | 籌碼完整性 | 失敗可明確標 `chipDataUnavailable`；圖表與 AI 都不再把缺值當 0。 |
| FinMind PV | 價量／OHLC／指標完整性 | transport failure 現在拒絕未校正 Yahoo 結果；成功空陣列維持舊語意。 |
| Yahoo 2y | staged 首屏歷史 | 可先交 partial，但必須等必要 FinMind context。 |
| Yahoo 10y | 完整歷史 | 10y 先到直接交完整；partial 後 10y 失敗不冒充補全成功。 |

效能面仍沒有證據支持拆掉必要的 FinMind PV／籌碼／完整歷史等待。

## 本輪驗證

```text
npx vitest run chart-ticket06.test.ts --reporter=json --outputFile=../evidence/06/ticket06-vitest-early-abort-final.json
=> 10/10 passed

npx vitest run yahoo.revalidation.test.ts yahoo.loading.test.ts --dir services --reporter=json --outputFile=.scratch/performance-fix-20260922/evidence/06/revalidation-vitest-early-abort-v2.json
=> 29/29 passed

npx vitest run geminiRules.test.ts
=> 13/13 passed

npx tsc --noEmit -p ../tsconfig.json
=> exit 0

npx tsx chart-fixed-probe.ts --root ../../.. --output ../evidence/06/fixed-current-v4.json
=> 10 scenarios; combinedSha256 516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3
```

一次 fixed-probe 曾從 `utils/` 工作目錄誤執行而得到 `ERR_MODULE_NOT_FOUND`，腳本本體沒有被執行；回到 ticket 06 tools 目錄後已成功重跑上述 v3，故該路徑錯誤不屬產品或驗收失敗。

## 2026-09-23 接手收斂（prime）

Standards 覆核（接手後重跑）列出一項硬性違規：產品行為的回歸鎖放在 `.scratch/performance-fix-20260922/tools/chart-ticket06.test.ts`，違反 ADR-0002「測試與受測物同目錄」，且因 Vitest 未排除 `.scratch`，commit 後等於靠收錄範圍漏洞進入測試母體。已處理：

- 原檔（SHA-256 前 16 碼 `97d2350bb74405a8`）內容原樣搬到 `services/yahoo.chipContext.test.ts`，只把 7 處 `../../../services/yahoo` 改成 `./yahoo`，describe 標題去掉票號；原 `.scratch` 路徑不再保留副本，避免主工作區重複收錄。前述 `ticket06-vitest-*.json` 仍是舊路徑當時的歷史輸出，不改寫。
- `fetchFinMindPriceVolume()` 的 AbortError 判斷改為同檔既有寫法 `e?.name === 'AbortError'`，語意不變。

驗證（隔離完整 checkout `C:\pfv`：git worktree、HEAD `e9fa1a2`、1878 追蹤檔、0 缺檔、0 skip-worktree；產品 dirty 檔與主工作區逐檔 SHA-256 相同）：

```text
npx tsc --noEmit                                   => exit 0
npx vitest run services/yahoo.chipContext.test.ts services/yahoo.loading.test.ts \
  services/yahoo.revalidation.test.ts components/portfolio utils/geminiRules.test.ts
                                                   => 6 files / 62 tests passed
node <npx cache tsx 4.23.15>/dist/cli.mjs chart-fixed-probe.ts --root ../../.. --output ../evidence/06/fixed-current-v6.json
                                                   => 10 scenarios；combinedSha256 516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3
```

`fixed-current-v6.json` 與 v1～v5 雜湊相同。搬移前的完整 gate（同一 checkout、`npm run gate -- --require-env`）為 tsc 0、49 files／822 tests、build 成功、金鑰掃描讀主 worktree `.env` 6 筆值且乾淨、package／lock 與 HEAD 一致。

### Spec 覆核 BLOCKING 與使用者拍板（2026-09-23）

接手後重跑的 Spec 覆核指出，前一版「PV 失敗即 `DataFetchError`」有路徑不一致的缺陷：staged 且 2y 先到時，錯誤在 try 內被原本給「Yahoo 失敗」用的 catch 接走，轉入**不可取消**、且重打同一失敗資料集的 FinMind fallback；fallback 成功時還會以無還原權值的 FinMind 資料取代已成功的 Yahoo 資料並寫入快取。單段、10y 先到與 2y 失敗路徑則直接報錯。同一上游失敗的結果取決於 2y／10y 到貨順序與呼叫端。此外「降級改報錯」屬未授權的領域語意變更。

已把現值、依據與選項攤開請使用者決定，使用者選擇 **「降級顯示＋短快取」**：

- 現值（HEAD）：PV 失敗 → `[]` → 發布未校正 Yahoo 量價，快取沿用到下一交易日開盤。
- 依據：既有 planner_rulings #3「籌碼不可用可能是暫時性 429，只享 10 分鐘短 TTL、不享收盤後沿用」。
- 新值：PV 明確失敗 → `null` → `ChipContext.priceVolumeUnavailable = true`；結果照常發布（輸出資料與 HEAD 相同），但 `writeQuoteCacheResult` 對該筆寫入 `shortTtlOnly: true`。所有路徑一致，不拋錯、不進 FinMind fallback；旗標只在 `fetchStockDataUncached` 的內部回傳值中傳遞，不新增公共 `StockInfo` 欄位。
- 影響：FinMind 故障期間台股日線與健檢仍可用；最多 10 分鐘內顯示未校正量能，畫面不另標示；恢復後重新抓取即得校正結果。美股、週／月線、分線不受影響。

同時使用者確認接受健檢籌碼不可用時改送「近5日籌碼：資料暫時不可用」（取代假 0 張）；5 段 system instruction 與既有 snapshot 未動。AbortError 原樣上拋與 speculative PV observer 保留（取消不再被記成「價量不可用」）。

回歸鎖（`services/yahoo.chipContext.test.ts`，11 案）：兩個 PV 失敗案改為驗「照常發布、不走 fallback」與「PV 失敗 10 分鐘後過期重抓、PV 成功的對照組收盤後仍沿用」，並新增「staged 2y 先到＋PV 失敗照常交付並補全、PV 只請求一次、不啟動 fallback」。判紅能力：以 HEAD 版 `yahoo.ts` 執行時短 TTL 案紅（1 failed）；以前一版工作樹 `yahoo.ts`（SHA-256 前 16 碼 `f1094fc6efca5fc1`）執行時三案紅（含 staged 一致性）。

```text
C:\pfv> npx tsc --noEmit                            => exit 0
C:\pfv> npx vitest run services/yahoo.chipContext.test.ts services/yahoo.loading.test.ts \
          services/yahoo.revalidation.test.ts components/portfolio utils/geminiRules.test.ts
                                                    => 6 files / 63 tests passed
chart-fixed-probe.ts --output ../evidence/06/fixed-current-v7.json
                                                    => 10 scenarios；combinedSha256 516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3
```

## 最終狀態

ticket 06 的產品 blocker 已全部關閉，且本 worker 的 targeted 驗證全部通過：ticket06 10/10、Yahoo revalidation/loading 29/29、tsc 0。成功上游的 fixed probe hash 仍與 current/clean 既有基準一致。

依 repo ticket lifecycle 規則，本 worker 未 commit，且本輪授權只要求 targeted vitest + tsc，因此票面不提前標 `resolved`。剩餘流程由 prime 執行正式 gate、雙軸 code-review 與 commit；完成並有 evidence commit 後即可把 ticket 06 改為 `resolved`。
