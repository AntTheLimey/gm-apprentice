#!/usr/bin/env python3
"""Tests for dnd_sheet.py: report and fill a D&D PC note's derived cells."""

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "skills" / "shared" / "scripts" / "dnd_sheet.py"
FIXTURES = ROOT / "tests" / "fixtures" / "dnd-pcs"


def run(path, *args):
    p = subprocess.run([sys.executable, str(SCRIPT), str(path), *args],
                       capture_output=True, text=True)
    return p.returncode, p.stdout.replace("\r\n", "\n"), p.stderr


def rows(out, status):
    return [ln.split("\t") for ln in out.splitlines() if ln.startswith(status + "\t")]


def copy(tmp_path, name):
    dst = tmp_path / name
    shutil.copyfile(FIXTURES / name, dst)
    return dst


def test_clean_sheet_has_nothing_to_fill():
    code, out, _ = run(FIXTURES / "clean.md")
    assert code == 0
    assert rows(out, "FILL") == []
    assert rows(out, "ERROR") == []
    # Initiative carries a reason, so it is kept, and the sum is shown.
    assert ["KEPT", "Stat Sheet / Combat / Initiative", "+3 (Alert); the sum gives +0"] in rows(out, "KEPT")
    assert out.rstrip().splitlines()[-1] == "# same: 36  fill: 0  kept: 1"


def test_flawed_sheet_lists_each_fill_with_old_and_new():
    code, out, _ = run(FIXTURES / "flawed.md")
    assert code == 0
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Stat Sheet / Core / Proficiency Bonus"] == "+2 -> +3"
    assert fills["Stat Sheet / Ability Scores / WIS / Save"] == "(blank) -> +4"
    assert fills["Skills / Athletics / Modifier"] == "+6 -> +7"
    assert fills["Stat Sheet / Senses / Passive Perception"] == "13 -> 14"
    assert fills["Spellcasting / Spell Save DC"] == "13 -> 14"
    assert len(fills) == 5


def test_report_does_not_write(tmp_path):
    p = copy(tmp_path, "flawed.md")
    before = p.read_bytes()
    run(p)
    assert p.read_bytes() == before


def test_write_fills_and_is_idempotent(tmp_path):
    p = copy(tmp_path, "flawed.md")
    run(p, "--write")
    assert p.read_text(encoding="utf-8").replace("\r\n", "\n") == \
        (FIXTURES / "clean.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    once = p.read_bytes()
    code, out, _ = run(p, "--write")
    assert p.read_bytes() == once
    assert rows(out, "FILL") == []


def test_write_keeps_crlf(tmp_path):
    p = tmp_path / "crlf.md"
    text = (FIXTURES / "flawed.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    p.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
    run(p, "--write")
    data = p.read_bytes()
    assert b"\r\n" in data and b"\n" not in data.replace(b"\r\n", b"")


def test_hand_set_numbers_survive(tmp_path):
    p = copy(tmp_path, "kept.md")
    code, out, _ = run(p, "--write")
    kept = {r[1]: r[2] for r in rows(out, "KEPT")}
    assert kept["Skills / Stealth / Modifier"] == "+5 (cloak of elvenkind); the sum gives +0"
    assert kept["Stat Sheet / Senses / Passive Insight"] == "about fourteen; not read as a number; the sum gives 14"
    text = p.read_text(encoding="utf-8")
    assert "+5 (cloak of elvenkind)" in text and "about fourteen" in text


def test_bare_hand_set_number_is_shown_before_it_is_replaced(tmp_path):
    p = tmp_path / "bare.md"
    p.write_text((FIXTURES / "clean.md").read_text(encoding="utf-8")
                 .replace("| Stealth | DEX | No | No | +0 |", "| Stealth | DEX | No | No | +7 |"),
                 encoding="utf-8")
    _, out, _ = run(p)
    assert ["FILL", "Skills / Stealth / Modifier", "+7 -> +0"] in rows(out, "FILL")
    assert "| +7 |" in p.read_text(encoding="utf-8")


def test_passive_follows_a_kept_skill(tmp_path):
    p = tmp_path / "p.md"
    p.write_text((FIXTURES / "clean.md").read_text(encoding="utf-8")
                 .replace("| Perception | WIS | Yes | No | +4 |",
                          "| Perception | WIS | Yes | No | +9 (Observant) |"),
                 encoding="utf-8")
    _, out, _ = run(p)
    assert ["FILL", "Stat Sheet / Senses / Passive Perception", "14 -> 19"] in rows(out, "FILL")


def test_old_layout_fills_only_the_cells_it_has(tmp_path):
    p = copy(tmp_path, "old-layout.md")
    _, out, _ = run(p, "--write")
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills == {"Stat Sheet / Combat / Passive Perception": "13 -> 14"}
    text = p.read_text(encoding="utf-8")
    assert "| Save |" not in text and "### Senses" not in text


def test_unreadable_sheet_is_an_error_and_writes_nothing(tmp_path):
    p = tmp_path / "bad.md"
    src = (FIXTURES / "flawed.md").read_text(encoding="utf-8")
    p.write_text(src.replace("| Level | 5 |", "| Level | twenty-five |"), encoding="utf-8")
    before = p.read_bytes()
    code, out, _ = run(p, "--write")
    assert code == 0
    assert rows(out, "ERROR") == [["ERROR", "Stat Sheet / Core / Level", "twenty-five is not a level from 1 to 20; nothing was changed"]]
    assert p.read_bytes() == before


def test_missing_stat_sheet_is_an_error(tmp_path):
    p = tmp_path / "none.md"
    p.write_text("---\ntype: pc\n---\n\n## Notes\n\nNothing.\n", encoding="utf-8")
    _, out, _ = run(p)
    assert rows(out, "ERROR")[0][1] == "Stat Sheet"


def test_multiclass_casting_rows(tmp_path):
    p = tmp_path / "mc.md"
    src = (FIXTURES / "clean.md").read_text(encoding="utf-8")
    p.write_text(src + "| Spellcasting Ability (Wizard) | INT |\n| Spell Save DC (Wizard) | 12 |\n",
                 encoding="utf-8")
    _, out, _ = run(p)
    assert ["FILL", "Spellcasting / Spell Save DC (Wizard)", "12 -> 10"] in rows(out, "FILL")


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits")
def test_write_keeps_the_notes_mode(tmp_path):
    p = copy(tmp_path, "flawed.md")
    p.chmod(0o644)
    run(p, "--write")
    assert p.stat().st_mode & 0o777 == 0o644


def test_write_follows_a_symlinked_note(tmp_path):
    target = copy(tmp_path, "flawed.md")
    link = tmp_path / "link.md"
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unavailable")
    run(link, "--write")
    assert link.is_symlink()
    assert "| Proficiency Bonus | +3 |" in target.read_text(encoding="utf-8")
