#!/usr/bin/env python3
"""Hit point maximum, armour class and attack lines from a D&D Beyond character. No I/O.

D&D Beyond's data holds the pieces of these three (a rolled total, the armour
worn, each weapon and the modifiers that touch them) but not the finished
numbers; the site adds them up in the browser. This is our own adding-up, in
the order the site's sheet uses, held to the site's finished numbers for a
set of real characters before it shipped.

Each function returns a `Worked`: a value, or `None` with the reason it is
unsure. It is unsure whenever the data holds something that bears on the
number and that it does not handle. It never guesses, and it never raises:
data it cannot read at all is one more reason to be unsure.

An attack line is a row for the note's weapons table:
  - each weapon in hand (a staff or other gear that behaves as a weapon too),
    unless the player hid it;
  - Unarmed Strike;
  - an action of a species, class or feat, or one the player wrote, that the
    data shows as an attack and that has a roll to hit or a save DC;
  - a cantrip that deals damage, with its roll to hit or its save DC.
Left out: a feature that is only dice (extra damage, a table roll), a
levelled spell, a cantrip cast as part of a weapon attack, anything the
player hid. One line that cannot be worked out makes the whole list unsure.

Stdlib only.
"""

import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dnd_ddb_read import (ABILITIES, ABILITY_WORDS, CLASS_FEATURE, ITEM_ROW_TYPE, Attack,  # noqa: E402
                          Character, Unreadable, Worked, _ability_mod, _char_values, _class_rows,
                          _dict, _dicts, _equipped, _int, _inventory, _item_name, _live_item,
                          _live_modifiers, _num, _of, _text, _worth, safe_name)

__all__ = ["Attack", "Worked", "armour_class", "attacks", "hp_max"]

WEAPON_BASE, WEAPON_CATEGORY, OPTION = 1782728300, 660121713, 258900837
UNARMED_ID, UNARMED_TYPE = "1", 1120657896        # the Unarmed Strike every character has
LIGHT, MEDIUM, HEAVY, SHIELD = 1, 2, 3, 4         # armour type ids
NO_ARMOUR = 10
DICE_LADDER = (4, 6, 8, 10, 12, 20)               # a versatile weapon in two hands rolls the next die up
DAMAGE_TYPES = {1: "bludgeoning", 2: "piercing", 3: "slashing", 4: "necrotic", 5: "acid", 6: "cold", 7: "fire",
                8: "lightning", 9: "thunder", 10: "poison", 11: "psychic", 12: "radiant", 13: "force"}
DAMAGE_WORDS = frozenset(DAMAGE_TYPES.values())

HP_KNOWN = frozenset((("bonus", "hit-points"), ("bonus", "hit-points-per-level"), ("bonus", "temporary-hit-points")))
AC_KNOWN = frozenset((
    ("set", "unarmored-armor-class"), ("set", "ac-max-dex-modifier"), ("set", "ac-max-dex-armored-modifier"),
    ("set", "ac-max-dex-unarmored-modifier"), ("bonus", "armor-class"), ("bonus", "armored-armor-class"),
    ("bonus", "unarmored-armor-class"), ("bonus", "dual-wield-armor-class"),
    ("ignore", "unarmored-dex-ac-bonus"), ("ignore", "unarmored-while-armored")))
BRANCHING = frozenset((("set", "unarmored-armor-class"), ("ignore", "unarmored-dex-ac-bonus"),
                       ("ignore", "unarmored-while-armored")))
# Kinds of modifier that change how a weapon attacks in ways this calculator does not follow.
WEAPON_UNKNOWN = frozenset(("natural-weapon",))
PACT_WEAPON = "enable-pact-weapon"                # the feature that lets a weapon be marked as a pact weapon
# D&D Beyond keys a few rules on a name alone, and those names are from outside the free
# rules, so they are held here as digests and never written. A name is matched by putting
# it through `_digest` (lower case, single spaces, SHA-256).
#   armour class trait: a species trait with an armour class rule of its own (unsure)
#   pact option: the class option that makes a pact weapon magical (unsure)
#   marked weapon: the feature, beside the pact one, that lets a weapon be marked as its own
#   weapon kind: a kind of modifier that changes how a weapon attacks (unsure)
BY_NAME: dict[str, frozenset[str]] = {
    "armour class trait": frozenset(("25c865a5c9f3f910296f5133d5940cd71758778d1810e25b71e6d88d3cb201e1",
                                     "1e91b168f61983b2805fc4e2e194fdf49cdc9a3c36f3f5aa41c9723ecefd6cab")),
    "pact option": frozenset(("9bf5d2d564ae0708ab4acc8a7a75ff0ee7d88b31670316f92d87ea9876d4653c",)),
    "marked weapon": frozenset(("f4d64f38e6970dd92406719676b6772e75628fef819c38be92c1627ded206e5c",)),
    "weapon kind": frozenset(("00b4b01c51972f6cd1c3d31a8619853a2adfd2f9c032c1a9a0a4d314c04df1c8",)),
}

# The player's own adjustments (characterValues type ids) each sum reads. Any other on the
# thing being worked out is a reason to be unsure. 8 name, 9 notes, 19 cost, 20 silvered,
# 21 adamantine and 22 weight change no number; 10 damage bonus, 12 to-hit bonus,
# 13 to-hit override, 14 save DC bonus, 15 save DC override, 16 shown as an attack,
# 18 off hand, 28 pact weapon, 29 the other marked weapon.
NO_NUMBER = frozenset((8, 9, 19, 20, 21, 22))
ARMOUR_READ = NO_NUMBER
WEAPON_READ = NO_NUMBER | {10, 12, 13, 16, 18, 28, 29}
ROLL_READ = NO_NUMBER | {10, 12, 13, 14, 15, 16}

Die = tuple[int, int, int]                        # count, size, the fixed number added
Parts = list[tuple[str, int]]


class _Unsure(Exception):
    """The data holds something this calculator does not handle. str(e) is one plain clause,
    put together from this file's own words and names already through `safe_name`."""


