#!/usr/bin/env python3
"""同步 skills 鏡像 → .agents/skills（Codex 讀取端）。

兩個來源，都只同步白名單：
  1. 專案自有 skills：.claude/skills（唯一事實來源）
  2. Matt Pocock skills：Claude 的 plugin 快取——Claude 由 plugin 直接載入，
     但 Codex 讀不到 plugin 目錄，故鏡像一份到 .agents/skills 供 Codex 使用。

用法：
  python scripts/sync_skills_mirror.py          # 同步（原地覆寫，僅白名單，無變更零寫入）＋驗證
  python scripts/sync_skills_mirror.py --check  # 只驗證不複製（給 CI 或覆核用）

任何不一致以非零 exit code 失敗並列出檔名。
白名單以外的目錄一律不碰（手動放進鏡像的東西不會被刪，但也不會被更新）——
但會以 [WARN] 列出來，因為「不碰」等於零偵測，孤兒被 commit 後就再也沒人會提它。
找不到 Matt plugin 時只警告不失敗——CI／他台機器可能沒安裝，專案自有 skills 的同步不該被拖累。
"""
import argparse
import shutil
import sys
from pathlib import Path

EXCLUDE_DIRS = {"__pycache__"}

# 文字副檔名一律以 LF 正規化後比較／寫入。理由：Matt plugin 快取在 Windows 上是 CRLF，
# 而本 repo 的 .gitattributes 把 *.md 釘成 eol=lf——不正規化的話，checkout 後鏡像變 LF、
# 來源仍 CRLF，逐位元組比對會永遠誤報「內容不一致」。
TEXT_SUFFIXES = {".md", ".yaml", ".yml", ".json", ".txt", ".py", ".sh", ".js", ".ts", ".toml"}

ROOT = Path(__file__).resolve().parent.parent
DST_BASE = ROOT / ".agents" / "skills"


def read_normalized(p: Path) -> bytes:
    """讀檔內容；文字檔的 CRLF 一律轉 LF 後回傳（二進位檔原樣）。"""
    data = p.read_bytes()
    if p.suffix.lower() in TEXT_SUFFIXES:
        data = data.replace(b"\r\n", b"\n")
    return data

# ── 來源 1：專案自有 skills ──────────────────────────────────────────────
PROJECT_SRC_BASE = ROOT / ".claude" / "skills"
PROJECT_WHITELIST = [
    "trend-analysis",
    "position-analysis",
    "kline-signal",
    "ma-structure",
    "volume-analysis",
    "indicator-analysis",
    "entry-decision",
    "tw-fundamentals",
    "start-dev",   # 起 dev 環境流程，Codex 也要能照著開
    "_shared",
]
# 註：`phase-loop` 刻意不在白名單——規劃由 Claude/Fable 做，Codex 只收 PLAN 文件執行。

# ── 來源 2：Matt Pocock skills（plugin 快取）────────────────────────────
# 只鏡像「Codex 實際會用到」的：engineering 全套（CORE_RULES.md 工作流路由表所指）
# ＋ productivity 的兩個相依項。deprecated／in-progress／misc／personal 一律不碰。
MATT_PLUGIN_ROOT = Path.home() / ".claude" / "plugins" / "cache" / "mattpocock" / "mattpocock-skills"
MATT_WHITELIST = [
    ("engineering", "ask-matt"),
    ("engineering", "code-review"),
    ("engineering", "codebase-design"),
    ("engineering", "diagnosing-bugs"),
    ("engineering", "domain-modeling"),
    ("engineering", "grill-with-docs"),
    ("engineering", "implement"),
    ("engineering", "improve-codebase-architecture"),
    ("engineering", "prototype"),
    ("engineering", "research"),
    ("engineering", "resolving-merge-conflicts"),
    ("engineering", "setup-matt-pocock-skills"),
    ("engineering", "tdd"),
    ("engineering", "to-spec"),
    ("engineering", "to-tickets"),
    ("engineering", "triage"),
    ("engineering", "wayfinder"),
    ("productivity", "grilling"),   # grill-with-docs 與 triage 都靠它
    ("productivity", "handoff"),    # 跨 session 交接（Matt 主流的 context hygiene）
]


def _version_key(p: Path) -> tuple[int, ...]:
    """把 '1.10.0' 這種版本目錄名轉成可比較的整數 tuple（字串排序會把 1.10 排在 1.9 前面）。"""
    try:
        return tuple(int(x) for x in p.name.split("."))
    except ValueError:
        return (0,)


def matt_skills_base() -> Path | None:
    """解析 plugin 快取的版本目錄，取最新版的 skills/；找不到回 None。"""
    if not MATT_PLUGIN_ROOT.is_dir():
        return None
    candidates = [p for p in MATT_PLUGIN_ROOT.iterdir() if (p / "skills").is_dir()]
    if not candidates:
        return None
    return max(candidates, key=_version_key) / "skills"


def iter_files(base: Path):
    """列出 base 下所有檔案的相對路徑（排除 __pycache__ 等垃圾目錄）。"""
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base)
        if p.is_file() and not (set(rel.parts) & EXCLUDE_DIRS):
            yield rel


