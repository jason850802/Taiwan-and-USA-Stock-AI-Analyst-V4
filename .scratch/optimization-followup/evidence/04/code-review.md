# 04 獨立雙軸覆核

日期：2026-09-20。使用者已授權將工具模型 ID `5.6` 視為 PLAN 指定模型，推理強度 `high`；Standards 與 Spec 分別使用獨立上下文。

固定比較點：`b2e0e4d2903083e193b3ae3b7b83765044327379`。

首次覆核候選：`98586851384d0fd5a4101c7a182732c57c7cf240`。

`merge-base` 已確認為固定點；該區間只有一個提交，完整候選共 41 檔。正式產品只有 `components/portfolio/useHoldingPrices.ts`（新增 84 行、刪除 19 行）；其餘為第 04 票的測試宿主、假資料站、證據、票面及 PLAN 進度。

```text
git diff b2e0e4d2903083e193b3ae3b7b83765044327379...98586851384d0fd5a4101c7a182732c57c7cf240
git log b2e0e4d2903083e193b3ae3b7b83765044327379..98586851384d0fd5a4101c7a182732c57c7cf240 --oneline
```

## Standards

獨立 reviewer：`worker-3`，`5.6 + high`。完整候選覆核結果：**0 findings，OPEN 0**。

確認每股與匯率各有請求身分、一般讀取沿用 pending force、最新成功／錯誤發布及已排入 React 的 updater 再次核對身分。移除與卸載的失效處理、空庫存表單的匯率入口，均與既有服務／快照契約相容。沒有發現需要回報的標準違反、12 類 smell baseline 問題、安全問題或金融語意變更。

18 個 hook 案例與正式 App／原生操作分開核對，沒有以測試宿主冒充正式 UI 驗收。53 個受保護檔案零修改、750 項 gate 及假站隔離／清理證據吻合。無需修正產品。

## Spec

獨立 reviewer：`worker-5`，`5.6 + high`。完整候選覆核結果：**0 findings，OPEN 0**；missing／partial 0、scope creep 0、implemented wrong 0。

確認一般／force 的兩種回應先後、快取回填、成功與失敗交錯、匯率、移除／清空／卸載及每日快照輸入皆有對應案例。20 份通過紀錄的 hook／build 雜湊一致；正式 App 保留新價格、匯率及取得時間，原生更新的表格與快照讀值正確。原有失敗政策、金融公式、服務與快照檔案未改，第 05 票無差異。無需修正產品。

## 驗收證據

- 最後完整 gate：42 個測試檔、750 項通過；型別、build、金鑰掃描與 package／lock 檢查均成功，見 `gate.txt`。
- 18 個 hook 公開介面瀏覽器案例、1 個正式 App 案例及 1 次 Desktop 原生更新操作通過。`candidate-evidence.json` 核對相同 hook／build 雜湊及各案未捕捉例外為 0。
- `unchanged.json`：53 個原有測試、snapshot、依賴、服務快取、金融與快照檔案沒有修改。
- `browser-diagnostics.md` 分開列出預期故障注入及診斷 buffer 限制；`cleanup.json` 記錄自建假站及分頁已停止。

本檔是候選提交後補入的覆核紀錄；覆核完成後隨本票最終提交保存，沒有因此變動產品或測試。

## 限制與處置

Desktop network 歷史 buffer 曾丟棄 899 個事件，已在診斷紀錄揭露；逐案假伺服器請求紀錄不依賴該 buffer。hook 宿主只證明公開 hook 行為，正式 App 與原生操作另有證據。第 05 票的排隊／大量庫存峰值與第 12 票跨尺寸整合矩陣不在本票驗收範圍。

兩軸皆無未處置的正確性、安全或驗收缺口。最終整理僅加入覆核紀錄及更新結案狀態，產品與測試保持覆核版本。
