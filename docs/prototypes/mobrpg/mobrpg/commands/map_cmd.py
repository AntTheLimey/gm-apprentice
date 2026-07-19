"""mobrpg map — generate and maintain the per-vault mapping (vault vocab -> mobRPG types).

Turns the per-vault map from hand-authored into discovered-and-maintained. See
COMPLETE-SUGGESTIONS-SPEC.md ("The map command family").

    mobrpg map init  <world> --vault <path> [--out FILE]   # discover + scan + propose
    mobrpg map sync  <world> --vault <path> [--map FILE]    # re-discover, merge non-destructively
    mobrpg map check <world> --vault <path> [--map FILE]    # read-only coverage report

Discovery (mobRPG side) reuses the classifier catalog endpoints; the vault scan
collects the distinct values of the mapping-relevant frontmatter. `map` emits a
DRAFT: exact/ci matches bind to the existing type's real id (status "bound"),
unmatched values propose a new type ("new"), and genuinely ambiguous location
routes are flagged "review" for the skill / a human to resolve. Human decisions
(any entry with "confirmed": true, or a hand-edited target) are preserved by sync.

Read-only against mobRPG; writes only the local map file (never the vault content).
"""

from __future__ import annotations

import argparse
import datetime
import difflib
import glob
import json
import os
import re
import sys

from mobrpg import client

# vault entity kind -> mobRPG element kind (the KIND_EP table, data-driven here)
KINDS = {"npc": "person", "pc": "person", "location": "political",
         "faction": "organization", "organization": "organization",
         "item": "item", "creature": "creature"}

# vault folder -> vault kind (mirrors push_to_mobrpg.FOLDERS)
FOLDERS = {"Characters/NPCs": "npc", "Characters/PCs": "pc", "Locations": "location",
           "Factions & Organizations": "faction", "Items & Artifacts": "item",
           "Creatures": "creature"}

# closed LandFeatureSubType enum (authoritative, from LandFeatureType.java) — lowercased
LAND_SUBTYPES = {s.lower(): s for s in [
    "Arch", "Archipelago", "Artic", "Atoll", "Beach", "Bluff", "Butte", "Caldera", "Cave", "Cliff",
    "Crater", "Dale", "Desert", "DryLake", "Dune", "Farmland", "Forest", "Grassland", "Glen", "Gorge",
    "Gully", "Hill", "Island", "Jungle", "Mesa", "Mountain", "Pass", "Plain", "Range", "Ridge", "Rock",
    "Scrubland", "Shore", "Sinkhole", "Spit", "Vale", "Valley", "Volcano", "Wood",
    "Bar", "Bay", "Bayou", "Coast", "Cove", "Delta", "Estuary", "Fjord", "Glacier", "Gulf", "Inlet",
    "Lagoon", "Lake", "Marsh", "Oasis", "Ocean", "Pool", "Pond", "Reef", "River", "SaltMarsh", "Sea",
    "Shoal", "Sound", "Spring", "Strait", "Stream", "Swamp", "TidalMarsh", "Waterfall"]}

# vault relationship predicate -> mobRPG Event eventType (default table; extend in the map)
PREDICATE_EVENTTYPE = {
    "member_of": "Membership", "serves": "Membership", "leads": "Leadership", "led_by": "Leadership",
    "directed_by": "Leadership", "employs": "Employ", "owns": "Reign", "reign": "Reign",
    "enemy_of": "War", "participated_in": "Score",
}

# mobRPG has a SECOND relationship mechanism besides reified Events: a direct
# WorldElementRelation (enum Attribute | Link | Parent | Child | Spouse), where
# Parent/Child are auto-bidirectional. Structural/spatial predicates belong here,
# not as Generic events — a planet `part_of` a system is the system's Child.
RELATION_TYPES = {"Parent", "Child", "Link", "Spouse"}
PREDICATE_RELATION = {
    "part_of": "Parent",          # X part_of Y  -> X's parent is Y
    "contains": "Child", "hosts": "Child",   # X contains Y -> X's child is Y
    "adjacent_to": "Link",        # symmetric spatial adjacency
    "spouse_of": "Spouse", "married_to": "Spouse",
}


