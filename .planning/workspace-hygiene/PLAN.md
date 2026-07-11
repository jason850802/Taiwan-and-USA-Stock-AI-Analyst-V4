# Workspace 清理 PLAN（換行符正規化＋Codex 鏡像制度化）

> 執行方式：每個步驟開一個獨立任務框，貼上：
> **「請讀 `.planning/workspace-hygiene/PLAN.md` 的步驟 N，照內容執行並驗收」**
> 步驟間有順序依賴（1 → 2 → 3 → 4 → 5），請依編號執行；完成一步在本檔該步驟標題後加 `✅ done (日期)`。

---

## 共用背景（每個任務框都適用）

**要解的兩個問題（2026-07-11 偵查確認）**：

1. **幻影修改（換行符）**：repo **沒有 `.gitattributes`**，Windows 端 `core.autocrlf=true`。
   後果 A：5 個 `.planning/**SUMMARY.md` 長期顯示 modified，但 `git diff` 為 **0 bytes**（純 CRLF 狀態差）。
   後果 B：`.claude/skills/` 檔案經 merge/checkout 後被轉成 CRLF，與 `.agents/skills/` 鏡像（LF）逐行假性不一致，`diff -rq` 全報「有差異」但內容其實相同——同步驗證形同失效。
2. **Codex 鏡像未入版控**：`.agents/skills/`（AGENTS.md 指定 Codex 讀取的朱家泓技能鏡像）從未 commit；fresh clone 後 Codex 拿不到技能。`.codex/`（GSD agents/hooks）與 `.agents/skills/source-command-gsd-*`（GSD 入口技能）為 GSD 安裝器產物，`.claude` 端對應物（get-shit-done、commands）也**沒有**入版控，應比照處理＝gitignore。

**鏡像白名單（.claude/skills → .agents/skills，以 .claude 為唯一事實來源）**：
`trend-analysis`、`position-analysis`、`kline-signal`、`ma-structure`、`volume-analysis`、`indicator-analysis`、`entry-decision`、`tw-fundamentals`、`_shared/`（整個目錄，含 fetch_stock.py、fetch_fundamentals.py）。
**不鏡像**：`README.md`、`phase-loop`、`start-dev`（Claude 專用工作流）、`source-command-gsd-*`（GSD 產物）。

**紅線**：
- 不得改寫已 push 的歷史（禁 force push、禁 rebase 已上 origin 的 commit）。
- `GEMINI_API_KEY` 紅線照舊：任何 commit 前確認無金鑰內容；步驟 5 會做 bundle 檢查。
- 動的是 git 狀態與 meta 檔，**不碰 `services/`、`utils/`、`api/`、`components/` 任何程式邏輯**。

**環境注意（Windows＋PowerShell 5.1）**：
- PowerShell 5.1 沒有 `&&`；grep/diff/cp 用 Bash 工具跑；寫檔用 Write 工具或 `-Encoding utf8`。
- `git add --renormalize .` 只會重新處理**已追蹤**檔案，不會把 untracked 掃進來——但 commit 前仍要用 `git status` 逐一核對 staged 清單。

---

## 步驟 1：換行符正規化（根治幻影修改） ✅ done (2026-07-11)

**目標**：建立 `.gitattributes`、把 index 內的換行符一次正規化，讓幻影修改永久消失。

**做法**：
1. 在 repo 根目錄新建 `.gitattributes`（用 Write 工具）：
   ```gitattributes
   # 預設：git 自動偵測文字檔，index 一律存 LF
   * text=auto

   # 程式碼與設定檔明確鎖 LF（跨 Claude/Codex/CI 一致）
   *.ts  text eol=lf
   *.tsx text eol=lf
   *.js  text eol=lf
   *.mjs text eol=lf
   *.cjs text eol=lf
   *.py  text eol=lf
   *.json text eol=lf
   *.md  text eol=lf
   *.html text eol=lf
   *.css text eol=lf
   *.yml text eol=lf
   *.toml text eol=lf

   # 二進位檔
   *.png binary
   *.jpg binary
   *.ico binary
   *.woff binary
   *.woff2 binary
   ```
