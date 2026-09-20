# 10 獨立雙軸覆核

固定點 `6493c4c78b8282db1dae1202ca94df9aa08e8b40`，首次候選 `04fa1b7e14a26da3464145293f25451faa6fe534`，merge-base已確認是固定點。區間一提交、34檔；產品僅共用Modal與ChartToolbar。

```text
git diff 6493c4c78b8282db1dae1202ca94df9aa08e8b40...04fa1b7e14a26da3464145293f25451faa6fe534
git log 6493c4c78b8282db1dae1202ca94df9aa08e8b40..04fa1b7e14a26da3464145293f25451faa6fe534 --oneline
```

兩位沿用使用者已授權5.6 high的獨立reviewer分別核對完整差異、規則及第10票驗收。產品作者沒有取代獨立覆核。

## Standards

初始 **1項MEDIUM**：原來源焦點存在effect區域變數，StrictMode新掛載的setup/cleanup/setup重播會以視窗內焦點蓋掉開啟者，影響既有條件掛載的賣出視窗。已新增原生紅燈並改成ref保存真正來源；兩尺寸新增條件掛載案例且15案全組重跑。最終獨立修正覆核 **CLOSED 1／OPEN 0／NEW 0**，包含全部12項Fowler基線、15案原始checks、141次原生按鍵及來源／工具／宿主／build指紋。

## Spec

完整覆核 **OPEN 0**，missing/partial、scope creep、implemented-wrong各0。Reviewer直接核對全部readings.checks、122次trusted按鍵、37項控制名稱、94個產品及工具／dist／宿主指紋，13green全部passed且errors為0；2份紅燈確屬固定點，precheck未混入結果。兩種viewport及實際新增／匯入／分析／指標路徑符合票面，金融、服務、依賴及11票未變更。

## 驗證與限制

47檔／805項gate通過，型別/build/秘密掃描/依賴差異全綠，51原檔雜湊未變。13個原生瀏覽器案例、122次trusted按鍵、2個修改前紅燈，由腳本重算checks及source/tool/build/harness/raw指紋。主路徑使用正式dist，動態/空內容及兩層使用兩個真正的共用Modal宿主。

以上13案為首次候選；修正後最終為15案、141次trusted按鍵、3份紅燈，全部checks及來源／工具／宿主／dist雜湊核對通過。舊版綠燈存precheck-review，不混入最後摘要。原Standards reviewer已滿上下文，依工具明示改由另一個5.6 high獨立reviewer驗證，Spec沿用原reviewer覆核修正。

最終Spec修正覆核另發現 **1項LOW證據缺口**：最後一輪清理紀錄仍指向第一輪PID。產品及行為規格維持0項。已保留舊紀錄、由作業系統及metadata找回真正最後一輪PID17228與一致指紋，並實際停止後記錄4183 listener=0；詳見`recovered-process.json`、`cleanup.json`與README。原Spec reviewer已核對PID、建立時間、停止前後listener、全部原始檔指紋及現況：**CLOSED 1／OPEN 0／NEW 0**。

尺寸為同源iframe中的實際1440×900及390×844，不是手機硬體或螢幕閱讀器。初始來源focus為測試定位，其後鍵盤均原生；匯入來源也有跨控制項原生Tab導航證據。既有scrollbar導致382px內容寬與原生捲動動畫的兩次工具precheck另存，不混入正式結果。
