#!/usr/bin/env python3
"""Add a GURPS skill to a PC's sheet at its default level, for 0 points.

    gurps_skill_default.py SHEET.md "SKILL" [--for "ATTACK"] [--write]
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
  UNARMED       --for names an unarmed attack (a punch, kick, bite,
                grapple) and the skill has no default: the attack rolls
                against DX (a kick DX-2) without it, so nothing is added
  NO-DEFAULT    the skill has no default: it can't be used until at
                least 1 point is spent on it, so nothing is added
  WOULD-ADD     the row it would add, and the default its level comes
                from (ADDED with --write)
  NOT-FOUND     the tables do not list the skill: give --difficulty and
                --default
  CHECK-DEFAULT a specialty whose listed defaults name none of its other
                specialties, while the sheet has one bought, or a tech
                skill the sheet has at another TL (B168): ask for its
                defaults and give them with --default
  CANNOT        the sheet has no Skills table, or no attribute the
                default needs

Exit: 0 HAVE, UNARMED, NO-DEFAULT, WOULD-ADD, ADDED; 1 NOT-FOUND, CHECK-DEFAULT,
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
from vaultlib import cli_name  # noqa: E402
from migrate_core import StepFailed, write_text_atomic  # noqa: E402

ATTRS = ("st", "dx", "iq", "ht", "will", "per")
TERM_RE = re.compile(r"^(.+?)\s*([+\-−])\s*(\d+)$")
# The weapon rows an unarmed attack is written as (the publish tool's to-hit
# calculator reads the same words, tohit-data.js UNARMED).
UNARMED_RE = re.compile(r"^(?:punch|kick|bite|slam|grapple|grab|head ?butt|"
                        r"elbow|knee|shove|trip|unarmed)\b", re.I)
HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")
NO_DEFAULT = {"", "—", "-", "–", "none"}
# Skills whose specialties give no default to each other (Artillery, B178),
# so a bought specialty is no reason to ask.
NO_SPECIALTY_DEFAULTS = {"artillery"}


class Refused(Exception):
    """A row of KIND other than the answer: (kind, message)."""


TL_RE = re.compile(r"\s*/\s*TL\s*\d+", re.I)
# Short names sheets write for a table's skill (the publish tool reads the
# same initials, tohit-data.js makeSkillMatcher).
ALIASES = {"guns (lmg)": "guns (light machine gun)",
           "guns (smg)": "guns (submachine gun)",
           "guns (law)": "guns (light anti-armor weapon)",
           "guns (gl)": "guns (grenade launcher)",
           "gunner (mg)": "gunner (machine gun)",
           "shield": "shield (shield)"}


def _marked_off(name: str) -> str:
    """The name with the sheet's marks off, case and `/TL<n>` kept."""
    return " ".join(re.sub(r"[*†‡§¶◇]", "", str(name)).split())


def _plain(name: str) -> str:
    """The name with its `/TL<n>` and the sheet's marks off, case kept."""
    return " ".join(TL_RE.sub("", _marked_off(name)).split())


def _key(name: str) -> str:
    """A skill name as compared: case, spacing, the sheet's marks (`*`,
    `†`, `‡`) and `/TL<n>` off (as the publish tool reads it), and a short
    name the sheet writes (`Guns (LMG)`) read as the tables' name."""
    key = _plain(name).casefold()
    return ALIASES.get(key, key)


def _tl(name: str) -> str:
    m = TL_RE.search(str(name))
    return m.group(0).strip().replace(" ", "") if m else ""


