#!/usr/bin/env python3
"""moments.py: a wrap-up's Memorable Moments, as the Story page reads them,
and the `#moment/<kind>` tag each one carries.

    moments.py VAULT status
    moments.py VAULT list [--except WRAPUP]
    moments.py VAULT show WRAPUP
    moments.py VAULT check WRAPUP
    moments.py VAULT tag WRAPUP [--write]          < rows: N<TAB>kind
    moments.py VAULT offered

status: `moments on|off` (on when a site, the player's or the GM's, is on
and `player_site.story.moments` is on), the kinds, and when on whether the
one back-fill offer was made (and if not, how many past wrap-ups it would
cover). list: the wrap-ups with no moments or untagged ones, leaving out
one that never publishes and, with --except, this session's. show: one
wrap-up's moments, numbered, each with its kind, `-` for none or `n/a` for
a heading or table, which takes no tag. check: each untagged moment
(UNTAGGED) and each tag that names no kind (UNKNOWN, exit 1), for a
wrap-up just written. tag: puts each row's kind on moment N, at the end of
its last line; the moment's old tags (a kind, or a word that is none,
inline or a paragraph of its own) are taken out. The publish tool then
reads the note again, and unless every card shows exactly as before with
only the kinds given changed, nothing is written. Without --write it
prints its plan. offered: records in the vault's state file that the
back-fill offer was made, so it is not made again.

A moments section the strip chain hides from players (gm-only, a comment)
is "hidden": never listed, never tagged, never written beside.

Which text is a moment, and the five kinds, are the publish tool's (the
`lines` op `moments`, story-moments.js), asked of the tool the vault's
site builds with; nothing here reads a card a second way. Picking a
moment's kind is the apprentice's judgement; this only writes it. Exit: 0
done, 1 refused (nothing written), 2 bad arguments.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

import vault_check as vc
import vaultlib as vl
import vault_write as vw

OFFERED_KEY = "moments_backfill_offered"
# A tag ending a line (a kind, or a word that is none), with the emphasis
# marks after it.
END_TAG_RE = re.compile(r"\s#moment/[\w-]+([*_]*)\s*$")
ROW_RE = re.compile(r"^\s*(\d+)\t\s*([^\t]+?)\s*$")
# What a card shows; a tag may change only its kind.
SHOWN = ("shape", "main", "speaker", "context")
HIDDEN = "Memorable Moments hidden from players (gm-only); nothing to do"


class Refused(Exception):
    """One line; nothing is written."""


def site_tool(vault: Path) -> None:
    """Ask the publish tool the vault's site builds with, as relink does.
    A vault with no site, or one still to be set up, asks the plugin's."""
    try:
        if vl.vault_site(vault)[2] is None:
            return
    except vl.PublishToolUnavailable as e:
        raise Refused(f"could not ask the publish tool: {e}") from None
    tool, why, fix, has_site = vc._lines_tool(vault)
    if tool is not None:
        vl.use_publish_tool(tool)
    elif has_site:
        raise Refused("; ".join(x for x in (why, fix) if x)
                      or "the site's publish tool cannot be found")


def _callouts(vault: Path) -> Any:
    try:
        return vc.vault_settings(vault).get("player_site.hide.callouts")
    except (vl.SettingsUnavailable, KeyError) as e:
        raise Refused(str(e)) from None


def ask(text: str, callouts: Any = False) -> dict[str, Any]:
    """The tool's reading of a body: {kinds, section}."""
    try:
        answer = vl.PUBLISH_LINES.ask(
            {"op": "moments", "text": text, "excludeCallouts": callouts})
    except vl.PublishToolUnavailable as e:
        raise Refused(f"could not ask the publish tool: {e}") from None
    kinds = answer.get("kinds")
    section = answer.get("section", False)
    if (not isinstance(kinds, list) or section is False
            or (section and "hidden" not in section)):
        raise Refused("the publish tool did not answer about moments (it "
                      "may be older than this script)")
    return answer


def kinds() -> list[str]:
    return [str(k) for k in ask("")["kinds"]]


def section_of(text: str, callouts: Any) -> tuple[int, dict[str, Any] | None]:
    offset, body = vl.body_and_offset(text)
    return offset, ask(body, callouts)["section"]


