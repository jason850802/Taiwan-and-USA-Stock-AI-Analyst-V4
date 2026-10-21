# S1 Spec 預覆核

狀態：**PARTIAL／OPEN（非最終通過）**
比較點：`db2c8cb9dbf64f04b92af22264b80d209d72dead`
範圍：`components/portfolio/useHealthCheck.ts`、`components/portfolio/HoldingsTable.tsx` 的未提交差異，以及當時 `evidence/02/tools/` 與 18 份 precheck raw。

## 產品 correctness

持股簽名涵蓋 lot id、股數、實際成本分支與成本值，並排除排序、無關欄位、行情與即時匯率；單檔／批次共享 per-symbol 世代，批次送 AI 前再次剔除失效輸入，完成、錯誤及 batch finally 皆有主要世代守衛。stale 會移除舊判定與全文、保留已開視窗、提供手動重跑入口，且不列入服務失敗。

- **S1-PRE-01（S1-04）— OPEN。** 當時 `healthFetchKindRef[symbol]` 由非同步舊工作直接寫入，再由目前工作讀取，錯誤副狀態未綁同一請求身分。此處其後已改為局部 `PreparedHealthItem.fetchKind`，屬預覆核後的新來源，須由最終覆核及新證據確認，不能以本報告關閉。
- 除 S1-PRE-01 外，當時兩個產品檔未發現可確證的主狀態覆寫 bug；此結論不涵蓋預覆核後改動。

## 待補案例／證據

1. **S03／S1-02、S1-07：**補美股已在 TWD fallback 分支再改 `totalCost`、`purchaseCurrency: USD` 但缺 `totalCostUSD` 後補值，並直接證明新 prompt 使用明顯不同成本／股數；只有 prompt hash 不足。
2. **S07／S1-03、S1-07：**補行情／匯率更新後手動重跑確實讀取新值，且未改既有快取契約。
3. **S02、S11／S1-04、S1-06：**補舊 partial、舊 error、批次 error 晚到，以及舊 finally 不清除新 loading／busy 的可見讀值。
4. **S05／S1-02、S1-03：**補展開／收合與顯示幣別切換不失效、不增加 AI 請求。
5. **S12／S1-05：**補既有 error 在持股變更後轉 stale，且不留在 `failedHealthSymbols`、不增加重試失敗數。
6. **S13／S1-08：**production bundle 中 `<StrictMode>` 不會重播 effect；須補真正 StrictMode active-request replay、hook 卸載、同股票單檔／批次重疊及失敗子集 retry。
7. **正式 App／驗收 S01～S13：**1440×900 與 390×844 的 S01／S02、手動重跑、stale 表格／視窗、批次 A/B、Tab／Shift+Tab／Escape／焦點與 `scrollWidth` raw 尚未完成。
8. **封存：**工具需凍結後，以 UUID run、完整 binding、不可覆寫 raw、明確 manifest／expected 與 verifier 統一重跑；當時 18 份 green 僅為 precheck，工具或產品 hash 改變後不得升格。

## 驗證限制

本次僅讀取來源、規格與既有 precheck；未啟站、未操作瀏覽器、未重跑 gate。正式兩尺寸 raw、最終 gate、封存及獨立最終雙軸覆核未齊，因此 S1 維持 OPEN。
