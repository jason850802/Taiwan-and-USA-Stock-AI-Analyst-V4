# 08 獨立雙軸覆核

固定比較點：`d80a8941344a6c3f1e4bdf93c09ce636564a677f`。
程式封板候選：`4c48eb7c075e9eafcae6ae7c028e2f5183cd0cda`；merge-base 為固定點，區間一個提交。

```text
git diff d80a8941344a6c3f1e4bdf93c09ce636564a677f...4c48eb7c075e9eafcae6ae7c028e2f5183cd0cda
git log d80a8941344a6c3f1e4bdf93c09ce636564a677f..4c48eb7c075e9eafcae6ae7c028e2f5183cd0cda --oneline
```

## 前置方法覆核

獨立 reviewer 在量測開始前指出兩項方法缺口，均已修正並覆核關閉：

1. 原量測只看主 Map，無法識別旁邊的 LRU 索引保留孤立 payload。現以記憶體編譯的唯讀探針另記 quote payloadLru、fund memoryLru 與 session 閉包索引，逐份核對數量、key 對應及 orphan 為零。
2. 正式 App 指紋原本只列已追蹤來源，也沒有阻擋過舊 build。現涵蓋新增尚未追蹤的正式來源，並於啟站前拒絕比候選來源更舊的 dist；正式 gate 重建後才驗收。

首批 30 檔校正樣本之後，另以公開測試確認暫時 denied 下移除失敗會讓舊 session 復活；追加兩個紅燈案例並修復 namespaceDirty 降級清理。此修正由程式作者執行，作者不擔任本票獨立 reviewer。完整 gate 更新至 46 檔／799 項全綠，壓力矩陣以新來源／工具指紋全部重跑。

## Standards

由未參與 08 實作的獨立 `5.6 high` reviewer 檢查完整程式封板候選與 Fowler 基線：產品正確性／安全 0 項，Fowler 判斷項 0；1 項 Medium 驗收證據發現。

**發現：**摘要只彙總第一輪服務耗時，沒有列出第二、三輪的重抓成本，違反 07 決策要求同時交付命中、請求與耗時。原始檔保留完整數字，但不能要求讀者自己從大量 JSON 找出代價。

**處置：**`summarize.mjs` 現在對每份樣本保存三輪耗時、合計與完整頁面耗時，各自計算五次中位數及最差值；07 比較數字直接讀歷史原始樣本，不改寫歷史。README 同時列第一／二／三輪及合計、全部重抓次數與命中率降低；26 項新增測試及產品碼未因文案修正而改動。

**最終封板：CLOSED 1／OPEN 0／NEW 0。** Reviewer 逐份程序重算三輪與總耗時、113 個 retained snapshots、14 份輸出 digest、5 頁 App、6 個 source 與 51 個 evidence 的 hash／bytes，全部一致。沒有缺檔、未列檔或指紋漂移；產品碼與封板候選零後改。資料容量與全量重抓的代價已完整揭露。

## Spec

另一獨立 `5.6 high` reviewer 已核對程式／測試／工具：missing/partial、scope creep、implemented-wrong 均 0，OPEN:0。當時量測尚在跑，因此要求最終再核對完整證據，不將程式預檢冒充全票已關閉。

14 份 profile、faults、5 頁正式 App 已實跑通過；`verify-results.mjs` 成功逐份核對來源／工具、索引、容量、完整輸出與 sentinel，結果保存 `verified-results.json`。

**最終全票封板：OPEN 0／NEW 0。** Reviewer 獨立核完原始樣本、容量／旁索引、跨日、全部與近期重訪、App 實際數字、各階段指紋及三輪耗時；missing/partial、scope creep、implemented-wrong 均為 0。不是僅程式預檢結論。
