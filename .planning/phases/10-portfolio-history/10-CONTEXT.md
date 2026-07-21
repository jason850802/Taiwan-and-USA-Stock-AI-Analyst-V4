# Phase 10 CONTEXT：庫存歷史損益折線圖（設計決策）

日期：2026-07-21。規劃：Fable（主對話）＋2 Explore 偵查＋1 Plan 設計。執行：Codex。覆核：Opus/Sonnet。

## 需求（使用者原話拆解）

「我的庫存：規劃歷史的資產變化線圖，根據每天的即時損益去畫出歷史的損益折線圖，可能要分成已實現跟未實現。」

## 使用者拍板決策（AskUserQuestion 四題，2026-07-21，不得重開）

- **D-01 歷史來源＝快照累積＋回推補歷史（hybrid）**：上線後每天自動存損益快照；`PortfolioItem` 新增 `buyDate` 欄位，用歷史股價回推上線前的未實現曲線。已否決：純快照（歷史空白太久）、純回推（已賣部位會被追溯改寫）。
- **D-02 已實現損益＝新增賣出功能＋帳本**：表格加「賣出」操作（賣價/股數/日期），自動扣費稅算已實現損益存成有日期紀錄，持股同步減少；股利計入已實現。已否決：已實現只算股利、本期不做已實現。
- **D-03 圖表＝三線可切換**：未實現／已實現（累計）／總損益，預設顯示總損益＋未實現。
- **D-04 幣別＝台美分開兩張圖**：台股圖 TWD、美股圖 USD，**不做匯率換算、不需要歷史匯率**。唯一例外：美股 lot 既有資料就有 TWD 計價成本（`purchaseCurrency==='TWD'`）與 TWD 計價股利（表格註記 stored in TWD），畫 USD 圖時必須除以即時匯率——沿用表格現行語意，非新增歷史匯率資料源。

## 偵查釘死的關鍵程式碼事實（決定設計的四件事）

1. **`PortfolioItem` 沒有買進日期、沒有賣出/交易紀錄**（types.ts:100-114）。`form.buyDate` 只是 AI 分析的暫存表單欄位（Portfolio.tsx:740-741），從不落地。→ buyDate 為 additive optional 欄位，舊資料 undefined＝未填。
2. **`totalCost` 含買進手續費**（handleAdd，Portfolio.tsx:846-887：avg 模式 totalCost=base+buyFee）。→ 部分賣出對 totalCost 直接等比縮減即可，buyFee 欄位純紀錄同步縮減。
3. **費稅 floor 粒度程式庫本來就不一致**：StatCards（:1111-1121）與群組表頭（:181-186）per-lot 各自 floor 後加總；symbol 列（:240）合併一次 floor，可差 1-2 元。→ 快照採 **per-lot**（對齊 StatCards，使用者拿圖表尾點對 StatCard 總損益），既有不一致**不得順手修**。
4. **美股 lot 的 `cashDividends` 以 TWD 計價**（UsGroupTable :448-449 註解與 `/rate` 換算）。→ USD 圖的含息元件必須過匯率，快照守衛需涵蓋「匯率抓取失敗」。

另：全專案無任何時間序列持久化先例（快照機制從零建）；`getStockData(symbol,'1d')` 免費給 10 年日線＋雙層快取＋台股 FinMind fallback；多檔併發先例＝健檢 3-worker 游標池（:1019-1028）；圖表範本＝components/fundamentals/MonthlyRevenueChart.tsx（recharts ^3.6.0、深色硬編、紅漲綠跌）。

## 工程決策（D-05 起，理由附）

