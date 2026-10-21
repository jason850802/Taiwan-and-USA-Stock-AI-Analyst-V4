# S1 持股輸入失效驗收

本目錄只承接新案 02。`tools/runs/`、`tools/formal-runs/` 與未完成的 UUID run 都是保留的 precheck／失敗原始紀錄；只有最終 seal 明列的 hook 與 formal run 可作關票證據。工具不搜尋最新或任意 `passed` 檔，也不覆寫同案例結果。

## 已保存欄位與成本來源

下表是既有 `buildHealthItem` 實際讀取路徑。S1 的輸入識別只記錄 lot `id`、`totalShares`、所選成本分支與該分支原始成本值；計算仍由原函式執行，沒有複製或修改金額公式、單位、精度、匯率 fallback 或提示詞。

| 市場／條件 | 健檢成本來源 | 輸入識別 | 不因本案自動失效 |
|---|---|---|---|
| 台股 | `totalCost` | `id`、`totalShares`、`TWD` 分支、`totalCost` | 即時報價、即時匯率、顯示狀態 |
| 美股，`purchaseCurrency === 'USD'` 且 `totalCostUSD != null` | `totalCostUSD` | `id`、`totalShares`、`USD` 分支、`totalCostUSD` | 未採用的 `totalCost`、即時報價／匯率 |
| 美股其他情況 | `totalCost / rate`（原路徑） | `id`、`totalShares`、`TWD` 分支、`totalCost` | 即時匯率本身；手動重跑時才讀當下匯率 |

lot 條目在每股票內排序後形成穩定識別，所以陣列重排與相同值的新物件不失效；新增、刪除或換成另一個 lot `id` 會失效。草稿只有在既有表單保存並由父層提供新 `items` 後才參與比較。

## 正式矩陣

- 公開 hook：S01～S13 共 27 個案例。包含完成／在途、partial／error／finally、成本 fallback 與提示詞實值、行情／匯率重跑、準備期與動態 import、A→B→A、單檔／批次交錯、移除重加、失敗子集、development StrictMode 及卸載重掛。
- production dist：桌面 1440×900 與窄版 390×844 各一輪，使用真鍵盤、Tab／Shift+Tab／Escape、表格展開收合、顯示幣別、既有保存入口、stale 視窗與手動重跑。
- 假服務只接受 `127.0.0.1` 同源，未知 API 回 403；沒有真實 AI、真實持股或外部網路請求。
- `s1-negative.mjs` 另外驗證重複結果、錯誤頁面身分、未知案例、過期 URL、缺案、raw／input 漂移與多餘檔案均被拒絕。

最終操作順序為：正式 build 與工具凍結 → 新 UUID hook／formal run → 協定反例 → 最終完整 gate 與首屏量測 → 獨立 Standards／Spec → seal。最終 gate 重新建置後須由 run verifier 核對 dist 指紋未漂移；任何產品、工具或 dist bytes 改變，都保留舊 run 並另建完整新輪。
