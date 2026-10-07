#!/usr/bin/env python3
"""Bring a D&D 5e (2024) PC note up to date from a D&D Beyond `Character`.

Reads the note the way dnd_sheet.py does and plans one `Edit` per cell or
labelled line, then writes the ones marked WRITE. A cell that is blank, a
`{placeholder}` or bare text is sync's to maintain. A cell with a bracketed
reason (`18 (tome)`) is the GM's and is kept. Stdlib only.

This part plans and writes the single cells (Level, XP, ability scores and
save proficiency, Size, Speed, Hit Dice, skill proficiency, the spellcasting
ability) and the `**Label:** value` lines (species, class, background,
alignment, defences, proficiencies). Never written here: Weapon Mastery,
anything a player tracks in play, and lists of rows.

Edit statuses: WRITE (the note changes), KEPT (the note is the GM's), SAME.
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_rules as dr  # noqa: E402
from dnd_ddb_read import ABILITIES, Character  # noqa: E402
from dnd_note import (BARE, HALF, PLACEHOLDER, REASONED, YES, Cell, Note,  # noqa: E402
                      clean, column, to_int)

REASON = re.compile(r"\(.+\)\s*$")
HIT_DICE = re.compile(r"^(\d+)\s*/\s*(\d+)$")
SPEED = re.compile(r"^(\d+)\s*(?:ft\.?|feet)?$", re.I)
GROUPED = re.compile(r"^\d{1,3}(?:,\d{3})+$")
LABEL_PREFIX = re.compile(r"^\s*\*\*[^*:]+:\*\*")
ABILITY_LABEL = re.compile(r"^spellcasting ability(?:\s*\((.+)\))?$")
NO = frozenset(("no", "n", "false", "0", "-", "—", "–"))
# Characters that end a line when the note is split, and the one that ends a cell.
BREAKS = re.compile(r"[\r\n\x0b\x0c\x1c-\x1e\x85  |]")
DEFENCES = (("Resistances", "resistances"), ("Immunities", "immunities"),
            ("Vulnerabilities", "vulnerabilities"), ("Condition Immunities", "condition_immunities"))
PROFICIENCIES = (("Armor Training", "armor"), ("Weapons", "weapons"), ("Tools", "tools"),
                 ("Languages", "languages"))


@dataclass
class Edit:
    status: str        # WRITE, KEPT or SAME
    locus: str
    message: str
    line: int = -1     # index into text.splitlines(keepends=True)
    col: int = -1      # cell index for a table cell; -1 for a whole labelled line
    new: str = ""      # the cell's new text, or the whole new line without its line ending


def safe(text: str) -> str:
    """A value that cannot break a cell or a line."""
    return BREAKS.sub(" ", text)


def blank(text: str) -> bool:
    return text == "" or bool(PLACEHOLDER.match(text))


def write(locus: str, old: str, cell: Cell | None, new: str, line: int = -1) -> Edit:
    """A WRITE edit for a cell, or for the whole labelled line `line` when `cell` is None."""
    shown = old or "(blank)"
    if cell is None:
        return Edit("WRITE", locus, f"{shown} -> {new}", line, -1, new)
    return Edit("WRITE", locus, f"{shown} -> {new}", cell.line, cell.col, new)


def judge_number(locus: str, cell: Cell, want: int) -> Edit:
    """A numeric cell against D&D Beyond's number."""
    new = str(want)
    text = cell.text.strip()
    if GROUPED.match(text):
        text = text.replace(",", "")
    if blank(text):
        return write(locus, "", cell, new)
    if BARE.match(text):
        return Edit("SAME", locus, text) if to_int(text) == want else write(locus, text, cell, new)
    if REASONED.match(text):
        return Edit("KEPT", locus, f"{text}; D&D Beyond gives {new}")
    return Edit("KEPT", locus, f"{text}; not read as a number; D&D Beyond gives {new}")


def judge_text(locus: str, cell: Cell, new: str, same: bool) -> Edit:
    """A text cell: `same` says whether the cell already means `new`."""
    text = cell.text.strip()
    if blank(text):
        return write(locus, "", cell, new)
    if REASON.search(text):
        return Edit("KEPT", locus, f"{text}; D&D Beyond gives {new}")
    return Edit("SAME", locus, text) if same else write(locus, text, cell, new)


def flag(text: str) -> str | None:
    """`Yes`, `No` or `Half` for a Proficient / Expertise cell, None when it is neither."""
    t = text.strip()
    if HALF.match(t):
        return "Half"
    if YES.match(t):
        return "Yes"
    return "No" if t.lower() in NO else None


