# 07 快取壓力實測與容量決策

固定比較點：`513f6347bfb77dedced2b8f5e0d85fef68ed8cbb`。本票產品程式零修改；編譯期測量探針只存在於記憶體副本，原始碼與工具指紋都保存於每份結果。

## 實際結果

30／100 檔各完成首次冷頁面、排除的一次暖機與五次完整測量，每頁三週期三輪；另有儲存故障及超大資料案例。`profile-summary.json` 由全部原始 JSON 產生，14 份量測與 1 份故障結果皆通過來源／工具雜湊及錯誤核對。

| 指標 | 30 檔 | 100 檔 |
|---|---:|---:|
| 行情唯一 payload（含最新價／FX） | 121 | 401 |
| key／其中別名 | 166／45 | 551／150 |
| 唯一 payload 大小估值 | 344,940,664 bytes | 1,149,801,854 bytes |
| 首輪服務總時間中位數 | 4,901.5 ms | 15,773.1 ms |
| 兩個同步轉換函式的累計時間中位數 | 1,606.9 ms | 5,234.8 ms |
| 行情序列化累計時間中位數 | 471.4 ms | 1,347.3 ms |
| 原生 Storage.setItem 累計時間中位數 | 1,000.5 ms | 3,369.6 ms |
| 第二、三輪 K 線快取命中 | 100%／100% | 100%／100% |
| 跨日基本面 payload 數 | 30→60 | 100→200 |

累計時間的範圍不完全相同：首輪服務時間只計首輪；轉換、序列化及 setItem 的原始樣本來自整頁執行。它們不是可相加的完整 latency 分解。原生 setItem 不含 quota 清理外圍成本；詳細口徑見 `measurement-method.md`。

20,000 棒超大資料實際返回／測試頁面顯示 `OVERSIZE`、棒數 `20000`、末價 `2099.5301637643834`；其序列化估值約 50,065,242 bytes。quota、Storage 拒絕、壞 JSON 與循環序列化失敗都不阻止其他有效資料；合成 sentinel 全部保留。

## 交付 08 的決策

完整數值及取捨見 **`capacity-decision.json`／`capacity-decision.md`**。行情記憶體 128 MiB／160 payload／320 keys、單項 8 MiB；基本面 2 MiB／128 項且清理舊日期。持久化行情 4 MiB／64 keys／單項 2 MiB，基本面 1 MiB／128 keys／單項 256 KiB。這些是估值資源預算，不是 heap 或瀏覽器 quota 保證。

不採延後持久化；先以有界同步策略避開超大寫入，08 再做同條件對照。近期目標為最後十檔三週期與一百檔當日基本面；不承諾一百檔完整循環全命中。

## 重跑

```powershell
node .scratch/optimization-followup/evidence/07/profile-server.mjs
```

在瀏覽器開 `http://127.0.0.1:4180/?n=30&sample=0&auto=1`，會跑完 14 個量測頁面後進入故障場景。成功才前進；完成後執行：

```powershell
node .scratch/optimization-followup/evidence/07/summarize.mjs
node .scratch/optimization-followup/evidence/check.mjs 07 gate
node .scratch/optimization-followup/evidence/check.mjs 07 verify
```

瀏覽器時區必須為 Asia/Taipei；資料時鐘固定，probe 用真正 performance.now。全部 API 由假 fetch 攔截，CSP／Host／Origin 限制只允許量測站，沒有真實 Yahoo、FinMind 或 AI 費用。觀測 long task 可能包括工具開銷，沒有歸因到產品，也沒有把估算叫作真實 heap。

`precheck/` 為修正「所有 fetch」與「K 線 miss」口徑前的校正資料，完整保留但不納入最終統計。完整 gate 44 檔／773 項通過，金鑰掃描未降級，48 個既有測試／snapshot／依賴檔案雜湊不變；正式產品 diff 為空。測量方法及最終容量決策已完成獨立封板雙軸覆核，Standards／Spec 均 OPEN:0；結果在 `code-review.md`。
