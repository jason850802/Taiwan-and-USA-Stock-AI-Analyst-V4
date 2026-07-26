# G3 修復回報：後端金鑰不進 bundle 只靠一個沒人守的 Vite 預設值

**日期**：2026-07-26
**分支**：`claude/reverent-rosalind-99ffbc` → 合併 main
**commit**：`dab7508`（修復）／`655373b`（合併）
**來源**：`docs/gate-audit-findings.md` 缺口 G3

本檔含兩部分：**第一部分** 是交辦的 G3；**第二部分** 是過程中被 gate 卡住而追出來的
git `dubious ownership` 根因，屬環境層、已另外經使用者授權執行。

---

# 第一部分：G3

## 一句話結論

`vite.config.ts` 改為顯式 `envPrefix: 'VITE_'`，並以 `utils/viteConfigGuard.test.ts`
（5 案、三層）鎖住。**三種漂移各注入一次確認會紅**，其中一種只有第二層抓得到——
證明三層不是疊床架屋。

## 問題

後端秘密（`GEMINI_API_KEY`／`FINMIND_TOKEN` 等 7 個非 `VITE_` 前綴的 `.env` 變數）
進不了前端 bundle，唯一機制是 Vite 的 `envPrefix` 只曝 `VITE_`。而審計當下
`vite.config.ts` **沒有** `envPrefix`、**沒有** `define`、**沒有** `loadEnv`，
全靠 Vite 的預設值，且**零測試守護**——任何人放寬設定都不會有測試紅燈。

## 修法

### 1. 設定顯式化

[`vite.config.ts`](../../vite.config.ts) 加 `envPrefix: 'VITE_'`。

行為與修前**完全相同**（本來就是這個預設值）。價值不在行為，在於
**改動從此會出現在 diff 裡被人看見**，而不是靠一個沒寫出來的預設值。

### 2. 三層防漂移鎖

[`utils/viteConfigGuard.test.ts`](../../utils/viteConfigGuard.test.ts)，5 案：

| 層 | 斷言 | 擋什麼 |
|---|---|---|
| 1 | 匯出物件的 `envPrefix`／`define` | 直接改 `vite.config.ts` 字面值 |
| 2 | `resolveConfig()` 後的值（build ＋ serve 各一案） | plugin 的 `config` hook 注入——光讀匯出物件**看不到** |
| 3 | 用 Vite 的 `loadEnv` 對 fixture `.env` 實跑 | 鎖**機制本身**而非設定的拼字 |

> **第三層為何用 fixture 而非專案真 `.env`**：真檔在 CI／新 clone 上不存在，斷言會變成
> 空轉的假綠燈；更要命的是斷言一旦失敗，vitest 會把整個 env 物件印進終端——真金鑰
> 不能這樣曝光。fixture 用假值，且先斷言 fixture 確實被讀到，避免空轉。

測試檔放 `utils/` 是沿用現行慣例（現況測試全在該目錄，`geminiRules.test.ts` 同樣是
非 util 的鎖）。

## 驗證

### 紅燈自證（本卡的交付物）

三種漂移各注入一次，**全部還原**，還原後以 SHA256 比對確認 `vite.config.ts` 與備份逐位元組相同。

| 注入 | 紅燈數 | 哪幾層紅 | 意義 |
|---|---|---|---|
| `envPrefix: ['VITE_', 'GEMINI_']` | 4/5 | 1、2（×2）、3 | 第 3 層印出 fixture 秘密**確實外洩**，不只是設定不合預期 |
| `define: { 'process.env': {} }` | 3/5 | 1、2（×2） | envPrefix 兩條正確保持**綠**——斷言彼此獨立，不會連坐誤報 |
| plugin `config` hook 回傳 `define` | 2/5 | **只有 2（×2）** | 第 1、3 層正確保持綠。**證明第 2 層非冗餘** |

### 機械 gate

| 環境 | 結果 |
|---|---|
| worktree | `npm run gate` 五段全綠，315 測試 |
| 主 repo（合併後複驗） | `npm run gate` 五段全綠，315 測試，金鑰掃描 **`.env 值 7 筆`**、追蹤原始碼 148 檔 |

