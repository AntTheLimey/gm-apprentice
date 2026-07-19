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
from mobrpg import node
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
    body = _md.strip_boilerplate(body)   # drop import placeholders / gm-only / comments
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
    html = _md.md_to_html(body.strip()) or "<p></p>"
    # A body with only section headings and no real prose (e.g. an imported
    # named-entity scaffold) has no authored content — emit the empty stub, not
    # bare heading tags, so nothing junky lands as the element description. Drop
    # heading elements entirely (incl. their text), then check what's left.
    no_headings = re.sub(r"<h[1-6][^>]*>.*?</h[1-6]>", "", html, flags=re.I | re.S)
    if not re.sub(r"<[^>]+>", "", no_headings).strip():
        return "<p></p>"
    return html


def _key(name: str) -> str:
    n = re.sub(r"\.md$", "", name or "").replace("_", " ").lower().replace("æ", "ae")
    n = re.sub(r"\b(mr|mrs|miss|dr|lord|lady|sir|the|of|st)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def _display_name(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def collect_entities(vault, *, chapter="", kind="", only="", limit=0,
                     exclude_kinds=None, only_provenance=None,
                     exclude_provenance=None) -> list[dict]:
    vault = os.path.expanduser(vault)
    exclude_kinds = exclude_kinds or set()
    out = []
    for folder, vkind in map_cmd.FOLDERS.items():
        if kind and vkind != kind:
            continue
        if vkind in exclude_kinds:
            continue
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(p, encoding="utf-8").read()
            if chapter and chapter not in txt:
                continue
            name = _display_name(p)
            if only and only.lower() not in name.lower():
                continue
            fm, body = _read(p)
            # An entity folder can hold non-entity sidecars (e.g. a `character-story`
            # note living beside its `pc`). Its `type` won't match the folder's kind,
            # and it isn't a world element — skip it so it never becomes a bogus
            # "… Story" push. Untyped legacy notes (no `type`) are still collected.
            ntype = map_cmd._scalar(fm, "type")
            if ntype and ntype != vkind:
                continue
            prov = map_cmd._scalar(fm, "provenance")
            if only_provenance and prov not in only_provenance:
                continue
            if exclude_provenance and prov in exclude_provenance:
                continue
            out.append({
                "path": p, "kind": vkind, "name": name, "provenance": prov,
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
    # An unresolved near-duplicate (map status "review") must NOT mint a new type
    # — that is the collision the review flag exists to prevent. Skip it until the
    # GM resolves it (to "confirmed" => create, or a bound mobrpgId => reuse).
    if entry.get("status") in ("drop", "review"):
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


def node_index(vault) -> tuple[dict, set]:
    """Build the target-resolution index from the vault's own `mobrpg:` nodes —
    the same (ent_id_by_key, linked) shape as `crosswalk_index`, for a
    node-migrated vault that no longer relies on a sidecar crosswalk. A node
    relationship already carrying an `event_id` is treated as already-linked."""
    idx, linked = {}, set()
    aliases: list[tuple[str, str]] = []
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(p, encoding="utf-8").read()
            nd = node.read_node(txt)
            if not nd or not nd.get("element_id"):
                continue
            subj = _key(_display_name(p))
            eid = nd["element_id"]
            idx[subj] = eid
            fm, _ = _read(p)
            for al in _aliases(fm):
                aliases.append((_key(al), eid))     # aliased target resolution (name wins — added after)
            for r in nd.get("relationships", []):
                if r.get("event_id"):
                    tgt = re.sub(r"^\[\[|\]\]$", "", (r.get("target") or "")).split("|")[0]
                    linked.add((subj, r.get("predicate"), _key(tgt)))
    for k, eid in aliases:
        idx.setdefault(k, eid)                       # a real entity name always wins over an alias
    return idx, linked


def _mapped_type(mp, predicate) -> str:
    """The mobRPG type for a predicate — a WorldElementRelationType (structural)
    or an Event eventType. The map's relationshipTypes overrides the defaults."""
    rt = mp.get("relationshipTypes", {})
    return rt.get(predicate) or map_cmd.predicate_type(predicate)


def relationship_items(entity, mp, entity_ref, ent_id_by_key, linked_triples,
                       vault, namespace, ref_seed,
                       ref_by_key=None) -> tuple[list[dict], list[str]]:
    """Build the relationship items for one entity.

    Targets resolve in three tiers: (1) an already-upstream element → its real
    id; (2) a *net-new* entity being created in this same push (its key is in
    `ref_by_key`) → the target's in-batch `suggestion:<ref>`, with that ref added
    to `dependsOn` and every item of the edge tagged `_needs=<ref>` so the
    chunker co-locates source and target in one batch (or defers the edge); (3)
    otherwise — the target is not a world element (a PC, a session note, a
    dangling wiki-link) → skipped. This closes the gap where an edge to a
    not-yet-linked entity was dropped even though the compound-suggestion
    transport can create-and-reference it in a single batch."""
    ref_by_key = ref_by_key or {}
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
        tgt_ref = None if tgt_id else ref_by_key.get(tgt_key)
        if not tgt_id and not tgt_ref:
            skipped.append(f"{entity['name']} --{pred}--> {tgt_raw} (target not a world element)")
            continue
        # Reference the target by real id (upstream) or in-batch suggestion ref (net-new).
        tgt_val = tgt_id if tgt_id else f"suggestion:{tgt_ref}"
        xdeps = [] if tgt_id else [tgt_ref]
        et = _mapped_type(mp, pred)
        tgt_disp = tgt_raw.replace("_", " ")
        if et in map_cmd.RELATION_TYPES:
            # Structural relation (Parent/Child/Link/Spouse): a direct
            # WorldElementRelation from the entity to the target — no reified
            # Event. Parent/Child auto-create their reverse on the backend.
            rel_item = _relation(et, f"suggestion:{entity_ref}", tgt_val, [entity_ref] + xdeps)
            if tgt_ref:
                rel_item["_needs"] = tgt_ref
            items.append(rel_item)
            continue
        eref = f"{ref_seed}v{n}"; n += 1
        desc = f"<p>{rel.get('desc') or pred}</p>"
        ext = f"{namespace}:rel/" + external_ref(entity["path"], vault, namespace).split(":", 1)[1] \
              + f"/{pred}/{tgt_key}"
        unit = [
            _create(eref, f"{entity['name']}, {pred} {tgt_disp}",
                    {"type": "Event", "eventType": et},
                    description=desc, external_ref=ext),
            _relation("Link", f"suggestion:{eref}", f"suggestion:{entity_ref}", [eref, entity_ref]),
            _relation("Link", f"suggestion:{eref}", tgt_val, [eref] + xdeps),
        ]
        if tgt_ref:
            # Tag the whole reified unit so it defers together — an Event linked to
            # its source but not its target would be meaningless.
            for it in unit:
                it["_needs"] = tgt_ref
        items.extend(unit)
    return items, skipped


def build_group(entity, mp, ent_id_by_key, linked_triples, race_id,
                vault, namespace, seq, ref_by_key=None) -> tuple[list[dict], list[str]]:
    ref = f"e{seq}"
    items = element_items(entity, mp, ref, vault, namespace)
    cls_items, reports = classifier_items(entity, mp, ref, race_id, ref)
    rel_items, skipped = relationship_items(entity, mp, ref, ent_id_by_key, linked_triples,
                                            vault, namespace, ref, ref_by_key)
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


def chunk_groups_colocated(groups, refs, cap=100) -> tuple[list[list[dict]], list[tuple]]:
    """Pack per-entity groups into <=cap batches, keeping a group and every
    net-new target group it references (items tagged `_needs=<ref>`) in the SAME
    batch, so the in-batch `suggestion:<ref>` resolves. Groups joined by such an
    edge form a co-location component that must land whole in one batch. A
    component that fits goes in whole; a component larger than `cap` is split and
    the edges spanning the split are DEFERRED — dropped from the batch and
    returned — rather than emitted as an unresolvable cross-batch ref (which
    would fail the all-or-nothing batch). Returns `(chunks, deferred)`, where
    `deferred` is a sorted list of `(source_ref, target_ref)` pairs."""
    n = len(groups)
    for g in groups:
        if len(g) > cap:
            raise ValueError(f"entity group has {len(g)} items > cap {cap}; narrow the entity")
    idx_of = {r: i for i, r in enumerate(refs)}
    needs = [{it["_needs"] for it in g if it.get("_needs") in idx_of} for g in groups]

    uf = list(range(n))
    def find(a):
        while uf[a] != a:
            uf[a] = uf[uf[a]]; a = uf[a]
        return a
    for i, ns in enumerate(needs):
        for t in ns:
            uf[find(i)] = find(idx_of[t])

    comps: dict[int, list[int]] = {}
    for i in range(n):
        comps.setdefault(find(i), []).append(i)

    batches: list[list[int]] = []
    batch_of: dict[int, int] = {}

    def _fits(members, extra):
        return sum(len(groups[m]) for m in members) + extra <= cap

    def place_whole(members):
        tot = sum(len(groups[m]) for m in members)
        for bi, b in enumerate(batches):
            if _fits(b, tot):
                b.extend(members)
                for m in members:
                    batch_of[m] = bi
                return
        batches.append(list(members))
        for m in members:
            batch_of[m] = len(batches) - 1

    def place_split(members):
        for m in sorted(members, key=lambda i: -len(groups[i])):
            for bi, b in enumerate(batches):
                if _fits(b, len(groups[m])):
                    b.append(m); batch_of[m] = bi
                    break
            else:
                batches.append([m]); batch_of[m] = len(batches) - 1

    # Largest fitting components first (better packing), then oversized ones.
    ordered = sorted(comps.values(), key=lambda ms: -sum(len(groups[m]) for m in ms))
    for members in ordered:
        (place_whole if sum(len(groups[m]) for m in members) <= cap else place_split)(members)

    deferred: set[tuple] = set()
    chunks: list[list[dict]] = []
    for bi, members in enumerate(batches):
        chunk = []
        for m in members:
            for it in groups[m]:
                t = it.get("_needs")
                # Defer (drop) any item whose net-new target ref isn't co-located in
                # THIS batch — including the defensive case where the ref names no
                # known group at all (t not in idx_of): keeping it would ship an
                # unresolvable cross-batch `suggestion:` ref and fail the batch. So
                # the guard is safe-defer, never silent-keep.
                if t is not None and (t not in idx_of or batch_of.get(idx_of[t]) != bi):
                    deferred.add((refs[m], t))
                    continue
                chunk.append({k: v for k, v in it.items() if k != "_needs"} if "_needs" in it else it)
        chunks.append(chunk)
    return chunks, sorted(deferred)


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
    ap.add_argument("--write-back", action="store_true",
                    help="write a pending mobrpg: node into each entity's vault file")
    ap.add_argument("--include-pcs", action="store_true",
                    help="also push player characters (PCs are excluded by default)")
    ap.add_argument("--only-provenance", default="",
                    help="only entities with this provenance (comma-separated: mobrpg,play,midwife,backstory)")
    ap.add_argument("--exclude-provenance", default="",
                    help="skip entities with this provenance (comma-separated)")
    args = ap.parse_args(argv)

    map_path = args.map or _default_map_path(args.vault)
    cw_path = args.crosswalk or _default_crosswalk()
    try:
        mp = json.load(open(map_path, encoding="utf-8"))
        crosswalk = json.load(open(cw_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading map/crosswalk: {e}", file=sys.stderr)
        return 2

    # Derive the namespace when the map omits it — never silently fall back to
    # "canticle" (an older/foreign map would mint mismatched externalRefs that
    # don't correlate to the vault's own nodes → duplicate-create risk).
    namespace = mp.get("vaultNamespace") or map_cmd.derive_namespace(args.vault)
    # PCs are player-owned; don't push them to the shared world unless asked.
    exclude_kinds = set() if args.include_pcs else {"pc"}
    only_prov = {s.strip() for s in args.only_provenance.split(",") if s.strip()}
    excl_prov = {s.strip() for s in args.exclude_provenance.split(",") if s.strip()}
    entities = collect_entities(args.vault, chapter=args.chapter, kind=args.kind,
                                only=args.only, limit=args.limit, exclude_kinds=exclude_kinds,
                                only_provenance=only_prov, exclude_provenance=excl_prov)
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

    # Resolve relationship targets from the crosswalk AND the vault's own
    # mobrpg: nodes; nodes win, so a node-migrated vault resolves targets even
    # when the (default/foreign) crosswalk doesn't know them.
    ent_id_by_key, linked = crosswalk_index(crosswalk)
    node_idx, node_linked = node_index(args.vault)
    ent_id_by_key.update(node_idx)
    linked |= node_linked
    # Every entity's in-batch group ref, so a relationship whose target is itself
    # net-new in this push resolves to that target's `suggestion:<ref>` instead of
    # being skipped for want of an upstream id.
    ref_by_key = {_key(ent["name"]): f"e{i}" for i, ent in enumerate(entities, 1)}
    for i, ent in enumerate(entities, 1):          # aliases resolve too; names already set win
        for al in ent.get("aliases", []):
            ref_by_key.setdefault(_key(al), f"e{i}")
    groups, refs, all_reports = [], [], []
    for i, ent in enumerate(entities, 1):
        items, reports = build_group(ent, mp, ent_id_by_key, linked, race_id,
                                     args.vault, namespace, i, ref_by_key)
        groups.append(items)
        refs.append(f"e{i}")
        all_reports.extend(reports)

    try:
        chunks, deferred = chunk_groups_colocated(groups, refs, cap=100)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    label = args.batch_label or f"{namespace} suggest ({args.chapter or 'all'})"
    os.makedirs(args.out, exist_ok=True)
    print(f"{len(entities)} entit(y/ies) → {sum(len(c) for c in chunks)} items in {len(chunks)} batch(es)")
    for r in all_reports:
        print(f"  [note] {r}")
    if deferred:
        print(f"  [deferred] {len(deferred)} relationship(s) span an oversized co-location "
              f"component — they push once their targets have upstream ids "
              f"(re-run suggest after accept + pull-canon):", file=sys.stderr)
        for src, tgt in deferred:
            print(f"    · {src} → {tgt}", file=sys.stderr)

    if args.write_back:
        w, s = write_back(entities, mp, args.vault, namespace, execute=args.execute)
        print(f"write-back: {w} node(s) written, {s} unchanged (skipped)"
              + ("" if args.execute else "  [dry-run — no files changed]"))

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


def _determined_name(section, raw):
    """The determined classifier NAME for a raw vault value, or None."""
    if not raw:
        return None
    entry = _lookup(section, raw)
    if entry is not None:
        mode, val = resolve_classifier(entry)
        if mode == "drop":
            return None
        if mode == "bound":
            return entry.get("name") or map_cmd._first_token(raw).title()
        return val or map_cmd._first_token(raw).title()
    return map_cmd._first_token(raw).title()


def determined_for(entity: dict, mp: dict) -> dict:
    cls = mp.get("classifiers", {})
    kind = entity["kind"]
    out: dict = {}
    if kind in ("npc", "pc"):
        prof = _determined_name(cls.get("profession", {}), entity.get("occupation"))
        if prof:
            out["profession"] = prof
        out["race"] = "Human"
        sex = _determined_name(cls.get("sex", {}), entity.get("gender"))
        if sex:
            out["sex"] = sex
    elif kind in ("faction", "organization"):
        ot = _determined_name(cls.get("organizationType", {}), entity.get("faction_type"))
        if ot:
            out["organization_type"] = ot
    elif kind == "creature":
        ct = _determined_name(cls.get("creatureType", {}), entity.get("creature_type"))
        if ct:
            out["creature_type"] = ct
    elif kind == "location":
        ek, data, route = element_spec(entity, mp)
        if ek == "landfeature":
            out["land_feature_type"] = data["landFeatureTypes"][0]
        else:
            name = (route or {}).get("politicalType") or map_cmd._first_token(
                entity.get("location_type") or "").title()
            if name:
                out["political_type"] = name
    elif kind == "item":
        out["item_type"] = "Generic"
    return out


def build_node(entity, mp, namespace, vault, *, element_id=None, review_state="pending"):
    ek, data, _ = element_spec(entity, mp)
    det = determined_for(entity, mp)
    payload = {"name": entity["name"], "altNames": sorted(entity.get("aliases") or []),
               "description": entity.get("description") or "<p></p>",
               "data": data, "determined": det}
    rels = [{"predicate": r["predicate"], "target": r["target"],
             "event_type": _mapped_type(mp, r["predicate"]),
             "event_id": None, "review_state": review_state}
            for r in entity.get("relationships", [])]
    kind_name = {"person": "Person", "political": "Political", "landfeature": "LandFeature",
                 "organization": "Organization", "creature": "Creature", "item": "Item"}
    return {
        "world_id": mp.get("worldId", ""),
        "external_ref": external_ref(entity["path"], vault, namespace),
        "element_id": element_id,
        "element_kind": kind_name.get(ek, ek.title()),
        "review_state": review_state,
        "content_hash": node.content_hash(payload),
        "last_synced": "",
        "review_note": "",
        "determined": det,
        "relationships": rels,
        "languages": [],
    }


def write_back(entities, mp, vault, namespace, *, execute) -> tuple[int, int]:
    written = skipped = 0
    for ent in entities:
        try:
            txt = open(ent["path"], encoding="utf-8").read()
        except OSError:
            continue
        existing = node.read_node(txt)
        newn = build_node(ent, mp, namespace, vault)
        # Preserve a canon link already ratified by pull-canon. build_node
        # defaults element_id=None / review_state="pending"; without this a
        # payload-affecting vault edit would silently wipe an accepted
        # element_id (recoverable only via another pull-canon, and dup-prone
        # if the GM re-suggests in the meantime).
        if existing and existing.get("element_id"):
            newn["element_id"] = existing["element_id"]
            if existing.get("review_state") not in (None, "pending"):
                newn["review_state"] = existing["review_state"]
        if existing and existing.get("content_hash") == newn["content_hash"] \
                and existing.get("review_state") not in (None, "pending"):
            skipped += 1
            continue
        if existing and existing.get("content_hash") == newn["content_hash"]:
            skipped += 1
            continue
        merged = node.write_node(txt, newn)
        if execute:
            with open(ent["path"], "w", encoding="utf-8") as fh:
                fh.write(merged)
        written += 1
    return written, skipped