@dataclass
class _Sheet:
    """What the three sums read, gathered once."""
    d: dict
    c: Character
    classes: list[dict]
    worn: list[dict]                              # inventory rows this character has equipped
    values: dict[tuple[int, str, str], object]
    by_origin: dict[str, list[dict]]              # race, class, feat, background, item
    shared: list[dict]                            # every modifier that counts for the whole character
    pb: int
    attuned: int
    owner: dict[int, int]                         # class feature or option id -> index of its class
    names: dict[tuple[int, int | None], str]      # (id, kind) of a feature, trait, feat or item -> its name


# --- gathering ------------------------------------------------------------------------------

def _own(d: dict, row: dict) -> list[dict]:
    """The modifiers that belong to this inventory row's item, attuned or not."""
    defn = _dict(row.get("definition"))
    ident, kind = defn.get("id"), _num(defn.get("entityTypeId"))
    return [m for m in _dicts(_dict(d.get("modifiers")).get("item"))
            if m.get("componentId") == ident and ident is not None
            and (kind is None or _num(m.get("componentTypeId")) in (None, kind))]


def _counts(m: dict, row: dict) -> bool:
    """An item's modifier is live unless it wants attunement the item could have and lacks."""
    return not (m.get("requiresAttunement") and _dict(row.get("definition")).get("canAttune")) or bool(row.get("isAttuned"))


def _armour_kind(row: dict) -> int | None:
    kind = _num(_dict(row.get("definition")).get("armorTypeId"))
    return kind if kind in (LIGHT, MEDIUM, HEAVY, SHIELD) else None


def _weapon_facts(row: dict) -> dict | None:
    """Where a row's weapon numbers are: its definition, or for gear that can be swung
    (a staff) the weapon it behaves as. None when it is not a weapon."""
    defn = _dict(row.get("definition"))
    if _num(defn.get("baseTypeId")) == WEAPON_BASE or defn.get("filterType") == "Weapon":
        return defn
    behaves = _dicts(defn.get("weaponBehaviors"))
    return behaves[0] if behaves else None


def _stays_on_item(m: dict, row: dict) -> bool:
    """Modifiers that act on the item itself and so are kept out of the shared list: armour's
    own armour class bonus, a weapon's own magic bonus, damage type, property and extra damage."""
    kind, sub = m.get("type"), _text(m.get("subType"))
    if kind == "proficiency" and sub == "self":
        return True
    if _armour_kind(row) is not None and (kind, sub) == ("bonus", "armor-class"):
        return True
    if _weapon_facts(row) is not None:
        return (kind, sub) == ("bonus", "magic") or kind in ("replace-damage-type", "weapon-property") \
            or (kind == "damage" and sub in DAMAGE_WORDS)
    return False


def _owners(d: dict, classes: list[dict]) -> dict[int, int]:
    owner: dict[int, int] = {}
    for i, c in enumerate(classes):
        for cf in _dicts(c.get("classFeatures")):
            fid = _num(_dict(cf.get("definition")).get("id"))
            if fid is not None:
                owner[fid] = i
    for o in _dicts(_dict(d.get("options")).get("class")):   # a chosen option belongs to its feature's class
        oid, feature = _num(_dict(o.get("definition")).get("id")), _num(o.get("componentId"))
        if oid is not None and feature in owner:
            owner.setdefault(oid, owner[feature])
    return owner


def _names(d: dict, classes: list[dict], rows: list[dict], values: dict) -> dict[tuple[int, int | None], str]:
    out: dict[tuple[int, int | None], str] = {}
    defs = [_dict(cf.get("definition")) for c in classes for cf in _dicts(c.get("classFeatures"))]
    defs += [_dict(t.get("definition")) for t in _dicts(_dict(d.get("race")).get("racialTraits"))]
    defs += [_dict(f.get("definition")) for f in _dicts(d.get("feats"))]
    for group in ("class", "race", "feat"):
        defs += [_dict(o.get("definition")) for o in _dicts(_dict(d.get("options")).get(group))]
    for defn in defs:
        ident, kind = _num(defn.get("id")), _num(defn.get("entityTypeId"))
        if ident is not None and kind is not None:
            out[(ident, kind)] = safe_name(defn.get("name"))
    for row in rows:
        defn = _dict(row.get("definition"))
        ident = _num(defn.get("id"))
        if ident is not None:
            out[(ident, _num(defn.get("entityTypeId")))] = out[(ident, None)] = _item_name(row, values)
    return out


def _sheet(data: object, c: Character) -> _Sheet:
    if not isinstance(data, dict):
        raise Unreadable("not a record")
    d = data
    classes = _class_rows(d)
    rows = _inventory(d)
    values = _char_values(d)
    live = _live_modifiers(d, classes, rows)
    worn = [r for r in rows if _equipped(r, d.get("id"))]
    by_origin = {k: live[k] for k in ("race", "class", "feat", "background")}
    by_origin["item"] = [m for r in worn for m in _own(d, r) if _counts(m, r) and not _stays_on_item(m, r)]
    shared = [m for group in by_origin.values() for m in group]
    level = sum(_int(k.get("level")) for k in classes)
    pb = 2 + (level - 1) // 4 + sum(_int(m.get("value")) for m in _of(shared, "bonus", "proficiency-bonus"))
    return _Sheet(d, c, classes, worn, values, by_origin, shared, pb,
                  min(6, sum(1 for r in rows if r.get("isAttuned"))), _owners(d, classes), _names(d, classes, rows, values))


def _guarded(work: Callable[[_Sheet], Worked], data: object, c: Character) -> Worked:
    try:
        return work(_sheet(data, c))
    except _Unsure as e:
        return Worked(None, "", str(e))
    except Unreadable:
        return Worked(None, "", "the data is not a character this reader understands")
    except (ArithmeticError, AttributeError, LookupError, TypeError, ValueError):
        # The accessors below already step round odd values; this is the last line, so that a
        # shape nobody foresaw is a reason to be unsure and never a traceback in a sync.
        return Worked(None, "", "the data is not in a shape this calculator reads")


