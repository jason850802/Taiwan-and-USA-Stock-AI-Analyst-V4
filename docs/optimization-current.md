# 最佳化後的現況責任與驗收入口

更新：2026-09-21，第12票。進度以[正式票據](../.scratch/optimization-followup/issues)為準；最終整合結果見[最終報告](optimization-final.md)與[12驗收入口](../.scratch/optimization-followup/evidence/12/README.md)。此文件描述目前責任，不覆寫[第一輪歷史報告](optimization-2026-09-20.md)或`.planning/`。

## 使用者操作到資料的路徑

| 操作 | 責任位置 | 必須保留的契約 |
|---|---|---|
| 市場選股、換週期及重新分析 | `App.tsx` | 畫面只接收目前請求；換股／週期／離頁使舊報告顯示失效。 |
| K線首屏、完整歷史及背景刷新 | `services/yahoo.ts` | 同key工作與各使用端訂閱分離；2y是短歷史、10y是完整歷史；完整歷史使用端不誤收短結果。取消只終止自己的訂閱，最後一位離開才中止共用工作。 |
| 最新價與匯率 | `services/yahoo.ts`的`getLatestPrice`、`services/quoteCache.ts` | 一般請求共享進行中工作，force啟動新請求；服務快取只允許最新世代發布。報價日期及取得時間仍由既有服務產生。 |
| 庫存畫面 | `components/portfolio/useHoldingPrices.ts` | UI按股票與匯率核對最新意圖；一般快取回填不取代待完成的force。移除／卸載後不恢復舊項目。價格失敗及缺匯率顯示口徑不改。 |
| 庫存請求排程 | `components/portfolio/holdingPriceQueue.ts` | 單一hook實例的三個槽位，含匯率；FX首批優先。尚未開始的同key舊工作可取代，已開始者占槽至實際完成。不是整站或跨分頁全域限流。 |
| 基本面及解讀 | `components/FundamentalsPanel.tsx`、`services/finmind.ts` | 畫面和AI狀態各屬其股票；服務按最新請求發布快取；舊回應不能污染再次查閱。財報整理、日期和提示詞不改。 |
| 長報告 | `utils/framePublisher.ts`、`App.tsx`、`components/portfolio/useHealthCheck.ts` | 接收服務的累積全文，同影格只保留最新常規提交，完成同步發布全文。取消的是過期顯示，不新增後端傳輸中止協定。單檔健檢按股票隔離；批次仍等全文完成後分配。 |
| 健檢移除／重加 | `components/portfolio/useHealthCheck.ts` | 移除時連同沒有影格排程的批次世代一起失效，清除已移除的結果及視窗指向；重加同代碼也不接收舊持股報告。仍有效的其他股票繼續完成。 |
| 後端Yahoo | `api/_lib/yahoo.ts` | 同執行個體共用cookie／crumb握手；只有實際使用的世代能被認證失敗使其失效。既有錯誤分類、沿用時間與重試契約不變。 |
| 視窗及指標設定 | `components/ui/Modal.tsx`、`components/ChartToolbar.tsx` | 最上層視窗管理焦點循環與Escape，動態控制項及StrictMode重播保留真正來源；指標設定更新不卸載正在操作的輸入。 |

UI身分守衛、共用服務世代和排程槽位是三個不同責任。刪掉其中任一層可能分別造成舊畫面回填、快取倒退或重疊批次突破上限，不能因為都有「pending」便合併成同一套判斷。

## 可重建快取

| 資料 | 記憶體預算 | sessionStorage預算 | 單項預算 |
|---|---|---|---|
| 行情／最新價 | 128 MiB、160個唯一payload、320 keys | 4 MiB、64 keys | 記憶體8 MiB；持久化2 MiB |
| 基本面 | 2 MiB、128項 | 1 MiB、128 keys | 256 KiB |

預算按JSON的UTF-16字元數乘二及key字元估值；同物件的記憶體別名只計一次payload。它不是heap／瀏覽器quota保證。`quoteCache`與`finmind`管理各自記憶體及日期政策；`services/_shared/boundedSession.ts`只管理指定session命名空間的容量、LRU和best-effort讀寫，不判定行情新鮮度。

儲存暫時拒絕且舊值移除失敗時，該可重建命名空間標為不可信。權限恢復後先清除自家prefix，再允許讀取；不保留無界失效key清單、不清其他命名空間。基本面跨日清理過去日期；本票沒有改股票沿用窗或匯率60分鐘旁路。超大、壞JSON、循環序列化或quota失敗不能阻斷本次正常服務回傳。

