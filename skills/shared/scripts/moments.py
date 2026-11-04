#!/usr/bin/env python3
"""moments.py: a wrap-up's Memorable Moments, as the Story page reads them,
and the `#moment/<kind>` tag each one carries.

    moments.py VAULT status
    moments.py VAULT list
    moments.py VAULT show WRAPUP
    moments.py VAULT tag WRAPUP [--write]          < rows: N<TAB>kind
    moments.py VAULT offered

status: `moments on|off` (on when a site, the player's or the GM's, is on
and `player_site.story.moments` is on), the kinds, and when on whether the
one back-fill offer was made (and if not, how many past wrap-ups it would
cover). list: the wrap-ups with no moments or untagged ones. show: one
wrap-up's moments, numbered, each with its kind or `-`. tag: puts each
row's kind on moment N (at the end of its last line; an unknown tag there
is replaced), then asks the publish tool again that every card reads as
tagged; without --write it prints its plan. offered: records in
`_meta/vault-state.json` that the back-fill offer was made, so it is not
made again.

Which text is a moment, and the five kinds, are the publish tool's
(`lines` op `moments`, story-moments.js); nothing here reads a card a
second way. Picking a moment's kind is the apprentice's judgement; this
only writes it. Exit: 0 done, 1 refused (nothing written), 2 bad
arguments.
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
# A tag already ending a line (a kind, or a word that is none), with the
# emphasis marks after it.
END_TAG_RE = re.compile(r"\s#moment/[\w-]+([*_]*)\s*$")
ROW_RE = re.compile(r"^\s*(\d+)\t\s*([^\t]+?)\s*$")


class Refused(Exception):
    """One line; nothing is written."""


def _body(text: str) -> tuple[int, str]:
    """(how many lines come before the body, the body), the body as the
    publisher is handed it (`vaultlib.body_text`)."""
    lines = text.replace("\r\n", "\n").replace("\r", "").split("\n")
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return i + 1, "\n".join(lines[i + 1:])
    return 0, "\n".join(lines)


def ask(text: str) -> dict[str, Any]:
    """The tool's reading of a body: {kinds, section}."""
    try:
        answer = vl.PUBLISH_LINES.ask({"op": "moments", "text": text})
    except vl.PublishToolUnavailable as e:
        raise Refused(f"could not ask the publish tool: {e}") from None
    kinds = answer.get("kinds")
    if not isinstance(kinds, list) or "section" not in answer:
        raise Refused("the publish tool did not answer about moments (it "
                      "may be older than this script)")
    return answer


def kinds() -> list[str]:
    return [str(k) for k in ask("")["kinds"]]


def section_of(text: str) -> tuple[int, dict[str, Any] | None]:
    offset, body = _body(text)
    return offset, ask(body)["section"]


def untagged(section: dict[str, Any] | None) -> tuple[int, int]:
    cards = section["cards"] if section else []
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


def to_do(vault: Path) -> list[tuple[str, int, int]]:
    """(wrap-up, moments, untagged) for each with none or untagged ones."""
    out = []
    for rel, text in wrapups(vault):
        n, bare = untagged(section_of(text)[1])
        if n == 0 or bare:
            out.append((rel, n, bare))
    return out


def cmd_status(vault: Path) -> list[str]:
    on = moments_on(vault)
    rows = [f"moments\t{'on' if on else 'off'}",
            f"kinds\t{', '.join(kinds())}"]
    if not on:
        return rows
    try:
        offered = vl._read_state(vault).get(OFFERED_KEY)
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


def _many(n: int) -> str:
    return f"{n} moment{'' if n == 1 else 's'}"


def _counts(todo: list[tuple[str, int, int]]) -> str:
    none = sum(1 for _r, n, _b in todo if n == 0)
    return (f"{none} wrap-up{'' if none == 1 else 's'} without moments, "
            f"{len(todo) - none} with untagged ones")


def cmd_list(vault: Path) -> list[str]:
    todo = to_do(vault)
    return [f"# {_counts(todo)}",
            *(f"{rel}\t{_many(n)}\t{bare} untagged" if n else f"{rel}\tno moments"
              for rel, n, bare in todo)]


