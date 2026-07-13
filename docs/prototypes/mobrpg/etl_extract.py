#!/usr/bin/env python3
"""
mobRPG world → structured extract for vault synthesis.

Pulls every entity + event from a mobRPG world, resolves relationships (which
live in `event` join-entities, NOT on the entities themselves), converts HTML
descriptions to markdown, and emits one JSON record per entity. That JSON is the
input to the vault writer.

This is the reusable core of the mobRPG → gm-apprentice integration. See
integration-log.md for the method and gotchas it encodes.

Usage:
    export MOBRPG_TOKEN=...
    python3 etl_extract.py <worldId> [out.json]
"""
from __future__ import annotations
import json, os, re, sys
import smoketest as api   # reuses the authenticated _request() helper

# mobRPG eventType (7-enum) → gm-apprentice relationship predicate.
# The specific role (event name/title) is preserved separately.
EVENTTYPE_TO_PREDICATE = {
    "Membership": "member_of",
    "Leadership": "leads",
    "Employ":     "employs",      # person→place: refined to located_at below
    "Reign":      "owns",
    "War":        "enemy_of",
    "Score":      "participated_in",
    "Generic":    "associated_with",
}

# entity kinds to pull (list endpoints under /world/{id}/)
KINDS = ["person", "organization", "political", "landfeature", "item",
         "creature", "culture", "race", "event"]
# type/classifier entities — indexed so Attribute edges resolve, but NOT emitted
# as their own records/files.
CLASSIFIER_KINDS = ["organization/type", "political/type"]


def list_all(world: str, kind: str) -> list:
    try:
        r = api._request("GET", f"/world/{world}/{kind}", token=TOKEN,
                         query={"page": 0, "size": 500})
        c = r.get("content", r) if isinstance(r, dict) else r
        return c if isinstance(c, list) else []
    except Exception:
        return []


def get_one(world: str, kind: str, eid: str) -> dict:
    try:
        return api._request("GET", f"/world/{world}/{kind}/{eid}", token=TOKEN) or {}
    except Exception:
        return {}