def taggable(section: dict[str, Any] | None) -> list[dict[str, Any]]:
    return [c for c in (section or {}).get("cards", []) if c.get("taggable")]


def counts(section: dict[str, Any] | None) -> tuple[int, int]:
    cards = taggable(section)
    return len(cards), sum(1 for c in cards if not c.get("kind"))


def wrapups(vault: Path) -> list[tuple[str, str]]:
    return [(rel, text) for rel, text in vl.vault_files(vault, newline="")
            if not vw.is_record(rel)
            and vl.entity_type(vl.extract_frontmatter(text) or {})
            in vc.WRAP_TYPES]


def moments_on(vault: Path) -> bool:
    try:
        own = vl.settings(vault)
        sites = own.get("player_site.publish") is True \
            or own.get("gm_site.publish") is True
        return sites and vc.story_moments_on(vc.vault_settings(vault))
    except (vl.SettingsUnavailable, KeyError) as e:
        raise Refused(str(e)) from None


def to_do(vault: Path, skip: str | None = None
          ) -> list[tuple[str, int, int]]:
    """(wrap-up, moments, untagged) for each with none or untagged ones.
    Left out: `skip` (this session's), one the site never publishes
    (`publish: false`) and one whose moments are hidden from players."""
    callouts = _callouts(vault)
    out = []
    for rel, text in wrapups(vault):
        if rel == skip or vl.publish_mode(
                vl.extract_frontmatter(text) or {}) == "none":
            continue
        section = section_of(text, callouts)[1]
        if section and section["hidden"]:
            continue
        n, bare = counts(section)
        if n == 0 or bare:
            out.append((rel, n, bare))
    return out


def _many(n: int) -> str:
    return f"{n} moment{'' if n == 1 else 's'}"


def _counts(todo: list[tuple[str, int, int]]) -> str:
    none = sum(1 for _r, n, _b in todo if n == 0)
    return (f"{none} wrap-up{'' if none == 1 else 's'} without moments, "
            f"{len(todo) - none} with untagged ones")


def cmd_status(vault: Path) -> list[str]:
    if not moments_on(vault):
        # Nothing more is asked: a site tool older than the moments
        # question must not stop a wrap-up that does not use it.
        return ["moments\toff"]
    rows = ["moments\ton", f"kinds\t{', '.join(kinds())}"]
    try:
        offered = vl.read_state(vault).get(OFFERED_KEY)
    except vl.StateUnreadable as e:
        raise Refused(str(e)) from None
    if offered:
        rows.append(f"backfill\toffered {offered}")
        return rows
    todo = to_do(vault)
    if not todo:
        rows.append("backfill\tnothing to offer")
    else:
        rows.append(f"backfill\tnot offered: {_counts(todo)} "
                    f"(moments.py list)")
    return rows


def cmd_list(vault: Path, skip: str | None = None) -> list[str]:
    if skip is not None:
        skip = _wrapup(vw.Batch(vault), skip)
    todo = to_do(vault, skip)
    return [f"# {_counts(todo)}",
            *(f"{rel}\t{_many(n)}\t{bare} untagged" if n else f"{rel}\tno moments"
              for rel, n, bare in todo)]


def _wrapup(batch: vw.Batch, raw: str) -> str:
    try:
        return batch.note_named(raw, vc.WRAP_TYPES, "wrapup")
    except vw.WriteError as e:
        raise Refused(str(e)) from None


def _read_section(vault: Path, raw: str
                  ) -> tuple[str, dict[str, Any] | None, list[str]]:
    """(the wrap-up, its moments section or None, each card's text)."""
    batch = vw.Batch(vault)
    rel = _wrapup(batch, raw)
    text = batch.read(rel)
    offset, section = section_of(text, _callouts(vault))
    if section is None or section["hidden"]:
        return rel, section, []
    lines = text.replace("\r\n", "\n").split("\n")
    said = []
    for card in section["cards"]:
        first, last = card.get("first"), card.get("last")
        said.append("" if first is None or last is None else " / ".join(
            ln.strip() for ln in lines[offset + first:offset + last + 1]
            if ln.strip()))
    return rel, section, said


