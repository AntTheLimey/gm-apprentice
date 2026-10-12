#!/usr/bin/env python3
"""tones.py: list the tone words a vault uses that are off the list, and
tidy them.

    tones.py VAULT
    tones.py VAULT uses [WORD ...]
    tones.py VAULT shown
    tones.py VAULT fix [--near [--except WORD ...]] [--set OLD=NEW ...]
                       [--write]

A relationship's `tone` is one of the words in
`shared/gm-apprentice-ontology.json`. With no command this prints a
report and writes nothing: a header line, then one tab-separated row per
stray word.

    NEAR  word, the listed word it should become, how many times
    ASK   word, how many times, up to three notes that hold it: no rule
          says what it should become, so the GM picks

When there are ASK rows, three `#` lines after them give the listed
words by family, for the GM to pick from. Notes under `_QA`, `_archive`,
`_Templates` and `_inbox` are not read.

`uses` prints every use of a stray word, one tab-separated row each,
and writes nothing:

    note:line, the word, the relationship's target as written, and its
    description on one line (cut at 300 characters with an ellipsis;
    empty when it has none)

With no WORD it takes every ASK word, commonest first; with WORDs, the
strays (NEAR or ASK) that compare equal to each, in the order given. A
last `#` line counts the uses and the words. A WORD no stray compares
equal to is refused.

`shown` lists the hostile ties the site shows, and writes nothing: one
tab-separated row per relationship whose tone is in the negative family,
that is not `gm_only`, on a note the site publishes (the site's own
publish tool is asked which notes publish):

    note:line, the tone word, the target as written, and the description
    on one line (cut at 300 characters, as `uses` cuts)

A last `#` line counts the ties and the notes. If the publish tool cannot
be asked, or the vault has no site, it prints one line why and exits 1.

`fix` rewrites strays. `--near` takes every NEAR row; `--except WORD`
(repeatable, with --near only) leaves that row's word as written.
`--set OLD=NEW` (repeatable) rewrites the stray OLD to the listed word
NEW, and wins over a NEAR rule and an --except for the same word. It
prints what it would change and writes nothing without --write. With
--write every note is written or none is. Only the tone word changes:
quotes, spacing, a trailing comment and line endings are kept.

Exit: 0 done or a clean preview; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from migrate_core import StepFailed, write_all_or_none
from schema_rules import (
    RelationshipEdge,
    iter_relationship_edges,
    iter_relationship_tones,
    tone_families,
    tone_key,
    tone_proposal,
)
from vaultlib import (_frontmatter_lines, extract_frontmatter,
                      is_unchecked_source, read_publish_list, vault_files)


class TonesError(Exception):
    """A fix refused or failed. The message is one line."""


@dataclass
class Use:
    rel: str
    lineno: int
    raw: str
    target: str = ""        # the edge's target, as written
    description: str = ""   # the edge's description, on one line


def survey(vault: Path) -> list[Use]:
    """Every tone on every relationship of every checked note."""
    uses = []
    for rel, text in vault_files(vault):
        if is_unchecked_source(rel):
            continue
        found = list(iter_relationship_tones(text))
        if not found:
            continue
        edges = {lineno: edge for edge in iter_relationship_edges(text)
                 for lineno in edge.tone_lines}
        for lineno, raw in found:
            edge = edges.get(lineno)
            uses.append(Use(rel, lineno, raw, edge.target if edge else "",
                            edge.description if edge else ""))
    return uses


def published_notes(vault: Path) -> set[str] | None:
    """The notes the vault's site publishes (NFC, vault-relative,
    forward-slash paths), asked of the site's own publish tool. None when it
    cannot be asked."""
    import vault_check
    return vault_check.pages_published(
        vault_check.ask_publish_tool(vault, ["explain", "--all"]))


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
    if ask:
        # What the GM picks from, so nothing else need be read for it.
        for family in dict.fromkeys(listed.values()):
            words = [w for w, f in listed.items() if f == family]
            rows.append(f"# {family}: {', '.join(words)}")
    return [f"# tones: {len(uses)}  listed: {len(uses) - len(strays)}  "
            f"near: {sum(count[w] for w in near)}  "
            f"ask: {sum(count[w] for w in ask)}", *rows]


DESCRIPTION_CAP = 300


def _one_line(text: str, cap: int | None = None) -> str:
    text = " ".join(text.split())
    if cap is not None and len(text) > cap:
        return text[:cap].rstrip() + "\u2026"
    return text


def use_lines(uses: list[Use], words: Iterable[str]) -> list[str]:
    """`note:line<TAB>word<TAB>target<TAB>description` for every use of
    each stray in `words`, or of every word no rule places when there are
    none."""
    listed = tone_families()
    where: dict[str, list[Use]] = {}
    for u in uses:
        if u.raw not in listed:
            where.setdefault(tone_key(u.raw), []).append(u)
    wanted = list(dict.fromkeys(tone_key(w) for w in words))
    for w in wanted:
        if w not in where:
            raise TonesError(f"{w} is a listed tone" if w in listed
                             else f"no relationship has the tone {w}")
    if not wanted:
        wanted = sorted((w for w, found in where.items()
                         if not tone_proposal(found[0].raw)),
                        key=lambda w: (-len(where[w]), w))
    out = [f"{u.rel}:{u.lineno}\t{w}\t{_one_line(u.target)}\t"
           f"{_one_line(u.description, DESCRIPTION_CAP)}" for w in wanted
           for u in sorted(where[w], key=lambda u: (u.rel, u.lineno))]
    return out + [f"# {len(out)} use(s) of {len(wanted)} word(s)"]


def site_family(raw: str) -> str | None:
    """The family the site shows a tone as. The same rule as `toneFamily`
    in tools/publish/lib/ontology.js: trimmed and lower-cased, then looked
    up in the list (`tone_family` itself is exact, to find strays)."""
    return tone_families().get(tone_key(raw))


def _hides_relationships(fields: object) -> bool:
    """Does this exclude list strip `relationships` on the site? Only a YAML
    list does, and it matches an item exactly (processor.js filterFields and
    publishedFrontmatter): a string, `Relationships` or `relationships ` is
    ignored there, so the ties stay listed."""
    return isinstance(fields, list) and "relationships" in fields


def _campaign_hides_relationships(vault: Path) -> bool:
    """The vault file's `publish.exclude_fields` strips `relationships`, and
    no `publish.overrides` entry mentions it (a per-note `include` would
    re-admit it for that note; which notes is not worked out, so none is
    skipped)."""
    cfg = read_publish_list(vault, "exclude_fields")
    if not _hides_relationships(cfg.value):
        return False
    try:
        text = (vault / "_meta" / "vault-config.md").read_text(
            encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return False
    lines = _frontmatter_lines(text) or []
    start, end = cfg.span or (0, 0)
    outside = lines[:start] + lines[end:]
    return not (any(re.match(r"\s*[\"']?overrides[\"']?\s*:", ln)
                    for ln in outside)
                and any("relationships" in ln for ln in outside))


def shown_edges(vault: Path, published: set[str]
                ) -> Iterator[tuple[str, RelationshipEdge]]:
    """`(note, edge)` for every relationship a published note shows on the
    site with a tone the site draws (a listed word)."""
    # The vault's own exclude_fields; a list only the site file holds is not
    # known here, and its notes are listed (the safe side).
    if _campaign_hides_relationships(vault):
        return
    for rel, text in vault_files(vault):
        if (is_unchecked_source(rel)
                or unicodedata.normalize("NFC", rel) not in published):
            continue
        fm = extract_frontmatter(text) or {}
        if _hides_relationships(fm.get("publish_exclude_fields")):
            continue
        for edge in iter_relationship_edges(text):
            if not edge.gm_only and site_family(edge.tone):
                yield rel, edge


def site_shows_a_tone(vault: Path) -> bool:
    """Does the vault's site show any relationship's tone? True when the
    site's tool cannot be asked which notes publish and the vault has a
    tone at all (better told once too often than not told)."""
    published = published_notes(vault)
    if published is None:
        return bool(survey(vault))
    return next(shown_edges(vault, published), None) is not None


def shown_lines(vault: Path, published: set[str]) -> list[str]:
    """One row per hostile tie a published note shows, then a count."""
    rows: list[str] = []
    notes: set[str] = set()
    for rel, edge in shown_edges(vault, published):
        if site_family(edge.tone) != "negative":
            continue
        line = edge.tone_lines[0] if edge.tone_lines else 0
        rows.append("\t".join([
            f"{rel}:{line}", edge.tone, _one_line(edge.target),
            _one_line(edge.description, DESCRIPTION_CAP)]))
        notes.add(rel)
    n, m = len(rows), len(notes)
    rows.append(f"# {n} hostile tie{'' if n == 1 else 's'} shown on "
                f"{m} note{'' if m == 1 else 's'}")
    return rows


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
    except OSError as e:
        raise TonesError(f"{rel} cannot be read ({e.__class__.__name__}); "
                         f"run it again") from e


Sets = dict[str, str] | Iterable[tuple[str, str]]


def _checked_sets(sets: Sets, used: set[str]) -> dict[str, str]:
    """OLD -> NEW as compared, from the pairs as given: a word given two
    different targets is refused, so the pairs must not be merged first."""
    listed = tone_families()
    out: dict[str, str] = {}
    for old, new in (sets.items() if isinstance(sets, dict) else sets):
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


def plan_fix(vault: Path, near: bool, sets: Sets,
             excepts: Iterable[str] = ()) -> Plan:
    """What `fix` would write. Changes nothing."""
    uses = survey(vault)
    listed = tone_families()
    sets = _checked_sets(sets, {tone_key(u.raw) for u in uses
                                if u.raw not in listed})
    near_words = {tone_key(u.raw) for u in uses if tone_proposal(u.raw)}
    skip = {tone_key(word) for word in excepts}
    unused = sorted(skip - near_words)
    if unused:
        raise TonesError(f"no NEAR row has the tone {unused[0]}")

    def becomes(raw: str) -> str | None:
        if raw in listed:
            return None
        key = tone_key(raw)
        return sets.get(key) or (tone_proposal(raw)
                                 if near and key not in skip else None)

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
    ap.add_argument("command", nargs="?", choices=["fix", "uses", "shown"])
    ap.add_argument("words", nargs="*", metavar="WORD")
    ap.add_argument("--near", action="store_true")
    ap.add_argument("--except", dest="excepts", action="append",
                    metavar="WORD")
    ap.add_argument("--set", dest="sets", action="append", metavar="OLD=NEW")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"tones.py: not a directory: {args.vault.as_posix()}",
              file=sys.stderr)
        return 2
    usage = None
    if args.command != "fix" and (args.near or args.excepts or args.sets
                                 or args.write):
        usage = "--near, --except, --set and --write go with fix"
    elif args.command == "shown" and args.words:
        usage = "only uses takes words"
    elif args.command == "fix" and args.words:
        usage = "only uses takes words; fix takes --set OLD=NEW"
    elif args.excepts and not args.near:
        usage = "--except goes with --near"
    elif args.command == "fix" and not (args.near or args.sets):
        usage = "fix takes --near, --set OLD=NEW, or both"
    sets: list[tuple[str, str]] = []
    for pair in args.sets or []:
        old, sep, new = pair.partition("=")
        if not sep or not old.strip() or not new.strip():
            usage = "--set takes OLD=NEW"
        sets.append((old, new))
    if usage:
        print(f"tones.py: {usage}", file=sys.stderr)
        return 2
    try:
        if args.command is None:
            print("\n".join(report_lines(survey(args.vault))))
            return 0
        if args.command == "uses":
            print("\n".join(use_lines(survey(args.vault), args.words)))
            return 0
        if args.command == "shown":
            published = published_notes(args.vault)
            if published is None:
                print("tones.py: the site's publish tool could not be asked "
                      "which notes publish", file=sys.stderr)
                return 1
            print("\n".join(shown_lines(args.vault, published)))
            return 0
        p = plan_fix(args.vault, args.near, sets, args.excepts or ())
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
