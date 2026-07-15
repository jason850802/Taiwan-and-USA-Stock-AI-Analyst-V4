---
phase: 260715-jsr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/sync_skills_mirror.py
autonomous: true
requirements:
  - QUICK-260715-jsr
must_haves:
  truths:
    - "連跑 npm run sync:skills 3 次皆 exit 0、輸出全綠（不再間歇 WinError 5 存取被拒）"
    - "python scripts/sync_skills_mirror.py --check 逐 byte 比對回報鏡像一致（exit 0）"
    - "髒鏡像（多塞一檔／改壞一檔到白名單目錄）後跑 sync 能收斂回一致"
    - "__pycache__ 等 EXCLUDE_DIRS 不殘留於鏡像（與舊 rmtree+ignore_patterns 等效）"
    - "白名單以外目錄（如 source-command-gsd-*）不受影響；--check 只驗證不寫入"
  artifacts:
    - path: "scripts/sync_skills_mirror.py"
      provides: "原地鏡像同步（in-place overwrite），不對白名單目標整個 rmtree"
      contains: "def sync_dir"
  key_links:
    - from: "scripts/sync_skills_mirror.py::sync_dir"
      to: "scripts/sync_skills_mirror.py::iter_files"
      via: "共用同一份檔案集合（已排除 EXCLUDE_DIRS），使 sync 與 --check 依定義一致"
      pattern: "iter_files\\("
---

<objective>
根治 `scripts/sync_skills_mirror.py` 的 Windows `rmtree`→`copytree` 競態（間歇 WinError 5 存取被拒）。

改採原地覆寫（in-place overwrite）：不再對整個白名單目標 `rmtree` 後立刻 `copytree` 重建同一路徑——這正是 Windows 上「已標記刪除但尚未消失的目錄」與 copytree 重建撞路徑的競態根源。改為逐檔比對只寫有差異的檔、清掉來源已不存在的殘檔、移除 `EXCLUDE_DIRS`（如 `__pycache__`）與清空後的空目錄。

Purpose: 從原理上消除 delete-pending 目錄競態（不靠重試碰運氣），且無變更時零寫入、AV 掃描面最小。
Output: 修改後的 `scripts/sync_skills_mirror.py`（單檔、零外部依賴、繁中註解不變），連跑 3 次全綠且 `--check` byte-identical。
</objective>

<execution_context>
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/workflows/execute-plan.md
@D:/My Project/Taiwan-and-USA-Stock-AI-Analyst-V4/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@scripts/sync_skills_mirror.py

# 專案守則相關事實（CLAUDE.md）：
# - 改 .claude/skills/ 後才需跑 npm run sync:skills 同步 Codex 鏡像（.agents/skills/）
# - 驗證命令用 Bash 工具（Git Bash）跑；PowerShell 5.1 沒有 &&
# - 此腳本無 vitest 覆蓋，驗證靠實跑 sync ≥3 次 + --check
</context>

<tasks>

<task type="auto">
  <name>Task 1: 將 sync_dir 改為原地鏡像（消除 rmtree→copytree 競態）</name>
  <files>scripts/sync_skills_mirror.py</files>
  <action>
    只改 `sync_dir(name: str) -> None`（現行 43-47 行）與模組 docstring 用法列（第 5 行「先清後拷」措辭），其餘（`iter_files`、`compare_dir`、`main`、`--check`、`WHITELIST`、`EXCLUDE_DIRS`、`ROOT/SRC_BASE/DST_BASE`、UTF-8 reconfigure）一律不動。

    重寫 `sync_dir` 為原地覆寫，簽名不變，步驟如下（純標準庫 `shutil`/`pathlib`，`shutil` 已 import）：
    1. `dst = DST_BASE / name`；`dst.mkdir(parents=True, exist_ok=True)`——對已存在目錄是 no-op，絕不對白名單目標整個 rmtree 後重建同路徑（這是本 bug 根因，務必移除舊的 `if dst.exists(): shutil.rmtree(dst)` + `shutil.copytree(...)`）。
    2. `src_files = set(iter_files(SRC_BASE / name))`——重用既有 `iter_files`（已排除 `EXCLUDE_DIRS`），使 sync 與 `compare_dir`/`--check` 依定義吃同一份檔案集合。
    3. 逐檔覆寫：對 `sorted(src_files)` 每個 `rel`，令 `s = SRC_BASE/name/rel`、`d = dst/rel`；僅在 `not d.is_file()` 或 `s.read_bytes() != d.read_bytes()` 時，`d.parent.mkdir(parents=True, exist_ok=True)` 後 `shutil.copy2(s, d)`——內容相同則不寫（無變更零寫入）。
    4. 清殘檔：對 `set(iter_files(dst)) - src_files` 每個 `rel` 執行 `(dst/rel).unlink()`——清掉髒狀態多塞的檔與來源已刪除的檔。
    5. 清 EXCLUDE_DIRS 與空目錄以維持與舊 rmtree 等效：對 `dst.rglob("*")` 依路徑深度由深到淺（例如 `key=lambda p: len(p.parts)`, `reverse=True`）走訪目錄；`p.name in EXCLUDE_DIRS` 時 `shutil.rmtree(p, ignore_errors=True)`（`__pycache__` 被 `iter_files` 排除故不會在步驟 4 被清，需在此整包移除；因不在同一次執行重建同路徑，不會重現 delete-pending 競態），否則若 `not any(p.iterdir())` 則 `p.rmdir()`。

    docstring 第 5 行把「先清後拷，僅白名單」改為反映原地覆寫（例如「原地覆寫，僅白名單，無變更零寫入」），保持繁中風格。行為契約全部維持：白名單以外目錄不碰、`--check` 只驗不寫、不一致以非零 exit 列檔名、`__pycache__` 永不進鏡像。
  </action>
  <verify>
    <automated>python scripts/sync_skills_mirror.py --check; echo "exit=$?"</automated>
  </verify>
  <done>`sync_dir` 內不再出現「rmtree 整個 dst 後 copytree 重建同路徑」；`python scripts/sync_skills_mirror.py` 與 `--check` 皆 exit 0 並印「鏡像一致 ✓」。</done>
