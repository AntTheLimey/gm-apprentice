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

sys.path.insert(0, str(ROOT / "tests"))
from dnd_builder import sheet  # noqa: E402


def summary(out, prefix="# same:"):
    return next(ln for ln in out.splitlines() if ln.startswith(prefix))


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
    assert summary(out) == "# same: 36  fill: 0  kept: 1"


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
    assert kept["Skills / Stealth / Modifier"] == "+5 (GM boon); the sum gives +0"
    assert kept["Stat Sheet / Senses / Passive Insight"] == "about fourteen; not read as a number; the sum gives 14"
    text = p.read_text(encoding="utf-8")
    assert "+5 (GM boon)" in text and "about fourteen" in text


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


# --- Bonuses, half proficiency and carrying (the 2026-10-04 amendment) -------

def clean():
    return (FIXTURES / "clean.md").read_text(encoding="utf-8").replace("\r\n", "\n")


def bonuses():
    return (FIXTURES / "bonuses.md").read_text(encoding="utf-8").replace("\r\n", "\n")


def note(tmp_path, text, name="n.md"):
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def with_bonuses(table_rows):
    """clean.md with a Bonuses table after Senses."""
    table = "### Bonuses\n\n| Applies To | Bonus | Source |\n|---|---|---|\n" + table_rows + "\n\n## Skills"
    return clean().replace("## Skills", table, 1)


def all_rows(out):
    return {ln.split("\t")[1]: ln.split("\t") for ln in out.splitlines() if "\t" in ln}


def test_bonuses_fixture_has_nothing_to_fill():
    code, out, _ = run(FIXTURES / "bonuses.md")
    assert code == 0
    assert rows(out, "FILL") == [] and rows(out, "ERROR") == []
    got = all_rows(out)
    # Ring +1, Stone +1 and the aura's Charisma modifier feed every save.
    assert got["Stat Sheet / Ability Scores / STR / Save"] == [
        "SAME", "Stat Sheet / Ability Scores / STR / Save",
        "+8 (incl. +1 Ring of Protection, +1 Stone of Good Luck, +4 Aura of Protection)"]
    assert got["Stat Sheet / Ability Scores / CHA / Save"][2].startswith("+14 (incl.")
    # Ability Checks feeds initiative, and so does the feat's proficiency bonus.
    assert got["Stat Sheet / Combat / Initiative"][2] == "+6 (incl. +1 Stone of Good Luck, +4 Alert)"
    # Half proficiency: +1 Dex, half of +4, and the stone.
    assert got["Skills / Acrobatics / Modifier"][2] == "+4 (incl. +1 Stone of Good Luck)"
    assert got["Skills / Performance / Modifier"][2] == "+13 (incl. +1 Stone of Good Luck)"
    # A passive is ten plus the finished skill; the bonus is not counted twice.
    assert got["Stat Sheet / Senses / Passive Perception"][2] == "13"
    # A modifier and the casting numbers take no bonus here.
    assert got["Stat Sheet / Ability Scores / STR / Modifier"][2] == "+2"
    assert got["Spellcasting / Spell Save DC"][2] == "16"


def test_unreadable_bonus_row_is_kept_and_adds_nothing():
    _, out, _ = run(FIXTURES / "bonuses.md")
    kept = rows(out, "KEPT")
    assert kept == [["KEPT", "Stat Sheet / Bonuses / row 5 (Bless)",
                     "Saves | 1d4; the bonus 1d4 was not understood; it adds nothing"]]
    assert summary(out).endswith("fill: 0  kept: 1")


def test_unknown_bonus_target_is_kept_and_no_part_of_the_row_applies(tmp_path):
    p = note(tmp_path, with_bonuses("| Saves, Luck | +2 | Charm |"))
    _, out, _ = run(p)
    assert rows(out, "ERROR") == []
    assert ["KEPT", "Stat Sheet / Bonuses / row 1 (Charm)",
            "Saves, Luck | +2; Luck is not something a bonus applies to; it adds nothing"] in rows(out, "KEPT")
    assert rows(out, "FILL") == []


