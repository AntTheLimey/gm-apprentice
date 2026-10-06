#!/usr/bin/env python3
"""Rules checks for a D&D 5e (2024) PC note: slips in the numbers.

Read-only. `check(text)` returns findings; dnd_sheet.py prints them.
  WRONG      the sheet contradicts itself, whatever books are in use
  LOOK       a number differs from the SRD 5.2 table for the class and
             level; a reason in brackets beside a score over 20 or
             `HP (Max)` settles it
  CANTCHECK  a class is not in SRD 5.2, so its tables cannot be consulted

Not checked: whether a choice is allowed (spell lists, feat requirements,
skill picks), armour class, attacks, skill counts. Stdlib only.
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_calc as dc  # noqa: E402
import dnd_tables as dt  # noqa: E402
from dnd_note import PLACEHOLDER, YES, Note, clean, column, number, to_int  # noqa: E402

PACT_ROW = re.compile(r"^pact\b", re.I)
SLOT_TOTAL, SLOT_USED = r"(total|max)$", r"(expended|used|spent)$"
ORDER = {"WRONG": 0, "LOOK": 1, "CANTCHECK": 2}
CLASS = "Background / Class/Subclass"
COMBAT = "Stat Sheet / Combat"
SKIPPED = "so the checks that need a class's tables were skipped"
CLASS_PART = re.compile(r"^(?P<name>[^\d(,]+?)\s*(?P<level>\d+)?\s*(?:\((?P<sub>[^)]*)\))?$")
SLASH = re.compile(r"/(?![^(]*\))")       # a slash that is not inside brackets
HIT_DICE = re.compile(r"^hit dice(?:\s+d(\d+))?\s*\(spent\s*/\s*max\)$", re.I)
PAIR = re.compile(r"^(\d+)\s*/\s*(\d+)$")
NOTHING = re.compile(r"^(|[—–-]|none|n/a)$", re.I)
ORDINALS = ("1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th")
SLOT_LOCUS = "Spellcasting / Spell Slots"
SPELL_LOCUS = "Spellcasting / Spells"
SCORES = "Stat Sheet / Ability Scores"


@dataclass
class Finding:
    status: str
    locus: str
    message: str


@dataclass
class ClassLevel:
    name: str          # as the note writes it
    level: int
    subclass: str


def num(text: str | None) -> tuple[int | None, bool]:
    """dnd_note.number, reading `**60**` or `*3*` as its number."""
    return number(re.sub(r"[*_]", "", text or ""))


def plain(text: str | None) -> str:
    return re.sub(r"[*_]", "", text or "").strip()


def read_classes(raw: str | None, level: int) -> list[ClassLevel] | None:
    """`Paladin 5 (Oath of Devotion) / Sorcerer 3`, or None when it cannot be
    read. One class with no number takes the character's level."""
    text = re.sub(r"[*_]", "", clean(raw or "")).strip()
    if not text or PLACEHOLDER.match(text):
        return None
    parts = [p.strip() for p in SLASH.split(text)]
    out: list[ClassLevel] = []
    for part in parts:
        m = CLASS_PART.match(part)
        if not m or (m.group("level") is None and len(parts) > 1):
            return None
        own = int(m.group("level")) if m.group("level") else level
        if not 1 <= own <= 20 or m.group("name").strip().lower().startswith("level"):
            return None
        out.append(ClassLevel(m.group("name").strip(), own, (m.group("sub") or "").strip()))
    return out


class Sheet:
    """A note as the checks read it."""

    def __init__(self, text: str):
        self.note = Note(text)
        cell = self.note.attr("stat sheet", "core", "level")
        self.level = to_int(cell.text) if cell else None
        self.classes = read_classes(self.note.bold("class/subclass"), self.level or 0)
        pairs = [(c, dt.known(c.name)) for c in self.classes or []]
        self.known = bool(pairs) and all(info for _c, info in pairs)
        self.infos: list[tuple[ClassLevel, dt.ClassInfo]] = (
            [(c, info) for c, info in pairs if info] if self.known else [])
        self.levels: dict[str, int] = {}
        for c, _info in self.infos:
            self.levels[c.name.lower()] = self.levels.get(c.name.lower(), 0) + c.level
        self.who = " / ".join(f"{c.name} {c.level}" for c in self.classes or [])

    def rows(self, h2: str, h3: str, *patterns: str) -> list[tuple[str, list[str | None]]]:
        """(first cell as a name, the cells under each header pattern) per row.
        A row with no name is skipped; a column the table lacks gives None."""
        out: list[tuple[str, list[str | None]]] = []
        for _i, header, cells in self.note.table(h2, h3):
            name = clean(cells[0]) if cells else ""
            if not name or PLACEHOLDER.match(name):
                continue
            cols = [column(header, p) for p in patterns]
            out.append((name, [cells[c].strip() if 0 <= c < len(cells) else None for c in cols]))
        return out


