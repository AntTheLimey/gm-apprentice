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


def iter_linked_notes(vault: str, folders=None):
    """Yield (path, text, node_dict) for every vault note carrying an element_id.

    `folders` defaults to the push folders (map_cmd.FOLDERS). A caller that
    only reads or reconciles links passes map_cmd.MIRROR_FOLDERS so heritage
    notes are covered too; sync and suggest must not, since nothing pushes a
    heritage upstream."""
    vault = os.path.expanduser(vault)
    for folder in (folders or map_cmd.FOLDERS):
        for path in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(path, encoding="utf-8").read()
            nd = node.read_node(txt)
            if nd and nd.get("element_id"):
                yield path, txt, nd


def read_map(vault: str) -> dict:
    """The vault's `_meta/mobrpg-map.json`, or {} when it is missing or unreadable."""
    try:
        with open(os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json"),
                  encoding="utf-8") as f:
            mp = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    return mp if isinstance(mp, dict) else {}


def linked_element_paths(vault: str) -> dict:
    """{element_id: vault-relative path} for every note a node links, heritages
    included. The first note (in folder, then path order) wins a duplicate."""
    vault = os.path.expanduser(vault)
    out: dict = {}
    for folder in map_cmd.MIRROR_FOLDERS:
        for path in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            with open(path, encoding="utf-8") as f:
                nd = node.read_node(f.read())
            if nd and nd.get("element_id"):
                out.setdefault(nd["element_id"],
                               os.path.relpath(path, vault).replace(os.sep, "/"))
    return out


def link_names(rel_by_key: dict) -> dict:
    """{key: the name a wikilink to that note should use}. The file stem, the
    way Obsidian links, unless another note in the map shares the stem (a
    place and a culture both called Drageby, in different folders): then the
    vault-relative path without `.md`, which Obsidian also resolves and which
    names exactly one file."""
    stem = {k: os.path.splitext(os.path.basename(rel))[0] for k, rel in rel_by_key.items()}
    count: dict = {}
    for s in stem.values():
        count[s.lower()] = count.get(s.lower(), 0) + 1
    return {k: (s if count[s.lower()] == 1 else os.path.splitext(rel_by_key[k])[0].replace(os.sep, "/"))
            for k, s in stem.items()}


def body_of(txt: str) -> str:
    """Return the note body below the frontmatter (leading newline included).

    node._split_frontmatter anchors on a real "\\n---" fence, so a --- rule in
    the body can't fool it. `post` starts at the closing "---" fence.
    """
    _, fm_body, post = node._split_frontmatter(txt)
    if fm_body is None:
        return txt
    return post[3:]              # drop the closing "---", keep the rest (incl. \n)
