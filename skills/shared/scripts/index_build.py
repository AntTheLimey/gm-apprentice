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
content, in both places. `check_index` requires every other `.md` file to
be referenced by its own stem or an `aliases:` entry, so this generator
links everything it finds a place for: chapters, every session and scene
(nested under its chapter), every session-chain document (nested under
its session), every `*_Story.md` companion (nested under its PC), and
every `type: plan` entity (its own section). A document this script
cannot place — a session-chain doc with no matching session, a Story
file with no matching PC — is not silently dropped; it surfaces in
`## Stubs (Needs Attention)` instead, still linked, so the round trip
against `check_index` holds even for content the generator can't file
anywhere sensible.

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
    WRAP_UP_TYPES,
    chapter_key,
    chapter_of,
    entity_type,
    extract_frontmatter,
    nested_mapping,
    normalize,
    parse_session_number,
    section,
    vault_files,
    wikilink_target,
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

# Session-chain documents: nest under their session in the Chapters
# section, or fall to Stubs when no session claims them.
CHAIN_TYPES: set[str] = {"session-plan", "session-play-notes", *WRAP_UP_TYPES}
CHAIN_ORDER = ["plan", "play notes", "wrap-up"]

# Types that are narrative apparatus, not domain entities: never counted
# in entity_count and never bucketed into "Entities by Type". Plans get
# their own "### Plans" section; chain docs and Story companions nest
# under a session/PC when matched, or fall to Stubs when they don't.
NARRATIVE_ADJACENT_TYPES: set[str] = CHAIN_TYPES | {"plan", "character-story"}

# Same exclusion, extended to chapter/session/scene: those are ordinarily
# folded into `chapters`, never into `entries` — but a flat-vault session
# or scene that resolves to no chapter still becomes an `Entry` so it can
# surface in Stubs (#C2), and it must not then double as a domain entity.
NON_ENTITY_TYPES: set[str] = NARRATIVE_ADJACENT_TYPES | NARRATIVE_TYPES

# Meta/overview documents are not index entries — the template lists
# none of them. (Session-chain docs, Story companions, and plans used to
# be skipped outright too; they now get placed instead — see above.)
SKIP_TYPES = {"meta", "campaign_overview"}

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
    # Set only on a `pc` entry that has a matching `*_Story.md` companion;
    # `render` nests it directly under the PC's own line.
    story_stem: str | None = None
    # True only for a chain-doc/Story `Entry` created purely to surface a
    # `canon_status: STUB` flag on a document that *is* otherwise placed
    # (nested under its session or PC) — so counting code doesn't also
    # treat it as an orphan (#M12).
    already_placed: bool = False


class SessionEntry(TypedDict):
    stem: str
    status: str
    # (label, stem) pairs — "plan"/"play notes"/"wrap-up" — for whichever
    # session-chain documents matched this session.
    chain: list[tuple[str, str]]


class ChapterRecord(TypedDict):
    stem: str
    status: str
    sessions: int
    scenes: int
    active: list[tuple[str, str, str]]
    all_sessions: list[SessionEntry]
    all_scenes: list[tuple[str, str]]


@dataclass
class _SessionFile:
    """Internal — a session found during `collect`, kept around so a
    session-chain document processed later in the same pass can be
    matched and attached to its `SessionEntry` in place."""
    stem: str
    chapter_key: str
    number: int | None
    documents_targets: set[str]
    entry: SessionEntry


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


def _chain_label(ftype: str) -> str:
    if ftype == "session-plan":
        return "plan"
    if ftype == "session-play-notes":
        return "play notes"
    return "wrap-up"  # one of WRAP_UP_TYPES


def _documents_targets(text: str) -> set[str]:
    """Normalized wikilink targets named in a session's own `documents:`
    block — the fallback a session-chain doc is matched against when its
    own `session:` field doesn't resolve to a number."""
    targets = set()
    for value in nested_mapping(text, "documents").values():
        target = wikilink_target(value)
        if target:
            targets.add(normalize(target))
    return targets


