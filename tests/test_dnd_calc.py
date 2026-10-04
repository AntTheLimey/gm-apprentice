#!/usr/bin/env python3
"""Tests for dnd_calc.py: D&D 5e (2024) sheet arithmetic (SRD 5.2)."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "shared" / "scripts"))

import dnd_calc as dc  # noqa: E402


def test_ability_mod_rounds_down():
    assert [dc.ability_mod(s) for s in (1, 8, 9, 10, 11, 17, 20, 30)] == \
        [-5, -1, -1, 0, 0, 3, 5, 10]


def test_proficiency_bonus_by_level():
    assert [dc.proficiency_bonus(n) for n in (1, 4, 5, 8, 9, 12, 13, 16, 17, 20)] == \
        [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]


@pytest.mark.parametrize("level", [0, 21, -1])
def test_proficiency_bonus_refuses_bad_level(level):
    with pytest.raises(ValueError):
        dc.proficiency_bonus(level)


def test_save_and_skill():
    assert dc.save(3, 3, True) == 6
    assert dc.save(3, 3, False) == 3
    assert dc.skill(1, 3, False, False) == 1
    assert dc.skill(1, 3, True, False) == 4
    assert dc.skill(1, 3, True, True) == 7
    assert dc.skill(1, 3, False, True) == 7   # expertise implies proficiency


def test_half_proficiency_rounds_down():
    assert [dc.half_proficiency(pb) for pb in (2, 3, 4, 5, 6)] == [1, 1, 2, 2, 3]
    assert dc.skill(1, 3, False, False, half=True) == 2
    assert dc.skill(-1, 5, False, False, half=True) == 1
    # A full proficiency is not also halved.
    assert dc.skill(1, 3, True, False, half=True) == 4


def test_carrying_follows_size_and_strength():
    assert dc.carrying_capacity(15, "Medium") == 225
    assert dc.carrying_capacity(15, "small") == 225
    assert dc.drag_lift_push(15, "Medium") == 450
    assert dc.carrying_capacity(9, "Tiny") == 67.5
    assert dc.drag_lift_push(9, "Tiny") == 135
    assert dc.carrying_capacity(20, "Large") == 600
    assert dc.drag_lift_push(20, "Huge") == 2400
    assert dc.carrying_capacity(10, "Gargantuan") == 1200
    # An unknown size is carried as Medium.
    assert dc.carrying_capacity(10, "enormous") == 150
    assert dc.carrying_capacity(10, "") == 150


def test_coins_weigh_fifty_to_the_pound():
    assert dc.coin_weight(50) == 1
    assert dc.coin_weight(125) == 2.5
    assert dc.coin_weight(0) == 0


def test_pounds_are_whole_or_one_decimal():
    assert [dc.pounds(w) for w in (412, 412.0, 41.5, 0, 0.25, 0.26, 2.04, 67.5)] == \
        ["412 lb", "412 lb", "41.5 lb", "0 lb", "0.3 lb", "0.3 lb", "2 lb", "67.5 lb"]


def test_passive_and_spells():
    assert dc.passive(4) == 14
    assert dc.spell_attack(3, 3) == 6
    assert dc.spell_save_dc(3, 3) == 14


def test_signed_uses_ascii_minus():
    assert [dc.signed(n) for n in (-1, 0, 7)] == ["-1", "+0", "+7"]
