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