# --- small sums -----------------------------------------------------------------------------

def _digest(name: object) -> str:
    return hashlib.sha256(" ".join(_text(name).lower().split()).encode("utf-8")).hexdigest()


def _named(rule: str, name: object) -> bool:
    """Whether this name is one D&D Beyond keys the rule on."""
    return _digest(name) in BY_NAME[rule]


def _level(s: _Sheet) -> int:
    return sum(_int(k.get("level")) for k in s.classes)


def _mod(s: _Sheet, stat: object) -> int:
    """The modifier of the ability with this stat id; 0 when it names none."""
    n = _num(stat)
    return _ability_mod(_int(s.c.scores.get(ABILITIES[n - 1]), 10)) if n is not None and 1 <= n <= 6 else 0


def _scaled(s: _Sheet, m: dict) -> int:
    """A modifier's number: its value, plus an ability's modifier (never below 0) when it names one."""
    return _int(m.get("value")) + max(0, _mod(s, m.get("statId")))


def _full(s: _Sheet, m: dict) -> int:
    """As `_scaled`, with what the modifier's bonus types add (proficiency bonus, attuned items)."""
    return _worth(m, s.pb, s.attuned) + max(0, _mod(s, m.get("statId")))


def _total(s: _Sheet, kind: str, subs: set[str]) -> int:
    """Every shared modifier of this kind whose subType is one of `subs`, added up."""
    return sum(_scaled(s, m) for m in s.shared if m.get("type") == kind and _text(m.get("subType")) in subs)


def _adjustments(s: _Sheet, ident: object, kind: object) -> dict[int, object]:
    """The player's own adjustments on one thing: type id -> value. A thing with no id has
    none; the ones with no id of their own are the character's (`_own_adjustments`)."""
    if ident is None:
        return {}
    return {t: v for (t, vid, vkind), v in s.values.items() if vid == str(ident) and vkind == str(kind)}


def _own_adjustments(s: _Sheet) -> dict[int, object]:
    """The adjustments that hang on the character and not on a thing: the armour class ones."""
    return {t: v for (t, vid, vkind), v in s.values.items() if (vid, vkind) == ("None", "None")}


def _unread(own: dict[int, object], read: frozenset[int], name: str) -> None:
    if any(t not in read for t in own):
        raise _Unsure(f"{name} carries an adjustment this calculator does not read")


def _source(s: _Sheet, m: dict, fallback: str) -> str:
    ident, kind = _num(m.get("componentId")), _num(m.get("componentTypeId"))
    if ident is None:
        return fallback
    return s.names.get((ident, kind)) or s.names.get((ident, None)) or fallback


def _die(x: object) -> Die | None:
    """Dice as the data writes them, or None when there are none."""
    count, size = _num(_dict(x).get("diceCount")), _num(_dict(x).get("diceValue"))
    if count is None or size is None or count < 1 or size < 1:
        return None
    return count, size, _int(_dict(x).get("fixedValue"))


def _dice_text(count: int, size: int, fixed: int) -> str:
    return f"{count}d{size}" + (f"+{fixed}" if fixed > 0 else f"-{-fixed}" if fixed < 0 else "")


def _signed(n: int) -> str:
    return f"+{n}" if n >= 0 else f"-{-n}"


def _with_type(damage: str, kind: str) -> str:
    return f"{damage} {kind}".strip()


# --- hit point maximum ----------------------------------------------------------------------

def _fixed_base(s: _Sheet) -> int:
    """The hit dice at their fixed value: the first class's whole die, then half plus one a level."""
    total = 0
    for k in s.classes:
        die, lvl = _num(_dict(k.get("definition")).get("hitDice")), _int(k.get("level"))
        if die is None or die < 1:
            raise _Unsure("a class has no hit die in the data")
        each = die // 2 + 1
        total += die + (lvl - 1) * each if k.get("isStartingClass") else lvl * each
    return total


def _hp_max(s: _Sheet) -> Worked:
    d = s.d
    override = _num(d.get("overrideHitPoints"))
    if override is not None:                      # the player's override replaces the whole sum
        return Worked(max(1, override), "", "")
    for m in s.shared:
        kind, sub = _text(m.get("type")), _text(m.get("subType"))
        if "hit-points" in sub and (kind, sub) not in HP_KNOWN:
            raise _Unsure(f"a hit point rule this calculator does not know ({safe_name(kind)} {safe_name(sub)})")
    prefs = d.get("preferences")
    if isinstance(prefs, dict) and _num(prefs.get("hitPointType")) == 1:
        base = _fixed_base(s)
    else:
        rolled = _num(d.get("baseHitPoints"))
        if rolled is None:
            raise _Unsure("the data has no rolled hit point total")
        base = rolled
    level = _level(s)
    total = base + _mod(s, 3) * level + _int(d.get("bonusHitPoints"))
    for origin, group in s.by_origin.items():
        for m in _of(group, "bonus", "hit-points-per-level"):
            levels = level
            if origin == "class" and len(s.classes) > 1:   # a class feature's bonus counts its own class's levels
                mine = s.owner.get(_int(m.get("componentId"), -1))
                if mine is None:
                    raise _Unsure("a per-level hit point bonus does not say which class it belongs to")
                levels = _int(s.classes[mine].get("level"))
            total += levels * _int(m.get("value"))
    for m in _of(s.shared, "bonus", "hit-points"):          # once, not per level; a healing item's dice add nothing
        stat = _num(m.get("statId"))
        total += _mod(s, stat) if stat is not None else _int(m.get("value"))
    return Worked(max(1, total), "", "")


def hp_max(data: object, c: Character) -> Worked:
    """The hit point maximum. `data` is the object `read` was given; `c` is what it returned."""
    return _guarded(_hp_max, data, c)


# --- armour class ---------------------------------------------------------------------------

