#!/usr/bin/env python3
"""Narrative-plan and midwife-adventure discovery: the read-set
session-prep's Forward Design step gathers by hand — every `type: plan`
under a chapter's `Planning/` folder, and which `_midwife/` adventure
directory an in-progress chapter continues.

session-prep guesses at this today by walking a chapter's Planning/
folder one file at a time and re-reading `_midwife/index.md`'s manifest
table by eye. This bundles both into one read: the plan inventory (arc
vs scene vs investigation vs timeline, with who and where each names)
and the midwife resolution (which adventure directory is this chapter,
or why that could not be decided). Read-only, stdlib only.

Usage:
  plans_index.py VAULT [--chapter "Chapter N - Title"] [--against NAME ...] [--json]

--chapter narrows section A (Planning/ entries) to that chapter — a
casefold substring of `vaultlib.chapter_of` — and section B (midwife
resolution) to adventures whose own index page or manifest line
mentions that chapter or its bare "Chapter N" form. Omitted, section A
covers every chapter and section B considers every adventure that is
not Ingested or Complete.

--against NAME (repeatable) adds an Overlap section: Planning/ entries
whose `participants`/`locations` name any of the given entities — the
check for "does this new scene collide with a thread we're already
tracking."

Ambiguity is a report, not an error: exit is always 0, even when the
midwife manifest cannot resolve to a single adventure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vaultlib import (chapter_of, extract_frontmatter,  # noqa: E402
                      vault_files, wikilink_target)

STATUS_RE = re.compile(r"\b(Active|Parked|Complete|Ingested)\b", re.IGNORECASE)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)
_CHAPTER_NUM_RE = re.compile(r"chapter\D{0,3}(\d+)", re.IGNORECASE)
_DONE_STATUSES = {"ingested", "complete"}


@dataclass
class Adventure:
    name: str
    status: str | None
    dir: str | None
    files: int


def _fold(text: str) -> str:
    """Underscore/hyphen/space-insensitive comparison key."""
    return re.sub(r"[-_\s]+", " ", text).strip().casefold()


def _chapter_needles(chapter: str) -> list[str]:
    """Search terms for "does this text name `chapter`": the label
    itself, and — when the label carries a chapter number — the bare
    "chapter N" form, so a folder labelled "Chapter 3 - Vienna" still
    matches an adventure page that only ever says "Chapter 3"."""
    needles = [chapter.casefold()]
    m = _CHAPTER_NUM_RE.search(chapter)
    if m:
        alt = f"chapter {m.group(1)}".casefold()
        if alt not in needles:
            needles.append(alt)
    return needles


def _mentions_chapter(text: str, chapter: str) -> bool:
    haystack = text.casefold()
    return any(n in haystack for n in _chapter_needles(chapter))


def _list_names(value: Any) -> list[str]:
    """Wikilink targets from a frontmatter list value (`participants`,
    `locations`); non-lists yield nothing."""
    if not isinstance(value, list):
        return []
    names = [wikilink_target(v) for v in value]
    return [n for n in names if n]


def planning_entries(vault: Path, chapter: str | None) -> list[dict]:
    """Every `type: plan` file, optionally narrowed to one chapter.

    `chapter` is a casefold substring of `vaultlib.chapter_of(rel, fm)`;
    `None` returns every chapter's plans.
    """
    out: list[dict] = []
    for rel, text in vault_files(vault):
        fm = extract_frontmatter(text) or {}
        if fm.get("type") != "plan":
            continue
        label = chapter_of(rel, fm)
        if chapter is not None:
            if not label or chapter.casefold() not in label.casefold():
                continue
        out.append({
            "rel": rel,
            "plan_type": fm.get("plan_type") or "",
            "participants": _list_names(fm.get("participants")),
            "locations": _list_names(fm.get("locations")),
        })
    return out


def _midwife_dirs(vault: Path) -> list[Path]:
    root = vault / "_midwife"
    if not root.is_dir():
        return []
    return sorted((p for p in root.iterdir()
                  if p.is_dir() and p.name != "seeds"),
                 key=lambda p: p.name)


def _manifest_lines(vault: Path) -> dict[str, str]:
    """dir name -> the manifest table line that names it, for every dir
    under `_midwife/` the manifest's index actually mentions. Empty when
    there is no manifest file."""
    manifest = vault / "_midwife" / "index.md"
    if not manifest.is_file():
        return {}
    text = manifest.read_text(encoding="utf-8", errors="replace")
    dirs = _midwife_dirs(vault)
    out: dict[str, str] = {}
    for line in text.splitlines():
        if not STATUS_RE.search(line):
            continue
        folded_line = _fold(line)
        for d in dirs:
            if d.name in out:
                continue
            if _fold(d.name) in folded_line:
                out[d.name] = line
    return out


def manifest_adventures(vault: Path) -> tuple[list[Adventure], str | None]:
    """Every `_midwife/<dir>` (excluding `seeds/`) with the status its
    manifest line carries, or `None` when no manifest line names it.

    Returns (adventures, problem); `problem` is `"no manifest"` when
    `_midwife/index.md` itself is missing — the dirs still get listed,
    just with an unknown status.
    """
    dirs = _midwife_dirs(vault)
    manifest = vault / "_midwife" / "index.md"
    problem = None if manifest.is_file() else "no manifest"
    lines = _manifest_lines(vault)
    adventures = []
    for d in dirs:
        line = lines.get(d.name)
        m = STATUS_RE.search(line) if line else None
        status = m.group(1) if m else None
        n_files = sum(1 for _ in d.rglob("*.md"))
        adventures.append(Adventure(name=d.name, status=status,
                                    dir=f"_midwife/{d.name}/", files=n_files))
    return adventures, problem


def resolve_adventure(adventures: list[Adventure], chapter: str | None,
                      vault: Path) -> tuple[Adventure | None, list[Adventure]]:
    """Which adventure a chapter continues, or the candidates that made
    it ambiguous.

    Candidates are the non-Ingested/Complete adventures whose own
    `index.md` or manifest line mentions `chapter` (all of them, when
    `chapter` is None). Exactly one candidate resolves outright; zero
    candidates still resolve when exactly one non-ingested adventure
    exists at all (nothing else to pick); anything else is ambiguous,
    reporting the candidates (or, absent any, every non-ingested
    adventure) for the GM to choose from.
    """
    non_ingested = [a for a in adventures
                    if (a.status or "").casefold() not in _DONE_STATUSES]
    if chapter is None:
        candidates = list(non_ingested)
    else:
        lines = _manifest_lines(vault)
        candidates = []
        for a in non_ingested:
            haystack = lines.get(a.name, "")
            idx = vault / "_midwife" / a.name / "index.md"
            if idx.is_file():
                haystack += "\n" + idx.read_text(encoding="utf-8",
                                                 errors="replace")
            if _mentions_chapter(haystack, chapter):
                candidates.append(a)
    if len(candidates) == 1:
        return candidates[0], []
    if not candidates and len(non_ingested) == 1:
        return non_ingested[0], []
    return None, (candidates or non_ingested)


def file_summary(path: Path) -> str:
    """"H1 — ## a | ## b | ## c", truncated to 120 characters."""
    text = path.read_text(encoding="utf-8", errors="replace")
    fm = extract_frontmatter(text)
    body = text
    if fm is not None:
        m = re.match(r"^---\r?\n.*?\r?\n---\r?\n?(.*)$", text, re.DOTALL)
        if m:
            body = m.group(1)
    h1 = ""
    h2s = []
    for m in _HEADING_RE.finditer(body):
        level, title = len(m.group(1)), m.group(2).strip()
        if level == 1 and not h1:
            h1 = title
        elif level == 2:
            h2s.append(title)
    summary = f"{h1} — {' | '.join(h2s)}" if h2s else h1
    return summary[:120]


def _resolved_files(vault: Path, adventure: Adventure) -> list[Path]:
    if not adventure.dir:
        return []
    adv_dir = vault / adventure.dir
    files = sorted(adv_dir.rglob("*.md"),
                   key=lambda p: (p.name != "timeline.md",
                                  p.relative_to(adv_dir).as_posix()))
    return files


def _overlap(entries: list[dict], against: list[str]) -> list[dict]:
    wanted = {n.casefold() for n in against}
    out = []
    for e in entries:
        matched = [n for n in e["participants"] + e["locations"]
                  if n.casefold() in wanted]
        if matched:
            out.append({"rel": e["rel"], "matched": matched})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", type=Path)
    ap.add_argument("--chapter", help="narrow to one chapter (casefold substring)")
    ap.add_argument("--against", action="append", default=[],
                    help="report Planning/ entries naming this participant "
                         "or location (repeatable)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2

    entries = planning_entries(args.vault, args.chapter)
    adventures, problem = manifest_adventures(args.vault)
    resolved, ambiguous = resolve_adventure(adventures, args.chapter, args.vault)
    resolved_files = ([{"rel": p.relative_to(args.vault / resolved.dir).as_posix(),
                       "summary": file_summary(p)}
                      for p in _resolved_files(args.vault, resolved)]
                     if resolved else [])
    overlap = _overlap(entries, args.against)

    if args.json:
        data = {
            "chapter": args.chapter,
            "planning": entries,
            "midwife": {
                "manifest": None if problem else "_midwife/index.md",
                "adventures": [asdict(a) for a in adventures],
                "resolved": resolved.name if resolved else None,
                "ambiguous": [a.name for a in ambiguous],
                "files": resolved_files,
            },
            "overlap": overlap,
        }
        print(json.dumps(data, indent=2))
        return 0

    header = (f"===== Planning/ ({args.chapter}) ====="
             if args.chapter else "===== Planning/ =====")
    print(header)
    if not entries:
        print("(no Planning/ entries)")
    for e in entries:
        print(f"{e['plan_type']}\t{e['rel']}\t"
              f"participants={', '.join(e['participants'])}\t"
              f"locations={', '.join(e['locations'])}")

    print("\n===== Midwife =====")
    if not (args.vault / "_midwife").is_dir():
        print("(no _midwife/ directory)")
    else:
        if problem:
            print(f"(no manifest — {len(adventures)} adventure dirs)")
        else:
            print("manifest: _midwife/index.md")
        for a in adventures:
            n_files = f"{a.files} file" if a.files == 1 else f"{a.files} files"
            print(f"{a.name}\t{a.status or '?'}\t{a.dir}\t{n_files}")
        if resolved:
            print(f"RESOLVED: {resolved.name}")
            for p, info in zip(_resolved_files(args.vault, resolved),
                              resolved_files):
                print(f"  {info['rel']}\t{info['summary']}")
        elif ambiguous:
            names = ", ".join(sorted(a.name for a in ambiguous))
            print(f"AMBIGUOUS: {names} — ask the GM which")

    if args.against:
        print("\n===== Overlap =====")
        if not overlap:
            print("(no overlap)")
        for row in overlap:
            print(f"{Path(row['rel']).name}\t{', '.join(row['matched'])}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
