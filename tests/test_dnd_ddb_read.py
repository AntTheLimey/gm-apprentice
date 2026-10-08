#!/usr/bin/env python3
"""Tests for dnd_ddb_read.py: a D&D Beyond character read into plain inputs."""

import copy
import dataclasses
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

from ddb_builder import character  # noqa: E402
from dnd_ddb_read import Bonus, Character, Unreadable, Worked, read, safe_name  # noqa: E402


def got(**kw):
    return read(character(**kw))


def scores(**kw):
    return got(**kw).scores


# --- identity -----------------------------------------------------------

def test_identity():
    c = got(xp=6500, size="Small")
    assert (c.name, c.species, c.background, c.size, c.xp) == ("Tavin Reedmere", "Human", "Sage", "Small", 6500)
    assert c.alignment == "Neutral Good" and c.level == 5 and c.speed == 30


def test_the_nine_alignments_and_none():
    names = ["Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "Neutral",
             "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil"]
    assert [got(alignment_id=i).alignment for i in range(1, 10)] == names
    assert got(alignment_id=None).alignment == ""


def test_level_is_the_sum_of_class_levels_in_the_datas_order():
    c = got(classes=(("Fighter", 3, "Champion", None), ("Wizard", 2, "", 4)))
    assert c.level == 5
    assert [(k.name, k.level, k.subclass) for k in c.classes] == [("Fighter", 3, "Champion"), ("Wizard", 2, "")]


def test_casting_ability_and_the_classs_own_slots():
    c = got(classes=(("Fighter", 3, "", None), ("Wizard", 5, "Evoker", 4)))
    fighter, wizard = c.classes
    assert (fighter.casting_ability, fighter.own_slots) == ("", None)
    assert wizard.casting_ability == "INT" and wizard.own_slots == [4, 3, 2, 0, 0, 0, 0, 0, 0]


def test_a_caster_class_before_its_spellcasting_feature_has_no_ability_or_slots():
    c = got(classes=(("Wizard", 1, "", 4),))
    assert c.classes[0].casting_ability == "INT"
    data = character(classes=(("Wizard", 1, "", 4),))
    data["classes"][0]["classFeatures"][0]["definition"]["requiredLevel"] = 2
    k = read(data).classes[0]
    assert (k.casting_ability, k.own_slots) == ("", None)


def test_the_size_modifier_with_the_largest_size_wins():
    extra = {"entityId": 5, "entityTypeId": 127108918}
    assert got(modifiers=(("race", "size", "large", None, extra),)).size == "Large"
    assert got(size="Large", modifiers=(("race", "size", "small", None, {"entityId": 3}),)).size == "Large"


# --- scores -------------------------------------------------------------

def test_scores_from_the_base_only():
    assert scores() == {"STR": 8, "DEX": 14, "CON": 14, "INT": 16, "WIS": 12, "CHA": 10}


def test_bonus_stats_add_and_override_stats_win():
    assert scores(bonus_stats=(0, 0, 0, 2, 0, 0))["INT"] == 18
    assert scores(bonus_stats=(0, 0, 0, 2, 0, 0), override_stats=(None, None, None, 9, None, None))["INT"] == 9
    assert scores(override_stats=(0,) * 6) == scores()   # a zero override means none


def test_a_score_bonus_modifier_adds_up_to_the_cap_and_the_manual_bonus_goes_over_it():
    plus = lambda n: (("race", "bonus", "strength-score", n),)   # noqa: E731
    assert scores(modifiers=plus(2))["STR"] == 10
    assert scores(stats=(18, 14, 14, 16, 12, 10), modifiers=plus(4))["STR"] == 20
    assert scores(stats=(18, 14, 14, 16, 12, 10), modifiers=plus(4), bonus_stats=(1,) * 6)["STR"] == 21


def test_a_raised_maximum_lifts_the_cap():
    both = (("class", "bonus", "strength-score", 4), ("class", "bonus", "ability-score-maximum", 4, {"statId": 1}))
    assert scores(stats=(18, 14, 14, 16, 12, 10), modifiers=both)["STR"] == 22


def test_a_set_modifier_raises_a_lower_score_and_is_ignored_when_the_score_is_higher():
    gauntlets = (("feat", "set", "strength-score", 19),)
    assert scores(modifiers=gauntlets)["STR"] == 19
    assert scores(stats=(20, 14, 14, 16, 12, 10), modifiers=gauntlets)["STR"] == 20
    assert scores(modifiers=(("race", "set", "strength-score", 19),))["STR"] == 8   # only gear, feats and backgrounds set


def test_an_item_counts_only_while_equipped_and_attuned_when_it_needs_it():
    belt = (("Belt of Tests", 1, 1, True, True, "gear"),)
    mod = (("item", "set", "strength-score", 19, {"requiresAttunement": True}),)
    assert scores(inventory=belt, modifiers=mod)["STR"] == 19
    assert scores(inventory=(("Belt of Tests", 1, 1, True, False, "gear"),), modifiers=mod)["STR"] == 8
    assert scores(inventory=(("Belt of Tests", 1, 1, True, True, "gear", False),), modifiers=mod)["STR"] == 8


