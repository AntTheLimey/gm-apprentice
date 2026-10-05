#!/usr/bin/env python3
"""D&D 5e (2024) class numbers for the rules checks. Data and lookups only.

Every number is from the D&D 5.2 SRD (CC-BY 4.0): each class's hit die,
saving throws, cantrips and prepared spells by level; the spell slot
table; the Warlock's pact slots. No rules text. tests/test_dnd_tables.py
holds these against classes.md so the two cannot drift. Stdlib only.
"""

from dataclasses import dataclass

FULL, HALF_CASTER, PACT, NONE = "full", "half", "pact", "none"


@dataclass(frozen=True)
class ClassInfo:
    name: str
    die: int
    saves: tuple[str, str]
    caster: str
    cantrips: tuple[int, ...] = (0,) * 20
    prepared: tuple[int, ...] = (0,) * 20


_TWO = (2,) * 3 + (3,) * 6 + (4,) * 11
_THREE = (3,) * 3 + (4,) * 6 + (5,) * 11
_FOUR = (4,) * 3 + (5,) * 6 + (6,) * 11
_FULL = (4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22)
_HALF = (2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15)
_WIZARD = (4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25)
_WARLOCK = (2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15)

CLASSES: dict[str, ClassInfo] = {c.name.lower(): c for c in (
    ClassInfo("Barbarian", 12, ("STR", "CON"), NONE),
    ClassInfo("Bard", 8, ("DEX", "CHA"), FULL, _TWO, _FULL),
    ClassInfo("Cleric", 8, ("WIS", "CHA"), FULL, _THREE, _FULL),
    ClassInfo("Druid", 8, ("INT", "WIS"), FULL, _TWO, _FULL),
    ClassInfo("Fighter", 10, ("STR", "CON"), NONE),
    ClassInfo("Monk", 8, ("STR", "DEX"), NONE),
    ClassInfo("Paladin", 10, ("WIS", "CHA"), HALF_CASTER, (0,) * 20, _HALF),
    ClassInfo("Ranger", 10, ("STR", "DEX"), HALF_CASTER, (0,) * 20, _HALF),
    ClassInfo("Rogue", 8, ("DEX", "INT"), NONE),
    ClassInfo("Sorcerer", 6, ("CON", "CHA"), FULL, _FOUR, (2, 4) + _FULL[2:]),
    ClassInfo("Warlock", 8, ("WIS", "CHA"), PACT, _TWO, _WARLOCK),
    ClassInfo("Wizard", 6, ("INT", "WIS"), FULL, _THREE, _WIZARD),
)}

# Slots of spell level 1-9, by caster level 1-20: the full casters' own
# table and the Multiclass Spellcaster table, which are the same. A
# Paladin's or Ranger's own table is the row for half its level, rounded up.
SLOTS: tuple[tuple[int, ...], ...] = (
    (2, 0, 0, 0, 0, 0, 0, 0, 0), (3, 0, 0, 0, 0, 0, 0, 0, 0),
    (4, 2, 0, 0, 0, 0, 0, 0, 0), (4, 3, 0, 0, 0, 0, 0, 0, 0),
    (4, 3, 2, 0, 0, 0, 0, 0, 0), (4, 3, 3, 0, 0, 0, 0, 0, 0),
    (4, 3, 3, 1, 0, 0, 0, 0, 0), (4, 3, 3, 2, 0, 0, 0, 0, 0),
    (4, 3, 3, 3, 1, 0, 0, 0, 0), (4, 3, 3, 3, 2, 0, 0, 0, 0),
    (4, 3, 3, 3, 2, 1, 0, 0, 0), (4, 3, 3, 3, 2, 1, 0, 0, 0),
    (4, 3, 3, 3, 2, 1, 1, 0, 0), (4, 3, 3, 3, 2, 1, 1, 0, 0),
    (4, 3, 3, 3, 2, 1, 1, 1, 0), (4, 3, 3, 3, 2, 1, 1, 1, 0),
    (4, 3, 3, 3, 2, 1, 1, 1, 1), (4, 3, 3, 3, 3, 1, 1, 1, 1),
    (4, 3, 3, 3, 3, 2, 1, 1, 1), (4, 3, 3, 3, 3, 2, 2, 1, 1),
)

# Warlock pact slots by Warlock level: (how many, their spell level).
PACT_SLOTS: tuple[tuple[int, int], ...] = (
    (1, 1), (2, 1), (2, 2), (2, 2), (2, 3), (2, 3), (2, 4), (2, 4), (2, 5), (2, 5),
    (3, 5), (3, 5), (3, 5), (3, 5), (3, 5), (3, 5), (4, 5), (4, 5), (4, 5), (4, 5),
)
# Warlock levels that each add one Mystic Arcanum spell, of level 6, 7, 8
# and 9 in turn.
ARCANUM = (11, 13, 15, 17)


# Cantrips a class option can add: class -> (class level it arrives, most it adds).
# Cleric Thaumaturge, Druid Magician, Paladin Blessed Warrior, Ranger Druidic
# Warrior, Warlock Pact of the Tome.
CANTRIP_OPTIONS: dict[str, tuple[int, int]] = {
    "cleric": (1, 1), "druid": (1, 1), "paladin": (2, 2), "ranger": (2, 2), "warlock": (1, 3),
}


def known(name: str) -> ClassInfo | None:
    return CLASSES.get(name.strip().lower())


def caster_level(levels: dict[str, int]) -> int:
    """Full-caster levels plus half the Paladin and Ranger levels, rounded up."""
    total = 0
    for name, level in levels.items():
        kind = CLASSES[name].caster
        if kind == FULL:
            total += level
        elif kind == HALF_CASTER:
            total += (level + 1) // 2
    return total


def slots_for(levels: dict[str, int]) -> list[int]:
    """Slot totals for spell levels 1-9, pact slots added to their level."""
    at = min(caster_level(levels), 20)
    row = list(SLOTS[at - 1]) if at else [0] * 9
    lock = levels.get("warlock", 0)
    if lock:
        count, slot_level = PACT_SLOTS[lock - 1]
        row[slot_level - 1] += count
    return row


def _arcanum(level: int) -> int:
    return sum(1 for at in ARCANUM if level >= at)


def max_spell_level(name: str, level: int) -> int:
    """The highest spell level the class prepares at its own level; 0 for none."""
    kind = CLASSES[name].caster
    if kind == PACT:
        return 5 + _arcanum(level) if _arcanum(level) else PACT_SLOTS[level - 1][1]
    if kind == NONE:
        return 0
    row = SLOTS[(level if kind == FULL else (level + 1) // 2) - 1]
    return max(i + 1 for i, n in enumerate(row) if n)


def cantrips_allowed(name: str, level: int) -> int:
    # The most the class's options can give, whether or not the character took them.
    arrives, extra = CANTRIP_OPTIONS.get(name, (21, 0))
    return CLASSES[name].cantrips[level - 1] + (extra if level >= arrives else 0)


def prepared_allowed(name: str, level: int) -> int:
    # Mystic Arcanum spells are chosen apart from the prepared list, but a
    # sheet lists them with the rest, so they are allowed on top.
    extra = _arcanum(level) if CLASSES[name].caster == PACT else 0
    return CLASSES[name].prepared[level - 1] + extra
