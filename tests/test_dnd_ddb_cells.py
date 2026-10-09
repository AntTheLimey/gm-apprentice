#!/usr/bin/env python3
"""Tests for dnd_ddb.py: a D&D note's single cells and labelled lines brought up to date."""

import dataclasses
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_builder  # noqa: E402
import dnd_rules  # noqa: E402
from ddb_builder import character  # noqa: E402
from dnd_ddb import Edit, plan_cells, split_entries, write_edits  # noqa: E402
from dnd_ddb_read import read  # noqa: E402

TEMPLATE = (ROOT / "skills" / "shared" / "templates" / "pc-dnd-5e-2024.md").read_text(encoding="utf-8")


def got(**kw):
    return read(character(**kw))


def edits(text, c=None, seen=None):
    return {e.locus: e for e in plan_cells(text, c or got(), seen)}


def one(text, locus, c=None, seen=None):
    return edits(text, c, seen)[locus]


def written(text, c=None):
    return write_edits(text, plan_cells(text, c or got()))


def swap(text, old, new):
    assert old in text
    return text.replace(old, new, 1)


# --- numbers --------------------------------------------------------------

def test_level_five_to_six():
    text = dnd_builder.sheet(level=5)
    c = got(classes=(("Wizard", 6, "Evoker", 4),))
    e = one(text, "Stat Sheet / Core / Level", c)
    assert (e.status, e.message) == ("WRITE", "5 -> 6")
    assert "| Level | 6 |" in write_edits(text, [e])


def test_level_the_same_is_same():
    e = one(dnd_builder.sheet(level=5), "Stat Sheet / Core / Level")
    assert (e.status, e.message) == ("SAME", "5")


def test_signed_and_plain_numbers_are_the_same():
    text = swap(TEMPLATE, "| Level | 1 |", "| Level | +5 |")
    assert one(text, "Stat Sheet / Core / Level").status == "SAME"


def test_xp_written_and_a_comma_number_read():
    text = swap(TEMPLATE, "| XP | 0 |", "| XP | 6,500 |")
    assert one(text, "Stat Sheet / Core / XP").status == "SAME"
    e = one(TEMPLATE, "Stat Sheet / Core / XP")
    assert (e.status, e.message) == ("WRITE", "0 -> 6500")
    assert "| XP | 6500 |" in write_edits(TEMPLATE, [e])


def test_blank_and_placeholder_are_written():
    text = swap(TEMPLATE, "| Level | 1 |", "| Level |  |")
    assert one(text, "Stat Sheet / Core / Level").message == "(blank) -> 5"
    text = swap(TEMPLATE, "| Level | 1 |", "| Level | {level} |")
    e = one(text, "Stat Sheet / Core / Level")
    assert (e.status, e.message) == ("WRITE", "(blank) -> 5")


def test_a_score_with_a_reason_is_kept():
    text = swap(TEMPLATE, "| INT | 10 | +0 |", "| INT | 18 (tome) | +0 |")
    e = one(text, "Stat Sheet / Ability Scores / INT / Score")
    assert (e.status, e.message) == ("KEPT", "18 (tome); D&D Beyond gives 16")
    assert "18 (tome)" in written(text)


def test_scores_written_for_all_six():
    c = got()
    es = edits(TEMPLATE, c)
    for key, value in c.scores.items():
        e = es[f"Stat Sheet / Ability Scores / {key} / Score"]
        assert (e.status, e.new) == (("SAME", "") if value == 10 else ("WRITE", str(value)))
    out = written(TEMPLATE, c)
    assert "| INT | 16 | +0 |" in out and "| STR | 8 | +0 |" in out


def test_save_proficiency_yes_no():
    c = got(modifiers=(("class", "proficiency", "intelligence-saving-throws", None),))
    es = edits(TEMPLATE, c)
    assert es["Stat Sheet / Ability Scores / INT / Save Proficiency"].new == "Yes"
    assert es["Stat Sheet / Ability Scores / STR / Save Proficiency"].status == "SAME"
    assert "| INT | 16 | +0 | Yes | +0 |" in written(TEMPLATE, c)


def test_save_proficiency_cell_with_another_spelling_of_yes_is_same():
    text = swap(TEMPLATE, "| INT | 10 | +0 | No |", "| INT | 10 | +0 | yes |")
    c = got(modifiers=(("class", "proficiency", "intelligence-saving-throws", None),))
    assert one(text, "Stat Sheet / Ability Scores / INT / Save Proficiency", c).status == "SAME"