def test_a_second_classs_modifier_that_is_not_for_multiclass_is_dropped():
    two = (("Fighter", 3, "", None), ("Wizard", 2, "", 4))
    mods = (("class", "bonus", "strength-score", 2, {"class": "Wizard", "availableToMulticlass": False}),
            ("class", "bonus", "dexterity-score", 2, {"class": "Fighter", "availableToMulticlass": False}))
    s = scores(classes=two, modifiers=mods)
    assert (s["STR"], s["DEX"]) == (8, 16)


# --- saves and skills ---------------------------------------------------

def test_save_proficiencies():
    c = got(modifiers=(("class", "proficiency", "wisdom-saving-throws", None),
                       ("class", "proficiency", "intelligence-saving-throws", None)))
    assert c.save_proficiencies == {"WIS", "INT"}
    assert got().save_proficiencies == set()


def test_skill_levels():
    c = got(modifiers=(("background", "proficiency", "sleight-of-hand", None),
                       ("class", "proficiency", "arcana", None),
                       ("class", "expertise", "arcana", None),
                       ("class", "proficiency", "history", None),
                       ("class", "half-proficiency", "nature", None)))
    assert c.skills == {"sleight of hand": "proficient", "arcana": "expertise",
                        "history": "proficient", "nature": "half"}


def test_half_proficiency_on_all_ability_checks_reaches_every_other_skill():
    c = got(modifiers=(("class", "half-proficiency", "ability-checks", None),
                       ("class", "proficiency", "stealth", None)))
    assert len(c.skills) == 18 and c.skills["stealth"] == "proficient" and c.skills["arcana"] == "half"


def test_a_skill_level_the_player_set_by_hand_replaces_the_modifiers():
    data = character(modifiers=(("class", "proficiency", "arcana", None),))
    data["characterValues"] = [
        {"typeId": 26, "value": 4, "valueId": "6", "valueTypeId": "1958004211"},
        {"typeId": 26, "value": 3, "valueId": "9", "valueTypeId": "1958004211"}]
    assert read(data).skills == {"arcana": "expertise", "nature": "proficient"}


# --- defences -----------------------------------------------------------

def test_defences_are_named_and_a_condition_immunity_is_kept_apart():
    c = got(modifiers=(("race", "resistance", "fire", None), ("race", "resistance", "fire", None),
                       ("class", "immunity", "poison", None), ("class", "immunity", "frightened", None),
                       ("feat", "vulnerability", "cold", None)))
    assert c.resistances == ["Fire"] and c.immunities == ["Poison"]
    assert c.vulnerabilities == ["Cold"] and c.condition_immunities == ["Frightened"]


def test_a_restriction_is_shown_beside_a_damage_type():
    c = got(modifiers=(("race", "resistance", "fire", None, {"restriction": "while holding"}),))
    assert c.resistances == ["Fire (while holding)"]


# --- features -----------------------------------------------------------

def test_features_carry_uses_and_recovery():
    c = got(class_features=(("Arcane Recovery", 1, 2), ("Second Wind Test", 2, 1), ("Plain Feature", None, None)),
            racial_traits=(("Gloomwright Step", 3, 2),), feats=(("Lucky Test",),))
    assert [(f.name, f.uses, f.recovers) for f in c.class_features] == [
        ("Arcane Recovery", 1, "Long Rest"), ("Second Wind Test", 2, "Short Rest"), ("Plain Feature", None, "")]
    assert [(f.name, f.uses, f.recovers) for f in c.species_traits] == [("Gloomwright Step", 3, "Long Rest")]
    assert [(f.name, f.uses) for f in c.feats] == [("Lucky Test", None)]


def test_a_feature_hidden_from_the_sheet_or_above_the_classs_level_is_left_out():
    c = got(class_features=(("Shown", None, None), ("Hidden", None, None, 1, True),
                            ("Too High", None, None, 6), ("Just Right", None, None, 5)),
            racial_traits=(("Hidden Trait", None, None, None, True), ("Late Trait", None, None, 9)))
    assert [f.name for f in c.class_features] == ["Shown", "Just Right"]
    assert c.species_traits == []


@pytest.mark.parametrize("name", ["Proficiencies", "hit points", " Ability Score Improvement ", "Ability Score Increase",
                                  "Ability Score Increases", "Equipment", "Languages", "Age", "Size", "Speed",
                                  "Alignment", "Creature Type"])
def test_the_sites_bookkeeping_features_are_not_listed(name):
    c = got(class_features=((name, None, None), ("Real Feature", None, None)), racial_traits=((name, None, None), ("Real Trait", None, None)))
    assert [f.name for f in c.class_features] == ["Real Feature"]
    assert [f.name for f in c.species_traits] == ["Real Trait"]


