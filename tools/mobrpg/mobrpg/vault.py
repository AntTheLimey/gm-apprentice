"""Shared vault-walking primitives used across mobrpg commands."""
from __future__ import annotations

import glob
import os

from mobrpg import node
from mobrpg.commands import map_cmd


def iter_linked_notes(vault: str):
    """Yield (path, text, node_dict) for every vault note carrying an element_id."""
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for path in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(path, encoding="utf-8").read()
            nd = node.read_node(txt)
            if nd and nd.get("element_id"):
                yield path, txt, nd


def body_of(txt: str) -> str:
    """Return the note body below the frontmatter (leading newline included).

    node._split_frontmatter anchors on a real "\\n---" fence, so a --- rule in
    the body can't fool it. `post` starts at the closing "---" fence.
    """
    _, fm_body, post = node._split_frontmatter(txt)
    if fm_body is None:
        return txt
    return post[3:]              # drop the closing "---", keep the rest (incl. \n)
