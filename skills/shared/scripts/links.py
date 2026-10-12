#!/usr/bin/env python3
"""links.py: list a vault's broken links by kind, and fix them.

    links.py VAULT
    links.py VAULT retarget NAME NOTE [--keep-text] [--write]
    links.py VAULT unlink NAME [NAME ...] [--write]
    links.py VAULT unlink NAME [NAME ...] --in NOTE [--in NOTE ...]
                          [--as WORDS] [--bare] [--write]

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

NAME is any one spelling from a report row, read the way a link is read
(a folder, #heading and .md are dropped). The fix covers the row's other
spellings too, but not a name that differs by a number.

`unlink` turns every link to NAME into its words. A link in frontmatter
and an embed are left alone and listed as KEPT.

With `--in`, `unlink` works only in the notes named (vault paths, or a
filename only one note has), and NAME may be a note that exists: the way
to stop a published page naming a note that has no page, while every
other note keeps its link. Where two notes share a name, give NAME with
its path (`Plans/Scene`): only links that lead to that note are turned, a
link to the other is left, and a link that gives no path is left and
listed as KEPT. `--bare` turns those too: for when the GM has looked at
the lines and they mean this note. `--as WORDS` gives the words for a link that
has no display text of its own, where the note's name would read as a file
name (`[[Scene_02_Quay]]` becomes WORDS); a link with display text keeps
it. A link with no words to a note marked `withheld: true` is KEPT until
`--as` gives them: the name is the secret, so it is never the words.

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
from migrate_core import StepFailed, write_all_or_none, write_text_atomic
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
    LinkLine,
    extract_frontmatter,
    is_unchecked_source,
    is_withheld,
    link_aliases,
    link_lines,
    link_name,
    link_target,
    normalize,
    sub_wikilinks,
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


def _group_key(name: str) -> tuple[str, tuple[int, ...]]:
    """Spellings with one key share a row, and one fix covers them all:
    the same letters and the same numbers. A name that squashes to nothing
    keeps its own row."""
    return squash(name) or name, tuple(_numbers(name))


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
            offer(rels, 0 if known_numbers == numbers else 1)
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
    groups: dict[tuple[str, tuple[int, ...]], dict[str, dict[str, str]]] = {}
    unchecked = 0
    for target, srcs in graph_check.broken(vault, names, spellings).items():
        checked = {s: sp for s, sp in srcs.items()
                   if not is_unchecked_source(s)}
        if not checked:
            unchecked += 1
            continue
        groups.setdefault(_group_key(target), {})[target] = checked
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
    order = ("NEAR", "UNWRITTEN", "FILE")
    rows.sort(key=lambda r: (order.index(r.kind), -len(r.sources),
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


# (destination, #heading or ^block, |display), is it an embed, is it in
# frontmatter, the whole line -> the replacement, or (None, why kept).
Fix = Callable[[tuple[str, str, str], bool, bool, str],
               tuple["str | None", str]]

KEPT = {
    "frontmatter": "a frontmatter link is relationship data; left as written",
    "embed": "an embed has no words to leave; left as written",
    "ambiguous": "more than one note has this name and the link gives no "
                 "path; left as written (--bare turns it too)",
    "withheld": "the note is marked withheld and this link gives no words, "
                "so unlinking would print its name; left as written (--as "
                "WORDS gives the words)",
}


def _retarget(new: str, keep_text: bool) -> Fix:
    def fix(parsed: tuple[str, str, str], embed: bool, in_fm: bool,
            line: str) -> tuple[str | None, str]:
        dest, sub, shown = parsed
        if keep_text and not shown and not embed and not in_fm:
            # In a table cell a bare pipe would end the cell.
            pipe = "\\|" if line.lstrip(" \t>").startswith("|") else "|"
            shown = pipe + link_name(dest)
        return f"{'!' if embed else ''}[[{new}{sub}{shown}]]", ""
    return fix


def _in_table_row(line: str) -> bool:
    """Whether a line is a table row: it holds a cell pipe, at the margin
    or not (`noon | [[Scene]] | next` is a row too). The pipe inside a
    link and an escaped one are not cell pipes. A line of prose with a
    pipe in it reads as a row, which only costs a backslash that Markdown
    does not print."""
    return re.search(r"(?<!\\)\|", LINK_RE.sub("", line)) is not None


def _unlink_as(bare: str | None, withheld: set[str] | None = None) -> Fix:
    """Turn a link into its words: its display text, else `bare` when
    given, else the name as written. The name of a withheld note is never
    the words: such a link with none of its own is kept."""
    def fix(parsed: tuple[str, str, str], embed: bool, in_fm: bool,
            line: str) -> tuple[str | None, str]:
        if in_fm:
            return None, "frontmatter"
        if embed:
            return None, "embed"
        dest, _sub, shown = parsed
        words = shown.lstrip("\\")[1:].strip() if shown else ""
        if not words and bare and _in_table_row(line):
            # In a table cell a bare pipe in the words would end the cell.
            return re.sub(r"(?<!\\)\|", r"\\|", bare), ""
        if withheld and not words and not bare and \
                normalize(link_name(dest).split("/")[-1]) in withheld:
            return None, "withheld"
        return words or bare or link_name(dest), ""
    return fix


_unlink = _unlink_as(None)


# Whether a link (its body) is one the fix is for: True, False, or a key of
# KEPT when it might be and is left alone.
Match = Callable[[str], "bool | str"]


def _rewrite(rel: str, text: str, match: Match, fix: Fix,
             p: Plan) -> str:
    out: list[str] = []
    for ll in link_lines(text):
        if ll.in_code:
            out.append(ll.line)
            continue

        def sub(m: re.Match[str], ll: LinkLine = ll) -> str:
            wanted = match(m.group(1))
            if wanted is False:
                return m.group(0)
            if wanted is not True:
                p.kept.append((rel, ll.lineno, m.group(0), wanted))
                return m.group(0)
            parsed = _parse_link(m.group(1))
            if parsed is None:
                return m.group(0)
            after, why = fix(parsed, m.group(0).startswith("!"),
                             ll.in_frontmatter, ll.line)
            if after is None:
                p.kept.append((rel, ll.lineno, m.group(0), why))
                return m.group(0)
            if after != m.group(0):
                p.changes.append(Change(rel, ll.lineno, m.group(0), after))
            return after
        out.append(sub_wikilinks(ll.line, ll.spans, sub))
    return "".join(out)


def _plan(vault: Path, targets: set[str], fix: Fix,
          only: set[str] | None = None, match: Match | None = None) -> Plan:
    """`targets` are link targets by name (`link_target`); `match`, when
    given, decides link by link instead (a name given with its path)."""
    if match is None:
        def match(body: str) -> bool:
            return link_target(body) in targets
    p = Plan(vault)
    for rel in _walk(vault, ".md"):
        if only is not None and _nfc(rel) not in only:
            continue
        text = _read(vault, rel)
        if text is None:
            for body in LINK_RE.findall(_raw(vault, rel)):
                if match(body) is not False:
                    raise LinksError(
                        f"{rel} is not valid UTF-8 and links to "
                        f"{link_name(body)}; fix its encoding first")
            continue
        new = _rewrite(rel, text, match, fix, p)
        if new != text:
            p.originals[rel], p.texts[rel] = text, new
    return p


def _broken_names(vault: Path, names: list[str]) -> set[str]:
    """The names as link targets, widened to every broken spelling in the
    same row; refuses one that is not a broken link."""
    _notes, known, _outbound, spellings = graph_check.collect(vault, [])
    missing = graph_check.broken(vault, known, spellings)
    asked = set()
    for name in names:
        target = link_target(name)
        if target not in missing:
            raise LinksError(f"{name} is not a broken link: nothing links "
                             f"to it, or a note already answers to it")
        asked.add(_group_key(target))
    return {t for t in missing if _group_key(t) in asked}


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


def plan_unlink(vault: Path, names: list[str],
                within: list[str] | None = None,
                bare: str | None = None,
                take_bare: bool = False) -> Plan:
    """`within` keeps the fix to those notes, and then a name need not be
    broken: a link to a note that exists is turned into words there."""
    if not within:
        return _plan(vault, _broken_names(vault, names), _unlink)
    notes = {_nfc(n) for n in _walk(vault, ".md")}
    only = set()
    for note in within:
        rel = _nfc(resolve_old(vault, note))
        if rel not in notes:
            raise LinksError(f"there is no note {note}")
        only.add(rel)
    withheld = _withheld_names(vault, names)
    return _plan(vault, set(), _unlink_as(bare, withheld), only,
                 _names_match(vault, names, sorted(notes), take_bare))


def _withheld_names(vault: Path, names: list[str]) -> set[str]:
    """Which of NAMES mean a note marked `withheld: true`, as the
    `normalize`d last part of the name. A NAME is the note's file name, its
    title, or one of its aliases or gm_aliases (a link may use any of them,
    and unlinking one would print it)."""
    wanted = {_segments(n)[-1] for n in names if _segments(n)}
    found: set[str] = set()
    for rel in _walk(vault, ".md"):
        try:
            fm = extract_frontmatter((vault / rel).read_text(encoding="utf-8"))
        except (OSError, UnicodeError):
            continue
        if not is_withheld(fm):
            continue
        own = [_stem(rel), str(fm.get("title") or "")] + link_aliases(fm)
        if isinstance(fm.get("aliases"), str):
            own.append(fm["aliases"])
        for name in own:
            key = normalize(name.strip().strip("[]").split("/")[-1])
            if key in wanted:
                found.add(key)
    return found


def _segments(path: str) -> list[str]:
    """A note path or a link's destination as its folders and name, each
    read the way a link is (`normalize`), `.md` and any #heading off."""
    path = path.replace("\\", "/").split("#")[0].split("^")[0]
    path = path.strip().strip("/")
    if path.lower().endswith(".md"):
        path = path[:-3]
    return [normalize(part) for part in path.split("/") if part.strip()]