def test_a_level_prefix_is_removed_and_same_named_entries_merge_keeping_the_uses():
    c = got(class_features=(("4: Weapon Mastery", None, None), ("Weapon Mastery", 2, 2), ("8: Ability Score Improvement", None, None),
                            ("3: Keen Eye", 1, 1), ("Keen Eye", None, None)))
    assert [(f.name, f.uses, f.recovers) for f in c.class_features] == [
        ("Weapon Mastery", 2, "Long Rest"), ("Keen Eye", 1, "Short Rest")]


@pytest.mark.parametrize("name", ["Skills", "Tool Proficiency", "Bonus Proficiency", "Extra Language", "Feat",
                                  "Spellcasting", "Pact Magic", "Core Barbarian Traits", "core Gloomwright traits",
                                  "Barbarian Subclass", "Zzyx Subclass"])
def test_more_bookkeeping_rows_are_not_listed(name):
    c = got(class_features=((name, None, None), ("Real Feature", None, None)))
    assert [f.name for f in c.class_features] == ["Real Feature"]


def test_weapon_mastery_and_the_subclass_choice_rows_are_kept():
    names = ["Weapon Mastery", "Divine Domain", "Sacred Oath", "Sorcerous Origin", "Otherworldly Patron", "Core Values"]
    c = got(class_features=tuple((n, None, None) for n in names))
    assert [f.name for f in c.class_features] == names


def test_a_feature_listed_twice_is_kept_once():
    c = got(class_features=(("Rage Test", None, None, 1, True), ("Rage Test", 3, 2), ("Rage Test", None, None)))
    assert [(f.name, f.uses) for f in c.class_features] == [("Rage Test", 3)]


def test_uses_that_scale_with_an_ability_or_the_proficiency_bonus():
    scale = {"statModifierUsesId": 4, "useProficiencyBonus": True}   # INT mod 3, proficiency 3 at level 5
    c = got(class_features=(("Scaled", 1, 2, 1, False, scale), ("Floored", 0, 2)))
    uses = {f.name: f.uses for f in c.class_features}
    assert uses["Scaled"] == 1 + 3 + 3 and uses["Floored"] == 1   # never fewer than one


# --- spells -------------------------------------------------------------

FIRE_BOLT = ("Fire Bolt", 0, False, False, False, False, (1, 2), "Wizard")
SHIELD = ("Shield", 1, True, False, False, False, (1, 2), "Wizard")
SLEEP = ("Sleep", 1, False, False, False, False, (1, 2, 3), "Wizard")
DETECT = ("Detect Magic", 1, True, False, True, True, (1, 2), "Wizard")
ALWAYS = ("Mage Armor", 1, False, True, False, False, (1, 2, 3), "Wizard")


def test_a_preparing_class_lists_cantrips_prepared_and_always_prepared_only():
    c = got(spells=(FIRE_BOLT, SHIELD, SLEEP, DETECT, ALWAYS))
    assert [s.name for s in c.spells] == ["Fire Bolt", "Detect Magic", "Mage Armor", "Shield"]


def test_a_class_that_knows_its_spells_lists_them_all():
    bard = (("Bard", 5, "", 6),)
    known = tuple(s[:7] + ("Bard",) for s in (FIRE_BOLT, SHIELD, SLEEP))
    assert [s.name for s in got(classes=bard, spells=known).spells] == ["Fire Bolt", "Shield", "Sleep"]


def test_spell_tags_components_and_short_strings():
    s = {x.name: x for x in got(spells=(FIRE_BOLT, DETECT, ALWAYS)).spells}
    detect = s["Detect Magic"]
    assert detect.tags == ["C", "R"] and detect.components == "V, S"
    assert (detect.time, detect.range, detect.duration, detect.level, detect.source) == (
        "1 action", "30 ft", "1 minute", 1, "Wizard")
    assert s["Mage Armor"].tags == ["Always prepared"] and s["Mage Armor"].components == "V, S, M"
    assert s["Fire Bolt"].tags == [] and s["Fire Bolt"].level == 0


def test_spells_from_an_item_a_feat_and_a_species():
    c = got(inventory=(("Wand of Tests", 1, 1, True, True, "gear"),), feats=(("Magic Initiate Test",),),
            spells=(("Light", 0, False, False, False, False, (1, 3), "Item: Wand of Tests"),
                    ("Guidance", 0, False, False, False, False, (1, 2), "Feat: Magic Initiate Test"),
                    ("Dancing Lights", 0, False, False, True, False, (1, 2, 3), "Species")))
    assert {s.name: s.source for s in c.spells} == {
        "Light": "Item: Wand of Tests", "Guidance": "Feat: Magic Initiate Test", "Dancing Lights": "Species"}


def test_an_item_spell_is_left_out_while_the_item_is_not_carried_ready():
    wand = ("Wand of Tests", 1, 1, True, False, "gear")   # needs attunement, has none
    light = ("Light", 0, False, False, False, False, (1, 3), "Item: Wand of Tests")
    assert got(inventory=(wand,), spells=(light,)).spells == []


