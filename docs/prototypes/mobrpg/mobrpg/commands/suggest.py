"""mobrpg suggest — build the full datatype graph per vault entity (element +
classifier Types via Attribute edges + reified relationship Events) and submit it
as compound batches. Replaces the bare-CreateElement legacy push_suggestions.py.

Reads _meta/mobrpg-map.json (type rules), the crosswalk (entity/event ids), and
the vault .md files. Imports only clean modules — never the legacy push_*/smoketest
scripts (which print a PROD banner on import and couple to legacy transport).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

from mobrpg import client
from mobrpg import md as _md
from mobrpg.commands import map_cmd
from mobrpg.commands import submit_batch


def _read(path: str) -> tuple[str, str]:
    txt = open(path, encoding="utf-8").read()
    if txt.startswith("---"):
        _, fm, body = txt.split("---", 2)
        return fm, body
    return "", txt


def _aliases(fm: str) -> list[str]:
    aliases = (re.findall(r'-\s*"?([^"\n]+?)"?\s*$',
                          re.search(r"aliases:(.*?)(?=\n\w|\Z)", fm, re.S).group(1), re.M)
               if "aliases:" in fm else [])
    aliases = [a for a in (re.findall(r'aliases:\s*\[([^\]]*)\]', fm) or [""])[0].split(",")
               if a.strip()] or aliases
    return [a.strip().strip('"') for a in aliases if a.strip()]


def _relationships(fm: str) -> list[dict]:
    m = re.search(r"^relationships:\s*\n(.*?)(?=^\S|\Z)", fm, re.S | re.M)
    if not m:
        return []
    out = []
    for blk in re.split(r"\n\s*-\s+target:", m.group(1)):
        t = re.search(r"\[\[([^\]|]+)", blk)
        if not t:
            continue
        out.append({
            "target": t.group(1).strip(),
            "predicate": (re.search(r"type:\s*(\S+)", blk) or [None, "associated_with"])[1],
            "desc": (re.search(r'description:\s*"?(.*?)"?\s*$', blk, re.M) or [None, ""])[1].strip(),
        })
    return out


def _description(body: str) -> str:
    for h in ["## Appearances", "## Source References", "## GM Notes", "## Notes"]:
        i = body.find(h)
        if i != -1:
            nxt = body.find("\n## ", i + 3)
            keep_tail = h in ("## Appearances", "## Source References")
            body = body[:i] + (body[nxt:] if nxt != -1 and keep_tail else "")
    body = re.sub(r"```.*?```", "", body, flags=re.S)
    body = re.sub(r"!\[\[[^\]]+\]\]", "", body)
    body = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", lambda m: m.group(2).replace("_", " "), body)
    body = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).replace("_", " "), body)
    body = re.sub(r"^#\s+.*$", "", body, flags=re.M)
    return _md.md_to_html(body.strip()) or "<p></p>"


def _key(name: str) -> str:
    n = re.sub(r"\.md$", "", name or "").replace("_", " ").lower().replace("æ", "ae")
    n = re.sub(r"\b(mr|mrs|miss|dr|lord|lady|sir|the|of|st)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def _display_name(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def collect_entities(vault, *, chapter="", kind="", only="", limit=0) -> list[dict]:
    vault = os.path.expanduser(vault)
    out = []
    for folder, vkind in map_cmd.FOLDERS.items():
        if kind and vkind != kind:
            continue
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(p, encoding="utf-8").read()
            if chapter and chapter not in txt:
                continue
            name = _display_name(p)
            if only and only.lower() not in name.lower():
                continue
            fm, body = _read(p)
            out.append({
                "path": p, "kind": vkind, "name": name,
                "aliases": _aliases(fm), "description": _description(body),
                "location_type": map_cmd._scalar(fm, "location_type"),
                "occupation": map_cmd._scalar(fm, "occupation"),
                "gender": map_cmd._scalar(fm, "gender"),
                "faction_type": map_cmd._scalar(fm, "faction_type"),
                "creature_type": map_cmd._scalar(fm, "creature_type"),
                "relationships": _relationships(fm),
            })
    if limit:
        out = out[:limit]
    return out


KIND_DATA = {
    "person": lambda: {"type": "Person", "languages": [], "equipment": []},
    "organization": lambda: {"type": "Organization", "titles": []},
    "item": lambda: {"type": "Item", "attributes": {"itemType": "Generic"}},
    "creature": lambda: {"type": "Creature"},
    "political": lambda: {"type": "Political", "titles": []},
}

# classifier element kind → fresh minimal Type data
TYPE_DATA = {
    "Profession": lambda: {"type": "Profession"},
    "Race": lambda: {"type": "Race"},
    "Sex": lambda: {"type": "Sex"},
    "OrganizationType": lambda: {"type": "OrganizationType", "titles": []},
    "CreatureType": lambda: {"type": "CreatureType"},
    "PoliticalType": lambda: {"type": "PoliticalType", "titles": []},
}


def _create(ref, name, data, *, description="<p></p>", altNames=None, external_ref=None) -> dict:
    item = {"ref": ref, "operation": "CreateElement",
            "payload": {"operation": "CreateElement", "name": name,
                        "description": description, "altNames": list(altNames or []),
                        "data": data},
            "dependsOn": []}
    if external_ref:
        item["externalRef"] = external_ref
    return item


def _relation(rel_type, source_ref, target_ref, depends) -> dict:
    return {"operation": "AddRelation",
            "payload": {"operation": "AddRelation", "sourceRef": source_ref,
                        "targetRef": target_ref, "type": rel_type},
            "dependsOn": list(depends)}


def resolve_classifier(entry) -> tuple[str, str | None]:
    if not entry:
        return ("drop", None)
    if entry.get("mobrpgId"):
        return ("bound", entry["mobrpgId"])
    if entry.get("status") == "drop":
        return ("drop", None)
    return ("create", entry.get("name"))


def _lookup(section, raw):
    if not raw:
        return None
    key = map_cmd._first_token(raw)
    if key in section:
        return section[key]
    return {k.lower(): v for k, v in section.items()}.get(key.lower())


def external_ref(path, vault, namespace) -> str:
    rel = os.path.relpath(path, os.path.expanduser(vault))
    if rel.endswith(".md"):
        rel = rel[:-3]
    return f"{namespace}:" + rel.replace(os.sep, "/")


def element_spec(entity, mp) -> tuple[str, dict, dict | None]:
    kind = entity["kind"]
    if kind == "location":
        route = _lookup(mp.get("locationRouting", {}), entity.get("location_type") or "")
        if route and route.get("target") == "landfeature":
            sub = route.get("landFeatureType") or "Rock"
            return ("landfeature", {"type": "LandFeature", "landFeatureTypes": [sub]}, route)
        return ("political", {"type": "Political", "titles": []}, route)
    ek = mp.get("kinds", {}).get(kind) or map_cmd.KINDS.get(kind)
    return (ek, KIND_DATA[ek](), None)


def element_items(entity, mp, ref, vault, namespace) -> list[dict]:
    _, data, _ = element_spec(entity, mp)
    return [_create(ref, entity["name"], data,
                    description=entity.get("description") or "<p></p>",
                    altNames=entity.get("aliases"),
                    external_ref=external_ref(entity["path"], vault, namespace))]


def _attach_classifier(section, raw, type_kind, entity_ref, ref_id):
    """Return (items, unmapped_report_or_None) for one classifier attached to entity_ref.
    Emits a Type create (unless bound) + an Attribute edge (classifier source → entity target)."""
    entry = _lookup(section, raw)
    unmapped = None
    if entry is None:
        if not raw:
            return [], None
        name = map_cmd._first_token(raw).title()
        mode, val = "create", name
        unmapped = f"{type_kind}:{name}"
    else:
        mode, val = resolve_classifier(entry)
    if mode == "drop" or not val:
        return [], None
    if mode == "bound":
        return [_relation("Attribute", val, f"suggestion:{entity_ref}", [entity_ref])], unmapped
    tref = ref_id
    return ([_create(tref, val, TYPE_DATA[type_kind]()),
             _relation("Attribute", f"suggestion:{tref}", f"suggestion:{entity_ref}",
                       [tref, entity_ref])], unmapped)


def classifier_items(entity, mp, entity_ref, race_id, ref_seed) -> tuple[list[dict], list[str]]:
    cls = mp.get("classifiers", {})
    items, reports = [], []
    n = [0]

    def seed():
        r = f"{ref_seed}t{n[0]}"; n[0] += 1; return r

    def add(section_name, raw, type_kind):
        it, rep = _attach_classifier(cls.get(section_name, {}), raw, type_kind, entity_ref, seed())
        items.extend(it)
        if rep:
            reports.append(rep)

    kind = entity["kind"]
    if kind in ("npc", "pc"):
        add("profession", entity.get("occupation"), "Profession")
        if race_id:
            # Race → Person (default Human, real id)
            items.append(_relation("Attribute", race_id, f"suggestion:{entity_ref}", [entity_ref]))
            gender = entity.get("gender")
            if gender:
                entry = _lookup(cls.get("sex", {}), gender)
                sex_name = (entry or {}).get("name") or map_cmd._first_token(gender).title()
                mode, bound = resolve_classifier(entry) if entry else ("create", None)
                if mode == "bound" and bound:
                    # scope + classify the existing Sex id
                    items.append(_relation("Attribute", race_id, bound, []))
                    items.append(_relation("Attribute", bound, f"suggestion:{entity_ref}", [entity_ref]))
                elif mode != "drop":
                    sref = seed()
                    items.append(_create(sref, sex_name, TYPE_DATA["Sex"]()))
                    items.append(_relation("Attribute", race_id, f"suggestion:{sref}", [sref]))
                    items.append(_relation("Attribute", f"suggestion:{sref}",
                                           f"suggestion:{entity_ref}", [sref, entity_ref]))
        elif entity.get("gender"):
            reports.append("race:Human (no live race id — skipped Race/Sex)")
    elif kind in ("faction", "organization"):
        add("organizationType", entity.get("faction_type"), "OrganizationType")
    elif kind == "creature":
        add("creatureType", entity.get("creature_type"), "CreatureType")
    elif kind == "location":
        ek, _, route = element_spec(entity, mp)
        if ek == "political":
            name = (route or {}).get("politicalType") or map_cmd._first_token(
                entity.get("location_type") or "").title()
            if name:
                pid = (route or {}).get("mobrpgId")
                if pid:
                    items.append(_relation("Attribute", pid, f"suggestion:{entity_ref}", [entity_ref]))
                else:
                    tref = seed()
                    items.append(_create(tref, name, TYPE_DATA["PoliticalType"]()))
                    items.append(_relation("Attribute", f"suggestion:{tref}",
                                           f"suggestion:{entity_ref}", [tref, entity_ref]))
        # landfeature: subtype is inline on the element; no edge
    return items, reports


def crosswalk_index(crosswalk) -> tuple[dict, set]:
    idx = {}
    for e in crosswalk.get("entities", []):
        if e.get("mobrpg_id"):
            idx[_key(e.get("name"))] = e["mobrpg_id"]
    linked = set()
    for r in crosswalk.get("relationships", []):
        if r.get("mobrpg_event_id"):
            linked.add((_key(r.get("subject")), r.get("predicate"), _key(r.get("target"))))
    return idx, linked


def _event_type(mp, predicate) -> str:
    rt = mp.get("relationshipTypes", {})
    return rt.get(predicate) or map_cmd.PREDICATE_EVENTTYPE.get(predicate, "Generic")


def relationship_items(entity, mp, entity_ref, ent_id_by_key, linked_triples,
                       vault, namespace, ref_seed) -> tuple[list[dict], list[str]]:
    items, skipped = [], []
    subj_key = _key(entity["name"])
    n = 0
    for rel in entity.get("relationships", []):
        pred, tgt_raw = rel["predicate"], rel["target"]
        tgt_key = _key(tgt_raw)
        if (subj_key, pred, tgt_key) in linked_triples:
            skipped.append(f"{entity['name']} --{pred}--> {tgt_raw} (already linked)")
            continue
        tgt_id = ent_id_by_key.get(tgt_key)
        if not tgt_id:
            skipped.append(f"{entity['name']} --{pred}--> {tgt_raw} (target not in crosswalk)")
            continue
        et = _event_type(mp, pred)
        tgt_disp = tgt_raw.replace("_", " ")
        eref = f"{ref_seed}v{n}"; n += 1
        desc = f"<p>{rel.get('desc') or pred}</p>"
        ext = f"{namespace}:rel/" + external_ref(entity["path"], vault, namespace).split(":", 1)[1] \
              + f"/{pred}/{tgt_key}"
        items.append(_create(eref, f"{entity['name']}, {pred} {tgt_disp}",
                             {"type": "Event", "eventType": et},
                             description=desc, external_ref=ext))
        items.append(_relation("Link", f"suggestion:{eref}", f"suggestion:{entity_ref}", [eref, entity_ref]))
        items.append(_relation("Link", f"suggestion:{eref}", tgt_id, [eref]))
    return items, skipped


def build_group(entity, mp, ent_id_by_key, linked_triples, race_id,
                vault, namespace, seq) -> tuple[list[dict], list[str]]:
    ref = f"e{seq}"
    items = element_items(entity, mp, ref, vault, namespace)
    cls_items, reports = classifier_items(entity, mp, ref, race_id, ref)
    rel_items, skipped = relationship_items(entity, mp, ref, ent_id_by_key, linked_triples,
                                            vault, namespace, ref)
    return items + cls_items + rel_items, reports + skipped


def chunk_groups(groups, cap=100) -> list[list[dict]]:
    chunks, cur = [], []
    for g in groups:
        if len(g) > cap:
            raise ValueError(f"entity group has {len(g)} items > cap {cap}; narrow the entity")
        if cur and len(cur) + len(g) > cap:
            chunks.append(cur); cur = []
        cur.extend(g)
    if cur:
        chunks.append(cur)
    return chunks


def discover_race_id(world, token, race_name="Human") -> str | None:
    try:
        data = client._request("GET", f"/world/{world}/person/race?size=500", token=token)
    except (client.ApiError, ValueError):
        return None
    items = data if isinstance(data, list) else data.get("content", []) if isinstance(data, dict) else []
    for e in items:
        if isinstance(e, dict) and (e.get("name") or "").strip().lower() == race_name.lower():
            return e.get("id")
    return None


def _default_map_path(vault):
    return os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")


def _default_crosswalk():
    # canticle-regency-crosswalk.json ships next to the package's parent (prototype dir)
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                        "canticle-regency-crosswalk.json")


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg suggest",
        description="Build + submit the full datatype graph per vault entity "
                    "(element + classifier Types + reified relationship events).")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
    ap.add_argument("--crosswalk", default="", help="crosswalk file (default: packaged Canticle crosswalk)")
    ap.add_argument("--chapter", default="", help="restrict to entities tagged with a chapter")
    ap.add_argument("--kind", default="", help="restrict to one vault kind")
    ap.add_argument("--only", default="", help="substring match on entity name")
    ap.add_argument("--limit", type=int, default=0, help="cap number of entities")
    ap.add_argument("--batch-label", default="", help="override the batch label")
    ap.add_argument("--out", default="./push_out", help="where to write batch JSON")
    ap.add_argument("--execute", action="store_true", help="actually submit (default: dry-run)")
    args = ap.parse_args(argv)

    map_path = args.map or _default_map_path(args.vault)
    cw_path = args.crosswalk or _default_crosswalk()
    try:
        mp = json.load(open(map_path, encoding="utf-8"))
        crosswalk = json.load(open(cw_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading map/crosswalk: {e}", file=sys.stderr)
        return 2

    namespace = mp.get("vaultNamespace", "canticle")
    entities = collect_entities(args.vault, chapter=args.chapter, kind=args.kind,
                                only=args.only, limit=args.limit)
    if not entities:
        print("No matching vault entities for that --chapter/--kind/--only.", file=sys.stderr)
        return 1

    try:
        token = client.get_access_token()
        race_id = discover_race_id(args.world, token)
    except client.ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if race_id is None:
        print("  note: no live 'Human' race found — persons will skip Race/Sex edges.", file=sys.stderr)

    ent_id_by_key, linked = crosswalk_index(crosswalk)
    groups, all_reports = [], []
    for i, ent in enumerate(entities, 1):
        items, reports = build_group(ent, mp, ent_id_by_key, linked, race_id,
                                     args.vault, namespace, i)
        groups.append(items)
        all_reports.extend(reports)

    try:
        chunks = chunk_groups(groups, cap=100)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    label = args.batch_label or f"Canticle suggest ({args.chapter or 'all'})"
    os.makedirs(args.out, exist_ok=True)
    print(f"{len(entities)} entit(y/ies) → {sum(len(c) for c in chunks)} items in {len(chunks)} batch(es)")
    for r in all_reports:
        print(f"  [note] {r}")

    rc = 0
    for idx, chunk in enumerate(chunks, 1):
        req = {"batchLabel": f"{label} [{idx}/{len(chunks)}]", "suggestions": chunk}
        json.dump(req, open(os.path.join(args.out, f"suggest-batch-{idx}.json"), "w"),
                  indent=2, ensure_ascii=False)
        try:
            submit_batch.submit(args.world, req, execute=args.execute, index=idx)
        except client.ApiError as e:
            print(f"ERROR on batch {idx}: {e}", file=sys.stderr)
            rc = 1
            break
    return rc