def test_an_old_table_with_no_save_proficiency_column_is_skipped():
    es = edits(dnd_builder.sheet(save_column=False))
    assert not [k for k in es if "Save Proficiency" in k]
    assert "Stat Sheet / Ability Scores / STR / Score" in es


# --- combat -----------------------------------------------------------------

def test_size_written():
    text = swap(TEMPLATE, "| Size | Medium |", "| Size | {size} |")
    c = got(size="Small")
    assert "| Size | Small |" in written(text, c)
    assert one(TEMPLATE, "Stat Sheet / Combat / Size").status == "SAME"


SPEED = "Stat Sheet / Combat / Speed"


def speed_cell(text):
    return swap(TEMPLATE, "| Speed | 30 ft |", f"| Speed | {text} |")


def test_a_blank_speed_and_a_placeholder_are_written():
    c = got(speed=35)
    e = one(speed_cell(""), SPEED, c)
    assert (e.status, e.message) == ("WRITE", "(blank) -> 35 ft")
    assert "| Speed | 35 ft |" in write_edits(speed_cell(""), [e])
    assert one(speed_cell("{speed}"), SPEED, c).status == "WRITE"


def test_a_bare_speed_is_written_when_it_differs_and_same_when_equal():
    slow = got(speed=20)
    for bare in ("30 ft", "30", "30 feet", "30 ft.", "30ft"):
        e = one(speed_cell(bare), SPEED, slow)
        assert (e.status, e.message) == ("WRITE", f"{bare} -> 20 ft"), bare
        assert "| Speed | 20 ft |" in written(speed_cell(bare), slow)
        same = one(speed_cell(bare), SPEED, got(speed=30))
        assert (same.status, same.message) == ("SAME", bare), bare
        assert f"| Speed | {bare} |" in written(speed_cell(bare), got(speed=30))  # not respelled


def test_the_templates_own_speed_is_written_over():
    e = one(TEMPLATE, SPEED, got(speed=20))
    assert (e.status, e.message) == ("WRITE", "30 ft -> 20 ft")


def test_a_speed_with_a_reason_is_kept():
    text = speed_cell("40 ft (boots of striding)")
    e = one(text, SPEED, got(speed=30))
    assert (e.status, e.message) == ("KEPT", "40 ft (boots of striding); D&D Beyond gives 30 ft")
    assert "| Speed | 40 ft (boots of striding) |" in written(text, got(speed=30))
    assert one(speed_cell("40 (boots)"), SPEED, got(speed=30)).status == "KEPT"


def test_a_speed_that_is_not_one_speed_is_left_alone_and_unreported():
    for odd in ("30 ft, fly 60 ft", "30 ft, fly 60 ft (hover)", "walk 30", "fast", "30 ft / 40 ft", "(x)",
                "30 ft (a), fly 60 ft (b)", "30 ft (a) (b)", "30 ft (boots) more"):
        text = speed_cell(odd)
        assert SPEED not in edits(text, got(speed=20)), odd
        assert f"| Speed | {odd} |" in written(text, got(speed=20)), odd


def test_an_extra_speed_row_is_never_touched():
    text = swap(TEMPLATE, "| Speed | 30 ft |", "| Speed | 30 ft |\n| Fly Speed | 60 ft |\n| Swim Speed | |")
    after = written(text, got(speed=20))
    assert "| Speed | 20 ft |\n| Fly Speed | 60 ft |\n| Swim Speed | |" in after
    assert not [locus for locus in edits(text, got(speed=20)) if "Fly" in locus or "Swim" in locus]


def test_a_character_whose_data_gives_no_walking_speed_leaves_the_cell_alone():
    assert SPEED not in edits(TEMPLATE, got(speed=0))
    assert SPEED not in edits(speed_cell(""), got(speed=0))


def test_hit_dice_keeps_spent_and_replaces_max():
    text = dnd_builder.sheet(hit_dice=(("", "2/5"),))
    c = got(classes=(("Wizard", 6, "Evoker", 4),))
    e = one(text, "Stat Sheet / Combat / Hit Dice", c)
    assert (e.status, e.message) == ("WRITE", "2/5 -> 2/6")
    assert "| Hit Dice (Spent/Max) | 2/6 |" in write_edits(text, [e])
    assert one(text, "Stat Sheet / Combat / Hit Dice").status == "SAME"


