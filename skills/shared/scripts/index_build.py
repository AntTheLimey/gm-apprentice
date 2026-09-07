#!/usr/bin/env python3
"""Derive `_meta/index.md` from a vault scan.

`_meta/index.md` declares itself derived ("if stale, delete and rebuild")
but nothing has derived it — it gets hand-edited and drifts. This script
renders it fresh from the vault's own frontmatter, matching the shape in
`skills/campaign-organizer/references/index-template.md`.

It is a one-way companion to `vault_check.py check_index`, which is the
drift *detector*: this script does not import that module (and must not),
but the two are designed to agree on what counts as indexable content —
`_`-prefixed top-level directories and `SKIP_DIRS` are infrastructure, not
content, in both places.

Usage:
  index_build.py VAULT [--write] [--date YYYY-MM-DD]

Default prints a unified diff between the current `_meta/index.md` and
the freshly rendered text (or the whole rendered text if no index exists
yet), followed by a `# entities: N  narrative: M  stubs: K` summary line.
`--write` applies the rendered text, preserving the existing file's line
endings (LF for a new file). Read-only otherwise. Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime
import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from vaultlib import (
    chapter_key,
    chapter_of,
    entity_type,
    extract_frontmatter,
    section,
    vault_files,
)

# type -> (H2/H3 section title, subgroup label | "" for no subgroup).
SECTION_FOR_TYPE: dict[str, tuple[str, str]] = {
    "pc": ("Characters", "PCs"),
    "npc": ("Characters", "NPCs"),
    "location": ("Locations", ""),
    "faction": ("Factions & Organizations", ""),
    "organization": ("Factions & Organizations", ""),
    "item": ("Items & Artifacts", ""),
    "artifact": ("Items & Artifacts", ""),
    "creature": ("Creatures", ""),
    "monster": ("Creatures", ""),
    "event": ("Events", ""),
    "document": ("Documents", ""),
    "handout": ("Documents", ""),
    "clue": ("Clues", ""),
}

# Fixed section order for the types that have their own template heading.
# A type outside SECTION_FOR_TYPE falls into "Other", subgrouped by type.
SECTION_ORDER = ["Characters", "Locations", "Factions & Organizations",
                  "Items & Artifacts", "Creatures", "Events", "Documents",
                  "Clues"]

NARRATIVE_TYPES = {"chapter", "session", "scene"}

# Plan entities and session-chain docs are not index entries — the
# template lists none of them.
SKIP_TYPES = {"meta", "campaign_overview", "session-plan",
              "session-play-notes", "plan"}

# Statuses that make a session worth surfacing under "Active Session".
ACTIVE_SESSION_STATUSES = {"planned", "prepped"}

DESCRIPTOR_FIELDS = ("description", "summary", "role", "occupation", "tagline")
DESCRIPTOR_MAX = 80
RECENT_CHANGES_CAP = 20


@dataclass
class Entry:
    rel: str
    stem: str
    type: str
    descriptor: str
    stub_needs: str | None


class ChapterRecord(TypedDict):
    stem: str
    status: str
    sessions: int
    scenes: int
    active: list[tuple[str, str, str]]
    all_sessions: list[tuple[str, str]]
    all_scenes: list[tuple[str, str]]


def _new_chapter_record() -> ChapterRecord:
    return {
        "stem": "",
        "status": "",
        "sessions": 0,
        "scenes": 0,
        "active": [],
        "all_sessions": [],
        "all_scenes": [],
    }


def descriptor_of(fm: dict[str, object], text: str) -> str:
    """First non-empty scalar among description/summary/role/occupation/
    tagline, reduced to its first sentence, flattened, and capped at
    `DESCRIPTOR_MAX` characters. "" when none of those fields are set.

    `text` is accepted for interface symmetry with the other per-file
    readers in this module (all take the raw file text); the descriptor
    itself never falls back to body prose — an entity with no descriptor
    field renders with no descriptor, rather than guessing one.
    """
    for key in DESCRIPTOR_FIELDS:
        value = fm.get(key)
        if isinstance(value, str) and value.strip():
            flat = " ".join(value.split())
            m = re.match(r"^(.*?[.!?])(?:\s|$)", flat)
            first = m.group(1) if m else flat
            return first[:DESCRIPTOR_MAX]
    return ""


def _stub_needs(fm: dict[str, object], text: str, ftype: str) -> str | None:
    """What a Stubs-section entry needs, or None when the entry isn't one.

    A `canon_status: STUB` entity needs whatever its first `## Needs`
    bullet says (or "unspecified" when there isn't one); a file with no
    usable `type:` needs the type field itself.
    """
    if fm.get("canon_status") == "STUB":
        block = section(text, "Needs")
        if block:
            for line in block.splitlines():
                stripped = line.strip()
                if stripped.startswith("- "):
                    return stripped[2:].strip()
        return "unspecified"
    if not ftype:
        return "type field"
    return None


def _iter_content(vault: Path) -> list[tuple[str, str, dict[str, object], str]]:
    """(rel, text, frontmatter, stem) for every file `collect` considers.

    Excludes `vault_files`'s own `SKIP_DIRS`/hidden-dir skips (applied
    already), every `_`-prefixed top-level directory — infrastructure,
    not content, matching `vault_check.check_index`'s definition — and
    `*_Story.md` companion pages, which are narrative history, not index
    entries.
    """
    out = []
    for rel, text in vault_files(vault):
        top = rel.split("/", 1)[0]
        if top.startswith("_"):
            continue
        stem = Path(rel).stem
        if stem.endswith("_Story"):
            continue
        fm = extract_frontmatter(text) or {}
        out.append((rel, text, fm, stem))
    return out


def collect(vault: Path) -> tuple[list[Entry], list[ChapterRecord]]:
    """Scan `vault` into entity entries and per-chapter narrative records.

    Chapters are registered first so a session or scene processed before
    its chapter file (alphabetically, sessions can sort earlier) still
    finds the chapter's own display stem and status. Sessions and scenes
    are attributed to a chapter by `chapter_key` equality; one that
    resolves to no chapter at all is not counted anywhere.
    """
    files = _iter_content(vault)
    chapters: dict[str, ChapterRecord] = {}

    for rel, _text, fm, stem in files:
        if entity_type(fm) != "chapter":
            continue
        key = chapter_key(rel, fm) or stem.casefold()
        record = chapters.setdefault(key, _new_chapter_record())
        record["stem"] = stem
        status = fm.get("status")
        record["status"] = status if isinstance(status, str) else ""

    entries: list[Entry] = []
    for rel, text, fm, stem in files:
        ftype = entity_type(fm)
        if ftype == "chapter":
            continue
        if ftype in NARRATIVE_TYPES:  # session, scene
            session_key = chapter_key(rel, fm)
            if session_key is None:
                continue
            record = chapters.setdefault(session_key, _new_chapter_record())
            status_raw = fm.get("status")
            status = status_raw if isinstance(status_raw, str) else ""
            chapter_stem = (record["stem"] or chapter_of(rel, fm)
                            or session_key)
            if ftype == "session":
                record["sessions"] += 1
                record["all_sessions"].append((stem, status))
                if status in ACTIVE_SESSION_STATUSES:
                    record["active"].append((stem, chapter_stem, status))
            else:
                record["scenes"] += 1
                record["all_scenes"].append((stem, status))
            continue
        if ftype in SKIP_TYPES:
            continue
        entries.append(Entry(
            rel=rel, stem=stem, type=ftype,
            descriptor=descriptor_of(fm, text),
            stub_needs=_stub_needs(fm, text, ftype),
        ))

    entries.sort(key=lambda e: e.stem.casefold())
    chapter_list = sorted(chapters.values(),
                          key=lambda c: c["stem"].casefold())
    return entries, chapter_list


def _counts(entries: list[Entry],
           chapters: list[ChapterRecord]) -> tuple[int, int, int]:
    """(entity_count, narrative_count, stub_count)."""
    typed = sum(1 for e in entries if e.type)
    narrative = (len(chapters)
                + sum(c["sessions"] for c in chapters)
                + sum(c["scenes"] for c in chapters))
    stubs = sum(1 for e in entries if e.stub_needs is not None)
    return typed, narrative, stubs


def _section_for(etype: str) -> tuple[str, str]:
    if etype in SECTION_FOR_TYPE:
        return SECTION_FOR_TYPE[etype]
    return ("Other", etype)


def _entry_line(entry: Entry) -> str:
    if entry.descriptor:
        return f"- [[{entry.stem}]] — {entry.descriptor}"
    return f"- [[{entry.stem}]]"


def _recent_changes_lines(previous: str) -> list[str]:
    block = section(previous, "Recent Changes")
    if not block:
        return []
    return [line.rstrip() for line in block.splitlines()
           if line.strip().startswith("- ")]


def render(vault: Path, *, today: str, previous: str | None) -> str:
    """The full rendered `_meta/index.md` text for `vault`."""
    entries, chapters = collect(vault)
    entity_count, narrative_count, stub_count = _counts(entries, chapters)
    typed_entries = [e for e in entries if e.type]
    stub_entries = [e for e in entries if e.stub_needs is not None]

    lines: list[str] = [
        "---",
        "type: meta",
        "purpose: vault-index",
        f"last_updated: {today}",
        f"entity_count: {entity_count}",
        f"narrative_count: {narrative_count}",
        f"stub_count: {stub_count}",
        "---",
        "",
        "## Narrative Structure",
    ]

    if chapters:
        lines.append("")
        lines.append("### Chapters")
        for chapter in chapters:
            lines.append(
                f"- [[{chapter['stem']}]] (sessions: {chapter['sessions']}, "
                f"scenes: {chapter['scenes']}, status: {chapter['status']})")
            for sess_stem, sess_status in chapter["all_sessions"]:
                lines.append(f"  - [[{sess_stem}]] (status: {sess_status})")
            for scene_stem, scene_status in chapter["all_scenes"]:
                lines.append(f"  - [[{scene_stem}]] (status: {scene_status})")

    active = [a for chapter in chapters for a in chapter["active"]]
    if active:
        lines.append("")
        lines.append("### Active Session")
        for stem, chapter_stem, status in active:
            lines.append(
                f"- [[{stem}]] (chapter: {chapter_stem}, status: {status})")

    lines.append("")
    lines.append("## Entities by Type")

    buckets: dict[str, dict[str, list[Entry]]] = {}
    for entry in typed_entries:
        title, sub = _section_for(entry.type)
        buckets.setdefault(title, {}).setdefault(sub, []).append(entry)
    for type_groups in buckets.values():
        for group in type_groups.values():
            group.sort(key=lambda e: e.stem.casefold())

    for title in SECTION_ORDER:
        subs = buckets.get(title)
        if not subs:
            continue
        if title == "Characters":
            lines.append("")
            lines.append("### Characters")
            for sub in ("PCs", "NPCs"):
                items = subs.get(sub, [])
                if not items:
                    continue
                lines.append("")
                lines.append(f"**{sub} ({len(items)}):**")
                lines.extend(_entry_line(e) for e in items)
        else:
            items = subs.get("", [])
            if not items:
                continue
            lines.append("")
            lines.append(f"### {title} ({len(items)})")
            lines.extend(_entry_line(e) for e in items)

    if "Other" in buckets:
        lines.append("")
        lines.append("### Other")
        for sub in sorted(buckets["Other"]):
            items = buckets["Other"][sub]
            if not items:
                continue
            lines.append("")
            lines.append(f"**{sub} ({len(items)}):**")
            lines.extend(_entry_line(e) for e in items)

    lines.append("")
    lines.append("## Stubs (Needs Attention)")
    stub_typed = sorted((e for e in stub_entries if e.type),
                        key=lambda e: e.stem.casefold())
    stub_untyped = sorted((e for e in stub_entries if not e.type),
                          key=lambda e: e.stem.casefold())
    for entry in stub_typed:
        lines.append(f"- [[{entry.stem}]] — type: {entry.type}, "
                     f"needs: {entry.stub_needs}")
    for entry in stub_untyped:
        lines.append(f"- [[{entry.stem}]] — type: (none), needs: "
                     f"{entry.stub_needs}")

    lines.append("")
    lines.append("## Recent Changes")
    rebuilt_line = (f"- {today}: index rebuilt — {entity_count} entities, "
                    f"{narrative_count} narrative, {stub_count} stubs")
    changes = [rebuilt_line]
    if previous:
        seen = {rebuilt_line}
        for prev_line in _recent_changes_lines(previous):
            if len(changes) >= RECENT_CHANGES_CAP:
                break
            if prev_line in seen:
                continue
            changes.append(prev_line)
            seen.add(prev_line)
    lines.extend(changes)
    lines.append("")

    return "\n".join(lines)


def _read_existing(index_path: Path) -> tuple[str, str]:
    """(text with LF line endings, the file's own EOL) for `index_path`."""
    raw = index_path.read_bytes()
    eol = "\r\n" if b"\r\n" in raw else "\n"
    text = raw.decode("utf-8", errors="replace")
    if eol == "\r\n":
        text = text.replace("\r\n", "\n")
    return text, eol


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Derive _meta/index.md from a vault scan.")
    parser.add_argument("vault", type=Path)
    parser.add_argument("--write", action="store_true",
                        help="apply the rendered index (default: dry run)")
    parser.add_argument("--date", help="override today's date (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    vault: Path = args.vault
    index_path = vault / "_meta" / "index.md"
    today = args.date or datetime.date.today().isoformat()

    previous: str | None = None
    eol = "\n"
    if index_path.is_file():
        previous, eol = _read_existing(index_path)

    rendered = render(vault, today=today, previous=previous)
    entries, chapters = collect(vault)
    entity_count, narrative_count, stub_count = _counts(entries, chapters)
    count_line = (f"# entities: {entity_count}  narrative: {narrative_count}"
                 f"  stubs: {stub_count}")

    if args.write:
        out = rendered if eol == "\n" else rendered.replace("\n", eol)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        with open(index_path, "w", encoding="utf-8", newline="") as f:
            f.write(out)
        print(count_line)
        return 0

    if previous is None:
        sys.stdout.write(rendered)
    else:
        diff = difflib.unified_diff(
            previous.splitlines(keepends=True),
            rendered.splitlines(keepends=True),
            fromfile=str(index_path), tofile=str(index_path))
        sys.stdout.writelines(diff)
    print(count_line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
