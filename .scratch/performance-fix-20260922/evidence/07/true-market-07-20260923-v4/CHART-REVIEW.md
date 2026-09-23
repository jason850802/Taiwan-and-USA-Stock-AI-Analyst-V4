# 十檔 K 線真行情重新判定（2026-09-23）

原始 `chart-*.json` 與 `resource-chart-*.json` 不改寫。探針的 `httpStatusNon200` 把 10y 已先到、依設計取消的同 symbol 2y `AbortError` 算為失敗；本分析逐支確認：只有在同 symbol 10y HTTP 200 且 `bodyMs` 早於 2y 取消時，該 2y 才列為「被取代」並從非預期失敗排除。其他錯誤仍須判 FAIL。

| 頁面 | 首批有效 K 線中位數 | 完整歷史中位數 | cold／warm chart 請求 | 原始非 200 | 被取代 2y | 其他錯誤 | 重判 |
|---|---:|---:|---:|---:|---:|---:|---|
| before pair 1 | 4613.8 ms | 5073.5 ms | 20／0 | 0 | 0 | 0 | PASS |
| after pair 1 | 4646.7 ms | 4946.3 ms | 20／0 | 2 | 2（2308.TW、0050.TW） | 0 | PASS |
| before pair 2 | 4758.5 ms | 5008.4 ms | 20／0 | 1 | 1（AAPL） | 0 | PASS |
| after pair 2 | 4598.0 ms | 5072.0 ms | 20／0 | 0 | 0 | 0 | PASS |

四頁各 10/10 cold 與 10/10 warm 有效、35 個真上游請求、Resource Timing 快取命中 0、HTTP 429 為 0、`pageErrors=[]`、本體五鍵不變。三個 AbortError 都符合上述被取代條件，沒有其他非 200；因此 after pair 1 與 before pair 2 的原始 `pass=false` 是探針分類錯誤，重判為 PASS。此重判只調整錯誤分類，不改動原始資料或時間值。

before／after 首批與完整歷史數值相近，沒有可宣稱的穩定提速；暖回訪 0 請求證明原有快取行為保留。這是十檔真上游 hook 觀察，畫面時間另看合成 App 的 `app-screen-20260923-v3/REVIEW.md`，不把 HTTP 完成時間當成畫面可見時間。