def test_hit_dice_not_shaped_n_over_n_is_kept():
    text = swap(TEMPLATE, "| Hit Dice (Spent/Max) | 0/1 |", "| Hit Dice (Spent/Max) | all |")
    e = one(text, "Stat Sheet / Combat / Hit Dice")
    assert e.status == "KEPT" and e.message.startswith("all;")


def test_hit_dice_split_by_die_is_kept_as_one_row():
    text = dnd_builder.sheet(hit_dice=(("d6", "0/3"), ("d8", "1/2")))
    es = [e for e in plan_cells(text, got()) if e.locus == "Stat Sheet / Combat / Hit Dice"]
    assert [(e.status, e.message) for e in es] == [("KEPT", "hit dice are split by die; check them")]


def test_one_die_row_for_a_multiclass_character_is_kept():
    text = dnd_builder.sheet(hit_dice=(("d6", "0/5"),))
    c = got(classes=(("Wizard", 3, "", 4), ("Fighter", 3, "", None)))
    assert one(text, "Stat Sheet / Combat / Hit Dice", c).status == "KEPT"


# --- skills -------------------------------------------------------------------

def test_skill_rows():
    c = got(modifiers=(("class", "proficiency", "arcana", None), ("class", "expertise", "arcana", None),
                       ("class", "proficiency", "history", None),
                       ("class", "half-proficiency", "nature", None)))
    es = edits(TEMPLATE, c)
    assert (es["Skills / Arcana / Proficient"].new, es["Skills / Arcana / Expertise"].new) == ("Yes", "Yes")
    assert es["Skills / History / Proficient"].new == "Yes" and es["Skills / History / Expertise"].status == "SAME"
    assert es["Skills / Nature / Proficient"].new == "Half" and es["Skills / Nature / Expertise"].status == "SAME"
    assert (es["Skills / Stealth / Proficient"].status, es["Skills / Stealth / Expertise"].status) == ("SAME", "SAME")
    out = written(TEMPLATE, c)
    assert "| Arcana | INT | Yes | Yes | +0 |" in out
    assert "| Nature | INT | Half | No | +0 |" in out


def test_skill_row_with_no_entry_is_no_no():
    text = dnd_builder.sheet(skills=(("Stealth", "DEX", "Yes", "Yes"),))
    es = edits(text)
    assert es["Skills / Stealth / Proficient"].message == "Yes -> No"
    assert write_edits(text, plan_cells(text, got())).count("| Stealth | DEX | No | No | |") == 1


def test_skill_cell_with_a_reason_is_kept():
    text = swap(TEMPLATE, "| Arcana | INT | No |", "| Arcana | INT | Yes (boon) |")
    c = got(modifiers=(("class", "proficiency", "arcana", None),))
    e = one(text, "Skills / Arcana / Proficient", c)
    assert (e.status, e.message) == ("KEPT", "Yes (boon); D&D Beyond gives Yes")


# --- spellcasting -------------------------------------------------------------

def test_spellcasting_ability_blank_is_filled():
    text = swap(TEMPLATE, "| Spellcasting Ability | |", "| Spellcasting Ability |  |")
    c = got()
    e = one(text, "Spellcasting / Spellcasting Ability", c)
    assert (e.status, e.message) == ("WRITE", "(blank) -> INT")
    assert "| Spellcasting Ability | INT |" in write_edits(text, [e])


def test_spellcasting_ability_written_name_is_same():
    text = dnd_builder.sheet()
    assert one(text, "Spellcasting / Spellcasting Ability").status == "SAME"
    text = text.replace("| Spellcasting Ability | INT |", "| Spellcasting Ability | Intelligence |")
    assert one(text, "Spellcasting / Spellcasting Ability").status == "SAME"


MULTI = (("Wizard", 3, "", 4), ("Cleric", 2, "", 5))


