#!/usr/bin/env python3
"""Tests for dnd_ddb.py: a D&D note's lists made to match D&D Beyond."""

import dataclasses
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from ddb_builder import character  # noqa: E402
from dnd_ddb import RowEdit, plan_cells, plan_rows, set_cell, write_edits, write_rows  # noqa: E402
from dnd_ddb_read import read  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")

FEATURES = "| Name | Action | Uses | Used | Recovers | Summary |\n|---|---|---|---|---|---|\n"
SPELLS = ("| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Source | Summary |\n"
          "|---|---|---|---|---|---|---|---|---|---|\n")
GEAR = "| Item | Qty | Weight | Notes |\n|---|---|---|---|\n"
MAGIC = "| Item | Attuned | Charges | Used | Recovers | Notes |\n|---|---|---|---|---|---|\n"


def got(**kw):
    return read(character(**kw))


def note(features="", spells=None, gear=None, magic=None, coins=None, eol="\n"):
    """A small note with the tables given (each the table's rows), the others absent."""
    out = "---\ntype: pc\n---\n\n## Class Features\n\n" + FEATURES + features + "\n"
    if spells is not None:
        out += "## Spellcasting\n\n### Spells\n\n" + SPELLS + spells + "\n"
    if gear is not None or magic is not None or coins is not None:
        out += "## Equipment\n\n"
    if gear is not None:
        out += "### Gear\n\n" + GEAR + gear + "\n"
    if magic is not None:
        out += "### Magic Items\n\n" + MAGIC + magic + "\n"
    if coins is not None:
        out += "### Coins\n\n| CP | SP | EP | GP | PP |\n|---|---|---|---|---|\n" + coins + "\n"
    return out.replace("\n", eol)


def report(text, c=None, coins=False, seen=None):
    """The report rows; the default character's coins are left out unless a test is about them."""
    return [(e.status, e.locus, e.message) for e in plan_rows(text, c or got(), seen=seen)
            if not e.silent and (coins or not e.locus.startswith("Equipment / Coins"))]


def after(text, c=None, seen=None):
    return write_rows(text, plan_rows(text, c or got(), seen=seen))


GONE = "D&D Beyond no longer has it"
FEATS = dict(class_features=(("Second Wind", 3, 1), ("Arcane Recovery", 1, 2)))
NOTHING = dict(class_features=())


# --- features ---------------------------------------------------------------------------

def test_feature_row_matched_writes_only_uses_and_recovers():
    text = note("| Second Wind | Bonus | 2 | 1 | Dawn | keep me \\| please |\n"
                "| Arcane Recovery | | 1 | | Long Rest | |\n")
    assert report(text, got(**FEATS)) == [
        ("WRITE", "Class Features / Second Wind / Uses", "2 -> 3"),
        ("WRITE", "Class Features / Second Wind / Recovers", "Dawn -> Short Rest"),
        ("SAME", "Class Features / Arcane Recovery", "matches")]
    assert "| Second Wind | Bonus | 3 | 1 | Short Rest | keep me \\| please |\n" in after(text, got(**FEATS))


def test_feature_uses_and_recovers_with_a_reason_are_kept():
    text = note("| Second Wind | | 4 (feat) | | Dawn (homebrew) | |\n"
                "| Arcane Recovery | | 1 | | Long Rest | |\n")
    got_ = report(text, got(**FEATS))
    assert got_[:2] == [("KEPT", "Class Features / Second Wind / Uses", "4 (feat); D&D Beyond gives 3"),
                        ("KEPT", "Class Features / Second Wind / Recovers", "Dawn (homebrew); D&D Beyond gives Short Rest")]
    assert after(text, got(**FEATS)) == text


def test_feature_with_no_uses_on_d_and_d_beyond_leaves_the_cells_alone():
    text = note("| Darkvision | | 2 | | Dawn | |\n")
    c = got(class_features=(), racial_traits=(("Darkvision", None, None),))
    assert [r for r in report(text, c, seen={"class features": ["darkvision"]}) if r[1].startswith("Class")] == [
        ("REMOVE", "Class Features / Darkvision", GONE)]