def test_a_spell_listed_twice_for_one_source_is_kept_once_and_always_prepared_wins():
    again = ("Mage Armor", 1, True, False, False, False, (1, 2, 3), "Wizard")
    c = got(spells=(again, ALWAYS))
    assert [(s.name, s.tags) for s in c.spells] == [("Mage Armor", ["Always prepared"])]


BAD = "Self | <img src=x>\n## GM Notes <!-- x -->"
UNSAFE = "|\n#<>[]`*_"


def test_every_spell_string_from_hostile_data_is_safe():
    data = character(spells=(SHIELD,))
    sd = data["classSpells"][0]["spells"][0]["definition"]
    sd["activation"] = {"activationTime": BAD, "activationType": BAD}
    sd["range"] = {"origin": BAD, "rangeValue": 30, "aoeType": BAD, "aoeValue": 10}
    sd["duration"] = {"durationType": BAD, "durationUnit": BAD, "durationInterval": 2}
    sd["components"] = [BAD, 1]
    for tame in ("Time", "Concentration"):
        sd["duration"]["durationType"] = tame
        spell = read(data).spells[0]
        for text in (spell.time, spell.range, spell.components, spell.duration):
            assert not any(ch in text for ch in UNSAFE)
    sd["range"]["origin"] = "Ranged"
    assert not any(ch in read(data).spells[0].range for ch in UNSAFE)


def test_a_long_defence_with_its_reason_is_cut_to_80():
    c = got(modifiers=(("race", "resistance", "fire", None, {"restriction": "while " + "holding " * 20}),))
    assert len(c.resistances[0]) <= 80


def test_the_bookkeeping_filter_leaves_feats_alone():
    assert [f.name for f in got(feats=(("Skills",), ("Feat",), ("Lucky Test",))).feats] == ["Skills", "Feat", "Lucky Test"]


def test_a_class_spell_entry_with_no_id_binds_to_no_class():
    data = character(spells=(SHIELD,))
    data["classSpells"][0]["characterClassId"] = None
    for row in data["classes"]:
        row["id"] = None
    assert read(data).spells == []


# --- proficiencies ------------------------------------------------------

def test_armour_weapon_tool_and_language_proficiencies_in_first_seen_order():
    c = got(modifiers=(
        ("class", "proficiency", "light-armor", None), ("background", "proficiency", "light-armor", None),
        ("class", "proficiency", "shields", None, {"friendlySubtypeName": "Shields"}),
        ("class", "proficiency", "simple-weapons", None), ("class", "proficiency", "dagger", None, {"entityTypeId": 1782728300}),
        ("background", "proficiency", "thieves-tools", None, {"friendlySubtypeName": "Thieves' Tools"}),
        ("race", "language", "common", None), ("race", "language", "elvish", None),
        ("background", "language", "elvish", None), ("race", "language", "choose-a-language", None, {"entityTypeId": None}),
        ("class", "proficiency", "self", None, {"entityTypeId": None})))
    assert c.armor == ["Light Armor", "Shields"]
    assert c.weapons == ["Simple Weapons", "Dagger"]
    assert c.tools == ["Thieves' Tools"]
    assert c.languages == ["Common", "Elvish"]


def test_custom_proficiencies_the_player_typed_in():
    data = character()
    data["customProficiencies"] = [{"type": 2, "name": "Lute"}, {"type": 3, "name": "Orc"},
                                   {"type": 3, "name": ""}, {"type": 1, "name": "Cart Driving"}]
    c = read(data)
    assert c.tools == ["Lute"] and c.languages == ["Orc"]


# --- gear and magic items -----------------------------------------------

def test_gear_is_an_item_with_a_quantity_a_weight_and_a_kind():
    c = got(inventory=(("Rope, Hempen", 1, 10, False, False, "gear"), ("Dart", 20, 0.25, False, False, "weapon"),
                       ("Chain Mail", 1, 55, False, False, "armor"), ("Shield", 1, 6, False, False, "shield"),
                       ("Feather", 1, 0, False, False, "gear")))
    assert [(i.name, i.qty, i.weight, i.kind) for i in c.gear] == [
        ("Rope, Hempen", 1, "10 lb", "other"), ("Dart", 20, "1/4 lb", "weapon"),
        ("Chain Mail", 1, "55 lb", "armour"), ("Shield", 1, "6 lb", "shield"), ("Feather", 1, "—", "other")]
    assert c.magic_items == []


def test_a_stack_weighs_each_by_its_bundle():
    data = character(inventory=(("Arrow", 20, 1, False, False, "gear"),))
    data["inventory"][0]["definition"]["bundleSize"] = 20
    assert read(data).gear[0].weight == "1/20 lb"


def test_two_entries_of_one_name_are_one_item_with_the_quantities_added():
    c = got(inventory=(("Torch", 3, 1, False, False, "gear"), ("Torch", 2, 1, False, False, "gear")))
    assert [(i.name, i.qty) for i in c.gear] == [("Torch", 5)]