def _about_ac(m: dict) -> bool:
    sub = _text(m.get("subType"))
    return m.get("type") in ("set", "bonus", "ignore") and (
        "armor-class" in sub or sub.startswith("ac-") or "base-armor" in sub
        or sub in ("unarmored-dex-ac-bonus", "unarmored-while-armored"))


def _item_ac(s: _Sheet, row: dict) -> int:
    """An armour's or shield's own armour class: its base, which never waits for attunement,
    and its own bonus, which does."""
    base = _int(_dict(row.get("definition")).get("armorClass"))
    return base + sum(_int(m.get("value")) for m in _of(_own(s.d, row), "bonus", "armor-class") if _counts(m, row))


def _dex_in(s: _Sheet, row: dict) -> int:
    kind, dex = _armour_kind(row), _mod(s, 2)
    if kind == LIGHT:
        return dex
    if kind != MEDIUM:
        return 0
    cap = 2
    raised = [_int(m.get("value")) for sub in ("ac-max-dex-modifier", "ac-max-dex-armored-modifier")
              for m in _of(s.shared, "set", sub)]
    if raised and _int(s.c.scores.get("DEX"), 10) >= 16:   # the raise asks for the score, not the modifier
        cap = max(raised)
    return min(cap, dex)


def _best(rows: list[dict], score: Callable[[dict], int]) -> dict | None:
    """The highest by `score`; of equals, the later one."""
    best = None
    for row in rows:
        if best is None or score(row) >= score(best):
            best = row
    return best


def _unarmoured(s: _Sheet, group: list[dict]) -> Parts:
    """No armour: 10, Dexterity, then the best base one feature gives (a second ability, or
    a number), then any bonus for going without armour."""
    parts: Parts = [("Unarmoured", NO_ARMOUR)]
    if not _of(group, "ignore", "unarmored-dex-ac-bonus"):
        dex = _mod(s, 2)
        caps = [_int(m.get("value")) for sub in ("ac-max-dex-modifier", "ac-max-dex-unarmored-modifier")
                for m in _of(s.shared, "set", sub)]
        parts.append(("Dex", min(max(caps), dex) if caps else dex))
    best = _best(_of(group, "set", "unarmored-armor-class"), lambda m: _full(s, m))
    if best is not None:
        stat = _num(best.get("statId"))
        label = ABILITIES[stat - 1].title() if stat is not None and 1 <= stat <= 6 and not _int(best.get("value")) \
            else _source(s, best, "unarmoured bonus")
        parts.append((label, _full(s, best)))
    parts += [(_source(s, m, "unarmoured bonus"), _full(s, m)) for m in _of(s.shared, "bonus", "unarmored-armor-class")]
    return parts


def _armoured(s: _Sheet, suit: dict) -> Parts:
    parts: Parts = [(_item_name(suit, s.values), _item_ac(s, suit)), ("Dex", _dex_in(s, suit))]
    return parts + [(_source(s, m, "armoured bonus"), _full(s, m)) for m in _of(s.shared, "bonus", "armored-armor-class")]


def _base_armour(s: _Sheet, suit: dict | None) -> Parts:
    """The best of the ways to count the base: each feature that sets an unarmoured base is
    tried on its own (even in armour, unless it says it does not work in armour), against the
    armour worn or plain 10 + Dexterity. Of equals, the plain way wins."""
    groups: dict[tuple[int | None, int | None], list[dict]] = {}
    for m in s.shared:
        if (_text(m.get("type")), _text(m.get("subType"))) in BRANCHING:
            groups.setdefault((_num(m.get("componentId")), _num(m.get("componentTypeId"))), []).append(m)
    ways = [_unarmoured(s, g) for g in groups.values()
            if not (suit is not None and _of(g, "ignore", "unarmored-while-armored"))]
    ways.append(_armoured(s, suit) if suit is not None else _unarmoured(s, []))
    best = ways[0]
    for way in ways[1:]:
        if sum(n for _, n in way) >= sum(n for _, n in best):
            best = way
    return best


def _two_weapons(s: _Sheet) -> bool:
    """A weapon in the off hand (the player marks it) and another in the main hand."""
    hands = [bool(_adjustments(s, r.get("id"), ITEM_ROW_TYPE).get(18)) for r in s.worn if _weapon_facts(r) is not None]
    return any(hands) and not all(hands)


def _armour_class(s: _Sheet) -> Worked:
    own = _own_adjustments(s)
    by_hand = _num(own.get(1))
    if by_hand is not None:                       # the player's override: nothing else matters
        return Worked(by_hand, "set by hand", "")
    if own.get(4) is not None:
        raise _Unsure("the base armour is set by hand")
    for trait in _dicts(_dict(s.d.get("race")).get("racialTraits")):
        if _named("armour class trait", _dict(trait.get("definition")).get("name")):
            raise _Unsure(f"{safe_name(_dict(trait.get('definition')).get('name'))} has an armour class rule of its own")
    armour = [r for r in s.worn if _armour_kind(r) is not None]
    for m in s.shared + [m for r in armour for m in _own(s.d, r)]:
        kind, sub = _text(m.get("type")), _text(m.get("subType"))
        if _about_ac(m) and (kind, sub) not in AC_KNOWN:
            raise _Unsure(f"an armour class rule this calculator does not know ({safe_name(kind)} {safe_name(sub)})")
    for r in armour:
        _unread(_adjustments(s, r.get("id"), ITEM_ROW_TYPE), ARMOUR_READ, _item_name(r, s.values))
    suit = _best([r for r in armour if _armour_kind(r) != SHIELD], lambda r: _item_ac(s, r) + _dex_in(s, r))
    shield = _best([r for r in armour if _armour_kind(r) == SHIELD], lambda r: _item_ac(s, r))

    parts = _base_armour(s, suit)
    parts += [(_source(s, m, "bonus"), _full(s, m)) for m in _of(s.shared, "bonus", "armor-class")]
    shield_ac = _item_ac(s, shield) if shield is not None else 0
    paired = sum(_full(s, m) for m in _of(s.shared, "bonus", "dual-wield-armor-class")) if _two_weapons(s) else 0
    if paired > max(0, shield_ac):                # the two-weapon bonus takes the shield's place only when it beats it
        parts.append(("two weapons", paired))
    elif shield is not None:
        parts.append(("shield", shield_ac))
    parts += [("magic bonus", _int(own.get(2))), ("other bonus", _int(own.get(3)))]
    shown = [parts[0]] + [p for p in parts[1:] if p[1]]
    return Worked(sum(n for _, n in parts), " + ".join(f"{label} {n}" for label, n in shown), "")