本體資料（持股、交易流水、匯入紀錄、已實現帳本、每日快照）不屬可重建快取，沒有納入淘汰。`useDailySnapshot`仍按既有800 ms debounce及金融完整性守衛寫快照，沒有引入顯示備援匯率作為史料。

## 已量得的收益與代價

以下是逐票歷史實測，最終候選需另看12的重跑，不能混成同一批樣本：

- 05：30檔加匯率的HTTP峰值6→3，首檔中位197.9→181.0 ms，但全部完成517.9→1129.7 ms。這是降低尖峰的代價，非全面提速。
- 07→08：30／100檔三週期資料循環的行情記憶體估值由約345 MB／1150 MB降到約132 MB。全量第二／三輪命中100%→0%，三輪總服務時間中位30檔4975.3→9146.0 ms、100檔15915.2→28997.7 ms；近期十檔三週期的再次查閱仍為0次K線請求。
- 09：固定100 KiB／1000片段的development React.Profiler壓力情境，內容提交中位997→1、累計渲染17377.5→52.2 ms；完成到全文可見的觀察延遲56.3→77.6 ms，沒有宣稱該延遲改善。
- 10：15項兩尺寸原生鍵盤案例、141次trusted按鍵；此為桌面瀏覽器內1440×900／390×844的真實iframe尺寸，並非手機硬體或螢幕閱讀器實機測試。

數值及原始口徑分別見[05](../.scratch/optimization-followup/evidence/05/measurement-results.md)、[08](../.scratch/optimization-followup/evidence/08/README.md)、[09](../.scratch/optimization-followup/evidence/09/README.md)、[10](../.scratch/optimization-followup/evidence/10/README.md)。沒有將本機固定假資料改善宣稱為真實網路SLA。

## 維護及重跑入口

一般修改先執行`npx.cmd tsc --noEmit`，收尾`npm.cmd run gate`；新原始碼先加入追蹤再作最後金鑰掃描。完整手冊見[acceptance](../.scratch/optimization-followup/acceptance.md)。不要為測試安裝新套件、呼叫真實AI或改真實庫存。

| 驗證責任 | 入口／證據 |
|---|---|
| 共用行情、最新價、財報世代 | `services/yahoo.revalidation.test.ts`、`yahoo.loading.test.ts`、`finmind.loading.test.ts`；02～04的隔離App原始結果 |
| 庫存三槽、移除與重疊更新 | `components/portfolio/holdingPriceQueue.test.ts`；`evidence/05/fixture-server.mjs`及該票README |
| 握手與真handler鏈 | `api/_lib/yahoo.handshake.test.ts`；fake upstream與測試環境隔離，不打真Yahoo |
| 容量／權限／別名／跨日 | `services/quoteCache.bounds.test.ts`、`finmind.bounds.test.ts`；`evidence/08/profile-server.mjs 12`與`evidence/12/cache-app-server.mjs 12`將重跑結果另存12 |
| 長報告及片段邊界 | `utils/framePublisher.test.ts`；`evidence/12/stream-server.mjs 12`、`evidence/09/summarize.mjs 12`及`evidence/12/verify-stream-ui.mjs` |
| 鍵盤及兩尺寸 | `evidence/12/keyboard-server.mjs 12`、`evidence/10/native-plan.mjs`及`evidence/12/verify-keyboard.mjs`；必須以原生鍵盤工具派送按鍵 |
| 來源與包大小 | `scripts/audit-source-usage.mjs`、`scripts/measure-initial-bundle.mjs --skip-build --json`；後者要求dist對應目前來源 |

上述`evidence/`都相對`.scratch/optimization-followup/`。05等未提供12輸出參數的舊工具不可直接重跑後覆蓋歷史原始檔，須使用12提供的輸出轉接。每票README列origin與啟動方式；停止只處理本次已核實命令列的PID。

## 保守清理結果

11的來源掃描94檔均可從入口到達。額外開啟`noUnusedLocals`及`noUnusedParameters`後，唯一診斷是既有`utils/backfillPipeline.test.ts`的未用`vi`匯入；它不屬正式程式且受「既有測試不改」約束，故保留。這不等同所有分支／export都已被形式證明有用途，判讀範圍及引用列表保存於[11證據](../.scratch/optimization-followup/evidence/11/README.md)。

02～10已在各票替換單一回呼、無世代寫回、無界儲存及逐片段setState等舊路徑。11沒有發現可再安全刪除的正式程式，也沒有新增小模組拆分；保留`App`、`Portfolio`等大檔作後續獨立設計議題，不藉本票大量搬移金融或畫面責任。
