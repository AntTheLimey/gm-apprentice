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


def test_passive_and_spells():
    assert dc.passive(4) == 14
    assert dc.spell_attack(3, 3) == 6
    assert dc.spell_save_dc(3, 3) == 14


def test_signed_uses_ascii_minus():
    assert [dc.signed(n) for n in (-1, 0, 7)] == ["-1", "+0", "+7"]
