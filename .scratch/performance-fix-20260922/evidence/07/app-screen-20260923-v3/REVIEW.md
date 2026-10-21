# 06 畫面時間補測（2026-09-23）

## 協定與身分

合成 App 使用 `app-acceptance.jsx` 的固定回應，不呼叫真 AI。before 是 `444d6b1` 隔離 runtime（127.0.0.1:4326），after 是 `6eee87e` 隔離 runtime（127.0.0.1:4327）；兩頁各使用全新 origin、1280×720 可見瀏覽器面板。`app-screen-capture.mjs` 每步檢查 `document.visibilityState === 'visible'`，以 Enter keydown 或週期 click 起點計時；DOM 須同時顯示目標股票、目標週期、K 線且無載入骨架，再記下一個 rAF。台股 context 另核籌碼副圖。rAF 超過 2 秒即判失敗。

原始檔 `screen-before-desktop-full-visible-v2.json` 與 `screen-after-desktop-full-visible-v2.json` 各有完整 14 項、`timedOut=false`、`pageErrors=[]`、`unhandled=[]`。兩側冷搜尋各 2 個 chart request，週／月／1時／15分各 1 個，同頁暖回訪及切回日線皆為 0 個。所有資料在瀏覽器本地合成，沒有混用真上游。

## 同方法配對（第一個可繪製 K 線，毫秒）

| 操作 | before | after | chart 請求 before／after |
|---|---:|---:|---:|
| 2317 冷搜尋 | 990.2 | 1010.6 | 2／2 |
| AAPL 冷搜尋 | 1397.2 | 1379.3 | 2／2 |
| 2317 暖回訪 | 1257.0 | 1271.6 | 0／0 |
| 2317 週 | 627.3 | 628.0 | 1／1 |
| 2317 月 | 663.8 | 692.4 | 1／1 |
| 2317 1時 | 294.0 | 312.3 | 1／1 |
| 2317 15分 | 937.2 | 905.5 | 1／1 |
| 2317 日 | 397.3 | 409.2 | 0／0 |
| AAPL 暖回訪 | 921.1 | 892.6 | 0／0 |
| AAPL 週 | 597.5 | 603.3 | 1／1 |
| AAPL 月 | 631.8 | 642.1 | 1／1 |
| AAPL 1時 | 243.5 | 248.1 | 1／1 |
| AAPL 15分 | 901.3 | 892.8 | 1／1 |
| AAPL 日 | 1014.9 | 1016.0 | 0／0 |

這是單輪合成資料畫面觀察，before／after 數值接近；不把數十毫秒差異宣稱為穩定效能收益。`app-screen-20260923-v1/screen-before-desktop.json` 的 4 項與 `screen-after-desktop.json` 的 14 項亦是在面板可見時取得，保留為另一量測方法的有效參照；其冷搜尋 DOM 約 175～213 ms、可繪製約 487～636 ms，暖回訪約 610～620 ms。新探針採 DOM 輪詢及完整交互序列，絕對毫秒值與舊檔不同，故只比較同方法的本次配對。舊 `screen-before-desktop-full.json` 量測中途面板在背景，rAF 受節流，整檔無效。

重跑時以新 run-id 啟動 `capture-evidence-07.mjs`，並以新 port 分別啟動 before／after Vite；將 `app-screen-capture.html`、`app-screen-capture.mjs` 複製到兩個 runtime，瀏覽器面板設 1280×720 且保持可見，再開 `app-screen-capture.html?variant=before|after&capture=http://127.0.0.1:<capture-port>`。工具拒絕同名證據覆寫。量測後服務均已停止。