- **D-05 快照存「可加成的分解量」不存算好的損益**（marketValue／totalCost／estSellCosts／cashDividends）：含息/不含息是顯示期偏好（表格有 toggle），存結果會把偏好燒死進歷史；存分解量三條線與含息開關都在渲染期組合。
- **D-06 股利守恆移轉**：賣出時把 `(lot.cashDividends × sharesSold / totalShares)` 從 lot 扣除、寫入 trade 的 `divCarried`。未實現含息用快照的持有側股利、已實現線用帳本累計＋divCarried 累計，兩側合計守恆，總損益線在賣出日不跳水。
- **D-07 已實現累計不存快照**：single source of truth＝帳本，渲染期做 sellDate 累計階梯。刪帳紀錄自動反映，不需清洗快照。
- **D-08 upsert 規則只有兩條**：live 覆蓋一切同鍵（(market,date)）舊列；backfill 永不覆蓋既有列。重算回推＝先清該市場全部 backfill 列再重生成。
- **D-09 回推結果持久化為 `source:'backfill'` 快照＋手動「建立/重算歷史」按鈕**，不自動跑：每次重算要 N 檔×10y getStockData（60/分限流），冷開 App 自動跑既慢又打爆限流；持久化後開圖零網路。
- **D-10 美股 TWD 計價 lot 的回推**：整段用執行當下即時匯率單一換算（記入快照 `usdTwdRate` 欄）。理由：表格今天就是這樣顯示成本的（itemCostInDisplay :429-435），圖表尾端才對得上表格；排除該 lot 會造成成本基底跳階，比匯率不精確更誤導；D-04 已拍板不引歷史匯率。
- **D-11 回推區間不畫已實現線**（誠實方案）：已實現線從帳本第一筆 sellDate 起才有點；無任何帳本時該勾選 disabled（D-03 預設本來就不含已實現）。使用者補登歷史賣出時，tradesCum 在回推區間自然有值，數學上無需特判。
- **D-12 快照觸發＝單一 debounced effect**（Portfolio.tsx 內 `[items, prices, usdTwdRate]` → 800ms → snapshotTick）：天然涵蓋開 App 首抓、手動更新報價、增刪改/賣出、匯率到貨；只寫 localStorage 不寫 state，無迴圈。不 hook fetchAllPrices（N 個獨立 promise 無完成訊號，改它要動併發結構）。
- **D-13 快照日期＝該市場最後一根有效 close 的交易所當地日期**：additive 擴充 `getLatestPrice` 回傳 `date?`（用檔內既有 formatExchangeDate，交易所時區、天然禁 toISOString）。全專案僅 Portfolio.tsx 兩個呼叫端，零破壞。否決「改用 getStockData 取日期」：每 symbol 多一次 10y 抓取，撞限流。
- **D-14 回推用 raw `close` 非 closeAdj**：Yahoo close 已做 split 追溯調整未做除息調整——今日股數×歷史 close 不被 split 打爆，除息日下跌是當日真實未實現損益，與表格語意一致。FinMind fallback（台股）為原始價，台股 split 極罕見，記已知限制。
- **D-15 回推/實況視覺區分＝ReferenceArea 底色**，否決 mid-line 虛線切換（3 線×2 段＝6 條 dataKey＋共享邊界點，複雜度不值）。

## 已知限制（誠實揭露，寫進 UI 文案/文件，不偽裝）

1. 盤中快照非收盤價：使用者當天最後一次開 App 在 10:00，該日快照就是 10:00 的價。同日 upsert 已最大化緩解；無輪詢架構的固有精度。
2. live 世代中間缺日（幾天沒開 App）v1 不回填，圖表稀疏點連線。
3. 全賣的 lot 從 items 消失，之後「重算回推」不含其歷史組成（v2 選項：全賣時在 trade 內留 lot 快照）。
4. 回推曲線語意＝「以今日帳務結構套當日價格」（§3.4 逆推只能還原賣出，還原不了股利入帳時點/手改成本時點）。
5. 無 buyDate 的 lot 排除於回推（UI 明示），排除造成回推/live 邊界跳階——誠實呈現不平滑。

## 與 Phase 09 的關係

Phase 09（gsd/phase-llm-latency，已部分執行未合併）動 App.tsx:163-201＋services/gemini.ts＋api/**。本案 App.tsx 只准動 :71-117 鄰域（庫存 state/handler），與 09 區塊不重疊但 import 區可能小撞。**建議：Phase 09 先合併 main，本分支 rebase 後再進覆核**；若順序相反，合併時 import 區手解即可。
