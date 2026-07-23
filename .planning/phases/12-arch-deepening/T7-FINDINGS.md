# T7 人工驗證發現分類（2026-07-23）

使用者實機驗證回報 7 項，依 12-PLAN T7 步驟 7 的判準逐項分類
（比對 `git show main:<檔>` 與現場重現）。結論：**7 項中 0 項為本期改壞**；
1 項當場修掉（顯示文字），其餘為舊 bug／舊行為／誤會，記錄如下不擋合併。

## 逐項判定

### 1. 刪除持股後，數據仍計入台股損益歷史 — 舊 bug（Phase 10/11 遺留）
兩層機制，main 行為完全相同：
- **交易流水未同步刪**：`utils/txnStore.ts` 的 `removeTxnByKey` 註解明寫
  「刪除持股／刪除帳本紀錄時同步」，但 `App.tsx` 的 `handlePortfolioDelete`
  從未呼叫它（main 亦然，僅 `setPortfolioItems(filter)`）。新增持股（含買進日）
  寫入的 `manual|lot|<id>` 買進流水在刪除後殘留 → 重算回推會把已刪持股算回曲線。
- **空市場舊快照殘留**：`computeLiveSnapshot` 於 `lots.length===0` 回 `null`
  → 刪掉該市場最後一檔後，當天已寫入的 live 快照永不被覆蓋。
**待辦**：`handlePortfolioDelete`／`handleRealizedTradeDelete` 接上 `removeTxnByKey`；
空市場時考慮清掉當日 live 快照。動 App.tsx 資料層，不宜在 T7 熱修，另立任務。

### 2. 刪除已實現賣出紀錄後，美股曲線不變 — 舊行為（UI 已明示）＋同上舊債
- `RealizedLedger` 標題明寫「刪除僅移除帳面紀錄，不會回復持股」——設計如此。
- 曲線的歷史段來自快照（史料）＋交易流水；`handleRealizedTradeDelete` 只過濾
  React state，流水（含 `manual|trade|<id>`）與快照都不動 → 需重算回推才反映，
  且流水殘留時重算也不會消失（回到第 1 項的待辦）。
**待辦**：與第 1 項合併處理；另可在刪除時提示「歷史曲線需重算回推後更新」。

### 3. 美股個股費率標示 0.008% — 顯示錯誤（已修），計算正確
`calcUsFee = valueUsd * 0.0008` ＝ **0.08%，計算無誤**（36c0f41 已修常數，
且有對帳單實收金額的費率鎖測試）。錯的是三處介面文字（改常數時漏改標籤）：
Portfolio.tsx 頁首、新增持股 modal 按鈕、HoldingsTable 批次徽章。
**本次修正**（三處字串 0.008% → 0.08%），HMR 實測三處皆已顯示 0.08%。

### 4. 關 3001 後健檢文案台美不同 — 非 bug，兩條失敗路徑各說各的實話
- 2330：使用者稍早在儀表板看過 2330 → `getStockData` 有 session 快取 →
  行情**取得成功**，掛在後面的 Gemini 呼叫（後端已關）→ 走原有通用文案
  「庫存健檢分析失敗」。
- AAPL：報價表用 `getLatestPrice` 不暖 `getStockData` 快取 → 行情**抓不到** →
  走 T3 新分流「行情後端目前無回應，請確認網路或稍後再試」。
T3 範圍明訂只分流「行情抓取失敗」；LLM 呼叫失敗仍是通用文案。
**待辦（可選）**：`analyzePortfolioHealth` 的 catch 也依 kind 分流。

### 5. 按重算回推沒反應 — 非本期回歸（已實測排除），最可能是時機問題
現場重現（現行碼、後端開）：按下「建立歷史曲線」→ 2.5 秒內完成、
產出 279 筆快照（起點＝買進日 2025-06-02）——**管線正常**。
最可能情境：使用者按下時 3001 仍關著（做完第 4 項測試後）→ 首輪抓取秒失敗 →
進入 45 秒退避，按鈕僅顯示一行小字「限流中，45 秒後重試…」→ 視覺上像沒反應，
約 95 秒後才出紅字錯誤。
**請使用者後端開著再按一次確認。**
**待辦**：`progressLabel` 的退避文案硬編「限流中」，後端關閉時誤導
（kind 是 BACKEND_DOWN 卻寫限流）——退避狀態應吃 kind 分流。

### 6. 00679B 分析 — T1 修正生效，報告正常；一處舊顯示瑕疵
`.TWO` 名錄直達、FinMind 中文名（元大美債20年）、量能單位「張」、
濾網與 AI 報告內容一致（NO_GO 邏輯連貫、MA20 數字對齊圖面）→ 台股路徑 ✓。
唯一異常：濾網卡顯示收盤價原始浮點 `26.700007629394531`
（`EntryChecklist.tsx:26` 直接渲染 `result.price`，本期零 diff → 舊 cosmetic）。
**待辦**：顯示處 `toFixed(2)`（注意別動到餵給 LLM 的數據組裝）。

### 7. 按鈕旁大片空白／健檢視窗右上角直角 — 舊 UI 瑕疵（本期零 diff）
- 空白：頁首按鈕列 `flex-wrap` 在特定視窗寬度換行的既有表現（該段 JSX
  自 T6a 起位元組未動，對 main 零 diff）。
- 直角：`Modal` 的 `rounded-modal`（1rem）存在，但容器 `overflow-y-auto`
  的捲軸蓋掉右上圓角（Modal.tsx 本期零 diff）。
**待辦**：UI 微調另立（頁首按鈕分組換行策略；Modal 捲軸圓角
`scrollbar-gutter` 或內層滾動容器）。

## 待辦彙總（不擋合併，建議下次 /gsd:quick 或另立 phase 收）
| # | 事項 | 檔案 |
|---|---|---|
| B1 | 刪持股／刪帳面紀錄接 `removeTxnByKey` 同步流水；空市場清當日 live 快照 | App.tsx、utils/portfolioHistory.ts |
| B2 | 刪帳面紀錄時提示「曲線需重算回推」 | components/portfolio/RealizedLedger.tsx |
| B3 | Gemini 呼叫失敗文案依 kind 分流 | components/portfolio/useHealthCheck.ts |
| B4 | 回推退避文案吃 kind（後端關≠限流） | components/portfolio/PnlHistorySection.tsx |
| B5 | 濾網卡收盤價 `toFixed(2)` | components/EntryChecklist.tsx:26 |
| B6 | 頁首按鈕換行空白／Modal 捲軸蓋圓角 | components/Portfolio.tsx、components/ui/Modal.tsx |

（另有 T6b 期記錄：US 表 USD/TWD 模式報酬率 ±0.01% 捨入差；
useHealthCheck 內 buildHealthItem 第三處硬編 32——見 627cf95 commit message。）
