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


# --- LOOK -------------------------------------------------------------

SLOTS = "Spellcasting / Spell Slots"
SPELLS = "Spellcasting / Spells"
NO_SOURCE = "; this note has no Source column, so spells from feats and items are counted too"


def test_slot_totals_against_the_table():
    assert found(sheet(slots={1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Wizard 5 gives 2")]
    assert found(sheet(slots={1: ("4", "0"), 2: ("3", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has blank; Wizard 5 gives 2")]
    assert found(sheet(slots={1: ("4", "0"), 2: ("3", "0"), 3: ("2", "0"), 4: ("1", "0")})) == [
        ("LOOK", f"{SLOTS} / 4th", "the note has 1; Wizard 5 gives 0")]


def test_a_reason_beside_a_slot_total_settles_it():
    assert found(sheet(slots={1: ("5 (ring of spell storing)", "0"), 2: ("3", "0"), 3: ("2", "0")})) == []


def test_a_caster_with_no_slot_totals_is_one_look():
    assert found(sheet(slots={})) == [("LOOK", SLOTS, "no slot totals in the note; Wizard 5 has slots")]


def test_multiclass_slots_use_the_combined_level():
    text = sheet(level=8, classes="Paladin 5 (Oath of Devotion) / Sorcerer 3 (Draconic Sorcery)",
                 saves=("WIS", "CHA"), hp_now="60", hp_max="60",
                 hit_dice=(("d10", "0/5"), ("d6", "0/3")),
                 slots={1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")})
    assert found(text) == []


def test_pact_slots_sit_at_their_level():
    alone = sheet(classes="Warlock 5 (Fiend Patron)", saves=("WIS", "CHA"),
                  hit_dice=(("d8", "0/5"),), slots={3: ("2", "0")})
    assert found(alone) == []
    mixed = sheet(classes="Warlock 2 (Fiend Patron) / Bard 3 (College of Lore)", saves=("DEX", "CHA"),
                  hit_dice=(("d8", "0/5"),), slots={1: ("6", "0"), 2: ("2", "0")})
    assert found(mixed) == []


def test_a_class_with_no_spells_that_has_slots_is_a_cantcheck():
    knight = sheet(classes="Fighter 5 (Eldritch Knight)", saves=("STR", "CON"), hp_now="30", hp_max="30",
                   hit_dice=(("d10", "0/5"),), slots={1: ("3", "0")},
                   spells=tuple((f"Cantrip {i}", "Cantrip", "", "") for i in range(9)))
    rows = found(knight)
    assert [(r[0], r[1]) for r in rows] == [("CANTCHECK", SLOTS)]
    assert "Fighter" in rows[0][2]
    plain = sheet(classes="Fighter 5 (Champion)", saves=("STR", "CON"), hp_now="30", hp_max="30",
                  hit_dice=(("d10", "0/5"),), slots={})
    assert found(plain) == []


def test_a_mixed_character_is_checked_only_when_the_totals_match():
    two = "Fighter 2 (Champion) / Wizard 3 (Evoker)"
    base = dict(classes=two, saves=("STR", "CON"), hp_now="30", hp_max="30",
                hit_dice=(("d10", "0/2"), ("d6", "0/3")))
    assert found(sheet(slots={1: ("4", "0"), 2: ("2", "0")}, **base)) == []
    rows = found(sheet(slots={1: ("4", "0"), 2: ("3", "0")}, **base))
    assert [(r[0], r[1]) for r in rows] == [("CANTCHECK", SLOTS)]


def test_a_spell_above_what_the_class_can_prepare():
    text = sheet(spells=(("Fireball", "3", "", ""), ("Cone of Cold", "5", "", ""),
                         ("Wish", "9", "", "Scroll")))
    assert found(text) == [
        ("LOOK", f"{SPELLS} / Cone of Cold", "level 5; the highest Wizard 5 can prepare is level 3")]


def test_too_many_cantrips():
    five = tuple((f"Cantrip {i}", "Cantrip", "", "") for i in range(5))
    assert found(sheet(spells=five)) == [("LOOK", SPELLS, "5 cantrips; Wizard 5 allows 4")]
    one_from_a_feat = five[:4] + (("Guidance", "Cantrip", "", "Magic Initiate"),)
    assert found(sheet(spells=one_from_a_feat)) == []


def test_too_many_prepared_spells():
    ten = tuple((f"Spell {i}", "1", "", "") for i in range(10))
    assert found(sheet(spells=ten)) == [("LOOK", SPELLS, "10 spells of level 1 and up; Wizard 5 allows 9")]
    one_always = ten[:9] + (("Spell 9", "1", "C, Always prepared", ""),)
    assert found(sheet(spells=one_always)) == []
    assert found(sheet(spells=ten[:3])) == []     # fewer is not a slip


def test_a_note_with_no_source_column_says_so():
    five = tuple((f"Cantrip {i}", "Cantrip", "", "") for i in range(5))
    assert found(sheet(spells=five, source_column=False)) == [
        ("LOOK", SPELLS, "5 cantrips; Wizard 5 allows 4" + NO_SOURCE)]


def test_scores_over_twenty():
    assert found(sheet(scores={"INT": "22"})) == [
        ("LOOK", "Stat Sheet / Ability Scores / INT", "22; a score over 20 needs a reason beside it")]
    assert found(sheet(scores={"INT": "22 (tome of clear thought)"})) == []
    assert found(sheet(scores={"INT": "31"})) == [
        ("WRONG", "Stat Sheet / Ability Scores / INT", "31; a score cannot pass 30")]
    assert found(sheet(scores={"INT": "20"})) == []


def test_hit_points_outside_what_the_dice_allow():
    # Wizard 5, CON 14: least 6 + 4 + 10 = 20, most 30 + 10 = 40.
    assert found(sheet(hp_now="41", hp_max="41")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "41; the dice allow 20 to 40 for Wizard 5")]
    assert found(sheet(hp_now="19", hp_max="19")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "19; the dice allow 20 to 40 for Wizard 5")]
    assert found(sheet(hp_now="40", hp_max="40")) == []
    assert found(sheet(hp_now="41", hp_max="41 (boon)")) == []


def test_hit_point_additions_the_free_rules_name():
    assert found(sheet(species="Dwarf", hp_now="45", hp_max="45")) == []
    assert found(sheet(species="[[Mountain Dwarf]]", hp_now="45", hp_max="45")) == []
    assert found(sheet(species="Dwarf", hp_now="46", hp_max="46")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "46; the dice allow 25 to 45 for Wizard 5")]
    dragon = sheet(classes="Sorcerer 5 (Draconic Sorcery)", saves=("CON", "CHA"), hp_now="45", hp_max="45")
    assert found(dragon) == []


def test_a_low_constitution_never_drops_below_one_a_level():
    text = sheet(scores={"CON": "3"}, hp_now="5", hp_max="5")     # modifier -4
    assert found(text) == []


def test_the_classes_saving_throws():
    assert found(sheet(saves=("INT",))) == [
        ("LOOK", "Stat Sheet / Ability Scores", "Wizard 5 is proficient in INT and WIS; the note marks INT")]
    assert found(sheet(saves=())) == [
        ("LOOK", "Stat Sheet / Ability Scores", "Wizard 5 is proficient in INT and WIS; the note marks none")]
    assert found(sheet(saves=("INT", "WIS", "CON"))) == []
    two = sheet(classes="Fighter 2 (Champion) / Wizard 3 (Evoker)", saves=("INT", "WIS"),
                hp_now="30", hp_max="30", hit_dice=(("d10", "0/2"), ("d6", "0/3")),
                slots={1: ("4", "0"), 2: ("2", "0")})
    assert found(two) == []


def test_the_earlier_layout_alone_causes_no_finding():
    text = sheet(save_column=False, source_column=False, hit_dice=(("", "0/5"),),
                 old_items=("Ring", "Cloak"),
                 spells=(("Fire Bolt", "Cantrip", "", ""), ("Shield", "1", "", "")))
    assert found(text) == []


def test_an_unknown_class_skips_every_table_check():
    text = sheet(classes="Artificer 5 (Alchemist)", saves=(), hp_now="99", hp_max="99",
                 slots={1: ("9", "0")}, spells=(("Wish", "9", "", ""),))
    assert [r[0] for r in found(text)] == ["CANTCHECK"]
