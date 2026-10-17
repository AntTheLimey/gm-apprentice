#!/usr/bin/env python3
"""reconcile_scan.py: what reconcile counts before it talks to the GM.

    reconcile_scan.py VAULT WRAP_UP

WRAP_UP is the Wrap-Up's vault-relative path. Reads only; writes nothing.
Prints, one `label: value` line each, with the files under a count
indented below it:

    wrap-up, session (the index, its status and number)
    skip       why reconcile does not run (`reviewed`, or no other
               Wrap-Up in the vault: a first session), or `no`
    unverified           `<!-- UNVERIFIED -->` markers in the Wrap-Up,
                         line and text
    reconstruction notes `> [!info] Reconstruction Note` callouts
    plan                 this session's Plan file, or `none`
    linked entities      notes the Wrap-Up links to (sessions, scenes,
                         chapters and other structural notes left out)
    draft entities       those still `canon_status: DRAFT`
    open spoilers        `<!-- spoiler -->` blocks in the linked
                         entities, line and first words
    quick path           the fast path's rule (shared/reconcile.md):
                         no UNVERIFIED marker and no Plan file, and no
                         DRAFT entity contradicting AUTHORITATIVE canon.
                         The last is the GM's and the model's to judge:
                         with DRAFT entities listed it says so.

Exit: 0 scanned; 2 the path is missing or not a Wrap-Up.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

from schema_rules import extract_frontmatter, wikilink_target
from vault_check import RECONSTRUCTION_NOTE_RE, STRUCTURAL_TYPES
from vaultlib import (WRAP_UP_TYPES, entity_type, link_aliases, link_lines,
                      link_target, live_wikilinks, markers_in, nested_mapping,
                      normalize, normalize_file_arg, vault_files)

UNVERIFIED_RE = re.compile(r"<!--\s*UNVERIFIED\b(.*?)-->")
FIRST_WORDS = 10


class Note:
    def __init__(self, rel: str, text: str) -> None:
        self.rel = rel
        self.text = text
        self.fm: dict[str, Any] = extract_frontmatter(text) or {}
        self.type = entity_type(self.fm)


def _index(notes: list[Note]) -> dict[str, list[Note]]:
    """Every name a link may use (file stem, aliases) -> its notes."""
    by_name: dict[str, list[Note]] = {}
    for note in notes:
        for name in [Path(note.rel).stem, *link_aliases(note.fm)]:
            by_name.setdefault(normalize(name), []).append(note)
    return by_name


def _resolve(target: str, by_name: dict[str, list[Note]], near: str) -> Note | None:
    """The note a link names; between same-named notes, the one in the
    linking note's folder."""
    hits = by_name.get(link_target(target), [])
    if not hits:
        return None
    here = [n for n in hits if Path(n.rel).parent == Path(near).parent]
    return (here or hits)[0]


def _first_words(text: str) -> str:
    words = re.sub(r"<!--.*?-->", " ", text, flags=re.S).split()
    cut = " ".join(words[:FIRST_WORDS])
    return cut + ("..." if len(words) > FIRST_WORDS else "")


def open_spoilers(text: str) -> list[tuple[int, str]]:
    """(line, first words) of each `<!-- spoiler -->` block, outside code."""
    found: list[tuple[int, str]] = []
    depth = 0
    start = 0
    words: list[str] = []
    for ll in link_lines(text):
        if ll.in_code or ll.in_frontmatter:
            if depth:
                words.append(ll.line)
            continue
        line = ll.line
        at = 0
        for pos, word, closer in markers_in(line):
            if word != "spoiler":
                continue
            if depth:
                words.append(line[at:pos])
            if closer:
                depth = max(depth - 1, 0)
                if depth == 0:
                    found.append((start, _first_words("".join(words))))
                    words = []
            else:
                if depth == 0:
                    start = ll.lineno
                depth += 1
            at = pos
        if depth:
            words.append(line[at:])
    if depth:
        found.append((start, _first_words("".join(words))))
    return found


def _plan(index: Note | None, notes: list[Note], by_name: dict[str, list[Note]]) -> Note | None:
    if index is None:
        return None
    link = nested_mapping(index.text, "documents").get("plan", "")
    target = wikilink_target(link) if link and link.lower() not in ("null", "~") else ""
    if target:
        plan = _resolve(target, by_name, index.rel)
        if plan is not None:
            return plan
    stem = normalize(Path(index.rel).stem)
    for note in notes:
        if note.type == "session-plan" \
                and link_target(wikilink_target(note.fm.get("session"))) == stem:
            return note
    return None


