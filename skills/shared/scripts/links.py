#!/usr/bin/env python3
"""links.py: list a vault's broken links by kind, and fix them.

    links.py VAULT
    links.py VAULT retarget NAME NOTE [--keep-text] [--write]
    links.py VAULT unlink NAME [NAME ...] [--write]

With no command it prints a report and writes nothing: a header line, then
one tab-separated row per broken name.

    NEAR       an existing note may be what was meant. Up to three
               candidates, best first, each tagged `same` (equal once
               case, spaces, punctuation, accents and emoji are dropped),
               `close` (a likely typo) or `part` (one name is the other
               with extra words before or after).
    UNWRITTEN  nothing like it exists. Spellings that differ only as
               `same` does share a row.
    FILE       a link to an attached file (an image, a PDF) that is not
               in the vault. Listed last; neither fix applies to it
               sensibly, so restore the file or remove the link by hand.

Links written in notes under `_QA` and `_archive` are not reported; the
header counts the names broken only there.

`retarget` rewrites every link to NAME to point at NOTE (a vault path, or
a filename only one note has). The misspelt name is replaced unless
--keep-text keeps the words on the page as the link's display text. A
link's heading, block and display text are kept.

`unlink` turns every link to NAME into its words. A link in frontmatter
and an embed are left alone and listed as KEPT.

Both fixes print what they would change and write nothing without
--write. With --write every note is written or none is. Links in a code
fence or inline code are never touched.

Exit: 0 done or a clean preview; 1 refused or failed (one line why);
2 usage error.
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import graph_check
from migrate_core import StepFailed, write_text_atomic
from relink import (
    RelinkError,
    _nfc,
    _parse_link,
    _raw,
    _read,
    _stem,
    _walk,
    resolve_old,
)
from vaultlib import (
    LINK_RE,
    UNCHECKED_DIRS,
    frontmatter_span,
    inline_code_spans,
    inside_spans,
    is_unchecked_source,
    link_name,
    link_target,
    normalize,
    scan_body,
)

TAGS = ("same", "close", "part")
Index = list[tuple[str, list[str], list[int], set[str]]]
# A link to one of these is to an attached file, never to a note.
FILE_RE = re.compile(
    r"\.(png|jpe?g|webp|gif|svg|bmp|pdf|mp3|m4a|wav|ogg|mp4|mov|webm|canvas)$",
    re.IGNORECASE)


def _fold(name: str) -> str:
    """Lower case, accents dropped."""
    return "".join(c for c in unicodedata.normalize("NFKD", name)
                   if not unicodedata.combining(c)).casefold()


def squash(name: str) -> str:
    """A name with case, spaces, punctuation, accents and emoji dropped."""
    return "".join(c for c in _fold(name) if c.isalnum())


def _words(name: str) -> list[str]:
    return [w for w in re.split(r"[\W_]+", _fold(name)) if w]


def _numbers(name: str) -> list[int]:
    return [int(d) for d in re.findall(r"\d+", _fold(name))]


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"


def _part(a: list[str], b: list[str]) -> bool:
    """One name is the other with extra words before or after."""
    short, long = (a, b) if len(a) < len(b) else (b, a)
    if len(short) == len(long) or len("".join(short)) < 4:
        return False
    return long[:len(short)] == short or long[-len(short):] == short


def _index(names: dict[str, set[str]]) -> Index:
    """Every name and alias a live note answers to: (squashed, words,
    numbers, notes). Notes in unchecked folders are records, never
    candidates."""
    out: Index = []
    for known, rels in names.items():
        live = {r for r in rels if not is_unchecked_source(r)}
        if live and squash(known):
            out.append((squash(known), _words(known), _numbers(known), live))
    return out


def candidates(name: str, index: Index) -> list[tuple[str, str]]:
    """Up to three notes `name` may mean, best first: (path, tag)."""
    sq, words, numbers = squash(name), _words(name), _numbers(name)
    rank: dict[str, int] = {}
    by_squash: dict[str, set[str]] = {}

    def offer(rels: set[str], r: int) -> None:
        for rel in rels:
            rank[rel] = min(rank.get(rel, r), r)

    for known_sq, known_words, known_numbers, rels in index:
        if known_numbers == numbers:
            by_squash.setdefault(known_sq, set()).update(rels)
        if known_sq == sq:
            offer(rels, 0)
        elif _part(words, known_words):
            offer(rels, 2)
    if sq:
        for near in difflib.get_close_matches(sq, list(by_squash), n=3,
                                              cutoff=0.85):
            offer(by_squash[near], 1)
    best = sorted(rank.items(), key=lambda kv: (kv[1], kv[0]))[:3]
    return [(rel, TAGS[r]) for rel, r in best]


@dataclass
class Row:
    kind: str
    spellings: list[str]
    sources: list[str]
    candidates: list[tuple[str, str]]


def report(vault: Path) -> tuple[list[Row], int]:
    """The broken links of checked notes, grouped, and how many names are
    broken only in unchecked folders."""
    _notes, names, _outbound, spellings = graph_check.collect(vault, [])
    index = _index(names)
    groups: dict[str, dict[str, dict[str, str]]] = {}
    unchecked = 0
    for target, srcs in graph_check.broken(vault, names, spellings).items():
        checked = {s: sp for s, sp in srcs.items()
                   if not is_unchecked_source(s)}
        if not checked:
            unchecked += 1
            continue
        groups.setdefault(squash(target) or target, {})[target] = checked
    rows = []
    for group in groups.values():
        spelt: list[str] = []
        sources: set[str] = set()
        for target in sorted(group):
            srcs = group[target]
            first = srcs[min(srcs)]
            if first not in spelt:
                spelt.append(first)
            sources |= set(srcs)
        if FILE_RE.search(spelt[0]):
            rows.append(Row("FILE", spelt, sorted(sources), []))
            continue
        found = candidates(spelt[0], index)
        rows.append(Row("NEAR" if found else "UNWRITTEN", spelt,
                        sorted(sources), found))
    rows.sort(key=lambda r: (("NEAR", "UNWRITTEN", "FILE").index(r.kind), -len(r.sources),
                             r.spellings[0].casefold()))
    return rows, unchecked


def report_lines(rows: list[Row], unchecked: int) -> list[str]:
    notes = {s for r in rows for s in r.sources}
    out = [f"# broken: {_count(len(rows), 'name')} in "
           f"{_count(len(notes), 'note')}; not checked: "
           f"{', '.join(UNCHECKED_DIRS)} ({_count(unchecked, 'name')})"]
    for r in rows:
        cols = [r.kind, " | ".join(r.spellings)]
        if r.candidates:
            cols.append("-> " + "; ".join(f"{rel} ({tag})"
                                          for rel, tag in r.candidates))
        more = len(r.sources) - 5
        cols.append(f"{_count(len(r.sources), 'note')}: "
                    + ", ".join(r.sources[:5])
                    + (f", +{more} more" if more > 0 else ""))
        out.append("\t".join(cols))
    return out


class LinksError(Exception):
    """A fix refused or failed. The message is one line."""


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
    # (note, line, the link, why): links a fix leaves as written.
    kept: list[tuple[str, int, str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# (destination, #heading or ^block, |display), is it an embed, is it in
# frontmatter, the whole line -> the replacement, or (None, why kept).
Fix = Callable[[tuple[str, str, str], bool, bool, str],
               tuple["str | None", str]]

KEPT = {
    "frontmatter": "a frontmatter link is relationship data; left as written",
    "embed": "an embed has no words to leave; left as written",
}


def _retarget(new: str, keep_text: bool) -> Fix:
    def fix(parsed: tuple[str, str, str], embed: bool, in_fm: bool,
            line: str) -> tuple[str | None, str]:
        dest, sub, shown = parsed
        if keep_text and not shown and not embed and not in_fm:
            # In a table cell a bare pipe would end the cell.
            pipe = "\\|" if line.lstrip().startswith("|") else "|"
            shown = pipe + link_name(dest)
        return f"{'!' if embed else ''}[[{new}{sub}{shown}]]", ""
    return fix


def _unlink(parsed: tuple[str, str, str], embed: bool, in_fm: bool,
            line: str) -> tuple[str | None, str]:
    if in_fm:
        return None, "frontmatter"
    if embed:
        return None, "embed"
    dest, _sub, shown = parsed
    words = shown.lstrip("\\")[1:].strip() if shown else ""
    return words or link_name(dest), ""


def _rewrite(rel: str, text: str, targets: set[str], fix: Fix,
             p: Plan) -> str:
    lines = text.splitlines(keepends=True)
    fm_end, _ = frontmatter_span(lines)
    states, _ = scan_body(text)
    code = {s.lineno for s in states if s.in_code}
    out: list[str] = []
    for lineno, line in enumerate(lines, 1):
        if lineno in code:
            out.append(line)
            continue
        in_fm = lineno <= fm_end + 1
        spans = [] if in_fm else inline_code_spans(line)

        def sub(m: re.Match[str], lineno: int = lineno, line: str = line,
                in_fm: bool = in_fm,
                spans: list[tuple[int, int]] = spans) -> str:
            if (inside_spans(m.start(), spans)
                    or link_target(m.group(1)) not in targets):
                return m.group(0)
            parsed = _parse_link(m.group(1))
            if parsed is None:
                return m.group(0)
            after, why = fix(parsed, m.group(0).startswith("!"), in_fm, line)
            if after is None:
                p.kept.append((rel, lineno, m.group(0), why))
                return m.group(0)
            if after != m.group(0):
                p.changes.append(Change(rel, lineno, m.group(0), after))
            return after
        out.append(LINK_RE.sub(sub, line))
    return "".join(out)


def _plan(vault: Path, targets: set[str], fix: Fix) -> Plan:
    p = Plan(vault)
    for rel in _walk(vault, ".md"):
        text = _read(vault, rel)
        if text is None:
            if any(link_target(b) in targets
                   for b in LINK_RE.findall(_raw(vault, rel))):
                p.warnings.append(f"{rel} is not valid UTF-8; left alone")
            continue
        new = _rewrite(rel, text, targets, fix, p)
        if new != text:
            p.originals[rel], p.texts[rel] = text, new
    return p


def _broken_names(vault: Path, names: list[str]) -> set[str]:
    """The names as link targets; refuses one that is not a broken link."""
    _notes, known, _outbound, spellings = graph_check.collect(vault, [])
    missing = graph_check.broken(vault, known, spellings)
    for name in names:
        if normalize(name) not in missing:
            raise LinksError(f"{name} is not a broken link: nothing links "
                             f"to it, or a note already answers to it")
    return {normalize(name) for name in names}


def plan_retarget(vault: Path, name: str, note: str,
                  keep_text: bool = False) -> Plan:
    targets = _broken_names(vault, [name])
    notes = _walk(vault, ".md")
    asked = _nfc(resolve_old(vault, note))
    found = [n for n in notes if _nfc(n) == asked]
    if not found:
        raise LinksError(f"there is no note {note}")
    rel = found[0]
    sharing = [n for n in notes
               if normalize(_stem(n)) == normalize(_stem(rel))]
    new = _stem(rel) if len(sharing) == 1 else rel[:-3]
    return _plan(vault, targets, _retarget(new, keep_text))


def plan_unlink(vault: Path, names: list[str]) -> Plan:
    return _plan(vault, _broken_names(vault, names), _unlink)


def apply(p: Plan) -> None:
    """Write every note of the plan, or leave the vault exactly as it was."""
    written: list[str] = []
    try:
        for rel in sorted(p.texts):
            if _read(p.vault, rel) != p.originals[rel]:
                raise LinksError(f"{rel} changed while the fix was being "
                                 f"made; run it again")
            written.append(rel)  # before the write: an interrupt mid-write
            write_text_atomic(p.vault / rel, p.texts[rel])
    except BaseException as e:
        stuck = []
        for rel in written:
            try:
                write_text_atomic(p.vault / rel, p.originals[rel])
            except BaseException:
                stuck.append(rel)
        said = (str(e) or type(e).__name__) + (
            f"; these notes could not be put back and still have the new "
            f"links: {', '.join(stuck)}" if stuck
            else "; the vault is as it was")
        if isinstance(e, KeyboardInterrupt):
            raise KeyboardInterrupt(said) from None
        raise LinksError(said) from e


def rows(p: Plan, done: bool = False) -> list[str]:
    verb = "CHANGED" if done else "WOULD-CHANGE"
    out = [f"{verb}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
           for c in p.changes]
    out += [f"KEPT\t{rel}:{lineno}\t{link}\t{KEPT[why]}"
            for rel, lineno, link, why in p.kept]
    out += [f"WARNING\t{w}" for w in p.warnings]
    return out + [f"# {len(p.changes)} link(s) in {len(p.texts)} note(s)"
                  + (f", {len(p.kept)} left as written" if p.kept else "")]


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(
        description="List a vault's broken links by kind, and fix them.")
    ap.add_argument("vault", type=Path)
    ap.add_argument("command", nargs="?", choices=["retarget", "unlink"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--keep-text", action="store_true")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args(argv)
    if not args.vault.is_dir():
        print(f"links.py: not a directory: {args.vault.as_posix()}",
              file=sys.stderr)
        return 2
    usage = None
    if args.command is None and (args.write or args.keep_text):
        usage = "--write and --keep-text go with retarget or unlink"
    elif args.command == "retarget" and len(args.names) != 2:
        usage = "retarget takes NAME and NOTE"
    elif args.command == "unlink" and not args.names:
        usage = "unlink takes one or more NAMEs"
    elif args.command == "unlink" and args.keep_text:
        usage = "--keep-text goes with retarget"
    if usage:
        print(f"links.py: {usage}", file=sys.stderr)
        return 2
    try:
        if args.command is None:
            print("\n".join(report_lines(*report(args.vault))))
            return 0
        if args.command == "retarget":
            p = plan_retarget(args.vault, args.names[0], args.names[1],
                              args.keep_text)
        else:
            p = plan_unlink(args.vault, args.names)
        if args.write:
            apply(p)
        print("\n".join(rows(p, done=args.write)))
    except RelinkError as e:
        print(f"links.py: {e}", file=sys.stderr)
        return 2 if e.usage else 1
    except (LinksError, StepFailed) as e:
        print(f"links.py: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt as e:
        print(f"links.py: interrupted; {e}" if str(e)
              else "links.py: interrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
