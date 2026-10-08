#!/usr/bin/env python3
"""Read a D&D Beyond character into plain inputs. No I/O, no network.

`read()` takes the object under the `data` key of the public character JSON
and returns a `Character`: finished ability scores, proficiencies, features,
spells, gear and coins. This is the only file that knows D&D Beyond's shape;
the rest of the sync works from a `Character`. The sums follow the way the
site itself counts (which modifiers are live, the 20-point cap, level-scaled
uses); anything not in the data raises `Unreadable` or is skipped, never
guessed. Stdlib only.

Three numbers the data does not carry as totals (hit point maximum, armour
class, the attack lines) are worked out by dnd_ddb_calc.py and ride on the
`Character` as `Worked` values, each either a value or a reason it is unsure.
"""

import re
from dataclasses import dataclass, field
from fractions import Fraction

ABILITIES = ("STR", "DEX", "CON", "INT", "WIS", "CHA")   # stat ids 1..6 in this order
ABILITY_WORDS = ("strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma")
ALIGNMENTS = ("Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "Neutral",
              "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil")
SIZES = {2: "Tiny", 3: "Small", 4: "Medium", 5: "Large", 6: "Huge", 7: "Gargantuan", 10: "Medium"}
# id, name, ability index; the site's own skill list, which custom homebrew does not change.
SKILLS = ((2, "Athletics", 0), (3, "Acrobatics", 1), (4, "Sleight of Hand", 1), (5, "Stealth", 1),
          (6, "Arcana", 3), (7, "History", 3), (8, "Investigation", 3), (9, "Nature", 3),
          (10, "Religion", 3), (11, "Animal Handling", 4), (12, "Insight", 4), (13, "Medicine", 4),
          (14, "Perception", 4), (15, "Survival", 4), (16, "Deception", 5), (17, "Intimidation", 5),
          (18, "Performance", 5), (19, "Persuasion", 5))
CONDITIONS = frozenset((
    "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
    "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"))
COMPONENTS = {1: "V", 2: "S", 3: "M", 4: "R"}
RESET_NAMES = {1: "Short Rest", 2: "Long Rest"}

SKILL_TYPE, STAT_TYPE, ITEM_ROW_TYPE = 1958004211, 1472902489, 1439493548
ARMOR_TYPES, WEAPON_TYPES, TOOL_TYPES = {174869515}, {1782728300, 660121713}, {2103445194, 1452973421}
CLASS_FEATURE, RACIAL_TRAIT, FEAT = 12168134, 1960452172, 1088085227
BASE_CAP, ABSOLUTE_MAX = 20, 30
NAME_LIMIT = 80
# The site's own bookkeeping rows; the sheet already shows these facts.
BOOKKEEPING = frozenset((
    "proficiencies", "hit points", "ability score improvement", "ability score increase",
    "ability score increases", "equipment", "languages", "age", "size", "speed", "alignment", "creature type",
    "skills", "tool proficiency", "bonus proficiency", "extra language", "feat", "spellcasting", "pact magic"))
BOOKKEEPING_PATTERN = re.compile(r"core .+ traits|.+ subclass", re.I)
LEVEL_PREFIX = re.compile(r"^\d+:\s*")
KEPT_IN_NAMES = frozenset("'-,./+():&")


class Unreadable(Exception):
    """The data is not a character as this reader understands it. str(e) is one plain sentence."""


@dataclass
class ClassLevel:
    name: str
    level: int
    subclass: str                       # "" when none
    casting_ability: str                # "INT", or "" for a non-caster
    own_slots: list[int] | None         # the class's own 9 slot totals at this level from the data, else None


@dataclass
class Feature:
    name: str
    uses: int | None
    recovers: str                       # "Short Rest", "Long Rest" or ""


@dataclass
class Spell:
    name: str
    level: int                          # 0 for a cantrip
    time: str
    range: str
    components: str
    duration: str
    tags: list[str]                     # any of "C", "R", "Always prepared"
    source: str                         # the class name, "Item: <name>", "Feat: <name>", "Species"


@dataclass
class Item:
    name: str
    qty: int
    weight: str                         # each, as dnd_sheet.to_weight reads it: "3 lb", "1/4 lb", "—"
    kind: str                           # "armour", "shield", "weapon", "other"


