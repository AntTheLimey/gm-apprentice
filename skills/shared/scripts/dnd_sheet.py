#!/usr/bin/env python3
"""Report and fill the derived numbers on a D&D 5e (2024) PC note.

The note holds every finished number; this keeps the ones that are plain
sums right. A cell that is blank or a bare number is this tool's to
maintain. A cell with anything else in it (`+7 (GM boon)`) is
the GM's and is kept.

Usage:
  dnd_sheet.py SHEET.md            report (nothing is written)
  dnd_sheet.py SHEET.md --write    apply every FILL row, all or none
  dnd_sheet.py --party VAULT       rules checks on every PC; only findings

Output: one row per derived cell, `STATUS<TAB>locus<TAB>message`, then
`# same: N  fill: N  kept: N`.
  SAME   the cell agrees with the sum
  FILL   blank or a bare number that differs: `old -> new`
  KEPT   hand-set: the cell, and what the sum gives
  ERROR  the sheet cannot be read; nothing is written

Then the rules checks (dnd_rules.py), which never write:
`WRONG | LOOK | CANTCHECK<TAB>locus<TAB>message` and
`# wrong: N  look: N  cantcheck: N`.

Owned cells: Proficiency Bonus; each ability's Modifier and Save; each
skill's Modifier; Passive Perception / Investigation / Insight;
Initiative; Spell Attack Modifier and Spell Save DC; and the four
`### Carrying` values (Carried Weight, Carrying Capacity, Drag / Lift /
Push, Encumbrance) when the note has that table. AC, HP, Speed, attacks
and slot totals are never touched.

`### Bonuses` (`Applies To | Bonus | Source`) is added in. Applies To,
comma-separated: Saves, Ability Checks (every skill and initiative),
Skills, Initiative, `<Ability> Save`, a skill name, Passive Perception /
Investigation / Insight, Spell Attack, Spell Save DC. Bonus: a signed
whole number, an ability (its modifier), PB, or Half PB. A row that
cannot be read is a KEPT row and adds nothing. A skill whose Proficient
cell is `Half` gets half the proficiency bonus, rounded down. Stdlib only.
"""

import argparse
import re
import sys
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dnd_calc as dc  # noqa: E402
import dnd_rules as dr  # noqa: E402
from migrate_core import StepFailed, write_text_atomic  # noqa: E402
from dnd_note import (BARE, HALF, PLACEHOLDER, REASONED, YES, Cell, Note,  # noqa: E402
                      clean, column, number, plain_name, to_int)

PASSIVES = {"passive perception": "perception",
            "passive investigation": "investigation",
            "passive insight": "insight"}
ABILITY_WORD = re.compile(
    r"^(str(?:ength)?|dex(?:terity)?|con(?:stitution)?|int(?:elligence)?|wis(?:dom)?|cha(?:risma)?)$", re.I)
SAVE_TARGET = re.compile(r"^(\w+)\s+sav(?:e|es|ing throws?)$", re.I)
SKILLS = ("acrobatics", "animal handling", "arcana", "athletics", "deception", "history",
          "insight", "intimidation", "investigation", "medicine", "nature", "perception",
          "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival")
WEIGHT = r"(\d+(?:\.\d+)?|\d+\s*/\s*\d+)\s*(?:lbs?\.?)?"
BARE_WEIGHT = re.compile(rf"^{WEIGHT}$", re.I)
REASONED_WEIGHT = re.compile(rf"^{WEIGHT}\s*\(.+\)$", re.I)
NO_WEIGHT = re.compile(r"^[—–-]$")
READ_TABLES = {("skills", ""), ("stat sheet", "core"), ("stat sheet", "ability scores"),
               ("stat sheet", "combat"), ("stat sheet", "senses"), ("stat sheet", "bonuses"),
               ("spellcasting", ""), ("equipment", "gear"), ("equipment", "coins"),
               ("equipment", "carrying")}
WITHIN, OVER = "Within capacity", "Over capacity (Speed 5 ft)"


@dataclass
class Row:
    status: str
    locus: str
    message: str
    line: int = -1
    col: int = -1
    new: str = ""


def judge(locus: str, cell: Cell, want: str, note: str = "") -> Row:
    """Classify one derived cell against the sum. `note` says what fed it."""
    text = cell.text.strip()
    why = f" ({note})" if note else ""
    if text == "" or PLACEHOLDER.match(text):
        return Row("FILL", locus, f"(blank) -> {want}{why}", cell.line, cell.col, want)
    if BARE.match(text):
        same = to_int(text) == to_int(want)
        if same:
            return Row("SAME", locus, f"{text}{why}")
        return Row("FILL", locus, f"{text} -> {want}{why}", cell.line, cell.col, want)
    if REASONED.match(text):
        return Row("KEPT", locus, f"{text}; the sum gives {want}{why}")
    return Row("KEPT", locus, f"{text}; not read as a number; the sum gives {want}{why}")


