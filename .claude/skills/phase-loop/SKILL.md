---
name: phase-loop
description: 本專案的三角開發迴圈playbook：Fable/主模型寫 phase 計畫 → 交 Codex 執行 → Opus/Sonnet 照計畫內建 checklist 覆核 → 使用者人工驗證 → 合併回 main。當使用者說「規劃 Phase X」「交給 Codex」「幫我覆核」「合併 phase」「開始下一個 phase」時使用。內含計畫模板要求、Codex 交接指令模板、覆核協議、合併儀式。此流程已在 Phase 1/2/UI三期/庫存強化/FinMind 共 7 輪實戰驗證。
---

# 三角開發迴圈（phase-loop）

四個階段，依使用者當下要做的事挑對應節執行。整套流程的分工原則：
**規劃與仲裁用貴模型（品味/取捨），執行交 Codex（機械寫碼），覆核用 Sonnet/Opus（照單驗證），
人工驗證抓 runtime 才會現形的問題**。任何階段的產物都存檔（隨做隨存，中斷不丟）。

## 階段 1：規劃（寫 CONTEXT + PLAN）

產物：`.planning/phases/NN-slug/NN-CONTEXT.md`（設計決策）＋ `NN-PLAN.md`（執行計畫）。
規劃前先派 Sonnet subagent 偵查現況（讀 code/需求/研究檔，只收「事實＋檔案:行號」），
規劃者只做決策不下場讀大量檔案。

PLAN.md 的必備結構（7 輪實戰驗證過的格式，勿省略）：
1. **frontmatter**：files_modified 逐檔列出（覆核用來抓範圍膨脹）、must_haves truths。
2. **「給冷啟動執行者的前提」節**：Codex 沒有任何對話背景——把拍板決策（D-01…）、
   環境事實（E 槽路徑含空格、PowerShell 用 npx.cmd/Select-String、禁裝 npm 套件、
   git 大動作前 taskkill node）、既有程式碼事實（附行號快照＋「動手前開檔確認」）全部白紙黑字。
3. **雷區用「diff 形狀」定義**，不用「小心一點」：例「此檔只准 hex 色值與高度 className 兩類
   diff，改完 git diff 自檢，出現邏輯行即回退」。這比任何叮嚀都有效。
4. **驗收條件可機械檢查**：grep 歸零清單、tsc/build、金鑰掃描（`grep -r "AIza" dist/`）。
5. **金額/計算類任務必附手算對數案例**：把輸入與預期輸出的具體數字寫死在計畫裡
   （例：1000股@1000→手續費1425），覆核者親自沿程式碼重算、使用者照案例按——數字對不上就是
   bug，不靠感覺。
6. **內建 `<review_checklist>` 節**：給覆核模型的固定清單（逐條 PASS/FAIL＋證據），
   含判定規則「必修退 Codex 附行號；同一問題最多退 2 輪，第 3 輪升級回報使用者」。
7. **checkpoint:human-verify task**：具體到可照按的步驟（含瀏覽器操作、預期畫面/數字）；
   需要製造失敗路徑時用「一次性臨時改壞→驗證→改回、不 commit」法，不留後門。
8. **未決點誠實列出**：規劃期沒驗證的假設標明，並設計成執行期第一步先驗證（spike-first）。

收尾：計畫 commit 到 main → `git checkout -b gsd/phase-<slug>` 開分支 → 更新記憶檔
（`~/.claude/projects/.../memory/`）→ 產出 Codex 交接指令（階段 2 模板）給使用者。

## 階段 2：交接 Codex（使用者複製貼上）

模板（依 phase 內容填空）：
```
【任務】執行 <phase 名稱>。
1. 確認在 git 分支 gsd/<slug>。
2. 完整讀 .planning/phases/NN-slug/NN-PLAN.md，「給冷啟動執行者的前提」逐條遵守，特別是：
   - <本期 2-4 條最要命的鐵則，如雷區 diff 形狀、邏輯零變化、token 不進前端>
3. Task 1→N 一任務一 commit，只動各任務 <files>；每步 npx.cmd tsc --noEmit 0 錯誤。
4. 做到 Task <human-verify> 停下回報：commit hash＋tsc/build 結果＋<本期特定回報項>。
```
Codex 若回報**規則衝突**：這是好行為（停下來問優於亂猜）。仲裁後把裁定寫進 PLAN 新節
（「第 N 輪執行裁定，權威覆蓋前文」）、commit、再給 Codex 繼續指令。

## 階段 3：覆核（Opus/Sonnet 接手時）

1. 讀該 phase PLAN.md 的 `<review_checklist>` 節，**逐條執行，不即興**。
2. 實跑不只讀碼：tsc、build、金鑰掃描一定親手跑；金額類把計畫的手算案例沿程式碼路徑重算。
3. 範圍紀律：`git diff main --stat` 對照 frontmatter files_modified；不該動的檔 diff 必須為 0。
4. 雷區檔逐行看 diff 是否只含允許的形狀。
5. UI 實測（可用 preview 工具時）技巧：點外關閉監聽掛在 mousedown（用 dispatchEvent 而非
   .click()）；斷言前等 React 重繪（await 150ms）；`type=number` 讀不到 selection 屬性
   （focus 全選改用讀碼確認）。preview 沙盒連不到使用者本機的 vercel dev——需要後端的驗證
   誠實交還使用者，不要宣稱測過。
6. 產出：逐條 PASS/FAIL 表＋必修清單（退 Codex 附行號）／放行 Task N 人工驗證。
   未實跑的部分明說。同題最多退 2 輪。

## 階段 4：人工驗證與合併

1. 使用者照 PLAN 的 human-verify 步驟操作（起環境用 `/start-dev`）。發現的問題先分類：
   **本期改壞的（退 Codex 修）** vs **本來就有的舊 bug（用 /gsd:capture 記待辦，不擋合併）**
   vs **新功能需求（另立任務，守住範圍）**——判斷方法：對照 `git show main:<檔>` 看該邏輯
   是否本期才變。
2. 合併儀式（順序固定）：
   a. `tasklist //FI "IMAGENAME eq node.exe"` 檢查——使用者的 dev 伺服器與殘留子程序先收乾淨
      （Ctrl+C 常殺不乾淨，必要時 `taskkill //F //PID <pid>`），否則 EPERM 檔案鎖會炸合併。
   b. `git checkout main && git merge --no-ff gsd/<slug> -m "<完整記錄驗證過程的訊息>"`。
   c. 合併後 `npx tsc --noEmit` 複驗＋確認關鍵檔案已在 main。
   d. 更新記憶檔（phase 完成、開放線頭）；有踩新雷則 append 到
      `C:\Users\jason\Documents\Codex\agent-dual-core\LESSONS.md`。

## 跨專案制度參照（不開檔也要遵守的在 CLAUDE.md；細節在 agent-dual-core\）
MODEL-DISPATCH.md（交辦/模型選擇/升降級）、JUDGMENT.md（完成定義/何時問使用者）、
ENVIRONMENT-GOTCHAS.md（Windows/PS5.1 雷區）、TASK-TEMPLATES.md（交辦單模板）。