2. `git add .gitattributes`，然後 `git add --renormalize .`。
3. `git status` 檢視 staged 清單：應包含 `.gitattributes`、5 個幻影 SUMMARY、以及其他先前以 CRLF 進 index 的檔案（可能不少，屬預期——這是一次性正規化）。**確認清單內沒有任何 untracked 檔被誤加**（`.agents/`、`.codex/` 此時應仍為 untracked）。
4. 單獨一顆 commit，訊息建議：`chore(git): 加入 .gitattributes 並正規化換行符（根治 autocrlf 幻影修改）`。
5. 到跨專案制度檔 `C:\Users\jason\Documents\Codex\agent-dual-core\LESSONS.md` **append** 一條教訓：「Windows repo 無 .gitattributes ＋ autocrlf=true → merge/checkout 後產生 0-byte-diff 幻影修改、且鏡像 diff 驗證失效；新專案第一天就要放 .gitattributes」。

**驗收**：
1. `git status` 中原 5 個 SUMMARY 不再出現；`git diff` 輸出 0 bytes。
2. 幻影不復發實測：`git checkout -- .` 後再 `git status`，仍乾淨。
3. `npx tsc --noEmit` 通過、`npm run build` 成功（renormalize 不應影響任何建置）。

---

## 步驟 2：`.agents/skills/` 鏡像重同步＋納入版控 ✅ done (2026-07-11)

**目標**：Codex 鏡像進 git，fresh clone 即可用；且在步驟 1 之後做，鏡像與 canonical 的 EOL 已一致，diff 驗證恢復可信。

**做法**：
1. 依共用背景的**鏡像白名單**，從 `.claude/skills/` 全量覆蓋複製到 `.agents/skills/`（Bash：逐目錄 `cp -r`；先 `rm -rf` 目標再 cp 可避免殘檔，但**僅限白名單目錄**，不得動 `source-command-gsd-*`）。
2. 驗證一致：對白名單每個目錄跑 `diff -rq .claude/skills/<d> .agents/skills/<d>`，全部必須「一致」（步驟 1 已解 EOL 噪音，此時任何差異都是真差異，須查明）。
3. `git add` **僅**白名單路徑（`.agents/skills/trend-analysis` … `_shared`），`git status` 核對 staged 清單無 `source-command-*`、無 `.codex/`。
4. 單獨一顆 commit：`feat(codex): .agents/skills 朱家泓技能鏡像納入版控（以 .claude/skills 為唯一事實來源）`。

**驗收**：
1. `git ls-files .agents/skills/ | cut -d/ -f3 | sort -u` 恰好等於白名單（9 項）。
2. `diff -rq` 白名單全數一致。
3. `git status` 的 untracked 只剩 `.codex/` 與 `.agents/skills/source-command-gsd-*`。

---

## 步驟 3：GSD/Codex 安裝產物 gitignore ✅ done (2026-07-11)

**目標**：`.codex/` 與 `source-command-gsd-*` 比照 `.claude` 端 GSD 基礎設施（未入版控）處理，工作區歸零。

**做法**：
1. `.gitignore` 追加（沿用檔內既有風格與分節註解）：
   ```gitignore
   # GSD/Codex 安裝器產物（機器本地，由 GSD installer 重建）
   .codex/
   .agents/skills/source-command-*
   ```
2. `git add .gitignore`，單獨 commit：`chore(git): ignore GSD/Codex 安裝器產物（.codex、source-command-*）`。

**驗收**：
1. `git status --short` **完全乾淨**（0 modified、0 untracked）。
2. `git check-ignore .codex/hooks.json` 與 `git check-ignore .agents/skills/source-command-gsd-ns-workflow` 皆命中。
3. 確認步驟 2 已入版控的鏡像**不受** ignore 規則影響（`git ls-files .agents/skills/trend-analysis` 仍有輸出）。

