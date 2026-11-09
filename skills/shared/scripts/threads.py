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
from dataclasses import dataclass, replace

from vaultlib import (ANY_LABEL_LINE_RE, BULLET_RE, GM_MARKER_RE, LABEL_RE,
                      SECTION_HEADING_RE, atx_title, fence_step, marker_re,
                      scan_body)

SECTION = "Open Threads"
RESOLVED = "Resolved Threads"
# The path to a PC's own list (see `pc_thread_items`).
PC_PATH = ("Current Status", "**Open threads**")

_PARTY = "the party"
_TAIL_RE = re.compile(
    r"^(?P<text>.*)\s+—\s+(?:since\s+(?P<since>[^;]+?);\s*)?"
    r"involves\s+(?P<who>.+?)\s*$")
_LINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
_LEAD_RE = re.compile(r"^\*\*(.+?)\*\*")
_PLACEHOLDER_RE = re.compile(r"^\{.*\}$")
GM_OPEN, GM_CLOSE = "<!-- gm-only -->", "<!-- /gm-only -->"
# A thread holding any of these, or next to a line with one, is next to
# hidden text (see `pc_thread_items`). A gm-only or spoiler marker on a line
# next to it does not count: `scan_body` reads those fences exactly.
_HIDING = ("<!--", "-->", "%%")
_FENCE_MARKER_RE = marker_re()
# Characters `str.splitlines` breaks at besides "\n": blanked before
# `scan_body` reads the lines, so its line numbers stay ours.
_SPLITS_RE = re.compile("[\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]")


@dataclass(frozen=True)
class SharedThread:
    text: str
    since: str | None
    involves: list[str]
    party: bool
    # In or holding hidden text (a gm-only or spoiler fence, an HTML or
    # `%%` comment), read as `pc_thread_items` reads a PC's: players never
    # see it, so it shares nothing with them.
    hidden: bool = False


def format_shared(text: str, since: str | None,
                  involves: list[str] | None) -> str:
    """The bullet line for a shared thread. No `involves` means the party."""
    who = (", ".join(f"[[{name}]]" for name in involves)
           if involves else _PARTY)
    clause = f"since {since}; " if since else ""
    return f"- {text} — {clause}involves {who}"


def format_resolved(text: str, evidence: str, label: str) -> str:
    """The `#### Resolved Threads` line for a closed thread: its text, the
    evidence that closed it, and the list it came off (`shared` or a PC)."""
    return f"- {text} \u2014 closed: {evidence} ({label})"


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
        if who.casefold() == _PARTY:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), [], True)
        if names:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), names, False)
    return SharedThread(body, None, [], False)


def shared_threads(overview_text: str) -> list[SharedThread]:
    """The threads under the Overview's `## Open Threads` section (see
    `_shared_span`), one per bullet line outside a code fence."""
    lines = _lines(overview_text)
    hidden = _hidden_lines(lines)
    out = []
    for i in _shared_bullets(lines):
        t = parse_shared(lines[i].rstrip("\r"))
        if t is not None:
            out.append(replace(t, hidden=hidden[i] or any(
                h in lines[i] for h in _HIDING)))
    return out


def widen_shared(overview_text: str, text: str, names: list[str]) -> str:
    """`overview_text` with each of `names` (PC note names) the visible
    shared entry whose text is `text` does not yet involve added to its
    `involves`, the rest of the line kept as written (its `since`, alias
    labels, line ending). A party entry is left alone; one with no tail
    gets `— involves …`. KeyError when no visible entry has that text."""
    lines = _lines(overview_text)
    hidden = _hidden_lines(lines)
    want = " ".join(text.split())
    for i in _shared_bullets(lines):
        line = lines[i]
        t = parse_shared(line.rstrip("\r"))
        if (t is None or hidden[i] or any(h in line for h in _HIDING)
                or " ".join(t.text.split()) != want):
            continue
        if t.party:
            return overview_text
        have = {n.casefold() for n in t.involves}
        new = []
        for name in names:
            if name.casefold() not in have:
                have.add(name.casefold())
                new.append(f"[[{name}]]")
        if not new:
            return overview_text
        cr = "\r" if line.endswith("\r") else ""
        body = line.rstrip("\r").rstrip()
        joint = ", " if t.involves else " \u2014 involves "
        lines[i] = body + joint + ", ".join(new) + cr
        return "\n".join(lines)
    raise KeyError(text)


def lead(text: str) -> str:
    """The bold lead of a thread (`**Bell —** rings` gives `Bell`), or the
    whole text. Trailing dash, colon and full stop inside the bold go."""
    m = _LEAD_RE.match(text.strip())
    if not m:
        return text.strip()
    return m.group(1).strip().rstrip(" —–-:.").strip()


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
        m = SECTION_HEADING_RE.match(line)
        if m:
            out.append((i, len(m.group(1)), atx_title(m.group(2))))
    return out