def test_two_casting_classes_labelled_rows_each_get_their_own():
    text = swap(TEMPLATE, "| Spellcasting Ability | |",
                "| Spellcasting Ability (Wizard) | |\n| Spellcasting Ability (Cleric) | |")
    es = edits(text, got(classes=MULTI))
    assert es["Spellcasting / Spellcasting Ability (Wizard)"].new == "INT"
    assert es["Spellcasting / Spellcasting Ability (Cleric)"].new == "WIS"
    out = written(text, got(classes=MULTI))
    assert "| Spellcasting Ability (Cleric) | WIS |" in out


def test_two_casting_classes_unlabelled_row_is_a_check_for_the_gm():
    e = one(TEMPLATE, "Spellcasting / Spellcasting Ability", got(classes=MULTI))
    assert e.status == "CHECK" and "several casting classes" in e.message


def test_none_and_na_on_a_list_line_are_the_dash():
    text = swap(TEMPLATE, "**Immunities:** {list}", "**Immunities:** Poison, None, N/A")
    c = got(modifiers=(("class", "immunity", "poison", None),))
    e = one(text, "Stat Sheet / Defences / Immunities", c)
    assert (e.status, e.new) == ("WRITE", "**Immunities:** Poison")
    for word in ("None", "none", "N/A", "n/a"):
        bare = swap(TEMPLATE, "**Immunities:** {list}", f"**Immunities:** {word}")
        assert one(bare, "Stat Sheet / Defences / Immunities", c).new == "**Immunities:** Poison"
    assert one(swap(TEMPLATE, "**Immunities:** {list}", "**Immunities:** None"), "Stat Sheet / Defences / Immunities").status == "WRITE"


def test_a_non_caster_has_no_spellcasting_edit():
    c = got(classes=(("Fighter", 5, "", None),))
    assert "Spellcasting / Spellcasting Ability" not in edits(TEMPLATE, c)


# --- labelled lines -----------------------------------------------------------

def test_background_lines_written_from_placeholders():
    c = got(species="Dwarf", background="Soldier", alignment_id=2)
    es = edits(TEMPLATE, c)
    assert es["Background / Species"].message == "(blank) -> Dwarf"
    out = written(TEMPLATE, c)
    for line in ("**Species:** Dwarf", "**Background:** Soldier", "**Alignment:** Neutral Good"):
        assert line + "\n" in out


def test_bare_species_is_replaced_when_different_and_same_when_equal():
    text = swap(TEMPLATE, "**Species:** {Species name}", "**Species:** elf")
    e = one(text, "Background / Species", got(species="Elf"))
    assert e.status == "SAME"
    e = one(text, "Background / Species", got(species="Dwarf"))
    assert (e.status, e.message) == ("WRITE", "elf -> Dwarf")


def test_line_with_a_reason_is_kept():
    text = swap(TEMPLATE, "**Species:** {Species name}", "**Species:** Elf (wood elf)")
    e = one(text, "Background / Species", got(species="Dwarf"))
    assert (e.status, e.message) == ("KEPT", "Elf (wood elf); D&D Beyond gives Dwarf")
    assert "**Species:** Elf (wood elf)\n" in written(text, got(species="Dwarf"))


def test_class_subclass_line_for_two_classes_round_trips_through_the_reader():
    c = got(classes=(("Paladin", 5, "Oath of Devotion", 6), ("Sorcerer", 3, "", 6)))
    e = one(TEMPLATE, "Background / Class/Subclass", c)
    assert e.status == "WRITE"
    assert e.new == "**Class/Subclass:** Paladin 5 (Oath of Devotion) / Sorcerer 3"
    out = write_edits(TEMPLATE, [e])
    line = next(x for x in out.splitlines() if x.startswith("**Class/Subclass:**"))
    back = dnd_rules.read_classes(line.split(":**", 1)[1].strip(), c.level)
    assert back is not None
    assert [(x.name, x.level, x.subclass) for x in back] == [
        ("Paladin", 5, "Oath of Devotion"), ("Sorcerer", 3, "")]


def test_class_line_that_says_the_same_in_another_shape_is_same():
    text = swap(TEMPLATE, "**Class/Subclass:** {Class (Subclass)}", "**Class/Subclass:** Wizard (Evoker)")
    assert one(text, "Background / Class/Subclass").status == "SAME"
    text = swap(TEMPLATE, "**Class/Subclass:** {Class (Subclass)}", "**Class/Subclass:** Wizard 5 (Evoker)")
    assert one(text, "Background / Class/Subclass").status == "SAME"


