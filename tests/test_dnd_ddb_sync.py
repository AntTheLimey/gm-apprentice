#!/usr/bin/env python3
"""Tests for dnd_ddb.sync_text: one note brought up to date from D&D Beyond's data. No network."""

import re
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_builder  # noqa: E402
import dnd_rules  # noqa: E402
import dnd_sheet  # noqa: E402
from ddb_builder import character  # noqa: E402
from dnd_ddb import sync_text  # noqa: E402
from dnd_ddb_read import read  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
SAVES = (("class", "proficiency", "intelligence-saving-throws", None),
         ("class", "proficiency", "wisdom-saving-throws", None))
GEAR = (("Rope, Hempen", 1, 10, False, False, "gear"), ("Torch", 3, 1, False, False, "gear"))
WIZARD = dict(hit_points={"base": 25}, modifiers=SAVES, class_features=(("Arcane Recovery", 1, 2),), inventory=GEAR,
              spells=(("Fire Bolt", 0, True, False, False, False, (1, 2), "Wizard"),))
NOT_WRITTEN = ("WRITE", "ADD", "REMOVE", "FILL")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """A test that opens a socket fails."""
    def refuse(self, *args, **kwargs):
        raise AssertionError("a test opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)


def wizard(**more):
    return character(**{**WIZARD, **more})


def swap(text, old, new):
    assert old in text
    return text.replace(old, new, 1)


def statuses(report):
    return [r[0] for r in report.rows]


def test_a_socket_cannot_be_opened_in_this_file():
    with pytest.raises(AssertionError, match="opened a socket"):
        socket.socket().connect(("127.0.0.1", 9))


def test_a_template_note_is_brought_whole_and_a_second_sync_has_nothing_to_say():
    first = sync_text(TEMPLATE, wizard())
    assert not [r for r in first.rows if r[0] == "ERROR"]
    assert {"WRITE", "ADD", "FILL"} <= set(statuses(first))
    assert [r for r in dnd_sheet.plan(first.text) if r.status == "FILL"] == []
    assert dnd_rules.check(first.text) == []
    second = sync_text(first.text, wizard())
    assert second.rows == [] and second.text == first.text


def test_the_rows_are_in_print_order_and_never_include_same():
    rows = sync_text(TEMPLATE, wizard()).rows
    order = [r[0] for r in rows]
    assert "SAME" not in order
    assert order.index("WRITE") < order.index("ADD") < order.index("FILL")
    assert rows[0] == ("WRITE", "Stat Sheet / Core / Level", "1 -> 5")
    assert any(r[0] == "WRITE" and r[1] == "Stat Sheet / Combat / HP (Max)" for r in rows)
    assert not [r for r in rows if r[1] == "" or "silent" in r[2]]


def test_an_unreadable_character_leaves_the_text_alone():
    report = sync_text(TEMPLATE, {"name": "nobody"})
    assert statuses(report) == ["ERROR"] and report.rows[0][1] == "D&D Beyond"
    assert report.text == TEMPLATE
    assert sync_text(TEMPLATE, [] ).text == TEMPLATE


def test_a_note_in_the_earlier_layout_is_refused():
    old = dnd_builder.sheet(save_column=False)
    report = sync_text(old, wizard())
    assert report.rows == [("ERROR", "Stat Sheet", "this note is in the earlier layout; convert it first "
                            "(sheet-conversion.md)")]
    assert report.text == old
    nothing = sync_text("---\ntype: pc\n---\n\n# Just a note\n", wizard())
    assert statuses(nothing) == ["ERROR"] and nothing.rows[0][1] == "Stat Sheet"


def test_a_fill_that_cannot_be_done_is_the_one_error_and_nothing_changes():
    # A score that is not a number the sheet can read stops dnd_sheet.plan after sync has run.
    broken = swap(TEMPLATE, "| CHA | 10 | +0 | No | +0 |", "| CHA | ten (GM) | +0 | No | +0 |")
    report = sync_text(broken, wizard())
    assert statuses(report) == ["ERROR"] and "Ability Scores / CHA" in report.rows[0][1]
    assert report.text == broken


def test_hit_points_armour_class_and_the_armour_line_are_written_into_a_blank_template():
    c = read(wizard())
    out = sync_text(TEMPLATE, wizard())
    note = dnd_rules.Note(out.text)
    assert note.attr("stat sheet", "combat", "hp (max)").text.strip() == str(c.hp_max.value)
    assert note.attr("stat sheet", "combat", "ac").text.strip() == str(c.ac.value)
    assert f"**Armour Class:** {c.ac.parts}" in out.text
    assert "| Unarmed Strike |" in out.text


def test_a_reasoned_armour_class_stays_and_gets_a_check_row():
    text = swap(TEMPLATE, "| AC | 10 |", "| AC | 15 (homebrew plate) |")
    c = read(wizard())
    out = sync_text(text, wizard())
    assert "| AC | 15 (homebrew plate) |" in out.text
    locus = "Stat Sheet / Combat / AC"
    assert ("KEPT", locus, f"15 (homebrew plate); D&D Beyond gives {c.ac.value}") in out.rows
    assert ("CHECK", locus, f"the sheet says 15 (homebrew plate); D&D Beyond's numbers give {c.ac.value}") in out.rows


def test_a_unsure_calculator_gives_check_rows_and_no_writes_for_those_cells():
    out = sync_text(TEMPLATE, character(modifiers=SAVES))     # the data has no rolled hit point total
    assert any(r[0] == "CHECK" and r[1].endswith("HP (Max)") for r in out.rows)
    assert "| HP (Max) | |" in out.text


def edit(text, rope="Rope, Hempen"):
    """The hand-edit sequence from the review focus."""
    text = swap(text, f"| {rope} |", f"| {rope} (gift of the abbot) |")
    text = swap(text, "| Torch | 3 | 1 lb | |\n", "")
    return swap(text, "| INT | 16 |", "| INT | 18 (tome) |")


def test_hand_edits_are_kept_a_deleted_row_returns_and_the_next_sync_is_silent():
    c = wizard()
    first = sync_text(TEMPLATE, c).text
    hand = edit(first)
    second = sync_text(hand, c)
    assert ("ADD", "Equipment / Gear / Torch", "not in the note; added") in second.rows
    assert "| Rope, Hempen (gift of the abbot) | 1 | 10 lb | |" in second.text
    assert "| INT | 18 (tome) |" in second.text
    assert not [r for r in second.rows if r[0] in ("REMOVE", "WRITE") and "Rope" in r[1] + r[2]]
    assert any(r[0] == "KEPT" and "INT / Score" in r[1] for r in second.rows)
    third = sync_text(second.text, c)
    assert [r for r in third.rows if r[0] in NOT_WRITTEN] == []
    assert third.text == second.text


def test_a_level_up_writes_level_slots_proficiency_and_the_hit_point_check():
    five = sync_text(TEMPLATE, wizard()).text
    six = wizard(classes=(("Wizard", 6, "Evoker", 4),), xp=14000, hit_points={"base": 31})
    report = sync_text(five, six)
    rows = report.rows
    assert ("WRITE", "Stat Sheet / Core / Level", "5 -> 6") in rows
    assert ("WRITE", "Spellcasting / Spell Slots / 3rd", "2 -> 3") in rows
    assert ("FILL", "Stat Sheet / Core / Proficiency Bonus", "+3 -> +3") not in rows
    assert any(r[0] == "WRITE" and r[1].endswith("HP (Max)") for r in rows)
    assert dnd_rules.check(report.text) == []


def test_a_climb_that_moves_the_proficiency_bonus_refills_what_it_feeds():
    four = wizard(classes=(("Wizard", 4, "Evoker", 4),), xp=2700, hit_points={"base": 20})
    report = sync_text(sync_text(TEMPLATE, four).text, wizard())
    assert ("FILL", "Stat Sheet / Core / Proficiency Bonus", "+2 -> +3") in report.rows
    assert ("FILL", "Stat Sheet / Ability Scores / INT / Save", "+5 -> +6") in report.rows
    assert dnd_rules.check(report.text) == []
    five = sync_text(TEMPLATE, wizard()).text
    nine = wizard(classes=(("Wizard", 9, "Evoker", 4),), xp=48000, hit_points={"base": 55})
    report = sync_text(five, nine)
    assert ("FILL", "Stat Sheet / Core / Proficiency Bonus", "+3 -> +4") in report.rows


def test_crlf_in_crlf_out_on_every_line():
    crlf = TEMPLATE.replace("\n", "\r\n")
    report = sync_text(crlf, wizard())
    assert report.rows
    assert "\n" not in report.text.replace("\r\n", "")
    assert report.text.count("\r\n") == report.text.count("\n")
    assert sync_text(report.text, wizard()).rows == []


def lines_starting(text, *starts):
    return [ln for ln in text.splitlines() if ln.startswith(starts)]


def section(text, heading):
    """The lines of a `## ` or `### ` section, heading included, to the next heading of the same or higher level."""
    lines = text.splitlines()
    level = len(heading) - len(heading.lstrip("#"))
    start = lines.index(heading)
    end = next((i for i in range(start + 1, len(lines)) if re.match(rf"#{{1,{level}}} ", lines[i])), len(lines))
    return lines[start:end]


def column(text, column_title):
    """{first cell: cell} for the column of every table row whose table has it."""
    out, header = {}, None
    for ln in text.splitlines():
        if not ln.startswith("|"):
            header = None
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        if header is None:
            header = cells
        elif column_title in header and cells[0] and not set(cells[0]) <= set("-"):
            out[cells[0]] = cells[header.index(column_title)]
    return out


def played(text):
    """The template as a table in play has it: vault-owned cells with values in them, and hand-written text."""
    bonuses = "|------------|-------|--------|\n| | | |"
    companions = "|-----------|------|----|----|-------|-------|\n| | | | | | |"
    gear = "|------|-----|--------|-------|\n| | | | |"
    features = "|------|--------|------|------|----------|---------|\n| | | | | | |"
    for old, new in (("| HP (Current) | |", "| HP (Current) | 12 |"), ("| Temp HP | 0 |", "| Temp HP | 4 |"),
                     ("| Death Saves (S/F) | 0/0 |", "| Death Saves (S/F) | 1/2 |"),
                     ("| Exhaustion | 0 |", "| Exhaustion | 2 |"), ("| Conditions | — |", "| Conditions | Poisoned |"),
                     ("| Heroic Inspiration | No |", "| Heroic Inspiration | Yes |"),
                     (bonuses, "|------------|-------|--------|\n| Saves | +1 | Ring of Protection |"),
                     ("| 1st | | |", "| 1st | | 2 |"), ("| 2nd | | |", "| 2nd | | 1 |"),
                     (companions, "|-----------|------|----|----|-------|-------|\n| Owl | Familiar | 11 | 1 | 5 ft | scouts ahead |"),
                     ("**Location:** {where the PC is now}", "**Location:** the cellar"),
                     ("{Player-facing notes. Protected — skills never modify.}", "Remember the cellar door."),
                     ("{Keeper-only notes. Protected — skills never modify.}", "The abbot is a doppelganger."),
                     (features, "|------|--------|------|------|----------|---------|\n"
                                "| Arcane Recovery | | 1 | 1 | Long Rest | my own summary |")):
        text = swap(text, old, new)
    return swap(text, "### Gear\n\n| Item | Qty | Weight | Notes |\n" + gear,
                "### Gear\n\n| Item | Qty | Weight | Notes |\n|------|-----|--------|-------|\n| Torch | 3 | 1 lb | for the cellar |")


def test_what_the_table_tracks_in_play_is_never_touched():
    before = played(TEMPLATE)
    after = sync_text(before, wizard()).text
    for start in ("| HP (Current)", "| Temp HP", "| Death Saves", "| Exhaustion", "| Conditions", "| Heroic Inspiration"):
        assert lines_starting(after, start) == lines_starting(before, start), start
    assert column(after, "Used")["Arcane Recovery"] == "1"
    assert column(after, "Expended") == column(before, "Expended")
    for heading in ("### Bonuses", "## Companions", "## Current Status", "## Notes", "## GM Notes"):
        assert section(after, heading) == section(before, heading), heading
    assert column(after, "Summary")["Arcane Recovery"] == "my own summary"
    assert column(after, "Notes")["Torch"] == "for the cellar"
    assert column(after, "Notes")["Owl"] == "scouts ahead"


def test_the_spell_slot_expended_cells_keep_their_values_when_the_totals_change():
    before = played(TEMPLATE)
    after = sync_text(before, wizard()).text
    assert [ln for ln in after.splitlines() if ln.startswith(("| 1st", "| 2nd"))] == ["| 1st | 4 | 2 |", "| 2nd | 3 | 1 |"]
