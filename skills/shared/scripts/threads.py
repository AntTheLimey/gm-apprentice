#!/usr/bin/env python3
"""Shared threads: the entry format and the list operations.

A shared thread is a bullet under `## Open Threads` in the Campaign
Overview, written by `format_shared`:

    - {text} — since {since}; involves [[A]], [[B]]

`involves the party` stands for a thread nobody in particular owns.
PC pages keep their own `**Open threads:**` bullets under
`## Current Status`; a closed thread moves to a Wrap-Up's
`#### Resolved Threads`, never out of the record.

Every writer here takes a note's text and returns the new text, with the
note's line endings (LF or CRLF) kept. Reading and writing the file is the
caller's job (open with newline="" so the endings survive).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from vaultlib import (ANY_LABEL_LINE_RE, BULLET_RE, GM_MARKER_RE, LABEL_RE, atx_title, bullets,
                      fence_step, labelled_block, section)

SECTION = "Open Threads"
RESOLVED = "Resolved Threads"

_PARTY = "the party"
_TAIL_RE = re.compile(
    r"^(?P<text>.*)\s+—\s+(?:since\s+(?P<since>[^;]+?);\s*)?"
    r"involves\s+(?P<who>.+?)\s*$")
_LINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
_LEAD_RE = re.compile(r"^\*\*(.+?)\*\*")
_PLACEHOLDER_RE = re.compile(r"^\{.*\}$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


@dataclass(frozen=True)
class SharedThread:
    text: str
    since: str | None
    involves: list[str]
    party: bool


def format_shared(text: str, since: str | None,
                  involves: list[str] | None) -> str:
    """The bullet line for a shared thread. No `involves` means the party."""
    who = (", ".join(f"[[{name}]]" for name in involves)
           if involves else _PARTY)
    clause = f"since {since}; " if since else ""
    return f"- {text} — {clause}involves {who}"


def parse_shared(line: str) -> SharedThread | None:
    """A bullet line as a SharedThread; None if it is not a bullet. A bullet
    without the `— since …; involves …` tail is the text alone."""
    m = BULLET_RE.match(line)
    if not m:
        return None
    body = m.group(1).strip()
    tail = _TAIL_RE.match(body)
    if tail:
        who = tail.group("who")
        names = [n.strip() for n in _LINK_RE.findall(who)]
        if who == _PARTY:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), [], True)
        if names:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), names, False)
    return SharedThread(body, None, [], False)


def shared_threads(overview_text: str) -> list[SharedThread]:
    """The threads under the Overview's `## Open Threads` section."""
    body = section(overview_text, SECTION)
    if not body:
        return []
    found = (parse_shared(f"- {b}") for b in bullets(body))
    return [t for t in found if t is not None]


def lead(text: str) -> str:
    """The bold lead of a thread (`**Bell —** rings` gives `Bell`), or the
    whole text. Trailing dash, colon and full stop inside the bold go."""
    m = _LEAD_RE.match(text.strip())
    if not m:
        return text.strip()
    return m.group(1).strip().rstrip(" —–-:.").strip()


def pc_threads(pc_text: str) -> list[str]:
    """The `**Open threads:**` bullets under a PC's `## Current Status`."""
    status = section(pc_text, "Current Status")
    block = labelled_block(status, "Open threads") if status else None
    return bullets(block) if block else []


def find_thread(bullet_list: list[str], key: str) -> list[int]:
    """Indexes of the bullets whose whole text, lead (see `lead`) or lead as
    written between the asterisks (`Bell —`) equals `key`."""
    key = key.strip()
    out = []
    for i, b in enumerate(bullet_list):
        m = _LEAD_RE.match(b.strip())
        if key in (b.strip(), lead(b), m.group(1).strip() if m else None):
            out.append(i)
    return out


# --------------------------------------------------------------------------
# Editing: line walks that keep the note's own line endings
# --------------------------------------------------------------------------


