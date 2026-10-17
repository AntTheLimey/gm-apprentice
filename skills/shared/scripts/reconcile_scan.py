#!/usr/bin/env python3
"""reconcile_scan.py: what reconcile counts before it talks to the GM.

    reconcile_scan.py VAULT WRAP_UP

WRAP_UP is the Wrap-Up's path, vault-relative or absolute inside the
vault. Reads only; writes nothing. Prints one `label: value` line each,
with the files under a count indented below it:

    wrap-up, session (the index, its status and number)
    skip       why reconcile does not run, or `no`: the index is already
               `reviewed`, or it is session 1 with no UNVERIFIED marker
               and no reconstruction note (a rebuilt session 1 carries
               those, and is reviewed)
    unverified           `<!-- UNVERIFIED -->` markers in the Wrap-Up (any
                         case, one may span lines), line and text
    reconstruction notes `> [!info] Reconstruction Note` callouts
    plan                 this session's Plan file, or `none`
    linked entities      notes the Wrap-Up links to (sessions, scenes,
                         chapters and other structural notes left out)
    draft entities created this session
                         linked DRAFTs whose `createdSession` names this
                         session's number: what the quick path promotes
    older draft entities linked
                         the other linked DRAFTs; the quick path leaves them
    open spoilers        `<!-- spoiler -->` blocks in the linked
                         entities, line and first words
    quick path           shared/reconcile.md's rule: no UNVERIFIED marker,
                         no Plan file, and no DRAFT created this session
                         that contradicts AUTHORITATIVE canon. The last is
                         the GM's and the model's to judge: with such DRAFTs
                         listed it says so. No session index found: no.

Exit: 0 scanned; 2 no such file, or not a Wrap-Up.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema_rules import extract_frontmatter, parse_session_number, wikilink_target  # noqa: E402
from vault_check import RECONSTRUCTION_NOTE_RE, STRUCTURAL_TYPES  # noqa: E402
from vaultlib import (WRAP_UP_TYPES, entity_type, link_aliases, link_lines,  # noqa: E402
                      link_target, live_wikilinks, markers_in, nested_mapping,
                      normalize, normalize_file_arg, vault_files)

UNVERIFIED_RE = re.compile(r"<!--\s*UNVERIFIED\b(.*?)-->", re.I | re.S)
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


def _linked(note: Note, value: object, by_name: dict[str, list[Note]]) -> Note | None:
    """The note a link-valued field of `note` names, resolved from `note`."""
    if isinstance(value, str) and value.strip().lower() in ("", "null", "~"):
        return None
    target = wikilink_target(value)
    return _resolve(target, by_name, note.rel) if target else None


def _documents(note: Note, key: str, by_name: dict[str, list[Note]]) -> Note | None:
    return _linked(note, nested_mapping(note.text, "documents").get(key, ""), by_name)


def _find_index(wrap: Note, notes: list[Note], by_name: dict[str, list[Note]]) -> Note | None:
    """The Wrap-Up's `session:` link, or the index whose `documents.wrap_up`
    resolves to this Wrap-Up."""
    index = _linked(wrap, wrap.fm.get("session"), by_name)
    if index is not None and index.type == "session":
        return index
    return next((n for n in notes if n.type == "session"
                 and _documents(n, "wrap_up", by_name) is wrap), None)


def _find_plan(index: Note | None, notes: list[Note],
               by_name: dict[str, list[Note]]) -> Note | None:
    """The index's `documents.plan`, or a Plan whose `session:` resolves to
    the index. Only a `session-plan` counts."""
    if index is None:
        return None
    plan = _documents(index, "plan", by_name)
    if plan is not None and plan.type == "session-plan":
        return plan
    return next((n for n in notes if n.type == "session-plan"
                 and _linked(n, n.fm.get("session"), by_name) is index), None)


def unverified_markers(text: str) -> list[tuple[int, str]]:
    """(line, text) of each UNVERIFIED marker outside code and frontmatter."""
    kept = ["\n" if ll.in_code or ll.in_frontmatter else ll.line
            for ll in link_lines(text)]
    body = "".join(kept)
    return [(body.count("\n", 0, m.start()) + 1, " ".join(m.group(1).strip(" :").split()))
            for m in UNVERIFIED_RE.finditer(body)]


def _wrap_rel(vault: Path, raw: str) -> str:
    path = Path(raw)
    if path.is_absolute():
        try:
            return path.resolve().relative_to(vault.resolve()).as_posix()
        except ValueError:
            raise LookupError(f"{raw} is not inside the vault") from None
    return normalize_file_arg(raw)


def scan(vault: Path, wrap_arg: str) -> list[str]:
    wrap_rel = _wrap_rel(vault, wrap_arg)
    notes = [Note(rel, text) for rel, text in vault_files(vault)]
    by_rel = {n.rel: n for n in notes}
    wrap = by_rel.get(wrap_rel)
    if wrap is None:
        raise LookupError(f"no note at {wrap_rel}")
    if wrap.type not in WRAP_UP_TYPES:
        raise LookupError(f"{wrap_rel} is not a Wrap-Up (type: {wrap.type or 'none'})")
    by_name = _index(notes)
    index = _find_index(wrap, notes, by_name)
    out = [f"wrap-up: {wrap.rel}"]
    if index is None:
        out.append("session: not found (no session index links this Wrap-Up)")
        number = parse_session_number(wrap.fm.get("session_number"))
    else:
        out.append(f"session: {index.rel} (status: {index.fm.get('status', '')}, "
                   f"session_number: {index.fm.get('session_number', '')})")
        number = parse_session_number(index.fm.get("session_number"))

    unverified = unverified_markers(wrap.text)
    recon = [ll.lineno for ll in link_lines(wrap.text)
             if not ll.in_code and not ll.in_frontmatter
             and RECONSTRUCTION_NOTE_RE.match(ll.line)]
    if index is not None and index.fm.get("status") == "reviewed":
        out.append("skip: status is already reviewed")
    elif number == 1 and not unverified and not recon:
        out.append("skip: first session (session_number 1)")
    else:
        out.append("skip: no")
    out.append(f"unverified: {len(unverified)}")
    out.extend(f"  line {n}: {what or '(bare)'}" for n, what in unverified)
    out.append(f"reconstruction notes: {len(recon)}")
    out.extend(f"  line {n}" for n in recon)
    plan = _find_plan(index, notes, by_name)
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
    new = [n for n in drafts if number is not None
           and parse_session_number(n.fm.get("createdSession")) == number]
    older = [n for n in drafts if n not in new]
    out.append(f"linked entities: {len(linked)}")
    out.append(f"draft entities created this session: {len(new)}")
    out.extend(f"  {n.rel}" for n in new)
    out.append(f"older draft entities linked (the quick path leaves them): {len(older)}")
    out.extend(f"  {n.rel} (createdSession: {n.fm.get('createdSession') or 'none'})"
               for n in older)
    spoilers = [(n.rel, line, words) for n in linked for line, words in open_spoilers(n.text)]
    out.append(f"open spoilers: {len(spoilers)}")
    out.extend(f"  {rel}:{line}: {words}" for rel, line, words in spoilers)

    fails = []
    if index is None:
        fails.append("session index not found")
    if unverified:
        fails.append(f"{len(unverified)} UNVERIFIED marker{'s' if len(unverified) != 1 else ''}")
    if plan is not None:
        fails.append("a Plan file")
    if fails:
        out.append("quick path: no (" + ", ".join(fails) + ")")
    elif new:
        out.append("quick path: yes, unless a DRAFT entity created this session "
                   "contradicts AUTHORITATIVE canon on the same facts")
    else:
        out.append("quick path: yes")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="reconcile_scan.py",
        description="Count what reconcile reviews in one Wrap-Up. Writes nothing.")
    parser.add_argument("vault", type=Path)
    parser.add_argument("wrap_up", help="the Wrap-Up's path, vault-relative or absolute")
    args = parser.parse_args(argv)
    try:
        lines = scan(args.vault, args.wrap_up)
    except LookupError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
