#!/usr/bin/env python3
"""Report and fill the derived numbers on a D&D 5e (2024) PC note.

The note holds every finished number; this keeps the ones that are plain
sums right. A cell that is blank or a bare number is this tool's to
maintain. A cell with anything else in it (`+7 (cloak of elvenkind)`) is
the GM's and is kept.

Usage:
  dnd_sheet.py SHEET.md            report (nothing is written)
  dnd_sheet.py SHEET.md --write    apply every FILL row, all or none

Output: one row per derived cell, `STATUS<TAB>locus<TAB>message`, then
`# same: N  fill: N  kept: N`.
  SAME   the cell agrees with the sum
  FILL   blank or a bare number that differs: `old -> new`
  KEPT   hand-set: the cell, and what the sum gives
  ERROR  the sheet cannot be read; nothing is written

Owned cells: Proficiency Bonus; each ability's Modifier and Save; each
skill's Modifier; Passive Perception / Investigation / Insight;
Initiative; Spell Attack Modifier and Spell Save DC. AC, HP, Speed,
attacks and slot totals are never touched. Stdlib only.
"""

import argparse
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_calc as dc  # noqa: E402

HEADING = re.compile(r"^(#{2,3})\s+(.+?)\s*#*\s*$")
SEPARATOR = re.compile(r"^:?-{2,}:?$")
BARE = re.compile(r"^[+\-−]?\d+$")
REASONED = re.compile(r"^([+\-−]?\d+)\s*\(.+\)$")
PLACEHOLDER = re.compile(r"^\{[^}]*\}$")
YES = re.compile(r"^(yes|y|true|x|\[x\]|✓|✔|●|1|p|prof|proficient|e|expert|expertise)$", re.I)
PASSIVES = {"passive perception": "perception",
            "passive investigation": "investigation",
            "passive insight": "insight"}


@dataclass
class Cell:
    line: int          # index into the note's lines
    col: int           # index into the row's cells
    text: str


@dataclass
class Row:
    status: str
    locus: str
    message: str
    line: int = -1
    col: int = -1
    new: str = ""


def split_cells(line: str) -> list[str]:
    """Cells of a `| a | b |` line, honouring `\\|`."""
    inner = line.strip()
    inner = inner[1:] if inner.startswith("|") else inner
    inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def read_tables(lines: list[str]) -> dict[tuple[str, str], list[tuple[int, list[str], list[str]]]]:
    """(h2, h3) lower-cased -> [(line index, header cells, row cells)] for the
    first table under that heading. Frontmatter and fenced code are skipped."""
    out: dict = {}
    h2 = h3 = ""
    header: list[str] | None = None
    closed: set = set()
    in_fm = bool(lines) and lines[0].strip() == "---"
    fence = False
    for i, raw in enumerate(lines):
        s = raw.strip()
        if in_fm:
            if i > 0 and s == "---":
                in_fm = False
            continue
        if s.startswith("```") or s.startswith("~~~"):
            fence = not fence
            continue
        if fence:
            continue
        m = HEADING.match(s)
        if m:
            if len(m.group(1)) == 2:
                h2, h3 = m.group(2).strip().lower(), ""
            else:
                h3 = m.group(2).strip().lower()
            header = None
            continue
        key = (h2, h3)
        if s.startswith("|") and key not in closed:
            cells = split_cells(s)
            if header is None:
                header = cells
                out[key] = []
            elif all(SEPARATOR.match(c) for c in cells if c):
                continue
            else:
                out[key].append((i, header, cells))
        elif header is not None:
            closed.add(key)       # a blank or other line ends the first table
            header = None
    return out


def to_int(text: str) -> int | None:
    t = text.strip().replace("−", "-")
    return int(t) if re.fullmatch(r"[+\-]?\d+", t) else None


def column(header: list[str], pattern: str) -> int:
    for i, h in enumerate(header):
        if re.match(pattern, h.strip(), re.I):
            return i
    return -1