def test_species_traits_and_feats_use_their_own_tables():
    text = TEMPLATE
    c = got(racial_traits=(("Darkvision", None, None),), feats=(("Alert",),))
    rows = report(text, c)
    assert ("ADD", "Species Traits / Darkvision", "not in the note; added") in rows
    assert ("ADD", "Feats / Alert", "not in the note; added") in rows
    out = after(text, c)
    assert "## Species Traits\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|------|--------|------|------|----------|---------|\n| Darkvision | | | | | |\n\n" in out
    assert "| Alert | | | | | |\n" in out


def test_added_feature_row_has_uses_and_recovers_and_the_tables_column_count():
    text = note("")
    out = after(text, got(**FEATS))
    assert out.count("| Second Wind | | 3 | | Short Rest | |\n") == 1
    assert "| Arcane Recovery | | 1 | | Long Rest | |\n" in out
    assert out.index("Second Wind") < out.index("Arcane Recovery")


# --- the template's blank row -------------------------------------------------------------

def test_blank_row_goes_without_a_report_row_when_a_row_is_added():
    text = TEMPLATE
    rows = plan_rows(text, got(**FEATS))
    reported = [r for r in rows if not r.silent]
    assert not [r for r in reported if r.status == "REMOVE"]
    out = write_rows(text, rows)
    assert "## Class Features\n\n| Name | Action | Uses | Used | Recovers | Summary |\n|------|--------|------|------|----------|---------|\n| Second Wind | | 3 | | Short Rest | |\n| Arcane Recovery | | 1 | | Long Rest | |\n\n" in out


def test_blank_row_stays_when_nothing_is_added():
    c = got(spells=SPELL_ARGS[:0], **NOTHING)
    assert not [r for r in plan_rows(TEMPLATE, c) if r.status in ("ADD", "REMOVE")]
    out = after(TEMPLATE, c)
    assert "|------|--------|------|------|----------|---------|\n| | | | | | |\n" in out


def test_a_placeholder_row_is_blank_too_but_a_row_with_other_content_is_not_removed():
    text = note("| {name} | {action} | {uses} | | | |\n| | | 3 | | | |\n")
    out = after(text, got(**FEATS))
    assert "{name}" not in out and "| | | 3 | | | |\n" in out


# --- matching ------------------------------------------------------------------------------

def test_extra_row_is_removed_when_remembered_and_a_hand_added_one_stays():
    text = note("| Second Wind | | 3 | | Short Rest | |\n| Old Trick | | | | | |\n"
                "| Moon-touched Blade | | | | | |\n")
    c = got(class_features=(("Second Wind", 3, 1),))
    assert report(text, c, seen={"class features": ["old trick", "second wind"]}) == [
        ("SAME", "Class Features / Second Wind", "matches"),
        ("REMOVE", "Class Features / Old Trick", GONE)]
    assert after(text, c, seen={"class features": ["old trick"]}) == text.replace("| Old Trick | | | | | |\n", "")


def test_the_whole_name_is_what_matches_a_potion_with_brackets_is_not_its_plain_name():
    text = note("", gear="| Potion of Healing (Greater) | 1 | 1 lb | |\n| Potion of Healing | 1 | 1 lb | |\n")
    c = got(inventory=(("Potion of Healing (Greater)", 1, 1, False, False, "gear"),))
    assert report(text, c) == [("SAME", "Equipment / Gear / Potion of Healing (Greater)", "matches")]
    assert report(text, c, seen={"gear": ["potion of healing"]}) == [
        ("SAME", "Equipment / Gear / Potion of Healing (Greater)", "matches"),
        ("REMOVE", "Equipment / Gear / Potion of Healing", GONE)]


def test_a_row_with_a_trailing_bracket_is_not_the_entry_without_it():
    text = note("", gear="| Rope, Hempen (spare) | 1 | 10 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    assert report(text, c) == [("ADD", "Equipment / Gear / Rope, Hempen", "not in the note; added")]
    out = after(text, c)
    assert "| Rope, Hempen (spare) | 1 | 10 lb | |\n| Rope, Hempen | 1 | 10 lb | |\n" in out


def test_the_first_cell_is_never_rewritten_and_links_and_bold_match():
    text = note("", gear="| [[Rope, Hempen\\|rope]] | 2 | 10 lb | |\n| **Shield** | 1 | 6 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"), ("Shield", 1, 6, False, False, "gear")))
    assert report(text, c) == [("WRITE", "Equipment / Gear / Rope, Hempen / Qty", "2 -> 1"),
                               ("SAME", "Equipment / Gear / Shield", "matches")]
    out = after(text, c)
    assert "| [[Rope, Hempen\\|rope]] | 1 | 10 lb | |\n| **Shield** | 1 | 6 lb | |\n" in out


