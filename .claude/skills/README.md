# 進場分析 Skills（朱家泓技術分析 · 做多進場）

依《技術分析初階班》與《進階班》講義，把「六六大順選股」流程拆成 7 個可逐步執行的 Claude Code skill。

## 使用方式
對 Claude 說：「**用進場分析幫我看 2330**」或「**分析 AAPL 能不能進場做多**」。
Claude 會依序執行步驟 1–6 並由步驟 7 彙總出進場結論。也可單獨叫用任一步驟。

| 順序 | Skill | 判斷 |
|----|-------|------|
| 1 | `trend-analysis` | 趨勢（多/空/盤，頭頭高底底高） |
| 2 | `position-analysis` | 當下位置（打底/初升/主升/末升…） |
| 3 | `kline-signal` | K線轉折（單一+組合K棒、關鍵進場K線） |
| 4 | `ma-structure` | 均線架構（3線多排、站上月線） |
| 5 | `volume-analysis` | 量價（攻擊量、出貨量、背離） |
| 6 | `indicator-analysis` | 指標（KD、MACD、缺口、型態） |
| 7 | `entry-decision` | 彙總：SOP 6 必要條件＋進場口訣＋10大戒律＋停損停利 → GO/等待/NO-GO |

## 資料來源
`_shared/fetch_stock.py <股號>` 抓 Yahoo Finance 日線(1y)＋週線(5y) OHLCV，
計算 MA5/10/20/60、量能、KD、MACD、轉折波與趨勢判定，輸出 JSON。
- 台股：純代碼自動試 `.TW` → `.TWO`（上櫃）。美股：直接代碼。
- 同一次分析只抓一次，後續步驟沿用同份 JSON。

## 指標參數（可在 fetch_stock.py 頂部調整）
- KD：5, 3, 3（講義實戰參數，與 App `calculateKDJ` period=5 一致）
- MACD：10, 20, 10（講義實戰參數，與 App `calculateMACD` 10,20,10 一致）
> 參數已對齊講義與 App 圖表；如需調整改 `fetch_stock.py` 的 `KD_*`、`MACD_*` 常數即可。

## 免責
本框架為技術面教學流程之推演，非投資建議；實際進出場由使用者自負。
