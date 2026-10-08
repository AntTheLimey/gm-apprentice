#!/usr/bin/env python3
"""Bring a D&D 5e (2024) PC note up to date from a D&D Beyond `Character`.

Reads the note the way dnd_sheet.py does and plans one `Edit` per cell or
labelled line, then writes the ones marked WRITE. A cell that is blank, a
`{placeholder}` or bare text is sync's to maintain. A cell with a bracketed
reason (`18 (tome)`) is the GM's and is kept. Stdlib only.

Usage:
  dnd_ddb.py SHEET.md [--write]               preview (or write) one note
  dnd_ddb.py --party VAULT [--write] [--on-build]   every PC note with a D&D Beyond link
The only request ever made is to character-service.dndbeyond.com, with a path of digits.

This part plans and writes the single cells (Level, XP, ability scores and
save proficiency, Size, Speed, Hit Dice, skill proficiency, the spellcasting
ability) and the `**Label:** value` lines (species, class, background,
alignment, defences, proficiencies), and the lists (features, feats, spells,
gear, magic items, coins) as table rows that are matched, added, removed or
kept, and the spell slot totals (and a Warlock's Pact row). It also writes the
three things dnd_ddb_calc works out: HP (Max) and AC (blank or bare cells), the
`**Armour Class:**` line (blank or placeholder only) and the attacks table
(`### Weapons & Damage Cantrips`, a list like the others, Notes never written).
When the calculator is unsure nothing is written and a CHECK row says why.
Never written here: Weapon Mastery, HP (Current) and anything a player tracks
in play.

Edit statuses: WRITE (the note changes), KEPT (the note is the GM's), SAME,
CHECK (something to look at; writes nothing). Row statuses: ADD, REMOVE, WRITE,
KEPT, SAME, CHECK.

Sync remembers what it added. After a sync with --write, the keys of what D&D
Beyond gave for each list are saved to `<vault>/_meta/dndbeyond/<id>.json`. A row
(or an entry of a labelled list) that matches nothing on D&D Beyond is removed
only when that memory holds it; any other row is the GM's and stays, unreported.
With no memory (a first sync, a lost file, a note outside a vault) nothing is removed.

The planners run in this order, each on the text the step before produced:
`t = write_edits(t, plan_cells(t, c))`, `t = write_edits(t, plan_slots(t, c))`,
`t = write_edits(t, plan_worked(t, c))`, `t = write_rows(t, plan_rows(t, c))`,
`t = write_rows(t, plan_attacks(t, c))`. Each plans against the text it is
given, so the line numbers of one are not valid for the next.
"""

import argparse
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Collection
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_rules as dr  # noqa: E402
import dnd_sheet  # noqa: E402
import dnd_tables as dt  # noqa: E402
from dnd_ddb_read import ABILITIES, Character, Unreadable, read, safe_name  # noqa: E402
from dnd_note import (BARE, HALF, HEADING, PLACEHOLDER, REASONED, SEPARATOR, YES,  # noqa: E402
                      Cell, Note, clean, column, number, split_cells, to_int)
from dnd_sheet import to_weight  # noqa: E402
from migrate_core import StepFailed, write_text_atomic  # noqa: E402
from vaultlib import (entity_type, extract_frontmatter, fence_step, read_publish_scalar,  # noqa: E402
                      vault_files)

REASON = re.compile(r"\(.+\)\s*$")
HIT_DICE = re.compile(r"^(\d+)\s*/\s*(\d+)$")
GROUPED = re.compile(r"^\d{1,3}(?:,\d{3})+$")
LABEL_AT = re.compile(r"\*\*[^*:]+:\*\*")
ABILITY_LABEL = re.compile(r"^spellcasting ability(?:\s*\((.+)\))?$")
NO = frozenset(("no", "n", "false", "0", "-", "—", "–"))
DASHES = frozenset(("-", "—", "–"))
# Characters that end a line when the note is split, and the one that ends a cell.
BREAKS = re.compile(r"[\r\n\x0b\x0c\x1c-\x1e\x85  |]")
DEFENCES = (("Resistances", "resistances"), ("Immunities", "immunities"),
            ("Vulnerabilities", "vulnerabilities"), ("Condition Immunities", "condition_immunities"))
PROFICIENCIES = (("Armor Training", "armor"), ("Weapons", "weapons"), ("Tools", "tools"),
                 ("Languages", "languages"))


Seen = dict[str, list[str]]     # list id -> the keys of the entries D&D Beyond gave on the last sync


@dataclass
class Edit:
    status: str        # WRITE, KEPT, SAME or CHECK (a CHECK has line -1 and writes nothing)
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
        # A Speed that holds text is the GM's and is not reported at all.
        if blank(text):
            out.append(write(locus, "", speed, new))
    out.extend(plan_hit_dice(note, c))
    return out


def plan_skills(note: Note, c: Character) -> list[Edit]:
    out: list[Edit] = []
    for i, header, cells in note.table("skills"):
        c_ab, c_mod = column(header, r"abilit"), column(header, r"(mod|bonus)")
        if min(c_ab, c_mod) < 0 or len(cells) <= max(c_ab, c_mod):
            continue
        name = clean(cells[0])
        if not name or cells[c_ab].strip().upper()[:3] not in ABILITIES:
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


def judge_list(locus: str, line: int, old: str, names: list[str], remembered: Collection[str] = ()) -> Edit:
    """Entry by entry: D&D Beyond's names, then the entries that are the GM's. An entry is D&D
    Beyond's when its whole name is one of the names, and sync's own (so dropped) when the memory
    holds it; any other entry stays."""
    names = [safe(n) for n in names]
    gives = {norm(n) for n in names}
    entries = [] if blank(old) or old.strip() in DASHES else split_entries(old)
    kept = [e for e in entries if norm(e) not in gives and norm(e) not in remembered]
    new = ", ".join(names + kept) or "—"
    if old == new:
        return Edit("SAME", locus, old)
    return write(locus, "" if blank(old) else old, None, new, line)