def html_to_md(html: str | None) -> str:
    """Lightweight HTML→markdown for mobRPG's WYSIWYG output."""
    if not html:
        return ""
    s = html
    s = re.sub(r"<\s*br\s*/?\s*>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n\n", s, flags=re.I)
    s = re.sub(r"<\s*li\s*>", "- ", s, flags=re.I)
    s = re.sub(r"</li\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<\s*h2[^>]*>", "## ", s, flags=re.I)
    s = re.sub(r"<\s*h3[^>]*>", "### ", s, flags=re.I)
    s = re.sub(r"</h[23]\s*>", "\n\n", s, flags=re.I)
    s = re.sub(r"<\s*(strong|b)\s*>(.*?)</\s*(strong|b)\s*>", r"**\2**", s, flags=re.I | re.S)
    s = re.sub(r"<\s*(em|i)\s*>(.*?)</\s*(em|i)\s*>", r"*\2*", s, flags=re.I | re.S)
    s = re.sub(r"<[^>]+>", "", s)                    # strip remaining tags
    s = (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def role_from_event_name(name: str, subject: str) -> str | None:
    """'Holger Graeme, Leader of Station Security' + subject Holger → 'Leader of Station Security'."""
    if not name:
        return None
    if subject and name.startswith(subject):
        rest = name[len(subject):].lstrip(" ,")
        return rest or None
    # fallback: text after the first comma
    return name.split(",", 1)[1].strip() if "," in name else None


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: etl_extract.py <worldId> [out.json]", file=sys.stderr)
        return 2
    world = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else "extract.json"

    # 1. index every entity (light list pass) — includes classifier types
    index: dict[str, dict] = {}
    for kind in KINDS + CLASSIFIER_KINDS:
        for it in list_all(world, kind):
            if it.get("id"):
                index[it["id"]] = {"id": it["id"], "kind": kind,
                                   "name": it.get("name") or it.get("title") or "?"}

    # 2. build entity records with full descriptions (skip events + classifiers)
    records: dict[str, dict] = {}
    for eid, meta in index.items():
        if meta["kind"] in ("event", *CLASSIFIER_KINDS):
            continue
        full = get_one(world, meta["kind"], eid)
        records[eid] = {
            "id": eid,
            "kind": meta["kind"],
            "name": meta["name"],
            "altNames": full.get("altNames") or [],
            "body_md": html_to_md(full.get("description")),
            "notes_public": [],    # notes[] with hidden=false → player-safe
            "notes_gm": [],        # notes[] with hidden=true  → GM/Keeper only
            "classifiers": [],     # from Attribute edges
            "relationships": [],   # from events
        }
        # notes[] — a per-entity annotation array present on every entity. Each
        # note's `hidden` boolean is the GM-only flag: hidden=true is Keeper
        # content, hidden=false is player-safe. Split here; the vault writer
        # renders public notes into the body and GM notes into a Keeper callout.
        for note in (full.get("notes") or []):
            md = html_to_md(note.get("note"))
            if not md:
                continue
            bucket = "notes_gm" if note.get("hidden") else "notes_public"
            records[eid][bucket].append(md)
        # Attribute edges → classifiers (type/race/culture)
        for rel in (full.get("relations") or []):
            if rel.get("type") == "Attribute":
                other = rel["targetId"] if rel.get("sourceId") == eid else rel.get("sourceId")
                t = index.get(other)
                if t:
                    records[eid]["classifiers"].append({"kind": t["kind"], "name": t["name"]})
        # landfeature Feature Type lives on the entity as `landFeatureTypes`
        # (a Set<LandFeatureSubType>: Planet/Star/Moon/Asteroid/System/…), NOT
        # as an Attribute edge — so it was silently dropped before. Capture it
        # here so planets aren't mistaken for stars, moons for planets, etc.
        for sub in (full.get("landFeatureTypes") or []):
            records[eid]["classifiers"].append({"kind": "landfeature/subType", "name": sub})

    # 3. resolve events → relationships on participants
    events_out = []
    for eid, meta in index.items():
        if meta["kind"] != "event":
            continue
        ev = get_one(world, "event", eid)
        et = ev.get("eventType")
        predicate = EVENTTYPE_TO_PREDICATE.get(et, "associated_with")
        ends = [(r["targetId"] if r.get("sourceId") == eid else r.get("sourceId"))
                for r in (ev.get("relations") or []) if r.get("type") == "Link"]
        ends = [e for e in ends if e in records]
        # classify endpoints: subject = person if present, object = the other
        subj = next((e for e in ends if records[e]["kind"] == "person"), ends[0] if ends else None)
        obj = next((e for e in ends if e != subj), None)
        role = role_from_event_name(ev.get("name", ""), records[subj]["name"] if subj else "")
        events_out.append({"id": eid, "name": ev.get("name"), "eventType": et,
                           "title": ev.get("title"), "predicate": predicate,
                           "subject": records[subj]["name"] if subj else None,
                           "object": records[obj]["name"] if obj else None,
                           "role": role})
        if subj and obj:
            pred = predicate
            # Employ person→place reads better as located_at/works_at
            if et == "Employ" and records[obj]["kind"] in ("political", "landfeature"):
                pred = "located_at"
            records[subj]["relationships"].append(
                {"target": records[obj]["name"], "predicate": pred,
                 "eventType": et, "role": role})

    result = {"worldId": world, "entities": list(records.values()), "events": events_out,
              "counts": {k: sum(1 for r in records.values() if r["kind"] == k)
                         for k in KINDS if k != "event"}}
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"wrote {out_path}: {len(records)} entities, {len(events_out)} events")
    print("counts:", result["counts"])
    return 0


if __name__ == "__main__":
    TOKEN = os.environ.get("MOBRPG_TOKEN")
    if not TOKEN:
        print("set MOBRPG_TOKEN", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main())