測試數 310 → **315**（新增 5 案）。合併後刻意在主 repo 跑完整 gate 而非只跑
`npx tsc --noEmit`（儀式的最低要求），理由見附帶發現 2。

## 附帶發現

### 1. G3 原文的例子要打折扣（已在審計文件更正）

原文寫「任何人加一行 `envPrefix: ''`……不會有任何測試紅燈」。**實測證否**：
`envPrefix: ''` **Vite 自己就擋**——`resolveEnvPrefix()` 會 throw
「envPrefix option contains value '', which could lead unexpected exposure of sensitive
information」，連 vitest 都起不來（Startup Error，exit 1）。陣列裡含 `''` 同樣被擋。

真正沒人擋的是：

- **放寬**前綴（`['VITE_', 'GEMINI_']`）——想把 `GEMINI_MODEL_FAST` 這類設定丟給前端時
  最容易順手加，而它會**連同 `GEMINI_API_KEY` 一起**放行
- `define`（`envPrefix` 完全管不到它）

鎖的守備範圍已據此調整。`docs/gate-audit-findings.md` G3 節已加註這條更正。

### 2. worktree 裡的「gate 全綠」比主 repo 弱

與 G5 報告的附帶發現 2 同一件事，本次獨立再遇一次：worktree 沒有真 `.env`
→ 金鑰掃描 (b)(c) 靜默降級（印「`.env 值 0 筆`」，主 repo 是「7 筆」）。
補 G1／G2（最高嚴重度）的正是這兩條。**要完整驗金鑰請在主 repo 目錄跑。**

本次合併後的主 repo 複驗是真的拿 7 個真實秘密比對過 `dist/` 與 148 個追蹤原始碼檔。

---

# 第二部分：git `dubious ownership` 根因（環境層）

起因：worktree 內 `npm run gate` 第 4/5 段直接紅（`git ls-files` 失敗），與 G3 無關。
使用者指示追根因後授權執行。

## 根因（兩個，彼此獨立）

| # | 成因 | 影響範圍 |
|---|---|---|
| 1 | **E: 是 exFAT**，不記錄 ACL，目錄擁有者一律回報 `Everyone` ≠ `chuan\jason` | **E 槽每一個 repo，永久無例外**——不是 worktree 專屬、不是偶發 |
| 2 | `Codex/2026-07-15/new-chat/.git` 由 **`Chuan\CodexSandboxOffline`** 建立 | 該 repo 單一（與同日 LESSONS 那條 Codex 沙箱 ignore 雷同源） |

**一個會騙人的細節**：git 檢查的是 **`.git` 目錄**的擁有者，**不是工作樹目錄**。
對工作樹跑 `Get-Acl` 會給出誤導答案——上面第 2 項的工作樹擁有者是 `CHUAN\jason`
（看起來沒問題），`.git` 才是沙箱帳號建的。

**診斷法**：`GIT_CONFIG_GLOBAL=/dev/null git -C <repo> rev-parse --is-inside-work-tree`
可看該 repo「沒有全域設定遮蓋」的原生狀態。實測 E 槽三個 repo 全 BLOCKED、
C 槽 `agent-dual-core` 正常。

## 為何長年沒被當成問題

全域 gitconfig 靠**一路 append `safe.directory`** 撐著：

| 量測 | 數字 |
|---|---|
| 總筆數 | 36 |
| 去重後 | 27 |
| **指向已刪除 worktree 的死條目** | **24** |
| 主 repo 重複次數 | 6 |
| `.gitconfig` 總行數 | 37（其中 36 行是 safe.directory） |

**當場抓到累積機制**：備份時筆數從稍早清點的 34 跳到 36，多出來的兩筆（重複）指向
`kind-hypatia-c45673`——**並行 session 的 worktree**。證實是 harness 建 worktree 時
自動 append，會重複、也偶爾會漏（G5 報告的附帶發現 3 就是漏掉的那次）。

## 修法

git 2.55.0 實測**支援結尾 `/*` 的前綴 glob 且遞迴生效**。負向對照確認 scope 正確，
不是「有 `*` 就全開」：

| 值 | 結果 |
|---|---|
| `E:/My Project/*` | ✅ 通 |
| `E:/My Project/.../worktrees/*` | ✅ 通 |
| `Z:/*`、`E:/Some Other Place/*`、別的專案路徑 | BLOCKED |
| `.../worktrees`（不帶 `/*`） | BLOCKED |

