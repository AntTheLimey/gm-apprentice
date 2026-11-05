#!/usr/bin/env python3
"""template_compare.py: what a vault's copy of a template and the plugin's
text each provide that the other does not.

Code produces the structure (frontmatter fields, headings, table rows, and
how many lines each shared section gained or lost); whoever shows it to
the GM phrases it. Library module, no CLI.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import asdict, dataclass, field

from vaultlib import fence_step

FIELD_RE = re.compile(r"^([A-Za-z_][\w-]*)[ \t]*:")
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t#]*$")
TABLE_RULE_RE = re.compile(r"^\|?[\s:|-]+\|?$")
PREAMBLE = ""   # the section before the first heading


@dataclass
class Comparison:
    fields_only_vault: list[str] = field(default_factory=list)
    fields_only_shipped: list[str] = field(default_factory=list)
    headings_only_vault: list[str] = field(default_factory=list)
    headings_only_shipped: list[str] = field(default_factory=list)
    table_rows_only_vault: list[str] = field(default_factory=list)
    table_rows_only_shipped: list[str] = field(default_factory=list)
    # frontmatter fields both texts hold whose values differ
    field_values_changed: list[str] = field(default_factory=list)
    # headings both texts hold at different levels
    heading_levels_changed: list[str] = field(default_factory=list)
    # (heading, lines only yours have, lines only the plugin's has), for a
    # heading both texts hold
    sections_changed: list[tuple[str, int, int]] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        """JSON-able: tuples become lists."""
        out = asdict(self)
        out["sections_changed"] = [list(s) for s in self.sections_changed]
        return out


@dataclass
class _Parts:
    fields: list[str]
    headings: list[str]
    rows: list[str]
    sections: dict[str, list[str]]
    values: dict[str, str]
    levels: dict[str, int]


def _squash(line: str) -> str:
    return " ".join(line.split())


def _parts(text: str) -> _Parts:
    lines = text.replace("\r\n", "\n").split("\n")
    fields: list[str] = []
    values: dict[str, str] = {}
    start = 0
    if lines and lines[0].rstrip() == "---":
        end = next((i for i in range(1, len(lines))
                    if lines[i].rstrip() == "---"), None)
        if end is not None:
            key = None
            for line in lines[1:end]:
                m = FIELD_RE.match(line)
                if m:
                    key = m.group(1) if m.group(1) not in fields else None
                    if key:
                        fields.append(key)
                        values[key] = _squash(line[m.end():])
                elif key:
                    values[key] = _squash(f"{values[key]} {line}")
            start = end + 1
    headings: list[str] = []
    rows: list[str] = []
    sections: dict[str, list[str]] = {PREAMBLE: []}
    current = PREAMBLE
    levels: dict[str, int] = {}
    fence: str | None = None
    for line in lines[start:]:
        fence, toggled = fence_step(line, fence)
        fenced = fence is not None or toggled
        heading = None if fenced else HEADING_RE.match(line)
        if heading:
            current = heading.group(2).strip()
            levels.setdefault(current, len(heading.group(1)))
            if current not in headings:
                headings.append(current)
            sections.setdefault(current, [])
            continue
        squashed = _squash(line)
        if not squashed:
            continue
        sections[current].append(squashed)
        if not fenced and squashed.startswith("|") \
                and not TABLE_RULE_RE.match(squashed) and squashed not in rows:
            rows.append(squashed)
    return _Parts(fields, headings, rows, sections, values, levels)


def _only(a: list[str], b: list[str]) -> list[str]:
    seen = set(b)
    return [x for x in a if x not in seen]


def compare(vault_text: str, shipped_text: str) -> Comparison:
    """What `vault_text` (the vault's copy) and `shipped_text` (the
    plugin's) each have that the other lacks."""
    mine, theirs = _parts(vault_text), _parts(shipped_text)
    changed: list[tuple[str, int, int]] = []
    for heading, ours in mine.sections.items():
        if heading not in theirs.sections:
            continue
        added = removed = 0
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(
                None, ours, theirs.sections[heading],
                autojunk=False).get_opcodes():
            if op != "equal":
                added += i2 - i1
                removed += j2 - j1
        if added or removed:
            changed.append((heading, added, removed))
    return Comparison(
        fields_only_vault=_only(mine.fields, theirs.fields),
        fields_only_shipped=_only(theirs.fields, mine.fields),
        headings_only_vault=_only(mine.headings, theirs.headings),
        headings_only_shipped=_only(theirs.headings, mine.headings),
        table_rows_only_vault=_only(mine.rows, theirs.rows),
        table_rows_only_shipped=_only(theirs.rows, mine.rows),
        field_values_changed=[f for f in mine.fields if f in theirs.values
                              and mine.values[f] != theirs.values[f]],
        heading_levels_changed=[h for h, n in mine.levels.items()
                                if h in theirs.levels and theirs.levels[h] != n],
        sections_changed=changed)


def _count(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _side(fields: int, headings: int, rows: int) -> str:
    parts = [_count(n, one, many) for n, one, many in (
        (fields, "field", "fields"), (headings, "heading", "headings"),
        (rows, "table row", "table rows")) if n]
    if not parts:
        return ""
    return parts[0] if len(parts) == 1 else \
        f"{', '.join(parts[:-1])} and {parts[-1]}"


def summary(c: Comparison) -> str:
    """One line of counts, never the text itself."""
    out: list[str] = []
    yours = _side(len(c.fields_only_vault), len(c.headings_only_vault),
                  len(c.table_rows_only_vault))
    theirs = _side(len(c.fields_only_shipped), len(c.headings_only_shipped),
                   len(c.table_rows_only_shipped))
    if yours:
        out.append(f"only yours has {yours}")
    if theirs:
        out.append(f"only the plugin's has {theirs}")
    if c.field_values_changed:
        out.append(f"{_count(len(c.field_values_changed), 'field has', 'fields have')} "
                   f"a different value")
    if c.heading_levels_changed:
        out.append(f"{_count(len(c.heading_levels_changed), 'heading sits', 'headings sit')} "
                   f"at a different level")
    if c.sections_changed:
        out.append(f"{_count(len(c.sections_changed), 'section reads', 'sections read')} "
                   f"differently")
    return "; ".join(out) if out else "they differ only in spacing or blank lines"
