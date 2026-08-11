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


def _sections(body: str):
    """Yield (start, end, title) for each H2 section, heading through the next
    H2 or EOF."""
    ms = list(_H2.finditer(body))
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(body)
        yield m.start(), end, m.group("title").strip()


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
    headings are the vault's writing prompts; they are just not canon prose."""
    ms = list(_H2.finditer(md))
    out, pos = [], 0
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(md)
        if not md[m.end():end].strip():
            out.append(md[pos:m.start()])
            pos = end
    out.append(md[pos:])
    return "".join(out)


def gm_notes_split(body: str) -> tuple[str, str]:
    """Split body into (main, gm_tail); gm_tail is the '## GM Notes' section
    (heading through the next H2 or EOF), or ''. The narrow, GM-Notes-only case
    of `split_vault_only`, kept for callers that mean exactly that."""
    return split_vault_only(body, ("GM Notes",))