def _none(rel: str, section: dict[str, Any] | None) -> str:
    return (f"# {rel}: {HIDDEN}" if section
            else f"# {rel}: no Memorable Moments section")


def cmd_show(vault: Path, raw: str) -> list[str]:
    rel, section, said = _read_section(vault, raw)
    if section is None or section["hidden"]:
        return [_none(rel, section)]
    n, bare = counts(section)
    out = [f"# {rel} §{section['title']}: {_many(n)}, {bare} untagged"]
    for i, card in enumerate(section["cards"], 1):
        kind = (card.get("kind") or "-") if card.get("taggable") else "n/a"
        out.append(f"{i}\t{kind}\t{said[i - 1]}")
    return out


def cmd_check(vault: Path, raw: str) -> tuple[list[str], int]:
    """Each untagged card and each tag that names no kind; exit 1 on the
    latter (a card the site draws with no kind, and a warning)."""
    rel, section, said = _read_section(vault, raw)
    if section is None or section["hidden"]:
        return [_none(rel, section)], 0
    out = [f"UNTAGGED\t{i}\t{said[i - 1]}"
           for i, card in enumerate(section["cards"], 1)
           if card.get("taggable") and not card.get("kind")]
    unknown = [str(w) for w in section.get("unknownTags") or []]
    names = ", ".join(kinds())
    out += [f"UNKNOWN\t#moment/{w}\tnot a kind ({names})" for w in unknown]
    n, bare = counts(section)
    out.append(f"# {_many(n)}: {bare} untagged, {len(unknown)} unknown "
               f"kind{'' if len(unknown) == 1 else 's'}")
    return out, 1 if unknown else 0


def _untag(line: str) -> str:
    """The line with a tag at its end taken out; a `\\r` ending is kept."""
    end = "\r" if line.endswith("\r") else ""
    core = line[:-1] if end else line
    m = END_TAG_RE.search(core)
    if m:
        core = core[:m.start()] + m.group(1)
    return core + end


def _tagged(line: str, kind: str) -> str:
    """The line with `#moment/<kind>` at its end, a tag there replaced."""
    end = "\r" if line.endswith("\r") else ""
    core = _untag(line)
    core = core[:-1] if end else core
    return f"{core.rstrip()} #moment/{kind}{end}"


def _rows(rows_in: str, known: list[str], cards: list[dict[str, Any]],
          rel: str) -> dict[int, str]:
    wanted: dict[int, str] = {}
    for line in rows_in.splitlines():
        if not line.strip():
            continue
        m = ROW_RE.match(line)
        if not m:
            raise Refused(f"not a row (N<TAB>kind): {line!r}")
        n, kind = int(m.group(1)), m.group(2).lower()
        if kind not in known:
            raise Refused(f"{kind!r} is not a kind ({', '.join(known)})")
        if not 1 <= n <= len(cards):
            raise Refused(f"{rel} has no moment {n} ({len(cards)} moments)")
        if not cards[n - 1].get("taggable"):
            raise Refused(f"{rel}: moment {n} is a heading or a table, which "
                          f"takes no tag")
        if n in wanted and wanted[n] != kind:
            raise Refused(f"moment {n} is given two kinds")
        wanted[n] = kind
    if not wanted:
        raise Refused("nothing on stdin")
    return wanted


