# 03 回復命令的隔離內容演練（2026-10-01）

來源固定 `8f7a8a3bf20ab5719be6028b25ac248afdbbc1de`。本輪只在新建的稀疏 Git clone 寫入與提交，不啟動 App、API、瀏覽器、CLI 或上游。主工作樹的 HEAD／index／產品來源沒有被本工具寫入；沒有 push、部署、真帳本、真 AI／行情、package／lock 變更或 node_modules junction 操作。

隔離目錄是 `.scratch/performance-optimization-20260923/rehearsals/rollback03-20261001-r1`，沒有 node_modules，Git objects 透過本機 shared clone 唯讀引用主 repository。它不是主 checkout 或既有 C:\pfv7 worktree；目前保留供檢查，沒有執行清除命令。主工作樹已有無關工作，不可對主 checkout 直接套用這次演練。

## 結果與精確範圍

| 項目 | 實際操作 | 結果／原始證據 |
|---|---|---|
| 最新七工具撤回 | 真實 `git revert --no-edit 4d2b2ba… e6b6770… 241fba1…`；三個完整反向提交 | 全部 exit 0，七檔回到 `571be82` 逐檔內容；再逆序 revert 演練反向提交，全 Git tree 回到候選。見 [tools.json](tools.json)、[diff](tools-reverted.diff)、[原始命令](commands-stage1.json)。 |
| 平台取消設定撤回 | 真實 `git revert --no-edit 69e1cc797…`；範圍為 vercel.json 及其設定守衛測試 | exit 0，移除該提交增加的旗標與測試，保留後續設定；再 revert 演練提交，全 Git tree 回到候選。見 [config.json](config.json)、[diff](config-reverted.diff)、stage1 命令。 |
| 舊整提交命令的否證 | 在隔離 repo 試 `git revert --no-commit 5997b92… 5a44fd5…` | 第一個歷史提交已有九處票面／文件／工具衝突，exit 1；立即 abort，候選全樹與乾淨狀態恢復。原衝突完整保留於 [whole-commit-attempt.json](whole-commit-attempt.json)、[原始命令](commands-stage2.json)，不能再推薦泛指 HEAD 或整張歷史提交的盲目撤回。 |
| 初始 03 核心產品限定回復 | 由真實 `5a44fd5^..5a44fd5` 產生 api＋Vite 的原始補丁，使用 `git apply --reverse --3way`，提交此限定反向變更 | 13 檔，無衝突、exit 0；保留後續無關 CLI 隔離／effort、Vite 測試排除等變更。再 revert 該演練提交，全 Git tree 回到候選。見 [原始補丁](product-original.patch)、[apply 結果](product-apply-attempt.json)、[前後 SHA](product.json)、[diff](product-reverted.diff)。 |
| 平台設定＋核心產品一併撤回與復原 | 先真實 revert 69e1，再套上述限定補丁並 commit；再逆序 revert 兩個演練提交 | 15 檔限定範圍，exit 0；11 份仍存在的 TypeScript 原始碼語法診斷 0，後續 CLI 四個設定關鍵字計數前後相同；全樹／逐檔 SHA 復原、工作區乾淨。見 [combined-r2.json](combined-r2.json)、[diff](combined-reverted-r2.diff)、[原始命令](commands-stage3-r2.json)。 |

所有復原比較均使用 Git 原始 blob SHA-256，不用工作樹換行判斷代替內容；完整樹固定為 `f4b8a2c2eff8b47b88c69a27a4b4a2f901be2ee0`。每檔 before／撤回後／恢復後 SHA、存在與否，以及每個 Git 命令的參數、時間、stdout／stderr／exit 保留於具名 JSON。

13 檔核心產品範圍為 `clientAbort`、HTTP 取消支援、LLM 取消支援、Yahoo 握手、五支正式 handler、三支相關測試與 Vite 代理／envDir；精確檔名在 product.json。這不是整張 03 的文件／證據撤回，也不是把 `llm.ts` 整檔還原成舊版。歷史證據及本輪 03 票狀態不回復、不刪除。

## 可重用的回復方式

回復屬於緊急撤回，會重新失去 03 的取消功能；本輪演練不是要求在目前產品上撤回已修好的功能。實際需要撤回時，先正常停止候選、保全未提交工作、核對固定來源及衝突。日常入口切回原 B1 的實際啟停／首頁 200／OPTIONS 204／清理，已由先前 terminal03 三案完成，本輪不重跑服務。

最新七工具命令已在隔離 repo 真實演練：

```powershell
git revert --no-edit 4d2b2ba51fa2a6ba12a5f86915c6ca8be8d85a50 e6b6770883379cd3a22779588f08e9dbc0249fee 241fba1b4e6be8f74719afd7d8b7b2fa87a5d6f6
```

平台設定可單獨撤回：

```powershell
git revert --no-edit 69e1cc797c8c6cf1d1819fa043bce150c70b2828
```

若要撤回初始 03 核心產品取消與代理變更，使用本證據已驗證的原始補丁，先核對 SHA-256 `007a591ac2bb4848cd74e2803d82e408e61944790c95df43de5dd032a815166a`：

```powershell
git apply --reverse --3way .scratch/performance-optimization-20260923/evidence/03/rollback03-20261001-r1/product-original.patch
git diff --cached --name-only
git diff --cached --check
# 確認僅 product.json 的13檔，沒有衝突或無關變更後才精確提交反向變更
```

此補丁由原提交生成，可另用 `git diff --binary 5a44fd58f32b978d27228efc635d50f618092cbd^ 5a44fd58f32b978d27228efc635d50f618092cbd -- api vite.config.ts` 核對；不要用 PowerShell 的預設 `>` 重建補丁，避免 PS5 UTF-16 或換行改動。平台旗標與限定核心回復可一起或分別使用，兩條路徑都已驗證能再恢復候選。

## 紅燈、範圍與交付

combined 第一組額外守衛誤要求候選含 `--settings`，實際 before／after 均為零；它不是產品回復失敗。這組在完成內容撤回後停止，原命令保留於 commands-stage3.json；[stage3-red-and-restore.json](stage3-red-and-restore.json) 記錄原因與完整復原。更正為目前實際存在的 `--setting-sources` 後，用新 r2 輸出取得通過；原紅燈不追認、不覆寫。一次 PowerShell 內嵌 Node 字串的引號解析失敗沒有執行回復或寫新工具；改以具名 UTF-8 檔後成功。

這是 Git 內容／可回復性演練，不是撤回版本的完整 gate 或 runtime 驗收。TypeScript 只做語法診斷，不宣稱 `tsc --noEmit`；候選完整 gate 與 B1 入口 runtime 保持原具名證據。已補足「僅列出未驗回復命令」的缺口：最新工具與取消設定真實 git revert、核心產品精確反向補丁、撤回後再恢復候選內容皆已執行。歷史整提交衝突是已否證並被限定方案取代的舊命令，不能當作目前仍無可驗證回復命令。

README、JSON、diff、補丁與輔助演練腳本為本輪新增證據，全部等待主 agent 精確提交；沒有改寫舊證據、03 票或產品碼。03 是否結案及 main 精確整合由主 agent 按使用者最新決定統一處理。