def effective(cell: Cell | None, computed: int) -> int:
    """The number a kept cell stands for, else the sum."""
    if cell is None:
        return computed
    m = REASONED.match(cell.text.strip())
    return to_int(m.group(1)) if m else computed   # type: ignore[return-value]


def to_weight(text: str) -> Fraction | None:
    """Pounds from `55`, `55 lb`, `0.5 lb` or `1/4 lb`; a dash weighs nothing."""
    t = text.strip()
    if NO_WEIGHT.match(t):
        return Fraction(0)
    m = BARE_WEIGHT.match(t)
    if not m:
        return None
    try:
        return Fraction(m.group(1).replace(" ", ""))
    except ZeroDivisionError:
        return None


def judge_weight(locus: str, cell: Cell, value: Fraction, note: str = "") -> Row:
    """As judge(), for a weight: `412 lb` and `412` are both bare."""
    text = cell.text.strip()
    want = dc.pounds(value)
    why = f" ({note})" if note else ""
    if text == "" or PLACEHOLDER.match(text):
        return Row("FILL", locus, f"(blank) -> {want}{why}", cell.line, cell.col, want)
    if BARE_WEIGHT.match(text):
        if to_weight(text) == to_weight(want):
            return Row("SAME", locus, f"{text}{why}")
        return Row("FILL", locus, f"{text} -> {want}{why}", cell.line, cell.col, want)
    if REASONED_WEIGHT.match(text):
        return Row("KEPT", locus, f"{text}; the sum gives {want}{why}")
    return Row("KEPT", locus, f"{text}; not read as a weight; the sum gives {want}{why}")


def effective_weight(cell: Cell | None, computed: Fraction) -> Fraction:
    """The weight a kept cell stands for, else the sum."""
    if cell is None:
        return computed
    m = REASONED_WEIGHT.match(cell.text.strip())
    kept = to_weight(m.group(1)) if m else None
    return computed if kept is None else kept


def judge_encumbrance(locus: str, cell: Cell, want: str) -> Row:
    """The tool's own two phrases are its to maintain; anything else is the GM's."""
    text = cell.text.strip()
    if text == "" or PLACEHOLDER.match(text):
        return Row("FILL", locus, f"(blank) -> {want}", cell.line, cell.col, want)
    if text.lower() == want.lower():
        return Row("SAME", locus, text)
    if text.lower() in (WITHIN.lower(), OVER.lower()):
        return Row("FILL", locus, f"{text} -> {want}", cell.line, cell.col, want)
    return Row("KEPT", locus, f"{text}; the sum gives {want}")


@dataclass
class Bonus:
    targets: set[str]
    amount: int
    source: str


def bonus_target(text: str, skills: set[str]) -> str | None:
    """One `Applies To` entry as a key, or None when it is not in the vocabulary."""
    t = re.sub(r"\s+", " ", clean(text).lower())
    if t in ("saves", "saving throws"):
        return "saves"
    if t in ("ability checks", "skills", "initiative", "spell save dc"):
        return t
    if t in ("spell attack", "spell attacks", "spell attack modifier"):
        return "spell attack"
    if t in PASSIVES:
        return "passive:" + PASSIVES[t]
    m = SAVE_TARGET.match(t)
    if m and ABILITY_WORD.match(m.group(1)):
        return "save:" + m.group(1)[:3].upper()
    if t in skills:
        return "skill:" + t
    return None


def bonus_amount(text: str, mods: dict[str, int], pb: int) -> int | None:
    """A signed whole number, an ability's modifier, PB or Half PB."""
    t = re.sub(r"\s+", " ", text.strip().lower())
    if t in ("pb", "proficiency bonus"):
        return pb
    if t in ("half pb", "half proficiency bonus"):
        return dc.half_proficiency(pb)
    if ABILITY_WORD.match(t):
        return mods[t[:3].upper()]
    return to_int(t)