def as_line(label: str, edit: Edit) -> Edit:
    """A WRITE edit's new text as the whole `**Label:** value` line."""
    if edit.status == "WRITE":
        edit.new = f"**{label}:** {edit.new}"
    return edit


def plan_lines(note: Note, c: Character, seen: Seen | None = None) -> list[Edit]:
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
                remembered = set((seen or {}).get(label.lower(), ()))
                out.append(as_line(label, judge_list(f"{prefix} / {label}", hit[0], hit[1], getattr(c, field), remembered)))
    return out


def plan_cells(text: str, c: Character, seen: Seen | None = None) -> list[Edit]:
    """One Edit per single cell and labelled line the note has. Nothing is added."""
    note = Note(text)
    return (plan_core(note, c) + plan_abilities(note, c) + plan_combat(note, c) + plan_skills(note, c)
            + plan_spellcasting(note, c) + plan_lines(note, c, seen))


def split_eol(raw: str) -> tuple[str, str]:
    """A line of splitlines(keepends=True) as (text, its line ending, whatever that is)."""
    body = raw.splitlines()[0] if raw.splitlines() else ""
    return body, raw[len(body):]


def write_edits(text: str, edits: list[Edit]) -> str:
    """The note with every WRITE edit applied. Line endings are kept."""
    lines = text.splitlines(keepends=True)
    for e in (e for e in edits if e.status == "WRITE"):
        raw = lines[e.line]
        body, eol = split_eol(raw)
        if e.col < 0:
            # Whatever precedes the `**Label:**` (indent, `> `) stays.
            label = LABEL_AT.search(body)
            lines[e.line] = (body[:label.start()] if label else "") + e.new + eol
            continue
        parts = re.split(r"(?<!\\)\|", body)
        # parts[0] is what precedes the first pipe; cell n is parts[n + 1].
        parts[e.col + 1] = f" {e.new} " if e.new else " "
        lines[e.line] = "|".join(parts) + eol
    return "".join(lines)


# --- the lists ---------------------------------------------------------------------------

@dataclass
class RowEdit:
    status: str        # ADD, REMOVE, WRITE, KEPT, SAME or CHECK (a CHECK has line -1 and writes nothing)
    locus: str         # "Spells / Foresight", "Equipment / Gear / Rope, Hempen"
    message: str
    line: int = -1     # the row's line for REMOVE and WRITE; the line to insert after for ADD
    new: str = ""      # the whole new row line for ADD and WRITE
    silent: bool = False   # applied but not reported: the template's blank row going when a row is added


@dataclass
class Col:
    title: str
    pattern: str       # the page's pattern for this column (tools/publish/lib/templates/dnd/parse.js COLS)
    kind: str          # num, text, recovers, flag, level, weight or tags


@dataclass
class Spec:
    locus: str
    h2: str
    h3: str
    nouns: tuple[str, str]      # one, many: for "12 spells were not written"
    key: str                    # the key column's pattern
    cols: tuple[Col, ...]
    list_id: str = ""           # the list's id in the memory of what sync added


@dataclass
class Entry:
    name: str
    wants: dict[str, Any]       # column title -> what D&D Beyond says; None when it has no opinion


@dataclass
class Table:
    header: list[str]
    rows: list[tuple[int, list[str]]]   # every data row, blank ones too
    last: int                           # the table's last line


FEATURE_COLS = (Col("Uses", r"^uses$", "num"), Col("Recovers", r"^recovers?$", "recovers"))
FEATURE_KEY = r"^(name|feature|trait|feat)$"
SPEC_LIST = {
    "class_features": Spec("Class Features", "class features", "", ("class feature", "class features"),
                           FEATURE_KEY, FEATURE_COLS),
    "species_traits": Spec("Species Traits", "species traits", "", ("species trait", "species traits"),
                           FEATURE_KEY, FEATURE_COLS),
    "feats": Spec("Feats", "feats", "", ("feat", "feats"), FEATURE_KEY, FEATURE_COLS),
    "spells": Spec("Spells", "spellcasting", "spells", ("spell", "spells"), r"^spell$", (
        Col("Level", r"^level$", "level"), Col("Time", r"^(casting )?time$", "text"),
        Col("Range", r"^range$", "text"), Col("Components", r"^comp", "text"),
        Col("Duration", r"^duration$", "text"), Col("Tags", r"^tags?$", "tags"),
        Col("Source", r"^source$", "text"))),
    "gear": Spec("Equipment / Gear", "equipment", "gear", ("gear item", "gear items"), r"^item$", (
        Col("Qty", r"^(qty|quantity)$", "num"), Col("Weight", r"^weight$", "weight"))),
    "magic_items": Spec("Equipment / Magic Items", "equipment", "magic items", ("magic item", "magic items"),
                        r"^item$", (Col("Attuned", r"^attuned$", "flag"), Col("Charges", r"^charges$", "num"),
                                    Col("Recovers", r"^recovers?$", "recovers"))),
}
SPECS = {name: replace(spec, list_id=name.replace("_", " ")) for name, spec in SPEC_LIST.items()}
COIN_COLS = tuple((k.upper(), rf"^{k}$") for k in ("cp", "sp", "ep", "gp", "pp"))
OWNED_TAGS = {"c": "C", "r": "R", "always prepared": "Always prepared"}
LINK_TARGET = re.compile(r"\[\[([^\]|\\#]+)")
GONE = "D&D Beyond no longer has it"


