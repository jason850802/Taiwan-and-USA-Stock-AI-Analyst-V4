---
phase: 260715-jsr
plan: 01
subsystem: build-tooling
tags: [windows, filesystem, race-condition, skills-mirror]
requires: []
provides:
  - "scripts/sync_skills_mirror.py 原地覆寫鏡像同步（不 rmtree 白名單目標）"
affects:
  - scripts/sync_skills_mirror.py
tech-stack:
  added: []
  patterns:
    - "in-place overwrite（逐檔 byte 比對，無變更零寫入）取代 rmtree→copytree 重建同路徑"
key-files:
  created: []
  modified:
    - scripts/sync_skills_mirror.py
decisions:
  - "原理消除競態（移除 delete-pending 目錄重建），不採 retry/sleep 碰運氣"
metrics:
  duration: 6 min
  completed: 2026-07-15
---

# Phase 260715-jsr: sync_skills_mirror Windows rmtree 競態根治 Summary

一句話：`sync_skills_mirror.py` 的 `sync_dir` 由「rmtree 整個白名單目標→copytree 重建同路徑」改為原地覆寫（逐檔 byte 比對只寫差異、清殘檔、移除 `EXCLUDE_DIRS` 與空目錄），從原理消除 Windows delete-pending 目錄與 copytree 撞路徑的間歇 WinError 5 競態。

## 做了什麼

- **Task 1**：重寫 `sync_dir(name)`（簽名不變，純標準庫）：
  1. `dst.mkdir(parents=True, exist_ok=True)`（已存在 no-op，不 rmtree）。
  2. `src_files = set(iter_files(src))`——重用既有 `iter_files`（已排除 `__pycache__`），與 `compare_dir`/`--check` 吃同一份集合。
  3. 逐檔覆寫：僅 `not d.is_file()` 或 byte 不同才 `copy2`（無變更零寫入）。
  4. 清殘檔：`set(iter_files(dst)) - src_files` 逐一 `unlink()`（清髒狀態多塞檔與來源已刪檔）。
  5. 由深到淺走訪 `dst.rglob("*")`：`EXCLUDE_DIRS` 目錄 `rmtree(ignore_errors=True)`、清空目錄 `rmdir()`（與舊 rmtree 等效，`__pycache__` 永不進鏡像）。
  - docstring 用法列「先清後拷」→「原地覆寫，僅白名單，無變更零寫入」。
- **Task 2**：以 Git Bash 跑使用者明定驗收電池（不改碼，測試髒狀態一律用 Python 建/刪，不碰 denylist 的 rm）。

## 驗證了什麼（實際結果，全綠）

- 3 次連跑 `sync`：`run1=0 run2=0 run3=0`，每白名單目錄 `[SYNC]`/`[OK]`、末尾「鏡像一致 ✓」。
- `--check` byte-identical：`check=0`。
- 髒狀態多塞檔（`.agents/skills/entry-decision/__STRAY__.txt`）：sync 後 `stray-removed=0`、`--check=0`。
- 髒狀態改壞既有鏡像檔（`_shared/fetch_stock.py` 覆為 `CORRUPTED`）：sync 後 byte `restored=0`、`--check=0`。
- `__pycache__` 等效排除（建 `entry-decision/__pycache__/x.pyc`）：sync 後 `pycache-gone=0`、`--check=0`。
- 白名單以外：`.agents/skills` 下無白名單外目錄（`[]`）；清理範圍僅限 `DST_BASE/name` 子樹，結構性不觸碰他處。
- 驗後 git status 僅 `scripts/sync_skills_mirror.py` 一檔變更，`.agents/` 無測試殘留假檔。

## 沒驗證什麼

- 3 次連跑為必要非充分（間歇競態本質）；未做上百次壓力連跑，但修法在原理上移除了 rmtree→重建同路徑的競態模式，非靠重試。
- 未在多進程並發下測試（本腳本為單進程序列同步，非並發使用情境）。

## Deviations from Plan

### 觀察（非改碼）：鏡像 CRLF 工作區 churn

- **Found during:** Task 1 驗證後 `git status`。
- **現象:** 跑 sync 後 `.agents/skills/**` 10 個 tracked 檔顯示 modified。
- **判定:** 以 `--ignore-cr-at-eol` 比對無內容差異、逐 byte 比對鏡像 vs 來源 `mismatches=0`；`git add` 後 `git diff --cached --stat` 為空——git autocrlf 將 CRLF 正規化回 LF，committed blob 不變（**無實質內容 drift**）。此 CRLF churn 係 `copy2` 逐 byte 複製來源（CRLF）之既有行為，與本次 `sync_dir` 改動無關，屬 out-of-scope。
- **處置:** `git checkout -- .agents/skills/` 還原工作區，保持 tree 乾淨；未納入 commit（無實質變動可提交）。

其餘：plan 按原設計執行，Task 2 為純驗證無碼變更。

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: scripts/sync_skills_mirror.py（含 `def sync_dir`、原地覆寫、無 rmtree(dst)）
- FOUND: commit 152dadf（git log 可見）
- 驗證電池全步 exit 0；git status 無測試殘留