def class_line(s: Sheet) -> list[Finding]:
    if s.classes is None:
        return [Finding("CANTCHECK", CLASS, f"no class line could be read, {SKIPPED}")]
    unknown = [c.name for c in s.classes if not dt.known(c.name)]
    if unknown:
        return [Finding("CANTCHECK", CLASS,
                        f"{', '.join(unknown)} is not a class in the free rules, {SKIPPED}")]
    return []


def levels(s: Sheet) -> list[Finding]:
    total = sum(c.level for c in s.classes or [])
    if s.classes and total != s.level:
        return [Finding("WRONG", CLASS, f"the class levels add up to {total}; Level is {s.level}")]
    return []


def spell_level(text: str | None) -> int | None:
    """`Cantrip`, `Cantrips`, `3` or `3rd` as 0 to 9."""
    t = plain(text).lower()
    if t in ("cantrip", "cantrips"):
        return 0
    m = re.fullmatch(r"([1-9])(?:st|nd|rd|th)", t)
    return int(m.group(1)) if m else to_int(t)


def hit_dice(s: Sheet) -> list[Finding]:
    out: list[Finding] = []
    rows: dict[int | None, int] = {}
    for name, (value,) in s.rows("stat sheet", "combat", r"value"):
        m, pair = HIT_DICE.match(name), PAIR.match(plain(value))
        if not m or not pair:
            continue
        die = int(m.group(1)) if m.group(1) else None
        spent, most = int(pair.group(1)), int(pair.group(2))
        if spent > most:
            out.append(Finding("WRONG", f"{COMBAT} / Hit Dice{f' d{die}' if die else ''}",
                               f"{spent} spent of {most}"))
        rows[die] = rows.get(die, 0) + most
    if list(rows) == [None]:
        if rows[None] != s.level:
            out.append(Finding("WRONG", f"{COMBAT} / Hit Dice",
                               f"the note has {rows[None]}; Level {s.level} gives {s.level}"))
        return out
    if not s.known or not rows:
        return out
    want: dict[int, int] = {}
    for c, info in s.infos:
        want[info.die] = want.get(info.die, 0) + c.level
    for die, most in rows.items():
        if die is not None and most != want.get(die, 0):
            out.append(Finding("WRONG", f"{COMBAT} / Hit Dice d{die}",
                               f"the note has {most}; {s.who} gives {want.get(die, 0)}"))
    for die, n in want.items():
        if die not in rows:
            out.append(Finding("WRONG", f"{COMBAT} / Hit Dice", f"no d{die} row; {s.who} gives {n}"))
    return out


def attunement(s: Sheet) -> list[Finding]:
    locus = "Equipment / Magic Items"
    count = sum(1 for _n, (a,) in s.rows("equipment", "magic items", r"attuned") if a and YES.match(a))
    old = s.rows("equipment", "magic item attunement", r"item")
    if old and not s.note.table("equipment", "magic items"):
        locus = "Equipment / Magic Item Attunement"
        count = sum(1 for _n, (item,) in old
                    if item and not NOTHING.match(item) and not PLACEHOLDER.match(item))
    if count > 3:
        return [Finding("WRONG" if s.known else "LOOK", locus, f"{count} items attuned; the limit is 3")]
    return []


def expertise(s: Sheet) -> list[Finding]:
    return [Finding("WRONG", f"Skills / {name}", "Expertise is marked but Proficient is not")
            for name, (prof, expert) in s.rows("skills", "", r"prof", r"expert")
            if expert and YES.match(expert) and not (prof and YES.match(prof))]


def over_spent(s: Sheet) -> list[Finding]:
    out: list[Finding] = []

    def over(locus: str, used: str | None, owned: str | None, words: str) -> None:
        u, o = num(used)[0], num(owned)[0]
        if u is not None and o is not None and u > o:
            out.append(Finding("WRONG", locus, words.format(u, o)))

    for name, (total, spent) in s.rows("spellcasting", "spell slots", SLOT_TOTAL, SLOT_USED):
        over(f"Spellcasting / Spell Slots / {name}", spent, total, "{} expended of {}")
    for h2, title in (("class features", "Class Features"), ("species traits", "Species Traits"),
                      ("feats", "Feats")):
        for name, (uses, used) in s.rows(h2, "", r"uses$", r"used$"):
            over(f"{title} / {name}", used, uses, "{} used of {}")
    for name, (charges, used) in s.rows("equipment", "magic items", r"charges$", r"used$"):
        over(f"Equipment / Magic Items / {name}", used, charges, "{} used of {} charges")
    now, most = s.note.attr("stat sheet", "combat", "hp (current)"), s.note.attr("stat sheet", "combat", "hp (max)")
    if now and most:
        over(f"{COMBAT} / HP (Current)", now.text, most.text, "{} is above HP (Max) {}")
    death = s.note.attr("stat sheet", "combat", "death saves (s/f)")
    shown = plain(death.text) if death else ""
    pair = PAIR.match(plain(shown))
    if pair and max(int(pair.group(1)), int(pair.group(2))) > 3:
        out.append(Finding("WRONG", f"{COMBAT} / Death Saves (S/F)", f"{shown}; a count cannot pass 3"))
    return out


