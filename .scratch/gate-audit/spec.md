# Gate 負向測試（Session 1）——實驗章程

Status: ready-for-agent
Type: audit（單 session 實驗，不拆票；本檔即冷啟動文件，一次 commit 交付）

## 背景與動機

機械驗收 gate（`CORE_RULES.md`「機械驗收 gate」節）自建立以來只被觀察過綠燈，
**從未有任何一道被證明能紅燈**——沒有紅燈能力的 gate 與沒有 gate 無法區分。
另已確認：金鑰紅線寫「不進前端 bundle **或 git**」，但現行 gate 只掃 build 產物，
git 半條零機械防護。本 session 用故障注入逐道驗證，並把 gate 收斂成一鍵腳本。

## 隔離協議（動手前先讀完）

- 開分支 `test/gate-audit`，全程在其上；交付物 commit 後併回 main、刪分支。
- **注入物絕不 commit**：每個實驗結束立即還原，`git status` 驗證乾淨後才准進下一項。
- 金鑰探針一律用明顯假值（`AIza` 前綴＋`FAKE_CANARY` 字樣，總長貼近真金鑰的 39 字元）。
- 不碰真金鑰；`.env` 既有內容不動，探針行用完即刪。
- 實驗期間不起 dev server（檔案監看會鎖 git——LESSONS 2026-07-06）。
- 文字掃描用 Bash 工具跑（PowerShell 5.1 沒有 grep）。

## 實驗清單（依序執行；每項記錄「預期 vs 實際」，不許略過）

### E1 金鑰掃描——活代碼注入（gate 應紅）
把 canary 塞進**確定被引用的前端模組**，且讓它參與不會被最佳化移除的表達式，
`npm run build` 後掃 `dist/`。
- 預期：掃到。若掃不到 → gate 對真實洩漏無效，最高嚴重度發現。

### E2 金鑰掃描——死代碼對照（gate 應綠，同時實證 git 缺口）
同 canary 改放**未被引用的常數**，build 後掃 `dist/`。
- 預期：掃不到（tree-shaking 移除）。這證明「掃 dist」護不住「金鑰躺在原始碼」
  的情境——金鑰仍會進 git。此即 git 半條紅線的實證，寫進 findings。

### E3 Vite env 內聯行為（探索型，答案未知，先做功課再動手）
先讀 `vite.config.ts` 的 `define`／`envPrefix` 設定並照實記錄。
再於 `.env.local` 加 `VITE_FAKE_KEY=<canary>`，分三種寫法各 build 一次：
a) 完全不引用；b) 程式碼引用 `import.meta.env.VITE_FAKE_KEY`；c) 引用整個 `import.meta.env`。
- 記錄哪幾種寫法讓 canary 進 dist，結論整理成「金鑰進 bundle 的現實路徑」清單。

### E4 tsc 覆蓋範圍（gate 盲區普查）
讀 `tsconfig.json` 的 include／exclude，確認 `api/`（金鑰所在地）是否在型檢範圍；
再往 `api/` 某檔塞明顯型別錯誤跑 `npx tsc --noEmit` 驗證推論。
- 若 api/ 根本不在範圍 → 「tsc 0 錯」對後端毫無發言權，寫進 findings。

### E5 strict 普查（唯讀，一條指令）
`npx tsc --noEmit --strict`，記錄錯誤總數與檔案分布。只量化、不修。

### E6 快照鎖（gate 應紅＋盤點鎖的涵蓋率）
`services/gemini.ts` 任一 system instruction 改一個字 → `npm run test`。
- 預期：`geminiRules` 快照紅燈。還原後重跑確認綠。
- 加查：程式裡的 system instruction 是否**全數**在快照鎖內？若存在未入鎖的，寫進 findings。

### E7 鏡像一致性（gate 應紅）
手改 `.agents/skills/` 任一鏡像檔一個字 → `python scripts/sync_skills_mirror.py --check`。
- 預期：非零 exit 並列出該檔。還原方式：跑一次 `npm run sync:skills`（同步本身即還原）。

### E8 鏡像孤兒（確認文件宣稱）
往 `.agents/skills/` 塞一個白名單外的目錄 → sync 與 `--check` 都應不碰、不報。
- 預期：與 CORE_RULES「手動塞的檔案會變成永不更新的孤兒」敘述一致。結束手動刪除孤兒。

## 交付物

1. `docs/gate-audit-findings.md`：八項實驗的「預期／實際／結論」＋嚴重度排序的缺口清單。
2. `scripts/run-gate.mjs`——一鍵 gate，**只用 node 內建模組、零新依賴**（繞開
   PowerShell 5.1 無 grep 的問題）。依序：
   tsc → vitest → build → 金鑰掃描 → `git diff --quiet package.json package-lock.json`。
   金鑰掃描規則：(a) `AIza` 前綴掃 `dist/` ＋ git 追蹤中的原始碼（`*.md` 排除——
   規則文件本身含 AIza 字樣做說明）；(b) 讀 `.env*` 檔所有值（長度 >8），
   對 `dist/` 做字面比對——**任何形狀的秘密**都抓，不只 Google 金鑰；無 `.env*` 時略過。
   任一步失敗即非零 exit，輸出標明失敗段落。
3. `package.json` 加 `"gate": "node scripts/run-gate.mjs"`。
   （使用者 2026-07-26 已核准此一行 scripts 變更；lockfile 不得有任何變動。）
4. `CORE_RULES.md` 機械 gate 節補一句：一鍵版 `npm run gate`（runtime 類驗證——
   console 零紅字、UI 量數字——腳本管不到，仍照原規則人工做）。

## 完成定義

- 八項實驗全數有「預期 vs 實際」紀錄。
- 工作樹乾淨、canary 與 `.env` 探針零殘留。
- 還原後 `npm run gate` 全綠（用新腳本自證收尾）。
- 交付物併回 main，`test/gate-audit` 分支已刪。

## Comments
（執行紀錄與意外發現往下追加）