def armour_class(data: object, c: Character) -> Worked:
    """The armour class, with `parts` saying what it is made of."""
    return _guarded(_armour_class, data, c)


# --- attack lines: weapons ------------------------------------------------------------------

def _fits_weapon(m: dict, facts: dict, props: set[str], ranged: bool, two_hands: bool) -> bool:
    """Whether a to-hit or damage modifier is about this weapon. `two_hands` is the versatile
    weapon's two-handed line, where one-handed bonuses drop out."""
    sub = _text(m.get("subType"))
    reach = "ranged" if ranged else "melee"
    if sub in ("weapon-attacks", f"{reach}-attacks", f"{reach}-weapon-attacks"):
        return True
    grips = {"one-handed": "two-handed" not in props and not two_hands,
             "two-handed": "two-handed" in props or two_hands,
             "thrown": "thrown" in props or two_hands}
    for grip, holds in grips.items():
        if sub in (f"{grip}-weapon-attacks", f"{grip}-{reach}-attacks"):
            return holds
    kind, about = _num(m.get("entityTypeId")), _num(m.get("entityId"))
    if about is None:
        return False
    return (kind == WEAPON_CATEGORY and about == _num(facts.get("categoryId"))) \
        or (kind == WEAPON_BASE and about == _num(facts.get("baseItemId")))


def _proficient(s: _Sheet, facts: dict, own: list[dict]) -> bool:
    category, base = _num(facts.get("categoryId")), _num(facts.get("baseItemId"))
    for m in s.shared:
        kind, about = _num(m.get("entityTypeId")), _num(m.get("entityId"))
        if m.get("type") == "proficiency" and about is not None \
                and ((kind == WEAPON_CATEGORY and about == category) or (kind == WEAPON_BASE and about == base)):
            return True
    if any(m.get("type") == "proficiency" and m.get("subType") == "self" for m in own):
        return True
    # 33: a weapon proficiency the player added by hand, 3 or more meaning proficient.
    return base is not None and any(t == 33 and vid == str(base) and _int(v) >= 3 for (t, vid, _), v in s.values.items())


def _granted_abilities(s: _Sheet, enablers: list[dict]) -> list[int]:
    """The abilities a marked weapon may use: named by the same feature that enables the mark."""
    origins = {(_num(m.get("componentId")), _num(m.get("componentTypeId"))) for m in enablers}
    return [_int(m.get("statId")) or _int(m.get("entityId")) for m in s.shared
            if m.get("type") == "replace-weapon-ability"
            and (_num(m.get("componentId")), _num(m.get("componentTypeId"))) in origins]


def _weapon_line(s: _Sheet, row: dict, facts: dict) -> Attack | None:
    name = _item_name(row, s.values)
    mine = _adjustments(s, row.get("id"), ITEM_ROW_TYPE)
    _unread(mine, WEAPON_READ, name)
    if mine.get(16) is False:                     # the player took it off the attack list
        return None
    die = _die(facts.get("damage"))
    if die is None:
        raise _Unsure(f"{name} has no damage dice in the data")
    reach = _num(facts.get("attackType"))
    if reach not in (1, 2):
        raise _Unsure(f"{name} does not say whether it is melee or ranged")
    ranged = reach == 2
    own = _own(s.d, row)
    # Properties and damage type come from the item whether it is attuned or not.
    props = {_text(p.get("name")).lower() for p in _dicts(facts.get("properties"))}
    props |= {_text(m.get("subType")) for m in own if m.get("type") == "weapon-property"}
    props -= {_text(m.get("subType")) for m in own if m.get("type") == "ignore-weapon-property"}

    pact_by = _of(s.shared, "enable-feature", PACT_WEAPON) if mine.get(28) else []
    other_by = [m for m in s.shared if m.get("type") == "enable-feature"
                and _named("marked weapon", m.get("subType"))] if mine.get(29) else []
    pact = bool(pact_by)
    if pact and any(_named("pact option", _dict(o.get("definition")).get("name"))
                    for o in _dicts(_dict(s.d.get("options")).get("class"))):
        raise _Unsure(f"{name} is a pact weapon an option makes magical, which this calculator does not work out")
    if _dict(row.get("definition")).get("magic") and any(
            _text(m.get("subType")).startswith("magic-item-attack-with-") for m in s.shared):
        raise _Unsure(f"{name} may attack with another ability, which this calculator does not work out")

    abilities = ([1] if not ranged or "finesse" in props else []) + ([2] if ranged or "finesse" in props else [])
    abilities += _granted_abilities(s, pact_by) + _granted_abilities(s, other_by)
    proficiency = s.pb if pact or _proficient(s, facts, own) else 0
    best: tuple[int, int, int] | None = None      # to hit, modifier, damage from the ability
    for stat in abilities:
        if not 1 <= stat <= 6:
            continue
        word, mod = f"{ABILITY_WORDS[stat - 1]}-attacks", _mod(s, stat)
        this = (mod + proficiency + _total(s, "bonus", {word}), mod, mod + _total(s, "damage", {word}))
        if best is None or this[:2] >= best[:2]:  # of equals, the later ability
            best = this
    if best is None:
        raise _Unsure(f"{name} names no ability to attack with")
    magic = sum(_int(m.get("value")) for m in _of(own, "bonus", "magic") if _counts(m, row)) \
        + sum(_int(m.get("value")) for m in _of(s.shared, "bonus", "magic"))

    def about(kind: str, two_hands: bool) -> int:
        return sum(_scaled(s, m) for m in s.shared if m.get("type") == kind and _fits_weapon(m, facts, props, ranged, two_hands))

    hit = best[0] + magic + about("bonus", False) + _int(mine.get(12))
    if _num(mine.get(13)) is not None:
        hit = _int(mine.get(13))
    off_hand = bool(mine.get(18))
    from_ability = best[2]
    if off_hand and not _of(s.shared, "ignore", "offhand-modifier-restrictions"):
        from_ability = min(0, from_ability)       # the off hand loses the ability's bonus but keeps its penalty
    fixed = die[2] + magic + from_ability + _int(mine.get(10))
    damage = _dice_text(die[0], die[1], fixed + about("damage", False))
    if "versatile" in props and not off_hand:
        bigger = DICE_LADDER[min(len(DICE_LADDER) - 1, DICE_LADDER.index(die[1]) + 1)] if die[1] in DICE_LADDER else die[1]
        damage += f" ({_dice_text(die[0], bigger, fixed + about('damage', True))})"
    swapped = next((_text(m.get("subType")) for m in own if m.get("type") == "replace-damage-type"), "")
    damage = _with_type(damage, safe_name(swapped or _text(facts.get("damageType")).lower()))
    for m in own:                                 # extra damage: only what always applies, from an item in use
        sub = _text(m.get("subType"))
        if m.get("type") == "damage" and sub in DAMAGE_WORDS and _counts(m, row) \
                and not _text(m.get("restriction")).strip():
            extra = _die(m.get("dice"))
            amount = _dice_text(*extra) if extra else str(_int(m.get("value"))) if _num(m.get("value")) else ""
            if amount:
                damage += f" + {amount} {sub}"
    return Attack(name, _signed(hit), damage)