def test_duplicate_rows_first_matched_second_is_an_extra_row():
    text = note("", gear="| Rope, Hempen | 1 | 10 lb | |\n| Rope, Hempen | 1 | 10 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    seen = {"gear": ["rope, hempen"]}
    assert report(text, c, seen=seen) == [
        ("SAME", "Equipment / Gear / Rope, Hempen", "matches"),
        ("REMOVE", "Equipment / Gear / Rope, Hempen", "a second row for an entry already in the note; removed")]
    assert after(text, c, seen=seen).count("Rope, Hempen") == 1


def test_a_name_whose_safe_form_collides_with_a_row_is_that_row():
    text = note("", gear="| Rope, Hempen | 1 | 10 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    c = dataclasses.replace(c, gear=[dataclasses.replace(c.gear[0], name="Rope,  Hempen™")])
    assert report(text, c) == [("SAME", "Equipment / Gear / Rope, Hempen", "matches")]
    assert after(text, c) == text


# --- gear ----------------------------------------------------------------------------------

def test_two_daggers_are_one_row_with_quantity_two_and_a_second_run_adds_nothing():
    c = got(inventory=(("Dagger", 1, 1, False, False, "weapon"), ("Dagger", 1, 1, False, False, "weapon")))
    text = note("", gear="")
    once = after(text, c)
    assert "| Dagger | 2 | 1 lb | |\n" in once and once.count("Dagger") == 1
    assert not [r for r in plan_rows(once, c) if r.status in ("ADD", "REMOVE", "WRITE")]


def test_gear_table_with_no_weight_column_still_matches_adds_and_removes():
    text = ("## Equipment\n\n### Gear\n\n| Item | Qty | Notes |\n|---|---|---|\n"
            "| Rope, Hempen | 3 | long |\n| Old Sack | 1 | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"), ("Shield", 1, 6, False, False, "gear")))
    seen = {"gear": ["old sack"]}
    assert report(text, c, seen=seen) == [("WRITE", "Equipment / Gear / Rope, Hempen / Qty", "3 -> 1"),
                                          ("REMOVE", "Equipment / Gear / Old Sack", GONE),
                                          ("ADD", "Equipment / Gear / Shield", "not in the note; added")]
    assert after(text, c, seen=seen) == ("## Equipment\n\n### Gear\n\n| Item | Qty | Notes |\n|---|---|---|\n"
                              "| Rope, Hempen | 1 | long |\n| Shield | 1 | |\n")


def test_gear_weight_forms_that_mean_the_same_are_same():
    text = note("", gear="| Rope, Hempen | 1 | 10 | |\n| Torch | 1 | 1/4 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"), ("Torch", 1, 0.25, False, False, "gear")))
    assert [r[0] for r in report(text, c)] == ["SAME", "SAME"]


def test_escaped_pipe_in_a_notes_cell_survives_a_write_to_the_same_row():
    text = note("", gear="| Rope, Hempen | 4 | 10 lb | a \\| b |\n")
    out = after(text, got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),)))
    assert "| Rope, Hempen | 1 | 10 lb | a \\| b |\n" in out


# --- spells --------------------------------------------------------------------------------

SPELL_ARGS = (("Fireball", 3, True, False, False, False, (1, 2, 3), "Wizard"),
              ("Light", 0, True, False, False, False, (1,), "Wizard"))


def test_spell_row_added_with_every_owned_column_and_the_level_as_the_page_reads_it():
    text = note("", spells="")
    out = after(text, got(spells=SPELL_ARGS))
    assert "| Light | Cantrip | 1 action | 30 ft | V | 1 minute | | | Wizard | |\n" in out
    assert "| Fireball | 3rd | 1 action | 30 ft | V, S, M | 1 minute | | | Wizard | |\n" in out


