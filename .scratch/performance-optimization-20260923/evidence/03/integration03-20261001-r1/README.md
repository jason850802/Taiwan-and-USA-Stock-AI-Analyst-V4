# 03 精確 main 整合準備（2026-10-01）

本增補已在新的隔離 repository 真實套用完整 03 候選；**沒有改主 repository 的 HEAD、index 或 main，沒有 push、部署或發版**。這是可覆核的整合準備，不是 main 已整合或新 runtime PASS。

| 固定點 | 值 |
|---|---|
| 當前本機 main（不是遠端最新宣稱） | `2b2811b9300e7480112453e08d3b32beb3b306ed` |
| 來源分支固定點 | `8f7a8a3bf20ab5719be6028b25ac248afdbbc1de` |
| 分岔共同祖先 | `b2bf7d8075eb31266d556afb0f874d37c3217bb4` |
| 新隔離候選 | `cfbd118c28710de9b3fbeb6bc0f8c4333955e606` |
| 隔離路徑 | repo 內 `.scratch/integration03-isolated-20261001-r1` |
| 最終 patch | [candidate-main.patch](candidate-main.patch)，SHA-256 `188d393f89386a0d31955aea83ba9b7ae761505362b3f02005e46cdbcf39577c` |
| 範圍 | 45 檔；三組 patch check、最終 diff check 零衝突；27 支 Node 工具語法檢查通過 |

[manifest](manifest.json) 逐檔列來源、SHA 與角色；[檔案清單](candidate-files.txt)／[diff 統計](candidate-stat.txt) 是實際隔離候選內容；[語法檢查](syntax-check.json) 只代表 Node 解析，不替代 gate 或 runtime。

## 白名單與必要依賴

不能只把 `571be82..4d2b2ba` 七支驗收工具當成整張 03：產品實作源頭是 `5a44fd5` 的 13 檔，包含五 API 的取消、共用斷線身分、HTTP／Yahoo 共享握手、LLM 取消訊號及 Vite 同源／後端 env 隔離。候選精確取該提交的產品 patch，不搬入後續 AI 模型、effort 或 CLI 隔離改動。

| 來源 | 精確納入 | 整票是否搬入 |
|---|---|---|
| `c92dfa1` | `.scratch` watcher／部署排除的必要 hunk | 否；不搬其餘效能工作 |
| `5a44fd5` | 13 檔產品／Vite patch | 只搬上述產品 patch，非大量歷史 raw |
| `b7b04c7` | `scripts/start-dev.ps1` B1 回復入口，取目前固定點相同版本 | 只取檔案；主機 PowerShell profile 不在 Git 交付範圍 |
| `69e1cc7` | `vercel.json` 與 `utils/vercelConfigGuard.test.ts` | 只取核准部署設定及守衛 |
| `67c81ec` | vitest 排除 `.scratch` 的單一必要 hunk | 不搬提示詞／skill 變更 |
| 原 03 `5a44fd5` 至 `5997b92`、覆核處置 `85c5536` 至 `4d2b2ba` | 取 `8f7a8a3` 的最終 03 工具版本；逐檔 SHA 明列 | 不搬文件 commit 中的其他票狀態 |
| 01／02 共用工具 | `persistent-functions.cjs`、`trace-preload.cjs`、`service-kit.mjs`、`verify-b1-breakdown.mjs`、`b1-breakdown.mjs`、`b1-vite-proxy.config.mjs`，及 03 使用的 parity／reload | 只是 03 必要依賴；**不是把 01／02 整票當 03** |

排除原 01／02 專用 `self-test.mjs`、`self-test-02.mjs`、`v5-segments.mjs`，其餘已選工具的實際共用匯入／source manifest 依賴齊備。原始 [工具歷史 UTF-8](tool-history-utf8.txt)／[產品歷史 UTF-8](product-history-utf8.txt) 可追溯來源。第一次 PowerShell 重導向採集的 `tool-history.txt`／`product-history.txt` 亦經位元組核對為 UTF-8，兩次具名採集均保存，不覆寫。

