# 最終市場原生鍵盤驗收

來源：03原有隔離假站，由12的`replay-server.mjs 03`另存輸出；不改03歷史結果。正式App由當前dist載入，同源iframe依次設定1440×900與390×844。

每種尺寸各17次`Desktop.browser_action(action=key)`，事件紀錄皆`isTrusted=true`；`browser_evaluate`只用來定位起點、等待公開DOM／HTTP結果及讀值，沒有合成鍵盤事件：

1. 焦點定位搜尋框，原生Control+A、Backspace；確實讀到空字串。
2. 原生2、3、3後等待本地名錄出現`2330／驗收台股`；ArrowDown、Enter選取，選單關閉且查詢2330、價格150.00。
3. 搜尋框Control+A、A、A、P、L、Enter；正式App顯示AAPL及222.00。
4. 依序將焦點定位週、1時、日按鈕，再各用原生Enter啟動；逐項核對實際Yahoo假HTTP的1wk、60m、1d成功結果與畫面。
5. 將焦點定位放大按鈕後原生Enter，實際主圖K棒數64→51；未捕捉例外0、無整頁水平溢出。

兩份原始檔：`replay-03/desktop-manual-market.json`及`narrow-manual-market.json`。保存讀值、真實key事件、API序列、94個來源、使用工具及build指紋；`verify-replays.mjs 03`逐項檢查。指標均線設定的原生ArrowUp、Tab、Space及焦點保持另由12的鍵盤完整矩陣驗證，不以這兩案代替。