全域改成兩筆（**36 → 2**，`.gitconfig` 37 行 → 3 行）：

```
E:/My Project/*
C:/Users/jason/Documents/Codex/2026-07-15/new-chat
```

> **不要用裸 `*`**——那等於全域關閉擁有權檢查。`E:/My Project/*` 的語意是
> 「信任我自己專案資料夾底下的 repo」，範圍恰當。

**執行前先備份**：`gitconfig.bak`（全檔 37 行）＋ `safe-directory-before.txt`（36 筆），
存在本 session 的 scratchpad，可還原。

## 驗證

用**純 git、無任何 env override**逐一驗證：

| repo | 結果 |
|---|---|
| E: 主 repo | ✅ |
| E: `reverent-rosalind-99ffbc`（本 worktree，原本**沒有**條目） | ✅ |
| E: `kind-hypatia-c45673`（並行 session 的 worktree） | ✅ |
| E: `leverage-rebalancing-app` | ✅ |
| C: `new-chat` | ✅ |
| C: `agent-dual-core` | ✅ |

`npm run gate` 不帶繞法五段跑得完——第 4/5 段是真的執行，不是靠環境變數撐。

**副作用**：harness 之後仍會為新 worktree append 條目，但那些已被 glob 涵蓋，
只是無作用的重複，不影響正確性。

---

# 完成清單

| # | 項目 | 結果 |
|---|---|---|
| 1 | `vite.config.ts` 顯式 `envPrefix: 'VITE_'` | ✅ |
| 2 | `utils/viteConfigGuard.test.ts` 三層鎖 5 案 | ✅ |
| 3 | 紅燈自證（三種注入） | ✅ 4/5、3/5、2/5 紅，還原後 hash 比對無殘留 |
| 4 | `npm run gate` | ✅ worktree ＋ 主 repo 皆五段全綠、315 測試 |
| 5 | 更新 `docs/gate-audit-findings.md` 的 G3 狀態 | ✅ 未修→已修＋三層表＋紅燈自證表＋更正原文 |
| 6 | commit | ✅ `dab7508` |
| 7 | git `dubious ownership` 根因追查與修復 | ✅ 36 筆 → 2 筆 glob（使用者授權後執行） |
| 8 | `LESSONS.md` append 環境雷 | ✅ 現 174/200 行 |
| 9 | 合併回 main（`phase-loop` 階段 4 儀式四步） | ✅ `655373b` |
| 10 | 合併後複驗 | ✅ 主 repo gate 全綠、`.env 值 7 筆` |
| 11 | 更新記憶檔 | ✅ |

## 合併儀式執行紀錄（`phase-loop` 階段 4，順序固定）

| 步驟 | 結果 |
|---|---|
| (a) 清殘留 node 程序 | 無殘留，不會有 EPERM 檔案鎖炸合併 |
| (b) `git merge --no-ff` | `655373b`，3 files / +124 −8。`docs/gate-audit-findings.md` 與並行 session 的 G5 改動**自動合併成功**（G3／G5 分屬不同節，未衝突） |
| (c) 合併後複驗＋確認關鍵檔案已在 main | `utils/viteConfigGuard.test.ts`、`vite.config.ts` 的 `envPrefix`、以及**並行 session 的 `tsconfig.json` exclude 未被覆蓋**，三項皆確認 |
| (d) 更新記憶檔／LESSONS | 已更新記憶條目與索引；LESSONS 已 append |

---

# 未做（等使用者決定）

- **沒 push**：main 目前領先 `origin`。
- **worktree 沒清**：`kind-hypatia-c45673` 與 `reverent-rosalind-99ffbc` 都還在。
- **G6 仍未動**（prompt 端無防漂移鎖），照先前拍板不自行動手。
- **附帶發現 2（worktree gate 較弱）沒立案**：只寫進記憶檔，未加進審計文件的缺口清單。
  與 G5 報告的立場一致——立案與否是使用者的判斷。
- **`LESSONS.md` 174/200 行**，接近它自己訂的上限，之後可考慮跑 `/lessons-review` 精簡。
