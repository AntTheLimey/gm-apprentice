"""mobrpg backfill — one-time migration of a sidecar crosswalk into per-entity
`mobrpg:` nodes. Canticle-only: only that vault ever had a crosswalk (it existed
solely because IDs were once kept out of frontmatter). Offline; stdlib only.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from mobrpg import node
from mobrpg.commands import map_cmd
from mobrpg.commands import suggest

_KIND_NAME = {"npc": "Person", "pc": "Person", "location": "Political",
              "faction": "Organization", "item": "Item", "creature": "Creature"}

# The detect_updates crosswalk stores the mobRPG kind (person/organization/…),
# not the vault kind — map those to the element_kind used in mobrpg: nodes.
_MOBRPG_KIND_NAME = {"person": "Person", "organization": "Organization",
                     "political": "Political", "landfeature": "LandFeature",
                     "item": "Item", "creature": "Creature",
                     "currency": "Currency", "culture": "Culture"}


def _element_kind(kind: str) -> str:
    return _MOBRPG_KIND_NAME.get(kind) or _KIND_NAME.get(kind, "Person")


def _index_vault(vault):
    """_key(name) -> (path, vault_kind) for every entity file under FOLDERS."""
    idx = {}
    vault = os.path.expanduser(vault)
    for folder, vkind in map_cmd.FOLDERS.items():
        for p in glob.glob(os.path.join(vault, folder, "*.md")):
            idx[suggest._key(suggest._display_name(p))] = (p, vkind)
    return idx


def _nodes_from_dict_crosswalk(crosswalk, vault, namespace):
    """The detect_updates crosswalk: dict keyed by element_id, each value
    carrying `vault_path` directly — so we resolve by path (exact), not by
    fuzzy name-match. A missing/absent vault_path file is unresolved."""
    vault = os.path.expanduser(vault)
    nodes: dict = {}
    unresolved = []
    for eid, e in crosswalk.items():
        rel = e.get("vault_path")
        path = os.path.join(vault, rel) if rel else None
        if not path or not os.path.exists(path):
            unresolved.append(f"{eid} ({e.get('name')}): vault_path not found: {rel}")
            continue
        nodes[path] = {
            "world_id": "", "external_ref": suggest.external_ref(path, vault, namespace),
            "element_id": eid, "element_kind": _element_kind(e.get("kind")),
            "review_state": "accepted", "content_hash": "", "last_synced": "",
            "review_note": "", "determined": {}, "relationships": [], "languages": [],
        }
    return nodes, unresolved


def nodes_from_crosswalk(crosswalk, vault, namespace):
    # Two crosswalk schemas in the wild: the Regency-style {worldId, entities[],
    # relationships[]} and the detect_updates id-keyed dict. Detect by the
    # `entities` key; the dict form carries vault_path so it resolves exactly.
    if "entities" not in crosswalk:
        return _nodes_from_dict_crosswalk(crosswalk, vault, namespace)
    idx = _index_vault(vault)
    nodes: dict = {}
    unresolved = []
    for e in crosswalk.get("entities", []):
        hit = idx.get(suggest._key(e.get("name")))
        if not hit:
            unresolved.append(f"entity not in vault: {e.get('name')}")
            continue
        path, _ = hit
        nodes[path] = {
            "world_id": crosswalk.get("worldId", ""),
            "external_ref": suggest.external_ref(path, vault, namespace),
            "element_id": e.get("mobrpg_id"),
            "element_kind": _KIND_NAME.get(e.get("kind"), "Person"),
            "review_state": "accepted", "content_hash": "", "last_synced": "",
            "review_note": "", "determined": {}, "relationships": [], "languages": [],
        }
    for r in crosswalk.get("relationships", []):
        hit = idx.get(suggest._key(r.get("subject")))
        if not hit or hit[0] not in nodes:
            unresolved.append(f"relationship subject not resolved: {r.get('subject')}")
            continue
        nodes[hit[0]]["relationships"].append({
            "predicate": r.get("predicate"), "target": r.get("target"),
            "event_type": "", "event_id": r.get("mobrpg_event_id"),
            "review_state": "accepted"})
    return nodes, unresolved


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="mobrpg backfill",
                                 description="Migrate a sidecar crosswalk into mobrpg: nodes.")
    ap.add_argument("world")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--crosswalk", required=True)
    ap.add_argument("--namespace", default="canticle")
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args(argv)
    try:
        crosswalk = json.load(open(args.crosswalk, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading crosswalk: {e}", file=sys.stderr)
        return 2
    nodes, unresolved = nodes_from_crosswalk(crosswalk, args.vault, args.namespace)
    print(f"{len(nodes)} node(s) to write; {len(unresolved)} unresolved")
    for u in unresolved:
        print(f"  [unresolved] {u}")
    for path, n in nodes.items():
        txt = open(path, encoding="utf-8").read()
        merged = node.write_node(txt, n)
        if args.execute:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(merged)
    print("  [dry-run — no files changed]" if not args.execute else "  ✓ written")
    return 0