def read_bonuses(table: list, mods: dict[str, int], pb: int,
                 skills: set[str]) -> tuple[list[Bonus], list[Row]]:
    """The `### Bonuses` rows that can be added in, and a KEPT row for each that cannot."""
    bonuses: list[Bonus] = []
    kept: list[Row] = []
    for n, (_i, _header, cells) in enumerate(table, start=1):
        applies, amount, source = ([c.strip() for c in cells] + ["", "", ""])[:3]
        if not (applies or amount or source) or all(PLACEHOLDER.match(c) for c in (applies, amount, source) if c):
            continue
        name = plain_name(source)
        locus = f"Stat Sheet / Bonuses / row {n}" + (f" ({name})" if name else "")
        shown = f"{applies or '(blank)'} | {amount or '(blank)'}"
        entries = [e.strip() for e in applies.split(",") if e.strip()]
        targets = [bonus_target(e, skills) for e in entries]
        unknown = [e for e, t in zip(entries, targets) if t is None]
        value = bonus_amount(amount, mods, pb)
        if not entries:
            kept.append(Row("KEPT", locus, f"{shown}; nothing in Applies To; it adds nothing"))
        elif unknown:
            kept.append(Row("KEPT", locus, f"{shown}; {', '.join(unknown)} is not something a bonus applies to; it adds nothing"))
        elif value is None:
            kept.append(Row("KEPT", locus, f"{shown}; the bonus {amount or '(blank)'} was not understood; it adds nothing"))
        else:
            bonuses.append(Bonus({t for t in targets if t}, value, name or f"Bonuses row {n}"))
    return bonuses, kept


