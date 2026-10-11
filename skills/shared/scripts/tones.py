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
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from migrate_core import StepFailed, write_all_or_none
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


# A tone line the fix may rewrite: the word is the whole value, bare or
# in one pair of matching quotes, with nothing after it but a comment.
TONE_LINE_RE = re.compile(
    r"""^(?P<head>\s*(?:-\s+)?tone:[ \t]*)(?P<q>["']?)"""
    r"""(?P<word>[^"'#\r\n]*?)(?P=q)(?P<tail>[ \t]*(?:\#[^\r\n]*)?\r?)$""")


@dataclass
class Change:
    rel: str
    lineno: int
    before: str
    after: str


@dataclass
class Plan:
    vault: Path
    originals: dict[str, str] = field(default_factory=dict)
    texts: dict[str, str] = field(default_factory=dict)
    changes: list[Change] = field(default_factory=list)
    kept: list[tuple[str, int, str]] = field(default_factory=list)


def _read(vault: Path, rel: str) -> str | None:
    """The note exactly as it is on disk, or None when it is not UTF-8."""
    try:
        return (vault / rel).read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        return None


def _checked_sets(sets: dict[str, str], used: set[str]) -> dict[str, str]:
    listed = tone_families()
    out = {}
    for old, new in sets.items():
        old, new = tone_key(old), tone_key(new)
        if out.get(old, new) != new:
            raise TonesError(f"{old} is set to both {out[old]} and {new}")
        if new not in listed:
            raise TonesError(f"{new} is not a listed tone; the list is: "
                             f"{', '.join(listed)}")
        if old in listed:
            raise TonesError(f"{old} is already a listed tone")
        if old not in used:
            raise TonesError(f"no relationship has the tone {old}")
        out[old] = new
    return out


def plan_fix(vault: Path, near: bool, sets: dict[str, str]) -> Plan:
    """What `fix` would write. Changes nothing."""
    uses = survey(vault)
    listed = tone_families()
    sets = _checked_sets(sets, {tone_key(u.raw) for u in uses
                                if u.raw not in listed})

    def becomes(raw: str) -> str | None:
        if raw in listed:
            return None
        return sets.get(tone_key(raw)) or (tone_proposal(raw) if near
                                           else None)

    p = Plan(vault)
    # The survey only says which notes hold a stray this run would change.
    # Its line numbers are not used: it reads with universal newlines, which
    # can number lines differently from the bytes this rewrites.
    seen: dict[str, list[Use]] = {}
    for u in uses:
        if becomes(u.raw):
            seen.setdefault(u.rel, []).append(u)
    for rel, wanted in seen.items():
        text = _read(vault, rel)
        if text is None:
            raise TonesError(f"{rel} is not UTF-8 text; fix the file, "
                             f"then run it again")
        # One text, one numbering: the tone lines are found in the same
        # text that is split and rewritten.
        lines = text.split("\n")
        pending = Counter(u.raw for u in wanted)
        for lineno, raw in iter_relationship_tones(text):
            new = becomes(raw)
            if not new:
                continue
            pending[raw] -= 1
            m = (TONE_LINE_RE.match(lines[lineno - 1])
                 if lineno <= len(lines) else None)
            if not m or m.group("word").strip() != raw:
                p.kept.append((rel, lineno, raw))
                continue
            lines[lineno - 1] = (f"{m.group('head')}{m.group('q')}{new}"
                                 f"{m.group('q')}{m.group('tail')}")
            p.changes.append(Change(rel, lineno, raw, new))
        # A stray the survey saw but the strict reading did not (the
        # frontmatter is not found in the exact text): listed, not rewritten.
        for u in wanted:
            if pending[u.raw] > 0:
                pending[u.raw] -= 1
                p.kept.append((rel, u.lineno, u.raw))
        after = "\n".join(lines)
        if after != text:
            p.originals[rel], p.texts[rel] = text, after
    return p


def apply(p: Plan) -> None:
    """Write every note of the plan, or leave the vault exactly as it was."""
    try:
        write_all_or_none(p.vault, p.originals, p.texts, read=_read,
                          what="the tidy", holds="the new tones")
    except StepFailed as e:
        raise TonesError(str(e)) from e


def rows(p: Plan, done: bool = False) -> list[str]:
    verb = "CHANGED" if done else "WOULD-CHANGE"
    out = [f"{verb}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
           for c in p.changes]
    out += [f"KEPT\t{rel}:{lineno}\t{tone}\tnot a plain tone line; "
            f"edit the note" for rel, lineno, tone in p.kept]
    return out + [f"# {len(p.changes)} tone(s) in {len(p.texts)} note(s)"
                  + (f", {len(p.kept)} left as written" if p.kept else "")]


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description="List a vault's stray tone words, and tidy them.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", nargs="?", choices=["fix"])
    ap.add_argument("--near", action="store_true")
    ap.add_argument("--set", dest="sets", action="append", metavar="OLD=NEW")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"tones.py: not a directory: {args.vault.as_posix()}",
              file=sys.stderr)
        return 2
    usage = None
    if args.command is None and (args.near or args.sets or args.write):
        usage = "--near, --set and --write go with fix"
    elif args.command == "fix" and not (args.near or args.sets):
        usage = "fix takes --near, --set OLD=NEW, or both"
    sets: dict[str, str] = {}
    for pair in args.sets or []:
        old, sep, new = pair.partition("=")
        if not sep or not old.strip() or not new.strip():
            usage = "--set takes OLD=NEW"
        sets[old] = new
    if usage:
        print(f"tones.py: {usage}", file=sys.stderr)
        return 2
    try:
        if args.command is None:
            print("\n".join(report_lines(survey(args.vault))))
            return 0
        p = plan_fix(args.vault, args.near, sets)
        if args.write:
            apply(p)
        print("\n".join(rows(p, done=args.write)))
    except TonesError as e:
        print(f"tones.py: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt as e:
        print(f"tones.py: interrupted; {e}" if str(e)
              else "tones.py: interrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