def _shared_span(lines: list[str]) -> tuple[int, int] | None:
    """(heading index, end) of the shared list: the first level-2 heading
    titled Open Threads in any case, outside a code fence, up to the next
    heading of level 1 or 2. Every reader and writer of the list (and the
    publish tool's `sectionRange`) finds it this way."""
    heads = _headings(lines)
    for at, (idx, lvl, title) in enumerate(heads):
        if lvl == 2 and title.casefold() == SECTION.casefold():
            return idx, _heading_end(lines, heads, at)
    return None


def _shared_bullets(lines: list[str]) -> list[int]:
    """Line indexes of the bullets in the shared list, any indent, outside
    a code fence."""
    span = _shared_span(lines)
    if span is None:
        return []
    out = []
    delim: str | None = None
    for i in range(span[0] + 1, span[1]):
        line = lines[i].rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if not (is_fence or delim is not None) and BULLET_RE.match(line):
            out.append(i)
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


def _states(lines: list[str]) -> list[bool]:
    """states[i] is True when line i starts inside a gm-only fence (one
    top-down pass: opener goes in, closer comes out; markers inside a code
    block are inert). One entry more than there are lines: the state at the
    end of the note."""
    out = []
    inside = False
    delim: str | None = None
    for raw in lines:
        out.append(inside)
        line = raw.rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        for m in GM_MARKER_RE.finditer(line):
            inside = not m.group(1)
    out.append(inside)
    return out


def _valid_point(lines: list[str], floor: int, pos: int) -> int | None:
    """The insert point at or above `pos` that lies outside every gm-only
    fence, or None. From `pos` it moves up past blank lines and a gm-only
    opener directly above, nothing else, and never above `floor`."""
    states = _states(lines)
    while states[pos]:
        back = pos
        while back > floor + 1 and _blank(lines[back - 1]):
            back -= 1
        # Line back-1 is an opener when the state flips on there.
        if back > floor + 1 and not states[back - 1] and states[back]:
            pos = back - 1
        else:
            return None
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
    `## Current Arc` (else before the first `## GM Notes`, else at the end
    of the note). The section is player-facing, so the insert point is
    always outside a gm-only fence; a path with no such point gives way to
    the next, and ValueError means the note has none. An existing section
    with no such point, or whose heading is itself inside a gm-only fence,
    is a ValueError too: never a second heading."""
    eol = _eol(overview_text)
    lines = _lines(overview_text)
    heads = _headings(lines)

    def find(name: str) -> int | None:
        for at, (_idx, lvl, title) in enumerate(heads):
            if lvl == 2 and title.casefold() == name:
                return at
        return None

    span = _shared_span(lines)
    if span is not None:
        idx = span[0]
        end = (None if _states(lines)[idx]
               else _valid_point(lines, idx, span[1]))
        if end is None:
            raise ValueError("Open Threads has no place outside a gm-only "
                             "fence")
        return _join(_put_after_content(
            lines, idx, end, [_new(line, eol)]), eol)
    pos = None
    at = find("current arc")
    if at is not None:
        pos = _valid_point(lines, heads[at][0],
                           _heading_end(lines, heads, at))
    if pos is None:
        at = find("gm notes")
        if at is not None:
            pos = _valid_point(lines, -1, heads[at][0])
    if pos is None:
        pos = _valid_point(lines, -1, len(lines))
    if pos is None:
        raise ValueError("no place outside a gm-only fence for Open Threads")
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


@dataclass(frozen=True)
class PcThread:
    """One thread on a PC's `**Open threads:**` list.

    `text` is the whole bullet on one line, because a shared entry is one
    line: its first line, then each line under it stripped, a wrapped line
    after a space and a nested bullet's text (marker dropped) after "; ".
    `lines` is the bullet's non-blank lines stripped but not joined: two
    threads are the same only when these match. `start`/`end` is the bullet's span of note lines (as
    `text.split("\\n")` numbers them). `hidden` is True when any of it is
    hidden text, holds `<!--`, `-->` or `%%`, or sits next to a line with
    one (other than a gm-only or spoiler marker): nothing may move or close
    it. `fenced` is True when every line
    of it is hidden (inside a gm-only or spoiler fence, an HTML comment or
    a `%%` comment): the GM's own secret, not a near miss."""
    text: str
    lines: tuple[str, ...]
    start: int
    end: int
    hidden: bool
    fenced: bool


def _hidden_lines(lines: list[str]) -> list[bool]:
    """For each line, whether the site would hide any of it: a gm-only or
    spoiler fence or marker, or an HTML comment (`scan_body`), or a `%%`
    comment, read as `%%` marks toggling it on and off outside code (a line
    with a mark counts as hidden). Errs toward hidden."""
    flat = "\n".join(_SPLITS_RE.sub(" ", line) for line in lines)
    out = [False] * len(lines)
    states, _problems = scan_body(flat)
    for st in states:
        out[st.lineno - 1] = not st.published or st.comment
    odd = False
    delim: str | None = None
    for i, raw in enumerate(lines):
        line = raw.rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        marks = line.count("%%")
        if odd or marks:
            out[i] = True
        odd ^= marks % 2 == 1
    return out


