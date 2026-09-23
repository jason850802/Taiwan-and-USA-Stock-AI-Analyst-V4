# evidence/01 索引

主要交付：[REPORT.md](REPORT.md)。以下每個 run 目錄都是 runner 產出的原始資料（`raw.json`、`trace/`）加上判定器摘要；原始資料從不覆寫。

## 正式證據（最終版工具產出）

| run | 用途 |
|---|---|
| `b1-fixed-20260923-r3` | B1 固定上游分段與判紅（四次獨立啟動，不打真上游） |
| `b1-real-20260923-r2` | B1 預算內真行情小批（14 支 browser API） |
| `decision-b1-fixed-20260923-r3--b1-real-20260923-r2-<判定器雜湊>.json` | 依驗收協定 3.5 算出的選路決定 |
| `v5-segments/` | 上一輪 v5 十檔真行情 raw 的重算（證據核對，未發請求） |

正式 run 的 `raw.json` 內 `identity.tools` 與 `identityAfter.tools` 記錄工具雜湊，須與本票提交的 `tools/` 相同；`runner-result.json` 記 runner 當下的退出碼（real 模式沒有效能門檻，其 exit 0 只代表 run 有效；檔內 `meaning` 沿用通用對照「有效且達標」，措辭不精確，留待 02 改工具時修正）。

## 開發期歷史（工具版本未提交，不作成績）

| run | 保留原因 |
|---|---|
| `smoke-01a` | 第一次事件鏈 smoke；只跑一個 start，刻意判無效 |
| `b1-fixed-20260923-r1` | 探針當時會在 tsx loader worker 多記一筆 boot；空 OPTIONS 另經 Vite（後證實 Vite 自回 preflight，量法無效） |
| `b1-fixed-20260923-r2` | 修正上述兩點後的第一個完整 run；runner 尚無 PID 快速失敗與結束身分重核 |
| `b1-real-20260923-r1` | 第一批真行情（同一批 runner 版本）；數值與 r2 同方向，作重現性對照 |

這四個 run 的結論與正式證據一致，但產生它們的 runner／探針版本沒有提交，無法由已提交工具完全重現，所以只作對照。以本票提交的判定器重播時，四者都因缺 `identityAfter`（當時 runner 尚未做結束身分重核）判為無效，這是預期結果。

## 摘要檔命名

- `summary-<判定器內容雜湊>.json／.md`：該版判定器從 raw 重算的結果。同版重播只比對、不覆寫；判定器修改後會另寫一份，舊版保留。
- 沒有雜湊的 `summary.json／summary.md`：開發期判定器的第一次輸出（其中 r1／r2 的版本仍有「同一次啟動內 PID 重用」的歸因錯誤），只作歷史。
- 以本票提交的判定器重播任一 run，應得到與同雜湊摘要逐字相同的結果。
