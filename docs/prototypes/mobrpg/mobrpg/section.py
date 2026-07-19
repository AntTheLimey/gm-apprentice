"""The canon-section slice of a vault note body.

mobRPG canon descriptions map to the note's *lead* prose. Everything from the
first GM-only heading (`## Appearances / Source References / GM Notes / Notes`)
onward is vault-only tail the merge must never touch — trailing session-logs and
metadata included. `canon_section` returns the reversible lead region plus a
`reinsert` closure that swaps in a new region while preserving the tail verbatim.

Decoupled from push's lossy `_description` projection on purpose (real notes
interleave excluded/canon headings; push's quirky keep_tail semantics stay put).
Stdlib only, pure string surgery — no frontmatter, no HTML.
"""
from __future__ import annotations

import re

# `[ \t\r]*$` (not `[ \t]*$`): re.M `$` matches before a `\n` but not before the
# `\r` of a CRLF line ending, so the `\r` must be allowed in the trailing run or
# CRLF vault files silently fail to match and leak the GM-only tail.
_GM_HEADING = re.compile(
    r"^##[ \t]+(?:Appearances|Source References|GM Notes|Notes)[ \t\r]*$", re.M)


def canon_section(body: str):
    """Return (region, reinsert). `region` is the body up to the first GM-only
    heading with trailing blank lines stripped; `reinsert(new_region)` rebuilds
    the full body, keeping the GM-only tail (and the exact separator) in place.

    Invariant: `reinsert(canon_section(body)[0]) == body`.
    """
    m = _GM_HEADING.search(body)
    if m is None:
        return body, (lambda new: new)

    cut = m.start()
    head = body[:cut]
    tail = body[cut:]
    region = head.rstrip("\r\n")
    sep = head[len(region):]  # the exact newlines between region and the heading

    def reinsert(new_region: str) -> str:
        return new_region.rstrip("\r\n") + sep + tail

    return region, reinsert
