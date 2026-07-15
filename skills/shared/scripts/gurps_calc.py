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


def halve_up(x: int) -> int:
    """B419/B426: halve Move/Dodge/ST, rounding up. Callers keep the
    encumbrance minimum (halve_up(1) == 1)."""
    return math.ceil(x / 2)


def is_reeling(hp: int, max_hp: int) -> bool:
    """B419: reeling when current HP is strictly below 1/3 max HP.
    Integer-safe: 3*hp < max_hp (avoids float drift; strict <)."""
    return 3 * hp < max_hp


def is_tired(fp: int, max_fp: int) -> bool:
    """B426: very tired when current FP is strictly below 1/3 max FP."""
    return 3 * fp < max_fp


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


import re as _re

_DICE_RE = _re.compile(r"^\s*(\d+)\s*d\s*(?:([+\-−])\s*(\d+))?\s*$")


def thrust(st: int) -> tuple:
    """B16 thrust as (dice, adds): +1 add per 2 ST, normalized per B269."""
    if st < 19:
        return 1, (st - 1) // 2 - 6
    v = st - 11
    if st > 50:
        v -= 1
    if st > 79:
        v -= 1 + (st - 80) // 5
    return v // 8 + 1, (v % 8) // 2 - 1


def swing(st: int) -> tuple:
    """B16 swing as (dice, adds): +1 add per ST from 10, normalized per B269."""
    if st < 10:
        return 1, (st - 1) // 2 - 5
    if st < 28:
        v = st - 9
        return v // 4 + 1, v % 4 - 1
    v = st
    if st > 40:
        v -= (st - 40) // 5
    if st > 59:
        v += 1
    v += 9
    return v // 8 + 1, (v % 8) // 2 - 1


def fmt_dice(dice: int, adds: int) -> str:
    if adds == 0:
        return f"{dice}d"
    return f"{dice}d{adds:+d}"


def parse_dice(s: str):
    """Parse '2d+1' / '3d-1' / '1d' -> (dice, adds); None if not dice."""
    m = _DICE_RE.match(str(s))
    if not m:
        return None
    adds = int(m.group(3)) if m.group(3) else 0
    if m.group(2) in ("-", "−"):
        adds = -adds
    return int(m.group(1)), adds


def dice_adds(dice: int, adds: int) -> int:
    """B269 equivalence key: any +4 becomes 1d, so 4*dice + adds
    identifies a damage roll up to legal rewrites (2d+5 == 3d+1)."""
    return 4 * dice + adds


# --- skill point costs (B170) ---

DIFFICULTY_OFFSETS = {"E": 0, "A": 1, "H": 2, "VH": 3}

# B17 (climbing/stealth/swimming), B203 (judo/karate), fencing category B208
# (rapier/saber/smallsword/main-gauche) — all take -encumbrance-level. Perk
# offsets (Armor Familiarity, MA49) belong to the reconciliation pass, not here.
ENC_PENALIZED_SKILLS = ("climbing", "stealth", "swimming", "judo", "karate",
                        "rapier", "saber", "smallsword", "main-gauche")


def skill_relative_level(points: int, difficulty: str):
    """B170 closed form: points spent -> level relative to attribute.

    Above-attribute progression: 1 pt -> +0, 2-3 pt -> +1, then
    2 + (points - 4) // 4 for 4+ pt (cost-is-the-difference means
    intermediate totals hold the lower level). The difficulty offset
    (E/A/H/VH = 0/1/2/3) shifts the result down. Returns None for an
    unknown difficulty code or points < 1.
    """
    d = DIFFICULTY_OFFSETS.get(str(difficulty).strip().upper())
    if d is None or points is None or points < 1:
        return None
    if points < 2:
        r = 0
    elif points < 4:
        r = 1
    else:
        r = 2 + (points - 4) // 4
    return r - d
