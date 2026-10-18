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
`_Templates` and `_inbox` are not read. A note whose frontmatter does not
read has no tones in the report: a last `#` line names it (`uses` ends
with the same line).

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
import json
import sys
import unicodedata
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from migrate_core import StepFailed
from schema_rules import (
    tone_families,
    tone_key,
    tone_proposal,
)
from vaultlib import (UNCHECKED_DIRS, PublishToolUnavailable,
                      SettingsUnavailable,
                      run_relationships, settings)


class TonesError(StepFailed):
    """A fix refused or failed, or the tool could not be asked. The message
    is one line. A StepFailed, so the update reports it as the step's and
    goes on."""


@dataclass
class Use:
    rel: str
    lineno: int
    raw: str
    target: str = ""        # the edge's target, as written
    description: str = ""   # the edge's description, on one line


def _ask(vault: Path, args: list[str]) -> Any:
    """Ask the publish tool's relationships reader (the one parser of a
    note's `relationships:` block), keeping out the folders the tone tidy
    has never read. Its refusal or silence is one TonesError line."""
    skip = [a for d in UNCHECKED_DIRS for a in ("--skip", d)]
    try:
        return run_relationships(vault, [*args, *skip])
    except PublishToolUnavailable as e:
        raise TonesError(str(e)) from e


def _listed(vault: Path) -> dict[str, Any]:
    """The tool's list: `tones` (one row per tone) and `unread` (the notes
    whose frontmatter does not read, so their tones are not in it)."""
    answer = _ask(vault, ["list"])
    if not (isinstance(answer, dict) and isinstance(answer.get("tones"), list)
            and isinstance(answer.get("unread"), list)):
        raise TonesError("the publish tool's tone list was not what was "
                         "expected")
    return answer


def survey_and_unread(vault: Path) -> tuple[list[Use], list[str]]:
    """Every tone on every relationship of every checked note, and the
    notes that could not be read."""
    answer = _listed(vault)
    return ([Use(r["rel"], r["line"], r["tone"], r["target"],
                 r["description"]) for r in answer["tones"]],
            sorted(u["rel"] for u in answer["unread"]))


def survey(vault: Path) -> list[Use]:
    """Every tone on every relationship of every checked note."""
    return survey_and_unread(vault)[0]


def unread_line(unread: list[str]) -> list[str]:
    """One `#` line naming the notes whose tones were not read, or none."""
    if not unread:
        return []
    n = len(unread)
    return [f"# {n} note{'' if n == 1 else 's'} not read (the frontmatter "
            f"does not read; campaign-qa's Graph Health names the fault): "
            + "; ".join(unread[:3]) + (f"; +{n - 3} more" if n > 3 else "")]


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
    """The vault file's `player_site.hide.fields` strips `relationships`, and
    no `player_site.hide.field_exceptions` entry mentions it (a per-note `include` would
    re-admit it for that note; which notes is not worked out, so none is
    skipped)."""
    s = settings(vault)
    if s.origins["player_site.hide.fields"] != "file":
        return False
    if not _hides_relationships(s.get("player_site.hide.fields")):
        return False
    return "relationships" not in json.dumps(s.get("player_site.hide.field_exceptions"))


def shown_edges(vault: Path, published: set[str]
                ) -> Iterator[dict[str, Any]]:
    """Every relationship a published note shows on the site with a tone
    the site draws (a listed word), as the tool lists it (`rel`, `line`,
    `tone`, `target`, `description`)."""
    # The vault's own exclude_fields; a list only the site file holds is not
    # known here, and its notes are listed (the safe side).
    if _campaign_hides_relationships(vault):
        return
    for edge in _listed(vault)["tones"]:
        rel = edge["rel"]
        if (edge["gmOnly"] or not site_family(edge["tone"])
                or unicodedata.normalize("NFC", rel) not in published):
            continue
        if not edge["hidesRelationships"]:
            yield edge


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
    for edge in shown_edges(vault, published):
        if site_family(edge["tone"]) != "negative":
            continue
        rows.append("\t".join([
            f"{edge['rel']}:{edge['line']}", edge["tone"],
            _one_line(edge["target"]),
            _one_line(edge["description"], DESCRIPTION_CAP)]))
        notes.add(edge["rel"])
    n, m = len(rows), len(notes)
    rows.append(f"# {n} hostile tie{'' if n == 1 else 's'} shown on "
                f"{m} note{'' if m == 1 else 's'}")
    return rows


@dataclass
class Change:
    rel: str
    lineno: int
    before: str
    after: str


@dataclass
class Plan:
    vault: Path
    # The tool's answer: the changes it makes (or would make), the ties it
    # left as written, and the notes it writes.
    changes: list[Change] = field(default_factory=list)
    kept: list[tuple[str, int, str, str]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    # The rewrites asked of the tool, as `--set OLD=NEW` arguments.
    sets: list[str] = field(default_factory=list)


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


def _run_fix(p: Plan, write: bool) -> None:
    """Ask the tool for the rewrite (`fix --kind tone`), as a preview or
    written to every note or none, and take its answer into the plan."""
    args = ["fix", "--kind", "tone"]
    for pair in p.sets:
        args += ["--set", pair]
    if write:
        args.append("--write")
    answer = _ask(p.vault, args)
    try:
        p.changes = [Change(c["rel"], c["line"], c["before"], c["after"])
                     for c in answer["changes"]]
        p.kept = [(k["rel"], k["line"], k["tone"], k["why"])
                  for k in answer["kept"]]
        p.notes = list(answer["notes"])
    except (KeyError, TypeError) as e:
        raise TonesError("the publish tool's answer to the tone fix was not "
                         "what was expected") from e


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

    # Each distinct word as written, with the listed word it becomes; the
    # tool finds the lines, keeps the quotes and the comments, and refuses
    # what it cannot edit in place.
    wanted = {u.raw: new for u in uses if (new := becomes(u.raw))}
    p = Plan(vault, sets=[f"{old}={new}" for old, new in wanted.items()])
    if p.sets:
        _run_fix(p, write=False)
    return p


def apply(p: Plan) -> None:
    """Write every note of the plan, or leave the vault exactly as it was."""
    if p.sets:
        _run_fix(p, write=True)


def rows(p: Plan, done: bool = False) -> list[str]:
    verb = "CHANGED" if done else "WOULD-CHANGE"
    out = [f"{verb}\t{c.rel}:{c.lineno}\t{c.before} -> {c.after}"
           for c in p.changes]
    out += [f"KEPT\t{rel}:{lineno}\t{tone}\t{why}; edit the note"
            for rel, lineno, tone, why in p.kept]
    return out + [f"# {len(p.changes)} tone(s) in {len(p.notes)} note(s)"
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
            uses, unread = survey_and_unread(args.vault)
            print("\n".join([*report_lines(uses), *unread_line(unread)]))
            return 0
        if args.command == "uses":
            uses, unread = survey_and_unread(args.vault)
            print("\n".join([*use_lines(uses, args.words),
                             *unread_line(unread)]))
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
    except (TonesError, SettingsUnavailable) as e:
        print(f"tones.py: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt as e:
        print(f"tones.py: interrupted; {e}" if str(e)
              else "tones.py: interrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