def test_a_magic_entry_is_a_magic_item_with_attunement_and_charges():
    c = got(inventory=(("Wand of Zzyx", 1, 1, True, True, "gear", True, 7, "Dawn"),
                       ("Ring of Gloomwright", 1, 0, True, False, "gear"),
                       ("Staff of Tests", 1, 4, True, True, "weapon", True, 10, "Long Rest")))
    assert [(m.name, m.attuned, m.charges, m.recovers) for m in c.magic_items] == [
        ("Wand of Zzyx", True, 7, ""), ("Ring of Gloomwright", False, None, ""),
        ("Staff of Tests", True, 10, "Long Rest")]
    assert c.gear == []


def test_a_name_the_player_gave_an_item_is_the_name_read():
    data = character(inventory=(("Longsword", 1, 3, False, False, "weapon"),))
    data["characterValues"] = [{"typeId": 8, "value": "Gloomwright's Edge", "valueId": "9000",
                                "valueTypeId": "1439493548"}]
    assert read(data).gear[0].name == "Gloomwright's Edge"


def test_consumable_magic_items_are_gear_and_other_magic_stays_magic():
    potion = ("Potion of Healing", 3, 0.5, True, False, "gear", True, None, None, True)
    c = got(inventory=(potion, ("Ring of Gloomwright", 1, 0, True, False, "gear")))
    assert [(i.name, i.qty, i.weight, i.kind) for i in c.gear] == [("Potion of Healing", 3, "1/2 lb", "other")]
    assert [m.name for m in c.magic_items] == ["Ring of Gloomwright"]
    again = got(inventory=(potion, potion))
    assert [(i.name, i.qty) for i in again.gear] == [("Potion of Healing", 6)] and again.magic_items == []


# --- coins and speed ----------------------------------------------------

def test_coins():
    assert got(currencies={"cp": 1, "sp": 2, "ep": 3, "gp": 4, "pp": 5}).coins == {"cp": 1, "sp": 2, "ep": 3, "gp": 4, "pp": 5}
    data = character()
    del data["currencies"]
    assert read(data).coins == {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}


def test_speed_adds_bonuses_and_takes_the_armour_strength_penalty():
    assert got(speed=30, modifiers=(("feat", "bonus", "speed", 10),)).speed == 40
    assert got(speed=30, modifiers=(("race", "set", "innate-speed-walking", 35),)).speed == 35
    plate = ("Plate Test", 1, 65, False, False, "armor")
    data = character(speed=30, inventory=(plate,))
    data["inventory"][0]["definition"]["strengthRequirement"] = 15
    assert read(data).speed == 20   # Strength 8 is under 15
    assert got(speed=30, inventory=(plate,)).speed == 30
    data["customSpeeds"] = [{"movementId": 1, "distance": 25}]
    assert read(data).speed == 25


# --- safe_name ----------------------------------------------------------

def test_safe_name():
    assert safe_name("Bigby's Hand") == "Bigby's Hand"
    assert safe_name("Bigby’s Hand") == "Bigby's Hand"
    bad = safe_name("A | B\n## GM Notes <!-- x --> [[Y]] `z` *w* _v_")
    assert not any(ch in bad for ch in "|\n#<>[]`*_") and "GM Notes" in bad
    assert len(safe_name("x" * 200)) == 80
    assert safe_name(None) == "" and safe_name(7) == "7"
    assert safe_name("Spear (Cursed), +1: a/b & c.") == "Spear (Cursed), +1: a/b & c."


def test_an_entry_whose_name_is_empty_after_safe_name_is_skipped():
    c = got(inventory=(("###", 1, 1, False, False, "gear"), ("Torch", 1, 1, False, False, "gear")),
            class_features=(("***", None, None), ("Kept", None, None)))
    assert [i.name for i in c.gear] == ["Torch"]
    assert [f.name for f in c.class_features] == ["Kept"]


# --- unreadable ---------------------------------------------------------

def broken(edit):
    data = character()
    edit(data)
    return data


@pytest.mark.parametrize("data", [
    None, [], "a character", 7,
    broken(lambda d: d.pop("classes")),
    broken(lambda d: d.update(classes=[])),
    broken(lambda d: d.update(classes="Wizard")),
    broken(lambda d: d["classes"][0].pop("definition")),
    broken(lambda d: d["classes"][0].update(definition=None)),
    broken(lambda d: d["classes"][0].update(level=0)),
    broken(lambda d: d["classes"][0].update(level=21)),
    broken(lambda d: d["classes"][0].update(level="five")),
    broken(lambda d: d.update(stats=d["stats"][:5])),
    broken(lambda d: d.update(stats=None)),
    broken(lambda d: d["stats"][2].update(value="high")),
    broken(lambda d: d["stats"][2].update(value=None)),
], ids=lambda d: type(d).__name__)
def test_unreadable_says_so_in_one_sentence_naming_dnd_beyond(data):
    with pytest.raises(Unreadable) as err:
        read(data)
    text = str(err.value)
    assert "D&D Beyond" in text and "\n" not in text and text.endswith(".")