def norm(text: str) -> str:
    return " ".join(text.lower().split())


def find_table(lines: list[str], h2: str, h3: str) -> Table | None:
    """The first table under the heading, with its blank rows (Note.table drops those)."""
    cur2 = cur3 = ""
    table: Table | None = None
    in_fm = bool(lines) and lines[0].strip() == "---"
    fence: str | None = None
    for i, raw in enumerate(lines):
        s = raw.strip()
        if in_fm:
            if i > 0 and s == "---":
                in_fm = False
            continue
        fence, is_fence_line = fence_step(raw, fence)
        if is_fence_line or fence is not None:
            continue
        m = HEADING.match(s)
        if m or not s.startswith("|"):
            if table is not None:
                return table
            if m and len(m.group(1)) == 2:
                cur2, cur3 = m.group(2).strip().lower(), ""
            elif m:
                cur3 = m.group(2).strip().lower()
            continue
        if (cur2, cur3) != (h2, h3):
            continue
        cells = split_cells(s)
        if table is None:
            table = Table(cells, [], i)
        else:
            table.last = i
            if not all(SEPARATOR.match(c) for c in cells if c) or not any(cells):
                table.rows.append((i, cells))
    return table


def candidates(raw: str) -> list[str]:
    """The whole names a first cell may be matched by. A link `[[Rope, Hempen\\|rope]]` offers its
    text and its target."""
    shown = clean(raw)
    names = [shown]
    link = LINK_TARGET.search(raw)
    if link and clean(link.group(1)) != shown:
        names.append(clean(link.group(1)))
    return [norm(n) for n in names]


def set_cell(row: str, col: int, new: str) -> str:
    """The row line with cell `col` replaced; every other byte stays."""
    parts = re.split(r"(?<!\\)\|", row)
    parts[col + 1] = f" {new} " if new else " "
    return "|".join(parts)


def plain_row(cells: list[str]) -> str:
    return "|" + "|".join(f" {c} " if c else " " for c in cells) + "|"


def level_text(level: int) -> str:
    return "Cantrip" if level == 0 else dr.ORDINALS[level - 1]


def value_text(kind: str, want: Any) -> str:
    """What a column holds for a new row."""
    if want is None:
        return ""
    if kind == "level":
        return level_text(want)
    if kind == "tags":
        return ", ".join(want)
    return safe(str(want))


def judge_tags(locus: str, cell: Cell, want: list[str]) -> Edit:
    """Sync owns only C, R and Always prepared in a Tags cell; the GM's other tags stay in place."""
    text = cell.text.strip()
    if REASON.search(text):
        return Edit("KEPT", locus, f"{text}; D&D Beyond gives {', '.join(want) or '(none)'}")
    tokens = [] if blank(text) else [t.strip() for t in text.split(",") if t.strip()]
    wanted = {w.lower() for w in want}
    keep = [t for t in tokens if t.lower() not in OWNED_TAGS or t.lower() in wanted]
    new = ", ".join(keep + [w for w in want if w.lower() not in {t.lower() for t in tokens}])
    if new == ", ".join(tokens):
        return Edit("SAME", locus, text)
    edit = write(locus, text, cell, new)
    edit.message = f"{text or '(blank)'} -> {new or '(blank)'}"
    return edit


def judge_column(kind: str, locus: str, cell: Cell, want: Any) -> Edit:
    text = cell.text.strip()
    if kind == "num":
        return judge_number(locus, cell, want)
    if kind == "flag":
        return judge_flag(locus, cell, want)
    if kind == "tags":
        return judge_tags(locus, cell, want)
    if kind == "level":
        return judge_text(locus, cell, level_text(want), dr.spell_level(text) == want)
    new = safe(str(want))
    if kind == "weight":
        mine = to_weight(text)
        return judge_text(locus, cell, new, mine is not None and mine == to_weight(new))
    if kind == "recovers":
        return judge_text(locus, cell, new, norm(text) in (norm(new), norm(new).split(" ")[0]))
    return judge_text(locus, cell, new, norm(text) == norm(new))


def feature_entries(features: list[Any]) -> list[Entry]:
    return [Entry(safe_name(f.name), {"Uses": f.uses, "Recovers": f.recovers or None}) for f in features]


def entries_for(name: str, c: Character) -> list[Entry]:
    if name in ("class_features", "species_traits", "feats"):
        return feature_entries(getattr(c, name))
    if name == "spells":
        return [Entry(safe_name(s.name), {"Level": s.level, "Time": s.time or None, "Range": s.range or None,
                                     "Components": s.components or None, "Duration": s.duration or None,
                                     "Tags": list(s.tags), "Source": s.source or None}) for s in c.spells]
    if name == "gear":
        return [Entry(safe_name(g.name), {"Qty": g.qty, "Weight": g.weight or None}) for g in c.gear]
    return [Entry(safe_name(m.name), {"Attuned": "Yes" if m.attuned else "No", "Charges": m.charges,
                                 "Recovers": m.recovers or None}) for m in c.magic_items]


def match_row(cells: list[str], key: int, by_key: dict[str, Entry], matched: set[str]) -> tuple[Entry | None, bool]:
    """(the entry the row is, whether the row is a duplicate of an entry already matched)."""
    for k in candidates(cells[key]):
        if k in by_key:
            return (None, True) if k in matched else (by_key[k], False)
    return None, False