def _weapon_lines(s: _Sheet) -> list[Attack]:
    lines = []
    for row in s.worn:
        facts = _weapon_facts(row)
        if facts is not None:
            line = _weapon_line(s, row, facts)
            if line is not None:
                lines.append(line)
    return sorted(lines, key=lambda a: a.name.lower())


# --- attack lines: unarmed strike and actions -----------------------------------------------

def _unarmed(s: _Sheet) -> Attack | None:
    mine = _adjustments(s, UNARMED_ID, UNARMED_TYPE)
    named = mine.get(8)
    name = safe_name(named) if isinstance(named, str) and named.strip() else "Unarmed Strike"
    _unread(mine, ROLL_READ, name)
    if mine.get(16) is False:
        return None
    subs = {"weapon-attacks", "melee-attacks", "melee-weapon-attacks", "unarmed-attacks", "natural-attacks",
            "melee-unarmed-attacks", "melee-natural-attacks"}
    strength = _mod(s, 1)
    hit = strength + s.pb + _total(s, "bonus", {"strength-attacks"}) + _total(s, "bonus", subs) + _int(mine.get(12))
    if _num(mine.get(13)) is not None:
        hit = _int(mine.get(13))
    fixed = strength + _total(s, "damage", {"strength-attacks"}) + _total(s, "damage", subs) + _int(mine.get(10))
    dice = [d for d in (_die(m.get("dice")) for m in _of(s.shared, "set", "unarmed-damage-die")) if d]
    if dice:
        count, size, more = max(dice, key=lambda d: d[0] * (d[1] + 1) + 2 * d[2])   # the highest on average
        return Attack(name, _signed(hit), f"{_dice_text(count, size, more + fixed)} bludgeoning")
    return Attack(name, _signed(hit), f"{max(0, 1 + fixed)} bludgeoning")


def _as_action(custom: dict) -> dict:
    """One of the player's own actions in the shape of a feature's action."""
    size = _num(custom.get("diceType"))
    dice = {"diceCount": _int(custom.get("diceCount"), 1), "diceValue": size, "fixedValue": custom.get("fixedValue")}
    return {**custom, "attackTypeRange": custom.get("rangeId"), "abilityModifierStatId": custom.get("statId"),
            "dice": dice if size else None, "value": None if size else custom.get("fixedValue"), "fixedToHit": None}


def _action_subs(kind: int | None, sort: int | None, ranged: bool) -> set[str]:
    """The to-hit and damage modifiers that are about an action: by whether it is a weapon
    or a spell attack, and for a weapon whether it is natural or unarmed."""
    reach = "ranged" if ranged else "melee"
    if kind == 2:
        return {"spell-attacks", f"{reach}-spell-attacks"}
    if kind != 1:
        return set()
    subs = {"weapon-attacks", f"{reach}-attacks", f"{reach}-weapon-attacks"}
    if sort in (2, 3):
        subs |= {"natural-attacks", f"{reach}-natural-attacks"}
    if sort == 3:
        subs |= {"unarmed-attacks", f"{reach}-unarmed-attacks"}
    return subs


