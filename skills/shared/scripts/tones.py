#!/usr/bin/env python3
"""tones.py: list the tone words a vault uses that are off the list, and
tidy them.

    tones.py VAULT
    tones.py VAULT fix [--near] [--set OLD=NEW ...] [--write]

A relationship's `tone` is one of the words in
`shared/gm-apprentice-ontology.json`. With no command this prints a
report and writes nothing: a header line, then one tab-separated row per
stray word.

    NEAR  word, the listed word it should become, how many times
    ASK   word, how many times, up to three notes that hold it: no rule
          says what it should become, so the GM picks

Notes under `_QA`, `_archive`, `_Templates` and `_inbox` are not read.

`fix` rewrites strays. `--near` takes every NEAR row. `--set OLD=NEW`
(repeatable) rewrites the stray OLD to the listed word NEW, and wins
over a NEAR rule for the same word. It prints what it would change and
writes nothing without --write. With --write every note is written or
none is. Only the tone word changes: quotes, spacing, a trailing comment
and line endings are kept.

Exit: 0 done or a clean preview; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from schema_rules import (
    iter_relationship_tones,
    tone_families,
    tone_key,
    tone_proposal,
)
from vaultlib import is_unchecked_source, vault_files


class TonesError(Exception):
    """A fix refused or failed. The message is one line."""


@dataclass
class Use:
    rel: str
    lineno: int
    raw: str


def survey(vault: Path) -> list[Use]:
    """Every tone on every relationship of every checked note."""
    uses = []
    for rel, text in vault_files(vault):
        if is_unchecked_source(rel):
            continue
        uses += [Use(rel, lineno, raw)
                 for lineno, raw in iter_relationship_tones(text)]
    return uses


def report_lines(uses: list[Use]) -> list[str]:
    listed = tone_families()
    strays = [u for u in uses if u.raw not in listed]
    count = Counter(tone_key(u.raw) for u in strays)
    proposal = {tone_key(u.raw): tone_proposal(u.raw) for u in strays}
    near = [w for w in count if proposal[w]]
    ask = [w for w in count if not proposal[w]]

    def order(words: list[str]) -> list[str]:
        return sorted(words, key=lambda w: (-count[w], w))

    rows = [f"NEAR\t{w}\t{proposal[w]}\t{count[w]}" for w in order(near)]
    for w in order(ask):
        notes = sorted({u.rel for u in strays if tone_key(u.raw) == w})[:3]
        rows.append(f"ASK\t{w}\t{count[w]}\t{'; '.join(notes)}")
    return [f"# tones: {len(uses)}  listed: {len(uses) - len(strays)}  "
            f"near: {sum(count[w] for w in near)}  "
            f"ask: {sum(count[w] for w in ask)}", *rows]


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description="List a vault's stray tone words, and tidy them.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", nargs="?", choices=["fix"])
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"tones.py: not a directory: {args.vault.as_posix()}",
              file=sys.stderr)
        return 2
    print("\n".join(report_lines(survey(args.vault))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