def plan_table(lines: list[str], spec: Spec, entries: list[Entry], remembered: Collection[str] = ()) -> list[RowEdit]:
    """`remembered` holds the keys D&D Beyond gave on the last sync: a row that matches nothing is
    removed only when its key is in it."""
    table = find_table(lines, spec.h2, spec.h3)
    key = column(table.header, spec.key) if table else -1
    if table is None or key < 0:
        if not entries:
            return []
        noun = spec.nouns[0] if len(entries) == 1 else spec.nouns[1]
        word = spec.locus.rsplit(" / ", 1)[-1]
        verb = "was" if len(entries) == 1 else "were"
        return [RowEdit("KEPT", spec.locus, f"the note has no {word} table; {len(entries)} {noun} {verb} not written")]
    cols = [(col, column(table.header, col.pattern)) for col in spec.cols]
    cols = [(col, at) for col, at in cols if at >= 0]
    by_key: dict[str, Entry] = {}
    for each in entries:
        by_key.setdefault(norm(each.name), each)
    matched: set[str] = set()
    out: list[RowEdit] = []
    blanks: list[int] = []
    held = False                                      # the table has a row with a name
    for i, cells in table.rows:
        if all(blank(c.strip()) for c in cells):
            blanks.append(i)
            continue
        if key >= len(cells) or blank(clean(cells[key])):
            continue                                  # not a row, and not blank either: left alone
        held = True
        entry, duplicate = match_row(cells, key, by_key, matched)
        name = clean(cells[key])
        if entry is None:
            if any(k in remembered for k in candidates(cells[key])):
                said = "a second row for an entry already in the note; removed" if duplicate else GONE
                out.append(RowEdit("REMOVE", f"{spec.locus} / {name}", said, i))
            continue                                  # any other row is the GM's: left alone, unreported
        matched.add(norm(entry.name))
        locus = f"{spec.locus} / {entry.name}"
        changes: dict[int, str] = {}
        row: list[RowEdit] = []
        for col, at in cols:
            want = entry.wants.get(col.title)
            if want is None or at >= len(cells):
                continue
            edit = judge_column(col.kind, f"{locus} / {col.title}", Cell(i, at, cells[at]), want)
            if edit.status == "WRITE":
                changes[at] = edit.new
                row.append(RowEdit("WRITE", edit.locus, edit.message, i))
            elif edit.status == "KEPT":
                row.append(RowEdit("KEPT", edit.locus, edit.message))
        if not row:
            out.append(RowEdit("SAME", locus, "matches"))
        elif changes:
            new = lines[i]
            for at, text in changes.items():
                new = set_cell(new, at, text)
            for r in row:
                if r.status == "WRITE":
                    r.new = new
        out.extend(row)
    adds = []
    for k, new_entry in by_key.items():
        if k in matched:
            continue
        cells = [""] * len(table.header)
        cells[key] = new_entry.name
        for col, at in cols:
            cells[at] = value_text(col.kind, new_entry.wants.get(col.title))
        indent = lines[table.last][:len(lines[table.last]) - len(lines[table.last].lstrip())]
        adds.append(RowEdit("ADD", f"{spec.locus} / {new_entry.name}", "not in the note; added", table.last,
                            indent + plain_row(cells)))
    if adds and not held:
        out.extend(RowEdit("REMOVE", "", "", i, silent=True) for i in blanks)
    return out + adds


def plan_coins(lines: list[str], c: Character) -> list[RowEdit]:
    locus = "Equipment / Coins"
    table = find_table(lines, "equipment", "coins")
    if table is None or not table.rows:
        return [RowEdit("KEPT", locus, "the note has no Coins table; coins were not written")] \
            if table is None and any(c.coins.values()) else []
    i, cells = table.rows[0]
    changes: dict[int, str] = {}
    out: list[RowEdit] = []
    for title, pattern in COIN_COLS:
        at = column(table.header, pattern)
        if at < 0 or at >= len(cells):
            continue
        edit = judge_number(f"{locus} / {title}", Cell(i, at, cells[at]), c.coins.get(title.lower(), 0))
        if edit.status == "WRITE":
            changes[at] = edit.new
            out.append(RowEdit("WRITE", edit.locus, edit.message, i))
        elif edit.status == "KEPT":
            out.append(RowEdit("KEPT", edit.locus, edit.message))
    if changes:
        new = lines[i]
        for at, text in changes.items():
            new = set_cell(new, at, text)
        for r in out:
            if r.status == "WRITE":
                r.new = new
    return out or [RowEdit("SAME", locus, "matches")]


def remembered_for(seen: Seen | None, list_id: str) -> set[str]:
    return set((seen or {}).get(list_id, ()))


def plan_rows(text: str, c: Character, seen: Seen | None = None) -> list[RowEdit]:
    """One RowEdit per row that is matched, added, removed or kept, on the text it is given."""
    lines = text.splitlines()
    out: list[RowEdit] = []
    for name, spec in SPECS.items():
        out.extend(plan_table(lines, spec, entries_for(name, c), remembered_for(seen, spec.list_id)))
    return out + plan_coins(lines, c)


def write_rows(text: str, edits: list[RowEdit]) -> str:
    """The note with every ADD, REMOVE and WRITE applied in one pass, bottom up."""
    lines = text.splitlines(keepends=True)
    adds: dict[int, list[str]] = {}
    mods: dict[int, RowEdit] = {}
    for e in edits:
        if e.status == "ADD":
            adds.setdefault(e.line, []).append(e.new)
        elif e.status == "REMOVE" or (e.status == "WRITE" and e.line not in mods):
            mods[e.line] = e
    other = next((eol for raw in lines if (eol := split_eol(raw)[1])), "\n")
    for at in sorted(set(adds) | set(mods), reverse=True):
        if at in adds:
            body, eol = split_eol(lines[at])
            if eol:
                added = [new + eol for new in adds[at]]
            else:
                lines[at] = body + other           # the last line had no line break: the new last line has none
                added = [new + other for new in adds[at][:-1]] + [adds[at][-1]]
            lines[at + 1:at + 1] = added
        edit = mods.get(at)
        if edit is None:
            continue
        if edit.status == "REMOVE":
            del lines[at]
        else:
            lines[at] = edit.new + split_eol(lines[at])[1]
    return "".join(lines)