def score_cap(s: Sheet, key: str) -> int:
    """20, or 25 where a class's own level-20 feature raises that score."""
    cap = 20
    for c, _info in s.infos:
        at, abilities, top = dt.LEVEL_20_SCORES.get(c.name.lower(), (21, (), 20))
        if c.level >= at and key in abilities:
            cap = max(cap, top)
    return cap


def scores(s: Sheet) -> list[Finding]:
    out: list[Finding] = []
    for name, (cell,) in s.rows("stat sheet", "ability scores", r"score$"):
        key = name.upper()[:3]
        value, reasoned = num(cell)
        if key not in dc.ABILITIES or value is None:
            continue
        cap = score_cap(s, key)
        if value > 30:
            out.append(Finding("WRONG", f"{SCORES} / {key}", f"{value}; a score cannot pass 30"))
        elif value > cap and not reasoned:
            out.append(Finding("LOOK", f"{SCORES} / {key}",
                               f"{value}; a score over 20 needs a reason beside it"))
    return out


def casting(s: Sheet) -> list[Finding]:
    """Slot totals, then the spell list. A class with no spells of its own
    that has slots is beyond the free rules: one CANTCHECK, nothing else."""
    if not s.known or sum(c.level for c, _info in s.infos) != s.level:
        return []
    out: list[Finding] = []
    slot_rows = s.rows("spellcasting", "spell slots", SLOT_TOTAL)
    pact_rows = [(n, tot) for n, (tot,) in slot_rows if PACT_ROW.match(n)]
    pact = dt.pact_slots(s.levels)
    want = dt.numbered_slots(s.levels) if pact_rows else dt.slots_for(s.levels)
    differ: list[tuple[int, str, str, str]] = []     # (order, row, the note has, the table gives)
    seen: set[int] = set()
    for name, (total,) in slot_rows:
        m = re.match(r"^(?:level\s+)?([1-9])", name, re.I)
        if not m:
            continue
        at = int(m.group(1))
        seen.add(at)
        have, reasoned = num(total)
        blank = not plain(total) or bool(PLACEHOLDER.match(plain(total)))
        if reasoned or (have is None and not blank):
            continue
        if (have or 0) != want[at - 1]:
            differ.append((at, ORDINALS[at - 1], "(blank)" if have is None else str(have), str(want[at - 1])))
    differ += [(at, ORDINALS[at - 1], "no row", str(want[at - 1]))
               for at in range(1, 10) if at not in seen and want[at - 1]]
    expected = sum(1 for n in want if n)
    if pact_rows:
        label, total = pact_rows[0]
        if pact is None:
            out.append(Finding("LOOK", f"{SLOT_LOCUS} / {label}", f"a Pact row, but {s.who} has no Warlock levels"))
        else:
            expected += 1
            count, slot_level = pact
            have, reasoned = num(total)
            blank = not plain(total) or bool(PLACEHOLDER.match(plain(total)))
            digit = re.search(r"\d", label)
            at_level = int(digit.group()) if digit else None
            if not reasoned and (have is not None or blank) and (
                    (have or 0) != count or (at_level is not None and at_level != slot_level)):
                said = "(blank)" if have is None else str(have)
                differ.append((10, label, said + (f" at level {at_level}" if at_level else ""),
                               f"{count} at level {slot_level}"))
    differ.sort()
    without = [c.name for c, info in s.infos if info.caster == dt.NONE]
    if differ and without:
        return [Finding("CANTCHECK", SLOT_LOCUS,
                        f"the totals differ from the table for {s.who}; {', '.join(without)} may cast "
                        "through a subclass the free rules do not cover, so slots and spell counts "
                        "were not checked")]
    if expected and len(differ) == expected and all(d[2] in ("(blank)", "no row") for d in differ):
        out.append(Finding("LOOK", SLOT_LOCUS, f"no slot totals in the note; {s.who} has slots"))
    else:
        out += [Finding("LOOK", f"{SLOT_LOCUS} / {row}", f"the note has {have}; {s.who} gives {gives}")
                for _order, row, have, gives in differ]
    casters = [(c, info) for c, info in s.infos if info.caster != dt.NONE]
    if not casters:
        return out
    table = s.note.table("spellcasting", "spells")
    no_source = bool(table) and column(table[0][1], r"source$") < 0
    said = ("; this note has no Source column, so a spell from a feat or item is counted "
            "unless its Tags name the source (`Item: …`)" if no_source else "")
    top = max(dt.max_spell_level(c.name.lower(), c.level) for c, _info in casters)
    cantrips = prepared = 0
    counted: set[str] = set()
    for name, (level, tags, source) in s.rows("spellcasting", "spells", r"level$", r"tags$", r"source$"):
        if (source and not NOTHING.match(source)) or "always prepared" in (tags or "").lower():
            continue
        if no_source and any(":" in tag for tag in (tags or "").split(",")):
            continue
        if clean(name).lower() in counted:
            continue
        counted.add(clean(name).lower())
        at_level = spell_level(level)
        if at_level is None or not 0 <= at_level <= 9:
            continue
        if at_level == 0:
            cantrips += 1
            continue
        prepared += 1
        if at_level > top:
            out.append(Finding("LOOK", f"{SPELL_LOCUS} / {name}",
                               f"level {at_level}; the highest {s.who} can prepare is level {top}"))
    may_cantrips = sum(dt.cantrips_allowed(c.name.lower(), c.level) for c, _info in casters)
    may_prepare = sum(dt.prepared_allowed(c.name.lower(), c.level) for c, _info in casters)
    if cantrips > may_cantrips:
        out.append(Finding("LOOK", SPELL_LOCUS, f"{cantrips} cantrips; {s.who} allows {may_cantrips}{said}"))
    if prepared > may_prepare:
        out.append(Finding("LOOK", SPELL_LOCUS,
                           f"{prepared} spells of level 1 and up; {s.who} allows {may_prepare}{said}"))
    return out


