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
    for raw in (None, "", "{Class (Subclass)}", "Level 16 Bard", "Bard 16, College of Echoes",
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
    assert found(sheet(classes="Tinker 5 (Gearwright)")) == [
        ("CANTCHECK", CLASS, "Tinker is not a class in the free rules, so the checks that need "
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
    assert found(sheet(classes="Tinker 5", hit_dice=(("", "0/4"),)), "WRONG") == [
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
    rows = found(sheet(classes="Tinker 5 (Gearwright)", items=four))
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
NO_SOURCE = ("; this note has no Source column, so a spell from a feat or item is counted "
             "unless its Tags name the source (`Item: …`)")


def test_slot_totals_against_the_table():
    assert found(sheet(slots={1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Wizard 5 gives 2")]
    assert found(sheet(slots={1: ("4", "0"), 2: ("3", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has (blank); Wizard 5 gives 2")]
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
    knight = sheet(classes="Fighter 5 (Spellblade)", saves=("STR", "CON"), hp_now="30", hp_max="30",
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
    assert found(sheet(species="[[Stone Dwarf]]", hp_now="45", hp_max="45")) == []
    assert found(sheet(species="Dwarf", hp_now="46", hp_max="46")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "46; the dice allow 25 to 45 for Wizard 5")]
    dragon = sheet(classes="Sorcerer 5 (Draconic Sorcery)", saves=("CON", "CHA"), hp_now="45", hp_max="45")
    assert found(dragon) == []


def test_a_low_constitution_never_drops_below_one_a_level():
    # modifier -4: Wizard 5 least is 6 - 4 = 2 for the first level, then 1 a level: 2 + 4 = 6.
    assert found(sheet(scores={"CON": "3"}, hp_now="6", hp_max="6")) == []
    assert found(sheet(scores={"CON": "3"}, hp_now="5", hp_max="5")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "5; the dice allow 6 to 10 for Wizard 5")]


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
    text = sheet(classes="Tinker 5 (Gearwright)", saves=(), hp_now="99", hp_max="99",
                 slots={1: ("9", "0")}, spells=(("Wish", "9", "", ""),))
    assert [r[0] for r in found(text)] == ["CANTCHECK"]


# --- fix round 1 ------------------------------------------------------

def cantrips(n):
    return tuple((f"Cantrip {i}", "Cantrip", "", "") for i in range(n))


def spells_of(level, n, start=0):
    return tuple((f"Spell {start + i}", str(level), "", "") for i in range(n))


CLERIC_1 = dict(level=1, classes="Cleric 1 (Life Domain)", saves=("WIS", "CHA"), hp_now="10", hp_max="10",
                hit_dice=(("d8", "0/1"),), slots={1: ("2", "0")})
DRUID_1 = dict(level=1, classes="Druid 1 (Land)", saves=("INT", "WIS"), hp_now="10", hp_max="10",
               hit_dice=(("d8", "0/1"),), slots={1: ("2", "0")})
PALADIN_2 = dict(level=2, classes="Paladin 2", saves=("WIS", "CHA"), hp_now="20", hp_max="20",
                 hit_dice=(("d10", "0/2"),), slots={1: ("2", "0")})
RANGER_2 = dict(level=2, classes="Ranger 2", saves=("STR", "DEX"), hp_now="20", hp_max="20",
                hit_dice=(("d10", "0/2"),), slots={1: ("2", "0")})
WARLOCK_1 = dict(level=1, classes="Warlock 1 (Fiend Patron)", saves=("WIS", "CHA"), hp_now="10", hp_max="10",
                 hit_dice=(("d8", "0/1"),), slots={1: ("1", "0")})


def test_cantrips_from_class_options_are_allowed():
    assert found(sheet(spells=cantrips(4), **CLERIC_1)) == []          # Thaumaturge: 3 + 1
    assert found(sheet(spells=cantrips(3), **DRUID_1)) == []           # Magician: 2 + 1
    assert found(sheet(spells=cantrips(2), **PALADIN_2)) == []         # Blessed Warrior
    assert found(sheet(spells=cantrips(2), **RANGER_2)) == []          # Druidic Warrior
    assert found(sheet(spells=cantrips(5), **WARLOCK_1)) == []         # Pact of the Tome: 2 + 3


def test_one_cantrip_over_the_option_allowance_is_a_look():
    assert found(sheet(spells=cantrips(5), **CLERIC_1)) == [
        ("LOOK", SPELLS, "5 cantrips; Cleric 1 allows 4")]
    assert found(sheet(spells=cantrips(3), **PALADIN_2)) == [
        ("LOOK", SPELLS, "3 cantrips; Paladin 2 allows 2")]
    assert found(sheet(spells=cantrips(6), **WARLOCK_1)) == [
        ("LOOK", SPELLS, "6 cantrips; Warlock 1 allows 5")]


def test_levels_that_do_not_add_up_leave_only_the_levels_row():
    text = sheet(classes="Wizard 4 (Evoker)", hit_dice=(("d6", "0/4"),), hp_now="99", hp_max="99",
                 slots={1: ("9", "0")}, spells=spells_of(9, 20))
    assert [(r[0], r[1]) for r in found(text)] == [("WRONG", CLASS)]


def test_slot_rows_labelled_level_n_are_read():
    wrong = {1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")}
    assert found(sheet(slots=wrong, slot_label="Level {n}")) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Wizard 5 gives 2")]
    assert found(sheet(slot_label="Level {n}")) == []
    assert found(sheet(slot_label="{n}")) == []


def test_half_casters_correct_characters_have_no_finding():
    paladin = sheet(level=5, classes="Paladin 5 (Oath of Devotion)", saves=("WIS", "CHA"),
                    hp_now="40", hp_max="40", hit_dice=(("d10", "0/5"),),
                    slots={1: ("4", "0"), 2: ("2", "0")}, spells=spells_of(1, 3) + spells_of(2, 3, 3))
    assert found(paladin) == []
    ranger = sheet(level=2, classes="Ranger 2", saves=("STR", "DEX"), hp_now="20", hp_max="20",
                   hit_dice=(("d10", "0/2"),), slots={1: ("2", "0")}, spells=spells_of(1, 3))
    assert found(ranger) == []


def test_a_warlock_11_with_a_mystic_arcanum_spell():
    base = dict(level=11, classes="Warlock 11 (Fiend Patron)", saves=("WIS", "CHA"), hp_now="60", hp_max="60",
                hit_dice=(("d8", "0/11"),), slots={5: ("3", "0")})
    twelve = spells_of(5, 11) + (("Arcanum", "6", "", ""),)
    assert found(sheet(spells=twelve, **base)) == []
    assert found(sheet(spells=twelve + (("Extra", "1", "", ""),), **base)) == [
        ("LOOK", SPELLS, "13 spells of level 1 and up; Warlock 11 allows 12")]


def test_two_casters_add_their_cantrip_allowances():
    base = dict(level=5, classes="Cleric 3 (Life Domain) / Wizard 2 (Evoker)", saves=("WIS", "CHA"),
                hp_now="30", hp_max="30", hit_dice=(("d8", "0/3"), ("d6", "0/2")),
                slots={1: ("4", "0"), 2: ("3", "0"), 3: ("2", "0")})
    assert found(sheet(spells=cantrips(7), **base)) == []      # 3 + 3 + Thaumaturge 1
    assert found(sheet(spells=cantrips(8), **base)) == [
        ("LOOK", SPELLS, "8 cantrips; Cleric 3 / Wizard 2 allows 7")]


# --- fix round 2 ------------------------------------------------------

def test_tags_name_an_items_spells_when_there_is_no_source_column():
    nine = spells_of(1, 9)
    wand = (("Fireball", "3", "Item: Wand of Fireballs", ""), ("Fireball ", "3", "Item: Wand of Fireballs", ""))
    assert found(sheet(spells=nine + wand, source_column=False)) == []
    staff = (("Cure Wounds", "1", "C, item: Staff of Healing", ""),)
    assert found(sheet(spells=nine + staff, source_column=False)) == []


def test_a_colon_in_tags_means_nothing_beside_a_source_column():
    ten = spells_of(1, 9) + (("Spell 9", "1", "Item: x", ""),)
    assert found(sheet(spells=ten)) == [("LOOK", SPELLS, "10 spells of level 1 and up; Wizard 5 allows 9")]


def test_a_repeated_spell_name_is_counted_once():
    nine = spells_of(1, 9)
    assert found(sheet(spells=nine + (("spell 3", "1", "", ""),))) == []
    assert found(sheet(spells=spells_of(1, 10) + (("Spell 3", "1", "", ""),))) == [
        ("LOOK", SPELLS, "10 spells of level 1 and up; Wizard 5 allows 9")]
    four = cantrips(4) + (("Cantrip 1", "Cantrip", "", ""),)
    assert found(sheet(spells=four)) == []
    high = (("Cone of Cold", "5", "", ""), ("Cone of Cold", "5", "", ""))
    assert [r[2] for r in found(sheet(spells=high))] == [
        "level 5; the highest Wizard 5 can prepare is level 3"]


# --- final fix wave ---------------------------------------------------

def warlock(level, **more):
    base = dict(level=level, classes=f"Warlock {level} (Fiend Patron)", saves=("WIS", "CHA"),
                hp_now="30", hp_max="30", hit_dice=(("d8", f"0/{level}"),), slots={})
    base.update(more)
    return base


BARD_5_WARLOCK_3 = dict(level=8, classes="Bard 5 (College of Lore) / Warlock 3 (Fiend Patron)",
                        saves=("DEX", "CHA"), hp_now="60", hp_max="60",
                        hit_dice=(("d8", "0/8"),), slots={1: ("4", "0"), 2: ("3", "0"), 3: ("2", "0")})


def test_a_pact_row_is_held_to_the_warlocks_own_slots():
    assert found(sheet(pact=("Pact (3rd)", "2", "0"), **warlock(5))) == []
    assert found(sheet(**warlock(5, slots={3: ("2", "0")}))) == []        # the merged form
    assert found(sheet(pact=("Pact (2nd)", "2", "0"), **BARD_5_WARLOCK_3)) == []
    for label in ("Pact 3rd", "Pact (Level 3)", "pact (3rd)"):
        assert found(sheet(pact=(label, "2", "0"), **warlock(5))) == [], label


def test_a_wrong_pact_row_is_a_look():
    assert found(sheet(pact=("Pact (3rd)", "3", "0"), **warlock(5))) == [
        ("LOOK", f"{SLOTS} / Pact (3rd)", "the note has 3 at level 3; Warlock 5 gives 2 at level 3")]
    assert found(sheet(pact=("Pact (2nd)", "2", "0"), **warlock(5))) == [
        ("LOOK", f"{SLOTS} / Pact (2nd)", "the note has 2 at level 2; Warlock 5 gives 2 at level 3")]
    assert found(sheet(pact=("Pact", "3", "0"), **warlock(5))) == [
        ("LOOK", f"{SLOTS} / Pact", "the note has 3; Warlock 5 gives 2 at level 3")]
    assert found(sheet(pact=("Pact", "2", "0"), **warlock(5))) == []


def test_a_pact_row_beside_wrong_numbered_rows():
    # A numbered row at the merged figure is wrong once a Pact row is there.
    slots = dict(BARD_5_WARLOCK_3, slots={1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")})
    assert found(sheet(pact=("Pact (2nd)", "2", "0"), **slots)) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Bard 5 / Warlock 3 gives 2")]


def test_a_pact_row_with_no_warlock_levels_is_a_look():
    assert found(sheet(pact=("Pact (3rd)", "2", "0"))) == [
        ("LOOK", f"{SLOTS} / Pact (3rd)", "a Pact row, but Wizard 5 has no Warlock levels")]


def test_a_pact_row_counts_as_slot_totals():
    assert found(sheet(**warlock(5))) == [
        ("LOOK", SLOTS, "no slot totals in the note; Warlock 5 has slots")]
    assert found(sheet(pact=("Pact (3rd)", "2", "0"), **warlock(5))) == []
    four = dict(BARD_5_WARLOCK_3, slots={})
    assert found(sheet(pact=("Pact (2nd)", "2", "0"), **four)) == [
        ("LOOK", f"{SLOTS} / 1st", "the note has (blank); Bard 5 / Warlock 3 gives 4"),
        ("LOOK", f"{SLOTS} / 2nd", "the note has (blank); Bard 5 / Warlock 3 gives 3"),
        ("LOOK", f"{SLOTS} / 3rd", "the note has (blank); Bard 5 / Warlock 3 gives 2")]


def test_a_pact_row_cannot_spend_more_than_it_has():
    assert found(sheet(pact=("Pact (3rd)", "2", "3"), **warlock(5))) == [
        ("WRONG", f"{SLOTS} / Pact (3rd)", "3 expended of 2")]


def test_the_oriel_thackeray_fixture_has_no_slot_look():
    path = ROOT / "tools" / "publish" / "test" / "fixtures" / "with-dnd-pc" / "Characters" / "PCs" / "Oriel_Thackeray.md"
    rows = [r for r in found(path.read_text(encoding="utf-8")) if r[1].startswith(SLOTS)]
    assert rows == []


# --- level-20 class scores --------------------------------------------

def test_a_level_20_barbarian_or_monk_may_reach_25():
    barb = dict(level=20, classes="Barbarian 20 (Path of the Berserker)", saves=("STR", "CON"),
                hp_now="250", hp_max="250", hit_dice=(("d12", "0/20"),), slots={})
    assert found(sheet(scores={"STR": "25", "CON": "25"}, **barb), "LOOK") == []
    assert found(sheet(scores={"STR": "26"}, **barb), "LOOK") == [
        ("LOOK", "Stat Sheet / Ability Scores / STR", "26; a score over 20 needs a reason beside it")]
    assert found(sheet(scores={"INT": "24"}, **barb), "LOOK") == [
        ("LOOK", "Stat Sheet / Ability Scores / INT", "24; a score over 20 needs a reason beside it")]
    monk = dict(level=20, classes="Monk 20 (Warrior of the Open Hand)", saves=("STR", "DEX"),
                hp_now="150", hp_max="150", hit_dice=(("d8", "0/20"),), slots={})
    assert found(sheet(scores={"DEX": "25", "WIS": "25"}, **monk), "LOOK") == []
    assert found(sheet(scores={"STR": "22"}, **monk), "LOOK") == [
        ("LOOK", "Stat Sheet / Ability Scores / STR", "22; a score over 20 needs a reason beside it")]
    low = dict(barb, level=19, classes="Barbarian 19 (Path of the Berserker)", hit_dice=(("d12", "0/19"),))
    assert [r[1] for r in found(sheet(scores={"STR": "22"}, **low), "LOOK")] == [
        "Stat Sheet / Ability Scores / STR"]
    mixed = dict(level=20, classes="Barbarian 19 (Path of the Berserker) / Wizard 1", saves=("STR", "CON"),
                 hp_now="200", hp_max="200", hit_dice=(("d12", "0/19"), ("d6", "0/1")), slots={1: ("2", "0")})
    assert [r[1] for r in found(sheet(scores={"STR": "22"}, **mixed), "LOOK")] == [
        "Stat Sheet / Ability Scores / STR"]


def test_the_level_20_cap_needs_every_class_known():
    odd = dict(level=20, classes="Tinker 20", saves=(), hit_dice=(("", "0/20"),), slots={})
    assert [r[1] for r in found(sheet(scores={"STR": "22"}, **odd), "LOOK")] == [
        "Stat Sheet / Ability Scores / STR"]


# --- the shapes the page reads ----------------------------------------

def test_max_and_used_headers_are_read_like_total_and_expended():
    heads = ("Max", "Used")
    assert found(sheet(slot_headers=heads)) == []
    assert found(sheet(slot_headers=heads, slots={1: ("4", "0"), 2: ("3", "0"), 3: ("3", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Wizard 5 gives 2")]
    assert found(sheet(slot_headers=heads, slots={1: ("4", "5"), 2: ("3", "0"), 3: ("2", "0")})) == [
        ("WRONG", f"{SLOTS} / 1st", "5 expended of 4")]


def test_spell_levels_written_1st_or_cantrips_are_read():
    ten = tuple((f"Spell {i}", "1st", "", "") for i in range(10))
    assert found(sheet(spells=ten)) == [("LOOK", SPELLS, "10 spells of level 1 and up; Wizard 5 allows 9")]
    assert found(sheet(spells=ten[:9])) == []
    five = tuple((f"Cantrip {i}", "Cantrips", "", "") for i in range(5))
    assert found(sheet(spells=five)) == [("LOOK", SPELLS, "5 cantrips; Wizard 5 allows 4")]
    assert found(sheet(spells=five[:4])) == []
    assert found(sheet(spells=(("Cone of Cold", "5th", "", ""),))) == [
        ("LOOK", f"{SPELLS} / Cone of Cold", "level 5; the highest Wizard 5 can prepare is level 3")]


def test_a_bold_or_italic_number_is_read_as_its_number():
    good = sheet(hp_now="**22**", hp_max="*22*", death="**0/0**",
                 hit_dice=(("d6", "**0/5**"),), slots={1: ("**4**", "*0*"), 2: ("3", "0"), 3: ("2", "0")},
                 scores={"INT": "**16**"})
    assert found(good) == []
    assert found(sheet(hp_now="**41**", hp_max="**41**")) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "41; the dice allow 20 to 40 for Wizard 5")]
    assert found(sheet(hit_dice=(("d6", "**0/4**"),))) == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice d6", "the note has 4; Wizard 5 gives 5")]
    assert found(sheet(slots={1: ("**4**", "*5*"), 2: ("3", "0"), 3: ("2", "0")})) == [
        ("WRONG", f"{SLOTS} / 1st", "5 expended of 4")]
    assert found(sheet(slots={1: ("**4**", "0"), 2: ("3", "0"), 3: ("**3**", "0")})) == [
        ("LOOK", f"{SLOTS} / 3rd", "the note has 3; Wizard 5 gives 2")]
    assert found(sheet(scores={"INT": "**22**"})) == [
        ("LOOK", "Stat Sheet / Ability Scores / INT", "22; a score over 20 needs a reason beside it")]
    assert found(sheet(death="**4/0**")) == [
        ("WRONG", "Stat Sheet / Combat / Death Saves (S/F)", "4/0; a count cannot pass 3")]


# --- hit dice rows, class names, wording ------------------------------

def test_two_hit_dice_rows_with_one_die_are_added_together():
    base = dict(level=5, classes="Bard 3 (College of Lore) / Warlock 2 (Fiend Patron)", saves=("DEX", "CHA"),
                hp_now="30", hp_max="30", slots={1: ("4", "0"), 2: ("2", "0")})
    assert found(sheet(hit_dice=(("d8", "0/3"), ("d8", "0/2")), **base), "WRONG") == []
    assert found(sheet(hit_dice=(("d8", "0/3"), ("d8", "0/1")), **base), "WRONG") == [
        ("WRONG", "Stat Sheet / Combat / Hit Dice d8", "the note has 4; Bard 3 / Warlock 2 gives 5")]
    over = found(sheet(hit_dice=(("d8", "4/3"), ("d8", "0/2")), **base), "WRONG")
    assert over == [("WRONG", "Stat Sheet / Combat / Hit Dice d8", "4 spent of 3")]


def test_a_bold_class_name_is_read():
    assert [(c.name, c.level, c.subclass) for c in dr.read_classes("**Wizard** 5 (Evoker)", 5)] == [
        ("Wizard", 5, "Evoker")]
    assert [(c.name, c.level) for c in dr.read_classes("*Wizard* 5", 5)] == [("Wizard", 5)]
    assert [(c.name, c.level) for c in dr.read_classes("**Fighter** 3 / _Wizard_ 2", 5)] == [
        ("Fighter", 3), ("Wizard", 2)]


def test_hit_points_with_one_possible_figure():
    # Wizard 1, CON 14: 6 + 2 = 8 and no other figure.
    one = dict(level=1, classes="Wizard 1", hit_dice=(("d6", "0/1"),), slots={1: ("2", "0")})
    assert found(sheet(hp_now="9", hp_max="9", **one)) == [
        ("LOOK", "Stat Sheet / Combat / HP (Max)", "9; the dice allow exactly 8 for Wizard 1")]


def test_a_spent_header_is_read_like_expended():
    heads = ("Max", "Spent")
    assert found(sheet(slot_headers=heads)) == []
    assert found(sheet(slot_headers=heads, slots={1: ("4", "5"), 2: ("3", "0"), 3: ("2", "0")})) == [
        ("WRONG", f"{SLOTS} / 1st", "5 expended of 4")]
