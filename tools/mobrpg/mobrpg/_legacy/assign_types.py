#!/usr/bin/env python3
"""
Second pass: assign mobRPG TYPES to entities created by push_to_mobrpg.py.

In mobRPG an entity's type is an `Attribute` edge FROM a type-entity TO the
entity (confirmed in the backend: WorldElementService.getAttributes uses
findByTargetId(entity, Attribute)). So:
  POST /world/{w}/{typeKind}/{typeId}/relation  body {targetId: entityId, type: Attribute}

  person   -> race (Human) + sex (Male/Female from vault gender)
  location -> political/type  (find-or-create from vault location_type)
  item     -> itemType is a DATA field, not an edge -> reported, not set here

Idempotent: skips any entity that already has an Attribute edge.
Defaults to dry-run; --execute writes.

Usage: python3 assign_types.py <worldId> [--execute]
"""
from __future__ import annotations
import argparse, glob, json, os, re, sys
import smoketest as api

VAULT = os.path.expanduser("~/Documents/CTHULHU/Canticle")


def L(world, token, kind):
    r = api._request("GET", f"/world/{world}/{kind}", token=token, query={"page": 0, "size": 300})
    c = r.get("content", r) if isinstance(r, dict) else r
    return c if isinstance(c, list) else []


def vault_field(name, folder, field):
    f = os.path.join(VAULT, folder, name.replace(" ", "_") + ".md")
    if not os.path.exists(f):
        return ""
    m = re.search(rf"^{field}:\s*(.+)$", open(f).read(), re.M)
    return m.group(1).strip().strip('"') if m else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("world")
    ap.add_argument("--chapter", default="chapter-1")
    ap.add_argument("--execute", action="store_true")
    args = ap.parse_args()
    W = args.world
    tok = os.environ["MOBRPG_TOKEN"]
    DO = args.execute

    created = json.load(open(f"push_out/push-{args.chapter}.json"))
    created = [c for c in created if c.get("created_id")]

    HUMAN = {n: i for n, i in [(x["name"], x["id"]) for x in L(W, tok, "person/race")]}.get("Human")
    sexes = {x["name"]: x["id"] for x in L(W, tok, "person/race/sex")}
    ptypes = {x["name"].lower(): x["id"] for x in L(W, tok, "political/type")}

    def has_attribute(kind, eid):
        try:
            full = api._request("GET", f"/world/{W}/{kind}/{eid}", token=tok)
            return any(r.get("type") == "Attribute" for r in (full.get("relations") or []))
        except Exception:
            return False

    def attribute(type_kind, type_id, entity_id):
        if not DO:
            return "dry-run"
        api._request("POST", f"/world/{W}/{type_kind}/{type_id}/relation", token=tok,
                     body={"targetId": entity_id, "type": "Attribute"})
        return "set"

    def find_or_create_ptype(label):
        key = label.lower()
        if key in ptypes:
            return ptypes[key]
        if not DO:
            return "(would-create)"
        # description is NOT NULL in prod's elements table — omitting it 500s
        resp = api._request("POST", f"/world/{W}/political/type", token=tok,
                            body={"name": label, "altNames": [],
                                  "description": f"<p>{label}</p>"})
        ptypes[key] = resp["id"]
        return resp["id"]

    log = {"npc": [], "location": [], "item": [], "skipped": [], "new_types": []}
    for c in created:
        name, kind, eid = c["name"], c["kind"], c["created_id"]
        ep = {"npc": "person", "location": "political", "item": "item"}[kind]
        if has_attribute(ep, eid):
            log["skipped"].append(f"{name} (already typed)")
            continue
        if kind == "npc":
            attribute("person/race", HUMAN, eid)
            g = vault_field(name, "Characters/NPCs", "gender")
            sx = sexes.get(g)
            if sx:
                attribute("person/race/sex", sx, eid)
            log["npc"].append(f"{name}: Human" + (f" + {g}" if sx else " (no sex)"))
        elif kind == "location":
            lt = vault_field(name, "Locations", "location_type")
            label = re.split(r"[,/]", lt)[0].strip().title() if lt else "Location"
            before = len(ptypes)
            tid = find_or_create_ptype(label)
            if len(ptypes) > before:
                log["new_types"].append(label)
            attribute("political/type", tid, eid)
            log["location"].append(f"{name}: {label}")
        elif kind == "item":
            log["item"].append(f"{name}: itemType not set (needs UpdateItemRequest data field)")

    print(f"{'EXECUTED' if DO else 'DRY-RUN'}")
    for k in ("npc", "location"):
        print(f"\n== {k} ({len(log[k])}) ==")
        for line in log[k]:
            print("  ", line)
    print(f"\nnew political/types {'created' if DO else 'to create'}: {sorted(set(log['new_types']))}")
    print(f"skipped (already typed): {len(log['skipped'])}")
    print(f"items deferred: {len(log['item'])}")
    json.dump(log, open("push_out/assign-types-log.json", "w"), indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