def pc_thread_items(pc_text: str) -> list[PcThread]:
    """The threads under a PC's `## Current Status` > `**Open threads:**`.

    Only top-level bullets are threads (the indent of the block's first
    bullet). A line indented deeper than the bullet's marker, nested bullet
    or not, belongs to the bullet above it, after blank lines too (a loose
    list item, as Markdown reads it); a blank line followed by anything
    else ends the bullet. A plain line straight under the bullet's text,
    indented or not, carries it on (a lazy line; see `_lazy`). A template placeholder (`{…}`) is not a
    thread. Bullets inside a code fence are skipped. A thread in or next
    to hidden text is returned with `hidden` set (see `PcThread`): nothing
    may move it to a page players read, and removing it could split a
    hidden block."""
    lines = _lines(pc_text)
    try:
        start, end = _path_span(lines, PC_PATH)
    except KeyError:
        return []
    hidden = _hidden_lines(lines)
    near = [any(h in _FENCE_MARKER_RE.sub("", line) for h in _HIDING)
            for line in lines]
    out: list[PcThread] = []
    base: int | None = None
    delim: str | None = None
    i = start + 1
    while i < end:
        line = lines[i].rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        m = BULLET_RE.match(line)
        if is_fence or delim is not None or not m:
            i += 1
            continue
        indent = len(line) - len(line.lstrip())
        if base is None:
            base = indent
        if indent > base:
            i += 1   # nested under a bullet the walk skipped (a placeholder)
            continue
        stop = j = i + 1
        while j < end:
            nxt = lines[j].rstrip("\r")
            if not nxt.strip():
                j += 1     # a blank: the bullet goes on only if a deeper line follows
                continue
            if (len(nxt) - len(nxt.lstrip()) <= base
                    and not (j == stop and _lazy(nxt))):
                break
            stop = j = j + 1
        parts = tuple([m.group(1).strip()]
                      + [lines[k].strip() for k in range(i + 1, stop)
                         if lines[k].strip()])
        text = parts[0]
        for part in parts[1:]:
            sub = BULLET_RE.match(part)
            text += f"; {sub.group(1).strip()}" if sub else f" {part}"
        if not _PLACEHOLDER_RE.match(text):
            span = [k for k in range(i, stop) if lines[k].strip()]
            touches = (any(hidden[k] or any(h in lines[k] for h in _HIDING)
                           for k in span)
                       or (i > 0 and near[i - 1])
                       or (stop < len(lines) and near[stop]))
            fenced = all(hidden[k] for k in span)
            out.append(PcThread(text, parts, i, stop, touches, fenced))
        i = stop
    return out


def _lazy(line: str) -> bool:
    """Can `line`, unindented and straight under a bullet, carry on its
    text (Markdown's lazy continuation)? Not a bullet, a bold label line,
    a heading, a code fence, a gm-only marker, a comment mark (`<!--`,
    `-->`, `%%`) or a blockquote or callout (`>`)."""
    bare = line.strip()
    return not (BULLET_RE.match(line) or ANY_LABEL_LINE_RE.match(bare)
                or SECTION_HEADING_RE.match(bare) or GM_MARKER_RE.search(line)
                or bare.startswith(("```", "~~~", *_HIDING, ">")))


def remove_pc_thread(pc_text: str, thread: PcThread) -> str:
    """`pc_text` without `thread` (from `pc_thread_items` on this same
    text): its first line and every line under it."""
    lines = _lines(pc_text)
    return "\n".join(lines[:thread.start] + lines[thread.end:])


def remove_shared(overview_text: str, index: int) -> str:
    """`overview_text` without shared thread number `index` (as
    `shared_threads` numbers them), plus any indented lines wrapped under
    it. KeyError for no Open Threads section, IndexError for no such
    bullet."""
    lines = _lines(overview_text)
    span = _shared_span(lines)
    if span is None:
        raise KeyError(SECTION)
    found = _shared_bullets(lines)
    if not 0 <= index < len(found):
        raise IndexError(f"no bullet {index} under {SECTION}")
    i = found[index]
    stop = i + 1
    while (stop < span[1] and lines[stop].strip()
           and lines[stop][:1] in " \t"
           and not BULLET_RE.match(lines[stop].rstrip("\r"))):
        stop += 1
    return "\n".join(lines[:i] + lines[stop:])


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
    closer = end < len(lines) and any(
        m.group(1) for m in GM_MARKER_RE.finditer(lines[end]))
    if not (_states(lines)[last] or closer):
        # An older Wrap-Up with no gm-only fence here: the evidence is the
        # GM's, so the new block gets a fence of its own.
        block = ([blank, _new(GM_OPEN, eol)] + block
                 + [blank, _new(GM_CLOSE, eol)])
    rest = lines[last:]
    after = list(rest)
    while after and _blank(after[0]):
        after.pop(0)
    if after and (end < len(lines) or any(not _blank(r) for r in after)):
        return _join(lines[:last] + block + [blank] + after, eol)
    return _join(lines[:last] + block + rest, eol)