# --- spell slots -------------------------------------------------------------------------

SLOT_LOCUS = "Spellcasting / Spell Slots"
SLOT_ROW = re.compile(r"^(?:level\s+)?([1-9])", re.I)
SLOT_TOTAL = r"(total|max)$"
SlotRow = tuple[int, list[str], list[str]]      # line, header, cells


def slot_levels(c: Character) -> dict[str, int] | None:
    """{class name lower: level} when every class is in the free rules, else None."""
    if not c.classes or not all(dt.known(k.name) for k in c.classes):
        return None
    levels: dict[str, int] = {}
    for k in c.classes:
        name = k.name.strip().lower()
        levels[name] = levels.get(name, 0) + k.level
    return levels


def slot_rows(text: str) -> list[SlotRow]:
    return [(i, h, cells) for i, h, cells in Note(text).table("spellcasting", "spell slots")
            if 0 <= column(h, SLOT_TOTAL) < len(cells)]


def pact_row(rows: list[SlotRow]) -> SlotRow | None:
    return next((r for r in rows if dr.PACT_ROW.match(clean(r[2][0]))), None)


def own_table(c: Character) -> bool:
    """One class outside the free rules whose data gives its own slot totals."""
    return len(c.classes) == 1 and bool(c.classes[0].own_slots)


def plan_slots(text: str, c: Character) -> list[Edit]:
    """The Total column of `### Spell Slots`, and the label and total of a `Pact` row.
    Expended is never touched and no row is added. Nothing is written when a class is outside
    the free rules and the data does not give its table (see `checks`)."""
    rows = slot_rows(text)
    levels = slot_levels(c)
    pact_at = pact_row(rows)
    if levels is not None:
        pact = dt.pact_slots(levels)
        # A note with no Pact row has the pact slots counted into their spell level.
        want = dt.numbered_slots(levels) if pact_at or not pact else dt.slots_for(levels)
    elif own_table(c):
        want, pact, pact_at = list(c.classes[0].own_slots or []), None, None
    else:
        return []
    out: list[Edit] = []
    for i, header, cells in rows:
        m = SLOT_ROW.match(clean(cells[0]))
        if not m or (pact_at and i == pact_at[0]):
            continue
        at, col = int(m.group(1)), column(header, SLOT_TOTAL)
        total = cells[col].strip()
        # A level the character has no slots at stays as it is unless the cell holds a number.
        if want[at - 1] == 0 and not (BARE.match(total) or REASONED.match(total)):
            continue
        out.append(judge_number(f"{SLOT_LOCUS} / {dr.ORDINALS[at - 1]}", Cell(i, col, cells[col]), want[at - 1]))
    if pact_at and pact:
        i, header, cells = pact_at
        count, slot_level = pact
        label, col = f"Pact ({dr.ORDINALS[slot_level - 1]})", column(header, SLOT_TOTAL)
        old = cells[0].strip()
        out.append(Edit("SAME", f"{SLOT_LOCUS} / Pact / Level", old) if old == label
                   else write(f"{SLOT_LOCUS} / Pact / Level", old, Cell(i, 0, cells[0]), label))
        out.append(judge_number(f"{SLOT_LOCUS} / Pact", Cell(i, col, cells[col]), count))
    return out


def checks(text: str, c: Character, cells: list[Edit], rows: list[RowEdit]) -> list[Edit]:
    """CHECK rows for what sync cannot settle itself. `cells` and `rows` are the edits the
    note has had, for the checks that read them."""
    levels = slot_levels(c)
    if levels is None:
        if own_table(c) or not c.classes:
            return []
        return [Edit("CHECK", SLOT_LOCUS, "the class is outside the free rules; check the slot totals")]
    table = slot_rows(text)
    if dt.pact_slots(levels) and table and pact_row(table) is None:
        return [Edit("CHECK", SLOT_LOCUS, "the note has no Pact row for the Warlock's pact slots; they are "
                     "counted in the numbered rows; add a Pact row to show them apart")]
    return []


# --- hit point maximum, armour class, attacks --------------------------------------------

COMBAT_LOCUS = "Stat Sheet / Combat"
ATTACK_LOCUS = "Equipment / Weapons & Damage Cantrips"
ATTACK_SPEC = Spec(ATTACK_LOCUS, "equipment", "weapons & damage cantrips", ("attack line", "attack lines"),
                   r"^name$", (Col("Atk Bonus / DC", r"^(atk|attack|hit)", "text"),
                               Col("Damage & Type", r"^damage", "text")), "attacks")
# The headings the published page takes for the attacks table (parse.js readEquipment).
ATTACK_HEADINGS = ("weapons & damage cantrips", "weapons and damage cantrips", "attacks")


def plan_worked_cell(note: Note, label: str, locus: str, worked: Any) -> list[Edit]:
    cell = note.attr("stat sheet", "combat", label)
    if cell is None:
        return []
    if worked.value is None:
        return [Edit("CHECK", locus, f"not worked out: {worked.unsure}; check it")]
    edit = judge_number(locus, cell, int(worked.value))
    if edit.status == "KEPT":
        have, reasoned = number(cell.text)
        if reasoned and have != worked.value:
            said = REASON.search(cell.text.strip())
            reason = said.group(0).strip()[1:-1] if said else ""
            return [edit, Edit("CHECK", locus, f"the sheet says {have} ({reason}); D&D Beyond's numbers give {worked.value}")]
    return [edit]


