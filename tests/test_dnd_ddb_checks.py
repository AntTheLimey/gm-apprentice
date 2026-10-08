#!/usr/bin/env python3
"""Tests for dnd_ddb.py: spell slot totals and the check rows."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_rules  # noqa: E402
from ddb_builder import character  # noqa: E402
from dnd_ddb import checks, plan_cells, plan_rows, plan_slots, write_edits, write_rows  # noqa: E402
from dnd_ddb_read import read  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")
WITH_PACT = TEMPLATE.replace("| 9th | | |\n", "| 9th | | |\n| Pact | | |\n", 1)
assert WITH_PACT != TEMPLATE

WIZARD = (("Wizard", 5, "Evoker", 4),)
WARLOCK = (("Warlock", 5, "", 6),)
CLASS_LOCUS = "Spellcasting / Spell Slots"


def got(**kw):
    return read(character(**kw))


def synced(c, text=TEMPLATE):
    """The note after the cells, rows and slots steps, as sync runs them."""
    text = write_edits(text, plan_cells(text, c))
    text = write_rows(text, plan_rows(text, c))
    return write_edits(text, plan_slots(text, c))


def report(c, text=TEMPLATE):
    return [(e.status, e.locus, e.message) for e in plan_slots(text, c)]


def slot_looks(text):
    return [f for f in dnd_rules.check(text) if f.locus.startswith(CLASS_LOCUS)]


def totals(text):
    """{row label: Total cell} of the Spell Slots table."""
    return {cells[0].strip(): cells[1].strip() for _i, _h, cells in dnd_rules.Note(text).table("spellcasting", "spell slots")}


# --- totals ---------------------------------------------------------------------------

def test_full_caster_totals_are_written_and_expended_is_untouched():
    c = got(classes=WIZARD)
    text = TEMPLATE.replace("| 1st | | |", "| 1st | | 2 |")
    assert [(e.status, e.locus) for e in plan_slots(text, c)] == [
        ("WRITE", f"{CLASS_LOCUS} / 1st"), ("WRITE", f"{CLASS_LOCUS} / 2nd"), ("WRITE", f"{CLASS_LOCUS} / 3rd")]
    out = synced(c, text)
    assert totals(out) == {"1st": "4", "2nd": "3", "3rd": "2", "4th": "", "5th": "", "6th": "", "7th": "", "8th": "",
                           "9th": ""}
    assert "| 1st | 4 | 2 |" in out
    assert slot_looks(out) == []


def test_a_second_run_changes_nothing():
    c = got(classes=WIZARD)
    out = synced(c)
    assert not [e for e in plan_slots(out, c) if e.status != "SAME"]
    assert write_edits(out, plan_slots(out, c)) == out


def test_half_caster_totals():
    c = got(classes=(("Paladin", 5, "", 6),))
    out = synced(c)
    assert totals(out)["1st"] == "4" and totals(out)["2nd"] == "2" and totals(out)["3rd"] == ""
    assert slot_looks(out) == []


def test_warlock_with_a_pact_row_gets_the_row_relabelled_and_set():
    c = got(classes=WARLOCK)
    assert report(c, WITH_PACT) == [("WRITE", f"{CLASS_LOCUS} / Pact / Level", "Pact -> Pact (3rd)"),
                                    ("WRITE", f"{CLASS_LOCUS} / Pact", "(blank) -> 2")]
    out = synced(c, WITH_PACT)
    assert totals(out)["Pact (3rd)"] == "2" and totals(out)["1st"] == ""
    assert slot_looks(out) == []
    assert checks(WITH_PACT, c, [], []) == []


def test_a_second_plan_on_a_warlock_note_with_a_pact_row_writes_nothing():
    c = got(classes=WARLOCK)
    out = synced(c, WITH_PACT)
    assert [e for e in plan_slots(out, c) if e.status == "WRITE"] == []
    assert synced(c, out) == out


def test_warlock_pact_row_is_corrected_when_the_level_changes():
    text = synced(got(classes=WARLOCK), WITH_PACT)
    c = got(classes=(("Warlock", 9, "", 6),))
    out = synced(c, text)
    assert totals(out)["Pact (5th)"] == "2"
    assert slot_looks(out) == []


def test_warlock_without_a_pact_row_counts_the_pact_slots_and_says_so():
    c = got(classes=WARLOCK)
    out = synced(c)
    assert totals(out)["3rd"] == "2"
    assert slot_looks(out) == []
    found = checks(TEMPLATE, c, [], [])
    assert [(e.status, e.locus) for e in found] == [("CHECK", CLASS_LOCUS)]
    assert "no Pact row" in found[0].message
    assert "Pact" not in TEMPLATE.split("### Spell Slots")[1].split("### Spells")[0]
    assert synced(c) == out


def test_full_and_half_caster_multiclass():
    c = got(classes=(("Wizard", 4, "", 4), ("Paladin", 4, "", 6)))
    out = synced(c)
    assert [totals(out)[k] for k in ("1st", "2nd", "3rd", "4th")] == ["4", "3", "3", ""]
    assert slot_looks(out) == []
    assert checks(out, c, [], []) == []


def test_warlock_and_sorcerer_multiclass():
    c = got(classes=(("Warlock", 5, "", 6), ("Sorcerer", 3, "", 6)))
    out = synced(c, WITH_PACT)
    assert [totals(out)[k] for k in ("1st", "2nd", "3rd", "Pact (3rd)")] == ["4", "2", "", "2"]
    assert slot_looks(out) == []


def test_non_caster_writes_and_reports_nothing():
    c = got(classes=(("Fighter", 5, "", None),))
    assert plan_slots(TEMPLATE, c) == []
    assert checks(TEMPLATE, c, [], []) == []
    out = synced(c)
    assert totals(out) == totals(TEMPLATE) and slot_looks(out) == []


def test_a_number_in_a_level_with_no_slots_is_corrected_a_blank_is_left():
    c = got(classes=(("Paladin", 5, "", 6),))
    text = TEMPLATE.replace("| 4th | | |", "| 4th | 1 | |")
    assert ("WRITE", f"{CLASS_LOCUS} / 4th", "1 -> 0") in report(c, text)
    assert not [r for r in report(c, text) if r[1].endswith("5th")]


def test_a_total_with_a_reason_is_kept_and_so_is_a_pact_total():
    c = got(classes=WARLOCK)
    text = WITH_PACT.replace("| Pact | | |", "| Pact (3rd) | 3 (ring) | |")
    assert ("KEPT", f"{CLASS_LOCUS} / Pact", "3 (ring); D&D Beyond gives 2") in report(c, text)
    text = TEMPLATE.replace("| 1st | | |", "| 1st | 5 (feat) | |")
    assert ("KEPT", f"{CLASS_LOCUS} / 1st", "5 (feat); D&D Beyond gives 4") in report(got(classes=WIZARD), text)


def test_one_class_outside_the_free_rules_with_its_own_table_gets_that_table():
    c = got(classes=(("Zzyx Blade", 5, "", 4),))
    assert slot_looks(synced(c)) == []          # dnd_rules does not read an unknown class
    out = synced(c)
    assert [totals(out)[k] for k in ("1st", "2nd", "3rd")] == ["4", "3", "2"]
    assert checks(TEMPLATE, c, [], []) == []


def test_a_character_with_no_classes_gets_no_slot_check():
    c = got()
    c.classes = []      # the reader refuses a character with none, but the planner is handed any Character
    assert plan_slots(TEMPLATE, c) == []
    assert checks(TEMPLATE, c, [], []) == []


def test_unknown_class_in_a_multiclass_writes_nothing_and_checks_once():
    c = got(classes=(("Wizard", 3, "", 4), ("Gloomwright", 2, "", 4)))
    assert plan_slots(TEMPLATE, c) == []
    found = checks(TEMPLATE, c, [], [])
    assert [(e.status, e.locus, e.message) for e in found] == [
        ("CHECK", CLASS_LOCUS, "the class is outside the free rules; check the slot totals")]


def test_unknown_class_with_no_table_in_its_data_checks_once():
    c = got(classes=(("Gloomwright", 5, "", None),))
    assert plan_slots(TEMPLATE, c) == []
    assert [e.status for e in checks(TEMPLATE, c, [], [])] == ["CHECK"]


def test_a_note_without_a_slots_table_gets_nothing_and_no_pact_check():
    text = "## Spellcasting\n\n| Attribute | Value |\n|---|---|\n| Spell Save DC | |\n"
    assert plan_slots(text, got(classes=WARLOCK)) == []
    assert checks(text, got(classes=WARLOCK), [], []) == []


def test_crlf_note_keeps_its_line_endings():
    text = WITH_PACT.replace("\n", "\r\n")
    out = synced(got(classes=WARLOCK), text)
    assert "\n" not in out.replace("\r\n", "")
    assert totals(out)["Pact (3rd)"] == "2"
