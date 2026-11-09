#!/usr/bin/env python3
"""Print one section of a note by heading path. Stdlib only.

Usage:
  section.py VAULT NOTE PATH

NOTE is a vault-relative path, a note's name or one of its aliases. PATH
is `Heading` or `Heading/Sub/...`, matched without regard to case and
outside code fences; a section runs to the next heading of the same or a
higher level. Prints the matched heading line and its body as written
(line endings kept). Exit 1, with a plain message on stderr, when nothing
matches or more than one heading does (the candidates are listed).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import vault_write as vw
import vaultlib as vl


def resolve_note(batch: vw.Batch, raw: str) -> str:
    """The vault-relative path `raw` names: a path (with or without .md),
    else a note's file name or alias."""
    rel = vl.normalize_file_arg(raw)
    for guess in (rel, f"{rel}.md"):
        try:
            if batch.exists(guess) or batch.resolve(guess) != guess:
                return batch.resolve(guess)
        except vw.WriteError:
            continue
    want = vl.normalize(raw.removesuffix(".md"))
    hits = []
    for found, text in vl.vault_files(batch.vault):
        names = [Path(found).stem, *vl.frontmatter_aliases(text)]
        if want in {vl.normalize(n) for n in names}:
            hits.append(found)
    if not hits:
        raise vw.WriteError(f"{raw}: no note with that path, name or alias")
    if len(hits) > 1:
        raise vw.WriteError(f"{raw}: {len(hits)} notes match: "
                            + ", ".join(sorted(hits)) + "; pass its path")
    return hits[0]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("vault", type=Path, help="the vault folder")
    ap.add_argument("note", help="the note: a vault-relative path, name or alias")
    ap.add_argument("path", help="the heading path: Heading or Heading/Sub")
    ap.epilog = 'Example: gma section "<vault>" "<note>" "Current Status/Session Log"'
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
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
    path = [p.strip() for p in args.path.split("/")]
    found = vl.find_section(text, path)
    if found is None:
        print(f"error: {rel} has no section {args.path!r}", file=sys.stderr)
        return 1
    if isinstance(found, list):
        print(f"error: {args.path!r} matches more than one heading in {rel}; "
              "pass a longer path: " + "; ".join(found), file=sys.stderr)
        return 1
    start, end = found
    out = "\n".join(text.split("\n")[start:end]) + "\n"
    sys.stdout.buffer.write(out.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