def test_spell_level_forms_the_page_reads_are_same():
    text = note("", spells="| Fireball | 3 | 1 action | 30 ft | V, S, M | 1 minute | x | | Wizard | s |\n"
                "| Light | cantrips | 1 action | 30 ft | V | 1 minute | | | Wizard | |\n")
    assert [r[0] for r in report(text, got(spells=SPELL_ARGS))] == ["SAME", "SAME"]


def test_spell_cells_written_and_hit_dc_and_summary_left_alone():
    text = note("", spells="| Fireball | 2nd | A | 60 ft | V | Inst | +5 | | Wizard | burns |\n")
    c = got(spells=SPELL_ARGS[:1])
    assert report(text, c) == [
        ("WRITE", "Spells / Fireball / Level", "2nd -> 3rd"), ("WRITE", "Spells / Fireball / Time", "A -> 1 action"),
        ("WRITE", "Spells / Fireball / Range", "60 ft -> 30 ft"),
        ("WRITE", "Spells / Fireball / Components", "V -> V, S, M"),
        ("WRITE", "Spells / Fireball / Duration", "Inst -> 1 minute")]
    assert "| Fireball | 3rd | 1 action | 30 ft | V, S, M | 1 minute | +5 | | Wizard | burns |\n" in after(text, c)


def test_spell_tags_sync_owns_only_c_r_and_always_prepared():
    spells = (("Shield", 1, True, True, True, True, (1, 2), "Wizard"),)
    c = got(spells=spells)
    base = "| Shield | 1st | 1 action | 30 ft | V, S | 1 minute | | {} | Wizard | |\n"
    text = note("", spells=base.format("Fav, C"))
    assert report(text, c) == [("WRITE", "Spells / Shield / Tags", "Fav, C -> Fav, C, R, Always prepared")]
    assert "| Fav, C, R, Always prepared |" in after(text, c)
    text = note("", spells=base.format("R, Mine, C, Always prepared"))
    assert report(text, c) == [("SAME", "Spells / Shield", "matches")]
    plain = got(spells=(("Shield", 1, True, False, False, False, (1, 2), "Wizard"),))
    text = note("", spells=base.format("R, Mine, C"))
    assert report(text, plain)[0] == ("WRITE", "Spells / Shield / Tags", "R, Mine, C -> Mine")
    assert "| Mine |" in after(text, plain)
    text = note("", spells=base.format("C"))
    assert report(text, plain)[0] == ("WRITE", "Spells / Shield / Tags", "C -> (blank)")
    text = note("", spells=base.format("C (hand)"))
    assert report(text, plain)[0][0] == "KEPT"


def test_a_hand_entered_always_prepared_row_stays_and_a_remembered_one_goes():
    text = note("", spells="| Bless | 1st | | | | | | Always prepared | | |\n| Dud | 1st | | | | | | C | | |\n")
    c, seen = got(spells=SPELL_ARGS[:1]), {"spells": ["dud"]}
    rows = report(text, c, seen=seen)
    assert not [r for r in rows if "Bless" in r[1]]
    assert ("REMOVE", "Spells / Dud", GONE) in rows
    assert "Bless" in after(text, c, seen=seen) and "Dud" not in after(text, c, seen=seen)


def test_spells_table_with_the_source_column_missing_is_still_read():
    text = ("## Spellcasting\n\n### Spells\n\n| Spell | Level | Time | Range | Components | Duration | Hit / DC | Tags | Summary |\n"
            "|---|---|---|---|---|---|---|---|---|\n")
    out = after(text, got(spells=SPELL_ARGS[1:]))
    assert out.endswith("|---|---|---|---|---|---|---|---|---|\n| Light | Cantrip | 1 action | 30 ft | V | 1 minute | | | |\n")


# --- magic items and coins -------------------------------------------------------------------

MAGIC_ARGS = (("Ring of Tests", 1, 0, True, True, "gear", True, 3, 2),)


