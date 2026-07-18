"""mobrpg suggest — build the full datatype graph per vault entity (element +
classifier Types via Attribute edges + reified relationship Events) and submit it
as compound batches. Replaces the bare-CreateElement legacy push_suggestions.py.

Reads _meta/mobrpg-map.json (type rules), the crosswalk (entity/event ids), and
the vault .md files. Imports only clean modules — never the legacy push_*/smoketest
scripts (which print a PROD banner on import and couple to legacy transport).
"""
from __future__ import annotations

import glob
import os
import re

from mobrpg import md as _md
from mobrpg.commands import map_cmd


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
        # Race/Sex added in Task 6
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