def test_two_classes_that_together_pass_level_20_are_unreadable():
    with pytest.raises(Unreadable):
        got(classes=(("Fighter", 11, "", None), ("Wizard", 10, "", 4)))


def _mangle(path, value):
    def edit(d):
        node = d
        for key in path[:-1]:
            node = node[key]
        node[path[-1]] = value
    return broken(edit)


def _with_item_and_spell():
    data = character(inventory=(("Torch", 1, 1, False, False, "gear"),), spells=(SHIELD,),
                     modifiers=(("class", "proficiency", "arcana", None),), class_features=(("Kept", 1, 2),))
    return data


HOSTILE = [
    _mangle(["modifiers"], []),
    _mangle(["modifiers"], "none"),
    _mangle(["modifiers", "class"], None),
    _mangle(["modifiers", "race"], {"a": 1}),
    _mangle(["inventory"], [None, 7, "x"]),
    _mangle(["inventory"], {"a": 1}),
    _mangle(["currencies"], "7 gold"),
    _mangle(["currencies"], {"gp": "lots", "pp": None}),
    _mangle(["spells"], []),
    _mangle(["spells"], {"class": [None, {"definition": None}], "item": "x", "race": [1], "feat": {"a": 1}}),
    _mangle(["classSpells"], [None, {"characterClassId": 1000, "spells": [{"definition": None}, 3, None]}]),
    _mangle(["classSpells"], "none"),
    _mangle(["actions"], []),
    _mangle(["actions"], {"class": [None, {"limitedUse": "x", "componentId": 1}], "race": "x"}),
    _mangle(["race"], None),
    _mangle(["race"], {"racialTraits": [None, {"definition": None}, 4], "weightSpeeds": []}),
    _mangle(["background"], "Sage"),
    _mangle(["feats"], [None, {"definition": 5}]),
    _mangle(["characterValues"], [None, 5, {"typeId": 26}, {"typeId": 8, "valueId": 5}]),
    _mangle(["customProficiencies"], "none"),
    _mangle(["customSpeeds"], [None, {"movementId": "walk"}]),
    _mangle(["bonusStats"], None),
    _mangle(["overrideStats"], [None, 3, {"value": "x"}]),
    _mangle(["alignmentId"], "lawful"),
    _mangle(["currentXp"], "lots"),
    _mangle(["name"], {"a": 1}),
    _mangle(["classes", 0, "classFeatures"], [None, {"definition": None}, 3]),
    _mangle(["classes", 0, "subclassDefinition"], "Evoker"),
    _mangle(["classes", 0, "definition", "spellRules"], {"levelSpellSlots": "many"}),
    _mangle(["classes", 0, "definition", "spellRules"], {"levelSpellSlots": [[1, 2, 3]] * 30}),
]


@pytest.mark.parametrize("data", HOSTILE, ids=[f"hostile-{i}" for i in range(len(HOSTILE))])
def test_a_mangled_character_reads_or_is_unreadable_and_never_crashes(data):
    data = copy.deepcopy(data)
    try:
        read(data)
    except Unreadable as err:
        assert "D&D Beyond" in str(err)


def test_a_mangled_entry_is_skipped_and_the_rest_still_reads():
    data = _with_item_and_spell()
    data["inventory"].insert(0, None)
    data["spells"]["class"] = [None]
    c = read(data)
    assert [i.name for i in c.gear] == ["Torch"] and [s.name for s in c.spells] == ["Shield"]
    assert c.skills == {"arcana": "proficient"}


# --- the worked numbers -------------------------------------------------

def test_read_fills_the_three_worked_numbers():
    c = read(character(hit_points={"base": 22}))
    assert c.hp_max == Worked(32, "", "") and c.ac == Worked(12, "Unarmoured 10 + Dex 2", "")
    assert [a.name for a in c.attacks.value] == ["Unarmed Strike"]


def test_a_character_made_without_the_worked_numbers_has_them_unsure():
    c = got()
    worked = ("hp_max", "ac", "attacks")
    bare = Character(**{f.name: getattr(c, f.name) for f in dataclasses.fields(c) if f.name not in worked})
    for name in worked:
        assert getattr(bare, name) == Worked(None, "", "it has not been worked out")
    assert bare.hp_max is not bare.ac


# --- bonuses from items and features --------------------------------------------------
# The default character is a Wizard 5 (proficiency bonus +3): STR 8, DEX 14, CON 14, INT 16, WIS 12, CHA 10.

RING = (("Ring of Protection", 1, 0, True, True, "gear"),)
STONE = (("Stone of Good Luck", 1, 0, True, True, "gear"),)
NEEDS = {"requiresAttunement": True}
SKILL = 1958004211


def bonuses(**kw):
    return got(**kw).bonuses


def test_a_character_with_no_bonus_has_an_empty_list():
    assert bonuses() == [] and bonuses(inventory=RING) == []