def test_magic_item_added_matched_and_charges_blank_when_it_has_none():
    c = got(inventory=MAGIC_ARGS + (("Zzyx Blade", 1, 3, True, False, "weapon"),))
    out = after(note("", magic=""), c)
    assert "| Ring of Tests | Yes | 3 | | Long Rest | |\n| Zzyx Blade | No | | | | |\n" in out
    text = note("", magic="| Ring of Tests | No | 2 | 1 | Dawn | n |\n")
    assert report(text, got(inventory=MAGIC_ARGS)) == [
        ("WRITE", "Equipment / Magic Items / Ring of Tests / Attuned", "No -> Yes"),
        ("WRITE", "Equipment / Magic Items / Ring of Tests / Charges", "2 -> 3"),
        ("WRITE", "Equipment / Magic Items / Ring of Tests / Recovers", "Dawn -> Long Rest")]
    assert "| Ring of Tests | Yes | 3 | 1 | Long Rest | n |\n" in after(text, got(inventory=MAGIC_ARGS))


def test_coins_written_by_header_and_a_reasoned_cell_kept():
    c = got(currencies={"cp": 1, "sp": 2, "gp": 15, "ep": 0, "pp": 4})
    text = note("", coins="| 0 | 0 | 0 | 15 (chest) | 0 |\n")
    assert report(text, c, coins=True) == [("WRITE", "Equipment / Coins / CP", "0 -> 1"),
                               ("WRITE", "Equipment / Coins / SP", "0 -> 2"),
                               ("KEPT", "Equipment / Coins / GP", "15 (chest); D&D Beyond gives 15"),
                               ("WRITE", "Equipment / Coins / PP", "0 -> 4")]
    assert "| 1 | 2 | 0 | 15 (chest) | 4 |\n" in after(text, c)
    assert report(after(text, c), c, coins=True)[0][0] == "KEPT"


def test_coins_already_right_is_one_same_row():
    text = note("", coins="| 0 | 0 | 0 | 15 | 0 |\n")
    assert report(text, got(), coins=True) == [("SAME", "Equipment / Coins", "matches")]


# --- tables the note lacks ---------------------------------------------------------------------

def test_a_missing_table_is_one_kept_row_per_non_empty_list():
    text = note("")
    c = got(spells=SPELL_ARGS, inventory=MAGIC_ARGS + (("Rope, Hempen", 1, 10, False, False, "gear"),),
            feats=(("Alert",),), racial_traits=(("Darkvision", None, None),))
    assert report(text, c, coins=True) == [
        ("KEPT", "Species Traits", "the note has no Species Traits table; 1 species trait was not written"),
        ("KEPT", "Feats", "the note has no Feats table; 1 feat was not written"),
        ("KEPT", "Spells", "the note has no Spells table; 2 spells were not written"),
        ("KEPT", "Equipment / Gear", "the note has no Gear table; 1 gear item was not written"),
        ("KEPT", "Equipment / Magic Items", "the note has no Magic Items table; 1 magic item was not written"),
        ("KEPT", "Equipment / Coins", "the note has no Coins table; coins were not written")]
    assert after(text, c) == text


def test_a_non_caster_with_no_spellcasting_section_says_nothing():
    text = note("")
    c = got(currencies={"cp": 0, "sp": 0, "gp": 0, "ep": 0, "pp": 0})
    assert report(text, c) == []


# --- the shape of the whole -----------------------------------------------------------------------

def test_second_run_on_the_template_finds_nothing_to_do():
    c = got(spells=SPELL_ARGS, inventory=MAGIC_ARGS + (("Rope, Hempen", 1, 10, False, False, "gear"),),
            feats=(("Alert",),), racial_traits=(("Darkvision", None, None),), **FEATS)
    once = after(TEMPLATE, c)
    assert once != TEMPLATE
    again = plan_rows(once, c)
    assert not [e for e in again if e.status in ("ADD", "REMOVE", "WRITE")]
    assert write_rows(once, again) == once


def test_rows_are_planned_on_the_text_the_cells_step_produced():
    c = got(spells=SPELL_ARGS, **FEATS)
    cells_done = write_edits(TEMPLATE, plan_cells(TEMPLATE, c))
    final = write_rows(cells_done, plan_rows(cells_done, c))
    assert "| Level | 5 |" in final and "| Second Wind | | 3 | | Short Rest | |" in final
    # The line numbers are against the text given: planning on the text before the cells step is not
    # the same plan when that step changes the number of lines.
    longer = "\n\n" + cells_done
    assert [e.line for e in plan_rows(longer, c) if e.line >= 0] == [e.line + 2 for e in plan_rows(cells_done, c) if e.line >= 0]


