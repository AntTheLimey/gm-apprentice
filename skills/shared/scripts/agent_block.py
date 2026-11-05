#!/usr/bin/env python3
"""agent_block.py: the plugin's block in a vault's CLAUDE.md and AGENTS.md.

A vault's agent reads its CLAUDE.md (or AGENTS.md) outside the plugin, so
the plugin keeps two lines there, between its own markers: run the update
when the version gate says MISMATCH, and record a stand-in for a plugin gap
as a workaround. Only the text between the markers is written; a file with
no block gets it at the end; a vault with neither file gets a CLAUDE.md
holding just the block. A BEGIN marker with no END after it is left alone
and said, since where the block ends is the GM's to fix.

`gma update` writes it as bookkeeping (migrate_vault's `agent-block`
check); the scaffold plans it for a new vault. Stdlib only.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from migrate_core import write_text_atomic
from vaultlib import agent_files
BEGIN = ("<!-- BEGIN gm-apprentice (managed by the plugin; edits here are "
         "replaced) -->")
BEGIN_PREFIX = "<!-- BEGIN gm-apprentice"   # an older BEGIN's words may differ
END = "<!-- END gm-apprentice -->"
GMA = 'python3 "<plugin>/skills/shared/scripts/gma.py"'
LINES = (
    f"- When a gm-apprentice skill's version gate says MISMATCH, run "
    f'`{GMA} update "<this vault>"`; `<plugin>` is the gm-apprentice '
    f"plugin's folder.",
    f"- When you build a stand-in for a plugin gap, record it with "
    f"`{GMA} workaround add` (see the plugin's "
    f"`skills/shared/filing-plugin-issues.md`).",
)


def block(eol: str = "\n") -> str:
    """The block, markers included, with no line end after the END."""
    return eol.join((BEGIN, *LINES, END))


@dataclass
class Change:
    rel: str
    text: str     # the file's new text
    said: str     # the report's line, past tense


def _eol(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def _bare(line: str) -> str:
    """A line as the markers are matched: no BOM, no spaces round it."""
    return line.lstrip("\ufeff").strip()


def refreshed(text: str) -> str | None:
    """`text` with the block written or refreshed; None when its BEGIN
    marker has no END after it. A BOM before the BEGIN marker is kept, and
    words after the BEGIN marker's `-->` are moved below the END."""
    eol = _eol(text)
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines)
                  if _bare(line).startswith(BEGIN_PREFIX)), None)
    if start is None:
        if not text.strip():
            return block(eol) + eol
        tail = "" if text.endswith(("\n", "\r")) else eol
        return text + tail + eol + block(eol) + eol
    end = next((i for i in range(start + 1, len(lines))
                if _bare(lines[i]) == END), None)
    if end is None:
        return None
    ending = lines[end][len(lines[end].rstrip("\r\n")):]
    marker = lines[start]
    bom = "\ufeff" if marker.startswith("\ufeff") else ""
    after = marker.partition("-->")[2].strip()
    moved = [after + ending] if after else []
    if after and not ending:   # the END was the file's last line
        ending = eol
    return "".join([*lines[:start], bom, block(eol), ending, *moved,
                    *lines[end + 1:]])


def missing_end(rel: str) -> str:
    return (f"{rel} has the gm-apprentice block's BEGIN marker but no "
            f"`{END}` after it, so it was left as it is. Fix it by hand: "
            f"add the END line where the block should stop, then run the "
            f"update again.")


def plan(vault: Path) -> tuple[list[Change], list[str]]:
    """What to write, and the files left alone with why."""
    changes: list[Change] = []
    problems: list[str] = []
    present = agent_files(vault)   # case-blind: `claude.md` is the one
    if not present:
        return [Change("CLAUDE.md", block() + "\n",
                       "Created CLAUDE.md holding the plugin's short "
                       "instructions for the vault's agent.")], []
    for rel in present:
        try:
            old = (vault / rel).read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as e:
            problems.append(f"{rel} could not be read ({e}); the plugin's "
                            f"block was not written to it.")
            continue
        new = refreshed(old)
        if new is None:
            problems.append(missing_end(rel))
        elif new != old:
            verb = "Refreshed" if BEGIN_PREFIX in old else "Added"
            changes.append(Change(rel, new,
                                  f"{verb} the plugin's short instructions "
                                  f"for the vault's agent in {rel}; nothing "
                                  f"outside its markers was touched."))
    return changes, problems


def write(vault: Path, changes: list[Change]) -> list[str]:
    for change in changes:
        write_text_atomic(vault / change.rel, change.text)
    return [c.said for c in changes]


def ensure_block(vault: Path) -> list[str]:
    """Write or refresh the block; the plain report lines, one per file
    written or left alone."""
    changes, problems = plan(vault)
    return write(vault, changes) + problems
