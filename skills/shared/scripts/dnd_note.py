#!/usr/bin/env python3
"""Read a D&D 5e (2024) PC note: its tables, labelled lines and cells.

Shared by dnd_sheet.py (fills the sums) and dnd_rules.py (checks for
slips) so both read a note the same way. No judgement here. Stdlib only.
"""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaultlib import fence_step  # noqa: E402

BOLD_LINE = re.compile(r"^\*\*([^*:]+):\*\*\s*(.*)$")

HEADING = re.compile(r"^(#{2,3})\s+(.+?)\s*#*\s*$")
SEPARATOR = re.compile(r"^:?-{2,}:?$")
BARE = re.compile(r"^[+\-−]?\d+$")
REASONED = re.compile(r"^([+\-−]?\d+)\s*\(.+\)$")
PLACEHOLDER = re.compile(r"^\{[^}]*\}$")
YES = re.compile(r"^(yes|y|true|x|\[x\]|✓|✔|●|1|p|prof|proficient|e|expert|expertise)$", re.I)
HALF = re.compile(r"^half$", re.I)


@dataclass
class Cell:
    line: int          # index into the note's lines
    col: int           # index into the row's cells
    text: str



def split_cells(line: str) -> list[str]:
    """Cells of a `| a | b |` line, honouring `\\|`."""
    inner = line.strip()
    inner = inner[1:] if inner.startswith("|") else inner
    inner = inner[:-1] if inner.endswith("|") and not inner.endswith("\\|") else inner
    return [c.strip() for c in re.split(r"(?<!\\)\|", inner)]


def read_tables(lines: list[str], second: dict | None = None) -> dict[tuple[str, str], list[tuple[int, list[str], list[str]]]]:
    """(h2, h3) lower-cased -> [(line index, header cells, row cells)] for the
    first table under that heading. Frontmatter and fenced code are skipped.
    A later table under the same heading is not read; `second`, when given,
    gets its key -> the heading as written."""
    out: dict = {}
    h2 = h3 = ""
    raw2 = raw3 = ""
    header: list[str] | None = None
    closed: set = set()
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
        if m:
            if len(m.group(1)) == 2:
                h2, h3 = m.group(2).strip().lower(), ""
                raw2, raw3 = m.group(2).strip(), ""
            else:
                h3 = m.group(2).strip().lower()
                raw3 = m.group(2).strip()
            header = None
            continue
        key = (h2, h3)
        if s.startswith("|") and key in closed:
            if second is not None:
                second.setdefault(key, raw3 or raw2)
        elif s.startswith("|"):
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


def plain_name(text: str) -> str:
    """A cell's name without wikilink brackets: `[[Rope\\|rope]]` -> `rope`."""
    return re.sub(r"\[\[(?:[^\]|\\]*\\?\|)?([^\]]*)\]\]", r"\1", text).strip()


def clean(text: str) -> str:
    """A label as a name: wikilink brackets and bold or italic marks removed."""
    return re.sub(r"^[*_]+|[*_]+$", "", plain_name(text).strip()).strip()


def number(text: str) -> tuple[int | None, bool]:
    """(value, has a reason) for `5`, `+5` or `5 (ring)`; (None, False) otherwise."""
    t = text.strip()
    m = REASONED.match(t)
    if m:
        return to_int(m.group(1)), True
    return to_int(t), False


class Note:
    """A PC note's tables and labelled lines, read once."""

    def __init__(self, text: str):
        self.lines = text.splitlines()
        self.second: dict = {}
        self.tables = read_tables(self.lines, self.second)

    def table(self, h2: str, h3: str = "") -> list[tuple[int, list[str], list[str]]]:
        return self.tables.get((h2, h3), [])

    def attr(self, h2: str, h3: str, label: str) -> Cell | None:
        for i, _header, cells in self.table(h2, h3):
            if cells and clean(cells[0]).lower() == label and len(cells) > 1:
                return Cell(i, 1, cells[1])
        return None

    def bold(self, label: str) -> str | None:
        """The text after the first `**Label:**` line outside frontmatter and code."""
        found = self.bold_at(label)
        return found[1] if found else None

    def bold_at(self, label: str) -> tuple[int, str] | None:
        """(line index, text) of the first `**Label:**` line outside frontmatter and code."""
        in_fm = bool(self.lines) and self.lines[0].strip() == "---"
        fence: str | None = None
        for i, raw in enumerate(self.lines):
            s = raw.strip()
            if in_fm:
                if i > 0 and s == "---":
                    in_fm = False
                continue
            fence, is_fence_line = fence_step(raw, fence)
            if is_fence_line or fence is not None:
                continue
            m = BOLD_LINE.match(s)
            if m and m.group(1).strip().lower() == label:
                return i, m.group(2).strip()
        return None