def test_added_row_takes_the_line_ending_of_the_row_above_and_crlf_survives():
    text = note("| Second Wind | | 2 | | Short Rest | |\n", eol="\r\n")
    out = after(text, got(**FEATS))
    assert "| Second Wind | | 3 | | Short Rest | |\r\n| Arcane Recovery | | 1 | | Long Rest | |\r\n" in out
    assert "\n" not in out.replace("\r\n", "")


def test_a_table_on_the_last_line_with_no_newline_gains_one_row_and_no_trailing_newline():
    text = "## Equipment\n\n### Gear\n\n| Item | Qty | Weight | Notes |\n|---|---|---|---|\n| Torch | 1 | 1 lb | |"
    c = got(inventory=(("Torch", 1, 1, False, False, "gear"), ("Shield", 1, 6, False, False, "gear")))
    out = after(text, c)
    assert out == text + "\n| Shield | 1 | 6 lb | |"
    assert after(out, c) == out


def test_write_rows_applies_remove_write_and_add_bottom_up():
    text = "a\n| x |\n| y |\n| z |\nb\n"
    edits = [RowEdit("REMOVE", "r", "m", 1), RowEdit("WRITE", "w", "m", 2, "| Y |"),
             RowEdit("ADD", "a", "m", 3, "| n1 |"), RowEdit("ADD", "a", "m", 3, "| n2 |")]
    assert write_rows(text, edits) == "a\n| Y |\n| z |\n| n1 |\n| n2 |\nb\n"
    assert write_rows(text, []) == text


def test_row_edit_is_a_plain_dataclass_with_the_contract_fields():
    e = RowEdit("SAME", "x", "y")
    assert (e.line, e.new) == (-1, "")


def test_fenced_example_tables_are_not_read():
    fenced = "```\n### Gear\n\n| Item | Qty | Weight | Notes |\n|---|---|---|---|\n| Fake | 1 | | |\n```\n\n"
    text = "## Equipment\n\n" + fenced + "### Gear\n\n" + GEAR + "| Torch | 1 | 1 lb | |\n"
    out = after(text, got(inventory=(("Torch", 1, 1, False, False, "gear"),)))
    assert out == text


# --- where the lines go: the one path that deletes a user's lines -----------------------------

TORCH = (("Torch", 2, 1, False, False, "gear"),)
SHIELD = ("Shield", 1, 6, False, False, "gear")
OLD_ROPE = {"gear": ["old rope", "torch"]}


def test_a_stored_gear_table_beside_the_real_one_is_never_touched():
    stored = "### Gear (stored)\n\n" + GEAR + "| Junk | 1 | 1 lb | |\n| Torch | 9 | | |\n\n"
    text = "## Equipment\n\n" + stored + "### Gear\n\n" + GEAR + "| Torch | 1 | 1 lb | |\n| Old Rope | 1 | | |\n"
    out = after(text, got(inventory=TORCH + (SHIELD,)), OLD_ROPE)
    assert out.startswith("## Equipment\n\n" + stored)
    assert out.endswith("### Gear\n\n" + GEAR + "| Torch | 2 | 1 lb | |\n| Shield | 1 | 6 lb | |\n")


def test_a_second_table_under_the_same_gear_heading_is_never_touched():
    second = "\nNotes on the party's stash:\n\n" + GEAR + "| Junk | 1 | 1 lb | |\n| Torch | 9 | | |\n"
    text = "## Equipment\n\n### Gear\n\n" + GEAR + "| Torch | 1 | 1 lb | |\n| Old Rope | 1 | | |\n" + second
    out = after(text, got(inventory=TORCH + (SHIELD,)), OLD_ROPE)
    assert out == ("## Equipment\n\n### Gear\n\n" + GEAR + "| Torch | 2 | 1 lb | |\n| Shield | 1 | 6 lb | |\n" + second)