def cmd_tag(vault: Path, raw: str, rows_in: str, write: bool) -> str:
    batch = vw.Batch(vault)
    rel = _wrapup(batch, raw)
    text = batch.read(rel)
    callouts = _callouts(vault)
    offset, section = section_of(text, callouts)
    if section is None:
        raise Refused(f"{rel}: no Memorable Moments section")
    if section["hidden"]:
        raise Refused(f"{rel}: {HIDDEN}")
    cards = section["cards"]
    wanted = _rows(rows_in, kinds(), cards, rel)
    lines: list[str | None] = list(text.split("\n"))
    title = section["title"]
    for n, kind in sorted(wanted.items()):
        card = cards[n - 1]
        tags = card.get("tags") or []
        last = offset + card["last"]
        if (card.get("kind") == kind and len(tags) == 1
                and not tags[0]["lone"] and offset + tags[0]["line"] == last):
            batch.row("SKIP", rel, f"§{title} {n}",
                      f"already #moment/{kind}")
            continue
        for tag in tags:
            at = offset + tag["line"]
            held = lines[at]
            if held is None:
                continue
            if tag["lone"]:
                lines[at] = None
                # The paragraph goes with the blank line before it.
                if at > 0 and lines[at - 1] is not None \
                        and lines[at - 1].strip() == "":
                    lines[at - 1] = None
            else:
                lines[at] = _untag(held)
        held = lines[last]
        if held is None:
            raise Refused(f"{rel}: moment {n} has no line the tag can go on")
        lines[last] = _tagged(held, kind)
        old = card.get("kind")
        batch.row("WOULD-ADD", rel, f"§{title} {n}", f"#moment/{kind}"
                  + (f" (replaces #moment/{old})" if old and old != kind
                     else ""))
    new = "\n".join(x for x in lines if x is not None)
    if new != text:
        # The tool reads the tagged text again: every card shows as before,
        # only the kinds given changed, or nothing is written.
        _o, after = section_of(new, callouts)
        got = (after or {}).get("cards", [])
        if len(got) != len(cards):
            raise Refused(f"{rel}: tagging would change the moments; tag "
                          f"them by hand")
        for i, (was, now) in enumerate(zip(cards, got), 1):
            want = wanted.get(i, was.get("kind"))
            if now.get("kind") != want or any(
                    now.get(k) != was.get(k) for k in SHOWN):
                raise Refused(f"{rel}: moment {i} would not show as before "
                              f"with its tag; tag it by hand")
        batch.put(rel, new)
        vw.check_fences(batch)
    wrote = False
    if write and batch.changed():
        try:
            vw.apply(batch)
        except vw.WriteError as e:
            raise Refused(str(e)) from None
        wrote = True
    return vw.emit(batch, wrote)


def cmd_offered(vault: Path) -> list[str]:
    try:
        offered = vl.read_state(vault).get(OFFERED_KEY)
        if offered:
            return [f"SKIP\t{vl.STATE_FILE}\t\talready offered {offered}"]
        today = date.today().isoformat()
        vl.set_state(vault, OFFERED_KEY, today)
    except (vl.StateUnreadable, OSError) as e:
        raise Refused(f"{vl.STATE_FILE} could not be written: {e}"
                      if isinstance(e, OSError) else str(e)) from None
    return [f"ADDED\t{vl.STATE_FILE}\t\t{OFFERED_KEY} {today}"]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="moments.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="on or off, the kinds, the back-fill offer")
    lst = sub.add_parser("list", help="wrap-ups with no moments or untagged ones")
    lst.add_argument("--except", dest="skip", metavar="WRAPUP",
                     help="leave this wrap-up out (this session's)")
    show = sub.add_parser("show", help="one wrap-up's moments, numbered")
    show.add_argument("wrapup")
    check = sub.add_parser(
        "check", help="name untagged moments and tags that are no kind "
        "(exit 1 on the latter)")
    check.add_argument("wrapup")
    tag = sub.add_parser("tag", help="tag moments (stdin: N<TAB>kind rows)")
    tag.add_argument("wrapup")
    tag.add_argument("--write", action="store_true")
    sub.add_parser("offered", help="record that the back-fill was offered")
    return ap


def main(argv: list[str] | None = None, stdin: str | None = None) -> int:
    vw.utf8_output()
    args = build_parser().parse_args(argv)
    vault: Path = args.vault
    if not vault.is_dir():
        print(f"moments.py: {vault} is not a folder", file=sys.stderr)
        return 2
    try:
        if args.command != "offered":
            site_tool(vault)
        if args.command == "tag":
            text = vw.read_stdin() if stdin is None else stdin
            sys.stdout.write(cmd_tag(vault, args.wrapup, text, args.write))
            return 0
        if args.command == "check":
            rows, code = cmd_check(vault, args.wrapup)
            print("\n".join(rows))
            return code
        rows = (cmd_status(vault) if args.command == "status"
                else cmd_list(vault, args.skip) if args.command == "list"
                else cmd_show(vault, args.wrapup) if args.command == "show"
                else cmd_offered(vault))
    except (Refused, vw.WriteError) as e:
        print(f"ERROR\t{e}")
        print("# nothing written")
        return 1
    print("\n".join(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