def predicate_type(predicate: str) -> str:
    """Resolve a vault predicate to its mobRPG type. A WorldElementRelationType
    (Parent/Child/Link/Spouse — see RELATION_TYPES) means a direct relation;
    anything else is an Event eventType (defaulting to Generic)."""
    if predicate in PREDICATE_RELATION:
        return PREDICATE_RELATION[predicate]
    return PREDICATE_EVENTTYPE.get(predicate, "Generic")


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _first_token(s: str) -> str:
    return re.split(r"[,/;]", s or "", maxsplit=1)[0].strip()


def _frontmatter(path: str) -> str:
    txt = open(path, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---", txt, re.S)
    return m.group(1) if m else ""


def _scalar(fm: str, key: str) -> str | None:
    m = re.search(rf"^{re.escape(key)}:\s*(.+)$", fm, re.M)
    if not m:
        return None
    return m.group(1).strip().strip('"').strip("'") or None


def _predicates(fm: str) -> list[str]:
    # relationship predicates appear as indented `type:` lines under `relationships:`
    block = re.search(r"^relationships:\s*\n(.*?)(?=^\S|\Z)", fm, re.S | re.M)
    if not block:
        return []
    return [m.group(1) for m in re.finditer(r"^\s+type:\s*(\S+)", block.group(1), re.M)]


def scan_vault(vault: str) -> dict:
    """Collect distinct mapping-relevant vocab (value -> count) from the vault frontmatter."""
    vocab = {k: {} for k in ("location_type", "occupation", "gender", "faction_type",
                             "creature_type", "predicate")}
    for folder in FOLDERS:
        for p in glob.glob(os.path.join(os.path.expanduser(vault), folder, "*.md")):
            fm = _frontmatter(p)
            for field in ("location_type", "occupation", "gender", "faction_type", "creature_type"):
                v = _scalar(fm, field)
                if v:
                    key = _first_token(v)
                    vocab[field][key] = vocab[field].get(key, 0) + 1
            for pred in _predicates(fm):
                vocab["predicate"][pred] = vocab["predicate"].get(pred, 0) + 1
    return vocab


def discover(world: str, token: str) -> dict:
    """Fetch existing mobRPG classifier vocab: kind -> {normalized name: id}."""
    out = {}
    for kind in ("political/type", "organization/type", "creature/type",
                 "person/race", "person/profession", "language", "landfeature"):
        try:
            data = client._request("GET", f"/world/{world}/{kind}?size=500", token=token)
        except (client.ApiError, ValueError):
            data = []  # ValueError covers JSONDecodeError (some endpoints return non-JSON/empty)
        items = data if isinstance(data, list) else data.get("content", []) if isinstance(data, dict) else []
        out[kind] = {_norm(e.get("name")): e.get("id") for e in items if isinstance(e, dict)}
    return out


# A vault value this close to an existing type (but not an exact-CI match) is
# probably a variant/typo of it, not a genuinely new type — park it for review.
_NEAR_DUP_CUTOFF = 0.85


def _closest(n: str, existing: dict) -> tuple[str, str] | None:
    """The (normalized-name, id) of the existing type closest to `n` above the
    near-duplicate cutoff, or None. `n` is assumed already normalized and NOT an
    exact match (callers check that first)."""
    hit = difflib.get_close_matches(n, list(existing), n=1, cutoff=_NEAR_DUP_CUTOFF)
    if hit and hit[0] != n:
        return hit[0], existing[hit[0]]
    return None


def _bind(value: str, existing: dict, target_kind: str) -> dict:
    """Match a vault value to an existing mobRPG type, flag a near-duplicate for
    review, else propose a new one."""
    tok = _first_token(value)
    n = _norm(tok)
    hit = existing.get(n)
    if hit:
        # recover the original-cased existing name
        return {"target": target_kind, "name": tok, "mobrpgId": hit, "status": "bound"}
    near = _closest(n, existing)
    if near:
        return {"target": target_kind, "name": tok.title(), "mobrpgId": None,
                "status": "review", "nearExisting": near[0], "nearId": near[1]}
    return {"target": target_kind, "name": tok.title(), "mobrpgId": None, "status": "new"}


# natural-feature words NOT spelled exactly like a LandFeatureSubType enum value
LAND_SYNONYMS = {
    "waterway": "River", "brook": "Stream", "creek": "Stream", "woods": "Wood", "wood": "Wood",
    "hills": "Hill", "mountains": "Mountain", "peak": "Mountain", "summit": "Mountain",
    "plateau": "Mesa", "canyon": "Gorge", "ravine": "Gorge", "gully": "Gully", "marshland": "Marsh",
    "wetland": "Marsh", "bog": "Swamp", "seashore": "Shore", "coastline": "Coast", "riverbank": "River",
}


def _embedded_landfeature(n: str) -> str | None:
    """The canonical LandFeatureSubType named by a *component word* of `n`, or
    None. Splits on non-letters so 'river valley' / 'old mill creek' surface the
    'river' / 'creek' feature word while single clean features (handled earlier)
    and plain political names ('hospital') do not."""
    for w in re.split(r"[^a-z]+", n):
        if w in LAND_SUBTYPES:
            return LAND_SUBTYPES[w]
        if w in LAND_SYNONYMS:
            return LAND_SYNONYMS[w]
    return None


def _route_location(value: str, disc: dict) -> dict:
    """Route a vault location_type to a mobRPG target. An existing PoliticalType
    binds; a type that IS a clean natural feature (exact LandFeatureSubType enum
    or a synonym) routes to LandFeature; a type that merely EMBEDS a feature word
    but isn't itself a clean feature is genuinely ambiguous (a natural feature, or
    a place named after one?) and is parked in 'review' with both candidates; and
    everything else defaults to a new PoliticalType."""
    tok = _first_token(value)
    n = _norm(tok)
    hit = disc["political/type"].get(n)
    if hit:  # reuse an existing PoliticalType
        return {"target": "political", "politicalType": tok, "mobrpgId": hit, "status": "bound"}
    if n in LAND_SUBTYPES:  # clearly a natural feature (exact enum)
        return {"target": "landfeature", "landFeatureType": LAND_SUBTYPES[n],
                "mobrpgId": None, "status": "new"}
    if n in LAND_SYNONYMS:  # clearly natural (synonym of an enum value)
        return {"target": "landfeature", "landFeatureType": LAND_SYNONYMS[n],
                "mobrpgId": None, "status": "new"}
    feature = _embedded_landfeature(n)
    if feature:  # embeds a feature word but isn't a clean feature -> GM decides
        return {"target": "political", "politicalType": tok.title(),
                "landFeatureType": feature, "mobrpgId": None, "status": "review"}
    # default: a new PoliticalType (obviously-not-landfeature => political)
    return {"target": "political", "politicalType": tok.title(), "mobrpgId": None, "status": "new"}


def build_map(world: str, world_meta: dict, vault: str, disc: dict, vocab: dict, now: str) -> dict:
    classifiers = {
        "profession": {v: _bind(v, disc["person/profession"], "person/profession")
                       for v in vocab["occupation"]},
        "organizationType": {v: _bind(v, disc["organization/type"], "organization/type")
                             for v in vocab["faction_type"]},
        "creatureType": {v: _bind(v, disc["creature/type"], "creature/type")
                         for v in vocab["creature_type"]},
        "sex": {v: {"target": "person/race/sex", "name": v.title(), "status": "new"}
                for v in vocab["gender"]},
    }
    location_routing = {v: _route_location(v, disc) for v in vocab["location_type"]}
    rel_types = {p: predicate_type(p) for p in vocab["predicate"]}
    return {
        "schema": "mobrpg-vault-map/v1",
        "world": world_meta.get("name"), "worldId": world,
        "vault": os.path.expanduser(vault), "vaultNamespace": "canticle",
        "discoveredAt": now,
        "kinds": dict(KINDS),
        "locationRouting": location_routing,
        "classifiers": classifiers,
        "relationshipTypes": rel_types,
        "_discoveredVocab": {k: sorted(vlist) for k, vlist in
                             {kk: list(vv.keys()) for kk, vv in disc.items()}.items()},
        "_vaultVocab": {k: v for k, v in vocab.items()},
    }


def _counts(m: dict) -> dict:
    def over(section):
        vals = list(section.values())
        return {"bound": sum(1 for x in vals if x.get("status") == "bound"),
                "new": sum(1 for x in vals if x.get("status") == "new"),
                "review": sum(1 for x in vals if x.get("status") == "review"),
                "confirmed": sum(1 for x in vals if x.get("confirmed")), "total": len(vals)}
    out = {"locationRouting": over(m.get("locationRouting", {}))}
    for name, sec in m.get("classifiers", {}).items():
        out[name] = over(sec)
    return out


def _merge(old: dict, new: dict) -> tuple[dict, list[str]]:
    """Non-destructive merge: preserve confirmed/hand-edited entries; add new keys;
    promote new->bound when a matching type now exists; flag stale keys."""
    notes = []
    merged = dict(new)
    for section in ("locationRouting",):
        o, n = old.get(section, {}), new.get(section, {})
        res = {}
        for k, nv in n.items():
            ov = o.get(k)
            if ov and (ov.get("confirmed") or ov.get("status") == "confirmed"):
                res[k] = ov  # human decision wins
            elif ov and ov.get("status") in ("new", "review") and nv.get("status") == "bound":
                res[k] = nv; notes.append(f"{section}[{k}]: now bound to existing type")
            else:
                res[k] = nv
        for k in o:
            if k not in n:
                stale = dict(o[k]); stale["status"] = "stale"; res[k] = stale
                notes.append(f"{section}[{k}]: no longer in vault (stale)")
        merged[section] = res
    for name in new.get("classifiers", {}):
        o = old.get("classifiers", {}).get(name, {})
        n = new["classifiers"][name]
        res = {}
        for k, nv in n.items():
            ov = o.get(k)
            if ov and (ov.get("confirmed") or ov.get("status") == "confirmed"):
                res[k] = ov  # human decision wins (parity with locationRouting)
            elif ov and ov.get("status") in ("new", "review") and nv.get("status") == "bound":
                res[k] = nv; notes.append(f"classifiers.{name}[{k}]: now bound")
            else:
                res[k] = nv
        for k in o:
            if k not in n:
                stale = dict(o[k]); stale["status"] = "stale"; res[k] = stale
                notes.append(f"classifiers.{name}[{k}]: stale")
        merged.setdefault("classifiers", {})[name] = res
    return merged, notes


def _default_map_path(vault: str) -> str:
    return os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="mobrpg map",
                                 description="Generate/maintain the per-vault mobRPG mapping.")
    ap.add_argument("action", choices=("init", "sync", "check"))
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
    ap.add_argument("--out", default="", help="init: where to write (default: the map path)")
    ap.add_argument("--now", default="", help="timestamp override (tests); default: UTC now")
    args = ap.parse_args(argv)

    map_path = args.map or args.out or _default_map_path(args.vault)
    now = args.now or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

    try:
        token = client.get_access_token()
        world_meta = {}
        try:
            worlds = client._request("GET", "/world", token=token)
            wl = worlds if isinstance(worlds, list) else worlds.get("content", [])
            world_meta = next((w for w in wl if w.get("id") == args.world), {})
        except client.ApiError:
            pass
        disc = discover(args.world, token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    vocab = scan_vault(args.vault)
    fresh = build_map(args.world, world_meta, args.vault, disc, vocab, now)

    if args.action == "check":
        old = json.load(open(map_path)) if os.path.exists(map_path) else fresh
        print(f"map coverage ({map_path if os.path.exists(map_path) else '(no map yet; showing fresh)'}):")
        for section, c in _counts(old).items():
            print(f"  {section:18} total={c['total']:3}  bound={c['bound']:3}  new={c['new']:3}  "
                  f"review={c['review']:3}  confirmed={c['confirmed']:3}")
        return 0

    if args.action == "init":
        if os.path.exists(map_path):
            print(f"map already exists at {map_path} — use `map sync` to update it.", file=sys.stderr)
            return 2
        os.makedirs(os.path.dirname(map_path), exist_ok=True)
        json.dump(fresh, open(map_path, "w"), indent=2, ensure_ascii=False)
        c = _counts(fresh)
        print(f"wrote {map_path}")
        for section, cc in c.items():
            print(f"  {section:18} total={cc['total']:3} bound={cc['bound']:3} new={cc['new']:3} review={cc['review']:3}")
        return 0

    # sync
    if not os.path.exists(map_path):
        print(f"no map at {map_path} — run `map init` first.", file=sys.stderr)
        return 2
    old = json.load(open(map_path))
    merged, notes = _merge(old, fresh)
    merged["discoveredAt"] = now
    json.dump(merged, open(map_path, "w"), indent=2, ensure_ascii=False)
    print(f"synced {map_path}: {len(notes)} change(s)")
    for n in notes:
        print(f"  - {n}")
    if not notes:
        print("  (no drift)")
    return 0