def test_a_bonus_moves_the_cell_and_says_why(tmp_path):
    p = note(tmp_path, with_bonuses("| saves | +2 | Ring of Protection |"))
    _, out, _ = run(p)
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Stat Sheet / Ability Scores / WIS / Save"] == "+4 -> +6 (incl. +2 Ring of Protection)"
    assert len(fills) == 6
    run(p, "--write")
    _, again, _ = run(p)
    assert rows(again, "FILL") == []
    assert "| WIS | 12 | +1 | Yes | +6 |" in p.read_text(encoding="utf-8")


@pytest.mark.parametrize("applies, bonus, locus, message", [
    ("Wisdom Save", "+1", "Stat Sheet / Ability Scores / WIS / Save", "+4 -> +5 (incl. +1 X)"),
    ("WIS save", "1", "Stat Sheet / Ability Scores / WIS / Save", "+4 -> +5 (incl. +1 X)"),
    ("Stealth", "-2", "Skills / Stealth / Modifier", "+0 -> -2 (incl. -2 X)"),
    ("Skills", "+1", "Skills / Arcana / Modifier", "-1 -> +0 (incl. +1 X)"),
    ("Ability Checks", "+1", "Skills / Arcana / Modifier", "-1 -> +0 (incl. +1 X)"),
    ("Passive Perception", "+5", "Stat Sheet / Senses / Passive Perception", "14 -> 19 (incl. +5 X)"),
    ("Passive Investigation, Passive Insight", "+5", "Stat Sheet / Senses / Passive Insight", "14 -> 19 (incl. +5 X)"),
    ("Spell Attack", "+1", "Spellcasting / Spell Attack Modifier", "+6 -> +7 (incl. +1 X)"),
    ("Spell Save DC", "+1", "Spellcasting / Spell Save DC", "14 -> 15 (incl. +1 X)"),
    ("Saves", "wis", "Stat Sheet / Ability Scores / STR / Save", "+4 -> +5 (incl. +1 X)"),
    ("Saves", "Half PB", "Stat Sheet / Ability Scores / STR / Save", "+4 -> +5 (incl. +1 X)"),
    ("Saves", "pb", "Stat Sheet / Ability Scores / STR / Save", "+4 -> +7 (incl. +3 X)"),
    ("Saves", "INT", "Stat Sheet / Ability Scores / STR / Save", "+4 -> +3 (incl. -1 X)"),
])
def test_bonus_vocabulary(tmp_path, applies, bonus, locus, message):
    p = note(tmp_path, with_bonuses(f"| {applies} | {bonus} | X |"))
    _, out, _ = run(p)
    assert rows(out, "ERROR") == []
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills[locus] == message


def test_skills_bonus_leaves_initiative_alone_and_ability_checks_does_not(tmp_path):
    _, out, _ = run(note(tmp_path, with_bonuses("| Skills | +1 | X |")))
    assert all_rows(out)["Stat Sheet / Combat / Initiative"][2] == "+3 (Alert); the sum gives +0"
    text = with_bonuses("| Ability Checks | +1 | X |").replace("| Initiative | +3 (Alert) |", "| Initiative | +0 |")
    _, out, _ = run(note(tmp_path, text, "b.md"))
    assert all_rows(out)["Stat Sheet / Combat / Initiative"][2] == "+0 -> +1 (incl. +1 X)"


def test_a_skill_bonus_carries_into_its_passive(tmp_path):
    _, out, _ = run(note(tmp_path, with_bonuses("| Perception | +2 | X |")))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Skills / Perception / Modifier"] == "+4 -> +6 (incl. +2 X)"
    assert fills["Stat Sheet / Senses / Passive Perception"] == "14 -> 16"


def test_a_reasoned_cell_is_kept_bonuses_or_not(tmp_path):
    text = with_bonuses("| Saves | +2 | Ring |").replace("| WIS | 12 | +1 | Yes | +4 |", "| WIS | 12 | +1 | Yes | +9 (blessed) |")
    p = note(tmp_path, text)
    _, out, _ = run(p, "--write")
    assert ["KEPT", "Stat Sheet / Ability Scores / WIS / Save",
            "+9 (blessed); the sum gives +6 (incl. +2 Ring)"] in rows(out, "KEPT")
    assert "+9 (blessed)" in p.read_text(encoding="utf-8")


