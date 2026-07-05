#!/usr/bin/env python3
"""Pure GURPS 4e arithmetic. No I/O, no parsing — formulas only.

Computes a character's own derived values from their attributes
(the derived.js precedent: computed data, not reproduced rules text).
Page references are GURPS Basic Set 4e. Stdlib only.
"""

import math

# (level name, level number, Basic Lift multiplier) — B17
ENC_LEVELS = [
    ("None", 0, 1),
    ("Light", 1, 2),
    ("Medium", 2, 3),
    ("Heavy", 3, 6),
    ("X-Heavy", 4, 10),
]


def _round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def basic_lift(st: int) -> float:
    """B15: ST^2/5 lb; round to nearest whole if 10 or more."""
    bl = st * st / 5.0
    return float(_round_half_up(bl)) if bl >= 10 else round(bl, 2)


def enc_max_weights(bl: float) -> list:
    """B17: the five encumbrance thresholds for a given Basic Lift."""
    return [(name, level, bl * mult) for name, level, mult in ENC_LEVELS]


def enc_move(basic_move: int, level: int) -> int:
    """B17: Move x1/0.8/0.6/0.4/0.2 by level, drop fractions, minimum 1."""
    return max(1, basic_move * (5 - level) // 5)


def enc_dodge(basic_speed: float, level: int, combat_reflexes: bool = False) -> int:
    """B17/B326: Basic Speed + 3 (drop fractions), +1 CR, -1 per level."""
    return int(basic_speed) + 3 + (1 if combat_reflexes else 0) - level


def secondaries(st: int, dx: int, iq: int, ht: int) -> dict:
    """B15-B17 base values before bought adjustments."""
    speed = (dx + ht) / 4.0
    return {"hp": st, "will": iq, "per": iq, "fp": ht,
            "speed": speed, "move": int(speed)}


def parry(skill: int, combat_reflexes: bool = False) -> int:
    """B376: 3 + skill/2 (drop fractions), +1 Combat Reflexes."""
    return 3 + skill // 2 + (1 if combat_reflexes else 0)


def block(skill: int, combat_reflexes: bool = False) -> int:
    """B375: 3 + Shield skill/2 (drop fractions), +1 Combat Reflexes."""
    return 3 + skill // 2 + (1 if combat_reflexes else 0)