def judge(locus: str, cell: Cell, want: str) -> Row:
    """Classify one derived cell against the sum."""
    text = cell.text.strip()
    if text == "" or PLACEHOLDER.match(text):
        return Row("FILL", locus, f"(blank) -> {want}", cell.line, cell.col, want)
    if BARE.match(text):
        same = to_int(text) == to_int(want)
        if same:
            return Row("SAME", locus, text)
        return Row("FILL", locus, f"{text} -> {want}", cell.line, cell.col, want)
    if REASONED.match(text):
        return Row("KEPT", locus, f"{text}; the sum gives {want}")
    return Row("KEPT", locus, f"{text}; not read as a number; the sum gives {want}")


def effective(cell: Cell | None, computed: int) -> int:
    """The number a kept cell stands for, else the sum."""
    if cell is None:
        return computed
    m = REASONED.match(cell.text.strip())
    return to_int(m.group(1)) if m else computed   # type: ignore[return-value]


def plan(text: str) -> list[Row]:
    lines = text.splitlines()
    tables = read_tables(lines)
    rows: list[Row] = []

    def table(h2: str, h3: str = ""):
        return tables.get((h2, h3), [])

    def attr(h2: str, h3: str, label: str) -> Cell | None:
        for i, header, cells in table(h2, h3):
            if cells and cells[0].strip().lower() == label and len(cells) > 1:
                return Cell(i, 1, cells[1])
        return None

    if not any(k[0] == "stat sheet" for k in tables):
        return [Row("ERROR", "Stat Sheet", "no Stat Sheet section with tables; nothing was changed")]

    level_cell = attr("stat sheet", "core", "level")
    level = to_int(level_cell.text) if level_cell else None
    if level is None or not 1 <= level <= 20:
        shown = level_cell.text.strip() if level_cell and level_cell.text.strip() else "(missing)"
        return [Row("ERROR", "Stat Sheet / Core / Level",
                    f"{shown} is not a level from 1 to 20; nothing was changed")]
    pb = dc.proficiency_bonus(level)

    pb_cell = attr("stat sheet", "core", "proficiency bonus")
    if pb_cell:
        rows.append(judge("Stat Sheet / Core / Proficiency Bonus", pb_cell, dc.signed(pb)))

    # Abilities
    mods: dict[str, int] = {}
    ability_rows = table("stat sheet", "ability scores")
    for i, header, cells in ability_rows:
        key = cells[0].strip().upper()[:3] if cells else ""
        if key not in dc.ABILITIES:
            continue
        score = to_int(cells[column(header, r"score$")]) if column(header, r"score$") >= 0 else None
        if score is None:
            return [Row("ERROR", f"Stat Sheet / Ability Scores / {key}",
                        "the score is not a number; nothing was changed")]
        mods[key] = dc.ability_mod(score)
        c_mod, c_prof, c_save = column(header, r"mod"), column(header, r"sav.*prof"), column(header, r"save$")
        if 0 <= c_mod < len(cells):
            rows.append(judge(f"Stat Sheet / Ability Scores / {key} / Modifier",
                              Cell(i, c_mod, cells[c_mod]), dc.signed(mods[key])))
        if 0 <= c_save < len(cells):
            proficient = 0 <= c_prof < len(cells) and bool(YES.match(cells[c_prof].strip()))
            rows.append(judge(f"Stat Sheet / Ability Scores / {key} / Save",
                              Cell(i, c_save, cells[c_save]),
                              dc.signed(dc.save(mods[key], pb, proficient))))
    missing = [a for a in dc.ABILITIES if a not in mods]
    if missing:
        return [Row("ERROR", "Stat Sheet / Ability Scores",
                    f"no row for {', '.join(missing)}; nothing was changed")]

    init = attr("stat sheet", "combat", "initiative")
    if init:
        rows.append(judge("Stat Sheet / Combat / Initiative", init, dc.signed(mods["DEX"])))

    # Skills
    skill_value: dict[str, int] = {}
    for i, header, cells in table("skills"):
        c_ab, c_pr, c_ex, c_mod = (column(header, r"abilit"), column(header, r"prof"),
                                   column(header, r"expert"), column(header, r"(mod|bonus)"))
        if min(c_ab, c_mod) < 0 or len(cells) <= max(c_ab, c_mod):
            continue
        ability = cells[c_ab].strip().upper()[:3]
        if ability not in mods or not cells[0].strip():
            continue
        yes = lambda c: 0 <= c < len(cells) and bool(YES.match(cells[c].strip()))  # noqa: E731
        want = dc.skill(mods[ability], pb, yes(c_pr), yes(c_ex))
        cell = Cell(i, c_mod, cells[c_mod])
        rows.append(judge(f"Skills / {cells[0].strip()} / Modifier", cell, dc.signed(want)))
        skill_value[cells[0].strip().lower()] = effective(cell, want)

    # Passive scores: under Senses (new layout) or Combat (old).
    for h3 in ("senses", "combat"):
        for i, header, cells in table("stat sheet", h3):
            name = PASSIVES.get(cells[0].strip().lower()) if cells else None
            if not name or len(cells) < 2:
                continue
            base = skill_value.get(name)
            if base is None:
                continue
            title = "Senses" if h3 == "senses" else "Combat"
            rows.append(judge(f"Stat Sheet / {title} / {cells[0].strip()}",
                              Cell(i, 1, cells[1]), str(dc.passive(base))))

    # Spellcasting: one set of rows, or several labelled `(Class)`.
    casting = {cells[0].strip().lower(): (i, cells) for i, _h, cells in table("spellcasting")
               if len(cells) > 1}
    for label, (i, cells) in casting.items():
        m = re.fullmatch(r"(spell attack modifier|spell save dc)(\s*\(.+\))?", label)
        if not m:
            continue
        ability_row = casting.get("spellcasting ability" + (m.group(2) or ""))
        ability = ability_row[1][1].strip().upper()[:3] if ability_row else ""
        if ability not in mods:
            continue
        cast = (dc.signed(dc.spell_attack(mods[ability], pb)) if m.group(1).endswith("modifier")
                else str(dc.spell_save_dc(mods[ability], pb)))
        rows.append(judge(f"Spellcasting / {cells[0].strip()}", Cell(i, 1, cells[1]), cast))
    return rows


