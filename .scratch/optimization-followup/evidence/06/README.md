# 06 後端握手共用與失效恢復

固定比較點：`12c544f4a58d2fe07b46e523e7ddfc796eb11f12`。開始時工作區乾淨；01～05 已結案。

## 問題、契約與修改

先執行原有 Yahoo 40 項行為鎖，再新增 10 項公開握手契約測試；原程式全部通過。`characterization-before.txt` 保存未改產品前的結果。接著以十個同時發起的公開請求重現十組 cookie／crumb 握手（`red.txt`）。

產品只修改 `api/_lib/yahoo.ts`：配對、取得時間及在途 Promise 屬於同一世代。冷請求共用在途握手；沿用窗到期建立新世代。認證錯誤只能使它實際使用的世代失效，不能清除其他請求剛取得的新配對。成功發布及 finally 清理均核對身分，失敗 Promise 不永久保留。

原有規則保留：

| 路徑 | 現行契約 |
|---|---|
| 主請求 401／429 | 最多兩次嘗試，中間固定等待 500 ms；第二次仍失敗則傳遞原分類 |
| 主請求 403／404／500 | 原樣回傳 Response，由既有 handler 判讀內容，不自行增加重試 |
| crumb 403 | UPSTREAM_ERROR，不套用 401／429 的重試 |
| 暖憑證 | 完成後十分鐘沿用窗，閾值與原規則相同 |
| 網路／逾時 | 既有 UPSTREAM_ERROR 分類，8 秒每次 upstream 逾時設定不變 |
| 前端降級 | Yahoo→FinMind 的既有順序與條件完全未改 |

## 公開測試與伺服器端請求鏈

`api/_lib/yahoo.handshake.test.ts` 共 17 項新增測試。除原有契約外，涵蓋十個冷請求只握手一次、十個同時認證失敗共用下一組握手、共享握手失敗後恢復，以及新握手尚未完成／已完成兩種順序下的舊 401。

新握手進行中遇舊認證錯誤時，該錯誤不應使新握手失效；測試直接斷言不會開始第三組。單一在途握手讓同世代的「兩組握手反序寫回」在入口即被禁止；並以反序完成的主回應核對下一次暖請求仍使用新配對。沒有為測試新增清除憑證或私有 Map 的公開入口。

另透過真實 `api/yahoo/chart.ts` handler（含 guard 與握手服務），送入十個合法合成請求。實際 fetch 邊界只觀察到一組握手、十個行情請求，成功 JSON 及原 CDN 標頭相同，回應不含合成 cookie／crumb。測試停用外部 Redis 環境設定並用合成共享密鑰，不讀取或輸出真實秘密。

```powershell
node .scratch/optimization-followup/evidence/check.mjs 06 tests api/_lib/yahoo.handshake.test.ts api/_lib/yahoo.test.ts
node .scratch/optimization-followup/evidence/check.mjs 06 types
node .scratch/optimization-followup/evidence/check.mjs 06 gate
node .scratch/optimization-followup/evidence/check.mjs 06 verify
```

控制先後用可釋放 Promise 與假時鐘，不用真實睡眠猜競態。全部 fetch 都由測試攔截；未進行真實 Yahoo 壓力測試、真實 AI 或部署。

## 驗收與限制

局部測試 57 項通過（原有 40＋新增 17），型別檢查 0 錯。完整 gate 為 44 檔／773 項通過，build、金鑰掃描及 package／lock 檢查成功；與既有檔案雜湊核對結果另存 `gate.txt`、`unchanged.json`。本票不更動瀏覽器產品 UI；所需伺服器端鏈路已用真實 handler 加假 upstream 驗證，不將其冒充真實網路或跨執行個體共用。

獨立雙軸覆核於 `code-review.md` 保存，Standards／Spec 各 OPEN:0，沒有要求追加產品修正。回復以本票單一提交的反向修改為單位。