def test_class_line_that_differs_is_written_and_one_with_a_reason_kept():
    text = swap(TEMPLATE, "**Class/Subclass:** {Class (Subclass)}", "**Class/Subclass:** Wizard 4 (Evoker)")
    e = one(text, "Background / Class/Subclass")
    assert (e.status, e.message) == ("WRITE", "Wizard 4 (Evoker) -> Wizard 5 (Evoker)")
    text = swap(TEMPLATE, "**Class/Subclass:** {Class (Subclass)}",
                "**Class/Subclass:** Wizard 5 (Evoker) (homebrew)")
    assert one(text, "Background / Class/Subclass").status == "KEPT"


def test_line_the_note_lacks_is_a_check_and_writes_nothing():
    text = swap(TEMPLATE, "**Alignment:** {Alignment}\n\n", "")
    e = one(text, "Background / Alignment")
    assert e.status == "CHECK" and "no **Alignment:** line under Background" in e.message and e.line == -1


def test_a_line_of_the_same_name_under_gm_notes_is_never_written():
    text = swap(TEMPLATE, "**Immunities:** {list}\n\n", "")
    text = swap(text, "**Languages:** {list}\n\n", "")
    text = swap(text, "**Species:** {Species name}\n\n", "")
    text = text.rstrip("\n") + ("\n**Immunities:** the players think none\n**Languages:** speaks Infernal in his sleep"
                               "\n**Species:** a changeling, really\n")
    c = got(modifiers=(("class", "immunity", "poison", None),), species="Human")
    found = edits(text, c)
    assert found["Stat Sheet / Defences / Immunities"].status == "CHECK"
    assert found["Background / Species"].status == "CHECK"
    assert not [e for e in found.values() if e.status == "WRITE" and e.locus in ("Stat Sheet / Defences / Immunities", "Background / Species")]
    after = write_edits(text, list(found.values()))
    assert after.endswith("**Species:** a changeling, really\n") and "speaks Infernal in his sleep\n" in after
    assert "the players think none\n" in after


def test_a_line_under_the_wrong_heading_is_not_the_line():
    text = swap(TEMPLATE, "**Alignment:** {Alignment}\n\n", "")
    text = swap(text, "## Current Status\n", "## Current Status\n\n**Alignment:** Chaotic Good\n")
    assert one(text, "Background / Alignment", got(alignment_id=2)).status == "CHECK"


def test_an_unset_alignment_writes_nothing():
    c = got(alignment_id=None)
    assert "Background / Alignment" not in edits(TEMPLATE, c)


def test_defence_lines():
    c = got(modifiers=(("race", "resistance", "fire", None), ("class", "immunity", "poison", None)))
    es = edits(TEMPLATE, c)
    assert es["Stat Sheet / Defences / Resistances"].message == "(blank) -> Fire"
    assert es["Stat Sheet / Defences / Immunities"].new == "**Immunities:** Poison"
    assert es["Stat Sheet / Defences / Vulnerabilities"].new == "**Vulnerabilities:** —"
    assert es["Stat Sheet / Defences / Condition Immunities"].new == "**Condition Immunities:** —"
    assert "**Advantages:** {list}" in written(TEMPLATE, c)


def test_an_entry_the_gm_added_stays_in_the_line_after_the_new_names():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Fire, Cold (ring of warmth)")
    c = got(modifiers=(("race", "resistance", "poison", None),))
    e = one(text, "Stat Sheet / Defences / Resistances", c)
    assert e.status == "WRITE"
    assert e.message == "Fire, Cold (ring of warmth) -> Poison, Fire, Cold (ring of warmth)"
    assert "**Resistances:** Poison, Fire, Cold (ring of warmth)\n" in write_edits(text, [e])


def test_a_remembered_entry_is_dropped_from_the_line_and_the_gms_own_stays():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Fire, Cold (ring of warmth), Radiant")
    c = got(modifiers=(("race", "resistance", "poison", None),))
    e = one(text, "Stat Sheet / Defences / Resistances", c, {"resistances": ["fire"]})
    assert e.new == "**Resistances:** Poison, Cold (ring of warmth), Radiant"
    assert one(text, "Stat Sheet / Defences / Resistances", c, {"immunities": ["fire"]}).new == \
        "**Resistances:** Poison, Fire, Cold (ring of warmth), Radiant"


