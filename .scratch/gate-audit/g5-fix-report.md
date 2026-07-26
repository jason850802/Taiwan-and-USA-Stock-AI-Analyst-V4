# G5 修復回報：tsc 非密閉（型檢吸進 build 產物）

**日期**：2026-07-26
**分支**：`claude/kind-hypatia-c45673` → 合併 main
**commit**：`dd3e1e8`（修復）／`6e7a28f`（合併）
**來源**：`docs/gate-audit-findings.md` 缺口 G5

---

## 一句話結論

`tsconfig.json` 補上 `exclude`，型檢範圍從 116 檔收斂到 108 檔，8 個 `dist/assets/*.js`
全數排除，`api/` 12 檔與所有 app 原始碼未受影響。**gate 的密閉性成立**——
`npx tsc --noEmit` 的結果不再取決於 `dist/` 在不在。

---

## 問題

`tsconfig.json` 沒有 `include`／`exclude`／`files`，走 TypeScript 預設 `**/*` ＋
`allowJs: true`，把自己的建置產物吸進型檢範圍。後果：

1. **非密閉**：文件版 gate 順序是 tsc → … → build，所以「build 前跑 tsc」與
   「build 後跑 tsc」檢查的是**不同的檔案母體**。
2. 白費時間型檢壓縮後的 vendor bundle。

## 修法

[`tsconfig.json`](../../tsconfig.json) 加：

```json
"exclude": [
  "node_modules",
  "dist",
  ".claude"
]
```

> **易錯點**：`node_modules` 必須顯式列出。一旦自訂 `exclude`，TypeScript 的預設排除清單
> （`node_modules`／`bower_components`／`jspm_packages`／`outDir`）會**整個被取代而非附加**。

---

## 驗證

方法：先 `npm run build` 讓 `dist/` 存在，重現審計描述的狀態，再做 `--listFilesOnly` 前後對比。

### 範圍對比（皆在 `dist/` 存在的狀態下量）

| 量測 | 修前 | 修後 |
|---|---|---|
| 總檔數（排除 node_modules） | 116 | **108** |
| `dist/assets/*.js` | 8 | **0** |
| `api/` | 12 | **12**（未動） |
| `.claude/` | 0 | 0（本來就是 0，見發現 1） |

diff 只有那 8 行 `dist/`，其餘逐字不變——**沒有誤傷任何原始碼**。

### 密閉性

修後（`dist/` 存在）的清單與 build 前（`dist/` 不存在）的基線**逐字相同**。
tsc 範圍不再取決於 `dist/` 是否存在。

### 機械 gate

| 環境 | 結果 |
|---|---|
| worktree | `npm run gate` 五段全綠 exit=0 |
| 主 repo（合併後複驗） | `npm run gate` 五段全綠 exit=0，金鑰掃描 **`.env 值 7 筆`** |

合併後的複驗刻意在**主 repo** 跑完整 gate 而非只跑 `npx tsc --noEmit`（儀式的最低要求），
理由見發現 2：只有主 repo 有真 `.env`，金鑰掃描的 (b)(c) 兩條規則在那裡才真的有東西可比對。
主 repo 那次是真的拿 7 個真實秘密比對過 `dist/` 與 147 個追蹤原始碼檔。

---

## 完成清單

| # | 項目 | 結果 |
|---|---|---|
| 1 | `tsconfig.json` 加 `exclude` | ✅ |
| 2 | `--listFilesOnly` 前後對比驗證 | ✅ 116→108，`api/` 12 檔未動 |
| 3 | `npm run gate` | ✅ 五段全綠 exit=0 |
| 4 | 更新 `docs/gate-audit-findings.md` 的 G5 狀態 | ✅ 未修→已修＋驗證數據＋更正第 3 點 |
| 5 | commit | ✅ `dd3e1e8` |
| 6 | git `safe.directory` | ✅ 見發現 3 |
| 7 | 合併回 main（`phase-loop` 階段 4 儀式四步） | ✅ `6e7a28f` |
| 8 | 合併後複驗 | ✅ 主 repo gate 全綠 |
| 9 | 更新記憶檔 | ✅ |

### 合併儀式執行紀錄（`phase-loop` 階段 4，順序固定）

| 步驟 | 結果 |
|---|---|
| (a) 清殘留 node 程序 | 無殘留，不會有 EPERM 檔案鎖炸合併 |
| (b) `git merge --no-ff` | `6e7a28f`，2 files / +27 −5 |
| (c) 合併後複驗＋確認關鍵檔案已在 main | 見上方「機械 gate」 |
| (d) 更新記憶檔 | 已更新 `gate-audit-findings` 記憶條目與索引 |

---

## 三個附帶發現

### 1. 審計 G5 第 3 點是錯的（已在文件更正）

原文擔心「若存在 agent worktree，`.claude/` 下的複本會被同樣吸進來」。**複驗證否**：
TypeScript 預設 `**/*` glob **不匹配以 `.` 開頭的路徑段**。實測本 worktree `.claude/hooks/`
下有 10+ 個 `.js` 且 `allowJs: true`，**修前修後都是 0 檔進範圍**。

真正的污染源只有 `dist/`。`.claude` 仍留在 exclude 是為了把意圖顯式化，不是在擋現行污染。
`docs/gate-audit-findings.md` 已改成劃線更正而非刪除，保留原始判斷的痕跡。

### 2. worktree 裡的「gate 全綠」比主 repo 弱（尚未立案）

worktree 只有 `.env.example`（範本檔，腳本按設計跳過），沒有真 `.env`
→ 金鑰掃描規則 (b)(c) **靜默降級成 0 筆比對**（印「.env 值 0 筆」，主 repo 是「7 筆」）。

補 G1／G2（最高嚴重度）的正是這兩條。gate 不會為此出聲，看起來一樣是全綠。
**要完整驗金鑰請在主 repo 目錄跑。**

此事只寫進記憶檔，**未**在 `docs/gate-audit-findings.md` 立為新缺口——立案與否是使用者的判斷。

### 3. 本 worktree 當初漏了 `safe.directory` 登記

第一次跑 gate 直接卡在 `[4/5] git ls-files 失敗（不在 git repo 內？）`，與 tsconfig 無關。
根因是 E: 磁碟不記錄 ownership，git 觸發 `dubious ownership` 保護。

當時的處理：驗證階段用 `GIT_CONFIG_COUNT` 環境變數臨時注入（**不動 global config**），
確認全綠後才依使用者指示做永久修。該筆單一路徑條目現已被全域的 `E:/My Project/*`
glob 涵蓋，無需維護。

---

## 未做（等使用者決定）

- **沒 push**：main 目前領先 `origin`。
- **worktree 沒清**：`kind-hypatia-c45673` 與 `reverent-rosalind-99ffbc` 都還在。
- **附帶發現 2 沒立案**：只寫進記憶檔，未加進審計文件的缺口清單。
- **G6 仍未動**（prompt 端無防漂移鎖），照先前拍板不自行動手。
