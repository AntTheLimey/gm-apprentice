"""Shared vault-walking primitives used across mobrpg commands."""
from __future__ import annotations

import glob
import json
import os
import sys

from mobrpg import node
from mobrpg import section
from mobrpg.commands import map_cmd


def vault_only_sections(vault: str) -> tuple:
    """The H2 titles this vault keeps to itself. An optional top-level
    `vaultOnlySections` list in `<vault>/_meta/mobrpg-map.json` REPLACES the
    default set. A missing/unreadable map, a missing key, or a non-list/empty
    value falls back to the default — an empty list would push `## GM Notes`
    into a public world, which is never what a bad config should buy you. A
    malformed map is not fatal here: sync's other 99% still works, and
    `map`/`suggest` report the parse error properly.

    Lives here rather than in `sync_cmd` because BOTH push paths need it: `sync`
    strips these sections from its UpdateElement payload and `suggest` must
    strip the same ones from a CreateElement description, or a section the vault
    opted out of is published the first time an entity is pushed.
    """
    path = os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")
    try:
        with open(path, encoding="utf-8") as fh:
            mp = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return section.DEFAULT_VAULT_ONLY
    titles = mp.get("vaultOnlySections") if isinstance(mp, dict) else None
    if not isinstance(titles, list) or not titles:
        return section.DEFAULT_VAULT_ONLY
    out = tuple(str(t) for t in titles)
    # Replace semantics mean a partial list silently opts GM secrets INTO the
    # push. Explicit config is explicit — the push proceeds — but the foot-gun
    # says so out loud, because the blast radius is a shared world, not a local
    # file.
    if not any(t.strip().lower() == "gm notes" for t in out):
        print('WARNING: vaultOnlySections does not include "GM Notes" — '
              'GM Notes will be PUSHED to the shared world', file=sys.stderr)
    return out


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