def test_an_empty_bonuses_row_is_silent(tmp_path):
    _, out, _ = run(note(tmp_path, with_bonuses("| | | |")))
    assert rows(out, "FILL") == []
    assert summary(out) == "# same: 36  fill: 0  kept: 1"


def test_a_bonus_with_no_source_is_named_by_its_row(tmp_path):
    _, out, _ = run(note(tmp_path, with_bonuses("| Saves | +1 | |")))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Stat Sheet / Ability Scores / STR / Save"] == "+4 -> +5 (incl. +1 Bonuses row 1)"


def test_half_proficiency(tmp_path):
    text = clean().replace("| Arcana | INT | No | No | -1 |", "| Arcana | INT | Half | No | -1 |")
    _, out, _ = run(note(tmp_path, text))
    assert ["FILL", "Skills / Arcana / Modifier", "-1 -> +0"] in rows(out, "FILL")


def test_half_with_expertise_is_not_understood(tmp_path):
    text = clean().replace("| Perception | WIS | Yes | No | +4 |", "| Perception | WIS | Half | Yes | +4 |")
    p = note(tmp_path, text)
    before = p.read_bytes()
    _, out, _ = run(p, "--write")
    kept = {r[1]: r[2] for r in rows(out, "KEPT")}
    assert kept["Skills / Perception / Modifier"] == \
        "+4; Proficient Half with Expertise Yes was not understood; nothing was changed"
    # The passive follows the number the note holds.
    assert rows(out, "FILL") == [] and rows(out, "ERROR") == []
    assert p.read_bytes() == before


EQUIPMENT = """
## Equipment

### Gear

| Item | Qty | Weight | Notes |
|------|-----|--------|-------|
| Chain Mail | 1 | 55 lb | worn |
| Shield | | 6 | |
| Javelin | 4 | 2 lb | |
| [[Rope]] | 1 | | hempen |
| Tent | 1 | heavy | |
| Dart | 3 | 1/4 lb | |
| Holy Symbol | 1 | — | weighs nothing |

### Carrying

| Attribute | Value |
|-----------|-------|
| Carried Weight | |
| Carrying Capacity | |
| Drag / Lift / Push | |
| Encumbrance | |

### Coins

| CP | SP | EP | GP | PP |
|----|----|----|----|----|
| 10 | 20 | 0 | 1,045 | 0 |
"""


def test_carrying_is_filled_from_gear_coins_size_and_strength(tmp_path):
    p = note(tmp_path, clean() + EQUIPMENT)
    _, out, _ = run(p)
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    # 55 + 6 + 8 + 0.75 = 69.75, and 1075 coins are 21.5 lb.
    assert fills["Equipment / Carrying / Carried Weight"] == \
        "(blank) -> 91.3 lb (incl. 21.5 lb of coins; no weight: Rope, Tent)"
    assert fills["Equipment / Carrying / Carrying Capacity"] == "(blank) -> 270 lb"
    assert fills["Equipment / Carrying / Drag / Lift / Push"] == "(blank) -> 540 lb"
    assert fills["Equipment / Carrying / Encumbrance"] == "(blank) -> Within capacity"
    run(p, "--write")
    text = p.read_text(encoding="utf-8")
    for line in ("| Carried Weight | 91.3 lb |", "| Carrying Capacity | 270 lb |",
                 "| Drag / Lift / Push | 540 lb |", "| Encumbrance | Within capacity |"):
        assert line in text
    once = p.read_bytes()
    _, again, _ = run(p, "--write")
    assert rows(again, "FILL") == [] and p.read_bytes() == once
    assert ["SAME", "Equipment / Carrying / Encumbrance", "Within capacity"] in rows(again, "SAME")


