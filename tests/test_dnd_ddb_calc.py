#!/usr/bin/env python3
"""Tests for dnd_ddb_calc.py: hit point maximum, armour class and attack lines."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import dnd_ddb_calc as calc  # noqa: E402
from ddb_builder import (ACTION, HEAVY, MARTIAL, MEDIUM, SHIELD, WEAPON_BASE, WEAPON_CATEGORY,  # noqa: E402
                         armour, attack_action, cantrip, character, dice, weapon)
from dnd_ddb_calc import Attack, Worked  # noqa: E402
from dnd_ddb_read import read  # noqa: E402

FIGHTER = (("Fighter", 5, "", None),)            # proficiency bonus +3
STRONG = (16, 14, 14, 10, 12, 8)                 # STR +3, DEX +2, CON +2
SIMPLE_WEAPONS = ("class", "proficiency", "simple-weapons", None, {"entityId": 1})
MARTIAL_WEAPONS = ("class", "proficiency", "martial-weapons", None, {"entityId": 2})


def hp(**kw) -> Worked:
    return read(character(**kw)).hp_max


def ac(**kw) -> Worked:
    return read(character(**kw)).ac


def attacks(**kw) -> Worked:
    kw.setdefault("classes", FIGHTER)
    kw.setdefault("stats", STRONG)
    return read(character(**kw)).attacks


def line(worked: Worked, name: str) -> tuple[str, str]:
    assert worked.unsure == "", worked.unsure
    found = [a for a in worked.value if a.name == name]
    assert len(found) == 1, [a.name for a in worked.value]
    return found[0].hit, found[0].damage


def names(worked: Worked) -> list[str]:
    assert worked.unsure == "", worked.unsure
    return [a.name for a in worked.value]


def held(name, kind="weapon", magic=False, attuned=False, equipped=True):
    return (name, 1, 2, magic, attuned, kind, equipped)


# --- read fills the three -----------------------------------------------

def test_read_fills_the_three_and_they_are_what_the_functions_return():
    data = character(hit_points={"base": 22})
    c = read(data)
    assert c.hp_max == calc.hp_max(data, c) and c.ac == calc.armour_class(data, c)
    assert c.attacks == calc.attacks(data, c)
    assert isinstance(c.hp_max.value, int) and isinstance(c.ac.value, int)
    assert all(isinstance(a, Attack) for a in c.attacks.value)


# --- hit point maximum --------------------------------------------------

def test_hp_is_the_rolled_total_plus_con_times_level():
    assert hp(hit_points={"base": 22}) == Worked(32, "", "")          # CON +2, level 5


def test_hp_from_the_hit_dice_when_the_character_takes_the_fixed_value():
    assert hp(hit_points={"base": 999, "type": 1}, hit_dice={"Wizard": 6}).value == 6 + 4 * 4 + 10
    two = (("Fighter", 3, "", None), ("Wizard", 2, "", 4))
    assert hp(classes=two, hit_points={"type": 1}, hit_dice={"Fighter": 10, "Wizard": 6}).value == 10 + 2 * 6 + 2 * 4 + 10


def test_hp_with_a_per_level_bonus():
    assert hp(hit_points={"base": 22}, modifiers=(("feat", "bonus", "hit-points-per-level", 2),)).value == 42
    assert hp(hit_points={"base": 22}, modifiers=(("race", "bonus", "hit-points-per-level", 1),)).value == 37


def test_a_class_features_per_level_bonus_counts_that_classs_levels_only():
    two = (("Fighter", 3, "", None), ("Sorcerer", 2, "", 6))
    mods = (("class", "bonus", "hit-points-per-level", 1, {"class": "Sorcerer"}),)
    assert hp(classes=two, hit_points={"base": 22}, modifiers=mods).value == 22 + 10 + 2


def test_hp_with_a_flat_bonus_a_stat_bonus_and_the_players_own_bonus():
    assert hp(hit_points={"base": 22}, modifiers=(("feat", "bonus", "hit-points", 3),)).value == 35
    assert hp(hit_points={"base": 22}, modifiers=(("feat", "bonus", "hit-points", None, {"statId": 4}),)).value == 35
    assert hp(hit_points={"base": 22, "bonus": 4}).value == 36


def test_a_healing_items_dice_add_nothing_to_the_maximum():
    potion = (("item", "bonus", "hit-points", None, {"dice": dice("2d4", 2)}),)
    assert hp(hit_points={"base": 22}, modifiers=potion).value == 32


def test_an_hp_override_replaces_everything():
    assert hp(hit_points={"base": 22, "bonus": 4, "override": 50}).value == 50


def test_hp_is_never_below_one():
    assert hp(stats=(8, 14, 1, 16, 12, 10), hit_points={"base": 5}).value == 1


def test_hp_is_unsure_without_the_fields_it_needs():
    assert hp() == Worked(None, "", "the data has no rolled hit point total")
    assert hp(hit_points={"type": 1}).unsure == "a class has no hit die in the data"
    assert hp(hit_points={"base": "many"}).value is None


def test_hp_is_unsure_about_a_hit_point_rule_it_does_not_know():
    odd = hp(hit_points={"base": 22}, modifiers=(("feat", "set", "hit-points-per-level", 9),))
    assert odd == Worked(None, "", "a hit point rule this calculator does not know (set hit-points-per-level)")


# --- armour class -------------------------------------------------------

LEATHER = {"Leather": armour(11)}
RING = ("Ring of Tests", 1, 0, True, True, "gear")


def test_ac_with_no_armour_is_ten_plus_dex():
    assert ac() == Worked(12, "Unarmoured 10 + Dex 2", "")


def test_ac_in_light_armour_adds_all_of_dex():
    assert ac(stats=(8, 18, 14, 16, 12, 10), inventory=(held("Leather", "armor"),), item_details=LEATHER) \
        == Worked(15, "Leather 11 + Dex 4", "")


def test_ac_in_medium_armour_caps_dex_at_two():
    worn = dict(inventory=(held("Scale Mail", "armor"),), item_details={"Scale Mail": armour(14, MEDIUM)})
    assert ac(stats=(8, 18, 14, 16, 12, 10), **worn) == Worked(16, "Scale Mail 14 + Dex 2", "")
    assert ac(stats=(8, 12, 14, 16, 12, 10), **worn).value == 15
    master = (("feat", "set", "ac-max-dex-armored-modifier", 3),)
    assert ac(stats=(8, 18, 14, 16, 12, 10), modifiers=master, **worn).value == 17
    assert ac(stats=(8, 14, 14, 16, 12, 10), modifiers=master, **worn).value == 16   # the raise needs DEX 16


def test_ac_in_heavy_armour_ignores_dex():
    worn = dict(inventory=(held("Chain Mail", "armor"),), item_details={"Chain Mail": armour(16, HEAVY)})
    assert ac(**worn) == Worked(16, "Chain Mail 16", "")
    assert ac(stats=(8, 6, 14, 16, 12, 10), **worn).value == 16


def test_low_dex_lowers_light_armour():
    assert ac(stats=(8, 8, 14, 16, 12, 10), inventory=(held("Leather", "armor"),), item_details=LEATHER) \
        == Worked(10, "Leather 11 + Dex -1", "")


def test_a_shield_adds_its_armour_class():
    worn = (held("Leather", "armor"), held("Shield", "shield"))
    details = {**LEATHER, "Shield": armour(2, SHIELD)}
    assert ac(inventory=worn, item_details=details) == Worked(15, "Leather 11 + Dex 2 + shield 2", "")
    assert ac(inventory=(held("Shield", "shield"),), item_details=details).parts == "Unarmoured 10 + Dex 2 + shield 2"


def test_armour_not_worn_does_not_count():
    assert ac(inventory=(held("Leather", "armor", equipped=False),), item_details=LEATHER).value == 12


def test_magic_armour_and_a_magic_shield_carry_their_own_bonus():
    worn = (held("Leather, +1", "armor", magic=True), held("Shield, +2", "shield", magic=True))
    details = {"Leather, +1": armour(11), "Shield, +2": armour(2, SHIELD)}
    mods = (("item", "bonus", "armor-class", 1, {"item": "Leather, +1"}),
            ("item", "bonus", "armor-class", 2, {"item": "Shield, +2"}))
    assert ac(inventory=worn, item_details=details, modifiers=mods) == Worked(18, "Leather, +1 12 + Dex 2 + shield 4", "")


def test_armours_own_bonus_waits_for_attunement_but_its_base_does_not():
    worn = (held("Leather of Tests", "armor", magic=True, attuned=False),)
    mods = (("item", "bonus", "armor-class", 1, {"requiresAttunement": True}),)
    assert ac(inventory=worn, item_details={"Leather of Tests": armour(11)}, modifiers=mods).value == 13


def test_the_better_of_two_suits_is_the_one_that_counts():
    worn = (held("Leather", "armor"), held("Chain Mail", "armor"))
    details = {**LEATHER, "Chain Mail": armour(16, HEAVY)}
    assert ac(inventory=worn, item_details=details).parts == "Chain Mail 16"


def test_a_ring_style_bonus_adds_to_armour_class():
    mods = (("item", "bonus", "armor-class", 1, {"requiresAttunement": True}),)
    assert ac(inventory=(RING,), modifiers=mods) == Worked(13, "Unarmoured 10 + Dex 2 + Ring of Tests 1", "")
    assert ac(inventory=(("Ring of Tests", 1, 0, True, False, "gear"),), modifiers=mods).value == 12


def test_unarmoured_defence_adds_a_second_ability():
    con = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),)
    assert ac(modifiers=con) == Worked(14, "Unarmoured 10 + Dex 2 + Con 2", "")
    assert ac(stats=(8, 14, 8, 16, 12, 10), modifiers=con).value == 12     # a negative modifier adds nothing


def test_unarmoured_defence_as_a_set_base():
    assert ac(modifiers=(("race", "set", "unarmored-armor-class", 3),)) \
        == Worked(15, "Unarmoured 10 + Dex 2 + unarmoured bonus 3", "")


def test_the_better_of_two_unarmoured_defences_counts_not_both():
    both = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),
            ("race", "set", "unarmored-armor-class", 3))
    assert ac(modifiers=both).value == 15


def test_worn_armour_and_unarmoured_defence_the_higher_wins():
    con = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),)
    worn = dict(inventory=(held("Leather", "armor"),), item_details=LEATHER)
    assert ac(modifiers=con, **worn) == Worked(14, "Unarmoured 10 + Dex 2 + Con 2", "")
    plate = dict(inventory=(held("Plate", "armor"),), item_details={"Plate": armour(18, HEAVY)})
    assert ac(modifiers=con, **plate) == Worked(18, "Plate 18", "")


def test_armour_wins_when_the_feature_says_it_does_not_work_in_armour():
    feature = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),
               ("class", "ignore", "unarmored-while-armored", None))
    worn = dict(inventory=(held("Leather", "armor"),), item_details=LEATHER)
    assert ac(modifiers=feature, **worn) == Worked(13, "Leather 11 + Dex 2", "")
    assert ac(modifiers=feature).value == 14


def test_a_shield_still_counts_with_unarmoured_defence():
    con = (("class", "set", "unarmored-armor-class", None, {"statId": 3}),)
    assert ac(modifiers=con, inventory=(held("Shield", "shield"),), item_details={"Shield": armour(2, SHIELD)}) \
        == Worked(16, "Unarmoured 10 + Dex 2 + Con 2 + shield 2", "")


def test_bonuses_that_need_armour_on_or_off():
    worn = dict(inventory=(held("Leather", "armor"),), item_details=LEATHER)
    on, off = (("class", "bonus", "armored-armor-class", 1),), (("feat", "bonus", "unarmored-armor-class", 1),)
    assert (ac(modifiers=on, **worn).value, ac(modifiers=on).value) == (14, 12)
    assert (ac(modifiers=off, **worn).value, ac(modifiers=off).value) == (13, 13)


def test_two_weapons_add_their_bonus_only_with_an_off_hand_weapon():
    blades = dict(inventory=(held("Scimitar"), held("Shortsword")),
                  item_details={"Scimitar": weapon("1d6"), "Shortsword": weapon("1d6", "Piercing")},
                  modifiers=(("feat", "bonus", "dual-wield-armor-class", 1),))
    assert ac(**blades).value == 12
    assert ac(character_values=((18, True, "item:Shortsword"),), **blades) \
        == Worked(13, "Unarmoured 10 + Dex 2 + two weapons 1", "")


def test_the_players_own_armour_class_adjustments():
    assert ac(character_values=((2, 1, None), (3, 2, None))) \
        == Worked(15, "Unarmoured 10 + Dex 2 + magic bonus 1 + other bonus 2", "")
    assert ac(character_values=((1, 19, None),)) == Worked(19, "set by hand", "")


def test_ac_is_unsure_about_a_base_armour_set_by_hand():
    assert ac(character_values=((4, 15, None),)) == Worked(None, "", "the base armour is set by hand")


@pytest.mark.parametrize("kind, sub", [("set", "minimum-base-armor"), ("set", "armored-armor-class"),
                                       ("bonus", "zzyx-armor-class"), ("ignore", "ac-zzyx")])
def test_ac_is_unsure_about_an_armour_class_modifier_it_does_not_know(kind, sub):
    assert ac(modifiers=(("race", kind, sub, 13),)) \
        == Worked(None, "", f"an armour class rule this calculator does not know ({kind} {sub})")


def test_a_speed_bonus_for_going_unarmoured_is_not_an_armour_class_rule():
    assert ac(modifiers=(("class", "bonus", "unarmored-movement", 10),)).value == 12


@pytest.mark.parametrize("trait", sorted(calc.AC_BY_NAME))
def test_ac_is_unsure_about_a_species_trait_the_site_counts_by_name(trait):
    named = trait.title()
    assert ac(racial_traits=((named, None, None),)) == Worked(None, "", f"{named} has an armour class rule of its own")
    assert ac(racial_traits=(("Zzyx Hide", None, None),)).value == 12


def test_ac_is_unsure_about_an_adjustment_on_worn_armour_it_does_not_read():
    worn = dict(inventory=(held("Leather", "armor"),), item_details=LEATHER)
    assert ac(character_values=((11, 3, "item:Leather"),), **worn) \
        == Worked(None, "", "Leather carries an adjustment this calculator does not read")
    assert ac(character_values=((8, "Old Faithful", "item:Leather"),), **worn).parts == "Old Faithful 11 + Dex 2"


# --- attack lines: weapons ----------------------------------------------

MACE = dict(inventory=(held("Mace"),), item_details={"Mace": weapon("1d6", "Bludgeoning")}, modifiers=(SIMPLE_WEAPONS,))


def test_a_simple_melee_weapon_uses_strength():
    assert line(attacks(**MACE), "Mace") == ("+6", "1d6+3 bludgeoning")


def test_a_weapon_proficiency_by_name_counts_too():
    by_name = ("class", "proficiency", "mace", None, {"entityId": 1, "entityTypeId": WEAPON_BASE})
    other = ("class", "proficiency", "club", None, {"entityId": 5, "entityTypeId": WEAPON_BASE})
    assert line(attacks(**{**MACE, "modifiers": (by_name,)}), "Mace")[0] == "+6"
    assert line(attacks(**{**MACE, "modifiers": (other,)}), "Mace")[0] == "+3"


def test_a_weapon_without_proficiency_gets_no_proficiency_bonus():
    assert line(attacks(**{**MACE, "modifiers": ()}), "Mace") == ("+3", "1d6+3 bludgeoning")


def test_a_finesse_weapon_takes_the_better_of_strength_and_dexterity():
    dagger = dict(inventory=(held("Dagger"),), modifiers=(SIMPLE_WEAPONS,),
                  item_details={"Dagger": weapon("1d4", "Piercing", properties=("Finesse", "Light"))})
    assert line(attacks(**dagger), "Dagger") == ("+6", "1d4+3 piercing")
    assert line(attacks(stats=(10, 18, 14, 10, 12, 8), **dagger), "Dagger") == ("+7", "1d4+4 piercing")


def test_a_ranged_weapon_uses_dexterity():
    bow = dict(inventory=(held("Shortbow"),), modifiers=(SIMPLE_WEAPONS,),
               item_details={"Shortbow": weapon("1d6", "Piercing", ranged=True)})
    assert line(attacks(**bow), "Shortbow") == ("+5", "1d6+2 piercing")


def test_a_low_ability_shows_as_a_minus_and_a_zero_as_no_bonus():
    assert line(attacks(stats=(8, 14, 14, 10, 12, 8), **MACE), "Mace") == ("+2", "1d6-1 bludgeoning")
    assert line(attacks(stats=(10, 14, 14, 10, 12, 8), **MACE), "Mace") == ("+3", "1d6 bludgeoning")


def test_a_magic_weapon_adds_its_bonus_to_both_numbers():
    sword = dict(inventory=(held("Mace, +1", magic=True),), item_details={"Mace, +1": weapon("1d6", "Bludgeoning")})
    mods = (SIMPLE_WEAPONS, ("item", "bonus", "magic", 1))
    assert line(attacks(modifiers=mods, **sword), "Mace, +1") == ("+7", "1d6+4 bludgeoning")


def test_a_magic_weapons_bonus_waits_for_attunement_and_stays_on_that_weapon():
    two = dict(inventory=(held("Mace of Tests", magic=True, attuned=False), held("Club")),
               item_details={"Mace of Tests": weapon("1d6", "Bludgeoning"), "Club": weapon("1d4", "Bludgeoning")})
    mods = (SIMPLE_WEAPONS, ("item", "bonus", "magic", 2, {"requiresAttunement": True}))
    assert line(attacks(modifiers=mods, **two), "Mace of Tests") == ("+6", "1d6+3 bludgeoning")
    two["inventory"] = (held("Mace of Tests", magic=True, attuned=True), held("Club"))
    worked = attacks(modifiers=mods, **two)
    assert line(worked, "Mace of Tests") == ("+8", "1d6+5 bludgeoning")
    assert line(worked, "Club") == ("+6", "1d4+3 bludgeoning")


def test_a_versatile_weapon_shows_the_two_handed_damage_in_brackets():
    sword = dict(inventory=(held("Longsword"),), modifiers=(MARTIAL_WEAPONS,),
                 item_details={"Longsword": weapon("1d8", category=MARTIAL, properties=("Versatile",))})
    assert line(attacks(**sword), "Longsword") == ("+6", "1d8+3 (1d10+3) slashing")


def test_a_one_handed_damage_bonus_is_left_off_the_two_handed_line():
    sword = dict(inventory=(held("Longsword"),),
                 item_details={"Longsword": weapon("1d8", category=MARTIAL, properties=("Versatile",))})
    mods = (MARTIAL_WEAPONS, ("class", "damage", "one-handed-melee-attacks", 2))
    assert line(attacks(modifiers=mods, **sword), "Longsword") == ("+6", "1d8+5 (1d10+3) slashing")


def test_a_to_hit_bonus_for_ranged_weapons_leaves_melee_alone():
    both = dict(inventory=(held("Shortbow"), held("Mace")),
                item_details={"Shortbow": weapon("1d6", "Piercing", ranged=True), "Mace": weapon("1d6", "Bludgeoning")})
    worked = attacks(modifiers=(SIMPLE_WEAPONS, ("class", "bonus", "ranged-weapon-attacks", 2)), **both)
    assert line(worked, "Shortbow")[0] == "+7" and line(worked, "Mace")[0] == "+6"


def test_another_items_magic_bonus_reaches_every_weapon():
    worn = dict(inventory=(held("Mace"), RING), item_details={"Mace": weapon("1d6", "Bludgeoning")})
    mods = (SIMPLE_WEAPONS, ("item", "bonus", "magic", 1, {"item": "Ring of Tests"}))
    assert line(attacks(modifiers=mods, **worn), "Mace") == ("+7", "1d6+4 bludgeoning")


def test_a_weapons_extra_damage_is_added_after_its_own():
    blade = dict(inventory=(held("Zzyx Blade", magic=True),),
                 item_details={"Zzyx Blade": weapon("2d6", category=MARTIAL, properties=("Two-Handed",))})
    mods = (MARTIAL_WEAPONS,
            ("item", "damage", "cold", None, {"dice": dice("1d8"), "requiresAttunement": True}),
            ("item", "damage", "fire", 2))
    assert line(attacks(modifiers=mods, **blade), "Zzyx Blade") == ("+6", "2d6+3 slashing + 1d8 cold + 2 fire")


def test_a_weapon_can_change_its_damage_type_and_gain_a_property():
    blade = dict(inventory=(held("Zzyx Blade", magic=True),),
                 item_details={"Zzyx Blade": weapon("1d8", category=MARTIAL)})
    mods = (MARTIAL_WEAPONS, ("item", "replace-damage-type", "radiant", None),
            ("item", "weapon-property", "finesse", None))
    assert line(attacks(stats=(10, 18, 14, 10, 12, 8), modifiers=mods, **blade), "Zzyx Blade") == ("+7", "1d8+4 radiant")


def test_a_staff_that_is_gear_attacks_as_the_weapon_it_behaves_like():
    behaves = weapon("1d6", "Bludgeoning", properties=("Versatile",))
    staff = dict(inventory=(held("Staff of Tests", "gear", magic=True, attuned=True),),
                 item_details={"Staff of Tests": {"weaponBehaviors": [behaves]}})
    mods = (SIMPLE_WEAPONS, ("item", "bonus", "magic", 1, {"requiresAttunement": True}))
    assert line(attacks(modifiers=mods, **staff), "Staff of Tests") == ("+7", "1d6+4 (1d8+4) bludgeoning")


def test_a_weapon_not_in_hand_is_not_an_attack():
    assert names(attacks(**{**MACE, "inventory": (held("Mace", equipped=False),)})) == ["Unarmed Strike"]


def test_a_renamed_weapon_goes_by_the_players_name():
    worked = attacks(character_values=((8, "Old | Faithful", "item:Mace"),), **MACE)
    assert names(worked) == ["Old Faithful", "Unarmed Strike"]


def test_the_players_own_bonuses_on_a_weapon():
    plus = attacks(character_values=((12, 2, "item:Mace"), (10, 1, "item:Mace"), (9, "a note", "item:Mace")), **MACE)
    assert line(plus, "Mace") == ("+8", "1d6+4 bludgeoning")
    assert line(attacks(character_values=((13, 9, "item:Mace"),), **MACE), "Mace") == ("+9", "1d6+3 bludgeoning")


def test_a_weapon_the_player_hid_is_left_out():
    assert names(attacks(character_values=((16, False, "item:Mace"),), **MACE)) == ["Unarmed Strike"]


def test_an_off_hand_weapon_drops_its_ability_from_the_damage():
    off = dict(character_values=((18, True, "item:Longsword"),), inventory=(held("Longsword"),),
               item_details={"Longsword": weapon("1d8", category=MARTIAL, properties=("Versatile",))})
    assert line(attacks(modifiers=(MARTIAL_WEAPONS,), **off), "Longsword") == ("+6", "1d8 slashing")
    weak = attacks(stats=(8, 14, 14, 10, 12, 8), modifiers=(MARTIAL_WEAPONS,), **off)
    assert line(weak, "Longsword")[1] == "1d8-1 slashing"
    style = (MARTIAL_WEAPONS, ("class", "ignore", "offhand-modifier-restrictions", None))
    assert line(attacks(modifiers=style, **off), "Longsword")[1] == "1d8+3 slashing"


def test_a_weapon_marked_for_a_feature_may_use_the_ability_that_feature_names():
    blade = dict(inventory=(held("Greatsword"),), stats=(10, 14, 14, 10, 12, 18),
                 item_details={"Greatsword": weapon("2d6", category=MARTIAL)})
    feature = (MARTIAL_WEAPONS, ("class", "enable-feature", calc.HEX_WEAPON, None, {"componentId": 77}),
               ("class", "replace-weapon-ability", "charisma-score", None, {"componentId": 77, "statId": 6}))
    assert line(attacks(modifiers=feature, **blade), "Greatsword") == ("+3", "2d6 slashing")   # not marked: Strength
    marked = attacks(modifiers=feature, character_values=((29, True, "item:Greatsword"),), **blade)
    assert line(marked, "Greatsword") == ("+7", "2d6+4 slashing")
    elsewhere = (MARTIAL_WEAPONS, feature[1], ("class", "replace-weapon-ability", "charisma-score", None, {"statId": 6}))
    assert line(attacks(modifiers=elsewhere, character_values=((29, True, "item:Greatsword"),), **blade), "Greatsword")[0] == "+3"


def test_a_pact_weapon_is_wielded_with_proficiency():
    blade = dict(inventory=(held("Greatsword"),), item_details={"Greatsword": weapon("2d6", category=MARTIAL)},
                 character_values=((28, True, "item:Greatsword"),))
    assert line(attacks(**blade), "Greatsword")[0] == "+3"             # marked, but no feature enables it
    pact = (("class", "enable-feature", calc.PACT_WEAPON, None),)
    assert line(attacks(modifiers=pact, **blade), "Greatsword") == ("+6", "2d6+3 slashing")


AXES = dict(inventory=(held("Handaxe"), held("Handaxe")), item_details={"Handaxe": weapon("1d6")},
            modifiers=(SIMPLE_WEAPONS,))


def test_two_of_the_same_weapon_are_one_line():
    assert names(attacks(**AXES)) == ["Handaxe", "Unarmed Strike"]


def test_attacks_are_unsure_when_two_lines_share_a_name_but_not_their_numbers():
    worked = attacks(character_values=((12, 1, "item:Handaxe"),), **AXES)
    assert worked == Worked(None, "", "two attacks are both called Handaxe with different numbers")


def test_attacks_are_unsure_about_a_weapon_adjustment_it_does_not_read():
    worked = attacks(character_values=((30, 12, "item:Mace"),), **MACE)
    assert worked == Worked(None, "", "Mace carries an adjustment this calculator does not read")


def test_attacks_are_unsure_about_a_weapon_with_no_damage_dice():
    worked = attacks(inventory=(held("Net"),), item_details={"Net": weapon(None)}, modifiers=(MARTIAL_WEAPONS,))
    assert worked == Worked(None, "", "Net has no damage dice in the data")


@pytest.mark.parametrize("kind", sorted(calc.WEAPON_UNKNOWN))
def test_attacks_are_unsure_about_a_kind_of_weapon_modifier_it_does_not_know(kind):
    assert attacks(modifiers=(("class", kind, "longsword", None),)) \
        == Worked(None, "", f"a weapon rule this calculator does not know ({kind})")


def test_attacks_are_unsure_with_a_martial_arts_die_in_play():
    assert attacks(class_features=(("Martial Arts", None, None),), **MACE) \
        == Worked(None, "", "a Martial Arts die is in play, which this calculator does not work out")


def test_attacks_are_unsure_for_a_pact_weapon_made_magical_by_name_or_a_magic_weapon_ability_swap():
    pact = {**MACE, "modifiers": (SIMPLE_WEAPONS, ("class", "enable-feature", calc.PACT_WEAPON, None))}
    data = character(classes=FIGHTER, stats=STRONG, character_values=((28, True, "item:Mace"),), **pact)
    data["options"] = {"class": [{"componentId": 1, "definition": {"id": 9, "name": calc.PACT_BY_NAME}}]}
    assert read(data).attacks.unsure == "Mace is an improved pact weapon, which this calculator does not work out"
    swap = dict(inventory=(held("Mace, +1", magic=True),), item_details={"Mace, +1": weapon("1d6")},
                modifiers=(("class", "bonus", "magic-item-attack-with-intelligence", None),))
    assert attacks(**swap).unsure == "Mace, +1 may attack with another ability, which this calculator does not work out"


def test_attacks_are_unsure_when_the_level_comes_from_experience_points():
    data = character(classes=FIGHTER, stats=STRONG, **MACE)
    data["preferences"]["progressionType"] = 2
    assert read(data).attacks.unsure \
        == "the character levels by experience points, which this calculator does not turn into a level"
    first = character(classes=(("Fighter", 1, "", None),), stats=STRONG, xp=0, **MACE)
    first["preferences"]["progressionType"] = 2
    assert read(first).attacks.unsure == ""


# --- attack lines: unarmed strike and actions ---------------------------

def test_unarmed_strike_is_always_there_with_a_flat_damage():
    assert line(attacks(), "Unarmed Strike") == ("+6", "4 bludgeoning")
    assert line(attacks(stats=(10, 14, 14, 10, 12, 8)), "Unarmed Strike") == ("+3", "1 bludgeoning")
    assert line(attacks(stats=(4, 14, 14, 10, 12, 8)), "Unarmed Strike") == ("+0", "0 bludgeoning")


def test_unarmed_strike_takes_the_players_bonus_and_a_damage_die():
    assert line(attacks(character_values=((12, 4, "unarmed"),)), "Unarmed Strike") == ("+10", "4 bludgeoning")
    brawler = (("feat", "set", "unarmed-damage-die", None, {"dice": dice("1d4")}),)
    assert line(attacks(modifiers=brawler), "Unarmed Strike") == ("+6", "1d4+3 bludgeoning")
    assert attacks(character_values=((30, 8, "unarmed"),)).unsure \
        == "Unarmed Strike carries an adjustment this calculator does not read"


TAIL = {"id": "31", "entityTypeId": "236559934", "name": "Tail Lash", "actionType": 1, "statId": 1, "rangeId": 1,
        "isProficient": True, "diceCount": 1, "diceType": 8, "fixedValue": None, "damageTypeId": 1,
        "saveStatId": None, "fixedSaveDc": None, "toHitBonus": None, "damageBonus": None, "displayAsAttack": None}


def test_a_custom_action_from_the_data_is_an_attack_line():
    assert line(attacks(custom_actions=(TAIL,)), "Tail Lash") == ("+6", "1d8+3 bludgeoning")
    assert line(attacks(custom_actions=({**TAIL, "isProficient": False, "statId": 2, "rangeId": 2},)), "Tail Lash") \
        == ("+2", "1d8+2 bludgeoning")


def test_an_empty_custom_action_is_not_an_attack():
    blank = {k: None for k in TAIL} | {"id": "32", "name": "Custom Action 1", "actionType": 1}
    assert names(attacks(custom_actions=(blank,))) == ["Unarmed Strike"]


def test_attacks_are_unsure_about_a_custom_action_with_its_own_bonus():
    assert attacks(custom_actions=({**TAIL, "toHitBonus": 2},)).unsure \
        == "Tail Lash carries its own bonus, which this calculator does not read"


def test_a_features_save_for_damage_is_a_dc_line_without_an_ability_in_the_damage():
    breath = attack_action("Fire Breath", abilityModifierStatId=3, saveStatId=2, dice=dice("5d6"),
                           damageTypeId=7, displayAsAttack=True)
    assert line(attacks(actions=(("race", breath),)), "Fire Breath") == ("DC 13", "5d6 fire")
    fixed = attack_action("Fire Breath", saveStatId=2, fixedSaveDc=15, dice=dice("2d6"), damageTypeId=7, displayAsAttack=True)
    assert line(attacks(actions=(("race", fixed),)), "Fire Breath") == ("DC 15", "2d6 fire")


def test_a_features_save_with_no_damage_has_an_empty_damage():
    shove = attack_action("Mind Shove", abilityModifierStatId=5, saveStatId=1, displayAsAttack=True)
    assert line(attacks(actions=(("feat", shove),)), "Mind Shove") == ("DC 12", "")


def test_a_features_attack_roll_from_the_data():
    claw = attack_action("Claws", actionType=1, attackSubtype=2, attackTypeRange=1, isProficient=True,
                         dice=dice("1d6"), damageTypeId=3)
    assert line(attacks(actions=(("race", claw),)), "Claws") == ("+6", "1d6+3 slashing")
    fixed = attack_action("Claws", actionType=1, attackTypeRange=1, fixedToHit=9, dice=dice("1d6"), damageTypeId=3)
    assert line(attacks(actions=(("race", fixed),)), "Claws")[0] == "+9"


def test_the_characters_own_armour_class_adjustments_are_not_taken_for_an_actions():
    breath = attack_action("Fire Breath", abilityModifierStatId=3, saveStatId=2, dice=dice("5d6"), displayAsAttack=True)
    breath["id"] = breath["entityTypeId"] = None
    worked = attacks(actions=(("race", breath),), character_values=((2, 1, None),))
    assert line(worked, "Fire Breath")[0] == "DC 13"


def test_a_feature_with_dice_but_no_roll_to_make_is_left_out():
    sneak = attack_action("Sneak Attack", dice=dice("2d6"), displayAsAttack=True)
    hidden = attack_action("Force Bolt", ident=701, attackTypeRange=2, abilityModifierStatId=4, isProficient=True,
                           dice=dice("2d8"), displayAsAttack=False)
    assert names(attacks(actions=(("class", sneak), ("class", hidden)))) == ["Unarmed Strike"]


def test_the_players_adjustments_on_a_features_action():
    breath = attack_action("Fire Breath", ident=55, abilityModifierStatId=3, saveStatId=2, dice=dice("5d6"),
                           damageTypeId=7, displayAsAttack=True)
    shown = dict(actions=(("race", breath),))
    assert line(attacks(character_values=((14, 1, "55", ACTION), (10, 2, "55", ACTION)), **shown), "Fire Breath") \
        == ("DC 14", "5d6+2 fire")
    assert line(attacks(character_values=((15, 18, "55", ACTION),), **shown), "Fire Breath")[0] == "DC 18"
    assert names(attacks(character_values=((16, False, "55", ACTION),), **shown)) == ["Unarmed Strike"]
    assert attacks(character_values=((30, 8, "55", ACTION),), **shown).unsure \
        == "Fire Breath carries an adjustment this calculator does not read"


def test_attacks_are_unsure_about_an_attack_whose_ability_the_data_does_not_name():
    bolt = attack_action("Zzyx Bolt", actionType=2, attackTypeRange=2, isProficient=True, dice=dice("1d8"))
    assert attacks(actions=(("class", bolt),)).unsure == "Zzyx Bolt does not name the ability it attacks with"


# --- attack lines: damage cantrips --------------------------------------

def wizard(level, **kw):
    return attacks(classes=(("Wizard", level, "", 4),), stats=(8, 14, 14, 16, 12, 10), **kw)


def known(name, source="Wizard", level=0):
    return (name, level, True, False, False, False, (1, 2), source)


FIRE_BOLT = {"Fire Bolt": cantrip("1d10", "fire", attack=2, tiers=((5, "2d10"), (11, "3d10"), (17, "4d10")))}
SACRED_FLAME = {"Sacred Flame": cantrip("1d8", "radiant", save=2, tiers=((5, "2d8"), (11, "3d8"), (17, "4d8")))}


@pytest.mark.parametrize("level, hit, damage", [(1, "+5", "1d10 fire"), (5, "+6", "2d10 fire"),
                                                (11, "+7", "3d10 fire"), (17, "+9", "4d10 fire")])
def test_an_attack_roll_cantrip_by_level(level, hit, damage):
    assert line(wizard(level, spells=(known("Fire Bolt"),), spell_details=FIRE_BOLT), "Fire Bolt") == (hit, damage)


@pytest.mark.parametrize("level, hit, damage", [(1, "DC 13", "1d8 radiant"), (5, "DC 14", "2d8 radiant"),
                                                (11, "DC 15", "3d8 radiant"), (17, "DC 17", "4d8 radiant")])
def test_a_save_cantrip_by_level(level, hit, damage):
    assert line(wizard(level, spells=(known("Sacred Flame"),), spell_details=SACRED_FLAME), "Sacred Flame") == (hit, damage)


def test_cantrips_that_deal_no_damage_and_levelled_spells_are_left_out():
    spells = (known("Light"), known("Fire Bolt"), known("Scorching Ray", level=2))
    details = {**FIRE_BOLT, "Light": cantrip(save=2),
               "Scorching Ray": {**cantrip("2d6", "fire", attack=2), "level": 2}}
    assert names(wizard(5, spells=spells, spell_details=details)) == ["Unarmed Strike", "Fire Bolt"]


def test_a_cantrip_cast_as_part_of_a_weapon_attack_is_not_a_line():
    blade = {"Zzyx Strike": cantrip("1d8", "thunder", attack=1, asPartOfWeaponAttack=True)}
    assert names(wizard(5, spells=(known("Zzyx Strike"),), spell_details=blade)) == ["Unarmed Strike"]


def test_items_that_help_spell_attacks_and_save_dcs_count_for_a_classs_cantrips():
    mods = (("item", "bonus", "spell-attacks", 2), ("item", "bonus", "spell-save-dc", 1))
    worked = wizard(5, spells=(known("Fire Bolt"), known("Sacred Flame")), spell_details={**FIRE_BOLT, **SACRED_FLAME},
                    inventory=(RING,), modifiers=mods)
    assert line(worked, "Fire Bolt")[0] == "+8" and line(worked, "Sacred Flame")[0] == "DC 15"


def test_a_cantrip_that_adds_the_casting_ability_to_its_damage():
    club = {"Zzyx Club": cantrip("1d8", "bludgeoning", attack=1, primary_stat=True)}
    assert line(wizard(5, spells=(known("Zzyx Club"),), spell_details=club), "Zzyx Club") == ("+6", "1d8+3 bludgeoning")


def test_a_cantrip_with_its_own_ability_uses_it_and_loses_the_classs_bonuses():
    own = {"Fire Bolt": {**FIRE_BOLT["Fire Bolt"], "row": {"spellCastingAbilityId": 5}}}
    worked = wizard(5, spells=(known("Fire Bolt"),), spell_details=own, inventory=(RING,),
                    modifiers=(("item", "bonus", "spell-attacks", 2),))
    assert line(worked, "Fire Bolt")[0] == "+4"                       # WIS +1, proficiency +3


def test_a_feat_or_species_cantrip_uses_its_own_ability_and_the_shared_bonuses():
    stone = {"Zzyx Stone": {**cantrip("1d6", "bludgeoning", attack=2, primary_stat=True),
                            "row": {"spellCastingAbilityId": 5}}}
    worked = wizard(5, feats=(("Zzyx Initiate",),), spells=(known("Zzyx Stone", "Feat: Zzyx Initiate"),),
                    spell_details=stone, inventory=(RING,), modifiers=(("item", "bonus", "spell-attacks", 2),))
    assert line(worked, "Zzyx Stone") == ("+6", "1d6+1 bludgeoning")
    flame = {"Sacred Flame": {**SACRED_FLAME["Sacred Flame"], "row": {"spellCastingAbilityId": 5}}}
    species = wizard(5, spells=(known("Sacred Flame", "Species"),), spell_details=flame, inventory=(RING,),
                     modifiers=(("item", "bonus", "spell-save-dc", 1),))
    assert line(species, "Sacred Flame")[0] == "DC 13"                 # 8 + 3 + WIS 1 + the item's 1


def test_an_items_cantrip_borrows_the_best_casting_class():
    wand = wizard(5, spells=(known("Fire Bolt", "Item: Wand of Tests"),), spell_details=FIRE_BOLT,
                  modifiers=(("item", "bonus", "spell-attacks", 1),))
    assert line(wand, "Fire Bolt") == ("+7", "2d10 fire")
    assert line(attacks(spells=(known("Fire Bolt", "Item: Wand of Tests"),), spell_details=FIRE_BOLT), "Fire Bolt")[0] == "+3"


def test_a_cantrips_damage_bonuses():
    blast = {"Eldritch Blast": cantrip("1d10", "force", attack=2)}
    agony = (("class", "eldritch-blast", "bonus-damage", None, {"statId": 4}),)
    assert line(wizard(5, spells=(known("Eldritch Blast"),), spell_details=blast, modifiers=agony), "Eldritch Blast") \
        == ("+6", "1d10+3 force")
    assert line(wizard(5, spells=(known("Fire Bolt"),), spell_details=FIRE_BOLT, modifiers=agony), "Fire Bolt")[1] == "2d10 fire"
    potent = (("class", "bonus", "wizard-cantrip-damage", 3),)
    stronger = wizard(5, spells=(known("Fire Bolt"),), spell_details=FIRE_BOLT, modifiers=potent)
    assert line(stronger, "Fire Bolt")[1] == "2d10+3 fire"


def test_a_cantrip_with_a_choice_of_damage_type_shows_the_dice_alone():
    burst = cantrip("1d8", "acid", attack=2)
    burst["modifiers"].append({**burst["modifiers"][0], "subType": "cold"})
    assert line(wizard(1, spells=(known("Zzyx Burst"),), spell_details={"Zzyx Burst": burst}), "Zzyx Burst") == ("+5", "1d8")


def test_attacks_are_unsure_about_a_cantrip_with_two_different_damage_lines():
    two = cantrip("1d8", "acid", attack=2)
    two["modifiers"].append({**two["modifiers"][0], "die": dice("1d12")})
    assert wizard(1, spells=(known("Zzyx Toll"),), spell_details={"Zzyx Toll": two}).unsure \
        == "Zzyx Toll has more than one damage line"


def test_the_same_cantrip_from_two_sources_with_different_numbers_is_unsure():
    twice = wizard(5, spells=(known("Fire Bolt"), known("Fire Bolt", "Species")), spell_details=FIRE_BOLT)
    assert twice.unsure == "two attacks are both called Fire Bolt with different numbers"


# --- order, safety ------------------------------------------------------

def test_the_lines_come_weapons_first_then_unarmed_strike_actions_and_cantrips():
    worked = attacks(classes=(("Wizard", 5, "", 4),), custom_actions=(TAIL,),
                     inventory=(held("Mace"), held("Club")),
                     item_details={"Mace": weapon("1d6", "Bludgeoning"), "Club": weapon("1d4", "Bludgeoning")},
                     spells=(known("Fire Bolt"),), spell_details=FIRE_BOLT)
    assert names(worked) == ["Club", "Mace", "Unarmed Strike", "Tail Lash", "Fire Bolt"]


def test_every_name_passes_the_safe_name_rule():
    worked = attacks(custom_actions=({**TAIL, "name": "Tail | Lash <b>"},))
    assert "Tail Lash b" in names(worked)


HOSTILE = [None, 7, "text", [], {}, {"classes": "x"}, {"classes": [{"level": 3}]}]


@pytest.mark.parametrize("data", HOSTILE)
def test_data_that_is_not_a_character_is_unsure_not_an_error(data):
    c = read(character())
    for work in (calc.hp_max, calc.armour_class, calc.attacks):
        worked = work(data, c)
        assert worked.value is None and worked.unsure


def test_a_reason_built_from_the_data_is_safe_to_write():
    worked = ac(modifiers=(("race", "bonus", "armor-class | <b>", 1),))
    assert worked.unsure == "an armour class rule this calculator does not know (bonus armor-class b)"
    renamed = attacks(character_values=((8, "Old | Faithful", "item:Mace"), (30, 1, "item:Mace")), **MACE)
    assert renamed.unsure == "Old Faithful carries an adjustment this calculator does not read"


def test_odd_values_inside_a_character_never_raise():
    data = character(classes=FIGHTER, stats=STRONG, hit_points={"base": 22}, custom_actions=(TAIL,),
                     inventory=(held("Mace"), held("Leather", "armor")),
                     item_details={"Mace": weapon("1d6"), "Leather": armour(11)},
                     spells=(known("Fire Bolt", "Species"),), spell_details=FIRE_BOLT, modifiers=(SIMPLE_WEAPONS,))
    c = read(data)
    data["inventory"][0]["definition"].update(damage="1d6", properties="Finesse", attackType="melee", weaponBehaviors=7)
    data["inventory"][1]["definition"].update(armorClass="eleven")
    data["modifiers"]["race"] = [None, 3, {"type": "bonus", "subType": None, "value": "x"}, {"type": 4},
                                 {"type": [], "subType": {}, "componentId": []}]
    data["characterValues"] = [None, {"typeId": "x"}, {"typeId": 12, "value": {}, "valueId": [], "valueTypeId": None}]
    data["actions"] = {"race": "none", "class": [None, {"name": 5, "displayAsAttack": True, "dice": "2d6", "saveStatId": "x"}]}
    data["customActions"] = [None, {"name": None, "rangeId": "far", "statId": 99}]
    data["spells"]["race"][0]["definition"]["modifiers"] = [None, {"type": "damage", "die": "1d10", "atHigherLevels": 5}]
    data["classSpells"] = [None, {"characterClassId": 1000, "spells": [None, {"definition": 5}]}]
    data["preferences"] = None
    for work in (calc.hp_max, calc.armour_class, calc.attacks):
        assert isinstance(work(data, c), Worked)