def plan(text: str) -> list[Row]:
    note = Note(text)
    tables, second = note.tables, note.second
    rows: list[Row] = []
    table, attr = note.table, note.attr

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

    # Scores first: a bonus may be an ability's modifier.
    scores: dict[str, int] = {}
    ability_rows = table("stat sheet", "ability scores")
    for i, header, cells in ability_rows:
        key = clean(cells[0]).upper()[:3] if cells else ""
        if key not in dc.ABILITIES:
            continue
        score = number(cells[column(header, r"score$")])[0] if column(header, r"score$") >= 0 else None
        if score is None:
            return [Row("ERROR", f"Stat Sheet / Ability Scores / {key}",
                        "the score is not a number; nothing was changed")]
        scores[key] = score
    missing = [a for a in dc.ABILITIES if a not in scores]
    if missing:
        return [Row("ERROR", "Stat Sheet / Ability Scores",
                    f"no row for {', '.join(missing)}; nothing was changed")]
    mods = {key: dc.ability_mod(score) for key, score in scores.items()}

    skill_names = set(SKILLS) | {clean(cells[0]).lower() for _i, _h, cells in table("skills")
                                 if cells and clean(cells[0])}
    bonuses, not_understood = read_bonuses(table("stat sheet", "bonuses"), mods, pb, skill_names)
    rows.extend(not_understood)

    def fed(*targets: str) -> tuple[int, str]:
        """What the Bonuses table adds to a cell, and the words that say so."""
        hits = [b for b in bonuses if b.targets & set(targets)]
        return (sum(b.amount for b in hits),
                "incl. " + ", ".join(f"{dc.signed(b.amount)} {b.source}" for b in hits) if hits else "")

    for i, header, cells in ability_rows:
        key = clean(cells[0]).upper()[:3] if cells else ""
        if key not in dc.ABILITIES:
            continue
        c_mod, c_prof, c_save = column(header, r"mod"), column(header, r"sav.*prof"), column(header, r"save$")
        if 0 <= c_mod < len(cells):
            rows.append(judge(f"Stat Sheet / Ability Scores / {key} / Modifier",
                              Cell(i, c_mod, cells[c_mod]), dc.signed(mods[key])))
        if 0 <= c_save < len(cells):
            proficient = 0 <= c_prof < len(cells) and bool(YES.match(cells[c_prof].strip()))
            extra, why = fed("saves", f"save:{key}")
            rows.append(judge(f"Stat Sheet / Ability Scores / {key} / Save",
                              Cell(i, c_save, cells[c_save]),
                              dc.signed(dc.save(mods[key], pb, proficient) + extra), why))

    init = attr("stat sheet", "combat", "initiative")
    if init:
        extra, why = fed("ability checks", "initiative")
        rows.append(judge("Stat Sheet / Combat / Initiative", init, dc.signed(mods["DEX"] + extra), why))

    # Skills
    skill_value: dict[str, int] = {}
    for i, header, cells in table("skills"):
        c_ab, c_pr, c_ex, c_mod = (column(header, r"abilit"), column(header, r"prof"),
                                   column(header, r"expert"), column(header, r"(mod|bonus)"))
        if min(c_ab, c_mod) < 0 or len(cells) <= max(c_ab, c_mod):
            continue
        ability = cells[c_ab].strip().upper()[:3]
        name = clean(cells[0])
        if ability not in mods or not name:
            continue
        yes = lambda c: 0 <= c < len(cells) and bool(YES.match(cells[c].strip()))  # noqa: E731
        half = 0 <= c_pr < len(cells) and bool(HALF.match(cells[c_pr].strip()))
        cell = Cell(i, c_mod, cells[c_mod])
        locus = f"Skills / {name} / Modifier"
        if half and yes(c_ex):
            # Half is not a kind of expertise: the row is left as the note has it.
            held = cell.text.strip()
            rows.append(Row("KEPT", locus, f"{held or '(blank)'}; Proficient Half with Expertise Yes "
                                           "was not understood; nothing was changed"))
            m = REASONED.match(held)
            held_value = to_int(m.group(1) if m else held)
            if held_value is not None:
                skill_value[name.lower()] = held_value
            continue
        extra, why = fed("ability checks", "skills", f"skill:{name.lower()}")
        want = dc.skill(mods[ability], pb, yes(c_pr), yes(c_ex), half) + extra
        rows.append(judge(locus, cell, dc.signed(want), why))
        skill_value[name.lower()] = effective(cell, want)

    # Passive scores: under Senses (new layout) or Combat (old). Ten plus the
    # finished skill, so a bonus to the skill has already carried through.
    for h3 in ("senses", "combat"):
        for i, header, cells in table("stat sheet", h3):
            label = clean(cells[0]) if cells else ""
            passive = PASSIVES.get(label.lower())
            if not passive or len(cells) < 2:
                continue
            title = "Senses" if h3 == "senses" else "Combat"
            base = skill_value.get(passive)
            if base is None:
                rows.append(Row("KEPT", f"Stat Sheet / {title} / {label}",
                                f"{cells[1].strip() or '(blank)'}; no {passive.title()} skill row to take it from; "
                                "nothing was changed"))
                continue
            extra, why = fed(f"passive:{passive}")
            rows.append(judge(f"Stat Sheet / {title} / {label}",
                              Cell(i, 1, cells[1]), str(dc.passive(base) + extra), why))

    # Spellcasting: one set of rows, or several labelled `(Class)`.
    casting = {clean(cells[0]).lower(): (i, cells) for i, _h, cells in table("spellcasting")
               if len(cells) > 1}
    for label, (i, cells) in casting.items():
        m = re.fullmatch(r"(spell attack modifier|spell save dc)(\s*\(.+\))?", label)
        if not m:
            continue
        ability_row = casting.get("spellcasting ability" + (m.group(2) or ""))
        ability = ability_row[1][1].strip().upper()[:3] if ability_row else ""
        if ability not in mods:
            continue
        if m.group(1).endswith("modifier"):
            extra, why = fed("spell attack")
            cast = dc.signed(dc.spell_attack(mods[ability], pb) + extra)
        else:
            extra, why = fed("spell save dc")
            cast = str(dc.spell_save_dc(mods[ability], pb) + extra)
        rows.append(judge(f"Spellcasting / {clean(cells[0])}", Cell(i, 1, cells[1]), cast, why))

    # Carrying: only when the note has the table.
    if table("equipment", "carrying"):
        size_cell = attr("stat sheet", "combat", "size")
        size = (size_cell.text.strip().split() or [""])[0] if size_cell else ""
        gear, unweighed, no_column = Fraction(0), [], False
        for _i, header, cells in table("equipment", "gear"):
            c_item, c_qty, c_wt = column(header, r"item$"), column(header, r"(qty|quantity)$"), column(header, r"weight")
            item = plain_name(cells[c_item].replace("\\|", "|")) if 0 <= c_item < len(cells) else ""
            if not item or PLACEHOLDER.match(item):
                continue
            if c_wt < 0:
                no_column = True
                continue
            qty_text = cells[c_qty].strip() if 0 <= c_qty < len(cells) else ""
            qty = 1 if qty_text == "" else to_int(qty_text)
            each = to_weight(cells[c_wt]) if c_wt < len(cells) else None
            if each is None or qty is None or qty < 0:
                unweighed.append(item)
            else:
                gear += qty * each
        coins = 0
        for _i, _header, cells in table("equipment", "coins")[:1]:
            coins = sum(n for n in (to_int(c.replace(",", "")) for c in cells) if n is not None and n > 0)
        coin_lb = dc.coin_weight(coins)
        said = [f"incl. {dc.pounds(coin_lb)} of coins"] if coins else []
        if no_column:
            said.append("Gear has no Weight column")
        if unweighed:
            said.append("no weight: " + ", ".join(unweighed))
        carried = gear + coin_lb
        capacity = dc.carrying_capacity(scores["STR"], size)
        # `Drag/Lift/Push` and `Drag / Lift / Push` are the same row.
        cells_by_label: dict[str, Cell | None] = dict.fromkeys(
            ("carried weight", "carrying capacity", "drag / lift / push", "encumbrance"))
        for i, _header, cells in table("equipment", "carrying"):
            label = re.sub(r"\s*/\s*", " / ", clean(cells[0]).lower()) if cells else ""
            if label in cells_by_label and cells_by_label[label] is None and len(cells) > 1:
                cells_by_label[label] = Cell(i, 1, cells[1])
        at = "Equipment / Carrying / "
        if cells_by_label["carried weight"]:
            rows.append(judge_weight(at + "Carried Weight", cells_by_label["carried weight"], carried, "; ".join(said)))
        if cells_by_label["carrying capacity"]:
            rows.append(judge_weight(at + "Carrying Capacity", cells_by_label["carrying capacity"], capacity))
        if cells_by_label["drag / lift / push"]:
            rows.append(judge_weight(at + "Drag / Lift / Push", cells_by_label["drag / lift / push"],
                                     dc.drag_lift_push(scores["STR"], size)))
        if cells_by_label["encumbrance"]:
            over = (effective_weight(cells_by_label["carried weight"], carried)
                    > effective_weight(cells_by_label["carrying capacity"], capacity))
            rows.append(judge_encumbrance(at + "Encumbrance", cells_by_label["encumbrance"], OVER if over else WITHIN))
    for key, heading in second.items():
        if key in READ_TABLES:
            rows.append(Row("KEPT", heading, f"second table under {heading} not read"))
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