def sync_dir(src: Path, dst: Path) -> None:
    """原地覆寫鏡像（不對整個 dst rmtree 後 copytree 重建同路徑）。

    Windows 上「rmtree 整目錄→立刻 copytree 重建同一路徑」會撞上「已標記刪除
    但尚未消失的目錄」→間歇 WinError 5 存取被拒。改逐檔比對只寫有差異的檔、
    清來源已無的殘檔、移除 EXCLUDE_DIRS 與清空後的空目錄，從原理消除競態。
    """
    dst.mkdir(parents=True, exist_ok=True)

    src_files = set(iter_files(src))

    # 逐檔覆寫：目標必須**逐位元組等於正規化後的來源**（不只語意相同）——
    # 這樣鏡像的行尾恆為 LF，與 .gitattributes 的 eol=lf 一致；已正確的檔案不重寫。
    for rel in sorted(src_files):
        s, d = src / rel, dst / rel
        content = read_normalized(s)
        if not d.is_file() or d.read_bytes() != content:
            d.parent.mkdir(parents=True, exist_ok=True)
            d.write_bytes(content)

    # 清殘檔：鏡像多出（髒狀態多塞／來源已刪）的檔
    for rel in set(iter_files(dst)) - src_files:
        (dst / rel).unlink()

    # 清 EXCLUDE_DIRS 與空目錄以維持與舊 rmtree 等效（由深到淺走訪）
    for p in sorted(dst.rglob("*"), key=lambda q: len(q.parts), reverse=True):
        if not p.is_dir():
            continue
        if p.name in EXCLUDE_DIRS:
            shutil.rmtree(p, ignore_errors=True)
        elif not any(p.iterdir()):
            p.rmdir()


def compare_dir(src: Path, dst: Path, label: str) -> list[str]:
    if not src.is_dir():
        return [f"來源缺目錄：{src.as_posix()}"]
    if not dst.is_dir():
        return [f"鏡像缺目錄：{dst.as_posix()}"]
    src_files = set(iter_files(src))
    dst_files = set(iter_files(dst))
    problems = [f"鏡像缺檔：{label}/{r.as_posix()}" for r in sorted(src_files - dst_files)]
    problems += [f"鏡像多檔：{label}/{r.as_posix()}" for r in sorted(dst_files - src_files)]
    for rel in sorted(src_files & dst_files):
        if read_normalized(src / rel) != read_normalized(dst / rel):
            problems.append(f"內容不一致：{label}/{rel.as_posix()}")
    return problems


def resolve_pairs() -> tuple[list[tuple[Path, Path, str]], list[str]]:
    """展開兩個來源的白名單為 (src, dst, label) 清單；回傳 (pairs, warnings)。"""
    pairs = [(PROJECT_SRC_BASE / n, DST_BASE / n, n) for n in PROJECT_WHITELIST]
    warnings: list[str] = []

    matt_base = matt_skills_base()
    if matt_base is None:
        warnings.append(
            f"找不到 Matt Pocock plugin 快取（{MATT_PLUGIN_ROOT.as_posix()}）"
            "——略過該來源，只同步專案自有 skills。"
        )
    else:
        warnings.append(f"Matt plugin 來源：{matt_base.as_posix()}")
        for category, name in MATT_WHITELIST:
            pairs.append((matt_base / category / name, DST_BASE / name, name))
    return pairs, warnings


def find_orphans(expected: set[str]) -> list[str]:
    """列出鏡像裡白名單外的頂層目錄（＝永不更新的孤兒）。

    白名單外的東西本腳本一律不碰——這是刻意的（手動塞的檔案不會被刪）。但「不碰」
    等於「零機械偵測」：孤兒一旦被 commit 進去，git status 就再也不會提它，而 Codex
    仍照著讀，等於一份永遠不更新的假規則（gate 負向測試 E8 已實測確認此行為）。
    所以這裡只**印警示不改 exit code**：孤兒不是不一致，紅燈會誤導；但它必須有人看得到。
    """
    if not DST_BASE.is_dir():
        return []
    return sorted(
        p.name for p in DST_BASE.iterdir()
        if p.is_dir() and p.name not in expected and p.name not in EXCLUDE_DIRS
    )


def main() -> None:
    # Windows console 預設 cp950，印中文／✓ 會 UnicodeEncodeError，強制 UTF-8
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="同步 skills 鏡像 → .agents/skills")
    parser.add_argument("--check", action="store_true", help="只驗證不複製")
    args = parser.parse_args()

    pairs, warnings = resolve_pairs()
    for w in warnings:
        print(f"[INFO] {w}")

    if not args.check:
        for src, dst, label in pairs:
            if not src.is_dir():
                print(f"[FAIL] 來源不存在：{src.as_posix()}")
                sys.exit(1)
            sync_dir(src, dst)
            print(f"[SYNC] {label}")

    all_problems: list[str] = []
    for src, dst, label in pairs:
        problems = compare_dir(src, dst, label)
        print(f"[{'OK' if not problems else 'DIFF'}] {label}")
        all_problems.extend(problems)

    orphans = find_orphans({label for _, _, label in pairs})
    if orphans:
        print("\n[WARN] 鏡像裡有白名單外的目錄——本腳本不會同步也不會刪，它們永不更新：")
        for name in orphans:
            print(f"  - .agents/skills/{name}")
        print("  處置：若該 skill 該進鏡像，加進本腳本的白名單；否則手動刪除。")
        print("  （這不算不一致，故不影響 exit code。）")

    if all_problems:
        print("\n不一致清單：")
        for p in all_problems:
            print(f"  - {p}")
        sys.exit(1)
    print("鏡像一致 ✓")


if __name__ == "__main__":
    main()
