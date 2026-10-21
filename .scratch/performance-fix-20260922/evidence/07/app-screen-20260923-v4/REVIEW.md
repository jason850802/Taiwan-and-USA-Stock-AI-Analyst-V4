# 06 可見面板畫面時間與來源重核（2026-09-23）

## 來源與方法

此輪保留 v3 所有檔案，另以未用過的 4330／4331 port 重量 before／after 完整 14 項。瀏覽器面板保持可見並設定 1280×720；每步檢查 `visibilityState`，以 Enter／click 起點，到目標 K 線、週期、無骨架的 DOM 及下一個 rAF 為畫面時間。合成固定回應，沒有真 AI 或真上游請求。

`before-source-before.json`、`before-source-after.json`、`after-source-before.json`、`after-source-after.json` 分別在每頁量測前後記錄當時 listener PID、實際服務的探針內容雜湊，並核對產品副本 manifest 與先前真行情 `identity.json` 的 before `444d6b1`、after `6eee87e` 身分一致。新增的合成 App 探針四檔逐檔與工具來源雜湊相同。這些來源核對在量測時完成；Windows 程序命令列因權限限制未取得，服務啟動命令由本輪執行紀錄補充。

兩個 `screen-*-desktop-full-visible-v2.json` 各 14 項、`timedOut=false`、`pageErrors=[]`、`unhandled=[]`。每側冷搜尋兩支 chart；週、月、1 時、15 分各一支；暖回訪及切回日線均為零支。before／after 服務與收集器量測後停止。

## 同方法配對（首次可繪製 K 線，毫秒）

| 操作 | before | after | chart 請求 before／after |
|---|---:|---:|---:|
| 2317 冷搜尋 | 573.4 | 559.3 | 2／2 |
| AAPL 冷搜尋 | 709.7 | 696.9 | 2／2 |
| 2317 暖回訪 | 637.0 | 637.7 | 0／0 |
| 2317 週 | 412.0 | 413.2 | 1／1 |
| 2317 月 | 300.2 | 306.0 | 1／1 |
| 2317 1 時 | 171.1 | 171.6 | 1／1 |
| 2317 15 分 | 520.6 | 524.6 | 1／1 |
| 2317 日 | 163.5 | 158.4 | 0／0 |
| AAPL 暖回訪 | 405.5 | 413.7 | 0／0 |
| AAPL 週 | 413.1 | 420.1 | 1／1 |
| AAPL 月 | 185.3 | 185.3 | 1／1 |
| AAPL 1 時 | 135.7 | 139.0 | 1／1 |
| AAPL 15 分 | 497.3 | 510.5 | 1／1 |
| AAPL 日 | 491.4 | 490.6 | 0／0 |

此為單輪固定資料觀察，兩側相近，不能由數毫秒差推論穩定收益。v3 的完整配對保留作另一輪參照，其絕對時間比 v4 高；不跨輪求改善率。更舊的 `screen-before-desktop-full.json` 曾讓面板轉背景，整檔無效；舊 `screen-after-desktop.json` 的量測方法不同，不與此輪配對。