def test_a_list_line_is_same_when_the_result_equals_the_old():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Poison, Cold (ring of warmth)")
    c = got(modifiers=(("race", "resistance", "poison", None),))
    assert one(text, "Stat Sheet / Defences / Resistances", c).status == "SAME"


def test_commas_inside_brackets_do_not_split_an_entry():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Cold (ring, worn), Fire")
    c = got(modifiers=(("race", "resistance", "poison", None),))
    e = one(text, "Stat Sheet / Defences / Resistances", c, {"resistances": ["fire"]})
    assert e.new == "**Resistances:** Poison, Cold (ring, worn)"


def test_an_entry_is_d_and_d_beyonds_only_by_its_whole_name():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Fire (ring)")
    c = got(modifiers=(("race", "resistance", "fire", None),))
    e = one(text, "Stat Sheet / Defences / Resistances", c)
    assert e.new == "**Resistances:** Fire, Fire (ring)"
    assert one(swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** fire"),
               "Stat Sheet / Defences / Resistances", c).new == "**Resistances:** Fire"


def test_all_gone_gives_a_dash_and_a_dash_is_not_an_entry():
    text = swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** Fire")
    e = one(text, "Stat Sheet / Defences / Resistances", seen={"resistances": ["fire"]})
    assert e.new == "**Resistances:** —"
    assert one(swap(TEMPLATE, "**Resistances:** {list}", "**Resistances:** —"),
               "Stat Sheet / Defences / Resistances").status == "SAME"


def test_proficiency_lines():
    c = got(modifiers=(
        ("class", "proficiency", "light-armor", None),
        ("class", "proficiency", "simple-weapons", None),
        ("background", "proficiency", "thieves-tools", None, {"friendlySubtypeName": "Thieves' Tools"}),
        ("race", "language", "common", None)))
    es = edits(TEMPLATE, c)
    assert es["Proficiencies / Armor Training"].new == "**Armor Training:** Light Armor"
    assert es["Proficiencies / Weapons"].new.startswith("**Weapons:** ")
    assert es["Proficiencies / Tools"].new == "**Tools:** Thieves' Tools"
    assert es["Proficiencies / Languages"].new == "**Languages:** Common"
    assert "Proficiencies / Weapon Mastery" not in es
    assert "**Weapon Mastery:** {list}" in written(TEMPLATE, c)


# --- a name with a comma on a labelled line ---------------------------------------------

WEAPON = 1782728300


def proficient_with(*names, kind=WEAPON):
    return got(modifiers=tuple(("class", "proficiency", f"made-up-{n}", None, {"friendlySubtypeName": name, "entityTypeId": kind})
                               for n, name in enumerate(names)))


def weapons_line(text, c, seen=None):
    return one(text, "Proficiencies / Weapons", c, seen)


def test_a_name_of_two_parts_is_written_the_other_way_round_with_no_comma():
    c = proficient_with("Crossbow, Light", "Crossbow, Hand", "Dagger")
    assert weapons_line(TEMPLATE, c).new == "**Weapons:** Light Crossbow, Hand Crossbow, Dagger"


def test_a_name_with_more_commas_has_each_replaced_by_a_space():
    c = proficient_with("Blade, Curved, Long", "Sling,", ",Net")
    assert weapons_line(TEMPLATE, c).new == "**Weapons:** Blade Curved Long, Sling, Net"


def test_a_comma_inside_brackets_goes_too_and_the_name_is_not_turned_round():
    c = got(modifiers=(("race", "resistance", "fire", None, {"restriction": "in sunlight, by day"}),))
    assert one(TEMPLATE, "Stat Sheet / Defences / Resistances", c).new == "**Resistances:** Fire (in sunlight by day)"


def test_a_line_already_holding_the_written_form_is_same():
    c = proficient_with("Crossbow, Light", "Dagger")
    text = written(TEMPLATE, c)
    assert "**Weapons:** Light Crossbow, Dagger\n" in text
    assert weapons_line(text, c).status == "SAME"
    assert written(written(text, c), c) == text


def test_a_hand_written_light_crossbow_is_d_and_d_beyonds_crossbow_light():
    text = swap(TEMPLATE, "**Weapons:** {list}", "**Weapons:** Dagger, light crossbow")
    e = weapons_line(text, proficient_with("Crossbow, Light", "Dagger"))
    assert e.new == "**Weapons:** Light Crossbow, Dagger"
    same = swap(TEMPLATE, "**Weapons:** {list}", "**Weapons:** Light Crossbow, Dagger")
    assert weapons_line(same, proficient_with("Crossbow, Light", "Dagger")).status == "SAME"


