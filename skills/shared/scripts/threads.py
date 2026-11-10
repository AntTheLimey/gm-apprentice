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

from vaultlib import (ANY_LABEL_LINE_RE, BULLET_RE, GM_MARKER_RE,
                      SECTION_HEADING_RE, atx_title, fence_step, find_section,
                      line_headings, marker_re, scan_body)

SECTION = "Open Threads"
DORMANT = "Dormant Threads"
RESOLVED = "Resolved Threads"
# The path to a PC's own list (see `pc_thread_items`).
PC_PATH = ("Current Status", "**Open threads**")

_PARTY = "the party"
_TAIL_RE = re.compile(
    r"^(?P<text>.*)\s+—\s+(?:since\s+(?P<since>[^;]+?);\s*)?"
    r"(?:dormant\s+since\s+(?P<dormant>[^;]+?);\s*)?"
    r"involves\s+(?P<who>.+?)\s*$")
_LINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
_LEAD_RE = re.compile(r"^\*\*(.+?)\*\*")
_PLACEHOLDER_RE = re.compile(r"^\{.*\}$")
# Inline text on a PC's label line that says there are none
# (`**Open threads:** None.`): no thread, as a placeholder is none. Read
# with case and the punctuation and emphasis round it dropped.
_NONE_WORDS = frozenset(("none", "nothing", "n/a", "na", "-", "\u2014",
                         "\u2013", "nothing yet", "none yet", ""))


def _filler(text: str) -> bool:
    return " ".join(text.strip(" \t.,;:!?*_()").casefold().split()) \
        in _NONE_WORDS
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
    # A dormant entry's `dormant since …` clause (`Session 9 (left Wu)`);
    # None for an active thread.
    dormant: str | None = None


def format_shared(text: str, since: str | None,
                  involves: list[str] | None) -> str:
    """The bullet line for a shared thread. No `involves` means the party."""
    who = (", ".join(f"[[{name}]]" for name in involves)
           if involves else _PARTY)
    clause = f"since {since}; " if since else ""
    return f"- {text} — {clause}involves {who}"


def format_dormant(text: str, since: str | None,
                   involves: list[str] | None, dormant: str) -> str:
    """The bullet line for a dormant thread: `format_shared`'s shape with
    `dormant since {dormant}; ` before the `involves` part."""
    who = (", ".join(f"[[{name}]]" for name in involves)
           if involves else _PARTY)
    clause = f"since {since}; " if since else ""
    return f"- {text} — {clause}dormant since {dormant}; involves {who}"


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
    return _parse_body(m.group(1).strip())


def _parse_body(body: str) -> SharedThread:
    """A bullet's text (marker dropped) as a SharedThread."""
    tail = _TAIL_RE.match(body)
    if tail:
        who = tail.group("who")
        names = [n.strip() for n in _LINK_RE.findall(who)]
        if who.casefold() == _PARTY:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), [], True,
                                dormant=tail.group("dormant"))
        if names:
            return SharedThread(tail.group("text").strip(),
                                tail.group("since"), names, False,
                                dormant=tail.group("dormant"))
    return SharedThread(body, None, [], False)


def shared_threads(overview_text: str,
                   section: str = SECTION) -> list[SharedThread]:
    """The threads under the Overview's `## Open Threads` section (or
    another level-2 `section`, `DORMANT` for the dormant list; see
    `_shared_span`): one per top-level bullet outside a code fence, read
    as `pc_thread_items` reads a PC's (its lines under it joined into one
    text, `hidden` by the same rule)."""
    lines = _lines(overview_text)
    return [_shared_of(b)[0] for b in _shared_bullets(lines, section)]


def _shared_of(block: _Block) -> tuple[SharedThread, bool]:
    """(the block as a SharedThread, whether its first line holds its own
    `involves` tail). The tail is read off the first line when it has one
    (the text is then the rest of the first line, then the lines under
    it); otherwise off the end of the joined text (a tail on a wrapped
    line, or an `involves` list the first line leaves open on a comma)."""
    first = _parse_body(block.parts[0])
    cut = len(block.parts) > 1 and block.parts[0].rstrip().endswith(",")
    if (first.party or first.involves) and not cut:
        rest = block.text[len(block.parts[0]):]
        return replace(first, text=first.text + rest,
                       hidden=block.hidden), True
    return replace(_parse_body(block.text), hidden=block.hidden), False