def _wrapup(batch: vw.Batch, raw: str) -> str:
    try:
        return batch.note_named(raw, vc.WRAP_TYPES, "wrapup")
    except vw.WriteError as e:
        raise Refused(str(e)) from None


def cmd_show(vault: Path, raw: str) -> list[str]:
    batch = vw.Batch(vault)
    rel = _wrapup(batch, raw)
    text = batch.read(rel)
    offset, section = section_of(text)
    if section is None:
        return [f"# {rel}: no Memorable Moments section"]
    lines = text.replace("\r\n", "\n").split("\n")
    n, bare = untagged(section)
    out = [f"# {rel} §{section['title']}: {_many(n)}, {bare} untagged"]
    for i, card in enumerate(section["cards"], 1):
        first, last = card.get("first"), card.get("last")
        said = ("" if first is None or last is None else " / ".join(
            ln.strip() for ln in lines[offset + first:offset + last + 1]
            if ln.strip()))
        out.append(f"{i}\t{card.get('kind') or '-'}\t{said}")
    return out


def _tagged(line: str, kind: str) -> str:
    """The line with `#moment/<kind>` at its end, a tag already there
    replaced; a `\\r` ending is kept."""
    end = "\r" if line.endswith("\r") else ""
    core = line[:-1] if end else line
    m = END_TAG_RE.search(core)
    if m:
        core = core[:m.start()] + m.group(1)
    return f"{core.rstrip()} #moment/{kind}{end}"


def cmd_tag(vault: Path, raw: str, rows_in: str, write: bool) -> str:
    batch = vw.Batch(vault)
    rel = _wrapup(batch, raw)
    text = batch.read(rel)
    offset, section = section_of(text)
    if section is None:
        raise Refused(f"{rel}: no Memorable Moments section")
    known = kinds()
    cards = section["cards"]
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
        if n in wanted and wanted[n] != kind:
            raise Refused(f"moment {n} is given two kinds")
        wanted[n] = kind
    if not wanted:
        raise Refused("nothing on stdin")
    lines = text.split("\n")
    title = section["title"]
    for n, kind in sorted(wanted.items()):
        card = cards[n - 1]
        if card.get("kind") == kind:
            batch.row("SKIP", rel, f"§{title} {n}",
                      f"already #moment/{kind}")
            continue
        if card.get("last") is None:
            raise Refused(f"{rel}: moment {n} has no line the tag can go on")
        at = offset + card["last"]
        lines[at] = _tagged(lines[at], kind)
        batch.row("WOULD-ADD", rel, f"§{title} {n}", f"#moment/{kind}")
    new = "\n".join(lines)
    if new != text:
        # The tool reads the tagged text again: every card still there and
        # each with the kind it was given, or nothing is written.
        _o, after = section_of(new)
        got = after["cards"] if after else []
        bad = [n for n, kind in wanted.items()
               if len(got) != len(cards) or got[n - 1].get("kind") != kind]
        if bad:
            raise Refused(f"{rel}: moment {min(bad)} would not read as "
                          f"tagged; tag it by hand")
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
        state = vl._read_state(vault)
    except vl.StateUnreadable as e:
        raise Refused(str(e)) from None
    if state.get(OFFERED_KEY):
        return [f"SKIP\t{vl.STATE_FILE}\t\talready offered "
                f"{state[OFFERED_KEY]}"]
    state[OFFERED_KEY] = date.today().isoformat()
    vl._write_state(vault, state)
    return [f"ADDED\t{vl.STATE_FILE}\t\t{OFFERED_KEY} {state[OFFERED_KEY]}"]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="moments.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="on or off, the kinds, the back-fill offer")
    sub.add_parser("list", help="wrap-ups with no moments or untagged ones")
    show = sub.add_parser("show", help="one wrap-up's moments, numbered")
    show.add_argument("wrapup")
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
        if args.command == "tag":
            text = vw.read_stdin() if stdin is None else stdin
            sys.stdout.write(cmd_tag(vault, args.wrapup, text, args.write))
            return 0
        rows = (cmd_status(vault) if args.command == "status"
                else cmd_list(vault) if args.command == "list"
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