def test_the_memory_drops_the_written_form_when_d_and_d_beyond_no_longer_gives_it():
    text = swap(TEMPLATE, "**Weapons:** {list}", "**Weapons:** Light Crossbow, Dagger, Whip")
    e = weapons_line(text, proficient_with("Dagger"), {"weapons": ["light crossbow", "dagger"]})
    assert e.new == "**Weapons:** Dagger, Whip"


def test_two_names_that_come_to_one_written_form_are_one_entry():
    c = proficient_with("Crossbow, Light", "Light Crossbow")
    assert weapons_line(TEMPLATE, c).new == "**Weapons:** Light Crossbow"


def test_a_bracket_that_never_closes_protects_no_comma_so_the_entries_after_it_are_still_entries():
    """A defence's condition cut at 80 characters loses its closing bracket."""
    long = "while standing in the long shadow of a very tall tower at dusk or at dawn or at noon"
    c = got(modifiers=(("race", "resistance", "fire", None, {"restriction": long}), ("race", "resistance", "cold", None)))
    text = written(TEMPLATE, c)
    line = next(ln for ln in text.splitlines() if ln.startswith("**Resistances:**"))
    assert line.endswith(", Cold") and line.count("(") == 1 and ")" not in line
    assert one(text, "Stat Sheet / Defences / Resistances", c).status == "SAME"
    assert split_entries("Fire (a, b), Cold (c, Acid, Bolt (d, e)") == ["Fire (a, b)", "Cold (c", "Acid", "Bolt (d, e)"]
    assert split_entries("a ) b, c") == ["a ) b", "c"]


def test_the_other_labelled_lines_follow_the_same_rule():
    c = got(modifiers=(("class", "proficiency", "x", None, {"friendlySubtypeName": "Armor, Light", "entityTypeId": 174869515}),
                       ("class", "proficiency", "y", None, {"friendlySubtypeName": "Tools, Thieves'", "entityTypeId": 2103445194}),
                       ("race", "language", "z", None, {"friendlySubtypeName": "Speech, Deep"}),
                       ("race", "immunity", "w", None, {"friendlySubtypeName": "Damage, Poison"})))
    es = edits(TEMPLATE, c)
    assert es["Proficiencies / Armor Training"].new == "**Armor Training:** Light Armor"
    assert es["Proficiencies / Tools"].new == "**Tools:** Thieves' Tools"
    assert es["Proficiencies / Languages"].new == "**Languages:** Deep Speech"
    assert es["Stat Sheet / Defences / Immunities"].new == "**Immunities:** Poison Damage"


# --- the note's shape -----------------------------------------------------------

def test_crlf_note_keeps_crlf_on_every_line():
    crlf = TEMPLATE.replace("\n", "\r\n")
    c = got(species="Dwarf", modifiers=(("race", "resistance", "fire", None),))
    out = written(crlf, c)
    assert out != crlf
    assert out.count("\r\n") == crlf.count("\r\n") and "\n" not in out.replace("\r\n", "")
    assert "**Species:** Dwarf\r\n" in out and "**Resistances:** Fire\r\n" in out
    assert "| Level | 5 |\r\n" in out


def test_a_fenced_example_above_the_real_table_is_not_written():
    fenced = ("## Stat Sheet\n\n```\n### Core\n\n| Attribute | Value |\n|---|---|\n| Level | 1 |\n"
              "**Species:** example\n```\n\n")
    text = swap(TEMPLATE, "## Stat Sheet\n\n", fenced)
    out = written(text)
    assert "| Level | 1 |\n**Species:** example\n```" in out
    assert "| Level | 5 |" in out and "**Species:** Human\n" in out


def test_nothing_changed_means_nothing_to_write():
    first = written(TEMPLATE)
    again = plan_cells(first, got())
    assert not [e for e in again if e.status == "WRITE"]
    assert write_edits(first, again) == first


