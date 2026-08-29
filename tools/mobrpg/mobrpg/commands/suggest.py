"""mobrpg suggest — build the full datatype graph per vault entity (element +
classifier Types via Attribute edges + reified relationship Events) and submit it
as compound batches. This is the push path: the owner accepts or dismisses each
suggestion, so no live element is ever created directly.

Reads _meta/mobrpg-map.json (type rules) and the vault .md files. Entity/event
ids come from the vault's own `mobrpg:` nodes (node_index) — the single source of
truth; there is no sidecar crosswalk.
"""
from __future__ import annotations

import argparse
import glob
import html as _html
import json
import os
import re
import sys
import unicodedata

from mobrpg import client
from mobrpg import md as _md
from mobrpg import node
from mobrpg import section
from mobrpg.commands import map_cmd
from mobrpg.commands import submit_batch
from mobrpg.vault import vault_only_sections


def _read(path: str) -> tuple[str, str]:
    txt = open(path, encoding="utf-8").read()
    # Reuse node's fence splitter rather than str.split("---", 2): the latter
    # raises ValueError on a note that opens with '---' but has no closing fence,
    # and misparses a lone '--- inline ---' line. A note with no real frontmatter
    # is treated as body-only.
    _pre, fm_body, post = node._split_frontmatter(txt)
    if fm_body is None:
        return "", txt
    body = post[3:] if post.startswith("---") else post   # drop the closing fence
    return fm_body, body


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


def _description(body: str, vault_only: tuple = section.DEFAULT_VAULT_ONLY) -> str:
    """The CreateElement description for a note body.

    `vault_only` names the H2 sections this vault keeps to itself; it comes from
    `vault_only_sections` so a create strips exactly what `sync`'s update strips
    (the four defaults, or whatever `vaultOnlySections` replaces them with).
    Stripping is delegated to `section.split_vault_only` for the same reason —
    one stripper, both push paths, and the fence-aware section boundaries come
    with it."""
    body = _md.strip_boilerplate(body)   # drop import placeholders / gm-only / comments
    body = section.split_vault_only(body, vault_only)[0]
    body = re.sub(r"```.*?```", "", body, flags=re.S)
    body = re.sub(r"!\[\[[^\]]+\]\]", "", body)
    body = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", lambda m: m.group(2).replace("_", " "), body)
    body = re.sub(r"\[\[([^\]]+)\]\]", lambda m: m.group(1).replace("_", " "), body)
    body = re.sub(r"^#\s+.*$", "", body, flags=re.M)
    body = body.strip()
    # A body with only section headings and no real prose (e.g. an imported
    # named-entity scaffold) has no authored content — emit "" (the caller
    # falls back to the empty stub), not a bare heading line, so nothing junky
    # lands as the element description. Drop heading lines, then check what's
    # left. #150: this is now the cleaned MARKDOWN, not md_to_html'd HTML —
    # mobRPG supports Markdown natively.
    no_headings = re.sub(r"(?m)^#{1,6}\s.*$", "", body)
    if not no_headings.strip():
        return ""
    return body


def _key(name: str) -> str:
    """Fold a name to its match key.

    Accents are decomposed and their combining marks dropped, so a name reaches
    one key whichever normal form it arrives in. macOS stores filenames
    NFD-decomposed while a `[[wikilink]]` typed into a note is NFC, and the old
    `[^a-z0-9]` strip treated the two differently — it removed a combining accent
    but kept its base letter (NFD "Róbert" -> "robert") and removed a precomposed
    letter outright (NFC "Róbert" -> "rbert"). Every edge pointing at an accented
    entity was reported "target not a world element" and dropped from the push.
    """
    n = unicodedata.normalize("NFKD", re.sub(r"\.md$", "", name or ""))
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = n.replace("_", " ").lower().replace("æ", "ae")
    n = re.sub(r"\b(mr|mrs|miss|dr|lord|lady|sir|the|of|st)\b", "", n)
    return re.sub(r"[^a-z0-9]", "", n)


def _display_name(path: str) -> str:
    return os.path.splitext(os.path.basename(path))[0].replace("_", " ")


def collect_entities(vault, *, chapter="", kind="", only="", limit=0,
                     exclude_kinds=None, only_provenance=None,
                     exclude_provenance=None) -> list[dict]:
    vault = os.path.expanduser(vault)
    exclude_kinds = exclude_kinds or set()
    vault_only = vault_only_sections(vault)
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
                "aliases": _aliases(fm),
                "description": _description(body, vault_only),
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