def hit_points(s: Sheet) -> list[Finding]:
    """The widest range the dice allow: the note does not say which class came first."""
    cell = s.note.attr("stat sheet", "combat", "hp (max)")
    have, reasoned = num(cell.text) if cell else (None, False)
    con = next((num(c)[0] for name, (c,) in s.rows("stat sheet", "ability scores", r"score$")
                if name.upper()[:3] == "CON"), None)
    if not s.known or have is None or reasoned or con is None or s.level is None:
        return []
    total = sum(c.level for c, _info in s.infos)
    if total != s.level:
        return []
    mod = dc.ability_mod(con)
    extra = 0
    if clean(s.note.bold("species") or "").lower().split()[-1:] == ["dwarf"]:
        extra += total
    extra += sum(c.level for c, _info in s.infos
                 if c.name.lower() == "sorcerer" and c.subclass.lower() == "draconic sorcery" and c.level >= 3)
    least = min(info.die for _c, info in s.infos) + mod + (total - 1) * max(1, 1 + mod) + extra
    most = max(least, sum(max(1, info.die + mod) * c.level for c, info in s.infos) + extra)
    if least <= have <= most:
        return []
    allow = f"exactly {least}" if least == most else f"{least} to {most}"
    return [Finding("LOOK", f"{COMBAT} / HP (Max)", f"{have}; the dice allow {allow} for {s.who}")]


def saves(s: Sheet) -> list[Finding]:
    table = s.note.table("stat sheet", "ability scores")
    if not s.known or not table or column(table[0][1], r"sav.*prof") < 0:
        return []
    marked = [name.upper()[:3] for name, (p,) in s.rows("stat sheet", "ability scores", r"sav.*prof")
              if p and YES.match(p)]
    if any(set(info.saves) <= set(marked) for _c, info in s.infos):
        return []
    pairs = list(dict.fromkeys(f"{info.saves[0]} and {info.saves[1]}" for _c, info in s.infos))
    return [Finding("LOOK", SCORES, f"{s.who} is proficient in {' or '.join(pairs)}; "
                                    f"the note marks {', '.join(marked) or 'none'}")]


CHECKS = [class_line, levels, hit_dice, attunement, expertise, over_spent,
          scores, casting, hit_points, saves]


def check(text: str) -> list[Finding]:
    """Every finding, WRONG first. Nothing when the sheet has no readable
    Level: dnd_sheet.py has already said so."""
    s = Sheet(text)
    if s.level is None or not 1 <= s.level <= 20:
        return []
    found: list[Finding] = []
    for part in CHECKS:
        found.extend(part(s))
    return sorted(found, key=lambda f: ORDER[f.status])