SYSTEM = "dnd-5e-2024"


def party(vault: Path) -> int:
    """The rules checks on every PC note in a vault. Prints only findings."""
    from migrate_vault import vault_system
    from vaultlib import entity_type, extract_frontmatter, vault_files

    if not vault.is_dir():
        print(f"dnd_sheet: {vault.as_posix()} is not a folder", file=sys.stderr)
        return 2
    system = vault_system(vault)
    if system != SYSTEM:
        said = f"is {system}, not {SYSTEM}" if system else "is not recorded"
        print(f"dnd_sheet: this vault's system {said}; nothing was checked")
        return 0
    tally = dict.fromkeys(("WRONG", "LOOK", "CANTCHECK"), 0)
    sheets = 0
    for rel, text in vault_files(vault):
        if entity_type(extract_frontmatter(text) or {}) != "pc":
            continue
        errors = [r for r in plan(text) if r.status == "ERROR"]
        if any(r.locus == "Stat Sheet" for r in errors):
            continue           # no sheet in the note: vault_check.py pc-body reports that
        sheets += 1
        found = [dr.Finding("CANTCHECK", r.locus, "the sheet cannot be read: "
                            + r.message.removesuffix("; nothing was changed")) for r in errors]
        for item in found or dr.check(text):
            tally[item.status] += 1
            print(f"{item.status}\t{Path(rel).stem}: {item.locus}\t{item.message}")
    print(f"# wrong: {tally['WRONG']}  look: {tally['LOOK']}  cantcheck: {tally['CANTCHECK']}  sheets: {sheets}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("sheet", nargs="?")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--party", metavar="VAULT",
                    help="run the rules checks on every PC note in a vault; never writes")
    args = ap.parse_args()
    if bool(args.sheet) == bool(args.party):
        ap.error("give one sheet, or --party VAULT")
    if args.party:
        if args.write:
            ap.error("--party never writes; run --write on one sheet")
        return party(Path(args.party))
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
        try:
            write_text_atomic(path, new)
        except StepFailed as e:
            print(f"dnd_sheet: {e}", file=sys.stderr)
            return 2
        count["SAME"] += count["FILL"]
        count["FILL"] = 0
    print(f"# same: {count['SAME']}  fill: {count['FILL']}  kept: {count['KEPT']}")
    found = dr.check(text)
    for item in found:
        print(f"{item.status}\t{item.locus}\t{item.message}")
    tally = {s: sum(1 for item in found if item.status == s) for s in ("WRONG", "LOOK", "CANTCHECK")}
    print(f"# wrong: {tally['WRONG']}  look: {tally['LOOK']}  cantcheck: {tally['CANTCHECK']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