def widen_shared(overview_text: str, text: str, names: list[str],
                 section: str = SECTION) -> str:
    """`overview_text` with each of `names` (PC note names) the visible
    shared entry whose text is `text` does not yet involve added to its
    `involves`, the rest of the line kept as written (its `since`, alias
    labels, line ending). A party entry is left alone; one with no tail
    gets `— involves …`. KeyError when no visible entry has that text."""
    lines = _lines(overview_text)
    want = " ".join(text.split())
    for block in _shared_bullets(lines, section):
        t, own_tail = _shared_of(block)
        if t.hidden or " ".join(t.text.split()) != want:
            continue
        # The line the tail sits on: the first, or (a tail on a wrapped
        # line) the block's last; with no tail, the first gets one.
        i = (block.start if own_tail or not (t.party or t.involves)
             else max(k for k in range(block.start, block.end)
                      if lines[k].strip()))
        line = lines[i]
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
    """(index, level, title) of every heading outside a code fence; the
    title has no ATX closing sequence."""
    return [(i, lvl, atx_title(title)) for i, lvl, title
            in line_headings([raw.rstrip("\r") for raw in lines])]


def _shared_span(lines: list[str],
                 section: str = SECTION) -> tuple[int, int] | None:
    """(heading index, end) of the shared list: the first level-2 heading
    titled Open Threads (or another `section`) in any case, outside a code
    fence, up to the next heading of level 1 or 2. Every reader and writer of the list (and the
    publish tool's `sectionRange`) finds it this way: the title matches by
    case only (`Open  Threads` with two spaces is not it)."""
    found = find_section("\n".join(lines), [section], level=2, first=True,
                         trim=False, exact=True)
    return found if isinstance(found, tuple) else None


def _shared_bullets(lines: list[str],
                    section: str = SECTION) -> list[_Block]:
    """The threads of the shared list (or another `section`): its top-level
    bullets, each with everything under it (see `_blocks`)."""
    span = _shared_span(lines, section)
    if span is None:
        return []
    return _blocks(lines, span[0], span[1], code=True)


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


def insert_shared(overview_text: str, line: str,
                  section: str = SECTION) -> str:
    """Add `line` under `## Open Threads` (or another level-2 `section`),
    creating the section after `## Current Arc` (else before the first
    `## GM Notes`, else at the end of the note); the dormant list is
    created straight after `## Open Threads` when that exists outside a
    gm-only fence, else by those fallbacks. The section is player-facing,
    so the insert point is always outside a gm-only fence; a path with no
    such point gives way to the next, and ValueError means the note has
    none. An existing section with no such point, or whose heading is
    itself inside a gm-only fence, is a ValueError too: never a second
    heading."""
    eol = _eol(overview_text)
    lines = _lines(overview_text)
    heads = _headings(lines)

    def find(name: str) -> int | None:
        for at, (_idx, lvl, title) in enumerate(heads):
            if lvl == 2 and title.casefold() == name:
                return at
        return None

    span = _shared_span(lines, section)
    if span is not None:
        idx = span[0]
        end = (None if _states(lines)[idx]
               else _valid_point(lines, idx, span[1]))
        if end is None:
            raise ValueError(f"{section} has no place outside a gm-only "
                             "fence")
        new = [_new(line, eol)]
        if all(_blank(l) for l in lines[idx + 1:end]):
            new.insert(0, _new("", eol))   # an empty section: a blank first
        return _join(_put_after_content(lines, idx, end, new), eol)
    pos = None
    if section != SECTION:
        opened = _shared_span(lines)
        if opened is not None and not _states(lines)[opened[0]]:
            pos = _valid_point(lines, opened[0], opened[1])
    at = find("current arc")
    if pos is None and at is not None:
        pos = _valid_point(lines, heads[at][0],
                           _heading_end(lines, heads, at))
    if pos is None:
        at = find("gm notes")
        if at is not None:
            pos = _valid_point(lines, -1, heads[at][0])
    if pos is None:
        pos = _valid_point(lines, -1, len(lines))
    if pos is None:
        raise ValueError(f"no place outside a gm-only fence for {section}")
    head = lines[:pos]
    while head and _blank(head[-1]):
        head.pop()
    tail = lines[pos:]
    while tail and _blank(tail[0]):
        tail.pop(0)
    blank = _new("", eol)
    block = [blank, _new(f"## {section}", eol), blank, _new(line, eol)]
    if any(not _blank(t) for t in tail):
        return _join(head + block + [blank] + tail, eol)
    return _join(head + block + [""], eol)


# A PC's Open threads label line: bulleted (`- **Open threads:**`) or not,
# with the inline text after it, if any.
_PC_LABEL_RE = re.compile(
    r"^(?P<label>(?P<indent>[ \t]*)(?P<mark>[-*][ \t]+)?\*\*(?P<name>[^*:]+):"
    r"\*\*)(?P<rest>.*)$")