def test_an_items_bonus_to_every_save_and_to_one_save():
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 1, NEEDS),)) == \
        [Bonus("Saves", 1, "Ring of Protection")]
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "wisdom-saving-throws", 2),
                                              ("item", "bonus", "strength-saving-throws", -1))) == \
        [Bonus("Wisdom Save", 2, "Ring of Protection"), Bonus("Strength Save", -1, "Ring of Protection")]


def test_a_save_bonus_given_as_an_abilitys_modifier_is_the_number_and_never_under_one():
    aura = dict(class_features=(("Aura of Protection", None, None),),
                modifiers=(("class", "bonus", "saving-throws", None, {"statId": 6, "feature": "Aura of Protection"}),))
    assert bonuses(stats=(8, 14, 14, 16, 12, 18), **aura) == [Bonus("Saves", 4, "Aura of Protection")]
    assert bonuses(stats=(8, 14, 14, 16, 12, 8), **aura) == [Bonus("Saves", 1, "Aura of Protection")]


def test_a_save_bonus_counts_the_proficiency_bonus_and_the_attuned_items_when_the_data_says_so():
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 1, {"bonusTypes": [1]}),)) == \
        [Bonus("Saves", 4, "Ring of Protection")]
    assert bonuses(inventory=RING + STONE, modifiers=(("item", "bonus", "saving-throws", 0, {"bonusTypes": [2]}),)) == \
        [Bonus("Saves", 2, "Ring of Protection")]


def test_a_bonus_to_ability_checks_is_for_the_skills_and_one_to_initiative_for_initiative():
    both = (("item", "bonus", "ability-checks", 1, NEEDS), ("item", "bonus", "initiative", 1, NEEDS))
    assert bonuses(inventory=STONE, modifiers=both) == \
        [Bonus("Skills", 1, "Stone of Good Luck"), Bonus("Initiative", 1, "Stone of Good Luck")]
    assert bonuses(inventory=STONE, modifiers=both[:1]) == [Bonus("Skills", 1, "Stone of Good Luck")]


def test_half_proficiency_on_ability_checks_is_half_on_the_skills_and_never_a_bonus():
    jack = dict(class_features=(("Jack of All Trades", None, None),),
                modifiers=(("class", "half-proficiency", "ability-checks", None, {"feature": "Jack of All Trades"}),
                           ("class", "half-proficiency", "initiative", None, {"feature": "Jack of All Trades"})))
    c = got(**jack)
    assert c.bonuses == [Bonus("Initiative", 1, "Jack of All Trades")]
    assert set(c.skills.values()) == {"half"} and len(c.skills) == 18


def test_initiative_takes_one_share_of_the_proficiency_bonus_the_largest():
    down = ("class", "half-proficiency", "initiative", None)
    up = ("feat", "half-proficiency-round-up", "initiative", None)
    full = ("feat", "bonus", "initiative", None, {"bonusTypes": [1], "feat": "Alert"})
    alert = dict(feats=(("Alert",),))
    assert bonuses(modifiers=(down,)) == [Bonus("Initiative", 1, "Wizard Proficiencies")]
    assert bonuses(modifiers=(down, up)) == [Bonus("Initiative", 2, "Feat")]
    assert bonuses(modifiers=(down, up, full), **alert) == [Bonus("Initiative", 3, "Alert")]
    assert bonuses(modifiers=(full, down), **alert) == [Bonus("Initiative", 3, "Alert")]
    plus = ("feat", "bonus", "initiative", 2, {"feat": "Alert"})
    assert bonuses(modifiers=(plus, full), **alert) == [Bonus("Initiative", 5, "Alert")]


def test_a_bonus_to_one_skill_by_its_slug_or_by_its_id():
    gloves = (("Gloves of Tests", 1, 0, True, False, "gear"),)
    assert bonuses(inventory=gloves, modifiers=(("item", "bonus", "sleight-of-hand", 5),)) == \
        [Bonus("Sleight of Hand", 5, "Gloves of Tests")]
    by_id = ("class", "bonus", "made-up", None, {"entityId": 6, "entityTypeId": SKILL, "statId": 5})
    assert bonuses(modifiers=(by_id,)) == [Bonus("Arcana", 1, "Wizard Proficiencies")]
    assert bonuses(stats=(8, 14, 14, 16, 8, 10), modifiers=(by_id,)) == []      # a modifier under 0 adds nothing


def test_bonuses_to_the_passive_scores_and_to_spells():
    mods = tuple(("item", "bonus", sub, n + 1) for n, sub in enumerate((
        "passive-perception", "passive-investigation", "passive-insight", "spell-attacks", "spell-save-dc")))
    assert [(b.applies, b.amount) for b in bonuses(inventory=RING, modifiers=mods)] == [
        ("Passive Perception", 1), ("Passive Investigation", 2), ("Passive Insight", 3),
        ("Spell Attack", 4), ("Spell Save DC", 5)]