@dataclass
class MagicItem:
    name: str
    attuned: bool
    charges: int | None
    recovers: str


@dataclass
class Attack:
    name: str
    hit: str                            # "+7", or "DC 15" for a saving throw
    damage: str                         # "1d8+4 slashing"; versatile "1d8+4 (1d10+4) slashing"; "" for none


@dataclass
class Worked:
    """A number dnd_ddb_calc worked out, or the reason it would not."""
    value: object | None                # int for hit points and armour class, list[Attack] for attacks; None when unsure
    parts: str                          # armour class only: "Studded Leather 12 + Dex 3 + shield 2"; else ""
    unsure: str                         # why, in one plain clause, when value is None; else ""


def _not_worked() -> Worked:
    return Worked(None, "", "it has not been worked out")


@dataclass
class Character:
    name: str
    classes: list[ClassLevel]
    level: int
    xp: int
    species: str
    background: str
    alignment: str
    size: str
    scores: dict[str, int]
    save_proficiencies: set[str]
    skills: dict[str, str]              # lower-case skill name -> "proficient" | "expertise" | "half"
    resistances: list[str]
    immunities: list[str]
    vulnerabilities: list[str]
    condition_immunities: list[str]
    class_features: list[Feature]
    species_traits: list[Feature]
    feats: list[Feature]
    spells: list[Spell]
    armor: list[str]
    weapons: list[str]
    tools: list[str]
    languages: list[str]
    gear: list[Item]
    magic_items: list[MagicItem]
    coins: dict[str, int]               # cp sp ep gp pp
    speed: int                          # walking speed in feet
    hp_max: Worked = field(default_factory=_not_worked)
    ac: Worked = field(default_factory=_not_worked)
    attacks: Worked = field(default_factory=_not_worked)


# --- small accessors: nothing below indexes into something that may not be a dict ----------

def _dict(x: object) -> dict:
    return x if isinstance(x, dict) else {}


def _list(x: object) -> list:
    return x if isinstance(x, list) else []


def _dicts(x: object) -> list[dict]:
    return [e for e in _list(x) if isinstance(e, dict)]


def _num(x: object) -> int | None:
    """A whole number, else None. Text and booleans are not numbers."""
    if isinstance(x, bool):
        return None
    if isinstance(x, int):
        return x
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return None


def _int(x: object, default: int = 0) -> int:
    n = _num(x)
    return default if n is None else n


def _text(x: object) -> str:
    return x if isinstance(x, str) else ""


def safe_name(text: object) -> str:
    """A name safe to write into a markdown table cell: letters, digits, spaces and
    ' - , . / + ( ) : & only, at most 80 characters."""
    if text is None:
        return ""
    s = str(text).replace("’", "'").replace("‘", "'")
    s = "".join(ch if ch.isalnum() or ch in KEPT_IN_NAMES else " " for ch in s)
    return " ".join(s.split())[:NAME_LIMIT].rstrip()


def _slug_title(slug: str) -> str:
    return slug.replace("-", " ").title()


def _mod_name(m: dict) -> str:
    return safe_name(_text(m.get("friendlySubtypeName")) or _slug_title(_text(m.get("subType"))))


