#!/usr/bin/env python3
"""Add a GURPS skill to a PC's sheet at its default level, for 0 points.

    gurps_skill_default.py SHEET.md "SKILL" [--write]
    gurps_skill_default.py SHEET.md "SKILL" --difficulty DX/A
                           --default "DX-5, Shortsword-2" [--write]

A skill a character uses with no points in it is used at its default
(B173): the best of the skill's defaults (B344), from an attribute or
from another skill the sheet has bought (a skill known only at default is
never the base of another default, B173). The sheet writes such a skill
in its Skills table at that level for 0 points, so the to-hit calculator
has a level for the weapon's row.

The skill's difficulty and defaults come from the ttrpg-expert GURPS
tables (`rules_lookup.py`). For a skill they do not list, or where they
may miss a default, give both with --difficulty and --default, from
ttrpg-expert's answer.

Prints one tab-separated row, `KIND<TAB>sheet<TAB>what`:

  HAVE          the skill is in the Skills table already; nothing written
  NO-DEFAULT    the skill has no default: it can't be used until at
                least 1 point is spent on it, so nothing is added
  WOULD-ADD     the row it would add, and the default its level comes
                from (ADDED with --write)
  NOT-FOUND     the tables do not list the skill: give --difficulty and
                --default
  CHECK-DEFAULT a specialty whose listed defaults name none of its other
                specialties, while the sheet has one bought: ask for its
                defaults and give them with --default
  CANNOT        the sheet has no Skills table, or no attribute the
                default needs

Exit: 0 HAVE, NO-DEFAULT, WOULD-ADD, ADDED; 1 NOT-FOUND, CHECK-DEFAULT,
CANNOT; 2 usage error. The sheet is written whole or not at all.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gurps_calc as gc  # noqa: E402
import gurps_check as gk  # noqa: E402
import rules_lookup  # noqa: E402
from migrate_core import write_text_atomic  # noqa: E402

ATTRS = ("st", "dx", "iq", "ht", "will", "per")
TERM_RE = re.compile(r"^(.+?)\s*([+\-−])\s*(\d+)$")
HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")
NO_DEFAULT = {"", "—", "-", "–", "none"}


class Refused(Exception):
    """A row of KIND other than the answer: (kind, message)."""


def _key(name: str) -> str:
    """A skill name as compared: case, spacing and the sheet's marks
    (`*`, `†`, `‡`) off."""
    name = re.sub(r"[*†‡§¶◇]", "", str(name))
    return " ".join(name.split()).casefold()


def _stem(name: str) -> str:
    return _key(name).split(" (")[0]


def _terms(defaults: str) -> list[str]:
    """A Defaults cell as one term each: `Guns (Pistol or Rifle)-2` is
    `Guns (Pistol)-2` and `Guns (Rifle)-2`, as the tables write the
    defaults between a skill's specialties."""
    out = []
    for term in defaults.split(","):
        term = term.strip()
        m = re.match(r"^(.+?) \((.+ or .+)\)\s*([+\-−]\s*\d+)$", term)
        if m:
            out += [f"{m.group(1)} ({one.strip()}){m.group(3)}"
                    for one in m.group(2).split(" or ")]
        elif term:
            out.append(term)
    return out


def listed(skill: str) -> tuple[str, str, str] | None:
    """The tables' (difficulty, defaults, page) for SKILL, or None. A
    specialty the tables give only as a pattern (`Area Knowledge
    ([Area])`) is found by its stem. Two rows that disagree are no
    answer."""
    _mode, records, _total = rules_lookup.lookup(
        skill, system="gurps-4e", kind="skill", limit=50)
    rows = [r for r in records if r.shape == "table" and r.headers]
    exact = [r for r in rows if _key(r.cells[0]) == _key(skill)]
    pattern = [r for r in rows if "([" in r.cells[0]
               and _stem(r.cells[0]) == _stem(skill)]
    found = set()
    for r in exact or pattern:
        cell = {h.strip().lower(): c for h, c in zip(r.headers, r.cells)}
        found.add((cell.get("diff", ""), cell.get("defaults", ""),
                   cell.get("page", "")))
    return found.pop() if len(found) == 1 else None


