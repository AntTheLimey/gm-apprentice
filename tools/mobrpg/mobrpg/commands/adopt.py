"""mobrpg adopt — stamp `mobrpg:` nodes onto vault entities that already exist
upstream, matched to live mobRPG elements by normalized name.

The node-establishment path for a vault whose entities exist in a mobRPG world
but carry no `mobrpg:` node yet — a fresh import, or a vault pushed before nodes
existed. Pulls the live world, matches each unlinked vault note to exactly one
live element of the same kind by normalized name (aliases included), and writes
an `accepted` node carrying the real `element_id`. Ambiguous matches (several
live elements share the name) and unmatched notes are reported and left
untouched — never guessed.

This is the trustworthy replacement for the retired crosswalk/backfill: ids come
from the live world, not a hand-authored sidecar, and because it links to
existing elements it is dup-safe — a subsequent `suggest` sees these entities as
already-upstream and never re-creates them.

GET-only against mobRPG; writes only the vault (dry-run default, `--execute` to
apply). Works for any vault + any world, across every element kind.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from mobrpg import client
from mobrpg import node
from mobrpg.commands import map_cmd
from mobrpg.commands import suggest


def live_by_kind(world: str, token: str, ek: str) -> list[dict]:
    """Every live element of one element kind: [{id, name}] (paginated)."""
    out, page = [], 0
    while True:
        r = client._request("GET", f"/world/{world}/{ek}", token=token,
                             query={"page": page, "size": 200})
        if not isinstance(r, dict):
            break
        out.extend({"id": e["id"], "name": e.get("name")} for e in r.get("content", []))
        total = (r.get("page") or {}).get("totalPages", 1)
        if page >= total - 1:
            break
        page += 1
    return out


def index_live(elements: list[dict]) -> dict:
    """normalized name-key -> [element, ...]. A list, so a name shared by more
    than one live element surfaces as ambiguous instead of silently picking one."""
    idx: dict[str, list] = {}
    for e in elements:
        idx.setdefault(suggest._key(e.get("name")), []).append(e)
    return idx


def _match(entity: dict, idx: dict) -> list[dict]:
    """Live elements whose name-key matches the entity's name or any alias,
    de-duplicated by element id (a name+alias pointing at the same element counts
    once)."""
    keys = [suggest._key(entity["name"])] + [suggest._key(a) for a in entity.get("aliases") or []]
    seen, matches = set(), []
    for k in keys:
        for e in idx.get(k, []):
            if e["id"] not in seen:
                seen.add(e["id"])
                matches.append(e)
    return matches


def _existing_node(path: str) -> dict | None:
    try:
        return node.read_node(open(path, encoding="utf-8").read())
    except OSError:
        return None


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg adopt",
        description="Stamp mobrpg: nodes onto unlinked vault entities by matching "
                    "them to live mobRPG elements by name (dup-safe node establishment).")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
    ap.add_argument("--kind", default="", help="restrict to one vault kind (npc, location, ...)")
    ap.add_argument("--only", default="", help="substring match on entity name")
    ap.add_argument("--execute", action="store_true", help="write nodes (default: dry-run)")
    args = ap.parse_args(argv)

    map_path = args.map or os.path.join(os.path.expanduser(args.vault), "_meta", "mobrpg-map.json")
    try:
        mp = json.load(open(map_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading map: {e}", file=sys.stderr)
        return 2

    namespace = mp.get("vaultNamespace") or map_cmd.derive_namespace(args.vault)
    entities = suggest.collect_entities(args.vault, kind=args.kind, only=args.only)
    if not entities:
        print("No matching vault entities for that --kind/--only.", file=sys.stderr)
        return 1

    # Only entities that DON'T already carry a node with a real element_id are
    # candidates; a linked note is left exactly as-is.
    candidates, linked = [], 0
    for ent in entities:
        nd = _existing_node(ent["path"])
        if nd and nd.get("element_id"):
            linked += 1
            continue
        try:
            ent["_ek"] = suggest.element_spec(ent, mp)[0]
        except (KeyError, TypeError):
            continue          # kind the map can't route to an element kind (e.g. an unmapped PC)
        candidates.append(ent)

    if not candidates:
        print(f"All {linked} entit(y/ies) already carry a linked mobrpg: node — nothing to adopt.")
        return 0

    try:
        token = client.get_access_token()
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # Pull live elements once per element kind actually present among candidates.
    needed_kinds = sorted({ent["_ek"] for ent in candidates})
    live_idx: dict[str, dict] = {}
    for ek in needed_kinds:
        try:
            live_idx[ek] = index_live(live_by_kind(args.world, token, ek))
        except client.ApiError as e:
            print(f"ERROR listing live {ek}: {e}", file=sys.stderr)
            return 1

    stamped, ambiguous, unmatched = [], [], []
    for ent in candidates:
        matches = _match(ent, live_idx.get(ent["_ek"], {}))
        if len(matches) == 1:
            elem = matches[0]
            n = suggest.build_node(ent, mp, namespace, args.vault,
                                   element_id=elem["id"], review_state="accepted")
            if args.execute:
                txt = open(ent["path"], encoding="utf-8").read()
                open(ent["path"], "w", encoding="utf-8").write(node.write_node(txt, n))
            stamped.append((ent["name"], elem["name"], elem["id"]))
        elif len(matches) > 1:
            ambiguous.append((ent["name"], [m["name"] for m in matches]))
        else:
            unmatched.append(ent["name"])

    verb = "stamped" if args.execute else "would stamp"
    print(f"{verb} {len(stamped)} node(s); {len(ambiguous)} ambiguous, "
          f"{len(unmatched)} unmatched, {linked} already linked"
          + ("" if args.execute else "  [dry-run — no files changed]"))
    for name, live_name, eid in stamped:
        note = "" if suggest._key(name) == suggest._key(live_name) else f" (live: {live_name!r})"
        print(f"  ✓ {name} → {eid}{note}")
    for name, names in ambiguous:
        print(f"  ⚠ ambiguous, skipped: {name} — {len(names)} live matches: {', '.join(names)}")
    for name in unmatched:
        print(f"  · no live match: {name}")
    return 0