def _eol(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def _lines(text: str) -> list[str]:
    """Lines split on "\\n" only, so a stray CR or U+2028 cannot shift
    them; a CRLF note keeps its CR on each line and `_new` adds it back."""
    return text.split("\n")


def _new(text: str, eol: str) -> str:
    return text + ("\r" if eol == "\r\n" else "")


def _blank(line: str) -> bool:
    return not line.strip()


def _headings(lines: list[str]) -> list[tuple[int, int, str]]:
    """(index, level, title) of every heading outside a code fence."""
    out = []
    delim: str | None = None
    for i, raw in enumerate(lines):
        line = raw.rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        m = _HEADING_RE.match(line)
        if m:
            out.append((i, len(m.group(1)), atx_title(m.group(2))))
    return out


def _heading_end(lines: list[str], heads: list[tuple[int, int, str]],
                 at: int) -> int:
    """Index just past the section under heading number `at`: the next
    heading of the same or a higher level, else the end."""
    level = heads[at][1]
    for idx, lvl, _title in heads[at + 1:]:
        if lvl <= level:
            return idx
    return len(lines)


def _stop_end(lines: list[str], start: int, end: int) -> int:
    """`end`, or the first gm-only marker line in (start, end) — the fence
    a block must stay inside."""
    for i in range(start + 1, end):
        if GM_MARKER_RE.search(lines[i]):
            return i
    return end


def _put_after_content(lines: list[str], start: int, end: int,
                       new: list[str]) -> list[str]:
    """`lines` with `new` placed after the last non-blank line in
    [start, end), blank lines around it kept as they were."""
    last = end
    while last > start and _blank(lines[last - 1]):
        last -= 1
    return lines[:last] + new + lines[last:]


def _outside_fence(lines: list[str], floor: int, pos: int,
                   scan: bool = True) -> int:
    """`pos`, moved up so an insert there is outside any gm-only fence: it
    stops at the first gm marker after `floor` (unless `scan` is off, for a
    `pos` that starts a heading, where earlier closed fences are fine), and
    steps back over blank lines and gm-only openers directly above."""
    for i in range(floor + 1, pos) if scan else ():
        if GM_MARKER_RE.search(lines[i]):
            pos = i
            break
    while True:
        back = pos
        while back > floor + 1 and _blank(lines[back - 1]):
            back -= 1
        if back > floor + 1 and GM_MARKER_RE.search(lines[back - 1]):
            pos = back - 1
        else:
            return pos


def _join(lines: list[str], eol: str) -> str:
    """The lines joined with the note's line ending; in a CRLF note a line
    that came without its CR (the last one of a note with no final newline)
    gets it."""
    if eol == "\r\n":
        lines = [l if l.endswith("\r") else l + "\r"
                 for l in lines[:-1]] + lines[-1:]
    return "\n".join(lines)


def insert_shared(overview_text: str, line: str) -> str:
    """Add `line` under `## Open Threads`, creating the section after
    `## Current Arc` (else before the first `## GM Notes`, else at the end).
    The insert point is always outside a gm-only fence: the section is
    player-facing."""
    eol = _eol(overview_text)
    lines = _lines(overview_text)
    heads = _headings(lines)
    for at, (idx, lvl, title) in enumerate(heads):
        if lvl == 2 and title.casefold() == SECTION.casefold():
            end = _outside_fence(lines, idx, _heading_end(lines, heads, at))
            return _join(_put_after_content(
                lines, idx, end, [_new(line, eol)]), eol)
    pos = None
    for at, (idx, lvl, title) in enumerate(heads):
        if lvl == 2 and title.casefold() == "current arc":
            pos = _outside_fence(lines, idx, _heading_end(lines, heads, at))
            break
    if pos is None:
        for idx, lvl, title in heads:
            if lvl == 2 and title.casefold() == "gm notes":
                pos = _outside_fence(lines, -1, idx, scan=False)
                break
    if pos is None:
        pos = len(lines)
    head = lines[:pos]
    while head and _blank(head[-1]):
        head.pop()
    tail = lines[pos:]
    while tail and _blank(tail[0]):
        tail.pop(0)
    blank = _new("", eol)
    block = [blank, _new(f"## {SECTION}", eol), blank, _new(line, eol)]
    if any(not _blank(t) for t in tail):
        return _join(head + block + [blank] + tail, eol)
    return _join(head + block + [""], eol)


def _path_span(lines: list[str], path: tuple[str, ...]) -> tuple[int, int]:
    """(start, end) line indexes of the section `path` names: each element
    is a heading title, found inside the one before; a final `**Label**`
    element selects that bold-label block. KeyError if one is missing."""
    heads = _headings(lines)
    start, end = 0, len(lines)
    for step in path:
        label = re.fullmatch(r"\*\*(.+?):?\*\*", step)
        if label:
            name = label.group(1).strip().casefold()
            for i in range(start, end):
                m = LABEL_RE.match(lines[i].strip())
                if m and m.group(1).strip().casefold() == name:
                    stop = end
                    for j in range(i + 1, end):
                        if ANY_LABEL_LINE_RE.match(lines[j].strip()):
                            stop = j
                            break
                    start, end = i, stop
                    break
            else:
                raise KeyError(step)
            continue
        for at, (idx, _lvl, title) in enumerate(heads):
            if start <= idx < end and title.casefold() == step.casefold():
                start, end = idx, min(_heading_end(lines, heads, at), end)
                break
        else:
            raise KeyError(step)
    return start, end


def remove_bullet(text: str, section_path: tuple[str, ...],
                  index: int) -> str:
    """`text` without bullet number `index` (0-based, document order) of the
    section `section_path` names, plus any indented lines wrapped under it.
    KeyError for a missing section, IndexError for a missing bullet."""
    eol = _eol(text)
    lines = _lines(text)
    start, end = _path_span(lines, section_path)
    seen = -1
    for i in range(start, end):
        if BULLET_RE.match(lines[i].rstrip("\r")):
            seen += 1
            if seen == index:
                stop = i + 1
                while (stop < end and lines[stop].strip()
                       and lines[stop][:1] in " \t"
                       and not BULLET_RE.match(lines[stop].rstrip("\r"))):
                    stop += 1
                return "\n".join(lines[:i] + lines[stop:])
    raise IndexError(f"no bullet {index} under {' > '.join(section_path)}")


def append_resolved(wrapup_text: str, line: str) -> str:
    """Add `line` under the Wrap-Up's `#### Resolved Threads`, creating the
    heading right after the `#### Unresolved Threads` block (inside
    `### What Carries Forward`, before the closing gm-only marker). A lone
    `{…}` placeholder under an existing heading is dropped."""
    eol = _eol(wrapup_text)
    lines = _lines(wrapup_text)
    heads = _headings(lines)
    blank = _new("", eol)
    for at, (idx, lvl, title) in enumerate(heads):
        if title.casefold() == RESOLVED.casefold():
            end = _stop_end(lines, idx, _heading_end(lines, heads, at))
            kept = [lines[idx]] + [
                l for l in lines[idx + 1:end]
                if not _PLACEHOLDER_RE.match(l.strip())]
            lines = lines[:idx] + kept + lines[end:]
            end = idx + len(kept)
            if all(_blank(l) for l in kept[1:]):
                kept = [kept[0], blank, _new(line, eol)]
                lines = lines[:idx] + kept + [blank] + lines[end:]
                return _join(lines, eol)
            return _join(_put_after_content(
                lines, idx, end, [_new(line, eol)]), eol)
    anchor = None
    for at, (idx, lvl, title) in enumerate(heads):
        if title.casefold() == "unresolved threads":
            anchor = at
            break
    if anchor is None:
        for at, (idx, lvl, title) in enumerate(heads):
            if title.casefold() == "what carries forward":
                anchor = at
                break
    if anchor is None:
        raise KeyError("What Carries Forward")
    idx = heads[anchor][0]
    end = _stop_end(lines, idx, _heading_end(lines, heads, anchor))
    last = end
    while last > idx and _blank(lines[last - 1]):
        last -= 1
    block = [blank, _new(f"#### {RESOLVED}", eol), blank, _new(line, eol)]
    rest = lines[last:]
    after = list(rest)
    while after and _blank(after[0]):
        after.pop(0)
    if after and (end < len(lines) or any(not _blank(r) for r in after)):
        return _join(lines[:last] + block + [blank] + after, eol)
    return _join(lines[:last] + block + rest, eol)
