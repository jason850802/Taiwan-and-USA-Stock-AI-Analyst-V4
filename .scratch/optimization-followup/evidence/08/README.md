# 08 可重建快取容量與儲存降級

固定比較點：`d80a8941344a6c3f1e4bdf93c09ce636564a677f`。本票承接 07 已核准的 [容量決策](../07/capacity-decision.json)，以公開快取讀寫、真實服務、隔離瀏覽器驗收。所有數字均為工程預算或本機假資料量測，不是實際 heap 或瀏覽器 quota 保證。

## 採用的界線

| 可重建資料 | 記憶體 | 同步 sessionStorage | 單項 |
|---|---|---|---|
| 行情／最新價 | 128 MiB、160 payload、320 keys | 4 MiB、64 keys | 記憶體 8 MiB、持久化 2 MiB |
| 基本面 | 2 MiB、128 項 | 1 MiB、128 keys | 256 KiB |

計數單位為唯一 payload 的 JSON UTF-16 字元數乘二，加所有 key 字元數乘二；同物件的別名只計一次 payload。額外索引只保留 key／大小／物件關係，不保存一份長期 JSON 字串副本。淘汰以 payload 最近使用次序進行，移除同物件的全部記憶體別名；同 key 新值取代時同步使舊別名與舊持久化失效。

基本面清理非今日日期的資料，跨日才完成的舊請求只回覆原呼叫端，不重新發布過去日期快取。股票沿用窗、匯率 60 分鐘沿用窗、快取資料形狀、日期換算、財報組裝與金融語意保持不變。

若儲存權限暫時拒絕，連舊值的移除也失敗，該 session 命名空間只記一個不可信旗標。下次存取恢復時，先清除這個自家可重建命名空間，成功後才重新允許 session 讀取；失敗則當作 miss，記憶體仍可用。不以無界 tombstone 清單保留所有失效 key，也不觸碰其他命名空間。

依 07 決策保留同步 best-effort 持久化，沒有新增 deferred flush。超過單項上限／序列化失敗的本次服務結果仍可回傳，僅略過快取；拒絕儲存、quota 或壞 JSON 不會改動投資組合本體或設定。

## 可重跑入口

```powershell
node .scratch/optimization-followup/evidence/check.mjs 08 gate
node .scratch/optimization-followup/evidence/08/profile-server.mjs
```

在 `http://127.0.0.1:4180/?n=30&sample=0&auto=1` 執行 30／100 檔三週期三輪：各一次冷頁面、一次不計入暖機、五次正式樣本，最後接續故障頁面。瀏覽器時區須為 Asia/Taipei。資料、固定日期、零假網路延遲與 07 相同；新增 bounds 檢查不改服務資料。`profile-summary.json` 由 `summarize.mjs` 逐份核對來源／工具指紋再產生，保留重抓請求數與全部命中率，不能只呈現容量降低。

```powershell
node .scratch/optimization-followup/evidence/08/summarize.mjs
node .scratch/optimization-followup/evidence/08/app-server.mjs
```

正式 App 驗收開 `http://127.0.0.1:4181/?case=pressure&auto=1`：三輪三十檔日線切股、週／小時／日與縮放、基本面，以及 quota、denied、corrupt、oversize。此站服務正式 dist，沒有以測試宿主代替真實 App；未知 API／AI 拒絕，Host／Origin 與 CSP 僅允許本機。所有故障只施加於自家可重建快取命名空間，synthetic sentinel 同時核對 localStorage 與 sessionStorage。

```powershell
node .scratch/optimization-followup/evidence/08/verify-results.mjs
node .scratch/optimization-followup/evidence/check.mjs 08 verify
```

## 實際驗收

完整 gate：46 個測試檔、799 項全數通過（新增 26 項容量與故障行為測試）；型別、建置、金鑰掃描與 package／lock 檢查全綠，沒有掃描降級。既有 48 個測試／snapshot／依賴檔案雜湊不變。首屏 288.40 KiB raw／94.65 KiB gzip，仍低於相對 01 的 5% 調查門檻。四組固定行情完整輸出 SHA-256 與 01／07 相同。

