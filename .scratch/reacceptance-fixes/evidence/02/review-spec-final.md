# S1 最終 Spec 覆核

FINAL: PASS
OPEN: 0
NEW: 0

固定點／HEAD：`db2c8cb9dbf64f04b92af22264b80d209d72dead`；其後提交為空。範圍含完整 staged／unstaged 差異及本案新來源。僅覆核 Spec 軸。

## 逐條對照

- **S1-01～03：CLOSED。** 保存後 `items` 的 layout effect 比對 lot id、股數與實際成本分支／原值；排序、草稿、無關欄位、報價與即時匯率不誤失效（`useHealthCheck.ts:25-40,100-138`；hook S01、S03～S07）。成本選取仍沿原公式（同檔 `147-161`），fallback／新 prompt 實值見 S03、S07 raw。
- **S1-04～06：CLOSED。** 單檔／批次共用股票世代，影格、完成、錯誤及 finally 守衛；準備期與 import 後送 AI 前剔除舊輸入，其他股票照常完成（同檔 `185-224,239-336`；hook S02、S08～S11）。舊報告改為無決策 stale，已開視窗保留，表格顯示「需重檢」且不列失敗（同檔 `76-79,123-137`；`HoldingsTable.tsx:126-134`；hook S12、formal 兩尺寸）。
- **S1-07～09：CLOSED。** 僅手動重跑觸發 AI；既有提示詞／快取、金額計算與 Modal 未改。A→B→A、移除重加、失敗子集、單批重疊、development StrictMode 與卸載皆有公開案例（hook S10～S13）。產品僅改兩個持股檔；無依賴、金融政策或通用快取擴張。

預覆核 **S1-PRE-01 已 CLOSED**：原共用 `healthFetchKindRef` 改為每次 `PreparedHealthItem.fetchKind`（`useHealthCheck.ts:23,163-178,196-201,269-280`），舊工作不能改寫新錯誤文案。預覆核其餘案例缺口已由最終 27 案與兩尺寸 raw 補足。未發現缺失、部分實作、錯誤實作或 scope creep。

## 證據與限制

唯讀 verifier 重核指定 hook **27/27**、formal **2/2** manifest；formal 每尺寸 **18/18** 檢查，負向 **9/9**。最終 gate **185 檔／3188 項**、原 **47／805**，exit 0、金鑰掃描未降級；首屏量測 exit 0。S1 run 的產品／工具／dist 指紋在 gate 後仍相符；P1 的 109 份未改標為 S1。未重跑瀏覽器或 gate。seal 須待兩軸報告齊備後由主代理執行；本報告僅判 Spec 軸，不宣稱 S1 已提交或整案結案。
