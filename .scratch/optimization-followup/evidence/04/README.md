# 04 庫存報價與匯率請求歸屬

固定比較點：`b2e0e4d2903083e193b3ae3b7b83765044327379`。開始時工作區乾淨，01～03 已結案。本票只處理報價／匯率的 UI 發布身分及持股生命週期；不執行 05 的排隊。

## 已確認原因與修改

`useHoldingPrices` 原本在每筆完成時直接寫 state。服務快取已有最新請求保護，但舊呼叫端仍能取得自己的回傳值，因此單靠服務不能防止 UI、報價時間與每日快照輸入倒退。

產品修改限定 `components/portfolio/useHoldingPrices.ts`。每個股票及匯率有自己的請求身分；只有目前有效身分可發布結果。一般讀取會沿用正在進行的請求，包含尚未完成的 force，不以舊快取中斷它。每次 force 仍發新請求。持股移除在 commit 階段失效並移除其報價；卸載使所有身分失效。

保留的行為：

- 價格載入仍為 `price:0 / loading:true`；最新失敗仍為 `price:0 / error:true`，沒有改成沿用舊價格。
- 匯率失敗或非正值仍不更新，沿用原 state；無有效匯率仍為 0，表格的既有顯示備援與快照的缺匯率守衛不變。
- 移除最後美股只使其 pending 匯率失效，不清除已取得匯率。空庫存新增第一檔美股時，表單仍可透過既有公開入口要求匯率。
- `getLatestPrice`、股票／匯率沿用窗（匯率 60 分鐘）、快取鍵、金融公式、報價日期換算、每日快照 800 ms debounce 與 upsert 全部原樣保留。

## 重現與可重跑入口

在專案根目錄執行：

```powershell
node .scratch/optimization-followup/evidence/04/validate.mjs gate
node .scratch/optimization-followup/evidence/04/fixture-server.mjs
```

假站只綁 `127.0.0.1:4178`。所有應用 API 在本機終止，未知端點與 AI 拒絕；Host／Origin 檢查及 CSP 同源限制不讓請求轉送真實服務。每次重新載入只清理此測試 origin 的 localStorage／sessionStorage，seed 是合成持股，不碰 3000、4175～4177 或正式網站資料。

- `/harness?suite=green`：18 個公開 hook 行為案例逐案重新載入，成功才前進。`holdings.jsx` 僅渲染真實 hook 的公開輸出及呼叫入口，包含真正的 `useDailySnapshot`；由專案已安裝的 esbuild 在記憶體建置，不替換產品服務、不讀 React 私有狀態、無新套件。
- `/?lots=us&appcase=app-overlap`：正式 Vite build 的真實 App／庫存頁驗收，確認 UI 串接與台幣市值。
- `browser-cases.mjs` 的 `runCase(name, stage)` 可單案重跑；這些瀏覽器行為測試與 750 項 Vitest 分開計數。
- `node .scratch/optimization-followup/evidence/04/verify-evidence.mjs`：核對各案通過、hook SHA-256、正式 build SHA-256 與未捕捉例外數。結果見 `candidate-evidence.json`。

報價與匯率由 `/__fixture/release` 手動釋放，沒有用網路睡眠猜回應先後。只扣住美股與匯率兩筆，兩輪共四筆，避免 HTTP/1.1 六連線上限卡住控制請求；台股即時回覆。900 ms 等待只用來跨過既有快照的 800 ms debounce，不決定回應順序。

時鐘固定並由案例明確推進；例：新回應取得時間 `2026-09-20T04:02:00Z`，舊回應稍後在 `04:03` 到達，仍必須保留新一輪的日期與取得時間。所有日期、價格、匯率及持股均為假資料。HTML 在假站移除外部字型連結，正式 `index.html` 不變。

## 修改前與修正後

`red-normal-force.json`：新版假回應先到時價格 200、匯率 32；舊回應後到使其倒退到 100／30，報價日期回到 2026-09-17，並進入快照。修改後同案保留 200／32、2026-09-18 與原取得時間。

| 公開邊界案例 | 驗證重點 |
|---|---|
| normal-force／normal-force-old-first | 一般／force 兩種完成順序；舊回應不得清除新等待、改價格、日期、時間或匯率 |
| old-success-new-failure／old-failure-new-success／old-failure-before-success | 交錯成功／失敗，保留原本最新價格失敗與匯率沿用政策 |
| cached-during-force | force 期間一般快取命中、清單變更自動讀取皆不打斷 force；完成後一般讀取仍命中快取 |
| force-general-old-first／force-general-new-first | force 後一般讀取，在無新鮮快取及兩種舊回應順序下仍等待有效意圖 |
| force-force | 連續強制更新，較早 force 的失敗不得污染最新成功 |
| remove-us／remove-tw／clear | 移除最後美股使舊匯率失效、清空無幽靈；移除無關股票不使其他有效請求失效 |
| unmount／remove-readd | 卸載／重掛載及刪除後重加，舊身分不能覆蓋新狀態 |
| fx-failure-preserve／missing-fx-snapshot | 最新匯率失敗沿用已取得值；缺匯率時不把顯示備援寫入快照，到貨後依原規則更新 |
| form-without-us | 沒有美股時，表單仍可主動取得匯率 |
| snapshot-refresh | 正常取得與手動更新後，真實每日快照採用有效資料 |

正式 App：`green-app-overlap.json` 記錄新價格 200／匯率32 到貨後，舊回應不改表格與快照；TWD 市值為 64,000。`manual-refresh.json` 記錄 Desktop 原生點擊「更新報價」，由公開 HTTP 假回應送入價格250／匯率34，畫面報價時間12:04、TWD市值85,000；對應快照交易日2026-09-18、USD市值2500、成本94.12、預估費用2、fxRate34、TWD成本3200。

## 機械驗證與邊界

`before.txt`／`gate.txt` 保存修改前後完整 gate；42 個 Vitest 檔、750 項全綠，型別、build、金鑰掃描及 package／lock 檢查通過。`unchanged.json` 核對 53 個原有測試／snapshot／依賴及金融、服務、快照檔案 SHA-256 全不變。

`bundle.json`：首屏 284.43 KiB raw／93.26 KiB gzip；相對本票起點 raw 不變，gzip 的微差不視為效能收益。新增程式位於延後載入的庫存頁；本票沒有重測 05 的大量庫存排程或宣稱真實網路提速。

獨立 Standards／Spec 結果見 [code-review.md](code-review.md)：兩軸皆為 0 findings／OPEN 0，無需追加產品修正。桌面實際 viewport 為 1536×639、scrollWidth 1528；console／network 限制見 [browser-diagnostics.md](browser-diagnostics.md)。`cleanup.json` 確認自建 PID 29724 與測試分頁已停止，4178 沒有殘留 listener。本票不宣稱完成 12 的跨尺寸整合矩陣。

正式產品僅新增 84 行、刪除 19 行；增加的是本票所需的請求與生命週期守衛，沒有藉刪測試或壓縮排版湊瘦身結果。初始覆核候選為 `98586851384d0fd5a4101c7a182732c57c7cf240`，最終由本票結案 amend 取代。回復以本票最終提交的反向修改為單位，先檢查後續依賴與工作區，不回退 01～03 成果。
