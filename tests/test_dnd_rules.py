#!/usr/bin/env python3
"""Tests for dnd_rules.py: slips in a D&D PC note's numbers."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_rules as dr  # noqa: E402
from dnd_builder import sheet  # noqa: E402

CLASS = "Background / Class/Subclass"


def found(text, status=None):
    return [(f.status, f.locus, f.message) for f in dr.check(text) if status in (None, f.status)]


def test_a_correct_sheet_has_no_findings():
    assert found(sheet()) == []


def test_crlf_changes_nothing():
    assert found(sheet().replace("\n", "\r\n")) == []
    slip = sheet(hit_dice=(("d6", "0/4"),))
    assert found(slip.replace("\n", "\r\n")) == found(slip)


# --- the class line ---------------------------------------------------

def test_read_classes():
    one = dr.read_classes("Wizard 5 (Evoker)", 5)
    assert [(c.name, c.level, c.subclass) for c in one] == [("Wizard", 5, "Evoker")]
    two = dr.read_classes("Fighter 3 (Champion) / Wizard 2 (Evoker)", 5)
    assert [(c.name, c.level) for c in two] == [("Fighter", 3), ("Wizard", 2)]
    assert [(c.name, c.level) for c in dr.read_classes("Bard", 7)] == [("Bard", 7)]
    assert [(c.name, c.level) for c in dr.read_classes("bard 16", 16)] == [("bard", 16)]
    assert [(c.name, c.level) for c in dr.read_classes("[[Wizard]] 5 (Evoker)", 5)] == [("Wizard", 5)]
    assert dr.read_classes("Paladin 5 (Oath of Devotion/Glory)", 5)[0].subclass == "Oath of Devotion/Glory"


def test_read_classes_gives_up_rather_than_guess():
    for raw in (None, "", "{Class (Subclass)}", "Level 16 Bard", "Bard 16, College of Eloquence",
                "Fighter / Wizard", "Wizard 0", "Wizard 21"):
        assert dr.read_classes(raw, 5) is None, raw


def test_loose_class_lines_never_cause_a_wrong_row():
    for line in ("bard 5", "Bard", "Level 5 Bard", "Bard 5, College of Lore", "[[Bard]] 5 (College of Lore)"):
        text = sheet(classes=line, saves=("DEX", "CHA"), hit_dice=(("d8", "0/5"),))
        assert found(text, "WRONG") == [], line
        assert len(found(text, "CANTCHECK")) <= 1, line


def test_no_class_line_is_one_cantcheck():
    assert found(sheet(classes="{Class (Subclass)}")) == [
        ("CANTCHECK", CLASS, "no class line could be read, so the checks that need a class's tables were skipped")]


def test_a_class_outside_the_free_rules_is_one_cantcheck():
    assert found(sheet(classes="Artificer 5 (Alchemist)")) == [
        ("CANTCHECK", CLASS, "Artificer is not a class in the free rules, so the checks that need "
                             "a class's tables were skipped")]


# --- WRONG ------------------------------------------------------------

def test_class_levels_must_add_up():
    text = sheet(classes="Wizard 4 (Evoker)", hit_dice=(("d6", "0/4"),))
    assert found(text, "WRONG") == [("WRONG", CLASS, "the class levels add up to 4; Level is 5")]


def test_hit_dice_match_the_class_levels():
    assert found(sheet(hit_dice=(("d6", "0/4"),))) == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice d6", "the note has 4; Wizard 5 gives 5")]


def test_multiclass_hit_dice():
    two = "Fighter 3 (Champion) / Wizard 2 (Evoker)"
    good = sheet(classes=two, saves=("STR", "CON"), hp_now="30", hp_max="30",
                 hit_dice=(("d10", "0/3"), ("d6", "0/2")), slots={1: ("3", "0")})
    assert found(good, "WRONG") == []
    one_row = sheet(classes=two, saves=("STR", "CON"), hp_now="30", hp_max="30",
                    hit_dice=(("d10", "0/3"),), slots={1: ("3", "0")})
    assert found(one_row, "WRONG") == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice", "no d6 row; Fighter 3 / Wizard 2 gives 2")]


def test_hit_dice_with_no_die_size_are_held_to_the_level():
    assert found(sheet(hit_dice=(("", "0/4"),))) == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice", "the note has 4; Level 5 gives 5")]
    assert found(sheet(hit_dice=(("", "0/5"),))) == []
    # With no die size the class is not needed.
    assert found(sheet(classes="Artificer 5", hit_dice=(("", "0/4"),)), "WRONG") == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice", "the note has 4; Level 5 gives 5")]


def test_more_than_three_attuned_items():
    four = tuple((f"Ring {i}", "Yes", "", "") for i in range(4))
    assert found(sheet(items=four)) == [
        ("WRONG", "Equipment / Magic Items", "4 items attuned; the limit is 3")]
    assert found(sheet(items=four[:3] + (("Cloak", "No", "", ""),))) == []


def test_attunement_in_the_earlier_table():
    assert found(sheet(old_items=("Ring", "Cloak", "Staff", "Amulet"))) == [
        ("WRONG", "Equipment / Magic Item Attunement", "4 items attuned; the limit is 3")]
    assert found(sheet(old_items=("Ring", "Cloak", "—", ""))) == []


def test_attunement_is_only_a_look_when_a_class_is_unknown():
    four = tuple((f"Ring {i}", "Yes", "", "") for i in range(4))
    rows = found(sheet(classes="Artificer 5 (Alchemist)", items=four))
    assert ("LOOK", "Equipment / Magic Items", "4 items attuned; the limit is 3") in rows
    assert [r for r in rows if r[0] == "WRONG"] == []


def test_expertise_needs_proficiency():
    assert found(sheet(skills=(("Arcana", "INT", "No", "Yes"),))) == [
        ("WRONG", "Skills / Arcana", "Expertise is marked but Proficient is not")]
    assert found(sheet(skills=(("Arcana", "INT", "Half", "Yes"),))) == [
        ("WRONG", "Skills / Arcana", "Expertise is marked but Proficient is not")]
    assert found(sheet(skills=(("Arcana", "INT", "Yes", "Yes"),))) == []


def test_more_spent_than_owned():
    assert found(sheet(slots={1: ("4", "5"), 2: ("3", "0"), 3: ("2", "0")})) == [
        ("WRONG", "Spellcasting / Spell Slots / 1st", "5 expended of 4")]
    assert found(sheet(features=(("Arcane Recovery", "1", "2"),))) == [
        ("WRONG", "Class Features / Arcane Recovery", "2 used of 1")]
    assert found(sheet(feats=(("Lucky", "3", "4"),))) == [
        ("WRONG", "Feats / Lucky", "4 used of 3")]
    assert found(sheet(items=(("Wand of Magic Missiles", "No", "7", "8"),))) == [
        ("WRONG", "Equipment / Magic Items / Wand of Magic Missiles", "8 used of 7 charges")]
    assert found(sheet(hit_dice=(("d6", "6/5"),))) == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice d6", "6 spent of 5")]
    assert found(sheet(hp_now="23")) == [
        ("WRONG", "Stat Sheet / Combat / HP (Current)", "23 is above HP (Max) 22")]
    assert found(sheet(death="4/0")) == [
        ("WRONG", "Stat Sheet / Combat / Death Saves (S/F)", "4/0; a count cannot pass 3")]


def test_a_reasoned_total_still_bounds_what_is_spent():
    text = sheet(slots={1: ("5 (ring of spell storing)", "6"), 2: ("3", "0"), 3: ("2", "0")})
    assert found(text, "WRONG") == [("WRONG", "Spellcasting / Spell Slots / 1st", "6 expended of 5")]


def test_cells_that_are_not_numbers_are_skipped():
    text = sheet(features=(("Arcane Recovery", "PB", "1"), ("Sculpt Spells", "—", "—"),
                           ("Signature", "INT mod", "")),
                 items=(("Wand", "Yes", "2d4", "1"),), hit_dice=(("d6", "0/5 (rested)"),),
                 hp_now="", death="—")
    assert found(text) == []
