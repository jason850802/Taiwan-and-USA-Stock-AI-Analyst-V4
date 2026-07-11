#!/usr/bin/env python3
"""同步朱家泓技能鏡像：.claude/skills（唯一事實來源）→ .agents/skills（Codex 讀取）。

用法：
  python scripts/sync_skills_mirror.py          # 同步（先清後拷，僅白名單）＋驗證
  python scripts/sync_skills_mirror.py --check  # 只驗證不複製（給 CI 或覆核用）

任何不一致以非零 exit code 失敗並列出檔名。
白名單以外的目錄（如 source-command-gsd-*）一律不碰。
"""
import argparse
import shutil
import sys
from pathlib import Path

# 鏡像白名單（來源：.planning/workspace-hygiene/PLAN.md 共用背景）
WHITELIST = [
    "trend-analysis",
    "position-analysis",
    "kline-signal",
    "ma-structure",
    "volume-analysis",
    "indicator-analysis",
    "entry-decision",
    "tw-fundamentals",
    "_shared",
]
EXCLUDE_DIRS = {"__pycache__"}

ROOT = Path(__file__).resolve().parent.parent
SRC_BASE = ROOT / ".claude" / "skills"
DST_BASE = ROOT / ".agents" / "skills"


def iter_files(base: Path):
    """列出 base 下所有檔案的相對路徑（排除 __pycache__ 等垃圾目錄）。"""
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base)
        if p.is_file() and not (set(rel.parts) & EXCLUDE_DIRS):
            yield rel


def sync_dir(name: str) -> None:
    src, dst = SRC_BASE / name, DST_BASE / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*EXCLUDE_DIRS))


def compare_dir(name: str) -> list[str]:
    src, dst = SRC_BASE / name, DST_BASE / name
    if not src.is_dir():
        return [f"來源缺目錄：{src.as_posix()}"]
    if not dst.is_dir():
        return [f"鏡像缺目錄：{dst.as_posix()}"]
    src_files = set(iter_files(src))
    dst_files = set(iter_files(dst))
    problems = [f"鏡像缺檔：{name}/{r.as_posix()}" for r in sorted(src_files - dst_files)]
    problems += [f"鏡像多檔：{name}/{r.as_posix()}" for r in sorted(dst_files - src_files)]
    for rel in sorted(src_files & dst_files):
        if (src / rel).read_bytes() != (dst / rel).read_bytes():
            problems.append(f"內容不一致：{name}/{rel.as_posix()}")
    return problems


def main() -> None:
    # Windows console 預設 cp950，印中文／✓ 會 UnicodeEncodeError，強制 UTF-8
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="同步 .claude/skills → .agents/skills 鏡像")
    parser.add_argument("--check", action="store_true", help="只驗證不複製")
    args = parser.parse_args()

    if not args.check:
        for name in WHITELIST:
            if not (SRC_BASE / name).is_dir():
                print(f"[FAIL] 來源不存在：{(SRC_BASE / name).as_posix()}")
                sys.exit(1)
            sync_dir(name)
            print(f"[SYNC] {name}")

    all_problems: list[str] = []
    for name in WHITELIST:
        problems = compare_dir(name)
        print(f"[{'OK' if not problems else 'DIFF'}] {name}")
        all_problems.extend(problems)

    if all_problems:
        print("\n不一致清單：")
        for p in all_problems:
            print(f"  - {p}")
        sys.exit(1)
    print("鏡像一致 ✓")


if __name__ == "__main__":
    main()