def _action_line(s: _Sheet, a: dict, custom: bool) -> Attack | None:
    mine = _adjustments(s, a.get("id"), a.get("entityTypeId"))
    named = mine.get(8)
    name = safe_name(named if isinstance(named, str) and named.strip() else a.get("name"))
    reach, save = _num(a.get("attackTypeRange")), _num(a.get("saveStatId"))
    rolls = reach in (1, 2)
    shown = mine.get(16) if isinstance(mine.get(16), bool) else a.get("displayAsAttack")
    if not (shown if isinstance(shown, bool) else rolls) or not name:
        return None
    kind, stat = _num(a.get("actionType")), _num(a.get("abilityModifierStatId"))
    named_stat = stat is not None and 1 <= stat <= 6
    if rolls and not named_stat and kind == 1:
        stat, named_stat = (2 if reach == 2 else 1), True     # a weapon attack falls back on Strength or Dexterity
    saves = save is not None and 1 <= save <= 6
    attacks_with = rolls and named_stat
    if not (attacks_with or _num(a.get("fixedToHit")) is not None or saves):
        if rolls and kind == 2:
            raise _Unsure(f"{name} does not name the ability it attacks with")
        return None                               # dice with no roll to hit and no save: not an attack line
    _unread(mine, ROLL_READ, name)
    if custom and (_int(a.get("toHitBonus")) or _int(a.get("damageBonus"))):
        raise _Unsure(f"{name} carries its own bonus, which this calculator does not read")

    subs = _action_subs(kind, _num(a.get("attackSubtype")), reach == 2)
    from_ability = 0
    if _num(a.get("fixedToHit")) is not None:
        hit = _signed(_int(a.get("fixedToHit")))
    elif attacks_with:
        word = f"{ABILITY_WORDS[_int(stat) - 1]}-attacks"
        total = _mod(s, stat) + (s.pb if a.get("isProficient") else 0) + _total(s, "bonus", {word}) \
            + _total(s, "bonus", subs) + _int(mine.get(12))
        hit = _signed(_int(mine.get(13)) if _num(mine.get(13)) is not None else total)
        from_ability = _mod(s, stat) + _total(s, "damage", {word})
    elif _int(a.get("fixedSaveDc")):
        hit = f"DC {_int(a.get('fixedSaveDc'))}"
    elif _num(mine.get(15)) is not None:
        hit = f"DC {_int(mine.get(15))}"
    elif named_stat:                              # a save DC always carries the proficiency bonus
        hit = f"DC {8 + s.pb + _mod(s, stat) + _int(mine.get(14))}"
    else:
        raise _Unsure(f"{name} does not name the ability its save DC comes from")

    fixed = _total(s, "damage", subs) + from_ability + _int(mine.get(10))
    die, flat = _die(a.get("dice")), _num(a.get("value"))
    if die is not None:
        damage = _dice_text(die[0], die[1], die[2] + fixed)
    elif flat is not None:
        damage = str(max(0, flat + fixed))
    else:
        damage = ""
    return Attack(name, hit, _with_type(damage, DAMAGE_TYPES.get(_int(a.get("damageTypeId")), "")) if damage else "")


def _action_lines(s: _Sheet) -> list[Attack]:
    found = [(a, False) for group in ("race", "class", "feat") for a in _dicts(_dict(s.d.get("actions")).get(group))]
    found += [(_as_action(a), True) for a in _dicts(s.d.get("customActions"))]
    lines = [_action_line(s, a, custom) for a, custom in found]
    return [line for line in lines if line is not None]


# --- attack lines: damage cantrips ----------------------------------------------------------

@dataclass
class _Casting:
    mod: int                                      # the casting ability's modifier
    hit: int
    dc: int
    slug: str                                     # the class name as modifiers spell it, "" when there is no class


def _class_casting(s: _Sheet, index: int) -> _Casting:
    """A class's spell attack and save DC: its ability, the proficiency bonus, and the
    modifiers for every caster or for this class by name."""
    k = s.classes[index]
    cd, sub = _dict(k.get("definition")), _dict(k.get("subclassDefinition"))
    mod = _mod(s, _int(sub.get("spellCastingAbilityId")) or _int(cd.get("spellCastingAbilityId")))
    slug = "-".join(safe_name(cd.get("name")).lower().split())
    return _Casting(mod, s.pb + mod + _total(s, "bonus", {"spell-attacks", f"{slug}-spell-attacks"}),
                    8 + s.pb + mod + _total(s, "bonus", {"spell-save-dc", f"{slug}-spell-save-dc"}), slug)


def _cantrip_rows(s: _Sheet) -> Iterator[tuple[str, int | None, dict]]:
    """Every spell row the character can cast, as (origin, class index, row); origin is
    class, other (a feat's or the species') or item."""
    d = s.d
    for entry in _dicts(d.get("classSpells")):
        wanted = entry.get("characterClassId")
        index = next((i for i, k in enumerate(s.classes) if wanted is not None and k.get("id") == wanted), None)
        if index is not None:
            for row in _dicts(entry.get("spells")):
                yield "class", index, row
    spells = _dict(d.get("spells"))
    for row in _dicts(spells.get("class")):
        yield "class", s.owner.get(_int(row.get("componentId"), -1)), row
    for row in _dicts(spells.get("race")) + _dicts(spells.get("feat")):
        yield "other", None, row
    for row in _dicts(spells.get("item")):        # an item's spells need it worn, and attuned if it can be
        if any(_dict(r.get("definition")).get("id") == row.get("componentId") and _live_item(r, d.get("id"), True)
               for r in s.worn):
            yield "item", None, row


def _casting_for(s: _Sheet, origin: str, index: int | None, row: dict, name: str, reach: int | None) -> _Casting:
    own = _num(row.get("spellCastingAbilityId"))
    subs = {"spell-attacks"} | ({"melee-attacks", "melee-spell-attacks"} if reach == 1 else set()) \
        | ({"ranged-attacks", "ranged-spell-attacks"} if reach == 2 else set())
    if origin == "class":
        if own is not None:                       # its own ability: the bare sum, without the class's bonuses
            slug = _class_casting(s, index).slug if index is not None else ""
            return _Casting(_mod(s, own), s.pb + _mod(s, own), 8 + s.pb + _mod(s, own), slug)
        if index is None:
            raise _Unsure(f"{name} does not say which class casts it")
        return _class_casting(s, index)
    extra = _total(s, "bonus", subs)
    if origin == "item" and own is None:          # an item borrows the best of the casting classes
        casters = [_class_casting(s, i) for i, k in enumerate(s.c.classes[:len(s.classes)]) if k.casting_ability]
        return _Casting(max([0] + [k.mod for k in casters]),
                        max([s.pb] + [s.pb + k.mod for k in casters]) + extra,
                        max([8 + s.pb] + [k.dc for k in casters]), "")
    mod = _mod(s, own)
    dc = 8 + s.pb + mod + (_total(s, "bonus", {"spell-save-dc"}) if origin == "other" else 0)
    return _Casting(mod, s.pb + mod + extra, dc, "")