def test_a_table_right_above_the_next_heading_with_no_blank_line_keeps_the_heading_where_it_is():
    text = "## Equipment\n\n### Gear\n\n" + GEAR + "| Torch | 1 | 1 lb | |\n| Old Rope | 1 | | |\n## Companions\n\n| X |\n"
    out = after(text, got(inventory=TORCH + (SHIELD,)), OLD_ROPE)
    assert out == ("## Equipment\n\n### Gear\n\n" + GEAR + "| Torch | 2 | 1 lb | |\n| Shield | 1 | 6 lb | |\n"
                   "## Companions\n\n| X |\n")


def test_an_indented_table_is_read_and_only_its_rows_change():
    head = "## Equipment\n\n### Gear\n\n  | Item | Qty | Weight | Notes |\n  |---|---|---|---|\n"
    text = head + "  | Torch | 1 | 1 lb | keep |\n  | Old Rope | 1 | | |\n\nafter\n"
    out = after(text, got(inventory=TORCH + (SHIELD,)), OLD_ROPE)
    assert out == head + "  | Torch | 2 | 1 lb | keep |\n  | Shield | 1 | 6 lb | |\n\nafter\n"


def test_a_crlf_file_keeps_every_line_ending_through_a_write_a_remove_and_an_add():
    text = note("", gear="| Torch | 1 | 1 lb | |\n| Old Rope | 1 | | |\n", eol="\r\n")
    out = after(text, got(inventory=TORCH + (SHIELD,), **NOTHING), OLD_ROPE)
    assert out == note("", gear="| Torch | 2 | 1 lb | |\n| Shield | 1 | 6 lb | |\n", eol="\r\n")


def test_a_write_a_remove_and_an_add_in_one_table_in_one_pass():
    text = note("", gear="| Anvil | 1 | | |\n| Torch | 1 | 1 lb | keep |\n| Old Rope | 1 | | |\n| Lamp | 1 | | |\n")
    c = got(inventory=TORCH + (SHIELD, ("Lamp", 1, 1, False, False, "gear")), **NOTHING)
    seen = {"gear": ["anvil", "old rope", "lamp"]}
    out = after(text, c, seen)
    assert out == note("", gear="| Torch | 2 | 1 lb | keep |\n| Lamp | 1 | 1 lb | |\n| Shield | 1 | 6 lb | |\n")
    assert [r for r in report(text, c, seen=seen) if r[0] in ("WRITE", "REMOVE", "ADD")] == [
        ("REMOVE", "Equipment / Gear / Anvil", GONE),
        ("WRITE", "Equipment / Gear / Torch / Qty", "1 -> 2"),
        ("REMOVE", "Equipment / Gear / Old Rope", GONE),
        ("WRITE", "Equipment / Gear / Lamp / Weight", "(blank) -> 1 lb"),
        ("ADD", "Equipment / Gear / Shield", "not in the note; added")]


# --- the template's blank row, and an emptied cell ---------------------------------------------

def test_the_blank_row_goes_only_when_the_table_had_no_real_row():
    c = got(inventory=TORCH)
    assert after(note("", gear="| | | | |\n"), c) == note("", gear="| Torch | 2 | 1 lb | |\n")
    c = got(inventory=(("Rope", 1, 1, False, False, "gear"), SHIELD))
    kept = after(note("", gear="| Rope | 1 | 1 lb | |\n| | | | |\n"), c)
    assert kept == note("", gear="| Rope | 1 | 1 lb | |\n| | | | |\n| Shield | 1 | 6 lb | |\n")


def test_set_cell_with_an_empty_value_writes_one_space_between_the_pipes():
    assert set_cell("| a | b | c |", 1, "") == "| a | | c |"
    assert set_cell("| a | b | c |", 1, "x") == "| a | x | c |"


# --- sync removes only what it remembers adding ----------------------------------------------

def test_a_first_sync_removes_nothing_and_says_nothing_about_rows_it_does_not_know():
    text = note("| Second Wind | | 3 | | Short Rest | |\n| Old Trick | | | | | |\n| Thing (gift) | | | | | |\n")
    c = got(class_features=(("Second Wind", 3, 1),))
    assert report(text, c) == [("SAME", "Class Features / Second Wind", "matches")]
    assert after(text, c) == text