def apply(text: str, rows: list[Row]) -> str:
    """The note with every FILL row written. Line endings are kept."""
    lines = text.splitlines(keepends=True)
    for row in (r for r in rows if r.status == "FILL"):
        raw = lines[row.line]
        body = raw.rstrip("\r\n")
        eol = raw[len(body):]
        parts = re.split(r"(?<!\\)\|", body)
        # parts[0] is what precedes the first pipe; cell n is parts[n + 1].
        parts[row.col + 1] = f" {row.new} "
        lines[row.line] = "|".join(parts) + eol
    return "".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("sheet")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    path = Path(args.sheet)
    try:
        with path.open("r", encoding="utf-8", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"dnd_sheet: cannot read {path.as_posix()}: {e}", file=sys.stderr)
        return 2
    rows = plan(text)
    for r in rows:
        print(f"{r.status}\t{r.locus}\t{r.message}")
    if any(r.status == "ERROR" for r in rows):
        return 0
    count = {s: sum(1 for r in rows if r.status == s) for s in ("SAME", "FILL", "KEPT")}
    if args.write and count["FILL"]:
        new = apply(text, rows)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".dnd_sheet-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            os.replace(tmp, path)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
        count["SAME"] += count["FILL"]
        count["FILL"] = 0
    print(f"# same: {count['SAME']}  fill: {count['FILL']}  kept: {count['KEPT']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