def _cantrip_damage(s: _Sheet, row: dict, defn: dict, name: str) -> tuple[list[Die], list[dict]]:
    """The damage a cantrip does at this level, one entry per damage line that differs."""
    level = _level(s)
    if defn.get("scaleType") == "characterlevel" and _num(row.get("castAtLevel")) is not None:
        level = _int(row.get("castAtLevel"))
    dice: list[Die] = []
    lines = []
    for m in _dicts(defn.get("modifiers")):
        if m.get("type") != "damage" or not isinstance(m.get("atHigherLevels"), dict):
            continue
        die = _die(m.get("die"))
        if defn.get("scaleType") == "characterlevel":   # the dice named for the highest tier reached
            tiers = [(_int(t.get("level")), _die(t.get("dice")))
                     for t in _dicts(m["atHigherLevels"].get("higherLevelDefinitions"))]
            reached = [(lvl, td) for lvl, td in tiers if td is not None and lvl <= level]
            if reached:
                die = max(reached, key=lambda t: t[0])[1]
        if die is not None:
            lines.append(m)
            if die not in dice:
                dice.append(die)
    if len(dice) > 1:
        raise _Unsure(f"{name} has more than one damage line")
    return dice, lines


def _cantrip_line(s: _Sheet, origin: str, index: int | None, row: dict) -> Attack | None:
    defn = _dict(row.get("definition"))
    if _num(defn.get("level")) != 0 or defn.get("asPartOfWeaponAttack"):
        return None
    rolls, saves = bool(defn.get("requiresAttackRoll")), bool(defn.get("requiresSavingThrow"))
    mine = _adjustments(s, row.get("id"), row.get("entityTypeId"))
    named = mine.get(8)
    name = safe_name(named if isinstance(named, str) and named.strip() else defn.get("name"))
    if not name or not (rolls or saves) or mine.get(16) is False:
        return None
    dice, lines = _cantrip_damage(s, row, defn, name)
    if not dice:
        return None                               # not a damage cantrip
    _unread(mine, ROLL_READ, name)
    cast = _casting_for(s, origin, index, row, name, _num(defn.get("attackType")))
    if rolls:
        hit = _signed(_int(mine.get(13)) if _num(mine.get(13)) is not None else cast.hit + _int(mine.get(12)))
    elif _num(mine.get(15)) is not None:
        hit = f"DC {_int(mine.get(15))}"
    elif _num(row.get("overrideSaveDc")) is not None:
        hit = f"DC {_int(row.get('overrideSaveDc'))}"
    else:
        hit = f"DC {cast.dc + _int(mine.get(14))}"

    reach = _num(defn.get("attackType"))
    subs = {"spell-attacks"} | ({"melee-attacks", "melee-spell-attacks"} if reach == 1 else set()) \
        | ({"ranged-attacks", "ranged-spell-attacks"} if reach == 2 else set())
    fixed = dice[0][2] + _int(mine.get(10)) + _total(s, "damage", subs) + _total(s, "bonus", {"cantrip-damage"})
    if cast.slug:
        fixed += _total(s, "damage", {f"{cast.slug}-spell-attacks"}) + _total(s, "bonus", {f"{cast.slug}-cantrip-damage"})
    if _text(defn.get("name")) == "Eldritch Blast":   # the one spell whose damage bonus the data keys by name
        fixed += sum(_scaled(s, m) for m in _of(s.shared, "eldritch-blast", "bonus-damage"))
    if any(m.get("usePrimaryStat") for m in lines):
        fixed += cast.mod
    kinds = {_text(m.get("subType")) for m in lines}
    kind = safe_name(kinds.pop().replace("-", " ")) if len(kinds) == 1 else ""   # a choice of types: the dice alone
    return Attack(name, hit, _with_type(_dice_text(dice[0][0], dice[0][1], fixed), kind))


def _cantrip_lines(s: _Sheet) -> list[Attack]:
    lines = [_cantrip_line(s, origin, index, row) for origin, index, row in _cantrip_rows(s)]
    return sorted((line for line in lines if line is not None), key=lambda a: a.name.lower())


# --- attack lines: the list -----------------------------------------------------------------

def _one_each(lines: list[Attack]) -> list[Attack]:
    """The note's table is keyed by name: two lines the same are one, and two that share a
    name but not their numbers cannot both be written."""
    seen: dict[str, Attack] = {}
    for line in lines:
        first = seen.setdefault(line.name.lower(), line)
        if (first.hit, first.damage) != (line.hit, line.damage):
            raise _Unsure(f"two attacks are both called {line.name} with different numbers")
    return list(seen.values())


def _attacks(s: _Sheet) -> Worked:
    prefs = _dict(s.d.get("preferences"))
    if _num(prefs.get("progressionType")) == 2 and not (_level(s) == 1 and _int(s.d.get("currentXp")) == 0):
        # Then the proficiency bonus and a cantrip's dice follow the experience points, not the class levels.
        raise _Unsure("the character levels by experience points, which this calculator does not turn into a level")
    if any(_text(_dict(cf.get("definition")).get("name")).startswith("Martial Arts")
           for k in s.classes for cf in _dicts(k.get("classFeatures"))):
        raise _Unsure("a Martial Arts die is in play, which this calculator does not work out")
    for m in s.shared:
        if _text(m.get("type")) in WEAPON_UNKNOWN or _named("weapon kind", m.get("type")):
            raise _Unsure(f"a weapon rule this calculator does not know ({safe_name(m.get('type'))})")
    unarmed = _unarmed(s)
    lines = _weapon_lines(s) + ([unarmed] if unarmed is not None else []) + _action_lines(s) + _cantrip_lines(s)
    return Worked(_one_each(lines), "", "")


def attacks(data: object, c: Character) -> Worked:
    """The attack lines, a list of `Attack` in the order the note's table takes them."""
    return _guarded(_attacks, data, c)