14 份 30／100 檔 profile、6 類故障、5 頁正式 App 驗收均通過。`verified-results.json` 逐份核對原始碼／工具指紋、容量、主 Map 與旁索引一致、全輸出雜湊及 sentinel；未以原始檔存在冒充通過。

| 資料集 | 行情估值 07 → 08（含 keys） | 三輪服務耗時中位數 07 → 08（ms） | 三輪 K 線請求數 07 → 08 |
|---|---:|---|---|
| 30 檔 | 344,944,674 → 131,767,880 bytes | 4,901.5／36.5／8.9 → 3,281.3／2,965.3／2,947.1 | 90／0／0 → 90／90／90 |
| 100 檔 | 1,149,815,244 → 131,787,620 bytes | 15,773.1／32.5／67.4 → 9,964.5／9,576.7／9,475.3 | 300／0／0 → 300／300／300 |

每個數字是 sample2～6 的五次中位數；首次冷頁面與排除暖機另外保存在摘要。三輪服務耗時合計的中位數：30 檔 4,975.3 → 9,146.0 ms；100 檔 15,915.2 → 28,997.7 ms。完整頁面耗時中位數（含觀測、基本面與跨日）：30 檔 9,364.4 → 13,838.4 ms；100 檔 30,697.2 → 44,047.9 ms。各輪中位數相加不等於合計中位數，兩者均按原始樣本計算。

容量界線的明確代價是全量循環重訪：30／100 檔三週期都超出工作集預算，第二、三輪命中率由 100% 降為 0%。近期十檔三週期的第二次重訪仍為 30 次呼叫、0 次 K 線請求；另有 15 次台股名錄查詢，沒有把它誤稱為完全零 fetch。基本面當日後兩輪全命中，跨日後只留當日 30／100 個項目。這不是全量重訪提速承諾。

正式 App 使用真正 Vite dist：三輪 30 檔切股、週／小時／日切換、縮放與基本面均完成。quota、denied、corrupt、oversize 四場景在相同產品下繼續操作；20,000 根超大資料可顯示且不長期快取。合成行情日線顯示 348.91、超大日線 2,099.53；基本面顯示 2330、2026-09-18、PER 15.00。五頁均無捕捉例外或 console.error，無關 sentinel 完整；quota 實際注入 2 次、denied 13 次。原始讀值及請求列表見 `app-*.json`。

Desktop 最後檢視 title 為 `08 App oversize: PASS`；4181 的 error buffer 無訊息。每頁 bootstrap 在載入 App 前捕捉例外與 console.error，因此結論不依賴 Desktop 歷史 buffer 完整性。既有 Recharts warning 單獨計數；本票不宣稱完成 12 的跨尺寸矩陣。自建 4180／4181 程序已停止，分頁保留供下一票重用；見 `cleanup.json`。

獨立雙軸封板已完成：Standards 原 1 項證據發現已關閉，OPEN 0／NEW 0；Spec 全票 OPEN 0／NEW 0。詳見 `code-review.md`。本票已完成，依整批授權接續 09。

## 校正與追加重現

`cache-red.txt` 保存修改前第 161 份 payload 未淘汰的紅燈；`denied-recovery-red.txt` 保存追加的權限恢復紅燈：寫入／移除都暫時遭拒後，超大或循環新值雖未快取，舊 session 值在權限恢復後仍被讀回。此發現需要修正失效降級，而不是放寬容量或金融語意。

`precheck/` 保留修正恢復邏輯前完成的七份 30 檔樣本，與最終正式樣本分開，摘要工具不讀取此資料夾。正式量測已重新以修正後來源／工具指紋執行所有樣本，沒有對原始結果補蓋新雜湊。

四行情工具第一次執行時，Vite 前端相依掃描在 SSR 工具結束時尚未完成，訊息污染 JSON。原始輸出保留於 `market-tool-failure.txt`；`scripts/benchmark-market-data.mjs` 僅新增關閉此工具不需要的前端相依掃描，沿用第 03 票配對工具的設定。資料、時鐘、暖機、五次測量與行情管線皆未修改，修正後重新執行並保存 `market.json`。