def _unique(names: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for n in names:
        if n and n.lower() not in seen:
            seen.add(n.lower())
            out.append(n)
    return out


def _ability_mod(score: int) -> int:
    return (score - 10) // 2


# --- characterValues: the player's own adjustments, keyed (type, id, id type) -------------------

def _char_values(d: dict) -> dict[tuple[int, str, str], object]:
    out: dict[tuple[int, str, str], object] = {}
    for v in _dicts(d.get("characterValues")):
        t = _num(v.get("typeId"))
        if t is not None:
            out[(t, str(v.get("valueId")), str(v.get("valueTypeId")))] = v.get("value")
    return out


# --- the data's own rows --------------------------------------------------------------------

def _need(ok: bool, what: str) -> None:
    if not ok:
        raise Unreadable(f"That is not a D&D Beyond character this reader understands: {what}.")


def _class_rows(d: dict) -> list[dict]:
    rows = _list(d.get("classes"))
    _need(bool(rows), "it lists no classes")
    out = []
    for row in rows:
        _need(isinstance(row, dict) and isinstance(row.get("definition"), dict), "a class has no definition")
        _need(_num(row.get("level")) is not None and 0 < _int(row.get("level")) <= 20, "a class level is not 1 to 20")
        out.append(row)
    _need(sum(_int(r.get("level")) for r in out) <= 20, "the class levels add up to more than 20")
    return out


def _raw_stats(raw: object, strict: bool) -> list[int | None]:
    """Six values by stat id (position when the id is missing). Strict: six numbers or Unreadable."""
    entries = _list(raw)
    if strict:
        _need(len(entries) == 6 and all(isinstance(e, dict) for e in entries), "it does not have six ability scores")
    out: list[int | None] = [None] * 6
    for pos, e in enumerate(entries):
        if not isinstance(e, dict):
            continue
        idx = _int(e.get("id"), pos + 1) - 1
        if 0 <= idx < 6:
            out[idx] = _num(e.get("value"))
    if strict:
        _need(all(v is not None for v in out), "an ability score is not a number")
    return out


def _inventory(d: dict) -> list[dict]:
    return [r for r in _dicts(d.get("inventory")) if isinstance(r.get("definition"), dict)]


def _item_name(row: dict, values: dict) -> str:
    override = values.get((8, str(row.get("id")), str(ITEM_ROW_TYPE)))
    return safe_name(override if isinstance(override, str) and override.strip() else _dict(row.get("definition")).get("name"))


def _equipped(row: dict, char_id: object) -> bool:
    return bool(row.get("equipped")) and row.get("equippedEntityId") in (None, char_id)


def _live_item(row: dict, char_id: object, needs_attunement: bool) -> bool:
    """Worn or wielded by this character, and attuned when the rule wants it."""
    if not _equipped(row, char_id):
        return False
    return not (needs_attunement and _dict(row.get("definition")).get("canAttune")) or bool(row.get("isAttuned"))


# --- modifiers ------------------------------------------------------------------------------

def _group(d: dict, name: str) -> list[dict]:
    return _dicts(_dict(d.get("modifiers")).get(name))


def _live_modifiers(d: dict, classes: list[dict], rows: list[dict]) -> dict[str, list[dict]]:
    """Each origin's modifiers that count. The site sends class modifiers already limited to
    the class's level; here a multiclass character drops the ones a later class does not carry
    over, and an item's count only while it is worn (and attuned when it says so)."""
    owner: dict[int, int] = {}
    for i, c in enumerate(classes):
        for cf in _dicts(c.get("classFeatures")):
            fid = _num(_dict(cf.get("definition")).get("id"))
            if fid is not None:
                owner[fid] = i
    multi = len(classes) > 1
    char_id = d.get("id")
    kept_class = []
    for m in _group(d, "class"):
        mine = owner.get(_int(m.get("componentId"), -1)) if _num(m.get("componentTypeId")) == CLASS_FEATURE else None
        if multi and m.get("availableToMulticlass") is False and mine is not None and not classes[mine].get("isStartingClass"):
            continue
        kept_class.append(m)
    kept_items = []
    for m in _group(d, "item"):
        cid = m.get("componentId")
        if any(_dict(r.get("definition")).get("id") == cid and _live_item(r, char_id, bool(m.get("requiresAttunement")))
               for r in rows):
            kept_items.append(m)
    return {"race": _group(d, "race"), "class": kept_class, "feat": _group(d, "feat"),
            "background": _group(d, "background"), "item": kept_items}


def _everywhere(mods: dict[str, list[dict]]) -> list[dict]:
    return mods["race"] + mods["class"] + mods["feat"] + mods["background"] + mods["item"]


def _worth(m: dict, pb: int, attuned: int) -> int:
    """A modifier's value, plus what its bonus types add (1 proficiency bonus, 2 attuned items)."""
    types = _list(m.get("bonusTypes"))
    return _int(m.get("value")) + (pb if 1 in types else 0) + (attuned if 2 in types else 0)


def _of(mods: list[dict], kind: str, sub: str) -> list[dict]:
    return [m for m in mods if m.get("type") == kind and m.get("subType") == sub]


# --- the numbers ----------------------------------------------------------------------------

def _scores(d: dict, mods: dict[str, list[dict]], pb: int, attuned: int) -> dict[str, int]:
    base = _raw_stats(d.get("stats"), strict=True)
    manual = _raw_stats(d.get("bonusStats"), strict=False)
    override = _raw_stats(d.get("overrideStats"), strict=False)
    everything = _everywhere(mods)
    misc = mods["item"] + mods["feat"] + mods["background"]   # the only sources of `set`
    out = {}
    for i, key in enumerate(ABILITIES):
        sub = f"{ABILITY_WORDS[i]}-score"
        added = sum(_worth(m, pb, attuned) for group in (mods["race"], mods["class"], misc) for m in _of(group, "bonus", sub))
        cap = BASE_CAP + sum(_int(m.get("value")) for m in _of(everything, "bonus", "ability-score-maximum")
                             if _int(m.get("statId")) == i + 1)
        score = min(cap, _int(base[i]) + added) + _int(manual[i])   # a manual bonus goes over the cap
        score = min(ABSOLUTE_MAX, max([score] + [_int(m.get("value")) for m in _of(misc, "set", sub)]))
        if override[i]:
            score = _int(override[i])
        stacking = sum(_worth(m, pb, attuned) for m in _of(everything, "stacking-bonus", sub))
        if stacking > 0:
            score = min(cap, score + stacking)
        out[key] = max(1, min(ABSOLUTE_MAX, score))
    return out


def _skill_levels(values: dict, everything: list[dict], scores: dict[str, int]) -> dict[str, str]:
    out = {}
    for sid, name, stat in SKILLS:
        slug = name.lower().replace(" ", "-")
        own = values.get((27, str(sid), str(SKILL_TYPE)))   # the player may check it with another ability
        word = ABILITY_WORDS[_int(own) - 1] if 1 <= _int(own) <= 6 else ABILITY_WORDS[stat]

        def about(m: dict) -> bool:
            return m.get("subType") == slug or (m.get("entityId") == sid and m.get("entityTypeId") == SKILL_TYPE)

        level = ""
        if any(m.get("type") in ("half-proficiency", "half-proficiency-round-up")
               and (about(m) or m.get("subType") in ("ability-checks", f"{word}-ability-checks")) for m in everything):
            level = "half"
        if any(m.get("type") == "proficiency" and about(m) for m in everything):
            level = "proficient"
        if any(m.get("type") == "expertise" and about(m) for m in everything):
            level = "expertise"
        chosen = _num(values.get((26, str(sid), str(SKILL_TYPE))))
        if chosen is not None:
            level = {2: "half", 3: "proficient", 4: "expertise"}.get(chosen, "")
        if level:
            out[name.lower()] = level
    return out


def _saves(values: dict, everything: list[dict]) -> set[str]:
    out = set()
    for i, key in enumerate(ABILITIES):
        subs = ("saving-throws", f"{ABILITY_WORDS[i]}-saving-throws")
        yes = any(m.get("type") == "proficiency" and m.get("subType") in subs for m in everything)
        chosen = _num(values.get((41, str(i + 1), str(STAT_TYPE))))
        if chosen is not None:
            yes = chosen >= 3
        if yes:
            out.add(key)
    return out


def _defences(everything: list[dict]) -> tuple[list[str], list[str], list[str], list[str]]:
    lists: dict[str, list[str]] = {"resistance": [], "immunity": [], "vulnerability": [], "condition": []}
    for m in everything:
        kind, sub = m.get("type"), _text(m.get("subType"))
        if kind not in ("resistance", "immunity", "vulnerability"):
            continue
        name = _mod_name(m)
        if kind == "immunity" and sub in CONDITIONS:
            lists["condition"].append(name)
            continue
        why = safe_name(m.get("restriction"))
        lists[str(kind)].append((f"{name} ({why})" if name and why else name)[:NAME_LIMIT].rstrip())
    return (_unique(lists["resistance"]), _unique(lists["immunity"]),
            _unique(lists["vulnerability"]), _unique(lists["condition"]))


def _proficiencies(d: dict, everything: list[dict]) -> tuple[list[str], list[str], list[str], list[str]]:
    armor, weapons, tools, languages = [], [], [], []
    for m in everything:
        sub = _text(m.get("subType"))
        if sub.startswith("choose-") or sub == "self":
            continue
        if m.get("type") == "language":
            languages.append(_mod_name(m))
        elif m.get("type") == "proficiency":
            kind = _num(m.get("entityTypeId"))
            if kind in ARMOR_TYPES:
                armor.append(_mod_name(m))
            elif kind in WEAPON_TYPES:
                weapons.append(_mod_name(m))
            elif kind in TOOL_TYPES:
                tools.append(_mod_name(m))
    for c in _dicts(d.get("customProficiencies")):   # type: 2 tool, 3 language, 4 armour, 5 weapon
        into = {2: tools, 3: languages, 4: armor, 5: weapons}.get(_int(c.get("type")))
        if into is not None:
            into.append(safe_name(c.get("name")))
    return _unique(armor), _unique(weapons), _unique(tools), _unique(languages)


# --- features -------------------------------------------------------------------------------

def _max_uses(use: dict, scores: dict[str, int], pb: int) -> int:
    """The most uses, as the site counts them: a fixed number, or an ability modifier and/or the
    proficiency bonus added or multiplied in. Never fewer than one."""
    initial, floor, scaled = _int(use.get("maxUses")), 1, 0
    stat = _int(use.get("statModifierUsesId"))
    if 1 <= stat <= 6:
        scaled = _ability_mod(scores[ABILITIES[stat - 1]])
        if _int(use.get("operator"), 1) == 2:
            scaled, floor, initial = scaled * initial, initial, 0
    if use.get("useProficiencyBonus"):
        if _int(use.get("proficiencyBonusOperator"), 1) == 2:
            if 1 <= stat <= 6 and _int(use.get("operator"), 1) != 2:
                scaled += initial
            scaled = (scaled if 1 <= stat <= 6 else initial) * pb
            floor, initial = initial, 0
        else:
            scaled += pb
    return max(floor, 1, initial + scaled)


def _recovery(use: dict) -> str:
    kind = use.get("resetType")
    return RESET_NAMES.get(_int(kind)) or (kind if isinstance(kind, str) and kind in RESET_NAMES.values() else "")


def _features(defs: list[dict], uses: dict[tuple[int, int], dict], scores: dict[str, int], pb: int,
              bookkeeping: bool = True) -> list[Feature]:
    out: dict[str, Feature] = {}
    for fd in defs:
        name = LEVEL_PREFIX.sub("", safe_name(fd.get("name")))
        if not name or (bookkeeping and (name.lower() in BOOKKEEPING or BOOKKEEPING_PATTERN.fullmatch(name))):
            continue
        use = uses.get((_int(fd.get("id"), -1), _int(fd.get("entityTypeId"), -1)))
        feature = Feature(name, _max_uses(use, scores, pb) if use else None, _recovery(use) if use else "")
        seen = out.get(name)
        if seen is None:
            out[name] = feature
        elif seen.uses is None and feature.uses is not None:
            seen.uses, seen.recovers = feature.uses, feature.recovers
    return list(out.values())


def _usable(defs: list[dict], limit: int) -> list[dict]:
    """Features the sheet shows: not hidden, and not above `limit` (a level)."""
    return [f for f in defs if not f.get("hideInSheet") and (_num(f.get("requiredLevel")) or 0) <= limit]


def _action_uses(d: dict, which: str) -> dict[tuple[int, int], dict]:
    out: dict[tuple[int, int], dict] = {}
    for a in _dicts(_dict(d.get("actions")).get(which)):
        if isinstance(a.get("limitedUse"), dict):
            out.setdefault((_int(a.get("componentId"), -1), _int(a.get("componentTypeId"), -1)), a["limitedUse"])
    return out


# --- spells ---------------------------------------------------------------------------------

def _count_unit(n: int, unit: str) -> str:
    return f"{n} {unit}" if n == 1 else f"{n} {unit}s"


def _cast_time(act: dict) -> str:
    n, kind = _int(act.get("activationTime"), 1), _int(act.get("activationType"))
    if kind == 6:
        return _count_unit(n, "minute")
    if kind == 7:
        return _count_unit(n, "hour")
    return {1: _count_unit(n, "action"), 2: "No action", 3: "1 bonus action", 4: "1 reaction", 8: "Special"}.get(kind, "")


def _spell_range(r: dict) -> str:
    origin, dist = safe_name(r.get("origin")), _int(r.get("rangeValue"))
    text = f"{dist} ft" if origin == "Ranged" or (dist and origin not in ("Self", "Touch")) else origin
    shape, size = safe_name(r.get("aoeType")), _int(r.get("aoeValue"))
    return f"{text} ({size}-ft {shape.lower()})" if shape and size else text


def _spell_duration(x: dict) -> str:
    kind = safe_name(x.get("durationType"))
    unit, n = safe_name(x.get("durationUnit")).lower(), _int(x.get("durationInterval"))
    return _count_unit(n, unit) if kind in ("Time", "Concentration") and unit else kind


def _spell(row: dict, source: str) -> Spell | None:
    sd = row.get("definition")
    name = safe_name(_dict(sd).get("name"))
    if not isinstance(sd, dict) or not name:
        return None
    tags = [t for t, on in (("C", sd.get("concentration")), ("R", sd.get("ritual")),
                            ("Always prepared", row.get("alwaysPrepared"))) if on]
    parts = [COMPONENTS[c] for c in _list(sd.get("components")) if _num(c) in COMPONENTS]
    return Spell(name, _int(sd.get("level")), _cast_time(_dict(sd.get("activation"))),
                 _spell_range(_dict(sd.get("range"))), ", ".join(parts),
                 _spell_duration(_dict(sd.get("duration"))), tags, source)


def _spells(d: dict, classes: list[dict], rows: list[dict], values: dict) -> list[Spell]:
    char_id = d.get("id")
    first = safe_name(_dict(classes[0].get("definition")).get("name"))
    by_feature: dict[int, str] = {}
    for c in classes:
        for cf in _dicts(c.get("classFeatures")):
            by_feature[_int(_dict(cf.get("definition")).get("id"), -1)] = safe_name(_dict(c.get("definition")).get("name"))
    feats = {_int(_dict(f.get("definition")).get("id"), -1): safe_name(_dict(f.get("definition")).get("name"))
             for f in _dicts(d.get("feats"))}
    found: dict[tuple[str, str], Spell] = {}

    def keep(row: dict, source: str) -> None:
        sp = _spell(row, source)
        if sp and ((sp.name, source) not in found or "Always prepared" in sp.tags):
            found[(sp.name, source)] = sp

    for entry in _dicts(d.get("classSpells")):
        wanted = entry.get("characterClassId")
        cls = next((c for c in classes if wanted is not None and c.get("id") == wanted), None)
        if cls is None:
            continue
        known = _dict(cls.get("definition")).get("spellPrepareType") is None
        for row in _dicts(entry.get("spells")):
            if known or _int(_dict(row.get("definition")).get("level")) == 0 or row.get("prepared") or row.get("alwaysPrepared"):
                keep(row, safe_name(_dict(cls.get("definition")).get("name")))
    spells = _dict(d.get("spells"))
    for row in _dicts(spells.get("class")):
        keep(row, by_feature.get(_int(row.get("componentId"), -1), first))
    for row in _dicts(spells.get("race")):
        keep(row, "Species")
    for row in _dicts(spells.get("feat")):
        keep(row, "Feat: " + feats[_int(row.get("componentId"), -1)] if _int(row.get("componentId"), -1) in feats else "Feat")
    for row in _dicts(spells.get("item")):
        for item in rows:
            if _dict(item.get("definition")).get("id") == row.get("componentId") and _live_item(item, char_id, True):
                keep(row, "Item: " + _item_name(item, values))
                break
    return sorted(found.values(), key=lambda s: (s.level, s.name.lower()))


# --- gear -----------------------------------------------------------------------------------

def _weight_text(each: Fraction) -> str:
    if each <= 0:
        return "—"
    return f"{each.numerator} lb" if each.denominator == 1 else f"{each.numerator}/{each.denominator} lb"


def _each_weight(defn: dict) -> Fraction:
    w = defn.get("weight")
    if isinstance(w, bool) or not isinstance(w, (int, float)) or w <= 0:
        return Fraction(0)
    each = Fraction(w).limit_denominator(100)
    return each / max(1, _int(defn.get("bundleSize"), 1)) if defn.get("stackable") else each


def _kind(defn: dict) -> str:
    if defn.get("armorTypeId") == 4:
        return "shield"
    return {"Armor": "armour", "Weapon": "weapon"}.get(_text(defn.get("filterType")), "other")


def _charges(row: dict) -> tuple[int | None, str]:
    use = row.get("limitedUse")
    if not isinstance(use, dict) or use.get("resetType") == "Consumable" or _num(use.get("maxUses")) is None:
        return None, ""
    return max(1, _int(use.get("maxUses"))), _recovery(use)


def _inventory_lists(rows: list[dict], values: dict) -> tuple[list[Item], list[MagicItem]]:
    gear: dict[str, Item] = {}
    magic: dict[str, MagicItem] = {}
    for row in rows:
        defn = _dict(row.get("definition"))
        name = _item_name(row, values)
        if not name:
            continue
        if defn.get("magic") and not defn.get("isConsumable"):
            charges, recovers = _charges(row)
            seen = magic.get(name)
            if seen is None:
                magic[name] = MagicItem(name, bool(row.get("isAttuned")), charges, recovers)
            else:
                seen.attuned = seen.attuned or bool(row.get("isAttuned"))
        else:
            qty = max(0, _int(row.get("quantity"), 1))
            if name in gear:
                gear[name].qty += qty
            else:
                gear[name] = Item(name, qty, _weight_text(_each_weight(defn)), _kind(defn))
    return list(gear.values()), list(magic.values())


def _coins(d: dict) -> dict[str, int]:
    have = _dict(d.get("currencies"))
    return {k: max(0, _int(have.get(k))) for k in ("cp", "sp", "ep", "gp", "pp")}


def _walking_speed(d: dict, mods: list[dict], scores: dict[str, int], rows: list[dict]) -> int:
    base = _int(_dict(_dict(_dict(d.get("race")).get("weightSpeeds")).get("normal")).get("walk"))
    char_id = d.get("id")
    kinds = ("speed", "speed-walking")
    fixed = [_int(m.get("value")) for m in mods if m.get("type") == "set" and m.get("subType") in kinds]
    if fixed:
        speed = max(fixed)
    else:
        innate = [_int(m.get("value")) for m in mods if m.get("type") == "set" and m.get("subType") == "innate-speed-walking"]
        speed = max([base] + innate)
        if speed:
            speed += sum(_int(m.get("value")) for m in mods if m.get("type") == "bonus" and m.get("subType") in kinds)
            worn = [_dict(r.get("definition")) for r in rows
                    if _equipped(r, char_id) and _dict(r.get("definition")).get("filterType") == "Armor"]
            if not any(m.get("type") == "ignore" and m.get("subType") == "heavy-armor-speed-reduction" for m in mods) \
                    and _int(_dict(d.get("preferences")).get("encumbranceType"), 1) != 3 \
                    and any(_int(w.get("strengthRequirement")) > scores["STR"] for w in worn):
                speed -= 10
            if not any(w.get("armorTypeId") != 4 for w in worn):
                speed += sum(_int(m.get("value")) for m in mods if m.get("type") == "bonus" and m.get("subType") == "unarmored-movement")
    for c in _dicts(d.get("customSpeeds")):
        if _num(c.get("movementId")) == 1 and _num(c.get("distance")) is not None:
            speed = _int(c.get("distance"))
    return max(0, speed)


# --- classes --------------------------------------------------------------------------------

def _own_slots(cd: dict, level: int) -> list[int] | None:
    table = _list(_dict(cd.get("spellRules")).get("levelSpellSlots"))
    row = table[level] if level < len(table) else None
    if not isinstance(row, list) or len(row) != 9:
        return None
    return [_int(n) for n in row]


def _class_level(c: dict) -> ClassLevel:
    cd, sub, level = _dict(c.get("definition")), _dict(c.get("subclassDefinition")), _int(c.get("level"))
    casts = any(_dict(cf.get("definition")).get("name") in ("Spellcasting", "Pact Magic")
                and (_num(_dict(cf.get("definition")).get("requiredLevel")) or 0) <= level
                for cf in _dicts(c.get("classFeatures")))
    ability = _int(sub.get("spellCastingAbilityId")) or _int(cd.get("spellCastingAbilityId"))
    return ClassLevel(safe_name(cd.get("name")), level, safe_name(sub.get("name")),
                      ABILITIES[ability - 1] if casts and 1 <= ability <= 6 else "",
                      _own_slots(cd, level) if casts else None)


def _background(d: dict) -> str:
    bg = _dict(d.get("background"))
    custom = safe_name(_dict(bg.get("customBackground")).get("name")) if bg.get("hasCustomBackground") else ""
    return custom or safe_name(_dict(bg.get("definition")).get("name"))


def _size(d: dict, mods: list[dict]) -> str:
    ids = [_int(_dict(d.get("race")).get("sizeId"), 4)]
    ids += [_int(m.get("entityId")) for m in mods if m.get("type") == "size"]
    return SIZES.get(max(ids), "Medium")


def read(data: object) -> Character:
    """The character in `data` (the object under the response's "data" key). Raises Unreadable."""
    _need(isinstance(data, dict), "it is not a record")
    d = _dict(data)
    classes = _class_rows(d)
    level = sum(_int(c.get("level")) for c in classes)
    rows = _inventory(d)
    values = _char_values(d)
    mods = _live_modifiers(d, classes, rows)
    everything = _everywhere(mods)
    pb = 2 + (level - 1) // 4 + sum(_int(m.get("value")) for m in _of(everything, "bonus", "proficiency-bonus"))
    attuned = min(6, sum(1 for r in rows if r.get("isAttuned")))
    scores = _scores(d, mods, pb, attuned)

    race = _dict(d.get("race"))
    class_defs = [fd for c in classes
                  for fd in _usable([_dict(cf.get("definition")) for cf in _dicts(c.get("classFeatures"))], _int(c.get("level")))]
    class_uses = _action_uses(d, "class")
    traits = _usable([_dict(t.get("definition")) for t in _dicts(race.get("racialTraits"))], level)
    feat_defs = [_dict(f.get("definition")) for f in _dicts(d.get("feats"))]
    resist, immune, vulnerable, condition = _defences(everything)
    armor, weapons, tools, languages = _proficiencies(d, everything)
    gear, magic = _inventory_lists(rows, values)
    align = _num(d.get("alignmentId"))

    character = Character(
        name=safe_name(d.get("name")),
        classes=[_class_level(c) for c in classes],
        level=level,
        xp=max(0, _int(d.get("currentXp"))),
        species=safe_name(race.get("fullName")),
        background=_background(d),
        alignment=ALIGNMENTS[align - 1] if align is not None and 1 <= align <= 9 else "",
        size=_size(d, everything),
        scores=scores,
        save_proficiencies=_saves(values, everything),
        skills=_skill_levels(values, everything, scores),
        resistances=resist, immunities=immune, vulnerabilities=vulnerable, condition_immunities=condition,
        class_features=_features(class_defs, class_uses, scores, pb),
        species_traits=_features(traits, _action_uses(d, "race"), scores, pb),
        feats=_features(feat_defs, _action_uses(d, "feat"), scores, pb, bookkeeping=False),
        spells=_spells(d, classes, rows, values),
        armor=armor, weapons=weapons, tools=tools, languages=languages,
        gear=gear, magic_items=magic,
        coins=_coins(d),
        speed=_walking_speed(d, everything, scores, rows),
    )
    # The calculator reads this module, so it is brought in here and not at the top.
    import dnd_ddb_calc
    character.hp_max = dnd_ddb_calc.hp_max(d, character)
    character.ac = dnd_ddb_calc.armour_class(d, character)
    character.attacks = dnd_ddb_calc.attacks(d, character)
    return character
