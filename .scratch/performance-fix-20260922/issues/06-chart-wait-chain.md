# 06 — 分類 K 線剩餘等待並做最小修復

Status: claimed
Blocked by: 04, 05
Type: task

本檔為正式票據。依本案共同驗收手冊執行。

## 要交付的結果

在前述環境與庫存修復後重新量完整 K 線路徑，找出仍屬使用者可見等待的部分；只在有安全收益時做最小修改，必要價量與 context 保持完整。

## 實作範圍

- 分開量中文名稱、FinMind 價量、法人／籌碼與短／完整歷史的到貨時間及實際使用端。
- 名稱可優先沿用名錄／快取或獨立補入，但不可改 symbol／市場識別或讓舊名稱回填新股票。
- FinMind 價量仍負責 OHLC 修正、成交量、日期、指標與選股一致性；未證明可延後前不得提早宣告正式結果。
- 法人／籌碼先核所有圖表、濾網及 AI 使用端；未到不能當成 0 或標示分析完整。
- 保留原短歷史先到、完整歷史補全與訂閱／取消契約，避免短歷史污染完整歷史快取。

## 驗收條件

- [ ] 台／美股、日／週／月／分線有固定回應驗證與使用者畫面量測。
- [x] 2y 先到、10y 先到、2y 失敗、10y 補全失敗、FinMind 失敗、背景刷新、A→B→A、多訂閱與個別取消均覆蓋。另補台股 staged 最後 subscriber abort 與 context 消費前 early-abort regression，確認取消後不啟動 FinMind fallback、無 unhandled rejection 或 stale publish/cache。
- [x] 固定上游下最終完整輸出雜湊一致；回訪不增加非預期 chart 請求。最新 `fixed-current-v4.json` 與 current/clean v1、current v2/v3 的 combined SHA-256 皆為 `516eb415aa1980af99f71c75a9e107d24faad7b90f6ce7f6fed5fa8e236f85b3`；A→B→A 無第三次 A chart。
- [x] 若剩餘等待主要是必要上游價量，不為拆 Promise 而拆。覆核結果維持 FinMind PV／籌碼／完整歷史的必要等待；名稱沒有既定 late-update 契約，本票不擴張。
- [x] 若需新增 readiness／分析禁用契約，先提出獨立設計決策，不在本票直接擴張。未新增 readiness UI／分析狀態機；PV transport failure 的處理經使用者拍板為「降級顯示＋短快取」（見下方 2026-09-23 收斂）。
- [x] 完整 gate 與雙軸覆核通過。隔離完整 checkout `C:\pfv`：`npm run gate -- --require-env` 全綠（49 files／823 tests）；Standards 硬性違規 1 項（測試放 `.scratch`）已修，Spec BLOCKING 3 項已處置。

## 邊界

不把未修正 OHLC、未完成必要 context 或語意模糊的 partial 當成正式 K 線結果。

## 2026-09-23 覆核狀態（worker 版，PV 失敗語意已由下方收斂取代）

已完成的最小 correctness 修正：

- `chipDataUnavailable` 已傳入健檢 prompt；籌碼來源不可用時明示「資料暫時不可用」，不再聚合成 0 張。
- FinMind PV 明確請求失敗回 `null`；Yahoo 台股 1d 非 fallback 路徑遇 `null` 拒絕未校正結果。成功空陣列維持原語意。
- ticket 06 feature tests 8/8、Yahoo revalidation/loading 29/29、geminiRules 13/13、tsc 0；固定成功上游 hash 無漂移。

最後 blocker 已完成：

- `fetchFinMindPriceVolume()` 遇 `AbortError` 現原樣上拋；一般 transport failure 仍回 `null`，再由台股 1d 非 fallback 路徑轉成 `DataFetchError`，PV 完整性語意保持不變。
- 新增 deterministic regression：台股 staged 2y 已到、PV 等待中，最後 subscriber 取消；驗證 subscriber 收 `AbortError`、`pvRequests=1`、`fallbackPvRequests=0`，且不出現 `Attempting FinMind fallback`。
- speculative PV 建立時另掛 rejection observer，但 `ChipSpec` 保留原 promise；因此 context 尚未消費 PV 就 early abort 時不會產生 unhandled rejection，之後若進入 await 仍取得原 `AbortError` identity。新增 regression 同時驗證 subscriber `AbortError`、`fallbackPvRequests=0`、無 stale publish/cache。
- targeted 驗證：ticket06 10/10、Yahoo revalidation/loading 29/29、tsc 0。

產品實作 blocker 已清空。本 worker 未 commit；依 repo lifecycle 規則先維持 `claimed`，等待 prime 完整 gate、雙軸 code-review 與 commit 後再標 `resolved`。驗收條件中的正式畫面量測／完整 gate 仍由 prime 收尾，不在本輪 targeted 授權內。

詳細證據：`.scratch/performance-fix-20260922/evidence/06/REPORT.md`。

## 2026-09-23 收斂（prime 接手）

- Spec 覆核 BLOCKING：前一版「PV 失敗 → `DataFetchError`」在 staged 且 2y 先到時會被 Yahoo 失敗的 catch 接走，轉入不可取消、重打同一失敗資料集的 FinMind fallback；成功時還以無還原權值的 FinMind 資料取代 Yahoo 結果並寫入快取，其他路徑則直接報錯——同一上游失敗的結果取決於到貨順序。且「降級改報錯」屬未授權的語意變更。
- 使用者拍板「降級顯示＋短快取」：PV 明確失敗時照常發布（輸出與 HEAD 相同），但比照 planner_rulings #3 對該筆快取只給 10 分鐘短 TTL、不沿用到下一交易日開盤；所有路徑一致，不拋錯、不進 fallback；旗標只走 `fetchStockDataUncached` 內部回傳值，不新增公共 `StockInfo` 欄位。健檢籌碼不可用改送「近5日籌碼：資料暫時不可用」經使用者確認接受。AbortError 原樣上拋與 speculative PV observer 保留。
- Standards 硬性違規：回歸鎖原放 `.scratch/.../tools/chart-ticket06.test.ts`（違反 ADR-0002 同目錄原則，且會靠 Vitest 未排除 `.scratch` 進母體），已搬到 `services/yahoo.chipContext.test.ts`；AbortError 判斷改為同檔寫法。其餘判斷題（測試夾具與 revalidation 測試相似、`gemini.ts` 換行寫法）不擴張處理。
- 回歸鎖 11 案；新增／改寫的 3 案以 HEAD 版與前一版 `yahoo.ts` 各跑一次皆能判紅（見 REPORT）。固定上游 `fixed-current-v7.json` 雜湊 `516eb415…f85b3` 與 v1～v6 相同。
- 完整 gate（隔離完整 checkout `C:\pfv`，本票＋05 產品改動）：tsc 0、49 files／823 tests、build、金鑰掃描（主 worktree `.env` 6 筆值）乾淨、package／lock 一致。
- 尚未完成：台／美股、日／週／月／分線的**使用者畫面量測**，併入 07 的正式 App 驗收執行，完成後回填本票並改 `resolved`。
