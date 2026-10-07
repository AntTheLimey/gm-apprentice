#!/usr/bin/env python3
"""Bring a D&D 5e (2024) PC note up to date from a D&D Beyond `Character`.

Reads the note the way dnd_sheet.py does and plans one `Edit` per cell or
labelled line, then writes the ones marked WRITE. A cell that is blank, a
`{placeholder}` or bare text is sync's to maintain. A cell with a bracketed
reason (`18 (tome)`) is the GM's and is kept. Stdlib only.

This part plans and writes the single cells (Level, XP, ability scores and
save proficiency, Size, Speed, Hit Dice, skill proficiency, the spellcasting
ability) and the `**Label:** value` lines (species, class, background,
alignment, defences, proficiencies), and the lists (features, feats, spells,
gear, magic items, coins) as table rows that are matched, added, removed or
kept. Never written here: Weapon Mastery and anything a player tracks in play.

Edit statuses: WRITE (the note changes), KEPT (the note is the GM's), SAME.
Row statuses: ADD, REMOVE, WRITE, KEPT, SAME.

Cells and rows are meant to run in that order, each planned on the text the
step before produced: `t = write_edits(t, plan_cells(t, c))`, then
`t = write_rows(t, plan_rows(t, c))`. Both plan against the text they are
given, so the line numbers of one are not valid for the other.
"""

import re
import sys
from dataclasses import dataclass
from typing import Any
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_rules as dr  # noqa: E402
from dnd_ddb_read import ABILITIES, Character, safe_name  # noqa: E402
from dnd_note import (BARE, HALF, HEADING, PLACEHOLDER, REASONED, SEPARATOR, YES,  # noqa: E402
                      Cell, Note, clean, column, split_cells, to_int)
from dnd_sheet import to_weight  # noqa: E402
from vaultlib import fence_step  # noqa: E402

REASON = re.compile(r"\(.+\)\s*$")
HIT_DICE = re.compile(r"^(\d+)\s*/\s*(\d+)$")
GROUPED = re.compile(r"^\d{1,3}(?:,\d{3})+$")
LABEL_AT = re.compile(r"\*\*[^*:]+:\*\*")
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
        parts[e.col + 1] = f" {e.new} "
        lines[e.line] = "|".join(parts) + eol
    return "".join(lines)


# --- the lists ---------------------------------------------------------------------------

@dataclass
class RowEdit:
    status: str        # ADD, REMOVE, WRITE, KEPT or SAME
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
    always_prepared: bool = False


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
SPECS = {
    "class_features": Spec("Class Features", "class features", "", ("class feature", "class features"),
                           FEATURE_KEY, FEATURE_COLS),
    "species_traits": Spec("Species Traits", "species traits", "", ("species trait", "species traits"),
                           FEATURE_KEY, FEATURE_COLS),
    "feats": Spec("Feats", "feats", "", ("feat", "feats"), FEATURE_KEY, FEATURE_COLS),
    "spells": Spec("Spells", "spellcasting", "spells", ("spell", "spells"), r"^spell$", (
        Col("Level", r"^level$", "level"), Col("Time", r"^(casting )?time$", "text"),
        Col("Range", r"^range$", "text"), Col("Components", r"^comp", "text"),
        Col("Duration", r"^duration$", "text"), Col("Tags", r"^tags?$", "tags"),
        Col("Source", r"^source$", "text")), always_prepared=True),
    "gear": Spec("Equipment / Gear", "equipment", "gear", ("gear item", "gear items"), r"^item$", (
        Col("Qty", r"^(qty|quantity)$", "num"), Col("Weight", r"^weight$", "weight"))),
    "magic_items": Spec("Equipment / Magic Items", "equipment", "magic items", ("magic item", "magic items"),
                        r"^item$", (Col("Attuned", r"^attuned$", "flag"), Col("Charges", r"^charges$", "num"),
                                    Col("Recovers", r"^recovers?$", "recovers"))),
}
COIN_COLS = tuple((k.upper(), rf"^{k}$") for k in ("cp", "sp", "ep", "gp", "pp"))
OWNED_TAGS = {"c": "C", "r": "R", "always prepared": "Always prepared"}
TRAILING_REASON = re.compile(r"\s*\([^()]*\)\s*$")
LINK_TARGET = re.compile(r"\[\[([^\]|\\#]+)")
ALWAYS_PREPARED_KEPT = "always prepared; D&D Beyond does not list these; kept"


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


def candidates(raw: str) -> tuple[list[str], list[str]]:
    """The names a first cell may be matched by: whole, then with a trailing bracket group removed.
    A link `[[Rope, Hempen\\|rope]]` offers its text and its target."""
    shown = clean(raw)
    names = [shown]
    link = LINK_TARGET.search(raw)
    if link and clean(link.group(1)) != shown:
        names.append(clean(link.group(1)))
    return [norm(n) for n in names], [norm(TRAILING_REASON.sub("", n)) for n in names if TRAILING_REASON.search(n)]


def set_cell(row: str, col: int, new: str) -> str:
    """The row line with cell `col` replaced; every other byte stays."""
    parts = re.split(r"(?<!\\)\|", row)
    parts[col + 1] = f" {new} "
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
    whole, stripped = candidates(cells[key])
    for k in whole + stripped:
        if k in by_key:
            return (None, True) if k in matched else (by_key[k], False)
    return None, False


def plan_table(lines: list[str], spec: Spec, entries: list[Entry]) -> list[RowEdit]:
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
    tags_at = next((at for col, at in cols if col.kind == "tags"), -1)
    by_key: dict[str, Entry] = {}
    for each in entries:
        by_key.setdefault(norm(each.name), each)
    matched: set[str] = set()
    out: list[RowEdit] = []
    blanks: list[int] = []
    for i, cells in table.rows:
        if all(blank(c.strip()) for c in cells):
            blanks.append(i)
            continue
        if key >= len(cells) or blank(clean(cells[key])):
            continue                                  # not a row, and not blank either: left alone
        entry, duplicate = match_row(cells, key, by_key, matched)
        name = clean(cells[key])
        if entry is None:
            locus = f"{spec.locus} / {name}"
            tags = cells[tags_at].lower() if 0 <= tags_at < len(cells) else ""
            if spec.always_prepared and not duplicate and "always prepared" in [t.strip() for t in tags.split(",")]:
                out.append(RowEdit("KEPT", locus, ALWAYS_PREPARED_KEPT))
            elif REASON.search(name):
                out.append(RowEdit("KEPT", locus, "hand-added; kept"))
            else:
                out.append(RowEdit("REMOVE", locus, "not on D&D Beyond; removed", i))
            continue
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
        adds.append(RowEdit("ADD", f"{spec.locus} / {new_entry.name}", "not in the note; added", table.last,
                            plain_row(cells)))
    if adds:
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


def plan_rows(text: str, c: Character) -> list[RowEdit]:
    """One RowEdit per row that is matched, added, removed or kept, on the text it is given."""
    lines = text.splitlines()
    out: list[RowEdit] = []
    for name, spec in SPECS.items():
        out.extend(plan_table(lines, spec, entries_for(name, c)))
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