def _pc_span(lines: list[str]) -> tuple[re.Match[str], int, int] | None:
    """(the label line's match, its index, end) of a PC's Open threads under
    `## Current Status`, before its first subsection, or None. The label
    is bold, bulleted or not. Its
    block ends at the next heading of any level, and at the next line no
    deeper than the label that is a bold label line (`**Knows:**`) or, for
    a bulleted label, a bullet (the next field); all outside a code
    fence. A gm-only
    marker does not end it: a fenced thread is still one (`hidden`)."""
    heads = _headings(lines)
    status = next(((at, idx) for at, (idx, lvl, title) in enumerate(heads)
                   if title.casefold() == PC_PATH[0].casefold()), None)
    if status is None:
        return None
    sec_end = _heading_end(lines, heads, status[0])
    want = PC_PATH[1].strip("*:").casefold()
    delim: str | None = None
    for i in range(status[1] + 1, sec_end):
        line = lines[i].rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        if SECTION_HEADING_RE.match(line):
            return None   # a subsection's label (a journal's) is not the field
        m = _PC_LABEL_RE.match(line)
        if m and m.group("name").strip().casefold() == want:
            break
    else:
        return None
    level = len(m.group("indent").expandtabs(4))
    delim = None
    for j in range(i + 1, sec_end):
        line = lines[j].rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        if is_fence or delim is not None:
            continue
        if SECTION_HEADING_RE.match(line):
            return m, i, j
        if len(line.expandtabs(4)) - len(line.expandtabs(4).lstrip()) > level:
            continue   # under it: a wrapped line may start in bold
        if (ANY_LABEL_LINE_RE.match(line.strip())
                or (m.group("mark") and BULLET_RE.match(line))):
            return m, i, j
    return m, i, sec_end


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
    # An inline thread (`**Open threads:** text`): the label line as it
    # stays when the thread goes. None for a bullet.
    keep: str | None = None


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
    """The threads under a PC's `## Current Status` > `**Open threads:**`
    (see `_pc_span`): its top-level bullets, each with everything under it
    (see `_blocks`). Text on the label line itself (`**Open threads:**
    a; b`) is one thread, with the lines under it. A template placeholder
    (`{…}`), or inline text that only says there are none (`None.`, `—`),
    is not a thread. A thread in or next to hidden text is returned
    with `hidden` set (see `PcThread`): nothing may move it to a page
    players read, and removing it could split a hidden block."""
    lines = _lines(pc_text)
    span = _pc_span(lines)
    if span is None:
        return []
    m, start, end = span
    found = _blocks(lines, start, end, m)
    return [PcThread(b.text, b.parts, b.start, b.end, b.hidden, b.fenced,
                     b.keep)
            for b in found if not _PLACEHOLDER_RE.match(b.text)]


@dataclass(frozen=True)
class _Block:
    """One thread's lines: see `_blocks`. Fields as `PcThread`'s."""
    text: str
    parts: tuple[str, ...]
    start: int
    end: int
    hidden: bool
    fenced: bool
    keep: str | None = None


_COMMENT_MARK_RE = re.compile(r"<!--|-->")


def _leaves_block(line: str) -> bool:
    """Does `line` leave a comment open (a `<!--` with no `-->` after it,
    an odd number of `%%`) or close one opened above it? A comment that
    opens and closes on the line cannot be split by taking the thread next
    to it away, so it does not count (a `QA-DISMISSED` marker on its own
    line is one)."""
    line = _FENCE_MARKER_RE.sub("", line)
    inside = False
    for m in _COMMENT_MARK_RE.finditer(line):
        if m.group() == "-->":
            if not inside:
                return True
            inside = False
        else:
            inside = True
    return inside or line.count("%%") % 2 == 1