def plan_worked(text: str, c: Character) -> list[Edit]:
    """HP (Max), AC and the `**Armour Class:**` line, from what the calculator worked out.
    HP (Current) is never touched."""
    note = Note(text)
    out = plan_worked_cell(note, "hp (max)", f"{COMBAT_LOCUS} / HP (Max)", c.hp_max)
    out += plan_worked_cell(note, "ac", f"{COMBAT_LOCUS} / AC", c.ac)
    hit = note.bold_at("armour class")
    if hit and c.ac.value is not None and c.ac.parts and blank(hit[1].strip()):
        out.append(as_line("Armour Class", write("Stat Sheet / Defences / Armour Class", "", None, safe(c.ac.parts), hit[0])))
    return out


def attack_entries(worked: Any) -> list[Entry]:
    return [Entry(safe_name(a.name), {"Atk Bonus / DC": a.hit or None, "Damage & Type": a.damage or None})
            for a in worked.value]


def plan_attacks(text: str, c: Character, seen: Seen | None = None) -> list[RowEdit]:
    """The attacks table as a list: Name is the key, Atk Bonus / DC and Damage & Type are owned,
    Notes is never written."""
    worked = c.attacks
    if worked.value is None:
        return [RowEdit("CHECK", ATTACK_LOCUS, f"not worked out: {worked.unsure}; check the attack lines")]
    entries = attack_entries(worked)
    lines = text.splitlines()
    heading = next((h for h in ATTACK_HEADINGS if find_table(lines, "equipment", h)), ATTACK_HEADINGS[0])
    return plan_table(lines, replace(ATTACK_SPEC, h3=heading), entries, remembered_for(seen, ATTACK_SPEC.list_id))


# --- one sync, the fetch and the command line --------------------------------------------

SYSTEM = dnd_sheet.SYSTEM
HOST = "character-service.dndbeyond.com"
SERVICE = f"https://{HOST}/character/v5/character/"
USER_AGENT = "gm-apprentice dnd_ddb (+https://github.com/AntTheLimey/gm-apprentice)"
MAX_BODY = 8 * 1024 * 1024
TIMEOUT = 15
DEADLINE = 30          # seconds from the request to the last byte
CHUNK = 64 * 1024
CLOCK = time.monotonic
ID_DIGITS = re.compile(r"[0-9]{1,12}")
# The host is `dndbeyond.com` or `www.dndbeyond.com` and then the path starts: nothing can sit
# between them. After the id only plain slug segments, a query or a fragment may follow.
CHARACTER_LINK = re.compile(
    r"(?:https?://)?(?:www\.)?dndbeyond\.com/characters/([0-9]{1,12})(?:/[A-Za-z0-9_-]*)*(?:[?#]\S*)?", re.I)
PRINTED = ("WRITE", "ADD", "REMOVE", "KEPT", "CHECK")
COUNTED = ("WRITE", "ADD", "REMOVE", "KEPT", "CHECK", "FILL")


@dataclass
class Report:
    rows: list[tuple[str, str, str]]     # (status, locus, message) in print order
    text: str                            # the note after sync; equal to the input when nothing changed or on ERROR
    seen: Seen | None = None             # what to remember after this sync; None when the sync was an ERROR


def character_id(link: object) -> str | None:
    """The digits of a D&D Beyond character link or a bare id; None for anything else.
    The link is untrusted text: only the digits are ever used."""
    if isinstance(link, bool):
        return None
    if isinstance(link, int):
        text = str(link)
        return text if ID_DIGITS.fullmatch(text) else None
    if not isinstance(link, str):
        return None
    text = link.strip()
    if ID_DIGITS.fullmatch(text):
        return text
    m = CHARACTER_LINK.fullmatch(text)
    return m.group(1) if m else None


