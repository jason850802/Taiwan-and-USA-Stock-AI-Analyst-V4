# 09 長報告畫面提交與請求生命週期

固定比較點 `06aa1cc8268479b8227269519c794be6a47a4f0d`。前次中斷時已保留修改前七份量測、換股紅燈與市場入口修改；本次接續完成單檔健檢、公開測試及正式 App 驗收，沒有覆寫 01～08 的歷史。

## 修改與契約

市場分析及單檔庫存健檢是目前兩個逐段顯示入口。兩者共用 `utils/framePublisher.ts`：只保留下一個影格要顯示的累積全文，同一影格合併常規提交；完成立即提交最終全文，不等動畫影格。服務輸入拼接、NDJSON、AI 快取、提示詞、模型及金融資料組裝未改。

市場換股、換週期、重新分析及離開市場會使舊顯示工作失效；已進行的服務請求依原協定完成，沒有新增傳輸中止協定。單檔健檢仍按股票保存結果，切到另一股票不混入舊內容；同股新健檢、批次取代、移除及卸載取消過時畫面排程。批次健檢仍等全文完成才按股票分配，沒有對不可分割的部分文字做推測。原有部分失敗警告與成功快取政策維持原樣。

## 實測

相同 100 KiB UTF-8 Markdown、1,000 片段，包含標題、一張兩列資料表、兩項清單及跨片段文字。前後都用相同 development React 與公開 React.Profiler 包裝實際 Markdown 元件；不讀私有 React state。每版本 sample0 冷頁面，sample1 排除暖機，sample2～6 五次取中位數。

| 指標 | 修改前 | 修改後 |
|---|---:|---:|
| 內容變更提交次數中位數 | 997 | 1 |
| Markdown Profiler 累計渲染中位數 | 17,377.5 ms | 52.2 ms |
| 整段操作完成中位數 | 25,973.4 ms | 476.2 ms |
| 串流完成至觀察到全文的中位數 | 56.3 ms | 77.6 ms |
| 首次冷頁面整段完成 | 26,489.6 ms | 542.5 ms |

這是 MessageChannel 逐事件送入假 HTTP body 的快速片段壓力情境，全部片段在正式影格提交前可能已到齊，因此一次完成提交是有效結果；慢片段及暫停影格另外驗證。development Profiler 成本與本機排程不代表正式使用者的網路或端到端收益；完成觀察延遲亦未宣稱改善。所有原始樣本均保留。

14 份量測逐份比對輸入、服務累積結果、AI 快取、最終公開 props 與可讀文字雜湊。`stream-summary.json` 同時列五次 median／worst、冷頁面、工具／來源指紋及原始檔雜湊。只比較同一文字口徑，Markdown 原文與渲染後可讀文字使用各自預期 hash。

正式 Vite build 另跑 **15 項 App 案例**：全文主路徑、空／單片段／慢片段、部分及全失敗、暫停影格後立即完成、快取回填、換股、重啟分析、離開市場、單檔健檢、健檢換股、卸載、批次取代。全部通過。`before-switch-0.json` 保存修改前換股後舊報告回填的紅燈；`precheck-app-restart-0.json` 為驗收工具只認 Yahoo 名稱的等待錯誤，修正為股票代碼與載入狀態後整組 App 重新執行，沒有放寬全文或世代斷言。

新增 6 項公開 framePublisher 測試；完整 gate **47 檔／805 項通過**，型別、build、秘密掃描無降級，50 個既有測試／snapshot／依賴檔案保持雜湊不變。首屏 **289.30 KiB raw／94.96 KiB gzip**，相對 01 仍低於 5% 調查門檻。

## 重跑與限制

```powershell
node .scratch/optimization-followup/evidence/check.mjs 09 gate
node .scratch/optimization-followup/evidence/09/fixture-server.mjs
```

4182 專屬 origin：`/profile?version=before&sample=0&auto=1` 與 `version=after` 各跑七頁；`/?edge=empty&auto=1` 跑14個邊界；`/?case=market&auto=1` 跑正式App全文。最後執行 `node .scratch/optimization-followup/evidence/09/summarize.mjs` 及 `check.mjs 09 verify`。

所有應用 API 由本機假站終止、未知與真實 AI 路由拒絕；固定時鐘、合成持股與獨立 origin 儲存。發現 Desktop 歷史 buffer 丟棄70筆事件後，補上頁面載入前的 `console.error` 捕捉並以新工具指紋重跑全部14份量測與15份App結果；未處理例外、Promise拒絕及console.error均為0。舊一輪保存於 `precheck-diagnostics/`，不作最終結論。既有 Recharts warning 不當成錯誤，也未藉此宣稱全程零診斷訊息。

一鍵重跑整批：`/profile?version=before&sample=0&auto=1&pipeline=1`，成功後依序前進到 after 七份、App十四個邊界與全文主路徑。統計只讀最上層正式原始檔，不會混入 precheck。

`app-native-0.json` 另保存 Desktop 三次原生點擊（AI分析、空手、開始），確認完整1,000片段報告、實際可讀文字及零錯誤；AI模組在操作前資源請求數為0，開始分析後為1。此原生案例與15項自動App案例分開計數。

本票不宣稱螢幕閱讀器或跨尺寸矩陣已完成。獨立雙軸覆核、後續修正及清理紀錄於關票時補齊。
