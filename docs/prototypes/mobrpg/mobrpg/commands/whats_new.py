"""mobrpg whats-new — read-only discovery report: what changed in mobRPG vs the vault.

Pulls (or reads a pre-pulled extract) and diffs it against the vault's `mobrpg:`
nodes and type map, so "what should I pull in" is a first-class report instead of
a hand-rolled script. Reports, per category:

  new    — entities in mobRPG with no linked vault node (pull candidates)
  gone   — vault nodes whose element_id is absent from mobRPG (deleted upstream /
           zombie notes to reconcile)
  types  — classifier types in mobRPG not represented in the vault map (needs
           `map` to bind/create) — surfaced via pull's `types` section

Read-only: GET-only against mobRPG, never writes the vault. Description/
relationship suggest-up candidates are a separate concern (see `suggest-desc`
and `suggest`); this verb is the pull-side "what's new" picture.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import map_cmd
from mobrpg.commands import pull


def _norm(s) -> str:
    return (s or "").strip().lower()


def diff_world(extract: dict, vault_nodes: dict, vault_type_names: set) -> dict:
    """Pure. `vault_nodes` = {element_id: {name, path}} from the vault's nodes;
    `vault_type_names` = normalized classifier-type names the vault already knows.
    Returns {new_entities, gone, new_types, linked}."""
    ex_ids = {e.get("id") for e in extract.get("entities", [])}
    new_entities, linked = [], 0
    for e in extract.get("entities", []):
        if e.get("id") in vault_nodes:
            linked += 1
        else:
            new_entities.append({"id": e.get("id"), "kind": e.get("kind"), "name": e.get("name")})
    gone = [{"element_id": eid, "name": v.get("name"), "path": v.get("path")}
            for eid, v in vault_nodes.items() if eid not in ex_ids]
    new_types = []
    for kind, items in (extract.get("types") or {}).items():
        for t in items:
            if _norm(t.get("name")) not in vault_type_names:
                new_types.append({"kind": kind, "name": t.get("name"), "id": t.get("id")})
    return {"new_entities": new_entities, "gone": gone,
            "new_types": new_types, "linked": linked}


def _vault_nodes(vault: str) -> dict:
    """{element_id: {name, path}} for every note carrying a mobrpg: node."""
    out = {}
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            nd = node.read_node(open(p, encoding="utf-8").read())
            if nd and nd.get("element_id"):
                out[nd["element_id"]] = {
                    "name": os.path.splitext(os.path.basename(p))[0], "path": p}
    return out


def _vault_type_names(vault: str) -> set:
    """Normalized classifier-type names the vault already maps (from the map's
    classifier + location-routing sections). Empty set if there is no map yet."""
    mp_path = os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")
    if not os.path.exists(mp_path):
        return set()
    try:
        mp = json.load(open(mp_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    names = set()
    for section in (mp.get("classifiers") or {}).values():
        if isinstance(section, dict):
            for key, val in section.items():
                names.add(_norm(key))
                if isinstance(val, dict) and val.get("name"):
                    names.add(_norm(val["name"]))
    for key, val in (mp.get("locationRouting") or {}).items():
        names.add(_norm(key))
        if isinstance(val, dict):
            names.add(_norm(val.get("politicalType")))
            names.add(_norm(val.get("landFeatureType")))
    names.discard("")
    return names


def _report(diff: dict) -> None:
    n = diff["new_entities"]; g = diff["gone"]; t = diff["new_types"]
    print(f"whats-new: {len(n)} new, {len(g)} gone, {len(t)} new type(s); "
          f"{diff['linked']} linked/in-sync")
    if n:
        print("\nNEW in mobRPG (pull candidates):")
        for e in sorted(n, key=lambda e: (e["kind"] or "", e["name"] or "")):
            print(f"  + {e['kind']:14} {e['name']}")
    if g:
        print("\nGONE from mobRPG (deleted upstream — reconcile the vault note):")
        for e in g:
            print(f"  - {e['name']}  ({e['element_id']})")
    if t:
        print("\nNEW classifier types (run `map` to bind/create):")
        for x in t:
            print(f"  · {x['kind']:18} {x['name']}")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg whats-new",
        description="Read-only report of what changed in mobRPG vs the vault.")
    ap.add_argument("world")
    ap.add_argument("--vault", required=True)
    ap.add_argument("--extract", default="",
                    help="use a pre-pulled extract JSON instead of pulling live")
    ap.add_argument("--json", action="store_true", help="emit the diff as JSON")
    args = ap.parse_args(argv)

    if args.extract:
        try:
            extract = json.load(open(args.extract, encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"ERROR reading {args.extract}: {e}", file=sys.stderr)
            return 2
    else:
        try:
            token = client.get_access_token()
            extract = pull.extract(args.world, token)
        except client.ApiError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1

    diff = diff_world(extract, _vault_nodes(args.vault), _vault_type_names(args.vault))
    if args.json:
        print(json.dumps(diff, indent=2, ensure_ascii=False))
    else:
        _report(diff)
    return 0
