"""mobrpg pull — import a mobRPG world into a structured JSON extract.

Ported from the prototype's etl_extract.py: pulls every entity + event, resolves
relationships (which live in `event` join-entities), converts HTML descriptions
to markdown, and emits one JSON record per entity — the input to `mobrpg write`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

from mobrpg import client

# mobRPG eventType (7-enum) → gm-apprentice relationship predicate.
EVENTTYPE_TO_PREDICATE = {
    "Membership": "member_of",
    "Leadership": "leads",
    "Employ": "employs",
    "Reign": "owns",
    "War": "enemy_of",
    "Score": "participated_in",
    "Generic": "associated_with",
}

KINDS = ["person", "organization", "political", "landfeature", "item",
         "creature", "culture", "race", "event"]
CLASSIFIER_KINDS = ["organization/type", "political/type"]


def _list_all(world: str, kind: str, token: str) -> list:
    try:
        r = client._request("GET", f"/world/{world}/{kind}", token=token,
                            query={"page": 0, "size": 500})
        c = r.get("content", r) if isinstance(r, dict) else r
        return c if isinstance(c, list) else []
    except Exception:
        return []


def _get_one(world: str, kind: str, eid: str, token: str) -> dict:
    try:
        return client._request("GET", f"/world/{world}/{kind}/{eid}", token=token) or {}
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
    s = re.sub(r"<[^>]+>", "", s)
    s = (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
           .replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " "))
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def role_from_event_name(name: str, subject: str) -> str | None:
    if not name:
        return None
    if subject and name.startswith(subject):
        rest = name[len(subject):].lstrip(" ,")
        return rest or None
    return name.split(",", 1)[1].strip() if "," in name else None


def extract(world: str, token: str) -> dict:
    # 1. index every entity (light list pass) — includes classifier types
    index: dict[str, dict] = {}
    for kind in KINDS + CLASSIFIER_KINDS:
        for it in _list_all(world, kind, token):
            if it.get("id"):
                index[it["id"]] = {"id": it["id"], "kind": kind,
                                   "name": it.get("name") or it.get("title") or "?"}

    # 2. build entity records with full descriptions (skip events + classifiers)
    records: dict[str, dict] = {}
    for eid, meta in index.items():
        if meta["kind"] in ("event", *CLASSIFIER_KINDS):
            continue
        full = _get_one(world, meta["kind"], eid, token)
        records[eid] = {
            "id": eid, "kind": meta["kind"], "name": meta["name"],
            "altNames": full.get("altNames") or [],
            "body_md": html_to_md(full.get("description")),
            "notes_public": [], "notes_gm": [],
            "classifiers": [], "relationships": [],
        }
        for note in (full.get("notes") or []):
            md = html_to_md(note.get("note"))
            if not md:
                continue
            bucket = "notes_gm" if note.get("hidden") else "notes_public"
            records[eid][bucket].append(md)
        for rel in (full.get("relations") or []):
            if rel.get("type") == "Attribute":
                other = rel["targetId"] if rel.get("sourceId") == eid else rel.get("sourceId")
                t = index.get(other)
                if t:
                    records[eid]["classifiers"].append({"kind": t["kind"], "name": t["name"]})
        for sub in (full.get("landFeatureTypes") or []):
            records[eid]["classifiers"].append({"kind": "landfeature/subType", "name": sub})

    # 3. resolve events → relationships on participants
    events_out = []
    for eid, meta in index.items():
        if meta["kind"] != "event":
            continue
        ev = _get_one(world, "event", eid, token)
        et = ev.get("eventType")
        predicate = EVENTTYPE_TO_PREDICATE.get(et, "associated_with")
        ends = [(r["targetId"] if r.get("sourceId") == eid else r.get("sourceId"))
                for r in (ev.get("relations") or []) if r.get("type") == "Link"]
        ends = [e for e in ends if e in records]
        subj = next((e for e in ends if records[e]["kind"] == "person"), ends[0] if ends else None)
        obj = next((e for e in ends if e != subj), None)
        role = role_from_event_name(ev.get("name", ""), records[subj]["name"] if subj else "")
        events_out.append({"id": eid, "name": ev.get("name"), "eventType": et,
                           "title": ev.get("title"), "predicate": predicate,
                           "subject": records[subj]["name"] if subj else None,
                           "object": records[obj]["name"] if obj else None, "role": role})
        if subj and obj:
            pred = predicate
            if et == "Employ" and records[obj]["kind"] in ("political", "landfeature"):
                pred = "located_at"
            records[subj]["relationships"].append(
                {"target": records[obj]["name"], "predicate": pred,
                 "eventType": et, "role": role})

    return {"worldId": world, "entities": list(records.values()), "events": events_out,
            "counts": {k: sum(1 for r in records.values() if r["kind"] == k)
                       for k in KINDS if k != "event"}}


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg pull",
        description="Import a mobRPG world into a structured JSON extract.")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--out", default="extract.json",
                    help="output JSON path (default: extract.json)")
    args = ap.parse_args(argv)

    token = client.get_access_token()
    try:
        client.whoami(token)  # fail fast on bad auth / no connectivity
        result = extract(args.world, token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"wrote {args.out}: {len(result['entities'])} entities, {len(result['events'])} events")
    print("counts:", result["counts"])
    return 0