def _table(lines: list[str]) -> tuple[int, int]:
    """The Skills table's first and last line (indices), or Refused."""
    level = None
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line.rstrip("\r\n"))
        if level is None:
            if m and m.group(2).strip().lower() == "skills":
                level = len(m.group(1))
            continue
        if m and len(m.group(1)) <= level:
            break
        if line.lstrip().startswith("|"):
            end = i
            while end + 1 < len(lines) and lines[end + 1].lstrip().startswith("|"):
                end += 1
            if end - i >= 1:
                return i, end
            break
    raise Refused("CANNOT", "the sheet has no Skills table")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def plan(text: str, skill: str, difficulty: str | None = None,
         defaults: str | None = None) -> tuple[str, str, str | None]:
    """(kind, message, the new text or None)."""
    sheet = gk.Sheet(text)
    lines = text.splitlines(keepends=True)
    first, last = _table(lines)
    headers = _cells(lines[first])
    rows = [(i, _cells(lines[i])) for i in range(first + 2, last + 1)]
    i_name = max(gk.col(headers, "name", "skill"), 0)
    i_pts = gk.col(headers, "point", "cost")
    i_rel = gk.col(headers, "relative")
    i_base = gk.col(headers, "base")
    i_eff = gk.col(headers, "effective")
    i_cur = gk.col(headers, "current")
    i_lvl = gk.col(headers, "level") if i_rel < 0 else -1

    def cell(row: list[str], i: int) -> str:
        return row[i] if 0 <= i < len(row) else ""

    attrs = gk.read_attributes(sheet) or {}
    for key in ("will", "per"):
        if key not in attrs and "iq" in attrs:
            attrs[key] = attrs["iq"]
    bought: dict[str, int] = {}
    for _i, row in rows:
        name = cell(row, i_name)
        if not _key(name):
            continue
        if _key(name) == _key(skill):
            m = re.search(r"\d+", next(
                (cell(row, i) for i in (i_base, i_eff, i_lvl, i_cur)
                 if re.search(r"\d", cell(row, i))), ""))
            at = f", at {m.group(0)}" if m else ""
            return "HAVE", f"{skill} is in the Skills table already{at}", None
        pts = gk.parse_cost(cell(row, i_pts)) if i_pts >= 0 else None
        level_cell = next((cell(row, i) for i in (i_base, i_eff, i_lvl)
                           if re.search(r"\d", cell(row, i))), "")
        m = re.search(r"\d+", level_cell)
        if m and (pts is None or pts > 0):
            bought[_key(name)] = int(m.group(0))

    if difficulty is None or defaults is None:
        found = listed(skill)
        if found is None:
            raise Refused("NOT-FOUND", f"the GURPS tables do not list {skill}; "
                          "give its difficulty and defaults with "
                          "--difficulty and --default")
        difficulty = difficulty or found[0]
        defaults = defaults if defaults is not None else found[1]
        page = found[2]
        if " (" in _key(skill) and not any(
                _stem(t) == _stem(skill) for t in _terms(defaults)):
            others = sorted(n for n in bought
                            if n != _key(skill) and _stem(n) == _stem(skill))
            if others:
                raise Refused("CHECK-DEFAULT", (
                    f"{skill} is a specialty, and the tables list no default "
                    f"from its other specialties ({defaults}, {page}), while "
                    f"the sheet has {others[0]} at {bought[others[0]]}; ask "
                    f"for its defaults and give them with --default"))
    else:
        page = None
    dm = gk.DIFF_CELL_RE.search(difficulty or "")
    if not dm:
        raise Refused("CANNOT", f"{skill}: difficulty \"{difficulty}\" is "
                      "not of the form DX/A")
    if _key(defaults) in NO_DEFAULT:
        # B173: a skill with no default is unusable without points.
        return ("NO-DEFAULT", f"{skill} has no default (B173): it can't be "
                "used until at least 1 point is spent on it", None)

    best = None
    for term in _terms(defaults):
        m = TERM_RE.match(term)
        if not m:
            continue
        base, sign, num = m.group(1).strip(), m.group(2), int(m.group(3))
        mod = -num if sign in "-−" else num
        if base.lower() in ATTRS:
            have = attrs.get(base.lower())
        else:
            have = bought.get(_key(base))
        if have is not None and (best is None or have + mod > best[0]):
            best = (int(have) + mod, term.strip())
    if best is None:
        raise Refused("CANNOT", f"{skill}: none of its defaults ({defaults}) "
                      "can be worked out from this sheet")
    level, source = best
    attr = dm.group(1)
    attr_val = attrs.get(attr.lower())
    rel = f"{attr.upper() if len(attr) == 2 else attr}{level - attr_val:+d}" \
        if attr_val is not None else ""
    points = "[0]" if any(cell(r, i_pts).startswith("[") for _i, r in rows) \
        else "0"
    current = level
    enc = gk._declared_enc_level(sheet)
    if enc and re.sub(r"\s*\(.*$", "", _key(skill)) in gc.ENC_PENALIZED_SKILLS:
        current = level - enc
    new = [""] * len(headers)
    new[i_name] = skill
    for i, value in ((gk.col(headers, "difficulty", "diff"),
                      f"{attr}/{dm.group(2).upper()}"),
                     (i_rel, rel), (i_pts, points), (i_base, str(level)),
                     (i_eff, str(level)), (i_lvl, str(level)),
                     (i_cur, str(current))):
        if i >= 0:
            new[i] = value
    row_text = "| " + " | ".join(new) + " |"
    eol = "\r\n" if lines[first].endswith("\r\n") else "\n"
    # Alphabetical, as the template keeps the table; the template's empty
    # row is taken by the first skill written.
    blank = [i for i, row in rows if not any(row)]
    at = next((i for i, row in rows
               if _key(cell(row, i_name)) and
               _key(cell(row, i_name)) > _key(skill)), None)
    out = list(lines)
    if blank and len(blank) == len(rows):
        out[blank[0]] = row_text + eol
    elif at is not None:
        out.insert(at, row_text + eol)
    else:
        ended = out[last].endswith("\n")
        out[last] = out[last].rstrip("\r\n") + eol
        out.insert(last + 1, row_text + (eol if ended else ""))
    return ("WOULD-ADD", f"{row_text} (default {source}, level {level})",
            "".join(out))


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description="Add a GURPS skill to a sheet at its default, 0 points.")
    ap.add_argument("sheet", type=Path)
    ap.add_argument("skill")
    ap.add_argument("--difficulty", metavar="DX/A")
    ap.add_argument("--default", dest="defaults", metavar="DEFAULTS")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    if (args.difficulty is None) != (args.defaults is None):
        print("gurps_skill_default.py: --difficulty and --default go "
              "together", file=sys.stderr)
        return 2
    if not args.skill.strip():
        print("gurps_skill_default.py: give the skill's name",
              file=sys.stderr)
        return 2
    try:
        text = args.sheet.read_bytes().decode("utf-8")
    except (OSError, UnicodeError) as e:
        print(f"gurps_skill_default.py: cannot read {args.sheet}: {e}",
              file=sys.stderr)
        return 2
    where = args.sheet.as_posix()
    try:
        kind, what, new = plan(text, args.skill.strip(), args.difficulty,
                               args.defaults)
    except Refused as e:
        print(f"{e.args[0]}\t{where}\t{e.args[1]}")
        return 1
    if new is not None and args.write:
        write_text_atomic(args.sheet, new)
        kind = "ADDED"
    print(f"{kind}\t{where}\t{what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
