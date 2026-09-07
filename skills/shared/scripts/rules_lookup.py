#!/usr/bin/env python3
"""Record-level lookup over the ttrpg-expert systems corpus.

Answers a one-line rules question ("what does Combat Reflexes cost?")
from a single record instead of making the model read a 30 KB reference
file. Indexes every `skills/ttrpg-expert/systems/<system>/**/*.md` and
recognises the three shapes those files actually use:

  * pipe-table rows — the header row supplies the field names
  * bold-lead blocks — `**Name** | ...` or `- **Name** | ...`, the lead
    line plus its continuation lines
  * `### Title` stat blocks — the heading names the record, the
    paragraph under it is the record

Matching runs in tiers: exact (case-insensitive, also matching a name
whose trailing parenthetical is dropped, so "fast-draw" finds
"Fast-Draw (Sword)"), then substring, then a difflib near-miss fallback.

Usage:
  rules_lookup.py SYSTEM "term" [--kind K] [--variant V] [--limit N]
                  [--json] [--personal] [--systems-dir DIR]

SYSTEM is a system slug (`gurps-4e`) or `all`. Output is one
`name<TAB>system<TAB>kind<TAB>file:line<TAB>summary` row per record,
under a `# match: ...` header line; block records print their text
indented two spaces. A `--kind` filter that matches nothing falls back
to an unfiltered lookup and says so, rather than reporting "no such
rule". Exit 0 on a match, 1 on none, 2 on a bad invocation (blank term,
missing `--systems-dir`).

Copyright: this prints back only what the corpus files already contain,
one record at a time — never a whole table or file, and it writes
nothing to disk (no index, no cache). A blank term is rejected outright
rather than matching (and printing) the whole corpus. Files under
`personal/` are the user's private licensed copies and are skipped
unless `--personal` is passed explicitly.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

SYSTEMS_DIR = Path(__file__).resolve().parents[2] / "ttrpg-expert" / "systems"

# Prefix of a file stem -> the kind of record that file holds. Longest
# prefix wins; a stem with no mapped prefix is its own kind.
KIND_BY_STEM: dict[str, str] = {
    "traits": "trait",
    "skills": "skill",
    "spells": "spell",
    "monsters": "monster",
    "creatures": "monster",
    "animals": "monster",
    "feats": "feat",
    "equipment": "item",
    "magic-items": "item",
    "occupations": "class",
    "playbooks": "class",
    "classes": "class",
    "ancestries": "class",
    "conditions": "condition",
}

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
HEADING_RE = re.compile(r"^#{1,6}\s")
H3_RE = re.compile(r"^###\s+(.+?)\s*$")
BOLD_LEAD_RE = re.compile(r"^(?:- )?\*\*([^*]+)\*\*(?P<rest>.*)$")
# A bold lead introduces a record only when a column separator, a dash,
# the end of the line, or an optional parenthetical followed by one of
# those follows it (`**Spot Hidden** (25%) — ...`). A colon
# (`**XP trigger**:`) marks a label, not a record.
LEAD_TAIL_RE = re.compile(r"^\s*(?:\([^)]*\)\s*)?(?:[|—–]|--\s|$)")
SEPARATOR_CELL_RE = re.compile(r"^:?-+:?$")
TRAILING_TAG_RE = re.compile(r"\s*\[[^\[\]]*\]\s*$")
TRAILING_PAREN_RE = re.compile(r"\s*\([^()]*\)\s*$")

FUZZY_CUTOFF = 0.72


@dataclass
class Record:
    """One looked-up thing: a table row, a bold-lead block, or an H3 block."""

    name: str
    system: str
    kind: str
    file: str
    line: int
    headers: list[str] = field(default_factory=list)
    cells: list[str] = field(default_factory=list)
    text: str = ""
    # "table", "block" (text opens with the bold lead), or "heading"
    # (the `###` line names the record and text is the body).
    shape: str = "block"

    def summary(self) -> str:
        """A one-line gist: the row's fields, or the block's first body line."""
        if self.shape == "table":
            pairs = []
            for i in range(1, len(self.cells)):
                head = self.headers[i] if i < len(self.headers) else ""
                pairs.append(f"{head}={self.cells[i]}")
            return "; ".join(pairs)
        lines = self.text.split("\n")
        if self.shape == "block":
            return lines[1] if len(lines) > 1 else ""
        return lines[0] if lines else ""

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name, "system": self.system, "kind": self.kind,
            "file": self.file, "line": self.line, "headers": self.headers,
            "cells": self.cells, "text": self.text,
        }


def kind_for_stem(stem: str) -> str:
    for prefix in sorted(KIND_BY_STEM, key=len, reverse=True):
        if stem == prefix or stem.startswith(prefix + "-"):
            return KIND_BY_STEM[prefix]
    return stem


def clean_name(raw: str) -> str:
    """Strip bold markers and trailing `[ORC]`-style provenance tags."""
    name = raw.strip().strip("*").strip()
    while True:
        trimmed = TRAILING_TAG_RE.sub("", name)
        if trimmed == name or not trimmed:
            break
        name = trimmed
    return name


def split_cells(line: str) -> list[str]:
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [cell.strip() for cell in body.split("|")]


def is_separator_row(cells: list[str]) -> bool:
    filled = [c for c in cells if c]
    return bool(filled) and all(SEPARATOR_CELL_RE.match(c) for c in filled)


def system_slug(rel_parts: tuple[str, ...]) -> str:
    """`coc-7e/variants/regency/skills.md` -> `coc-7e/regency`."""
    if len(rel_parts) >= 3 and rel_parts[1] == "variants":
        return f"{rel_parts[0]}/{rel_parts[2]}"
    return rel_parts[0]


def parse_file(path: Path, system: str, rel: str) -> list[Record]:
    """One pass over one file, emitting every record shape it contains."""
    kind = kind_for_stem(path.stem)
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    records: list[Record] = []

    def add(name: str, line_no: int, shape: str, text: str,
            headers: list[str] | None = None,
            cells: list[str] | None = None) -> None:
        if name:
            records.append(Record(
                name=name, system=system, kind=kind, file=rel, line=line_no,
                headers=headers or [], cells=cells or [], text=text,
                shape=shape))

    in_fence = False
    headers: list[str] = []
    pending_header: list[str] | None = None
    in_table = False

    for i, line in enumerate(lines):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        if line.strip().startswith("|"):
            cells = split_cells(line)
            if is_separator_row(cells):
                if pending_header:
                    headers = [c.strip("*").strip() for c in pending_header]
                    in_table = True
                pending_header = None
            elif in_table:
                if cells and cells[0]:
                    add(clean_name(cells[0]), i + 1, "table", line.rstrip(),
                        headers, cells)
            else:
                pending_header = cells
            continue

        headers, pending_header, in_table = [], None, False

        heading = H3_RE.match(line)
        if heading:
            body = _h3_body(lines, i)
            if body:
                add(clean_name(heading.group(1)), i + 1, "heading",
                    "\n".join(body))
            continue

        lead = BOLD_LEAD_RE.match(line)
        if lead and LEAD_TAIL_RE.match(lead.group("rest")):
            block = _bold_block(lines, i)
            add(clean_name(lead.group(1)), i + 1, "block", "\n".join(block))

    return records


def _stops_block(line: str) -> bool:
    if HEADING_RE.match(line) or FENCE_RE.match(line):
        return True
    if line.strip().startswith("|"):
        return True
    lead = BOLD_LEAD_RE.match(line)
    return bool(lead and LEAD_TAIL_RE.match(lead.group("rest")))


def _bold_block(lines: list[str], start: int) -> list[str]:
    """Lead line plus continuations: to a blank line, the next record, or
    12 lines, whichever comes first."""
    block = [lines[start].rstrip()]
    for line in lines[start + 1:]:
        if len(block) >= 12 or not line.strip() or _stops_block(line):
            break
        block.append(line.rstrip())
    return block


def _h3_body(lines: list[str], start: int) -> list[str]:
    """Body of a `### Title` record, or empty if the heading only
    introduces a table or another heading."""
    first = start + 1
    while first < len(lines) and not lines[first].strip():
        first += 1
    if first >= len(lines):
        return []
    opener = lines[first]
    if HEADING_RE.match(opener) or opener.strip().startswith("|"):
        return []

    body: list[str] = []
    for line in lines[first:]:
        if HEADING_RE.match(line) or FENCE_RE.match(line):
            break
        if line.strip().startswith("|"):
            break
        if not line.strip() and len(body) >= 15:
            break
        body.append(line.rstrip())
    while body and not body[-1]:
        body.pop()
    return body


def iter_records(systems_dir: Path = SYSTEMS_DIR, *, personal: bool = False,
                 systems: Iterable[str] | None = None) -> Iterator[Record]:
    """Every record under `systems_dir`, in file order then line order."""
    if not systems_dir.is_dir():
        return
    wanted = set(systems) if systems is not None else None
    for path in sorted(systems_dir.rglob("*.md")):
        rel_parts = path.relative_to(systems_dir).parts
        if len(rel_parts) < 2:
            continue  # a loose file such as shared-patterns.md
        if wanted is not None and rel_parts[0] not in wanted:
            continue
        if not personal and "personal" in rel_parts[:-1]:
            continue
        rel = "/".join(rel_parts)
        yield from parse_file(path, system_slug(rel_parts), rel)


def _sort_key(rec: Record) -> tuple[str, str, int]:
    return (rec.system, rec.file, rec.line)


def _matches_filters(rec: Record, system: str | None, kind: str | None,
                     variant: str | None) -> bool:
    base, _, rec_variant = rec.system.partition("/")
    if rec_variant and rec_variant != variant:
        return False
    if system is not None and rec.system != system and base != system:
        return False
    if kind is not None and rec.kind != kind:
        return False
    return True


def lookup(term: str, *, system: str | None = None, kind: str | None = None,
           variant: str | None = None, limit: int = 10,
           personal: bool = False,
           systems_dir: Path = SYSTEMS_DIR
           ) -> tuple[str, list[Record], int]:
    """Find `term`, best tier first. Returns (match_mode, records, total)
    where `total` is the number of records at the reported tier before
    `--limit` truncates the list — so a caller can tell "5 shown" from
    "5 shown of 40 found".

    A blank (or all-whitespace) term matches nothing: an empty needle is
    a substring of every record name, which would otherwise dump close
    to the whole corpus — the opposite of this module's one-record-at-a-
    time copyright guard.
    """
    if not term.strip():
        return "none", [], 0
    needle = term.casefold()
    systems = [system.split("/")[0]] if system else None
    candidates = [rec for rec in iter_records(systems_dir, personal=personal,
                                              systems=systems)
                  if _matches_filters(rec, system, kind, variant)]

    exact: list[Record] = []
    substring: list[Record] = []
    for rec in candidates:
        folded = rec.name.casefold()
        if folded == needle or TRAILING_PAREN_RE.sub("", folded) == needle:
            exact.append(rec)
        elif needle in folded:
            substring.append(rec)

    # Tiers are exclusive: a hit in a higher tier stops the lower ones
    # from being reported at all, so "exact (N)" never silently counts
    # substring rows in N (#M4).
    if exact:
        hits = sorted(exact, key=_sort_key)
        return "exact", hits[:limit], len(hits)
    if substring:
        hits = sorted(substring, key=_sort_key)
        return "substring", hits[:limit], len(hits)

    names = sorted({rec.name.casefold() for rec in candidates})
    close = difflib.get_close_matches(needle, names, n=limit,
                                      cutoff=FUZZY_CUTOFF)
    if not close:
        return "none", [], 0
    rank = {name: i for i, name in enumerate(close)}
    fuzzy = [rec for rec in candidates if rec.name.casefold() in rank]
    fuzzy.sort(key=lambda rec: (rank[rec.name.casefold()], _sort_key(rec)))
    return "fuzzy", fuzzy[:limit], len(fuzzy)


def render(mode: str, records: list[Record], *, total: int = 0,
          kind: str | None = None, fallback: list[Record] | None = None
          ) -> str:
    if mode == "none":
        if kind and fallback:
            out = [f"# match: none for kind={kind} — closest without it:"]
            records = fallback
        else:
            return "# match: none"
    elif mode == "fuzzy":
        out = ["# match: fuzzy — no exact hit, closest:"]
    else:
        header = f"# match: {mode} ({total})"
        if total > len(records):
            header += (f" — showing {len(records)}, "
                      f"{total - len(records)} suppressed by --limit")
        out = [header]
    for rec in records:
        out.append("\t".join([rec.name, rec.system, rec.kind,
                              f"{rec.file}:{rec.line}", rec.summary()]))
        if rec.shape != "table":
            out.extend("  " + line for line in rec.text.split("\n"))
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Look up one rules record in the systems corpus.")
    parser.add_argument("system", help="system slug, or 'all'")
    parser.add_argument("term", help="name to look up")
    parser.add_argument("--kind", help="restrict to one record kind")
    parser.add_argument("--variant", help="include this variant's records")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--json", action="store_true",
                        help="emit the records as JSON instead of rows")
    parser.add_argument("--personal", action="store_true",
                        help="also read the gitignored personal/ files")
    parser.add_argument("--systems-dir", type=Path, default=SYSTEMS_DIR)
    args = parser.parse_args(argv)

    if not args.systems_dir.is_dir():
        print(f"error: no systems directory at {args.systems_dir}",
              file=sys.stderr)
        return 2
    if not args.term.strip():
        print("error: blank lookup term", file=sys.stderr)
        return 2

    system = None if args.system == "all" else args.system
    mode, records, total = lookup(
        args.term, system=system, kind=args.kind, variant=args.variant,
        limit=args.limit, personal=args.personal,
        systems_dir=args.systems_dir)

    fallback: list[Record] = []
    if mode == "none" and args.kind:
        _, fallback, _ = lookup(
            args.term, system=system, kind=None, variant=args.variant,
            limit=args.limit, personal=args.personal,
            systems_dir=args.systems_dir)

    if args.json:
        print(json.dumps([rec.as_dict() for rec in records], indent=2))
    else:
        print(render(mode, records, total=total, kind=args.kind,
                     fallback=fallback))
    return 0 if records else 1


if __name__ == "__main__":
    sys.exit(main())
