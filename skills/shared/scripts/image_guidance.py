"""The Image Guidance note: read its Always text and named blocks, and
compose a picture prompt from them. Stdlib only.

The note is GM-only. Its Direction section is for the apprentice and is
never read here, so it can never reach a prompt.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import NamedTuple

import vaultlib as vl

_PLACEHOLDER_RE = re.compile(r"^\{[^{}]*\}$")


class Guidance(NamedTuple):
    always: str
    blocks: dict[str, str]     # block name, lower-cased -> its text
    found: bool


def _body(lines: list[str]) -> str:
    """A section's text: marker lines dropped, a lone `{placeholder}` empty."""
    kept = [ln for ln in lines
            if not (vl.GM_MARKER_RE.search(ln)
                    and not vl.GM_MARKER_RE.sub("", ln).strip())]
    text = "\n".join(kept).strip()
    return "" if _PLACEHOLDER_RE.match(text) else text


def read(vault: Path, rel: str) -> Guidance:
    path = vault / rel
    if not path.is_file():
        return Guidance("", {}, False)
    lines = path.read_text(encoding="utf-8").split("\n")
    heads = vl.line_headings(lines)
    # A section runs to the next heading of the same or a higher level.
    ends = [next((h2[0] for h2 in heads[i + 1:] if h2[1] <= h[1]), len(lines))
            for i, h in enumerate(heads)]
    always = ""
    blocks: dict[str, str] = {}
    in_blocks = False
    for (at, level, title), end in zip(heads, ends):
        title = vl.atx_title(title)
        body = _body(lines[at + 1:end])
        if level <= 2:
            in_blocks = level == 2 and title.casefold() == "blocks"
            if level == 2 and title.casefold() == "always" and not always:
                always = body
        elif in_blocks and level == 3 and body:
            blocks.setdefault(" ".join(title.split()).casefold(), body)
    return Guidance(always, blocks, True)


def compose(g: Guidance, names: list[str],
            subject: str) -> tuple[str, list[str]]:
    """The prompt: the always text, each named block in the order asked,
    then the subject, one blank line between. Also the names with no block."""
    parts = [g.always] if g.always else []
    missing: list[str] = []
    for name in names:
        text = g.blocks.get(" ".join(name.split()).casefold())
        if text is None:
            missing.append(name)
        else:
            parts.append(text)
    parts.append(subject)
    return "\n\n".join(parts), missing