def judge_flag(locus: str, cell: Cell, want: str) -> Edit:
    return judge_text(locus, cell, want, flag(cell.text) == want)


def cell_at(i: int, col: int, cells: list[str]) -> Cell | None:
    return Cell(i, col, cells[col]) if 0 <= col < len(cells) else None


def plan_core(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    level, xp = note.attr("stat sheet", "core", "level"), note.attr("stat sheet", "core", "xp")
    if level:
        out.append(judge_number("Stat Sheet / Core / Level", level, c.level))
    if xp:
        out.append(judge_number("Stat Sheet / Core / XP", xp, c.xp))
    return out


def plan_abilities(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    for i, header, cells in note.table("stat sheet", "ability scores"):
        key = clean(cells[0]).upper()[:3] if cells else ""
        if key not in ABILITIES or key not in c.scores:
            continue
        at = f"Stat Sheet / Ability Scores / {key} / "
        score = cell_at(i, column(header, r"score$"), cells)
        if score:
            out.append(judge_number(at + "Score", score, c.scores[key]))
        save = cell_at(i, column(header, r"sav.*prof"), cells)
        if save:
            out.append(judge_flag(at + "Save Proficiency", save, "Yes" if key in c.save_proficiencies else "No"))
    return out


def plan_hit_dice(note: Note, c: Character) -> list[Edit]:
    """Hit Dice (Spent/Max): the spent number is the player's; only the maximum is written."""
    locus = "Stat Sheet / Combat / Hit Dice"
    rows = [(i, cells) for i, _h, cells in note.table("stat sheet", "combat")
            if len(cells) > 1 and clean(cells[0]).lower().startswith("hit dice")]
    if not rows:
        return []
    if len(rows) > 1:
        return [Edit("KEPT", locus, "hit dice are split by die; check them")]
    i, cells = rows[0]
    if len(c.classes) > 1 and re.search(r"\bd\d+\b", cells[0].lower()):
        return [Edit("KEPT", locus, "hit dice are split by die; check them")]
    text = cells[1].strip()
    m = HIT_DICE.match(text)
    if not m:
        return [Edit("KEPT", locus, f"{text or '(blank)'}; not shaped spent/max; D&D Beyond gives {c.level} as the maximum")]
    new = f"{int(m.group(1))}/{c.level}"
    if int(m.group(2)) == c.level:
        return [Edit("SAME", locus, text)]
    return [write(locus, text, Cell(i, 1, cells[1]), new)]


def plan_combat(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    size = note.attr("stat sheet", "combat", "size")
    if size and c.size:
        out.append(judge_text("Stat Sheet / Combat / Size", size, safe(c.size),
                              size.text.strip().lower() == safe(c.size).lower()))
    speed = note.attr("stat sheet", "combat", "speed")
    if speed:
        locus, new = "Stat Sheet / Combat / Speed", f"{c.speed} ft"
        text = speed.text.strip()
        m = SPEED.match(text)
        if blank(text):
            out.append(write(locus, "", speed, new))
        elif m and int(m.group(1)) == c.speed:
            out.append(Edit("SAME", locus, text))
        else:
            out.append(Edit("KEPT", locus, f"{text}; D&D Beyond gives {new}"))
    out.extend(plan_hit_dice(note, c))
    return out


def plan_skills(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    for i, header, cells in note.table("skills"):
        name = clean(cells[0]) if cells else ""
        if not name:
            continue
        have = c.skills.get(name.lower(), "")
        proficient = {"proficient": "Yes", "expertise": "Yes", "half": "Half"}.get(have, "No")
        pro, exp = cell_at(i, column(header, r"prof"), cells), cell_at(i, column(header, r"expert"), cells)
        if pro:
            out.append(judge_flag(f"Skills / {name} / Proficient", pro, proficient))
        if exp:
            out.append(judge_flag(f"Skills / {name} / Expertise", exp, "Yes" if have == "expertise" else "No"))
    return out


def plan_spellcasting(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    casters = [k for k in c.classes if k.casting_ability]
    for i, _h, cells in note.table("spellcasting"):
        if len(cells) < 2:
            continue
        m = ABILITY_LABEL.match(clean(cells[0]).lower())
        if not m or not casters:
            continue
        locus, cell = f"Spellcasting / {clean(cells[0])}", Cell(i, 1, cells[1])
        text = cell.text.strip()
        if m.group(1):
            named = [k for k in casters if k.name.lower() == m.group(1).strip().lower()]
            if not named:
                out.append(Edit("KEPT", locus, f"{text or '(blank)'}; {m.group(1)} is not a casting class on D&D Beyond"))
                continue
            want = named[0].casting_ability
        elif len(casters) > 1:
            gives = ", ".join(f"{k.casting_ability} ({k.name})" for k in casters)
            out.append(Edit("KEPT", locus, f"{text or '(blank)'}; several casting classes; D&D Beyond gives {gives}"))
            continue
        else:
            want = casters[0].casting_ability
        out.append(judge_text(locus, cell, want, text.upper()[:3] == want))
    return out


def class_line(c: Character) -> str:
    return " / ".join(f"{k.name} {k.level}" + (f" ({k.subclass})" if k.subclass else "") for k in c.classes)


def judge_classes(locus: str, line: int, old: str, c: Character) -> Edit:
    """The Class/Subclass line: the same classes in any shape the reader takes are the same."""
    new = safe(class_line(c))
    if blank(old):
        return write(locus, "", None, new, line)
    read = dr.read_classes(old, c.level)
    if read is not None:
        mine = [(k.name.lower(), k.level, k.subclass.lower()) for k in c.classes]
        if [(k.name.lower(), k.level, k.subclass.lower()) for k in read] == mine:
            return Edit("SAME", locus, old)
    elif REASON.search(old):
        return Edit("KEPT", locus, f"{old}; D&D Beyond gives {new}")
    return write(locus, old, None, new, line)


def split_entries(text: str) -> list[str]:
    """Split on commas outside brackets."""
    out, depth, start = [], 0, 0
    for n, ch in enumerate(text):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            out.append(text[start:n].strip())
            start = n + 1
    out.append(text[start:].strip())
    return [e for e in out if e]


def judge_list(locus: str, line: int, old: str, names: list[str]) -> Edit:
    """Entry by entry: an entry with a bracketed reason stays, after D&D Beyond's names."""
    names = [safe(n) for n in names]
    kept = [e for e in split_entries(old) if REASON.search(e) and e not in names]
    held = {re.sub(r"\s*\(.+\)\s*$", "", e).lower() for e in kept}
    new = ", ".join([n for n in names if n.lower() not in held] + kept) or "—"
    if old == new:
        return Edit("SAME", locus, old)
    return write(locus, "" if blank(old) else old, None, new, line)


def as_line(label: str, edit: Edit) -> Edit:
    """A WRITE edit's new text as the whole `**Label:** value` line."""
    if edit.status == "WRITE":
        edit.new = f"**{label}:** {edit.new}"
    return edit


def plan_lines(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    for label, value in (("Species", c.species), ("Class/Subclass", None),
                         ("Background", c.background), ("Alignment", c.alignment)):
        hit = note.bold_at(label.lower())
        if not hit or (value is not None and not safe(value).strip()):
            continue
        i, old = hit
        locus = f"Background / {label}"
        if value is None:
            edit = judge_classes(locus, i, old, c)
        else:
            new = safe(value)
            edit = judge_text(locus, Cell(i, -1, old), new, old.lower() == new.lower())
        out.append(as_line(label, edit))
    for prefix, group in (("Stat Sheet / Defences", DEFENCES), ("Proficiencies", PROFICIENCIES)):
        for label, field in group:
            hit = note.bold_at(label.lower())
            if hit:
                out.append(as_line(label, judge_list(f"{prefix} / {label}", hit[0], hit[1], getattr(c, field))))
    return out


def plan_cells(text: str, c: Character) -> list[Edit]:
    """One Edit per single cell and labelled line the note has. Nothing is added."""
    note = Note(text)
    return (plan_core(note, c) + plan_abilities(note, c) + plan_combat(note, c) + plan_skills(note, c)
            + plan_spellcasting(note, c) + plan_lines(note, c))


def write_edits(text: str, edits: list[Edit]) -> str:
    """The note with every WRITE edit applied. Line endings are kept."""
    lines = text.splitlines(keepends=True)
    for e in (e for e in edits if e.status == "WRITE"):
        raw = lines[e.line]
        body = raw.rstrip("\r\n")
        eol = raw[len(body):]
        if e.col < 0:
            lines[e.line] = e.new + eol
            continue
        parts = re.split(r"(?<!\\)\|", body)
        # parts[0] is what precedes the first pipe; cell n is parts[n + 1].
        parts[e.col + 1] = f" {e.new} "
        lines[e.line] = "|".join(parts) + eol
    return "".join(lines)
