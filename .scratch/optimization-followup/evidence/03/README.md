# 03 共用 K 線補全驗收

固定比較點：`c27c4beea4a999f3dc20f2dd109690821379602c`。開始時工作區乾淨；第 01、02 票成果均已提交。`before.json` 保存 45 個既有測試、snapshot 與依賴檔案雜湊，`unchanged.json` 驗證全部未變。

## 範圍與公開契約

產品僅修改 `services/yahoo.ts` 尾端的共用工作、訂閱及快取發布協調（+132／-74）。行情轉換、MA 暖機、歷史範圍、TTL、金融數值、提供商及降級順序不變；App、圖表、基本面與 AI 模組均未修改。

| 呼叫方式 | 完成契約 |
|---|---|
| 冷抓日線、有 onRevalidated | 共用 2y／10y；2y 先到則各自初次 resolve 短歷史，完整資料到貨各通知一次。10y 先到則直接 resolve 完整結果，不重複通知。 |
| 冷抓、沒有補全回呼 | 一律等完整歷史；加入既有分段工作也不會把 2y 當完整結果。 |
| 分段工作已有 partial 後才加入 | 共用仍在進行的 10y，初次 resolve 完整資料，不重開一組 2y／10y。 |
| 過期快取 | 先回既有完整快取，每個有效使用端個別登記補全。若 force 已在更新，尚新鮮的快取使用端也會登記，不漏通知。沒有工作時的新鮮快取仍為零網路。 |
| force | 每次真的發出新工作。舊工作有效使用端轉等新世代；舊完成／錯誤／finally 不發布快取，也不清除新世代。 |
| 個別取消 | 只移除自己的訂閱；其他人繼續共用。最後一位離開時清除工作並中止傳輸，之後加入者另開有效工作。 |
| 背景失敗／回呼拋錯 | 已有短歷史／舊資料保留；沒有初次結果者收到錯誤。失敗清理後可重試。單一回呼拋錯不阻止其他使用端。 |

原實作只把首位回呼綁到背景 Promise；後加入者直接被去重略過。冷抓另把首位 signal 綁到共用傳輸，force 也可能錯誤沿用舊工作。本次以共享工作身分與個別訂閱分開處理上述路徑，並刪除原本重複的協調路徑。

## 重現與行為測試

- `red.txt`：公開服務案例修改前失敗，後加入者補全回呼 0 次，預期 1 次。
- `red-stale-return.json`：使用 c27c4be 的正式 build，AAPL→MSFT→AAPL 後，API 已回 888，畫面仍為 222；保存 build index SHA-256，可與新版本區分。
- `edge-red.txt`：追加 force 進行中、新鮮快取使用端加入的案例，修正前漏通知，其他 18 案仍通過。
- `tests.txt`：新增 `services/yahoo.revalidation.test.ts` 的 19 項全部通過；用手動釋放假 fetch，不以延遲推算先後，且刻意讓假傳輸忽略 abort，確認身分守衛仍有效。
- 100 輪案例：同一 key 反覆加入兩位使用端、取消一位／全部、成功／失敗。每輪確認有新有效工作、通知總數正確、兩個 signal 的 listener 各解除一次、終結工作 signal 已取消；不公開或讀取私有 Map，也不把此生命週期觀察宣稱為 heap 量測。

## 建置後瀏覽器

Node v26.4.0，Chrome 153；viewport 1536×639，scrollWidth 1528。專屬 origin `http://127.0.0.1:4177`，僅此 origin 的測試儲存被清空；所有應用 API 在本機終止，未定義路徑與 AI 拒絕，CSP 限制同源網路。未呼叫真實 AI、未寫真實持股。

| 案例 | 最終實際讀值 |
|---|---|
| stale-return | AAPL；888.00；64 根完整歷史，切回後收到新資料。 |
| switch-return | AAPL 短歷史 111.00／12 根 → MSFT → AAPL；最終 222.00／64 根。 |
| tab-return | AAPL 短歷史 → 空庫存頁，完整回應在離頁期間到貨 → 回市場；222.00／64 根。 |
| force-pending | 舊工作待補全時實際發出新 10y；最終 999.00／64 根。 |
| failure-retry | 2y／10y 注入 503 後重試成功；AAPL 222.00／64 根。 |

五案的 `green-*.json` 保存實際 DOM、股票、日期、價格、SVG K 棒數、請求序列與 build index 雜湊；不是只看 HTTP 成功。64 根是假資料集完整深度，涵蓋 2016～2026，並非宣稱真市場十年只有 64 根。

`candidate-evidence.json` 逐檔核對五案及原生輸入紀錄皆通過、皆對應最終 gate 的同一 build index，並記錄產品 source SHA-256 與供覆核候選；避免將舊 build 結果當成新驗收。