def _blocks(lines: list[str], start: int, end: int,
            label: re.Match[str] | None = None,
            code: bool = False) -> list[_Block]:
    """The threads of a list in lines (start, end): a PC's Open threads and
    the Overview's shared list are both read here.

    Only top-level bullets are threads (the indent of the list's first
    bullet). A line indented deeper than the bullet's marker, nested bullet
    or not, belongs to the bullet above it, after blank lines too (a loose
    list item, as Markdown reads it); a blank line followed by anything
    else ends the bullet. A plain line straight under the bullet's text,
    indented or not, carries it on (a lazy line; see `_lazy`). Bullets
    inside a code fence are skipped. The text is the bullet on one line:
    each line under it stripped, a wrapped line after a space and a nested
    bullet's text (marker dropped) after "; ". `hidden` and `fenced` as
    `PcThread` reads them.

    With `code` (the shared list), a bullet-like line indented four or
    more spaces before the list starts is indented code, not a thread, as
    the publish tool reads it.

    `label` is the match of a PC's label line at `start` (`_PC_LABEL_RE`):
    text after it is a thread of its own, the label line its first line,
    and the lines under it belong to it as to a bullet at the label's
    indent."""
    hidden = _hidden_lines(lines)
    near = [_leaves_block(line) for line in lines]
    out: list[_Block] = []
    base: int | None = None
    delim: str | None = None
    i = start + 1
    rest = label.group("rest").strip() if label is not None else ""
    # Inline text that says none, or a template placeholder, is no thread:
    # bullets nested under it are threads of their own.
    if label is not None and not (_filler(rest)
                                  or _PLACEHOLDER_RE.match(rest)):
        stop = _block_stop(lines, start, end,
                           len(label.group("indent").expandtabs(4)))
        out.append(_block(lines, hidden, near, start, stop, rest,
                          label.group("label")))
        i = stop
    while i < end:
        line = lines[i].rstrip("\r")
        delim, is_fence = fence_step(line, delim)
        m = BULLET_RE.match(line)
        if is_fence or delim is not None or not m:
            i += 1
            continue
        indent = len(line) - len(line.lstrip())
        if base is None and code and indent >= 4:
            i += 1   # indented code
            continue
        if base is None:
            base = indent
        if indent > base:
            i += 1   # nested under a bullet the walk skipped (a placeholder)
            continue
        stop = _block_stop(lines, i, end, base)
        out.append(_block(lines, hidden, near, i, stop,
                          m.group(1).strip()))
        i = stop
    return out


def _block_stop(lines: list[str], i: int, end: int, base: int) -> int:
    """Index just past the thread whose first line is `i`: the lines
    deeper than `base` under it, after blank lines too, and a lazy line
    straight under it (see `_blocks`)."""
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
    return stop


def _block(lines: list[str], hidden: list[bool], near: list[bool], i: int,
           stop: int, first: str, keep: str | None = None) -> _Block:
    """The thread on lines [i, stop) whose first line's text is `first`."""
    parts = tuple([first] + [lines[k].strip() for k in range(i + 1, stop)
                             if lines[k].strip()])
    text = parts[0]
    for part in parts[1:]:
        sub = BULLET_RE.match(part)
        text += f"; {sub.group(1).strip()}" if sub else f" {part}"
    span = [k for k in range(i, stop) if lines[k].strip()]
    touches = (any(hidden[k] or any(h in lines[k] for h in _HIDING)
                   for k in span)
               or (i > 0 and near[i - 1])
               or (stop < len(lines) and near[stop]))
    fenced = all(hidden[k] for k in span)
    return _Block(text, parts, i, stop, touches, fenced, keep)


def _lazy(line: str) -> bool:
    """Can `line`, unindented and straight under a bullet, carry on its
    text (Markdown's lazy continuation)? Not a bullet, a bold label line,
    a heading, a code fence, a gm-only marker, a comment mark (`<!--`,
    `-->`, `%%`) or a blockquote or callout (`>`)."""
    bare = line.strip()
    return not (BULLET_RE.match(line) or ANY_LABEL_LINE_RE.match(bare)
                or SECTION_HEADING_RE.match(bare) or GM_MARKER_RE.search(line)
                or bare.startswith(("```", "~~~", *_HIDING, ">")))


_COMMENT_ONLY_RE = re.compile(r"\s*(?:<!--.*?-->\s*|%%.*?%%\s*)+")


def remove_pc_thread(pc_text: str, thread: PcThread) -> str:
    """`pc_text` without `thread` (from `pc_thread_items` on this same
    text): its first line and every line under it. An inline thread's
    label line stays without its text. When that leaves the list empty
    (only blank or comment-only lines before the next field), the label
    gets the filler other empty fields use (`**Open threads:** \u2014`)."""
    lines = _lines(pc_text)
    if thread.keep is not None:
        cr = "\r" if lines[thread.start].endswith("\r") else ""
        lines = (lines[:thread.start] + [thread.keep + cr]
                 + lines[thread.end:])
    else:
        lines = lines[:thread.start] + lines[thread.end:]
    span = _pc_span(lines)
    if span is not None:
        m, at, end = span
        if not m.group("rest").strip() and all(
                _blank(l) or _COMMENT_ONLY_RE.fullmatch(l.rstrip("\r"))
                for l in lines[at + 1:end]):
            cr = "\r" if lines[at].endswith("\r") else ""
            lines[at] = m.group("label") + " \u2014" + cr
    return "\n".join(lines)


