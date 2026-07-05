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