def test_a_bonus_with_a_condition_written_on_it_is_left_out():
    cond = {"restriction": "against spells"}
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 1, cond),
                                              ("item", "bonus", "ability-checks", 1, cond),
                                              ("class", "half-proficiency", "initiative", None, cond))) == []


def test_an_items_bonus_counts_only_while_it_is_worn_and_attuned_when_it_needs_it():
    mod = (("item", "bonus", "saving-throws", 1, NEEDS),)
    assert bonuses(inventory=(("Ring of Protection", 1, 0, True, False, "gear"),), modifiers=mod) == []
    assert bonuses(inventory=(("Ring of Protection", 1, 0, True, True, "gear", False),), modifiers=mod) == []
    assert bonuses(inventory=(("Ring of Protection", 1, 0, True, False, "gear"),),
                   modifiers=(("item", "bonus", "saving-throws", 1),)) == [Bonus("Saves", 1, "Ring of Protection")]


def test_a_zero_bonus_is_left_out_and_two_of_one_kind_from_one_source_are_one_sum():
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 0),)) == []
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 1), ("item", "bonus", "saving-throws", 2))) == \
        [Bonus("Saves", 3, "Ring of Protection")]
    assert bonuses(inventory=RING, modifiers=(("item", "bonus", "saving-throws", 1), ("item", "bonus", "saving-throws", -1))) == []
    two = bonuses(inventory=RING + (("Cloak of Protection", 1, 0, True, True, "gear"),),
                  modifiers=(("item", "bonus", "saving-throws", 1), ("item", "bonus", "saving-throws", 1, {"item": "Cloak of Protection"})))
    assert two == [Bonus("Saves", 1, "Ring of Protection"), Bonus("Saves", 1, "Cloak of Protection")]


def test_the_source_is_the_name_of_what_gives_it_and_else_its_kind():
    named = dict(feats=(("Alert",),), racial_traits=(("Zzyx Luck", None, None),), class_features=(("6: Aura of Protection", None, None),))
    mods = (("race", "bonus", "saving-throws", 1, {"trait": "Zzyx Luck"}),
            ("class", "bonus", "saving-throws", 1, {"feature": "6: Aura of Protection"}),
            ("feat", "bonus", "saving-throws", 1, {"feat": "Alert"}))
    assert [b.source for b in bonuses(modifiers=mods, **named)] == ["Zzyx Luck", "Aura of Protection", "Alert"]
    nameless = (("race", "bonus", "saving-throws", 1), ("class", "bonus", "saving-throws", 1, {"componentId": 31337}),
                ("feat", "bonus", "saving-throws", 1), ("background", "bonus", "saving-throws", 1),
                ("item", "bonus", "saving-throws", 1))
    assert [b.source for b in bonuses(modifiers=nameless, inventory=(("|", 1, 0, True, True, "gear"),))] == \
        ["Species trait", "Class feature", "Feat", "Background", "Item"]


def test_a_bonus_this_reader_does_not_map_is_not_a_row():
    other = tuple(("item", "bonus", sub, 2) for sub in ("armor-class", "hit-points", "speed", "melee-attacks", "strength-score",
                                                         "proficiency-bonus", "strength-ability-checks", "wizard-spell-attacks"))
    assert bonuses(inventory=RING, modifiers=other) == []


def test_odd_bonus_data_is_read_without_a_crash():
    odd = (("item", "bonus", "saving-throws", "three", {"statId": "six", "bonusTypes": "all", "componentId": [1]}),
           ("item", "bonus", "saving-throws", 2, {"statId": 99, "restriction": 7}),
           ("item", "bonus", "x", 2, {"subType": None}), ("item", "bonus", "saving-throws", 2, {"type": None}))
    assert [(b.applies, b.amount) for b in bonuses(inventory=RING, modifiers=odd)] == [("Saves", 2)]


def test_the_players_own_adjustments_to_a_skill_or_a_save_are_bonuses():
    stat = 1472902489
    values = ((24, 2, "9", SKILL), (25, 1, "9", SKILL), (24, -1, "6", SKILL), (39, 1, "5", stat), (40, 2, "5", stat), (39, 3, "1", stat))
    assert bonuses(character_values=values) == [
        Bonus("Arcana", -1, "Player's adjustment"), Bonus("Nature", 3, "Player's adjustment"),
        Bonus("Strength Save", 3, "Player's adjustment"), Bonus("Wisdom Save", 3, "Player's adjustment")]
    assert safe_name("Player's adjustment") == "Player's adjustment"


def test_an_adjustment_that_is_zero_not_a_number_or_beside_an_override_is_left_out():
    stat = 1472902489
    assert bonuses(character_values=((24, 0, "9", SKILL), (24, "two", "6", SKILL), (24, None, "7", SKILL))) == []
    assert bonuses(character_values=((24, 2, "9", SKILL), (23, 7, "9", SKILL), (39, 2, "5", stat), (38, 4, "5", stat))) == []
    assert bonuses(character_values=((24, 2, "99", SKILL), (24, 2, "9", stat), (39, 2, "9", stat))) == []
