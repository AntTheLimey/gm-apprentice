#!/usr/bin/env python3
"""Print one section of a note by heading path. Stdlib only.

Usage:
  section.py VAULT NOTE PATH
  section.py VAULT NOTE --lead

`--lead` prints the note's lead instead: the text above its first heading
or gm-only/spoiler block, where a scene keeps its Situation, Starts it and
If-table (#738); below a `# Title` line, a gm-only block at the top (#760),
and on a paused scene after its `## Paused` section (#758). A lead that
seems misread (a Situation further down) is refused. A batch's
`=== section NOTE --lead` block writes it.

NOTE is a vault-relative path, a note's name or one of its aliases. PATH
is `Heading` or `Heading/Sub/...`, matched without regard to case and
outside code fences; a section runs to the next heading of the same or a
higher level. A title may hold a slash. Start the first part with `#`
marks to pin that heading's level (`"## GM Notes/Hooks"`: only a level-2
GM Notes). Prints the matched heading line and its body as written (line
endings kept). Exit 1, with a plain message on stderr, when nothing
matches or more than one heading does (the candidates are listed).
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable
from pathlib import Path

import vault_write as vw
import vaultlib as vl


def name_index(notes: Iterable[tuple[str, str]]) -> dict[str, list[str]]:
    """Every note's file name and aliases (normalised) -> the notes that
    answer to it, from (vault-relative path, text) pairs. Build it once and
    pass it to `resolve_note` when resolving many names."""
    names: dict[str, list[str]] = {}
    for found, text in notes:
        for n in {vl.normalize(n)
                  for n in (Path(found).stem, *vl.frontmatter_aliases(text))}:
            names.setdefault(n, []).append(found)
    return names


def resolve_note(batch: vw.Batch, raw: str,
                 names: dict[str, list[str]] | None = None) -> str:
    """The vault-relative path `raw` names: a path (with or without .md),
    else a note's file name or alias. `names` is a ready `name_index`."""
    rel = vl.normalize_file_arg(raw)
    for guess in (rel, f"{rel}.md"):
        try:
            resolved = batch.resolve(guess)
            # A real file at that path, or a path `resolve` corrects.
            if batch.exists(guess) or resolved != guess:
                return resolved
        except vw.WriteError:
            continue
    if names is None:
        names = name_index(vl.vault_files(batch.vault))
    hits = names.get(vl.normalize(raw.removesuffix(".md")), [])
    if not hits:
        raise vw.WriteError(f"{raw}: no note with that path, name or alias")
    if len(hits) > 1:
        raise vw.WriteError(f"{raw}: {len(hits)} notes match: "
                            + ", ".join(sorted(hits)) + "; pass its path")
    return hits[0]


PIN_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_AT_LINE_RE = re.compile(r" \(line \d+\)$")


def advice(candidates: list[str]) -> str:
    """What to try after an ambiguous path: a longer path when the
    candidates differ, else the parent section, which holds them all."""
    names = [_AT_LINE_RE.sub("", c) for c in candidates]
    if len(set(names)) == len(names):
        return ("Pass a longer path, or start it with ## marks to pin the "
                "heading level.")
    return ("No path tells these apart: fetch the parent section instead "
            "(pin its level with ## marks if its name repeats).")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("vault", type=Path, help="the vault folder")
    ap.add_argument("note", help="the note: a vault-relative path, name or alias")
    ap.add_argument("path", nargs="?",
                    help="the heading path: Heading or Heading/Sub; "
                    "'## Heading/Sub' pins the first heading's level")
    ap.add_argument("--lead", action="store_true",
                    help="print the note's lead instead: the text above its "
                    "first heading or hidden block (a scene's Situation, "
                    "Starts it and If-table; below a # title line and a "
                    "gm-only block at the top, and on a paused scene below "
                    "its Paused section)")
    ap.epilog = 'Example: gma section "<vault>" "<note>" "Current Status/Session Log"'
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.lead and args.path is not None:
        ap.error("a PATH or --lead, not both")
    if not args.lead and args.path is None:
        ap.error("name a PATH, or --lead for the text above the first heading")
    if not args.vault.is_dir():
        print(f"error: not a directory: {args.vault}", file=sys.stderr)
        return 2
    batch = vw.Batch(args.vault)
    try:
        rel = resolve_note(batch, args.note)
        text = batch.read(rel)
    except vw.WriteError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if args.lead:
        doc = vw.parse(text)
        try:
            first, end, _walk = vw.checked_lead(
                doc, rel, vw.hidden_sections(args.vault))
        except vw.WriteError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        # Blank and whitespace-only lines round the text are the note's
        # own: `--replace` keeps them, so they are not printed (#738).
        body = [ln.rstrip("\r\n") for ln in doc.lines[first:end]]
        while body and not body[0].strip():
            body.pop(0)
        while body and not body[-1].strip():
            body.pop()
        lead = doc.eol.join(body)
        if not lead.strip():
            # (A lead-shaped line below an empty lead is refused by
            # checked_lead itself.)
            print(f"error: {rel} has no text {vw.lead_where(doc, first)}",
                  file=sys.stderr)
            return 1
        sys.stdout.buffer.write((lead + doc.eol).encode("utf-8"))
        return 0
    path = [p.strip() for p in args.path.split("/")]
    pin = PIN_RE.match(path[0])
    level = None
    if pin:
        level, path[0] = len(pin.group(1)), pin.group(2)
    found = vl.find_section(text, path, level=level)
    if found is None:
        print(f"error: {rel} has no section {args.path!r}", file=sys.stderr)
        return 1
    if isinstance(found, list):
        print(f"error: {args.path!r} matches more than one heading in {rel}: "
              + "; ".join(found) + ". " + advice(found), file=sys.stderr)
        return 1
    start, end = found
    out = "\n".join(text.split("\n")[start:end]) + "\n"
    sys.stdout.buffer.write(out.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
