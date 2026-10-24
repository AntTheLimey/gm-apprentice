#!/usr/bin/env python3
"""reveal_scan.py: what is still hidden in the notes a session touched.

    reveal_scan.py VAULT SESSION_INDEX

Reads only; writes nothing. SESSION_INDEX is the session index's path
(vault-relative, with or without `.md`) or its file name. The notes that
count as "touched" are those the session's Play Notes, Wrap-Up and recap
(when it has a separate one) link to; the Plan never counts, since it
holds what was meant to happen, not what was played. Scenes, Plans,
session notes, chapters and other structural notes are never listed.

Each listed note is one tab-separated row:

    path <TAB> published|unpublished [withheld] <TAB> hidden parts

The hidden parts, joined by `; `: each section title the site withholds
(as the publish tool names them, e.g. `GM Notes`), `gm-only xN` for N
`<!-- gm-only -->` blocks, `spoiler: <first words>` per spoiler block, and
`gm_aliases: a, b`. A published note with nothing hidden is left out. An
unpublished note is always listed.

Publish state comes from the publish tool (`manifest list`, `explain
--all`). With no publish list, the output is one line and the exit is 0;
when the tool cannot be asked, that one line gives the reason instead.
A `withheld` the tool could not read shows as `withheld unknown`, and
section titles `explain` could not give are left out; either way a
`# warning:` line says why.

Exit: 0 scanned; 2 no such session index.
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reconcile_scan import Note, _documents, _index, _resolve, open_spoilers  # noqa: E402
from vault_check import ask_publish_tool  # noqa: E402
from vaultlib import (WRAP_UP_TYPES, PublishToolUnavailable, link_lines,  # noqa: E402
                      live_wikilinks, markers_in, normalize_file_arg,
                      note_withheld, vault_files)

NEVER_CANDIDATES = frozenset({
    "session", "plan", "session-plan", "scene", "play-notes",
    "session-play-notes", "wrap-up", "chapter", "meta", *WRAP_UP_TYPES,
})
FALLBACK_TYPES = {
    "play_notes": {"session-play-notes", "play-notes"},
    "wrap_up": {*WRAP_UP_TYPES, "wrap-up"},
}
# (documents key, label) in print order. `recap` is read when the index has it.
SOURCE_KEYS = (("play_notes", "Play Notes"), ("wrap_up", "Wrap-Up"), ("recap", "Recap"))


@dataclass
class Row:
    path: str
    published: bool
    withheld: bool | None  # None: the tool could not say
    hidden: list[str] = field(default_factory=list)


@dataclass
class ScanResult:
    listed: bool = True
    why: str | None = None
    title: str = ""
    sources: list[str] = field(default_factory=list)
    rows: list[Row] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _session_note(notes: list[Note], arg: str) -> Note:
    rel = normalize_file_arg(arg)
    wanted = {rel, rel + ".md"}
    for n in notes:
        if n.rel in wanted:
            return n
    stems = [n for n in notes if Path(n.rel).stem == Path(rel).stem and n.type == "session"]
    if stems:
        return stems[0]
    raise LookupError(f"no session index at {rel}")


def _sources(index: Note, notes: list[Note],
             by_name: dict[str, list[Note]]) -> list[tuple[str, Note]]:
    found: list[tuple[str, Note]] = []
    for key, label in SOURCE_KEYS:
        doc = _documents(index, key, by_name)
        if doc is None and key in FALLBACK_TYPES:
            # Not linked from the index: the one note of that type beside it.
            here = [n for n in notes if n.type in FALLBACK_TYPES[key]
                    and Path(n.rel).parent == Path(index.rel).parent]
            doc = here[0] if len(here) == 1 else None
        if doc is not None:
            found.append((label, doc))
    return found


def _hidden_parts(note: Note, stripped: list[str]) -> list[str]:
    hidden = list(stripped)
    gm_blocks = 0
    for ll in link_lines(note.text):
        if ll.in_code or ll.in_frontmatter:
            continue
        gm_blocks += sum(1 for _, word, closer in markers_in(ll.line)
                         if word == "gm-only" and not closer)
    if gm_blocks:
        hidden.append(f"gm-only x{gm_blocks}")
    hidden.extend(f"spoiler: {words}" for _, words in open_spoilers(note.text))
    aliases = note.fm.get("gm_aliases")
    if isinstance(aliases, str):
        aliases = [aliases]
    if isinstance(aliases, list):
        names = [str(a).strip().strip("\"'") for a in aliases]
        names = [n for n in names if n]
        if names:
            hidden.append("gm_aliases: " + ", ".join(names))
    return hidden


def _stripped_by_path(vault: Path) -> tuple[dict[str, list[str]], str | None]:
    """Per file, the section titles the site withholds, and why they could
    not be had. A failed `explain` leaves the titles out; it never fails the
    scan. No answer and no reason means no site to build, so nothing to say."""
    answer = ask_publish_tool(vault, ["explain", "--all"])
    if answer.data is None:
        return {}, answer.why
    out: dict[str, list[str]] = {}
    try:
        for page in answer.data["pages"]:
            titles = [str(t) for t in page.get("strippedSections") or []]
            if titles:
                out[unicodedata.normalize("NFC", str(page["path"]))] = titles
    except (KeyError, TypeError, AttributeError):
        return {}, "the publish tool's explain answer is not understood"
    return out, None


def scan(vault: Path, session: str) -> ScanResult:
    notes = [Note(rel, text) for rel, text in vault_files(vault)]
    index = _session_note(notes, session)
    result = ScanResult(title=Path(index.rel).stem)

    listing = ask_publish_tool(vault, ["manifest", "list"], site_optional=True)
    data = listing.data
    if not isinstance(data, dict) or not data.get("listed"):
        # A dict saying "not listed", or no answer and no reason (no site),
        # is no publish list; no answer with a reason is a failed tool.
        result.listed = False
        result.why = None if isinstance(data, dict) else listing.why
        return result
    publishing = {unicodedata.normalize("NFC", str(p)) for p in data.get("publishing") or []}

    by_name = _index(notes)
    sources = _sources(index, notes, by_name)
    result.sources = [label for label, _ in sources]
    candidates: list[Note] = []
    seen: set[str] = set()
    for _, doc in sources:
        for ll in link_lines(doc.text):
            if ll.in_code:
                continue
            for m in live_wikilinks(ll.line, ll.spans):
                note = _resolve(m.group(1), by_name, doc.rel)
                if note is not None and note.type not in NEVER_CANDIDATES \
                        and note is not index and note.rel not in seen:
                    seen.add(note.rel)
                    candidates.append(note)
    if not candidates:
        return result

    stripped, why = _stripped_by_path(vault)
    if why:
        result.warnings.append(f"section titles unknown: {why}")
    for note in candidates:
        published = unicodedata.normalize("NFC", note.rel) in publishing
        withheld: bool | None
        warning = None
        try:
            withheld = note_withheld(note.text)[0]
        except PublishToolUnavailable as e:
            withheld, warning = None, f"withheld unknown: {e}"
        hidden = _hidden_parts(note, stripped.get(unicodedata.normalize("NFC", note.rel), []))
        if published and not hidden:
            continue
        if warning and warning not in result.warnings:
            result.warnings.append(warning)
        result.rows.append(Row(note.rel, published, withheld, hidden))
    return result


def render(result: ScanResult) -> list[str]:
    if not result.listed:
        if result.why:
            return [f"reveals: could not ask the publish tool: {result.why}"]
        return ["reveals: no publish list; nothing to unlock"]
    out = [f"reveals: {result.title} (sources: {', '.join(result.sources) or 'none'})"]
    for row in result.rows:
        state = ("published" if row.published else "unpublished"
                 + {True: " withheld", False: "", None: " withheld unknown"}[row.withheld])
        out.append("\t".join([row.path, state, "; ".join(row.hidden)]))
    out.extend(f"# warning: {w}" for w in result.warnings)
    out.append(f"# notes: {len(result.rows)}")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="reveal_scan.py",
        description="List what is still hidden in the notes a session touched. "
                    "Writes nothing.")
    parser.add_argument("vault", type=Path)
    parser.add_argument("session", help="the session index's path or file name")
    args = parser.parse_args(argv)
    try:
        result = scan(args.vault, args.session)
    except LookupError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print("\n".join(render(result)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
