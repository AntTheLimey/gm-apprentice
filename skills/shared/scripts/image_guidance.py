"""The Image Guidance note: read its Always text and named blocks, and
compose a picture prompt from them. Stdlib only.

The note is GM-only. Its Direction section is for the apprentice and is
never read here, so it can never reach a prompt. Comments (`%% %%` and
`<!-- -->`, a GM's asides) are cut as the publish tool cuts them, so they
never reach a prompt either.
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
    """A section's text: marker lines dropped, and any line that is only a
    `{placeholder}` (the template's prompt to the GM) left out."""
    kept = [ln for ln in lines
            if not (vl.GM_MARKER_RE.search(ln)
                    and not vl.GM_MARKER_RE.sub("", ln).strip())
            and not _PLACEHOLDER_RE.match(ln.strip())]
    return "\n".join(kept).strip()


def _uncommented(lines: list[str]) -> list[str]:
    """The lines with every comment cut by the publish tool's strip chain
    (`vaultlib.cut_lines`). The gm-only markers go first: the template wraps
    the whole note in one, and the chain would cut the note with it. Raises
    `PublishToolUnavailable` when the tool cannot be asked: an aside is
    never sent because the comments could not be read."""
    bare = [vl.GM_MARKER_RE.sub("", ln) for ln in lines
            if not (vl.GM_MARKER_RE.search(ln)
                    and not vl.GM_MARKER_RE.sub("", ln).strip())]
    return [ln for ln in vl.cut_lines(bare) if ln is not None]


def read(vault: Path, rel: str) -> Guidance:
    """The note's Always text and blocks, read as the site would show them:
    comments, spoiler blocks and Dataview blocks are not part of what is sent."""
    path = vault / rel
    if not path.is_file():
        return Guidance("", {}, False)
    lines = _uncommented(path.read_text(encoding="utf-8").split("\n"))
    heads = vl.line_headings(lines)
    ends = vl.section_ends(heads, len(lines))
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