class OnlyServiceHost(urllib.request.HTTPRedirectHandler):
    """A redirect is followed only when it stays on D&D Beyond's character service over https."""

    def redirect_request(self, req: urllib.request.Request, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> urllib.request.Request | None:
        parts = urllib.parse.urlsplit(newurl)
        try:
            port = parts.port
        except ValueError:
            port = -1
        if parts.scheme != "https" or parts.hostname != HOST or port not in (None, 443):
            raise urllib.error.URLError("it redirected to another host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(OnlyServiceHost)


def cannot(reason: str) -> Unreadable:
    return Unreadable(f"D&D Beyond could not be read ({reason})")


def fetch(char_id: str) -> object:
    """The "data" object of one character from D&D Beyond. Raises Unreadable. No retry."""
    if not ID_DIGITS.fullmatch(char_id):
        raise cannot("that is not a character id")
    request = urllib.request.Request(SERVICE + char_id, headers={"User-Agent": USER_AGENT,
                                                                  "Accept": "application/json"})
    started = CLOCK()
    chunks: list[bytes] = []
    size = 0
    try:
        with opener().open(request, timeout=TIMEOUT) as response:
            while True:
                if CLOCK() - started > DEADLINE:
                    raise cannot("it took too long")
                chunk = response.read(min(CHUNK, MAX_BODY + 1 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
                if size > MAX_BODY:
                    raise cannot("the response is too large")
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise Unreadable("this character is private on D&D Beyond; set it to public") from e
        if e.code == 404:
            raise Unreadable("D&D Beyond has no character with that id") from e
        raise cannot(f"HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise cannot(str(e.reason)) from e
    except TimeoutError as e:
        raise cannot("it timed out") from e
    except (OSError, http.client.HTTPException) as e:
        raise cannot(e.__class__.__name__) from e
    try:
        parsed = json.loads(b"".join(chunks))
    except (ValueError, RecursionError) as e:
        raise cannot("the response is not JSON") from e
    data = parsed.get("data") if isinstance(parsed, dict) else None
    if not isinstance(data, dict):
        raise cannot("the response holds no character")
    return data


FETCH = fetch


def current_layout(text: str) -> bool:
    note = Note(text)
    abilities = note.table("stat sheet", "ability scores")
    return bool(note.table("stat sheet", "core")) and bool(abilities) and column(abilities[0][1], r"save$") >= 0


def shown(edits: list[Edit] | list[RowEdit]) -> list[tuple[str, str, str]]:
    return [(e.status, e.locus, e.message) for e in edits
            if e.status in PRINTED and not getattr(e, "silent", False)]


def given_now(c: Character, before: Seen | None) -> Seen:
    """The keys of what D&D Beyond gave this run for each list. The attacks are carried forward
    from `before` when the calculator was unsure of them."""
    out: Seen = {}
    for name, spec in SPECS.items():
        out[spec.list_id] = sorted({k for e in entries_for(name, c) if (k := norm(e.name))})
    if c.attacks.value is not None:
        out["attacks"] = sorted({k for e in attack_entries(c.attacks) if (k := norm(e.name))})
    elif before is not None and "attacks" in before:
        out["attacks"] = list(before["attacks"])
    for group in (DEFENCES, PROFICIENCIES):
        for label, field in group:
            out[label.lower()] = sorted({k for n in getattr(c, field) if (k := norm(safe(n)))})
    return out


def sync_text(text: str, data: object, seen: Seen | None = None) -> Report:
    """The note brought up to date from D&D Beyond's data, and what was done. Pure. `seen` is what
    the last sync remembered adding: a row or entry leaves only if it is in it."""
    try:
        c = read(data)
    except Unreadable as e:
        return Report([("ERROR", "D&D Beyond", str(e))], text)
    if not current_layout(text):
        return Report([("ERROR", "Stat Sheet", "this note is in the earlier layout; convert it first "
                        "(sheet-conversion.md)")], text)
    rows: list[tuple[str, str, str]] = []
    cells = plan_cells(text, c, seen)
    rows += shown(cells)
    t = write_edits(text, cells)
    slots = plan_slots(t, c)
    rows += shown(slots)
    t = write_edits(t, slots)
    worked = plan_worked(t, c)
    rows += shown(worked)
    t = write_edits(t, worked)
    lists = plan_rows(t, c, seen)
    rows += shown(lists)
    t = write_rows(t, lists)
    attacks = plan_attacks(t, c, seen)
    rows += shown(attacks)
    t = write_rows(t, attacks)
    rows += shown(checks(t, c, cells + slots + worked, lists + attacks))
    fill = dnd_sheet.plan(t)
    errors = [r for r in fill if r.status == "ERROR"]
    if errors:
        return Report([("ERROR", errors[0].locus, errors[0].message)], text)
    rows += [("FILL", r.locus, r.message) for r in fill if r.status == "FILL"]
    return Report(rows, dnd_sheet.apply(t, fill), given_now(c, seen))


# --- the memory of what sync added -------------------------------------------------------

STATE_VERSION = 1
STATE_MAX = 1024 * 1024
NOT_IN_A_VAULT = "dnd_ddb: this note is not inside a vault, so nothing is remembered and no row is ever removed"


def state_path(vault: Path, char_id: str) -> Path:
    """Where the memory for one character lives. Only digits ever reach the path."""
    if not re.fullmatch(r"[0-9]{1,12}", char_id):
        raise ValueError("a character id is digits only")
    return vault / "_meta" / "dndbeyond" / f"{char_id}.json"


def load_seen(path: Path) -> Seen | None:
    """What was saved, or None when the file is missing or cannot be trusted. Never raises."""
    try:
        if path.stat().st_size > STATE_MAX:
            return None
        with path.open("r", encoding="utf-8", newline="") as f:
            stored = json.loads(f.read(STATE_MAX + 1))
    except (OSError, ValueError, RecursionError):
        return None
    if not isinstance(stored, dict) or type(stored.get("version")) is not int or stored["version"] != STATE_VERSION:
        return None
    if stored.get("character") != path.stem or not isinstance(stored.get("lists"), dict):
        return None
    return {k: list(v) for k, v in stored["lists"].items()
            if isinstance(k, str) and isinstance(v, list) and all(isinstance(e, str) for e in v)}


def save_seen(path: Path, char_id: str, seen: Seen) -> None:
    """Write the memory whole or not at all, in a form a vault under version control diffs cleanly."""
    body = {"version": STATE_VERSION, "character": char_id, "lists": {k: sorted(set(v)) for k, v in seen.items()}}
    write_text_atomic(path, json.dumps(body, indent=1, sort_keys=True, ensure_ascii=False) + "\n")


def find_vault(path: Path) -> Path | None:
    """The first folder above the note that holds `_meta/vault-config.md`, None when there is none."""
    for folder in path.resolve().parents:
        if (folder / "_meta" / "vault-config.md").is_file():
            return folder
    return None


def note_character_id(text: str) -> str | None:
    return character_id(note_link(extract_frontmatter(text) or {}))


def remember(vault: Path | None, stem: str, text: str, report: Report) -> None:
    """Save what D&D Beyond gave. A failure is one line on stderr and changes nothing else."""
    char_id = note_character_id(text)
    if vault is None or char_id is None or report.seen is None:
        return
    try:
        save_seen(state_path(vault, char_id), char_id, report.seen)
    except Exception as e:     # the note is already written; the memory is a convenience
        reason = (e.strerror if isinstance(e, OSError) and e.strerror else None) or str(e) or e.__class__.__name__
        print(f"dnd_ddb: could not save what was synced for {PLAIN.sub(' ', stem)}: {PLAIN.sub(' ', reason)}",
              file=sys.stderr)


def note_link(fm: dict[str, Any]) -> object:
    """The `dndbeyond` value, None when the note has none (a bare key reads as an empty list)."""
    link = fm.get("dndbeyond")
    return None if link in (None, []) or not str(link).strip() else link


def sync_note(text: str, vault: Path | None = None) -> Report:
    """One note: its link, what was remembered, the request, then sync_text."""
    link = note_link(extract_frontmatter(text) or {})
    if link is None:
        return Report([("ERROR", "dndbeyond", "this note has no D&D Beyond link")], text)
    char_id = character_id(link)
    if char_id is None:
        return Report([("ERROR", "dndbeyond", "this is not a D&D Beyond character link")], text)
    seen = load_seen(state_path(vault, char_id)) if vault is not None else None
    try:
        data = FETCH(char_id)
    except Unreadable as e:
        return Report([("ERROR", "D&D Beyond", str(e))], text)
    return sync_text(text, data, seen)


def count_line(rows: list[tuple[str, str, str]], sheets: int | None = None) -> str:
    line = "  ".join(f"{s.lower()}: {sum(1 for r in rows if r[0] == s)}" for s in COUNTED)
    return f"# {line}" + (f"  sheets: {sheets}" if sheets is not None else "")


PLAIN = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")


def emit(status: str, locus: str, message: str) -> None:
    """One report row; a control character in a file name or a cell cannot shift the columns."""
    print("\t".join(PLAIN.sub(" ", part) for part in (status, locus, message)))


def guarded_sync(text: str, vault: Path | None = None) -> Report:
    """sync_note, with any unexpected failure as one ERROR row and the text unchanged."""
    try:
        return sync_note(text, vault)
    except Exception as e:     # one note must not stop the run
        return Report([("ERROR", "sync", f"could not be synced ({e.__class__.__name__}); nothing was written")], text)


def one_sheet(path: Path, write_it: bool) -> int:
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"dnd_ddb: cannot read {path.as_posix()}: {e}", file=sys.stderr)
        return 2
    vault = find_vault(path)
    if vault is None:
        print(NOT_IN_A_VAULT, file=sys.stderr)
    report = guarded_sync(text, vault)
    for row in report.rows:
        emit(*row)
    if any(r[0] == "ERROR" for r in report.rows):
        return 0
    print(count_line(report.rows))
    if write_it and report.text != text:
        try:
            write_text_atomic(path, report.text)
        except StepFailed as e:
            print(f"dnd_ddb: {e}", file=sys.stderr)
            return 2
    if write_it:
        remember(vault, path.stem, text, report)
    return 0


def party(vault: Path, write_it: bool, on_build: bool) -> int:
    from migrate_vault import vault_system

    if not vault.is_dir():
        print(f"dnd_ddb: {vault.as_posix()} is not a folder", file=sys.stderr)
        return 2
    if on_build:
        config = vault / "_meta" / "vault-config.md"
        if config.exists():
            try:
                config.read_text(encoding="utf-8-sig")
            except (OSError, UnicodeDecodeError):
                print("dnd_ddb: _meta/vault-config.md could not be read; nothing was synced")
                return 0
        setting = (read_publish_scalar(vault, "dndbeyond_sync") or "manual").strip().strip("\"'").strip()
        if setting.lower() == "manual":
            return 0
        if setting.lower() != "build":
            print(f'dnd_ddb: publish.dndbeyond_sync is "{setting}", not build or manual; nothing was synced')
            return 0
    system = vault_system(vault)
    if system != SYSTEM:
        said = f"is {system}, not {SYSTEM}" if system else f"is not recorded, not {SYSTEM}"
        print(f"dnd_ddb: this vault's system {said}; nothing was read")
        return 0
    rows: list[tuple[str, str, str]] = []
    sheets, failed = 0, False
    # vault_files only finds the PC notes; each is re-read byte-exact (line endings kept, strict utf-8).
    for rel, found_text in vault_files(vault):
        fm = extract_frontmatter(found_text) or {}
        if entity_type(fm) != "pc" or note_link(fm) is None:
            continue
        sheets += 1
        path = vault / rel
        try:
            with path.open("r", encoding="utf-8", newline="") as f:
                text = f.read()
            report = guarded_sync(text, vault)
        except (OSError, UnicodeDecodeError) as e:
            why = "is not valid UTF-8" if isinstance(e, UnicodeDecodeError) else "could not be read"
            text, report = "", Report([("ERROR", "note", f"the note {why}; nothing was written")], "")
        found = report.rows
        if write_it and report.text != text:
            try:
                write_text_atomic(path, report.text)
            except StepFailed as e:
                found = [("ERROR", "write", str(e))]
                failed = True
        if write_it and not failed_here(found):
            remember(vault, Path(rel).stem, text, report)
        for status, locus, message in found:
            row = (status, f"{Path(rel).stem}: {locus}", message)
            rows.append(row)
            emit(*row)
    print(count_line(rows, sheets))
    return 2 if failed else 0


def failed_here(rows: list[tuple[str, str, str]]) -> bool:
    return any(r[0] == "ERROR" for r in rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    ap.add_argument("sheet", nargs="?")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--party", metavar="VAULT", help="every PC note in a vault that has a D&D Beyond link")
    ap.add_argument("--on-build", action="store_true",
                    help="with --party: run only when publish.dndbeyond_sync is build")
    args = ap.parse_args(argv)
    if bool(args.sheet) == bool(args.party):
        ap.error("give one sheet, or --party VAULT")
    if args.on_build and not args.party:
        ap.error("--on-build goes with --party VAULT")
    if args.party:
        return party(Path(args.party), args.write, args.on_build)
    return one_sheet(Path(args.sheet), args.write)


if __name__ == "__main__":
    sys.exit(main())