def scan(vault: Path, wrap_rel: str) -> list[str]:
    notes = [Note(rel, text) for rel, text in vault_files(vault)]
    by_rel = {n.rel: n for n in notes}
    wrap = by_rel.get(wrap_rel)
    if wrap is None or wrap.type not in WRAP_UP_TYPES:
        raise LookupError(f"no Wrap-Up at {wrap_rel}")
    by_name = _index(notes)
    index = _resolve(wikilink_target(wrap.fm.get("session")), by_name, wrap.rel)
    if index is None or index.type != "session":
        # Or the index whose `documents.wrap_up` links this Wrap-Up.
        stem = normalize(Path(wrap.rel).stem)
        index = next((n for n in notes if n.type == "session" and link_target(
            wikilink_target(nested_mapping(n.text, "documents").get("wrap_up", ""))) == stem),
            None)
    out = [f"wrap-up: {wrap.rel}"]
    if index is None:
        out.append("session: not found (no session index links this Wrap-Up)")
    else:
        out.append(f"session: {index.rel} (status: {index.fm.get('status', '')}, "
                   f"session_number: {index.fm.get('session_number', '')})")
    others = [n for n in notes if n.type in WRAP_UP_TYPES and n is not wrap]
    if index is not None and index.fm.get("status") == "reviewed":
        out.append("skip: status is already reviewed")
    elif not others:
        out.append("skip: first session (no other Wrap-Up in the vault)")
    else:
        out.append("skip: no")

    unverified = [(ll.lineno, " ".join(m.group(1).strip(" :").split()))
                  for ll in link_lines(wrap.text) if not ll.in_code and not ll.in_frontmatter
                  for m in UNVERIFIED_RE.finditer(ll.line)]
    out.append(f"unverified: {len(unverified)}")
    out.extend(f"  line {n}: {what or '(bare)'}" for n, what in unverified)
    recon = [ll.lineno for ll in link_lines(wrap.text)
             if not ll.in_code and RECONSTRUCTION_NOTE_RE.match(ll.line)]
    out.append(f"reconstruction notes: {len(recon)}")
    out.extend(f"  line {n}" for n in recon)
    plan = _plan(index, notes, by_name)
    out.append(f"plan: {plan.rel if plan else 'none'}")

    linked: list[Note] = []
    for ll in link_lines(wrap.text):
        if ll.in_code:
            continue
        for m in live_wikilinks(ll.line, ll.spans):
            note = _resolve(m.group(1), by_name, wrap.rel)
            if note is not None and note is not wrap and note not in linked \
                    and note.type not in STRUCTURAL_TYPES:
                linked.append(note)
    drafts = [n for n in linked if n.fm.get("canon_status") == "DRAFT"]
    out.append(f"linked entities: {len(linked)}")
    out.append(f"draft entities: {len(drafts)}")
    out.extend(f"  {n.rel}" for n in drafts)
    spoilers = [(n.rel, line, words) for n in linked for line, words in open_spoilers(n.text)]
    out.append(f"open spoilers: {len(spoilers)}")
    out.extend(f"  {rel}:{line}: {words}" for rel, line, words in spoilers)

    fails = []
    if unverified:
        fails.append(f"{len(unverified)} UNVERIFIED marker{'s' if len(unverified) != 1 else ''}")
    if plan is not None:
        fails.append("a Plan file")
    if fails:
        out.append("quick path: no (" + ", ".join(fails) + ")")
    elif drafts:
        out.append("quick path: yes, unless one of the DRAFT entities above "
                   "contradicts AUTHORITATIVE canon on the same facts")
    else:
        out.append("quick path: yes")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="reconcile_scan.py",
        description="Count what reconcile reviews in one Wrap-Up. Writes nothing.")
    parser.add_argument("vault", type=Path)
    parser.add_argument("wrap_up", help="the Wrap-Up's vault-relative path")
    args = parser.parse_args(argv)
    try:
        lines = scan(args.vault, normalize_file_arg(args.wrap_up))
    except LookupError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
