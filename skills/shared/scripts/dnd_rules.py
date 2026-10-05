#!/usr/bin/env python3
"""Rules checks for a D&D 5e (2024) PC note: slips in the numbers.

Read-only. `check(text)` returns findings; dnd_sheet.py prints them.
  WRONG      the sheet contradicts itself, whatever books are in use
  LOOK       a number differs from the SRD 5.2 table for the class and
             level; a reason in brackets beside the number settles it
  CANTCHECK  a class is not in SRD 5.2, so its tables cannot be consulted

Not checked: whether a choice is allowed (spell lists, feat requirements,
skill picks), armour class, attacks, skill counts. Stdlib only.
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_tables as dt  # noqa: E402
from dnd_note import PLACEHOLDER, YES, Note, clean, column, number, to_int  # noqa: E402

ORDER = {"WRONG": 0, "LOOK": 1, "CANTCHECK": 2}
CLASS = "Background / Class/Subclass"
COMBAT = "Stat Sheet / Combat"
SKIPPED = "so the checks that need a class's tables were skipped"
CLASS_PART = re.compile(r"^(?P<name>[^\d(,]+?)\s*(?P<level>\d+)?\s*(?:\((?P<sub>[^)]*)\))?$")
SLASH = re.compile(r"/(?![^(]*\))")       # a slash that is not inside brackets
HIT_DICE = re.compile(r"^hit dice(?:\s+d(\d+))?\s*\(spent\s*/\s*max\)$", re.I)
PAIR = re.compile(r"^(\d+)\s*/\s*(\d+)$")
NOTHING = re.compile(r"^(|[—–-]|none|n/a)$", re.I)


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


def read_classes(raw: str | None, level: int) -> list[ClassLevel] | None:
    """`Paladin 5 (Oath of Devotion) / Sorcerer 3`, or None when it cannot be
    read. One class with no number takes the character's level."""
    text = clean(raw or "")
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


def hit_dice(s: Sheet) -> list[Finding]:
    out: list[Finding] = []
    rows: dict[int | None, int] = {}
    for name, (value,) in s.rows("stat sheet", "combat", r"value"):
        m, pair = HIT_DICE.match(name), PAIR.match(value or "")
        if not m or not pair:
            continue
        die = int(m.group(1)) if m.group(1) else None
        spent, most = int(pair.group(1)), int(pair.group(2))
        if spent > most:
            out.append(Finding("WRONG", f"{COMBAT} / Hit Dice{f' d{die}' if die else ''}",
                               f"{spent} spent of {most}"))
        rows[die] = most
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
        u, o = number(used or "")[0], number(owned or "")[0]
        if u is not None and o is not None and u > o:
            out.append(Finding("WRONG", locus, words.format(u, o)))

    for name, (total, spent) in s.rows("spellcasting", "spell slots", r"total", r"expended"):
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
    shown = death.text.strip() if death else ""
    pair = PAIR.match(shown)
    if pair and max(int(pair.group(1)), int(pair.group(2))) > 3:
        out.append(Finding("WRONG", f"{COMBAT} / Death Saves (S/F)", f"{shown}; a count cannot pass 3"))
    return out


CHECKS = [class_line, levels, hit_dice, attunement, expertise, over_spent]


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
