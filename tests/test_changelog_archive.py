"""CHANGELOG.md holds 1.11.0 on; every release before it lives, unedited, in
docs/history/changelog-archive.md (moved 2026-11-08: the file had reached 542 KB)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE = re.compile(r"(?m)^## \[(\d+)\.(\d+)\.(\d+)\]")
CUT = (1, 11, 0)


def _releases(path: Path) -> list[tuple[int, ...]]:
    return [tuple(map(int, m)) for m in RELEASE.findall(path.read_text(encoding="utf-8"))]


def test_the_archive_holds_every_old_release():
    old = _releases(ROOT / "docs" / "history" / "changelog-archive.md")
    assert len(old) == 252
    assert old[0] == (1, 10, 137) and old[-1] == (1, 1, 0)
    assert all(v < CUT for v in old)


def test_the_changelog_holds_only_1_11_on():
    new = _releases(ROOT / "CHANGELOG.md")
    assert new and all(v >= CUT for v in new)
    assert (1, 11, 0) in new
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert "docs/history/changelog-archive.md" in text