---

## 步驟 4：鏡像同步腳本（防未來漂移） ✅ done (2026-07-11)

**目標**：把「改 `.claude/skills` 後手動 cp」的口頭紀律工具化，一鍵同步＋驗證。

**做法**：
1. 新增 `scripts/sync_skills_mirror.py`（repo 目前無 scripts/ 則建立；用 Python 是因專案已依賴 python 跑 fetch_stock，避免 bash-only 在 Windows 踩雷）：
   - 內建共用背景的白名單常數。
   - 動作：逐目錄把 `.claude/skills/<d>` 覆蓋到 `.agents/skills/<d>`（先清後拷，僅白名單）；完成後逐目錄 diff 驗證，任何不一致以非零 exit code 失敗並列出檔名。
   - 支援 `--check`：只驗證不複製（給 CI 或覆核用）。
2. `package.json` 的 scripts 加 `"sync:skills": "python scripts/sync_skills_mirror.py"`（**同時檢查 `index.html` importmap 不受影響**——本步驟不動依賴，僅為慣例確認）。
3. 在 `AGENTS.md` 與 `CLAUDE.md` 各補一行：「改 `.claude/skills/` 後執行 `npm run sync:skills` 同步 Codex 鏡像」（CLAUDE.md 注意 150 行上限，超出則放 AGENTS.md 並由 CLAUDE.md 既有索引帶到）。
4. Commit：`feat(scripts): 新增 .claude→.agents 技能鏡像同步腳本 sync:skills`。

**驗收**：
1. 故意改動 `.claude/skills/trend-analysis/SKILL.md` 一個字 → `npm run sync:skills` → `python scripts/sync_skills_mirror.py --check` exit 0 → 還原該字並再跑一次同步（工作區回乾淨）。
2. `npm run sync:skills` 在 PowerShell 與 Bash 下皆可執行。
3. `npx tsc --noEmit` 通過（package.json 變更不影響 TS）。

---

## 步驟 5：總驗證＋push＋部署確認（最後做）

**目標**：三顆～四顆 commit 上 GitHub，確認 Vercel 自動部署不受影響。

**做法**：
1. 本地總驗證：`npx tsc --noEmit`；`npm run build` 後用 Bash 跑 `grep -r "AIza" dist/` 必須無結果（金鑰紅線）。
2. `git log --oneline origin/main..main` 檢視即將 push 的 commit（應只有本 PLAN 的 3~4 顆＋可能的 PLAN.md done 標記）。
3. `git push origin main`。
4. 等 Vercel Production 部署完成後，開正式站 `https://taiwan-and-usa-stock-ai-analyst-v4.vercel.app` 抽測：搜尋 2330 正常載入、`/api/*` 皆 200（本 PLAN 全程未碰 runtime 程式，此為回歸保險）。
5. 在本檔記錄執行結果摘要（各步驟 commit hash、最終 `git status` 截圖式輸出）。

**驗收**：上述全過，`git status` 乾淨，正式站抽測正常。

---

## 附錄：順序與依賴

| 順序 | 步驟 | 依賴 | 性質 |
|---|---|---|---|
| 1 | 換行符正規化 | 無 | 根因修復（先做，否則 2 的 diff 驗證不可信） |
| 2 | 鏡像重同步＋入版控 | 1 | 制度化 |
| 3 | GSD 產物 gitignore | 2（先入版控再 ignore，避免規則誤傷） | 清理 |
| 4 | 同步腳本 | 2 | 防漂移 |
| 5 | 總驗證＋push | 1~4 | 收尾 |

## 已拍板事項（執行時不要再問）
- `.agents/skills/` 鏡像**入版控**、以 `.claude/skills/` 為唯一事實來源（單向同步）。
- `.codex/` 與 `source-command-gsd-*` **gitignore**（比照 `.claude` 端 GSD 基礎設施慣例）。
- EOL 策略：index 一律 LF（`.gitattributes` 鎖定），工作區由 git 依平台處理。