def test_over_capacity_and_size(tmp_path):
    text = (clean() + EQUIPMENT).replace("| Size | Medium |", "| Size | Tiny |") \
        .replace("| Encumbrance | |", "| Encumbrance | Within capacity |")
    _, out, _ = run(note(tmp_path, text))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Equipment / Carrying / Carrying Capacity"] == "(blank) -> 135 lb"
    assert fills["Equipment / Carrying / Drag / Lift / Push"] == "(blank) -> 270 lb"
    text = text.replace("| Chain Mail | 1 | 55 lb |", "| Chain Mail | 2 | 55 lb |")
    _, out, _ = run(note(tmp_path, text, "o.md"))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Equipment / Carrying / Encumbrance"] == "Within capacity -> Over capacity (Speed 5 ft)"


def test_bare_and_reasoned_carrying_cells(tmp_path):
    text = (clean() + EQUIPMENT) \
        .replace("| Carried Weight | |", "| Carried Weight | 91.3 |") \
        .replace("| Carrying Capacity | |", "| Carrying Capacity | 540 lb (Powerful Build) |") \
        .replace("| Drag / Lift / Push | |", "| Drag / Lift / Push | 500 lb |") \
        .replace("| Encumbrance | |", "| Encumbrance | Fine (the mule has it) |")
    p = note(tmp_path, text)
    _, out, _ = run(p, "--write")
    got = all_rows(out)
    assert got["Equipment / Carrying / Carried Weight"][0] == "SAME"
    assert got["Equipment / Carrying / Carrying Capacity"] == [
        "KEPT", "Equipment / Carrying / Carrying Capacity", "540 lb (Powerful Build); the sum gives 270 lb"]
    assert got["Equipment / Carrying / Drag / Lift / Push"][:1] == ["FILL"]
    assert got["Equipment / Carrying / Encumbrance"] == [
        "KEPT", "Equipment / Carrying / Encumbrance", "Fine (the mule has it); the sum gives Within capacity"]
    out_text = p.read_text(encoding="utf-8")
    assert "| Carried Weight | 91.3 |" in out_text and "540 lb (Powerful Build)" in out_text


def test_a_kept_capacity_is_what_encumbrance_is_measured_against(tmp_path):
    text = (clean() + EQUIPMENT).replace("| Carrying Capacity | |", "| Carrying Capacity | 60 lb (cursed) |")
    _, out, _ = run(note(tmp_path, text))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Equipment / Carrying / Encumbrance"] == "(blank) -> Over capacity (Speed 5 ft)"


def test_no_carrying_table_gets_none(tmp_path):
    text = (clean() + EQUIPMENT).split("### Carrying")[0] + "### Coins" + (clean() + EQUIPMENT).split("### Coins")[1]
    p = note(tmp_path, text)
    _, out, _ = run(p, "--write")
    assert not any("Carrying" in r for r in all_rows(out))
    assert "### Carrying" not in p.read_text(encoding="utf-8")


def test_three_column_gear_counts_nothing_and_says_so(tmp_path):
    text = clean() + EQUIPMENT.replace("| Item | Qty | Weight | Notes |\n|------|-----|--------|-------|", "| Item | Qty | Notes |\n|---|---|---|") \
        .replace("| Chain Mail | 1 | 55 lb | worn |", "| Chain Mail | 1 | worn |")
    _, out, _ = run(note(tmp_path, text))
    fills = {r[1]: r[2] for r in rows(out, "FILL")}
    assert fills["Equipment / Carrying / Carried Weight"] == \
        "(blank) -> 21.5 lb (incl. 21.5 lb of coins; Gear has no Weight column)"


def test_a_wikilinked_skill_name_is_matched_by_bonuses_and_passives(tmp_path):
    text = clean().replace("| Perception | WIS", "| [[Perception]] | WIS", 1)
    text = text.replace("## Skills", "### Bonuses\n\n| Applies To | Bonus | Source |\n|---|---|---|\n"
                        "| Perception | +2 | Eyes |\n\n## Skills", 1)
    p = note(tmp_path, text)
    _, out, _ = run(p)
    got = all_rows(out)
    assert got["Skills / Perception / Modifier"][2] == "+4 -> +6 (incl. +2 Eyes)"
    assert got["Stat Sheet / Senses / Passive Perception"][2] == "14 -> 16"