def test_a_remembered_row_is_removed_when_d_and_d_beyond_drops_it():
    text = note("| Second Wind | | 3 | | Short Rest | |\n| Old Trick | | | | | |\n")
    c = got(class_features=(("Second Wind", 3, 1),))
    seen = {"class features": ["old trick", "second wind"]}
    assert report(text, c, seen=seen) == [("SAME", "Class Features / Second Wind", "matches"),
                                          ("REMOVE", "Class Features / Old Trick", GONE)]
    assert after(text, c, seen=seen) == text.replace("| Old Trick | | | | | |\n", "")


def test_a_remembered_row_named_with_brackets_is_removed_too():
    text = note("", gear="| Potion of Healing (Greater) | 1 | 1 lb | |\n| Thing (gift) | 1 | | |\n")
    seen = {"gear": ["potion of healing (greater)", "thing (gift)"]}
    c = got(inventory=())
    assert report(text, c, seen=seen) == [("REMOVE", "Equipment / Gear / Potion of Healing (Greater)", GONE),
                                          ("REMOVE", "Equipment / Gear / Thing (gift)", GONE)]


def test_a_hand_added_row_stays_byte_for_byte_and_is_never_reported():
    text = note("| Moon-touched Blade | | | | | |\n| Second Wind | | 3 | | Short Rest | |\n")
    c = got(class_features=(("Second Wind", 3, 1),))
    for seen in (None, {}, {"class features": ["second wind"]}, {"gear": ["moon-touched blade"]}):
        assert report(text, c, seen=seen) == [("SAME", "Class Features / Second Wind", "matches")]
        assert after(text, c, seen=seen) == text


def test_a_row_is_remembered_by_the_list_it_was_in_not_by_its_name_alone():
    text = note("| Torch | | | | | |\n")
    c = got(class_features=())
    assert report(text, c, seen={"gear": ["torch"]}) == []
    assert report(text, c, seen={"class features": ["torch"]}) == [("REMOVE", "Class Features / Torch", GONE)]


def test_a_hand_added_row_d_and_d_beyond_later_gains_is_matched_and_updated():
    text = note("", gear="| Moon Lamp | 5 | | |\n")
    c = got(inventory=(("Moon Lamp", 1, 2, False, False, "gear"),))
    assert [r[0] for r in report(text, c)] == ["WRITE", "WRITE"]
    assert "| Moon Lamp | 1 | 2 lb | |\n" in after(text, c)


def test_a_row_the_gm_deleted_by_hand_comes_back_while_d_and_d_beyond_has_it():
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    seen = {"gear": ["rope, hempen"]}
    assert report(note("", gear=""), c, seen=seen) == [("ADD", "Equipment / Gear / Rope, Hempen", "not in the note; added")]


def test_an_always_prepared_spell_row_is_the_gms_when_never_remembered_and_goes_when_remembered():
    text = note("", spells="| Bless | 1st | | | | | | Always prepared | | |\n")
    c = got(spells=SPELL_ARGS[:1])
    assert ("KEPT", "Spells / Bless", "always prepared; D&D Beyond does not list these; kept") not in report(text, c)
    assert not [r for r in report(text, c) if "Bless" in r[1]]
    assert [r for r in report(text, c, seen={"spells": ["bless"]}) if "Bless" in r[1]] == [
        ("REMOVE", "Spells / Bless", GONE)]


def test_a_second_row_for_an_entry_already_matched_goes_only_when_remembered():
    text = note("", gear="| Rope, Hempen | 1 | 10 lb | |\n| Rope, Hempen | 1 | 10 lb | |\n")
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"),))
    assert report(text, c) == [("SAME", "Equipment / Gear / Rope, Hempen", "matches")]
    assert report(text, c, seen={"gear": ["rope, hempen"]})[1][0] == "REMOVE"


def test_a_linked_row_is_remembered_by_its_shown_name_or_its_target():
    text = note("", gear="| [[Rope, Hempen\\|rope]] | 1 | 10 lb | |\n")
    c = got(inventory=())
    assert report(text, c, seen={"gear": ["rope, hempen"]})[0][0] == "REMOVE"
    assert report(text, c, seen={"gear": ["rope"]})[0][0] == "REMOVE"
    assert report(text, c) == []