def add_pc_thread(pc_text: str, text: str) -> str:
    """`pc_text` with `text` as a new bullet after the last thread on the
    PC's Open threads (the filler `\u2014`, or a placeholder, after the
    label is dropped: the list is not empty any more). KeyError for no
    Open threads field; ValueError for a list that is one inline thread
    (`**Open threads:** a; b`) or whose end lies in a gm-only fence, where
    a new bullet would be hidden."""
    lines = _lines(pc_text)
    span = _pc_span(lines)
    if span is None:
        raise KeyError(PC_PATH[1])
    m, at, end = span
    eol = _eol(pc_text)
    rest = m.group("rest").strip()
    if rest and not _filler(rest) and not _PLACEHOLDER_RE.match(rest):
        raise ValueError("the Open threads field is one inline thread")
    end = _stop_end(lines, at, end)
    last = end
    while last > at + 1 and _blank(lines[last - 1]):
        last -= 1
    if _states(lines)[last]:
        raise ValueError("the end of the Open threads list is hidden")
    existing = [b for b in _blocks(lines, at, end, m)
                if not _PLACEHOLDER_RE.match(b.text)]
    if existing:
        first = lines[existing[0].start]
        indent = first[:len(first) - len(first.lstrip())]
    else:
        indent = m.group("indent") + ("  " if m.group("mark") else "")
    if rest:
        lines[at] = m.group("label") + ("\r" if lines[at].endswith("\r")
                                        else "")
    bullet = _new(f"{indent}- {text}", eol)
    return "\n".join(_put_after_content(lines, at + 1, end, [bullet]))


def remove_shared(overview_text: str, index: int,
                  section: str = SECTION) -> str:
    """`overview_text` without shared thread number `index` (as
    `shared_threads` numbers them): its first line and every line under
    it. KeyError for no Open Threads section (or other `section`),
    IndexError for no such bullet."""
    lines = _lines(overview_text)
    if _shared_span(lines, section) is None:
        raise KeyError(section)
    found = _shared_bullets(lines, section)
    if not 0 <= index < len(found):
        raise IndexError(f"no bullet {index} under {section}")
    block = found[index]
    return "\n".join(lines[:block.start] + lines[block.end:])


def append_resolved(wrapup_text: str, line: str) -> str:
    """Add `line` under the Wrap-Up's `#### Resolved Threads`, creating the
    heading right after the `#### Unresolved Threads` block (inside
    `### What Carries Forward`, before the closing gm-only marker). A lone
    `{…}` placeholder under an existing heading is dropped. The evidence is
    the GM's: under a heading outside a gm-only fence, the line goes into
    the fence that ends the section, else into a fence of its own."""
    eol = _eol(wrapup_text)
    lines = _lines(wrapup_text)
    heads = _headings(lines)
    blank = _new("", eol)
    new = [_new(line, eol)]
    fence = [blank, _new(GM_OPEN, eol), blank] + new + [
        blank, _new(GM_CLOSE, eol)]
    for at, (idx, lvl, title) in enumerate(heads):
        if title.casefold() == RESOLVED.casefold():
            fenced = _states(lines)[idx]
            end = _heading_end(lines, heads, at)
            if fenced:
                end = _stop_end(lines, idx, end)
            kept = [lines[idx]] + [
                l for l in lines[idx + 1:end]
                if not _PLACEHOLDER_RE.match(l.strip())]
            lines = lines[:idx] + kept + lines[end:]
            end = idx + len(kept)
            if all(_blank(l) for l in kept[1:]):
                body = [blank] + new if fenced else fence
                lines = lines[:idx] + [kept[0]] + body + [blank] + lines[end:]
                return _join(lines, eol)
            if fenced:
                return _join(_put_after_content(lines, idx, end, new), eol)
            states = _states(lines)
            last = end
            while last > idx and _blank(lines[last - 1]):
                last -= 1
            if states[last]:
                # The section's content ends inside a fence (one that
                # opens under the heading and never closes).
                return _join(lines[:last] + new + lines[last:], eol)
            if states[last - 1] and any(
                    m.group(1) for m in GM_MARKER_RE.finditer(lines[last - 1])):
                # It ends with a fence's closer: the line goes inside it.
                return _join(_put_after_content(
                    lines, idx, last - 1, new), eol)
            return _join(lines[:last] + fence + lines[last:], eol)
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
