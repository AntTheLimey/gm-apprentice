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
from mobrpg import vault
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

    namespace = map_cmd.namespace_for(args.vault, mp)
    entities = suggest.collect_entities(args.vault, kind=args.kind, only=args.only)
    if not entities:
        print("No matching vault entities for that --kind/--only.", file=sys.stderr)
        return 1

    # Only entities that DON'T already carry a node with a real element_id are
    # candidates; a linked note is left exactly as-is.
    candidates, linked, unroutable = [], 0, 0
    for ent in entities:
        nd = _existing_node(ent["path"])
        if nd and nd.get("element_id"):
            linked += 1
            continue
        try:
            ent["_ek"] = suggest.element_spec(ent, mp)[0]
        except (KeyError, TypeError):
            unroutable += 1   # kind the map can't route to an element kind (e.g. an unmapped PC)
            continue
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
        except (client.ApiError, ValueError) as e:
            print(f"ERROR listing live {ek}: {e}", file=sys.stderr)
            return 1

    # (#257) An element links to one note. One a note already links is off the
    # table, and one that several candidates match is the GM's pick: two
    # linked notes for one element would each pull and push it under sync.
    claimed = vault.linked_element_paths(args.vault)
    matched, taken = {}, []
    for ent in candidates:
        matches = _match(ent, live_idx.get(ent["_ek"], {}))
        free = [m for m in matches if m["id"] not in claimed]
        if matches and not free:
            taken.append((ent["name"], [(m, claimed[m["id"]]) for m in matches]))
            continue
        matched[ent["path"]] = free
    by_element: dict[str, list] = {}
    for ent in candidates:
        ms = matched.get(ent["path"])
        if ms is not None and len(ms) == 1:
            by_element.setdefault(ms[0]["id"], []).append(ent)
    contested = {eid: ents for eid, ents in by_element.items() if len(ents) > 1}

    stamped, ambiguous, unmatched, kind_mismatch = [], [], [], []
    for ent in candidates:
        if ent["path"] not in matched:
            continue
        matches = matched[ent["path"]]
        if len(matches) == 1 and matches[0]["id"] in contested:
            continue
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
            # (#182) a location the map routes to one kind can exist upstream
            # under the SIBLING location kind when locationRouting guessed
            # wrong. An exact-named element there is a map bug to surface as
            # its own outcome — not a vault-only note to bury in "no live
            # match". Reported, never stamped: names can legitimately collide
            # across kinds, and the durable fix is correcting the route.
            sib = {"political": "landfeature",
                   "landfeature": "political"}.get(ent["_ek"])
            sib_matches = []
            if sib:
                if sib not in live_idx:
                    try:
                        live_idx[sib] = index_live(
                            live_by_kind(args.world, token, sib))
                    except (client.ApiError, ValueError) as e:
                        # Same call, same contract as the primary listings
                        # (fatal at run start): degrading here would let the
                        # summary claim "no live match" for an element the
                        # tool never actually looked for.
                        print(f"ERROR listing live {sib}: {e}", file=sys.stderr)
                        return 1
                sib_matches = _match(ent, live_idx.get(sib, {}))
            if sib_matches:
                kind_mismatch.append((ent, sib, sib_matches))
            else:
                unmatched.append(ent["name"])

    verb = "stamped" if args.execute else "would stamp"
    mism = f"{len(kind_mismatch)} kind mismatch, " if kind_mismatch else ""
    cont = f"{len(contested)} claimed by several notes, " if contested else ""
    tk = f"{len(taken)} matching an already-linked element, " if taken else ""
    print(f"{verb} {len(stamped)} node(s); {len(ambiguous)} ambiguous, "
          f"{mism}{cont}{tk}{len(unmatched)} unmatched, {linked} already linked"
          + ("" if args.execute else "  [dry-run — no files changed]"))
    if unroutable:
        print(f"  ({unroutable} entit(y/ies) had no element-kind mapping and "
              f"were not considered)")
    for name, live_name, eid in stamped:
        note = "" if suggest._key(name) == suggest._key(live_name) else f" (live: {live_name!r})"
        print(f"  ✓ {name} → {eid}{note}")
    for name, names in ambiguous:
        print(f"  ⚠ ambiguous, skipped: {name} — {len(names)} live matches: {', '.join(names)}")
    for eid, ents in contested.items():
        live_name = matched[ents[0]["path"]][0]["name"]
        print(f"  ⚠ claimed by {len(ents)} notes, skipped: {live_name} ({eid}) — "
              f"{', '.join(e['name'] for e in ents)}. Link one: drop the matching "
              f"name or alias from the others and re-run adopt.")
    for name, hits in taken:
        for m, path in hits:
            print(f"  · already linked by {path}: {name} matches {m['name']} ({m['id']}), "
                  f"skipped")
    for ent, sib, ms in kind_mismatch:
        ids = ", ".join(m["id"] for m in ms)
        print(f"  ⚠ kind mismatch, skipped: {ent['name']} — exists upstream as "
              f"{sib} ({ids}), but locationRouting sends location_type "
              f"{(ent.get('location_type') or '')!r} to {ent['_ek']}. Fix the "
              f"route in _meta/mobrpg-map.json and re-run adopt.")
    for name in unmatched:
        print(f"  · no live match: {name}")
    return 0