def _names_match(vault: Path, names: list[str], notes: list[str],
                 take_bare: bool = False) -> Match:
    """The links `unlink --in` is for: those that go to the note each NAME
    means, and to no other. Two notes can share a name in different
    folders. A NAME given with its path means that one: a link written
    with a path must lead to it, and a link written bare is taken only
    when no other note has the name (otherwise it is left and listed,
    or taken with `take_bare`). A bare NAME that two notes share is
    refused."""
    asked: list[tuple[list[str], list[list[str]]]] = []
    for name in names:
        want = _segments(name)
        if not want:
            continue
        same = [_segments(n) for n in notes if _segments(n)[-1:] == want[-1:]]
        if len(want) == 1 and len(same) > 1:
            found = [n for n in notes if _segments(n)[-1:] == want[-1:]]
            raise LinksError(f"{len(found)} notes are named {name}: "
                             f"{', '.join(found)}; give the path")
        # The note NAME means: the one its path ends, else the path as given
        # (a note that is not there: every link to the name is a broken one).
        meant = [s for s in same if s[-len(want):] == want]
        asked.append((meant[0] if meant else want, same))

    def match(body: str) -> bool | str:
        parsed = _parse_link(body)
        dest = _segments(parsed[0] if parsed else link_name(body))
        if not dest:
            return False
        verdict: bool | str = False
        for note, same in asked:
            if dest[-1] != note[-1]:
                continue
            if len(dest) > 1:
                # With no note of the name at all, a bare NAME is a broken
                # link's, whatever folder each link gives it.
                if note[-len(dest):] == dest or (not same and len(note) == 1):
                    return True
            elif not same or same == [note]:
                return True
            elif note in same:
                if take_bare:
                    return True
                verdict = "ambiguous"
        return verdict
    return match


def apply(p: Plan) -> None:
    """Write every note of the plan, or leave the vault exactly as it was."""
    try:
        write_all_or_none(p.vault, p.originals, p.texts, read=_read,
                          what="the fix", holds="the new links",
                          write=write_text_atomic)
    except StepFailed as e:
        raise LinksError(str(e)) from e


def rows(p: Plan, done: bool = False) -> list[str]:
    verb = "CHANGED" if done else "WOULD-CHANGE"
    out = [f"{verb}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
           for c in p.changes]
    out += [f"KEPT\t{rel}:{lineno}\t{link}\t{KEPT[why]}"
            for rel, lineno, link, why in p.kept]
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
    ap.add_argument("--in", dest="within", action="append", metavar="NOTE")
    ap.add_argument("--as", dest="bare", metavar="WORDS")
    ap.add_argument("--bare", dest="take_bare", action="store_true")
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
    if args.within and args.command != "unlink":
        usage = "--in goes with unlink"
    elif (args.bare is not None or args.take_bare) and not args.within:
        usage = "--as and --bare go with unlink --in"
    elif args.bare is not None and not args.bare.strip():
        usage = "--as takes the words to print"
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
            p = plan_unlink(args.vault, args.names, args.within,
                            args.bare, args.take_bare)
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