候選沒有搬入：01／02 整票證據與 PLAN、其他庫存／K 線／行情優化票、模型／effort／Claude CLI 隔離、提示詞、Markdown、快取世代、CORE／Skills、main 獨有工作。`package.json`／`package-lock.json`、`services/gemini.ts`／`services/_shared/geminiCache.ts` 逐位元組與 main 相同。完整票據／歷史證據保留在來源分支，不能用此 patch 宣稱它們已搬進 main。

**main 獨有部署防護已保留**：main `.vercelignore` 原有 `api/**/*.test.ts` 與說明沒有刪除。來源分支整檔缺這條規則，不能拿來源整檔覆蓋 main；本候選只增加 `.scratch` 排除。

## 已完成與後續邊界

已獨立完成：選定真實本機 main、分岔／來源核對、45 檔精確 patch、零衝突真實套用、隔離候選 commit、逐檔來源雜湊、套用與 diff／語法檢查。沒有真行情、AI、帳本存取或服務啟動。

正式 App／Preview 的既有 PASS 來源是原分支產品；本候選刻意排除其他票，因此**不得把原 838 gate 或 App 28/28 直接套到 main 候選**。本候選的新機械 gate 已完成，結果見末節；必要受影響固定資料 runtime 屬使用者正式採用 main 整合後的驗證，不能把尚未授權的 main runtime 擴成原 03 票阻擋。原 3000／3001 runtime 仍需重新核對空埠與使用者分頁狀態，不需要重做未受影響的歷史 raw。

使用者真正要決定的是是否正式採用並合入這組 03 精確範圍；03 產品實作／分類與受控 Preview 本身已核准，不應反覆重問。push、production 提升及真上游另有外部影響，不能從本整合準備推定授權。

## 可覆核的後續命令

以下只適用**另一個乾淨 checkout 且 HEAD 精確等於上述 main**；不要在目前大量無關工作樹上執行。先核對 patch SHA，沒有任意全分支 merge 或 bulk staging：

```powershell
git rev-parse HEAD
Get-FileHash -Algorithm SHA256 -LiteralPath '<已保存的 candidate-main.patch 絕對路徑>'
git apply --check '<已保存的 candidate-main.patch 絕對路徑>'
git apply '<已保存的 candidate-main.patch 絕對路徑>'
git diff --check
npm.cmd run gate
```

上述命令供另一次套用使用；本輪實際 gate 證據列於末節。實際範圍須對照 45 檔 manifest 精確 stage；正式工具 run 前先提交該候選，驗工具 SHA 等於該提交。真正 merge 必須依專案規則附 `Code-Review:` 雙軸處置 trailer。既有固定資料／Preview 證據、原始失敗、最後使用者裁定與新的候選驗證應由主執行者回填 03 票。

## 新候選 gate 與位元組核對

[新 gate log](gate-20261001-r1.txt)／[結果](gate-result.json)：候選 `cfbd118`，**52 測試檔、831/831、tsc／build／金鑰掃描／package diff 五道全綠，exit 0**。dist 15 檔、已追蹤原始碼 1216 檔、env 比對值 8 筆；新版工具已包含在候選 commit 與秘密掃描中。測試母體是 main＋精確03，沒有拿原分支838測試數字當此候選結果。沒有新 API／App／Preview runtime 宣稱。

[before](gate-source-before.json)／[after](gate-source-after.json) 綁候選 commit、main base 與 patch SHA，來源無漂移。只讀使用主 repository 既有 `node_modules` 的祖先解析（tsc 5.8.3、Vite 6.4.1、Vitest 3.2.7）；不安裝、不改 package／lock。E 槽 junction 嘗試由 Node 及原生 PowerShell 都失敗，未建立任何 link；改採既有依賴解析。真 `.env` 只臨時複製做 gate 掃描，finally 已刪，不在 commit、結果或 SHA 清單中。隔離 repository 保留供覆核；`C:\pfv7\node_modules` 及目標未碰。

[提交位元組核對](committed-source-check.json) 另存工作檔 SHA 與 commit blob SHA：**44 檔 exact（包含全部工具）；`.vercelignore` 一檔僅 CRLF/LF 差異**。manifest 原始工作檔 SHA 沒有覆寫，不宣稱 45 檔全與 commit exact。patch 本身保存 Git blob 內容及完整 index 身分，正式 runtime 的工具仍必須 exact。
