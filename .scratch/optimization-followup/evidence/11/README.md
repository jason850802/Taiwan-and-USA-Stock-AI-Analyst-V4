# 11 保守清理與現況文件

固定比較點：`eb1dcfac70094fcbdcdacf9c873b589e5f52c6b4`。01～10已resolved，開始時工作區乾淨。本票檢查前述修正留下的候選路徑，未發現可安全再刪的正式程式；依票面規定保存證據，不以刪除保護、測試或搬動大檔充數。

## 候選及用途判讀

| 候選 | 實際用途 | 處置及理由 |
|---|---|---|
| 未用宣告／整檔 | 模組掃描94/94可從index及API入口到達；編譯器額外未用宣告檢查只有既有測試的`vi` | 正式程式0項；不改`utils/backfillPipeline.test.ts`。可達性不等同全部分支皆有用。 |
| 市場與單檔健檢的畫面排程 | `App.tsx`、`useHealthCheck.ts`都實際呼叫`createFramePublisher` | 已於09共用32行小責任；兩個使用端的生命週期不同，不再合併或增加包裝。 |
| hook身分與服務cache身分 | `useHoldingPrices`控制畫面，`getLatestPrice`控制服務cache；舊呼叫仍可能合法取得自己的結果 | 保留兩層；04紅燈已證明只保護cache不足以保護UI及快照輸入。 |
| 庫存隊列與worker pool | hook用`createHoldingPriceQueue`持有跨批次三槽，內部呼叫既有`runWithConcurrency` | 不是相同控制範圍的重複排程；刪佇列會退回每批三槽。 |
| 行情／基本面LRU與session helper | quote及fund有不同memory／日期政策，但共同呼叫`createBoundedSessionStore` | 08已收斂同步持久化共用責任；不將TTL／資料型別硬塞進helper。 |
| `writeMemoryAlias`及dirty namespace | Yahoo實際建立canonical別名；denied recovery測試鎖住權限恢復時舊值不能復活 | 保留公開相容入口及恢復守衛，不能因少數邊界才觸發而刪除。 |
| Yahoo握手與圖表訂閱 | backend維護憑證世代，frontend維護每個使用端有效訂閱 | 所屬程序與安全責任不同，不是可以合併的「同一個pending」。 |

`cleanup-analysis.json`保存94個正式來源SHA-256、字串引用定位清單及01至10的正式程式numstat。引用清單僅供定位，已另外讀取實際呼叫端核對，沒有把註解字串當作執行證據。

## 新增／刪除範圍

本票正式產品新增0行／刪除0行；既有與新增測試均0行變更；沒有抽出模組。新增`analyze.mjs`是只讀清理檢查工具；新增[現況文件](../../../../docs/optimization-current.md)、本票證據及PLAN連結。逐檔工具／文件統計由Git保存，與產品行數分開。

02～10的單一訂閱回呼、無世代state/cache寫回、無界session寫入及逐片段setState舊路徑已在各票替換；11不重複宣稱那些刪除是本票的新成果。後續較大拆分（App、Portfolio、資料組裝）另作獨立設計議題，不在本票搬移金融公式、公開型別或提示詞。

## 可重跑檢查

```powershell
node .scratch/optimization-followup/evidence/check.mjs 11 audit
node .scratch/optimization-followup/evidence/11/analyze.mjs
node .scratch/optimization-followup/evidence/check.mjs 11 gate
node .scratch/optimization-followup/evidence/check.mjs 11 verify
node .scratch/optimization-followup/evidence/check.mjs 11 market
node .scratch/optimization-followup/evidence/check.mjs 11 bundle
```

`unused-declarations.txt`保留額外`noUnusedLocals/noUnusedParameters`的exit2，唯一為原測試未用匯入，不冒充整條額外檢查exit0；普通型別檢查仍由完整gate核對。`unchanged.json`的51個既有測試／snapshot／依賴檔案均不變，依賴另比對01。

四組固定行情每組暖機1次、測量5次中位數：AAPL/1d 22.54 ms、2330.TW/1d 20.22 ms、AAPL/1wk 8.09 ms、AAPL/60m 13.60 ms；cold start 1085.86 ms獨立列出。完整輸出SHA-256與01相同，這些數值不宣稱文件修改使程式提速。首屏291.26 KiB raw／95.79 KiB gzip，與10相同、相對01低於5%調查門檻。

產品沒有改動，10的兩尺寸15項原生UI結果仍對應相同來源；`ui-evidence-binding.json`會在本票最後gate後重新核對來源與build指紋，不冒充本票重新派送按鍵。12依整批授權另做當前候選的完整整合重跑。

完整gate已實跑：47個測試檔／805項全綠，型別、build、金鑰掃描（本機6筆環境值，無降級）及依賴檢查均通過，見`gate.txt`。獨立Standards／Spec均0 findings／OPEN0，詳見`code-review.md`；8個現況文件連結全部存在。歷史規劃、共用規則及01～10原始量測均保留原樣。