def test_a_newline_or_pipe_in_a_name_becomes_a_space():
    c = dataclasses.replace(got(), species="Dwarf\nmountain | hill", size="Me|dium\u2028x")
    out = written(TEMPLATE, c)
    assert "**Species:** Dwarf mountain   hill\n" in out
    assert "| Size | Me dium x |" in out
    c = dataclasses.replace(got(), resistances=["Fi\nre"])
    assert "**Resistances:** Fi re\n" in written(TEMPLATE, c)


def test_edit_is_a_plain_dataclass_with_the_contract_fields():
    e = Edit("SAME", "x", "y")
    assert (e.line, e.col, e.new) == (-1, -1, "")


# --- carried over from the review of the cells -------------------------------------

def test_whole_line_rewrite_keeps_what_precedes_the_label():
    text = "intro\n  **Species:** {species}\n> **Class/Subclass:** x\n"
    out = write_edits(text, [Edit("WRITE", "a", "m", 1, -1, "**Species:** Dwarf"),
                             Edit("WRITE", "b", "m", 2, -1, "**Class/Subclass:** Wizard 5")])
    assert out == "intro\n  **Species:** Dwarf\n> **Class/Subclass:** Wizard 5\n"


def test_indented_labelled_line_is_found_and_keeps_its_indent():
    text = swap(TEMPLATE, "**Species:** {Species name}", "  **Species:** {Species name}")
    assert "  **Species:** Dwarf\n" in written(text, got(species="Dwarf"))


def test_whole_line_rewrite_keeps_an_odd_line_ending():
    for eol in ("\x0b", "\x85", "\u2028", "\r", "\r\n", ""):
        text = "**Species:** {species}" + eol
        out = write_edits(text, [Edit("WRITE", "a", "m", 0, -1, "**Species:** Dwarf")])
        assert out == "**Species:** Dwarf" + eol


def test_a_last_line_with_no_newline_gains_none():
    text = TEMPLATE.rstrip("\n")
    assert not text.endswith("\n")
    out = written(text, got(species="Dwarf"))
    assert out != text and not out.endswith("\n")
    last = "| Attribute | Value |\n|---|---|\n| Level | 1 |"
    out = write_edits(last, [Edit("WRITE", "a", "m", 2, 1, "6")])
    assert out == "| Attribute | Value |\n|---|---|\n| Level | 6 |"


def test_an_escaped_pipe_in_another_cell_of_an_edited_row_survives():
    text = "| Attribute | Value | Notes |\n|---|---|---|\n| Level | 1 | a \\| b |\n"
    out = write_edits(text, [Edit("WRITE", "a", "m", 2, 1, "6")])
    assert out == "| Attribute | Value | Notes |\n|---|---|---|\n| Level | 6 | a \\| b |\n"


def test_a_skills_row_without_ability_or_modifier_or_with_a_bad_ability_is_skipped():
    for old, new in (("| Arcana | INT | No | No | +0 |", "| Arcana | XYZ | No | No | +0 |"),
                     ("| Arcana | INT | No | No | +0 |", "| Arcana |  | No | No | +0 |")):
        text = swap(TEMPLATE, old, new)
        assert not [k for k in edits(text) if k.startswith("Skills / Arcana")]
    text = swap(TEMPLATE, "| Skill | Ability | Proficient | Expertise | Modifier |",
                "| Skill | Ability | Proficient | Expertise | Total |")
    assert not [k for k in edits(text) if k.startswith("Skills /")]
    text = swap(TEMPLATE, "| Skill | Ability | Proficient | Expertise | Modifier |",
                "| Skill | Proficient | Expertise | Modifier |")
    assert not [k for k in edits(text) if k.startswith("Skills /")]


def test_write_edits_with_an_empty_value_writes_one_space_between_the_pipes():
    text = "| Attribute | Value |\n|---|---|\n| Size | Medium |\n"
    out = write_edits(text, [Edit("WRITE", "x", "m", 2, 1, "")])
    assert out == "| Attribute | Value |\n|---|---|\n| Size | |\n"


def test_a_reason_beside_the_level_is_one_error_row_that_says_so():
    from dnd_ddb import sync_text
    text = swap(TEMPLATE, "| Level | 1 |", "| Level | 5 (milestone) |")
    report = sync_text(text, character())
    assert report.rows == [("ERROR", "Stat Sheet / Core / Level",
                            "the Level cell cannot carry a reason in brackets; remove it and sync again; nothing was changed")]
    assert report.text == text and report.seen is None
