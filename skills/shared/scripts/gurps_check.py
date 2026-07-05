#!/usr/bin/env python3
"""GURPS 4e sheet arithmetic checks: lift, encumbrance, load, defenses,
points, damage.

Read-only companion to vault_check.py for a single PC markdown sheet.
Verifies the sheet's own numbers against Basic Set formulas and reports
deltas; interpretation stays with the GM (Talents and bespoke perks
legitimately shift values, so findings are advisory). Stdlib only.

Usage:
  gurps_check.py SHEET.md [attributes|encumbrance|load|defenses|points|damage|all]

Output: labelled sections, `# count: N` headers, one finding per line
as `LEVEL<TAB>locus<TAB>message`.

Levels: ERROR (arithmetic contradiction), WARNING (mismatch the GM
should look at), INFO (context, e.g. missing sections limiting a check).
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gurps_calc as gc            # noqa: E402
from schema_rules import extract_frontmatter  # noqa: E402

HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$", re.M)
WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)")
COST_RE = re.compile(r"[\[\(]?\s*([+\-−]?\d+)\s*[\]\)]?")
LEVEL_ALIASES = {"extra-heavy": "x-heavy", "extra heavy": "x-heavy",
                 "xheavy": "x-heavy", "very heavy": "x-heavy"}
# Mirrors the fence convention in schema_rules.extract_frontmatter
# (anchored at file start, CRLF-tolerant, closing fence at newline or
# EOF) so the fm dict and the body strip agree on the block boundary.
FRONTMATTER_BLOCK_RE = re.compile(r"\A---\r?\n.*?\r?\n---(?:\r?\n|$)",
                                  re.DOTALL)


class Sheet:
    def __init__(self, text: str):
        self.fm = extract_frontmatter(text) or {}
        body = FRONTMATTER_BLOCK_RE.sub("", text, count=1)
        self._sections = []           # (title_lower, level, body)
        matches = list(HEADING_RE.finditer(body))
        for i, m in enumerate(matches):
            level = len(m.group(1))
            end = len(body)
            for later in matches[i + 1:]:
                if len(later.group(1)) <= level:
                    end = later.start()
                    break
            self._sections.append(
                (m.group(2).strip().lower(), level, body[m.end():end]))

    def section(self, title: str):
        t = title.strip().lower()
        for name, _level, sec_body in self._sections:
            if name == t:
                return sec_body
        return None

    def table(self, title: str):
        sec_body = self.section(title)
        if sec_body is None:
            return []
        rows = []
        for line in sec_body.splitlines():
            line = line.strip()
            if not (line.startswith("|") and line.endswith("|")):
                if rows:
                    break             # table ended
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue              # separator row
            rows.append(cells)
        return rows


def parse_weight(s):
    if s is None:
        return None
    cleaned = str(s).replace(",", "")
    for junk in ("≤", "≈", "~", "<", ">"):
        cleaned = cleaned.replace(junk, "")
    m = WEIGHT_RE.search(cleaned)
    return float(m.group(1)) if m else None


def parse_cost(s):
    if s is None:
        return None
    m = COST_RE.search(str(s).replace("−", "-"))
    return int(m.group(1)) if m else None


def col(headers, *needles):
    lower = [h.lower() for h in headers]
    for i, h in enumerate(lower):
        if any(n in h for n in needles):
            return i
    return -1


def norm_level(s):
    base = re.sub(r"\([^)]*\)", "", str(s))
    base = re.sub(r"[*←]|\(current\)", "", base, flags=re.I)
    base = re.sub(r"\s+", " ", base).strip().lower()
    return LEVEL_ALIASES.get(base, base)


_ATTR_KEYS = {"st": "st", "dx": "dx", "iq": "iq", "ht": "ht",
              "hp": "hp", "will": "will", "per": "per", "fp": "fp",
              "basic speed": "speed", "basic move": "move"}


def read_attributes(sheet):
    out = {}
    for title in ("Primary Attributes", "Secondary Characteristics",
                  "Stat Sheet"):
        for row in sheet.table(title)[1:]:
            if len(row) < 2 or not row[0]:
                continue
            key = _ATTR_KEYS.get(row[0].strip().lower())
            if key is None or key in out:
                continue
            m = re.search(r"\d+(?:\.\d+)?", row[1])
            if m:
                val = float(m.group(0))
                out[key] = val if key == "speed" else int(val)
    return out if "st" in out else None


def has_combat_reflexes(sheet):
    for title in ("Advantages & Perks", "Advantages", "Traits"):
        for row in sheet.table(title)[1:]:
            if row and "combat reflexes" in row[0].lower():
                return True
    return False


def check_attributes(sheet):
    findings = []
    attrs = read_attributes(sheet)
    if attrs is None:
        return [("INFO", "attributes", "no Stat Sheet attributes found; "
                 "attribute checks skipped")]
    if not all(k in attrs for k in ("st", "dx", "iq", "ht")):
        return [("INFO", "attributes", "missing one of ST/DX/IQ/HT; "
                 "secondary checks skipped")]
    base = gc.secondaries(attrs["st"], attrs["dx"], attrs["iq"], attrs["ht"])
    source = {"hp": "ST", "will": "IQ", "per": "IQ", "fp": "HT",
              "speed": "(DX+HT)/4", "move": "floor(Speed)"}
    for key in ("hp", "will", "per", "fp", "speed", "move"):
        if key not in attrs:
            continue
        declared, computed = attrs[key], base[key]
        mismatch = (abs(declared - computed) > 0.01 if key == "speed"
                    else declared != computed)
        if mismatch:
            findings.append(("INFO", f"attributes/{key}",
                             f"{key.upper()} {declared} vs base {computed} "
                             f"({source[key]}) — bought adjustment or error"))
    return findings


def _close(actual, expected):
    return abs(actual - expected) <= max(1.0, expected * 0.02)


def _cell(row, i):
    return row[i] if 0 <= i < len(row) else None


def check_encumbrance(sheet):
    findings = []
    attrs = read_attributes(sheet)
    if attrs is None:
        return [("INFO", "encumbrance", "no attributes; check skipped")]
    rows = sheet.table("Encumbrance")
    if len(rows) < 2:
        return [("INFO", "encumbrance", "no Encumbrance table found")]
    bl = gc.basic_lift(attrs["st"])
    expected = {name.lower(): (level, maxwt)
                for name, level, maxwt in gc.enc_max_weights(bl)}
    headers = rows[0]
    i_wt, i_mv, i_dg = (col(headers, "weight", "max"),
                        col(headers, "move"), col(headers, "dodge"))
    cr = has_combat_reflexes(sheet)
    bm, speed = attrs.get("move"), attrs.get("speed")
    for row in rows[1:]:
        if not row or not row[0]:
            continue
        name = norm_level(row[0])
        if name not in expected:
            findings.append(("INFO", f"encumbrance/{row[0]}",
                             "unrecognized level name; row skipped"))
            continue
        level, maxwt = expected[name]
        if i_wt >= 0:
            declared = parse_weight(_cell(row, i_wt))
            if declared is not None and not _close(declared, maxwt):
                findings.append(("WARNING", f"encumbrance/{row[0]}",
                                 f"max {declared:g} lb, computed {maxwt:g} lb "
                                 f"(BL {bl:g})"))
        if i_mv >= 0 and bm is not None:
            declared = parse_cost(_cell(row, i_mv))
            computed = gc.enc_move(bm, level)
            if declared is not None and declared != computed:
                findings.append(("WARNING", f"encumbrance/{row[0]}",
                                 f"Move {declared}, computed {computed} "
                                 f"(BM {bm})"))
        if i_dg >= 0 and speed is not None:
            declared = parse_cost(_cell(row, i_dg))
            computed = gc.enc_dodge(speed, level, cr)
            if declared is not None and declared != computed:
                findings.append(("WARNING", f"encumbrance/{row[0]}",
                                 f"Dodge {declared}, computed {computed}"
                                 f"{' (with Combat Reflexes)' if cr else ''}"))
    return findings


ENC_LINE_RE = re.compile(r"\bEnc(?:umbrance)?\*{0,2}\s*:\s*\*{0,2}\s*([^\n]+)",
                         re.I)


def declared_enc(sheet):
    body = sheet.section("Current Status")
    if not body:
        return None
    m = ENC_LINE_RE.search(body)
    return m.group(1).strip() if m else None


def check_load(sheet):
    attrs = read_attributes(sheet)
    if attrs is None:
        return [("INFO", "load", "no attributes; check skipped")]
    rows = sheet.table("Equipment")
    if len(rows) < 2:
        return [("INFO", "load", "no Equipment table found; check skipped")]
    headers = rows[0]
    i_wt, i_loc = col(headers, "weight"), col(headers, "location")
    if i_wt < 0:
        return [("INFO", "load", "Equipment table has no Weight column")]
    total = 0.0
    for row in rows[1:]:
        if i_loc >= 0:
            loc = _cell(row, i_loc)
            if loc is not None and loc.strip().lower() not in ("carried", "worn"):
                continue
        w = parse_weight(_cell(row, i_wt))
        if w is not None:
            total += w
    bl = gc.basic_lift(attrs["st"])
    computed_name = gc.ENC_LEVELS[-1][0]
    for name, _level, maxwt in gc.enc_max_weights(bl):
        if total <= maxwt:
            computed_name = name
            break
    declared = declared_enc(sheet)
    if declared is None:
        return [("INFO", "load",
                 f"carried+worn {total:g} lb -> {computed_name} (BL {bl:g}); "
                 "no Enc: line in Current Status to compare")]
    if norm_level(declared) != computed_name.lower():
        return [("WARNING", "load",
                 f"Current Status says Enc {declared} but carried+worn "
                 f"{total:g} lb computes to {computed_name} (BL {bl:g})")]
    return []


TRAILING_INT_RE = re.compile(r"(\d+)\s*$")


def check_defenses(sheet):
    findings = []
    attrs = read_attributes(sheet) or {}
    cr = has_combat_reflexes(sheet)
    rows = sheet.table("Melee Weapons")
    if len(rows) >= 2:
        headers = rows[0]
        i_skill, i_parry = col(headers, "skill"), col(headers, "parry")
        if i_skill >= 0 and i_parry >= 0:
            for row in rows[1:]:
                if len(row) <= max(i_skill, i_parry) or not row[0]:
                    continue
                sm = TRAILING_INT_RE.search(row[i_skill])
                pm = re.fullmatch(r"\d+", row[i_parry].strip())
                if not (sm and pm):
                    continue
                computed = gc.parry(int(sm.group(1)), cr)
                declared = int(pm.group(0))
                if declared != computed:
                    findings.append((
                        "WARNING", f"defenses/parry/{row[0]}",
                        f"Parry {declared}, computed {computed} from skill "
                        f"{sm.group(1)}{' +1 CR' if cr else ''} — weapon or "
                        f"style bonus may explain"))
    for row in sheet.table("Active Defenses")[1:]:
        if len(row) < 2 or not row[0]:
            continue
        label = row[0].lower()
        dm = re.match(r"\d+", row[1].strip())
        if not dm:
            continue
        declared = int(dm.group(0))
        if "dodge" in label and attrs.get("speed") is not None:
            computed = gc.enc_dodge(attrs["speed"], 0, cr)
            if declared != computed:
                findings.append((
                    "INFO", "defenses/dodge",
                    f"Dodge {declared}, unencumbered computed {computed} — "
                    "may reflect current encumbrance"))
        elif "block" in label:
            shield = None
            for srow in sheet.table("Skills")[1:]:
                if srow and "shield" in srow[0].lower():
                    m = TRAILING_INT_RE.search(srow[-1])
                    if m:
                        shield = int(m.group(1))
            if shield is not None:
                computed = gc.block(shield, cr)
                if declared != computed:
                    findings.append((
                        "WARNING", "defenses/block",
                        f"Block {declared}, computed {computed} from "
                        f"Shield {shield}{' +1 CR' if cr else ''}"))
    return findings


_POINT_SOURCES = [
    ("Attributes", ("Primary Attributes", "Secondary Characteristics")),
    ("Advantages & Perks", ("Advantages & Perks", "Advantages")),
    ("Disadvantages & Quirks", ("Disadvantages & Quirks", "Disadvantages")),
    ("Skills", ("Skills",)),
    ("Techniques", ("Techniques",)),
    ("Spells", ("Spells",)),
]


def _sum_costs(sheet, titles):
    total, found = 0, False
    for title in titles:
        rows = sheet.table(title)
        if len(rows) < 2:
            continue
        i_cost = col(rows[0], "cost", "point")
        if i_cost < 0:
            continue
        for row in rows[1:]:
            if not row or "total" in row[0].lower():
                continue
            c = parse_cost(_cell(row, i_cost))
            if c is not None:
                total += c
                found = True
    return (total, True) if found else (0, False)


def check_points(sheet):
    findings = []
    computed, missing = {}, []
    for label, titles in _POINT_SOURCES:
        total, found = _sum_costs(sheet, titles)
        if found:
            computed[label] = total
        else:
            missing.append(label)
    summary_rows = sheet.table("Points Summary")
    declared, declared_total = {}, None
    for row in summary_rows[1:]:
        if len(row) < 2 or not row[0]:
            continue
        label = re.sub(r"\*+", "", row[0]).strip()
        val = parse_cost(_cell(row, 1))
        if val is None:
            continue
        if label.lower() == "total":
            declared_total = val
        else:
            declared[label] = val
    for label, val in declared.items():
        if label in computed and computed[label] != val:
            findings.append(("WARNING", f"points/{label}",
                             f"summary says {val}, section costs sum to "
                             f"{computed[label]}"))
    grand = sum(computed.values()) if computed else None
    fm_total = parse_cost(sheet.fm.get("point_total"))
    for name, total in (("Points Summary Total", declared_total),
                        ("frontmatter point_total", fm_total)):
        if total is not None and grand is not None and total != grand:
            findings.append(("WARNING", "points/total",
                             f"{name} {total}, summed section costs {grand}"))
    if missing and (declared or fm_total is not None):
        findings.append(("INFO", "points",
                         "no cost data found for: " + ", ".join(missing) +
                         " — sums are partial"))
    return findings


FORMULA_RE = re.compile(r"\b(sw|thr)\b\s*(?:([+\-−])\s*(\d+))?", re.I)
DICE_IN_TEXT_RE = re.compile(r"\b(\d+)\s*d\s*(?:([+\-−])\s*(\d+))?")


def _resolve_formula(st, kind, sign, num):
    dice, adds = (gc.swing(st) if kind.lower() == "sw" else gc.thrust(st))
    if num:
        n = int(num)
        adds += -n if sign in ("-", "−") else n
    return dice, adds


def check_damage(sheet):
    attrs = read_attributes(sheet)
    if attrs is None:
        return [("INFO", "damage", "no attributes; check skipped")]
    st = attrs["st"]
    thr, sw = gc.thrust(st), gc.swing(st)
    findings = [("INFO", "damage",
                 f"ST {st}: thr {gc.fmt_dice(*thr)}, sw {gc.fmt_dice(*sw)} "
                 "(B16)")]
    rows = sheet.table("Melee Weapons")
    if len(rows) < 2:
        return findings
    i_dmg = col(rows[0], "damage")
    if i_dmg < 0:
        return findings
    for row in rows[1:]:
        if len(row) <= i_dmg or not row[0]:
            continue
        cell = _cell(row, i_dmg)
        fm_m = FORMULA_RE.search(cell)
        if not fm_m:
            continue
        dice, adds = _resolve_formula(st, *fm_m.groups())
        d_m = DICE_IN_TEXT_RE.search(cell)
        locus = f"damage/{row[0]}"
        if d_m:
            d_adds = int(d_m.group(3) or 0)
            if d_m.group(2) in ("-", "−"):
                d_adds = -d_adds
            if (gc.dice_adds(int(d_m.group(1)), d_adds)
                    != gc.dice_adds(dice, adds)):
                findings.append(("WARNING", locus,
                                 f"lists {d_m.group(0).strip()}, "
                                 f"{fm_m.group(0).strip()} resolves to "
                                 f"{gc.fmt_dice(dice, adds)} at ST {st}"))
        else:
            findings.append(("INFO", locus,
                             f"{fm_m.group(0).strip()} resolves to "
                             f"{gc.fmt_dice(dice, adds)} at ST {st}"))
    return findings


CHECKS = [
    ("attributes", check_attributes),
    ("encumbrance", check_encumbrance),
    ("load", check_load),
    ("defenses", check_defenses),
    ("points", check_points),
    ("damage", check_damage),
]


def emit(section, findings):
    print(f"[{section}]")
    print(f"# count: {len(findings)}")
    for level, locus, message in findings:
        print(f"{level}\t{locus}\t{message}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("sheet", type=Path)
    ap.add_argument("command", nargs="?", default="all",
                    choices=[name for name, _fn in CHECKS] + ["all"])
    args = ap.parse_args()
    try:
        text = args.sheet.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        print(f"error: cannot read {args.sheet}: {e}", file=sys.stderr)
        return 2
    sheet = Sheet(text)
    for name, fn in CHECKS:
        if args.command in (name, "all"):
            emit(name, fn(sheet))
    return 0


if __name__ == "__main__":
    sys.exit(main())