def test_a_bold_or_linked_label_is_still_read(tmp_path):
    text = clean().replace("| Spell Save DC | 14 |", "| **Spell Save DC** | 10 |", 1)
    text = text.replace("| WIS |", "| [[Wisdom]] |", 1) if "| WIS |" in text else text
    p = note(tmp_path, text)
    _, out, _ = run(p)
    assert "Spellcasting / Spell Save DC" in all_rows(out)
    assert rows(out, "ERROR") == []


def test_a_passive_with_no_matching_skill_is_kept_not_skipped(tmp_path):
    text = "\n".join(ln for ln in clean().splitlines() if not ln.startswith("| Perception |"))
    _, out, _ = run(note(tmp_path, text + "\n"))
    kept = {r[1]: r[2] for r in rows(out, "KEPT")}
    assert kept["Stat Sheet / Senses / Passive Perception"] == (
        "14; no Perception skill row to take it from; nothing was changed")


def test_a_second_table_under_one_heading_is_named(tmp_path):
    text = clean().replace("| Survival | WIS | No | No | +1 |",
                           "| Survival | WIS | No | No | +1 |\n\n| Skill | Ability | Proficient | Expertise | Modifier |\n"
                           "|---|---|---|---|---|\n| Stealth | DEX | No | No | +9 |", 1)
    _, out, _ = run(note(tmp_path, text))
    assert ["KEPT", "Skills", "second table under Skills not read"] in rows(out, "KEPT")
    assert rows(out, "FILL") == []


def test_one_table_has_no_second_table_row(tmp_path):
    _, out, _ = run(FIXTURES / "clean.md")
    assert not [r for r in rows(out, "KEPT") if "second table" in r[2]]


# --- Fenced blocks are skipped by the shared fence rule ----------------------

FAKE_ABILITIES = ("| Ability | Score | Modifier | Save Proficiency | Save |\n"
                  "|---|---|---|---|---|\n"
                  "| STR | 8 | +9 | No | +9 |\n")


def fenced_note(outer, inner):
    block = f"{outer}\n{inner}\n{FAKE_ABILITIES}{outer}\n\n"
    text = clean().replace("### Ability Scores\n\n", "### Ability Scores\n\n" + block, 1)
    return text, block


@pytest.mark.parametrize("outer,inner", [("````", "```"), ("~~~", "```"), ("````", "~~~")])
def test_a_fenced_block_with_a_shorter_or_other_fence_inside_is_not_read(tmp_path, outer, inner):
    text, block = fenced_note(outer, inner)
    p = note(tmp_path, text)
    code, out, _ = run(p)
    assert code == 0
    assert rows(out, "FILL") == []
    assert rows(out, "ERROR") == []
    assert "+9" not in out
    before = p.read_bytes()
    run(p, "--write")
    assert p.read_bytes() == before
    assert block in p.read_text(encoding="utf-8")


def test_checks_follow_the_fill_summary(tmp_path):
    p = tmp_path / "pc.md"
    p.write_text(sheet(hit_dice=(("d6", "0/4"),)), encoding="utf-8")
    code, out, _ = run(p)
    assert code == 0
    lines = out.rstrip().splitlines()
    assert lines[-2] == "WRONG\tStat Sheet / Combat / Hit Dice d6\tthe note has 4; Wizard 5 gives 5"
    assert lines[-1] == "# wrong: 1  look: 0  cantcheck: 0"
    assert lines.index(summary(out)) == len(lines) - 3


def test_a_correct_sheet_ends_with_a_zero_summary(tmp_path):
    p = tmp_path / "pc.md"
    p.write_text(sheet(), encoding="utf-8")
    _, out, _ = run(p)
    assert out.rstrip().splitlines()[-1] == "# wrong: 0  look: 0  cantcheck: 0"


def test_an_unreadable_sheet_prints_no_checks(tmp_path):
    p = tmp_path / "pc.md"
    p.write_text(sheet(level="five"), encoding="utf-8")
    _, out, _ = run(p)
    assert rows(out, "ERROR") != []
    assert "# wrong:" not in out


