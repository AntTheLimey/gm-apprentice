"""The vault-only / canon split of a vault note body.

mobRPG canon descriptions map to a note's authored prose; some H2 sections are
pure vault bookkeeping — `## GM Notes` (secret), and the play-log sections
`## Appearances` / `## Source References` / `## Notes` that `write` scaffolds and
`session-wrapup` appends to. None of them are canon: pushing them spammed the
world owner's review queue with bookkeeping churn (#147) and pulling destroyed
them (#146). `split_vault_only` slices the body into the canon-facing main and
the verbatim vault tail so `sync` can push/pull the main while preserving the
tail untouched.

Stdlib only, pure string surgery — no frontmatter, no HTML.
"""
from __future__ import annotations

import re

DEFAULT_VAULT_ONLY = ("GM Notes", "Notes", "Appearances", "Source References")

# `[ \t\r]*$` (not `[ \t]*$`): re.M `$` matches before a `\n` but not before the
# `\r` of a CRLF line ending, so the `\r` must be allowed in the trailing run or
# CRLF vault files silently fail to match and leak the vault-only tail.
_H2 = re.compile(r"(?m)^##[ \t]+(?P<title>[^\r\n]+?)[ \t\r]*$")

# A fenced code block opener/closer: up to three leading spaces, then three or
# more backticks or tildes (CommonMark). A `## ` line inside such a block is
# code, not a heading — a stat block quoted under `## GM Notes` used to end the
# vault-only section early and leak every secret below it into the push
# candidate.
_FENCE = re.compile(r"^ {0,3}(?P<mark>`{3,}|~{3,})(?P<info>[^\r\n]*)")


def _h2_spans(body: str) -> list[tuple[int, int, str]]:
    """(start, heading_end, title) for every H2 OUTSIDE a fenced code block.

    Offsets are into the ORIGINAL body, so every caller's slices still
    reconstruct it byte-for-byte. A closing fence must use the opening fence's
    character, be at least as long, and carry no info string; an unclosed fence
    runs to EOF (also CommonMark), so nothing after it is ever a heading.
    """
    spans: list[tuple[int, int, str]] = []
    fence_char, fence_len = "", 0
    pos = 0
    for line in body.splitlines(keepends=True):
        f = _FENCE.match(line)
        if f:
            mark = f.group("mark")
            if not fence_char:
                fence_char, fence_len = mark[0], len(mark)
            elif (mark[0] == fence_char and len(mark) >= fence_len
                  and not f.group("info").strip()):
                fence_char, fence_len = "", 0
        elif not fence_char:
            m = _H2.match(line)
            if m:
                spans.append((pos, pos + m.end(), m.group("title").strip()))
        pos += len(line)
    return spans


def _sections(body: str):
    """Yield (start, end, title) for each H2 section, heading through the next
    H2 or EOF."""
    spans = _h2_spans(body)
    for i, (start, _heading_end, title) in enumerate(spans):
        end = spans[i + 1][0] if i + 1 < len(spans) else len(body)
        yield start, end, title


def split_vault_only(body: str,
                     titles: tuple = DEFAULT_VAULT_ONLY) -> tuple[str, str]:
    """Split body into (canon_md, vault_tail). vault_tail concatenates the
    vault-only H2 sections in document order; canon_md is everything else.
    Generalizes gm_notes_split (#146/#147): play bookkeeping belongs to the
    vault exactly the way GM Notes does. `titles` REPLACES the default list."""
    folded = {t.strip().lower() for t in titles}
    keep, tail, pos = [], [], 0
    for start, end, title in _sections(body):
        if title.lower() in folded:
            keep.append(body[pos:start])
            tail.append(body[start:end])
            pos = end
    keep.append(body[pos:])
    return "".join(keep), "".join(tail)


def drop_empty_sections(md: str) -> str:
    """Remove H2 sections with no non-whitespace body (empty scaffold headings)
    from a PUSH CANDIDATE. Never applied to the vault file itself — the empty
    headings are the vault's writing prompts; they are just not canon prose.
    Fence-aware for the same reason `_sections` is: a `## ` line inside a code
    fence is not a heading and must not gain (or lose) a section body."""
    spans = _h2_spans(md)
    out, pos = [], 0
    for i, (start, heading_end, _title) in enumerate(spans):
        end = spans[i + 1][0] if i + 1 < len(spans) else len(md)
        if not md[heading_end:end].strip():
            out.append(md[pos:start])
            pos = end
    out.append(md[pos:])
    return "".join(out)


def gm_notes_split(body: str) -> tuple[str, str]:
    """Split body into (main, gm_tail); gm_tail is the '## GM Notes' section
    (heading through the next H2 or EOF), or ''. The narrow, GM-Notes-only case
    of `split_vault_only`, kept for callers that mean exactly that."""
    return split_vault_only(body, ("GM Notes",))