</task>

<task type="auto">
  <name>Task 2: 競態消除與收斂驗證（3 次連跑 + 髒狀態 + __pycache__）</name>
  <files>scripts/sync_skills_mirror.py</files>
  <action>
    以 Bash 工具（Git Bash；PowerShell 5.1 無 `&&`）在專案根執行使用者明定的驗收電池，全程不改碼、驗畢還原乾淨狀態：
    1. 連跑 3 次：`python scripts/sync_skills_mirror.py && python scripts/sync_skills_mirror.py && python scripts/sync_skills_mirror.py`——三次皆 exit 0、每個白名單目錄印 `[OK]`、末尾「鏡像一致 ✓」。
    2. byte-identical 驗證：`python scripts/sync_skills_mirror.py --check`——exit 0，逐 byte 比對一致。
    3. 髒狀態收斂（多塞檔）：對某白名單鏡像目錄（如 `.agents/skills/entry-decision/`）用 Python 寫入一個殘檔（勿用 denylist 的 rm；用 `python -c` 建立），跑一次 sync 後該殘檔應被清除、`--check` 回一致。
    4. 髒狀態收斂（改壞既有鏡像檔）：用 Python 覆寫某鏡像檔內容（如 `_shared/` 內任一檔）製造內容不一致，跑一次 sync 後應被來源覆寫回、`--check` 回一致。
    5. EXCLUDE_DIRS 等效：用 Python 在某鏡像目錄建立 `__pycache__/x.pyc`，跑一次 sync 後 `__pycache__` 應不殘留於鏡像、`--check` 回一致。
    每步以 `echo "exit=$?"` 斷言退出碼。任一步非 0 或 `--check` 不一致即為失敗，回報實際輸出。
  </action>
  <verify>
    <automated>python scripts/sync_skills_mirror.py && python scripts/sync_skills_mirror.py && python scripts/sync_skills_mirror.py && python scripts/sync_skills_mirror.py --check; echo "exit=$?"</automated>
  </verify>
  <done>3 次連跑皆 exit 0 全綠；`--check` byte-identical（exit 0）；多塞檔／改壞檔／`__pycache__` 三種髒狀態跑 sync 後皆收斂回一致；白名單以外目錄未被觸碰。</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem（.claude/skills → .agents/skills） | 本次唯一邊界；無網路、無外部輸入、無套件安裝 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260715-jsr-01 | Tampering | `sync_dir` 殘檔清理（unlink/rmtree） | mitigate | 清理範圍嚴格限縮在 `dst = DST_BASE / name`（name ∈ WHITELIST）子樹，`rglob` 只掃該子樹；白名單以外目錄（source-command-gsd-*）永不進迴圈，無誤刪面 |
| T-260715-jsr-02 | Denial of Service | Windows delete-pending 競態 | mitigate | 移除整目錄 rmtree→copytree 重建同路徑；原地覆寫使競態依原理消失（非重試碰運氣），並由 3 次連跑 + 髒狀態電池佐證 |
| T-260715-jsr-SC | Tampering | 套件安裝 | accept | 本任務零 npm/pip/cargo 安裝，僅標準庫；無供應鏈面 |
</threat_model>

<verification>
- `python scripts/sync_skills_mirror.py` 連跑 3 次皆 exit 0、輸出全綠。
- `python scripts/sync_skills_mirror.py --check` exit 0、鏡像 byte-identical。
- 髒狀態（多塞檔／改壞檔／`__pycache__`）跑 sync 後皆收斂回一致。
- `git diff --stat` 僅顯示 `scripts/sync_skills_mirror.py` 一檔變更（鏡像內容於驗證後回到乾淨一致態）。
</verification>

<success_criteria>
- `sync_dir` 不再對白名單目標整個 rmtree 後 copytree 重建（競態根源移除）。
- 連跑 3 次全綠 + `--check` byte-identical + 三種髒狀態收斂 全數通過。
- 行為契約維持：白名單外目錄不碰、`--check` 只驗不寫、不一致非零 exit 列檔名、`__pycache__` 不進鏡像。
- 只改 `scripts/sync_skills_mirror.py` 一檔，繁中註解與單檔零依賴風格不變。
</success_criteria>

<output>
Create `.planning/quick/260715-jsr-sync-skills-mirror-py-windows-rmtree/260715-jsr-SUMMARY.md` when done.
</output>
