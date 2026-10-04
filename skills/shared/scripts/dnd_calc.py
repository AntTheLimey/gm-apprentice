#!/usr/bin/env python3
"""Pure D&D 5e (2024) sheet arithmetic. No I/O, no parsing — formulas only.

Computes a character's own derived values from their scores, level and
proficiencies (the gurps_calc.py precedent: computed data, not reproduced
rules text). Formulas are from the D&D 5.2 SRD (CC-BY 4.0). Stdlib only.
"""

from fractions import Fraction

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


def half_proficiency(pb: int) -> int:
    """Half the proficiency bonus, rounded down."""
    return pb // 2


def skill(mod: int, pb: int, proficient: bool, expertise: bool, half: bool = False) -> int:
    if expertise:
        return mod + 2 * pb
    if proficient:
        return mod + pb
    return mod + (half_proficiency(pb) if half else 0)


def passive(bonus: int) -> int:
    return 10 + bonus


def spell_attack(mod: int, pb: int) -> int:
    return mod + pb


def spell_save_dc(mod: int, pb: int) -> int:
    return 8 + mod + pb


# Pounds per point of Strength score, by size: (carry, drag / lift / push).
# The SRD 5.2 rules glossary's Carrying Capacity table.
CARRY_FACTORS: dict[str, tuple[Fraction, Fraction]] = {
    "tiny": (Fraction(15, 2), Fraction(15)),
    "small": (Fraction(15), Fraction(30)),
    "medium": (Fraction(15), Fraction(30)),
    "large": (Fraction(30), Fraction(60)),
    "huge": (Fraction(60), Fraction(120)),
    "gargantuan": (Fraction(120), Fraction(240)),
}
COINS_PER_POUND = 50


def _factors(size: str) -> tuple[Fraction, Fraction]:
    """A size that is not one of the six is carried as Medium."""
    return CARRY_FACTORS.get(size.strip().lower(), CARRY_FACTORS["medium"])


def carrying_capacity(strength: int, size: str) -> Fraction:
    return strength * _factors(size)[0]


def drag_lift_push(strength: int, size: str) -> Fraction:
    return strength * _factors(size)[1]


def coin_weight(coins: int) -> Fraction:
    return Fraction(coins, COINS_PER_POUND)


def pounds(weight: "int | float | Fraction") -> str:
    """'412 lb', '41.5 lb': whole, or one decimal rounded half up."""
    exact = Fraction(str(weight)) if isinstance(weight, float) else Fraction(weight)
    tenths = (exact * 10 + Fraction(1, 2)).__floor__()
    whole, tenth = divmod(tenths, 10)
    return f"{whole}.{tenth} lb" if tenth else f"{whole} lb"


def signed(n: int) -> str:
    """'+3', '+0', '-1' (ASCII minus, as the templates write it)."""
    return f"+{n}" if n >= 0 else f"-{-n}"
