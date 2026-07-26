"""The GM-Notes split of a vault note body.

mobRPG canon descriptions map to the note's *lead* prose; the `## GM Notes` tail
is vault-only and must never be pushed. `gm_notes_split` slices the body into the
canon-facing main and that verbatim tail so `sync` can push/pull the main while
preserving GM Notes untouched.

Stdlib only, pure string surgery — no frontmatter, no HTML.
"""
from __future__ import annotations

import re

# `[ \t\r]*$` (not `[ \t]*$`): re.M `$` matches before a `\n` but not before the
# `\r` of a CRLF line ending, so the `\r` must be allowed in the trailing run or
# CRLF vault files silently fail to match and leak the GM-only tail.
_GM_NOTES_ONLY = re.compile(r"^##[ \t]+GM Notes[ \t\r]*$", re.M)


def gm_notes_split(body: str) -> tuple[str, str]:
    """Split body into (main, gm_tail); gm_tail starts at '## GM Notes' or ''."""
    m = _GM_NOTES_ONLY.search(body)
    if not m:
        return body, ""
    return body[: m.start()], body[m.start():]