def test_write_does_not_touch_what_a_check_found(tmp_path):
    p = tmp_path / "pc.md"
    p.write_text(sheet(hit_dice=(("d6", "0/4"),)), encoding="utf-8")
    run(p, "--write")
    after = p.read_text(encoding="utf-8")
    assert "| Hit Dice d6 (Spent/Max) | 0/4 |" in after
    _, out, _ = run(p)
    assert out.rstrip().splitlines()[-1] == "# wrong: 1  look: 0  cantcheck: 0"


def test_a_reasoned_score_is_read_as_its_number(tmp_path):
    p = tmp_path / "pc.md"
    p.write_text(sheet(scores={"INT": "22 (tome of clear thought)"}), encoding="utf-8")
    code, out, _ = run(p, "--write")
    assert code == 0
    assert rows(out, "ERROR") == []
    after = p.read_text(encoding="utf-8")
    assert "| INT | 22 (tome of clear thought) | +6 |" in after


def party(*args):
    p = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
    return p.returncode, p.stdout.replace("\r\n", "\n"), p.stderr


def make_vault(tmp_path, system="dnd-5e-2024"):
    vault = tmp_path / "vault"
    (vault / "Characters" / "PCs").mkdir(parents=True)
    (vault / "Campaign Overview.md").write_text(
        f"---\ntype: campaign_overview\ngame_system: {system}\n---\n\n# Campaign\n", encoding="utf-8")
    return vault


def test_party_prints_only_findings_with_the_note_name(tmp_path):
    vault = make_vault(tmp_path)
    pcs = vault / "Characters" / "PCs"
    (pcs / "Ada.md").write_text(sheet(), encoding="utf-8")
    (pcs / "Bryn.md").write_text(sheet(hit_dice=(("d6", "0/4"),)), encoding="utf-8")
    (pcs / "Player Characters.md").write_text("---\ntype: pc_roster\n---\n\n# Party\n", encoding="utf-8")
    (pcs / "Cass.md").write_text("---\ntype: pc\nsheet_source: paper\n---\n\n## Notes\n", encoding="utf-8")
    code, out, _ = party("--party", str(vault))
    assert code == 0
    assert out.splitlines() == [
        "WRONG\tBryn: Stat Sheet / Combat / Hit Dice d6\tthe note has 4; Wizard 5 gives 5",
        "# wrong: 1  look: 0  cantcheck: 0  sheets: 2",
    ]


def test_party_never_writes(tmp_path):
    vault = make_vault(tmp_path)
    note = vault / "Characters" / "PCs" / "Ada.md"
    note.write_text(sheet(), encoding="utf-8")
    before = note.read_bytes()
    party("--party", str(vault))
    assert note.read_bytes() == before
    code, _, err = party("--party", str(vault), "--write")
    assert code == 2
    assert "--party" in err
    assert note.read_bytes() == before


def test_party_reports_a_sheet_it_cannot_read(tmp_path):
    vault = make_vault(tmp_path)
    (vault / "Characters" / "PCs" / "Dax.md").write_text(sheet(level="five"), encoding="utf-8")
    code, out, _ = party("--party", str(vault))
    assert code == 0
    lines = out.splitlines()
    assert lines[0].startswith("CANTCHECK\tDax: Stat Sheet / Core / Level\tthe sheet cannot be read: ")
    assert lines[-1] == "# wrong: 0  look: 0  cantcheck: 1  sheets: 1"


def test_party_on_another_system_says_so(tmp_path):
    vault = make_vault(tmp_path, system="gurps-4e")
    (vault / "Characters" / "PCs" / "Ada.md").write_text(sheet(), encoding="utf-8")
    code, out, _ = party("--party", str(vault))
    assert code == 0
    assert out.strip() == ("dnd_sheet: this vault's system is gurps-4e, not dnd-5e-2024; "
                           "nothing was checked")


def test_party_needs_a_real_folder(tmp_path):
    code, _, err = party("--party", str(tmp_path / "missing"))
    assert code == 2
    assert "not a folder" in err


def test_a_sheet_or_a_party_but_not_neither_or_both(tmp_path):
    assert party()[0] == 2
    vault = make_vault(tmp_path)
    assert party(str(vault / "x.md"), "--party", str(vault))[0] == 2