def _create(ref, name, data, *, description="<p></p>", description_type=None,
            altNames=None, external_ref=None) -> dict:
    """`description_type` is left unset (backend defaults to Html) for the
    HTML fragments this module still hand-builds (empty stub, reified-event
    blurbs); callers passing real vault Markdown (#150) set it explicitly."""
    item = {"ref": ref, "operation": "CreateElement",
            "payload": {"operation": "CreateElement", "name": name,
                        "description": description, "altNames": list(altNames or []),
                        "data": data},
            "dependsOn": []}
    if description_type:
        item["payload"]["descriptionType"] = description_type
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
    desc = entity.get("description") or ""
    return [_create(ref, entity["name"], data,
                    description=desc or "<p></p>",
                    description_type="Markdown" if desc else None,
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
        name = map_cmd.classifier_name(raw).title()
        mode, val = "create", name
        unmapped = f"{type_kind}:{name}"
    else:
        mode, val = resolve_classifier(entry)
    if mode == "drop" or not val:
        return [], None
    if mode == "bound":
        return [_relation("Attribute", val, f"suggestion:{entity_ref}", [entity_ref])], unmapped
    # `val` is the map entry's stored name, which may predate sanitization or have
    # been hand-edited — re-clean so the pushed create name never carries markup and
    # a clean/dirty pair still dedupes on an identical name.
    val = map_cmd.classifier_name(val).title()
    if not val:                      # nothing left after cleaning → mint nothing
        return [], None
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
                # Run the map name (or raw gender) through classifier_name like every
                # other classifier — a stored sex name may predate sanitization, and
                # skipping it leaks markup upstream + disagrees with the determined block.
                sex_name = map_cmd.classifier_name((entry or {}).get("name") or gender).title()
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


def node_index(vault) -> tuple[dict, set, set]:
    """Build the target-resolution index from the vault's own `mobrpg:` nodes —
    the (ent_id_by_key, linked, submitted) triple suggest resolves against. This is
    the single source of truth: a vault entity is "already upstream" iff it carries
    a node with an `element_id`. A node relationship already carrying an `event_id`
    is treated as already-linked. `submitted` is the set of entity keys whose node
    already carries a `pending`, `dismissed` or `deleted` review_state — the GM has
    already ruled on them upstream, so they must not be re-filed. `deleted` belongs
    here for the same reason a dismissal does: pull-canon stamps it when the element
    is gone from the live world, which is the GM deleting it. Re-suggesting would
    silently undo that decision on every run."""
    idx, linked, submitted = {}, set(), set()
    aliases: list[tuple[str, str]] = []
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(p, encoding="utf-8").read()
            nd = node.read_node(txt)
            if not nd:
                continue
            subj = _key(_display_name(p))
            if nd.get("review_state") in ("pending", "dismissed", "deleted"):
                submitted.add(subj)
            if not nd.get("element_id"):
                continue
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
    return idx, linked, submitted


def _mapped_type(mp, predicate) -> str:
    """The mobRPG type for a predicate — a WorldElementRelationType (structural)
    or an Event eventType. The map's relationshipTypes overrides the defaults."""
    rt = mp.get("relationshipTypes", {})
    return rt.get(predicate) or map_cmd.predicate_type(predicate)


def node_kind_index(vault) -> dict:
    """{entity key: mobRPG element kind} from the vault's own `mobrpg:` nodes.

    A node's `element_kind` is what canon says the element IS, which is what
    decides an affiliation edge's eventType (see map_cmd.affiliation). Aliases
    resolve too, and a real entity name always wins over an alias — same rule as
    node_index, so the two indexes agree on what a target name refers to."""
    idx: dict = {}
    aliases: list[tuple[str, str]] = []
    vault = os.path.expanduser(vault)
    for folder in map_cmd.FOLDERS:
        for p in sorted(glob.glob(os.path.join(vault, folder, "*.md"))):
            txt = open(p, encoding="utf-8").read()
            nd = node.read_node(txt)
            if not nd or not nd.get("element_kind"):
                continue
            idx[_key(_display_name(p))] = nd["element_kind"]
            fm, _ = _read(p)
            for al in _aliases(fm):
                aliases.append((_key(al), nd["element_kind"]))
    for k, kind in aliases:
        idx.setdefault(k, kind)
    return idx


def _resolve(mp, pred, subj_key, tgt_key, kind_by_key):
    """(mobrpg_type, affiliation_or_None) for one authored edge.

    Delegates to map_cmd.resolve_event_type so the push and `pull-canon
    --baseline` can never disagree about what an edge's type is."""
    kind_by_key = kind_by_key or {}
    return map_cmd.resolve_event_type(mp, pred, kind_by_key.get(subj_key),
                                      kind_by_key.get(tgt_key))


def relationship_items(entity, mp, entity_ref, ent_id_by_key, linked_triples,
                       vault, namespace, ref_seed,
                       ref_by_key=None, kind_by_key=None) -> tuple[list[dict], list[str]]:
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
        tgt_disp = re.sub(r"^\[\[|\]\]$", "", tgt_raw).split("|")[0].replace("_", " ")
        overridden = map_cmd.is_map_override(mp, pred)
        et, aff = _resolve(mp, pred, subj_key, tgt_key, kind_by_key)
        if aff and et != _mapped_type(mp, pred):
            # The grid disagreed with the predicate map. Usually that IS the fix
            # (`serves` an Organization is Membership, not Employ), but it also
            # exposes vault modelling: `Alphonse member_of Station 45` becomes
            # Employ because Station 45 is authored as a location, and mobRPG
            # offers no "member of a Political". Say which, so the GM can decide
            # whether the target is the wrong entity rather than the wrong type.
            gk = kind_by_key.get(tgt_key if aff[1] else subj_key)
            offered = "/".join(map_cmd.event_types_for_kind(gk))
            article = "an" if gk and gk[0] in "AEIOU" else "a"
            skipped.append(
                f"{entity['name']} --{pred}--> {tgt_disp}: {_mapped_type(mp, pred)}"
                f" -> {et} (the group endpoint is {article} {gk}; mobRPG offers "
                f"only {offered} there)")
        # Test the FLAT mapping, not `et` — resolve_event_type has already turned
        # `et` into Generic, so keying off it would silence this note entirely.
        if kind_by_key and not aff and not overridden \
                and _mapped_type(mp, pred) in map_cmd.AFFILIATION_EVENT_TYPES:
            # The flat map named an affiliation type but the endpoints aren't a
            # person/group pair mobRPG's GUI could build, so resolve_event_type
            # degraded it to Generic. Report it: Generic is the right carrier, but
            # a surprising one here often means the vault edge is wrong — an Item
            # that `owns` an Organization is a reversed edge, and a person who
            # `serves` another person usually serves that person's venue.
            sk = kind_by_key.get(subj_key) or "?"
            tk = kind_by_key.get(tgt_key) or "?"
            skipped.append(
                f"{entity['name']} --{pred}--> {tgt_disp}: {_mapped_type(mp, pred)}"
                f" -> Generic ({sk}->{tk} is not a person/group pair, so mobRPG's "
                f"GUI could not build a {_mapped_type(mp, pred)} event here)")
        if et in map_cmd.RELATION_TYPES:
            # Structural relation (Parent/Child/Link/Spouse): a direct
            # WorldElementRelation — no reified Event. Parent/Child auto-create
            # their reverse on the backend. Subordinate-first spatial predicates
            # (part_of/located_at/headquartered_at) emit container-first: mobRPG
            # wants the dominant element as source, so swap "X part_of Y" -> (Y, X).
            src, tgt = f"suggestion:{entity_ref}", tgt_val
            if pred in map_cmd.REVERSED_PREDICATES:
                src, tgt = tgt, src
            rel_item = _relation(et, src, tgt, [entity_ref] + xdeps)
            if tgt_ref:
                rel_item["_needs"] = tgt_ref
            items.append(rel_item)
            continue
        eref = f"{ref_seed}v{n}"; n += 1
        # Escape before interpolating: this is one of the two descriptions the CLI
        # hand-builds as HTML (see skill/references/push.md), and the text inside it
        # is vault-authored. An unescaped `&` shipped as an undefined entity and an
        # unescaped `<` was swallowed as a tag by the renderer.
        desc = f"<p>{_html.escape(rel.get('desc') or pred)}</p>"
        # The rel/ ref is the edge's identity across re-pushes — keyed on the
        # authored predicate and target, never on the emitted name, so renaming
        # an event can't make it re-file as net-new.
        ext = f"{namespace}:rel/" + external_ref(entity["path"], vault, namespace).split(":", 1)[1] \
              + f"/{pred}/{tgt_key}"
        if aff:
            # mobRPG's own naming: the person always leads, and the title word
            # and preposition come from formatEventName. A real title is the
            # reviewer's to pick from the target's title vocabulary — we don't
            # guess one (the vault's `occupation` is already pushed as a
            # Profession classifier, so reusing it here would double-encode it
            # and read as "Alphonse, Station 45 Gang Member of Station 45").
            title, prep = map_cmd.AFFILIATION_NAMING[et]
            person, group = ((entity["name"], tgt_disp) if aff[1]
                             else (tgt_disp, entity["name"]))
            ev_name = f"{person}, {title} {prep} {group}"
        else:
            ev_name = f"{entity['name']}, {pred} {tgt_disp}"
        unit = [
            _create(eref, ev_name,
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


def partition_entities(entities, ent_id_by_key,
                       submitted_keys=None) -> tuple[list[dict], list[dict], list[dict]]:
    """Split entities into (net_new, linked, submitted).

    An entity whose name (or an alias, via the caller's key index) already
    resolves to an upstream element id is *linked* — it exists in mobRPG and must
    NOT be re-filed as a brand-new CreateElement. An entity whose node already
    carries a pending/dismissed suggestion (`submitted_keys`) is *submitted* — a
    card for it is already in the reviewer's queue (or was rejected), so re-filing
    would duplicate it. The rest are *net-new* and get a full CreateElement
    cluster. Linked entities' genuine relationship deltas are the job of the
    relationship-baseline pass, not of re-mirroring the whole graph on every push."""
    submitted_keys = submitted_keys or set()
    net_new, linked, submitted = [], [], []
    for ent in entities:
        k = _key(ent["name"])
        if k in ent_id_by_key:
            linked.append(ent)
        elif k in submitted_keys:
            submitted.append(ent)
        else:
            net_new.append(ent)
    return net_new, linked, submitted


def held_relationship_count(linked, ent_id_by_key, ref_by_key, linked_triples) -> int:
    """How many relationships hang off already-linked entities and *would* be
    genuine new edges (target resolves, not already linked) — i.e. the deltas the
    baseline pass will carry. Reported so a skipped-linked push never silently
    swallows real relationship content."""
    held = 0
    for ent in linked:
        subj = _key(ent["name"])
        for rel in ent.get("relationships", []):
            tgt_key = _key(rel["target"])
            if (subj, rel["predicate"], tgt_key) in linked_triples:
                continue
            if tgt_key in ent_id_by_key or tgt_key in ref_by_key:
                held += 1
    return held


def build_group(entity, mp, ent_id_by_key, linked_triples, race_id,
                vault, namespace, seq, ref_by_key=None,
                kind_by_key=None) -> tuple[list[dict], list[str]]:
    ref = f"e{seq}"
    items = element_items(entity, mp, ref, vault, namespace)
    cls_items, reports = classifier_items(entity, mp, ref, race_id, ref)
    rel_items, skipped = relationship_items(entity, mp, ref, ent_id_by_key, linked_triples,
                                            vault, namespace, ref, ref_by_key,
                                            kind_by_key)
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


def _is_type_create(item) -> bool:
    """A classifier-Type mint: a CreateElement with no externalRef. Entity elements
    and reified relationship events always carry one, so this cleanly excludes them."""
    return item.get("operation") == "CreateElement" and not item.get("externalRef")


def dedupe_type_creates(groups, refs) -> tuple[list[list[dict]], list]:
    """Collapse duplicate classifier-Type creates (same element-type + name) across
    entity groups to a single create.

    Two entities that share an unbound classifier — profession "Station 45 Gang
    Member", political type "Territory" — each mint their own CreateElement, so a
    push would create the type N times in the shared world. Keep the first (by group
    order, deterministic); drop the rest; re-point every borrowing edge's
    sourceRef/targetRef/dependsOn at the survivor, and tag it `_needs=<owner entity
    ref>` so the co-location chunker keeps borrower and survivor in one batch (the
    in-batch `suggestion:<ref>` must resolve). Returns `(groups, refs)` unchanged in
    shape, mutated in place."""
    survivor: dict = {}          # (etype, name) -> (type_ref, owner_entity_ref)
    for gi, group in enumerate(groups):
        for it in group:
            if _is_type_create(it):
                key = (it["payload"]["data"].get("type"), it["payload"].get("name"))
                survivor.setdefault(key, (it["ref"], refs[gi]))

    for gi, group in enumerate(groups):
        remap: dict = {}         # dropped type_ref -> (survivor_ref, owner_entity_ref)
        kept = []
        for it in group:
            if _is_type_create(it):
                key = (it["payload"]["data"].get("type"), it["payload"].get("name"))
                surv_ref, owner = survivor[key]
                if surv_ref != it["ref"]:
                    remap[it["ref"]] = (surv_ref, owner)
                    continue      # drop this duplicate mint
            kept.append(it)
        if not remap:
            continue
        for it in kept:
            for ref, (surv_ref, owner) in remap.items():
                sref, dref = "suggestion:" + ref, "suggestion:" + surv_ref
                p = it.get("payload", {})
                touched = False
                if p.get("sourceRef") == sref:
                    p["sourceRef"] = dref; touched = True
                if p.get("targetRef") == sref:
                    p["targetRef"] = dref; touched = True
                if ref in it.get("dependsOn", []):
                    it["dependsOn"] = [surv_ref if d == ref else d for d in it["dependsOn"]]
                    touched = True
                if touched:
                    it["_needs"] = owner   # co-locate borrower with the survivor's group
        groups[gi] = kept
    return groups, refs


def _affiliation_event_key(group, item):
    """(eventType, frozenset of the event's two endpoints) for an affiliation
    Event, or None. Endpoints come from the event's own Link items, so a real
    upstream id and an in-batch `suggestion:<ref>` key the same way they resolve."""
    p = item.get("payload", {})
    data = p.get("data") or {}
    if p.get("operation") != "CreateElement" or data.get("type") != "Event":
        return None
    et = data.get("eventType")
    if et not in map_cmd.AFFILIATION_EVENT_TYPES:
        return None
    me = "suggestion:" + item["ref"]
    ends = set()
    for it in group:
        q = it.get("payload", {})
        if q.get("operation") != "AddRelation" or q.get("type") != "Link":
            continue
        if q.get("sourceRef") == me and q.get("targetRef"):
            ends.add(q["targetRef"])
        elif q.get("targetRef") == me and q.get("sourceRef"):
            ends.add(q["sourceRef"])
    return (et, frozenset(ends)) if len(ends) == 2 else None


def dedupe_affiliation_events(groups, refs) -> tuple[list[list[dict]], list[str]]:
    """Collapse duplicate person<->group affiliation events across entity groups.

    An affiliation is one fact with two authored halves: the vault holds
    `Marek Solano serves Corvid Financial` on the person and
    `Corvid Financial employs Marek Solano` on the organization. Both now resolve
    to the same (eventType, endpoints), and both landed in Tim's world as separate
    Employ events on the 2026-07-20 push. Storage is single-direction by rule
    (`shared/relationship-normalization.md`), so the second half is redundant, not
    a second fact — keep the first by group order (deterministic) and drop the
    duplicate's create together with its two Link items.

    Scoped to Reign/Employ/Membership/Leadership on purpose: for a Generic event
    the eventType says nothing, so two Generic events between the same pair are
    two different facts (`knows` and `trusts`) and must both survive.

    Returns `(groups, dropped_reports)`; groups are mutated in place.
    """
    seen: dict = {}
    reports: list[str] = []
    for gi, group in enumerate(groups):
        drop_refs = set()
        for it in group:
            key = _affiliation_event_key(group, it)
            if key is None:
                continue
            first = seen.get(key)
            if first is None:
                seen[key] = it["payload"].get("name")
                continue
            drop_refs.add(it["ref"])
            reports.append(
                f"[dedup] dropped duplicate {key[0]} event "
                f"{it['payload'].get('name')!r} — already emitted as {first!r}")
        if not drop_refs:
            continue
        dropped = {"suggestion:" + r for r in drop_refs}
        groups[gi] = [
            it for it in group
            if it.get("ref") not in drop_refs
            and it.get("payload", {}).get("sourceRef") not in dropped
            and it.get("payload", {}).get("targetRef") not in dropped]
    return groups, reports


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
    # Paginate via the shared fetcher — the old ?size=500 single fetch had no
    # totalPages handling, so a world with >one page of races could miss 'Human'.
    for e in map_cmd._fetch_all(f"/world/{world}/person/race", token):
        if isinstance(e, dict) and (e.get("name") or "").strip().lower() == race_name.lower():
            return e.get("id")
    return None


def _default_map_path(vault):
    return os.path.join(os.path.expanduser(vault), "_meta", "mobrpg-map.json")


def upstream_unlinked(world, token, entities, mp) -> tuple[list[tuple[dict, dict]], list[tuple[dict, list]]]:
    """Net-new candidates that already exist live upstream (matched by
    normalized name/alias within their element kind, exactly as `adopt` does).

    A vault can lose track of an element it pushed earlier — accepted upstream,
    never pulled, no `element_id` on the note — and re-filing it looks harmless
    (the server skips the CreateElement as already claimed). It is not: every
    AddRelation in the batch whose ref is `suggestion:<that ref>` is then
    unresolvable and the WHOLE batch 400s with no hint which item is at fault
    (#179). Checking first costs one paginated GET per element kind present.
    Returns `(matched, ambiguous)`: `matched` pairs an entity with its single
    live element; `ambiguous` pairs it with the several that share its name."""
    from mobrpg.commands import adopt   # local: adopt imports this module
    by_kind: dict[str, list] = {}
    for ent in entities:
        try:
            by_kind.setdefault(element_spec(ent, mp)[0], []).append(ent)
        except (KeyError, TypeError):
            continue
    matched, ambiguous = [], []
    for ek, ents in sorted(by_kind.items()):
        idx = adopt.index_live(adopt.live_by_kind(world, token, ek))
        for ent in ents:
            hits = adopt._match(ent, idx)
            if len(hits) == 1:
                matched.append((ent, hits[0]))
            elif hits:
                ambiguous.append((ent, hits))
    return matched, ambiguous


def entities_in_chunk(chunk, ents_by_ref) -> list[dict]:
    """The net-new entities whose CreateElement rides in `chunk`, keyed by the
    externalRef the create carries (the same ref the server echoes back)."""
    out = []
    for it in chunk:
        if it.get("operation") == "CreateElement" and it.get("externalRef") in ents_by_ref:
            out.append(ents_by_ref[it["externalRef"]])
    return out


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg suggest",
        description="Build + submit the full datatype graph per vault entity "
                    "(element + classifier Types + reified relationship events).")
    ap.add_argument("world", help="mobRPG worldId")
    ap.add_argument("--vault", required=True, help="vault root path")
    ap.add_argument("--map", default="", help="map file (default: <vault>/_meta/mobrpg-map.json)")
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
    try:
        mp = json.load(open(map_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR reading map: {e}", file=sys.stderr)
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

    # Resolve relationship targets and already-linked triples from the vault's
    # own mobrpg: nodes — the single source of truth. An entity with no node is
    # treated as net-new; give it a node first (via the live name-match reconcile)
    # rather than trusting any sidecar crosswalk.
    ent_id_by_key, linked, submitted_keys = node_index(args.vault)

    # An already-upstream entity must NOT be re-filed as a brand-new CreateElement
    # (that filed 140 of Space's 169 Tranche-A entities as bogus creates). Only
    # net-new entities get a full cluster; linked entities' relationship deltas are
    # the baseline pass's job, so they're held (and reported), never silently lost.
    # Entities with a pending/dismissed suggestion already in the queue are also
    # held — re-filing would duplicate the card the reviewer already has.
    net_new, linked_ents, submitted_ents = partition_entities(
        entities, ent_id_by_key, submitted_keys)

    # Anything that already exists live but has no node must not be re-filed:
    # its create is skipped as already claimed and the edges that hang off it
    # fail the whole batch (#179). Hold it and point at `adopt`, which links it.
    preexisting, ambiguous_live = [], []
    if net_new:
        try:
            preexisting, ambiguous_live = upstream_unlinked(args.world, token, net_new, mp)
        except client.ApiError as e:
            print(f"ERROR checking live world for pre-existing elements: {e}", file=sys.stderr)
            return 1
        held_paths = {e["path"] for e, _ in preexisting} | {e["path"] for e, _ in ambiguous_live}
        net_new = [e for e in net_new if e["path"] not in held_paths]
        # The live id is known now — let edges from this run's creates resolve
        # to it (the issue's preferred outcome) instead of being dropped as
        # "not a world element".
        for ent, live in preexisting:
            ent_id_by_key.setdefault(_key(ent["name"]), live["id"])
            for al in ent.get("aliases", []):
                ent_id_by_key.setdefault(_key(al), live["id"])

    # Every NET-NEW entity's in-batch group ref, so a relationship whose target is
    # itself net-new in this push resolves to that target's `suggestion:<ref>`
    # instead of being skipped for want of an upstream id. (Linked targets resolve
    # to their real id via ent_id_by_key, which is consulted first.)
    ref_by_key = {_key(ent["name"]): f"e{i}" for i, ent in enumerate(net_new, 1)}
    for i, ent in enumerate(net_new, 1):           # aliases resolve too; names already set win
        for al in ent.get("aliases", []):
            ref_by_key.setdefault(_key(al), f"e{i}")
    # What each endpoint IS upstream, which is what decides an affiliation edge's
    # eventType (map_cmd.affiliation). Canon first — a linked note's node records
    # the ratified element kind — then the kind this run PROPOSES for anything
    # net-new, so an edge between two entities created in the same push resolves
    # too. A name in neither keeps the flat predicate mapping and is reported.
    kind_by_key = node_kind_index(args.vault)
    for ent in entities:
        proposed = element_spec(ent, mp)[1].get("type")
        if not proposed:
            continue
        kind_by_key.setdefault(_key(ent["name"]), proposed)
        for al in ent.get("aliases", []):
            kind_by_key.setdefault(_key(al), proposed)

    groups, refs, all_reports = [], [], []
    for i, ent in enumerate(net_new, 1):
        items, reports = build_group(ent, mp, ent_id_by_key, linked, race_id,
                                     args.vault, namespace, i, ref_by_key,
                                     kind_by_key)
        groups.append(items)
        refs.append(f"e{i}")
        all_reports.extend(reports)

    items_before = sum(len(g) for g in groups)
    groups, dup_affiliations = dedupe_affiliation_events(groups, refs)
    all_reports.extend(dup_affiliations)
    groups, refs = dedupe_type_creates(groups, refs)
    collapsed = items_before - sum(len(g) for g in groups)
    try:
        chunks, deferred = chunk_groups_colocated(groups, refs, cap=100)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    label = args.batch_label or f"{namespace} suggest ({args.chapter or 'all'})"
    os.makedirs(args.out, exist_ok=True)
    print(f"{len(net_new)} net-new entit(y/ies) → {sum(len(c) for c in chunks)} "
          f"items in {len(chunks)} batch(es)")
    if collapsed:
        print(f"  [dedup] collapsed {collapsed} duplicate classifier-type create(s) "
              f"into shared types")
    if linked_ents:
        held = held_relationship_count(linked_ents, ent_id_by_key, ref_by_key, linked)
        # Be precise about what "held" means: this run emits NO edges for linked
        # entities. `pull-canon --baseline` reconciles the ones that already exist
        # upstream (stamping event_ids); the remainder are genuinely-new edges on
        # existing elements that no verb pushes yet — the relationship-delta pass
        # owns them. Don't imply the baseline carries all of them.
        print(f"  [skipped] {len(linked_ents)} already-linked entit(y/ies) not re-created "
              f"(exist upstream)"
              + (f"; {held} of their relationship(s) not emitted here — run "
                 f"`pull-canon --baseline` to reconcile pre-existing edges; any "
                 f"genuinely-new ones await the relationship-delta pass" if held else ""))
    if submitted_ents:
        print(f"  [held] {len(submitted_ents)} entit(y/ies) already ruled on upstream "
              f"(pending/dismissed suggestion, or deleted element) — not re-filed: "
              + ", ".join(sorted(e["name"] for e in submitted_ents)))
    if preexisting or ambiguous_live:
        parts = []
        if preexisting:
            parts.append(", ".join(sorted(e["name"] for e, _ in preexisting))
                         + " (edges to them resolve to the live id)")
        if ambiguous_live:
            parts.append("ambiguous live name match: "
                         + ", ".join(f"{e['name']} ({len(h)} matches)" for e, h in ambiguous_live))
        print(f"  [held] {len(preexisting) + len(ambiguous_live)} entit(y/ies) already exist "
              f"upstream but carry no mobrpg: node — not re-filed (the server would skip the "
              f"create as already claimed and every edge referencing it would fail the whole "
              f"batch with a bare HTTP 400): " + "; ".join(parts)
              + f"\n         → run `mobrpg adopt {args.world} --vault {args.vault} --execute` "
                f"to link them, then re-run suggest.")
    for r in all_reports:
        print(f"  [note] {r}")
    if deferred:
        print(f"  [deferred] {len(deferred)} relationship(s) span an oversized co-location "
              f"component — they push once their targets have upstream ids "
              f"(re-run suggest after accept + pull-canon):", file=sys.stderr)
        for src, tgt in deferred:
            print(f"    · {src} → {tgt}", file=sys.stderr)

    if args.write_back and not args.execute:
        # Dry-run: show the plan. Only net-new entities get a fresh pending node;
        # already-linked entities keep their existing (accepted) nodes untouched.
        w, s = write_back(net_new, mp, args.vault, namespace, execute=False)
        print(f"write-back: {w} node(s) would be written, {s} unchanged (skipped)"
              "  [dry-run — no files changed]")

    # Executing: a node is stamped `pending` only for a create the server
    # actually stored, per batch, after the POST result is known. Stamping up
    # front left a failed batch's entities marked pending — which held-back
    # detection then read as "already ruled on", so the failure made itself
    # permanent until the frontmatter was hand-repaired (#179).
    ents_by_ref = {external_ref(e["path"], args.vault, namespace): e for e in net_new}
    rc = 0
    for idx, chunk in enumerate(chunks, 1):
        req = {"batchLabel": f"{label} [{idx}/{len(chunks)}]", "suggestions": chunk}
        batch_path = os.path.join(args.out, f"suggest-batch-{idx}.json")
        with open(batch_path, "w", encoding="utf-8") as fh:
            json.dump(req, fh, indent=2, ensure_ascii=False)
        try:
            resp = submit_batch.submit(args.world, req, execute=args.execute, index=idx)
        except client.ApiError as e:
            print(f"ERROR on batch {idx}: {e}", file=sys.stderr)
            if e.status == 400:
                print(f"  hint: a bare 400 on a compound batch usually means an AddRelation "
                      f"references `suggestion:<ref>` for a create the server skipped as "
                      f"already claimed. Run `mobrpg adopt {args.world} --vault {args.vault}` "
                      f"to link pre-existing elements, then re-run.", file=sys.stderr)
            if args.write_back and args.execute:
                print(f"  write-back: batch {idx} not stamped (nothing was accepted)",
                      file=sys.stderr)
            rc = 1
            break
        if args.write_back and args.execute:
            refused = submit_batch.refused_refs(resp)
            ents = [e for e in entities_in_chunk(chunk, ents_by_ref)
                    if external_ref(e["path"], args.vault, namespace) not in refused]
            w, s = write_back(ents, mp, args.vault, namespace, execute=True)
            print(f"  write-back: batch {idx} — {w} node(s) written, {s} unchanged (skipped)"
                  + (f", {len(refused)} refused by the server (not stamped)" if refused else ""))
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
            # a bound name is Tim's own canonical type; keep it verbatim
            return entry.get("name") or map_cmd.classifier_name(raw).title()
        # create: clean defensively in case the map name predates sanitization
        return (val and map_cmd.classifier_name(val).title()) or map_cmd.classifier_name(raw).title()
    return map_cmd.classifier_name(raw).title()


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
        # Review-state-only guard: a node under active review (pending/dismissed),
        # recording an element deleted upstream, or already ratified against a canon
        # element (accepted + element_id) is owned by the review/pull paths —
        # write_back must never overwrite it. `deleted` carries no element_id, so
        # only this check stops a fresh pending node erasing the deletion record.
        state = existing.get("review_state") if existing else None
        if state in ("pending", "dismissed", "deleted") or (
                state == "accepted" and existing.get("element_id")):
            skipped += 1
            continue
        merged = node.write_node(txt, newn)
        if execute:
            with open(ent["path"], "w", encoding="utf-8") as fh:
                fh.write(merged)
        written += 1
    return written, skipped
