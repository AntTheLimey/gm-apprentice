#!/usr/bin/env python3
"""Pure D&D 5e (2024) sheet arithmetic. No I/O, no parsing — formulas only.

Computes a character's own derived values from their scores, level and
proficiencies (the gurps_calc.py precedent: computed data, not reproduced
rules text). Formulas are from the D&D 5.2 SRD (CC-BY 4.0). Stdlib only.
"""

ABILITIES = ("STR", "DEX", "CON", "INT", "WIS", "CHA")


def ability_mod(score: int) -> int:
    return (score - 10) // 2


def proficiency_bonus(level: int) -> int:
    """By total character level, 1-20."""
    if not 1 <= level <= 20:
        raise ValueError(f"level {level} is not 1-20")
    return 2 + (level - 1) // 4


def save(mod: int, pb: int, proficient: bool) -> int:
    return mod + (pb if proficient else 0)


def skill(mod: int, pb: int, proficient: bool, expertise: bool) -> int:
    if expertise:
        return mod + 2 * pb
    return mod + (pb if proficient else 0)


def passive(bonus: int) -> int:
    return 10 + bonus


def spell_attack(mod: int, pb: int) -> int:
    return mod + pb


def spell_save_dc(mod: int, pb: int) -> int:
    return 8 + mod + pb


def signed(n: int) -> str:
    """'+3', '+0', '-1' (ASCII minus, as the templates write it)."""
    return f"+{n}" if n >= 0 else f"-{-n}"