def _same_tl(a: str, b: str) -> bool:
    """Two `/TL<n>` marks name one tech level, or one of them is absent."""
    return not a or not b or a.casefold() == b.casefold()


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
        _key(skill), system="gurps-4e", kind="skill", limit=50)
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
         defaults: str | None = None, attack: str | None = None
         ) -> tuple[str, str, str | None]:
    """(kind, message, the new text or None). `attack`: the weapon row the
    skill is wanted for."""
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
    # A Level column, never Relative Level (as parse.js resolveLevelColumns)
    # nor Current Level, which is the level less encumbrance.
    i_lvl = next((i for i, h in enumerate(headers)
                  if "level" in h.lower() and "relative" not in h.lower()
                  and "current" not in h.lower()), -1)
    enc = gk._declared_enc_level(sheet)

    def cell(row: list[str], i: int) -> str:
        return row[i] if 0 <= i < len(row) else ""

    attrs = gk.read_attributes(sheet) or {}
    said: list[str] = []          # what the answer stands on, said aloud
    stand_in = set()
    for key in ("will", "per"):
        if key not in attrs and "iq" in attrs:
            attrs[key] = attrs["iq"]
            stand_in.add(key)
    bought: dict[str, int] = {}   # a bought skill's key -> its best level
    # A bought skill's key -> one (TL, level, name) per row: a skill bought at
    # two tech levels is two skills (B168).
    bought_at: dict[str, list[tuple[str, int, str]]] = {}
    other_tl: list[tuple[str, str]] = []   # the skill at another TL: (name, level)
    for _i, row in rows:
        name = cell(row, i_name)
        if not _key(name):
            continue
        if _key(name) == _key(skill) and not _same_tl(_tl(name), _tl(skill)):
            # B168: another TL is another skill (B513: it defaults to this
            # one at the TL penalty).
            m = re.search(r"\d+", next(
                (cell(row, i) for i in (i_base, i_eff, i_lvl, i_cur)
                 if re.search(r"\d", cell(row, i))), ""))
            other_tl.append((_marked_off(name), m.group(0) if m else "?"))
        elif _key(name) == _key(skill):
            m = re.search(r"\d+", next(
                (cell(row, i) for i in (i_base, i_eff, i_lvl, i_cur)
                 if re.search(r"\d", cell(row, i))), ""))
            level_at = f", at {m.group(0)}" if m else ""
            return ("HAVE", f"{skill} is in the Skills table already"
                    f"{level_at}", None)
        pts = gk.parse_cost(cell(row, i_pts)) if i_pts >= 0 else None
        level_cell = next((cell(row, i) for i in (i_base, i_eff, i_lvl)
                           if re.search(r"\d", cell(row, i))), "")
        m = re.search(r"\d+", level_cell)
        add_back = 0
        if not m and re.search(r"\d", cell(row, i_cur)):
            # Only a Current column: the level bought is it plus the
            # encumbrance it was lowered by.
            m = re.search(r"\d+", cell(row, i_cur))
            if enc and re.sub(r"\s*\(.*$", "", _key(name)) in gc.ENC_PENALIZED_SKILLS:
                add_back = enc
        # B173: a skill known only at default is no base for another. With
        # no Points column that cannot be told, so no skill is a base.
        if m and i_pts >= 0 and pts is not None and pts > 0:
            got = int(m.group(0)) + add_back
            bought_at.setdefault(_key(name), []).append(
                (_tl(name), got, _marked_off(name)))
            bought[_key(name)] = max(got, bought.get(_key(name), got))
    if other_tl and (difficulty is None or defaults is None):
        name, at_level = other_tl[0]
        raise Refused("CHECK-DEFAULT", (
            f"{skill} is another tech level of {name} at {at_level}, which it "
            "defaults to at the tech-level penalty (B168, B513); give its "
            "defaults with --default"))
    if i_pts < 0:
        said.append("the Skills table has no Points column, so only "
                    "attribute defaults are used")

    if difficulty is None or defaults is None:
        found = listed(skill)
        if found is None:
            raise Refused("NOT-FOUND", f"the GURPS tables do not list {skill}; "
                          "give its difficulty and defaults with "
                          "--difficulty and --default")
        difficulty = difficulty or found[0]
        defaults = defaults if defaults is not None else found[1]
        page = found[2]
        if " (" in _key(skill) and _stem(skill) not in NO_SPECIALTY_DEFAULTS and not any(
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
    if _key(defaults) in NO_DEFAULT and attack and UNARMED_RE.match(attack.strip()):
        return unarmed(attack.strip(), skill, attrs, bought)
    if _key(defaults) in NO_DEFAULT:
        # B173: a skill with no default is unusable without points.
        return ("NO-DEFAULT", f"{skill} has no default (B173): it can't be "
                "used until at least 1 point is spent on it", None)

    best: tuple[int, str, str] | None = None
    for term in _terms(defaults):
        m = TERM_RE.match(term)
        if not m:
            continue
        base, sign, num = m.group(1).strip(), m.group(2), int(m.group(3))
        mod = -num if sign in "-−" else num
        rows_of = bought_at.get(_key(base), [])
        same = [lv for t, lv, _n in rows_of
                if _same_tl(t, _tl(base) or _tl(skill))]
        if base.lower() in ATTRS:
            have = attrs.get(base.lower())
        elif same or not rows_of:
            # A default from the skill at another TL is a default of a
            # default (B173), unless it is given with that TL.
            have = max(same) if same else None
        else:
            have = None
            note = (f"{rows_of[0][2]} is another tech level, so "
                    "no base for this default (B168, B173)")
            if note not in said:
                said.append(note)
        if have is not None and (best is None or have + mod > best[0]):
            best = (int(have) + mod, term.strip(), base.lower())
    if best is None:
        raise Refused("CANNOT", f"{skill}: none of its defaults ({defaults}) "
                      "can be worked out from this sheet")
    level, source, base = best
    if base in stand_in:
        said.append(f"{base.capitalize()} taken as IQ: the sheet lists no "
                    f"{base.capitalize()}")
    attr = dm.group(1)
    attr_val = attrs.get(attr.lower())
    rel = f"{attr.upper() if len(attr) == 2 else attr}{level - attr_val:+d}" \
        if attr_val is not None else ""
    if attr_val is None:
        said.append(f"Relative Level left blank: the sheet lists no {attr}")
    # A tech-level skill is written as the sheet writes its kin: the TL the
    # name was given with, else the one a bought specialty of it carries.
    tl = _tl(skill) or next((t for k in sorted(bought_at)
                             for t, _lv, _n in bought_at[k]
                             if t and _stem(k) == _stem(skill)), "")
    written = _plain(skill)
    if tl:
        head, _sep, rest = written.partition(" (")
        written = f"{head}{tl} ({rest}" if rest else f"{head}{tl}"
    points = "[0]" if any(cell(r, i_pts).startswith("[") for _i, r in rows) \
        else "0"
    current = level
    if enc and re.sub(r"\s*\(.*$", "", _key(skill)) in gc.ENC_PENALIZED_SKILLS:
        current = level - enc
    new = [""] * len(headers)
    new[i_name] = written
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
    note = "".join(f"; {x}" for x in said)
    return ("WOULD-ADD", f"{row_text} (default {source}, level {level}{note})",
            "".join(out))


# B271: an unarmed attack needs no unarmed skill. A punch rolls against the
# best of DX, Boxing, Brawling and Karate; a kick against the best of DX,
# Brawling and Karate, less 2; a grapple against DX, Judo, Sumo Wrestling or
# Wrestling; a bite against DX or Brawling; a slam against DX, Brawling or
# Sumo Wrestling (B371); a shove against DX or Sumo Wrestling (B372).
UNARMED_BASES = (
    (re.compile(r"^kick\b", re.I), ("brawling", "karate"), -2),
    (re.compile(r"^(?:grapple|grab)\b", re.I),
     ("judo", "sumo wrestling", "wrestling"), 0),
    (re.compile(r"^bite\b", re.I), ("brawling",), 0),
    (re.compile(r"^slam\b", re.I), ("brawling", "sumo wrestling"), 0),
    (re.compile(r"^shove\b", re.I), ("sumo wrestling",), 0),
    (re.compile(r""), ("boxing", "brawling", "karate"), 0),
)


def unarmed(attack: str, skill: str, attrs: dict, bought: dict
            ) -> tuple[str, str, None]:
    """The UNARMED row: what the attack rolls against without SKILL, and
    the Skill cell to write, in a form the to-hit calculator reads as a
    level (`DX 12`, `Brawling 13`)."""
    skills, mod = next((sk, m) for pat, sk, m in UNARMED_BASES
                       if pat.match(attack))
    options = [(attrs["dx"], "DX")] if "dx" in attrs else []
    options += [(bought[k], k.title()) for k in skills if k in bought]
    if not options:
        raise Refused("CANNOT", f"{attack}: the sheet lists no DX")
    have, name = max(options, key=lambda o: o[0])
    level = int(have) + mod
    how = f"{name}{mod:+d} = {level}" if mod else f"{name} {level}"
    return ("UNARMED", f"{attack} rolls against {how} without {skill}; write "
            f"the Skill cell as \"{name} {level}\"; nothing is added", None)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Add a GURPS skill to a sheet at its default, 0 points.")
    ap.add_argument("sheet", type=Path, help="the PC sheet's path")
    ap.add_argument("skill", help="the skill's name")
    ap.add_argument("--difficulty", metavar="DX/A", help="the skill's difficulty, e.g. DX/A, for a skill the tables lack")
    ap.add_argument("--default", dest="defaults", metavar="DEFAULTS", help="the skill's defaults, for a skill the tables lack")
    ap.add_argument("--for", dest="attack", metavar="ATTACK", help="the attack row the skill is for")
    ap.add_argument("--write", action="store_true", help="write the skill to the sheet (default: preview)")
    ap.epilog = 'Example: gma gurps-skill-default "<PC note>" "<skill>" --write'
    return ap


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = build_parser()
    args = ap.parse_args(argv)
    if (args.difficulty is None) != (args.defaults is None):
        print(f"{cli_name()}: --difficulty and --default go "
              "together", file=sys.stderr)
        return 2
    if not args.skill.strip():
        print(f"{cli_name()}: give the skill's name",
              file=sys.stderr)
        return 2
    try:
        text = args.sheet.read_bytes().decode("utf-8")
    except (OSError, UnicodeError) as e:
        print(f"{cli_name()}: cannot read {args.sheet}: {e}",
              file=sys.stderr)
        return 2
    where = args.sheet.as_posix()
    try:
        kind, what, new = plan(text, args.skill.strip(), args.difficulty,
                               args.defaults, args.attack)
    except Refused as e:
        print(f"{e.args[0]}\t{where}\t{e.args[1]}")
        return 1
    if new is not None and args.write:
        try:
            write_text_atomic(args.sheet, new)
        except (OSError, StepFailed) as e:
            print(f"CANNOT\t{where}\tcould not write the sheet ({e})")
            return 1
        kind = "ADDED"
    print(f"{kind}\t{where}\t{what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