def _iter_content(vault: Path) -> list[tuple[str, str, dict[str, object], str]]:
    """(rel, text, frontmatter, stem) for every file `collect` considers.

    Excludes `vault_files`'s own `SKIP_DIRS`/hidden-dir skips (applied
    already) and every `_`-prefixed top-level directory — infrastructure,
    not content, matching `vault_check.check_index`'s definition. Nothing
    else is filtered here: `*_Story.md` companions, session-chain docs,
    and plans are all still content that must end up referenced
    somewhere in the rendered index.
    """
    out = []
    for rel, text in vault_files(vault):
        top = rel.split("/", 1)[0]
        if top.startswith("_"):
            continue
        stem = Path(rel).stem
        fm = extract_frontmatter(text) or {}
        out.append((rel, text, fm, stem))
    return out


def collect(vault: Path) -> tuple[list[Entry], list[ChapterRecord]]:
    """Scan `vault` into entity entries and per-chapter narrative records.

    Chapters are registered first so a session or scene processed before
    its chapter file (alphabetically, sessions can sort earlier) still
    finds the chapter's own display stem and status. Sessions and scenes
    are attributed to a chapter by `chapter_key` equality; one that
    resolves to no chapter at all (a flat vault, with no `Chapters/`
    folder and no `chapter:` link) becomes a Stubs-section `Entry`
    instead, needing "chapter link".

    Session-chain documents (session-plan, session-play-notes, any
    `WRAP_UP_TYPES` spelling) and `*_Story.md` companions are matched to
    their session/PC in a second pass, once every session and PC entry
    is known; an unmatched one becomes a Stubs-section `Entry` instead
    of being dropped, so `check_index`'s "every file is referenced"
    requirement still holds. A matched one that still carries
    `canon_status: STUB` gets an additional, `already_placed` `Entry` so
    that flag also reaches Stubs, without being double-counted as an
    orphan.
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
    session_files: list[_SessionFile] = []
    chain_docs: list[tuple[str, str, dict[str, object], str, str]] = []
    story_files: list[tuple[str, str, dict[str, object], str]] = []

    for rel, text, fm, stem in files:
        ftype = entity_type(fm)
        if ftype == "chapter":
            continue
        if stem.endswith("_Story"):
            story_files.append((rel, stem, fm, text))
            continue
        if ftype in NARRATIVE_TYPES:  # session, scene
            session_key = chapter_key(rel, fm)
            if session_key is None:
                # A flat vault (no Chapters/ folder, no `chapter:` link) has
                # no chapter to nest this under. Not silently dropped: it
                # surfaces in Stubs, same as an orphaned chain doc (#C2).
                entries.append(Entry(rel=rel, stem=stem, type=ftype,
                                     descriptor="", stub_needs="chapter link"))
                continue
            record = chapters.setdefault(session_key, _new_chapter_record())
            status_raw = fm.get("status")
            status = status_raw if isinstance(status_raw, str) else ""
            chapter_stem = (record["stem"] or chapter_of(rel, fm)
                            or session_key)
            if ftype == "session":
                record["sessions"] += 1
                session_entry: SessionEntry = {
                    "stem": stem, "status": status, "chain": []}
                record["all_sessions"].append(session_entry)
                session_files.append(_SessionFile(
                    stem=stem, chapter_key=session_key,
                    number=parse_session_number(fm.get("session_number")),
                    documents_targets=_documents_targets(text),
                    entry=session_entry))
                if status in ACTIVE_SESSION_STATUSES:
                    record["active"].append((stem, chapter_stem, status))
            else:
                record["scenes"] += 1
                record["all_scenes"].append((stem, status))
            continue
        if ftype in CHAIN_TYPES:
            chain_docs.append((rel, stem, fm, ftype, text))
            continue
        if ftype == "plan":
            plan_type = fm.get("plan_type")
            label = plan_type if isinstance(plan_type, str) and plan_type else "plan"
            entries.append(Entry(rel=rel, stem=stem, type="plan",
                                 descriptor=label,
                                 stub_needs=_stub_needs(fm, text, ftype)))
            continue
        if ftype in SKIP_TYPES:
            continue
        entries.append(Entry(
            rel=rel, stem=stem, type=ftype,
            descriptor=descriptor_of(fm, text),
            stub_needs=_stub_needs(fm, text, ftype),
        ))

    by_key_number: dict[tuple[str, int], _SessionFile] = {
        (sf.chapter_key, sf.number): sf for sf in session_files
        if sf.number is not None}

    for rel, stem, fm, ftype, text in chain_docs:
        num = parse_session_number(fm.get("session"))
        matched: _SessionFile | None = None
        if num is not None:
            chain_key = chapter_key(rel, fm)
            if chain_key is not None:
                matched = by_key_number.get((chain_key, num))
        else:
            target = normalize(stem)
            for sf in session_files:
                if target in sf.documents_targets:
                    matched = sf
                    break
        if matched is not None:
            matched.entry["chain"].append((_chain_label(ftype), stem))
            # Placed, but a canon_status: STUB chain doc still needs
            # attention — surface that in Stubs too (#M12).
            stub_needs = _stub_needs(fm, text, ftype)
            if stub_needs is not None:
                entries.append(Entry(rel=rel, stem=stem, type=ftype,
                                     descriptor="", stub_needs=stub_needs,
                                     already_placed=True))
        else:
            entries.append(Entry(rel=rel, stem=stem, type=ftype,
                                 descriptor="", stub_needs="session link"))

    pc_index = {e.stem.casefold(): e for e in entries if e.type == "pc"}
    for rel, stem, fm, text in story_files:
        pc_entry = pc_index.get(stem[: -len("_Story")].casefold())
        if pc_entry is not None:
            pc_entry.story_stem = stem
            # Same as above: placed under its PC, but still surface a
            # canon_status: STUB flag in Stubs (#M12).
            stub_needs = _stub_needs(fm, text, "character-story")
            if stub_needs is not None:
                entries.append(Entry(rel=rel, stem=stem,
                                     type="character-story", descriptor="",
                                     stub_needs=stub_needs,
                                     already_placed=True))
        else:
            entries.append(Entry(rel=rel, stem=stem, type="character-story",
                                 descriptor="", stub_needs="PC page"))

    entries.sort(key=lambda e: e.stem.casefold())
    chapter_list = sorted(chapters.values(),
                          key=lambda c: c["stem"].casefold())
    return entries, chapter_list


def _counts(entries: list[Entry],
           chapters: list[ChapterRecord]) -> tuple[int, int, int]:
    """(entity_count, narrative_count, stub_count)."""
    typed = sum(1 for e in entries
               if e.type and e.type not in NON_ENTITY_TYPES)
    chain_matched = sum(len(sess["chain"]) for c in chapters
                        for sess in c["all_sessions"])
    chain_orphan = sum(1 for e in entries
                      if e.type in CHAIN_TYPES and not e.already_placed)
    plans = sum(1 for e in entries if e.type == "plan")
    narrative = (len(chapters)
                + sum(c["sessions"] for c in chapters)
                + sum(c["scenes"] for c in chapters)
                + chain_matched + chain_orphan + plans)
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
    typed_entries = [e for e in entries
                     if e.type and e.type not in NON_ENTITY_TYPES]
    plan_entries = sorted((e for e in entries if e.type == "plan"),
                          key=lambda e: e.stem.casefold())
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
            for sess in chapter["all_sessions"]:
                lines.append(f"  - [[{sess['stem']}]] (status: {sess['status']})")
                for label, doc_stem in sorted(
                        sess["chain"], key=lambda c: CHAIN_ORDER.index(c[0])):
                    lines.append(f"    - {label}: [[{doc_stem}]]")
            for scene_stem, scene_status in chapter["all_scenes"]:
                lines.append(f"  - [[{scene_stem}]] (status: {scene_status})")

    active = [a for chapter in chapters for a in chapter["active"]]
    if active:
        lines.append("")
        lines.append("### Active Session")
        for stem, chapter_stem, status in active:
            lines.append(
                f"- [[{stem}]] (chapter: {chapter_stem}, status: {status})")

    if plan_entries:
        lines.append("")
        lines.append(f"### Plans ({len(plan_entries)})")
        lines.extend(_entry_line(e) for e in plan_entries)

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
                for entry in items:
                    lines.append(_entry_line(entry))
                    if sub == "PCs" and entry.story_stem:
                        lines.append(f"  - story: [[{entry.story_stem}]]")
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


_COUNT_RE = re.compile(
    r"^entity_count: (\d+)\nnarrative_count: (\d+)\nstub_count: (\d+)$",
    re.MULTILINE)


def _counts_from_rendered(rendered: str) -> tuple[int, int, int]:
    """Pull the three frontmatter counts back out of `render()`'s own
    output, so the CLI's summary line never re-scans the vault — a
    second `collect()` call would double the vault walk for no reason,
    since `render()` already computed these."""
    m = _COUNT_RE.search(rendered)
    assert m is not None, "render() always emits the three count lines"
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


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
    entity_count, narrative_count, stub_count = _counts_from_rendered(rendered)
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