`manual-tab-return.json` 另保存 Desktop 真實 fill／Enter／click：鍵盤選 AAPL 顯示 111.00／12 根，點空庫存頁，釋放完整歷史，點回市場實際讀到 AAPL／222.00／64 根及 2026-09-18。自動案例的合成事件與此原生輸入證據分開記錄。

驗收工具只在假站 HTML 加入時鐘／HTTP 觀察腳本，去掉外部 Google Fonts link（使用系統字型）；產品 index.html 與 bundle 不改。Yahoo URL 的唯一驗收參數避免瀏覽器合併相同 URL，伺服器忽略該參數。背景分頁可能暫停 requestAnimationFrame，所以工具使用事件迴圈交棒與實際 DOM／HTTP 就緒判斷。

正常路徑沒有觀察到非預期 console error；failure-retry 的兩筆 503 另列預期故障。既有 Recharts 初掛載 width/height -1 warning 仍在，本票不修改圖表。Desktop network 歷史 buffer 回報曾丟棄 170 筆舊事件，不能視為完整封包紀錄；每案請求由假站自行完整記錄，不依賴該 buffer。最新測試的正常取消亦可在 network 看到 ERR_ABORTED。

假站 PID 19448 與我開的分頁已關閉；`cleanup.json` 確認 4177 無殘留 listener。本票不宣稱完成第 12 票的全站跨尺寸驗收。

## 機械驗證與效能

`before.txt`：修改前 731／731。`gate.txt`：最終 42 個測試檔、750／750（原 731＋新增 19），tsc、build、金鑰掃描與 package gate 全通過。45 個既有檔案雜湊不變；package／lock 對本票起點與第 01 票均無差異。

`bundle.json`：首屏 284.43 KiB raw／93.27 KiB gzip。相對 01 的 283.17／92.82，增加約 0.45%／0.48%，未達 5% 調查門檻。

固定行情沿用原腳本：UTC、固定全域 Date、空 sessionStorage、force、假網路延遲 0；每組一次暖機後五次中位數，首次 SSR 載入到服務完成的冷啟動獨立記錄。四組完整輸出 SHA-256 在所有批次與第 01 票均一致。

| 標的／週期 | 本票修改前 ms | 最終單次批次 ms | 同程序交替：基準→候選 ms |
|---|---:|---:|---:|
| AAPL／1d，2500 根 | 22.22 | 23.22 | 21.418 → 21.989（+2.67%） |
| 2330.TW／1d，2500 根 | 20.76 | 20.35 | 20.410 → 20.455（+0.22%） |
| AAPL／1wk，520 根 | 8.81 | 8.76 | 8.801 → 9.066（+3.01%） |
| AAPL／60m，1600 根 | 13.40 | 14.90 | 13.906 → 15.198（+9.29%） |

回退調查不省略：第一輪台股 23.97 ms 超過門檻，重測 19.96 ms；追加邊界修正後小時線兩批 14.90／15.29 ms 都超過原 13.40 ms 的 10%。因此增加 `compare-market.mjs`：從 git 只讀 c27 基準至 Vite 虛擬模組，在同一程序交替執行基準／候選，避免跨時段負載混入。兩次配對小時線差異為 +5.34% 與 +9.29%，未重現超過 10% 的程式回退；保留全部原始批次，不宣稱無成本或已提速。最終單批冷啟動 708.70 ms，重測 734.93 ms；原基準 825.54 ms，不據此宣稱冷啟動改善。

原始檔：`market-before.*`、`market-first.*`、`market-first-repeat.*`、`market.*`、`market-repeat.*`、`market-paired-initial.json`、`market-paired.json`。第一版配對工具曾在關閉時遇到無關的 Vite 瀏覽器 dependency scan 錯誤；最終工具停用該掃描後重跑成功，不修改產品 Vite 設定。

## 重跑入口與回復

```powershell
node .scratch/optimization-followup/evidence/03/validate.mjs tests
node .scratch/optimization-followup/evidence/03/validate.mjs gate
node .scratch/optimization-followup/evidence/03/validate.mjs verify
node .scratch/optimization-followup/evidence/03/validate.mjs market
node .scratch/optimization-followup/evidence/03/compare-market.mjs
node .scratch/optimization-followup/evidence/03/fixture-server.mjs
```

假站啟動後開 `http://127.0.0.1:4177/?suite=green`；每案重新載入 App，成功才進下一案。重跑會更新對應結果檔，執行前可另存歷史結果；不要重跑 inventory 覆寫本票起點。結束只停止啟動輸出中的自有 PID。回復以反向套用本票最終 commit 為單位，先檢查後續票依賴與工作區差異，不回到早於 01 的 HEAD。

獨立雙軸覆核完成，Standards 與 Spec 皆 0 findings／0 open，詳見 [覆核紀錄](code-review.md)。第 03 票結案；下一票 04 未開始。
