"""mobrpg write — materialize a mobRPG extract (from `mobrpg pull`) into
gm-apprentice vault markdown.

Ported from the prototype's vault_write.py: maps each mobRPG entity to the
correct vault folder/template/type, builds template-conformant frontmatter +
body, and writes one file per entity.
"""
from __future__ import annotations

import argparse
import json
import os
import re

from mobrpg import links
from mobrpg import md as _md
from mobrpg import node
from mobrpg import vault
from mobrpg.commands import map_cmd

# mobRPG kind → (vault subfolder, entity type). The vault has no culture or
# race type; a heritage (species, people, culture) is the nearest, and its
# template already carries Biology and Culture sections (#253).
KIND_MAP = {
    "person":       ("Characters/NPCs", "npc"),
    "organization": ("Factions & Organizations", "faction"),
    "political":    ("Locations", "location"),
    "landfeature":  ("Locations", "location"),
    "item":         ("Items & Artifacts", "item"),
    "creature":     ("Creatures", "creature"),
    "culture":      ("Heritages", "heritage"),
    "race":         ("Heritages", "heritage"),
}

# mobRPG kind → the `element_kind` a node records (as suggest.build_node names it)
ELEMENT_KIND = {"person": "Person", "organization": "Organization",
                "political": "Political", "landfeature": "LandFeature",
                "item": "Item", "creature": "Creature", "culture": "Culture",
                "race": "Race"}

# mobRPG LandFeatureSubType (authoritative) → vault location_type
LANDFEATURE_SUBTYPE = {
    "Star": "star", "Planet": "planet", "Moon": "moon",
    "Asteroid": "asteroid belt", "System": "star system",
}


# fallback: guess location_type for landfeatures from the name, used ONLY when
# mobRPG carries no landFeatureType (e.g. routes) — the authoritative subtype
# (captured by etl_extract as a `landfeature/subType` classifier) wins over this.
def landfeature_type(name: str) -> str:
    n = name.lower()
    if "system" in n: return "star system"
    if "belt" in n: return "asteroid belt"
    if "route" in n: return "trade route"
    if "gate" in n: return "jump gate"
    return "planet"


def slug(name: str, name_style: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name).strip()
    s = re.sub(r"\s+", " ", s)
    return s if name_style == "space" else s.replace(" ", "_")


def _q(s: str) -> str:
    """A YAML double-quoted scalar (JSON's escaping is valid YAML)."""
    return json.dumps(s, ensure_ascii=False)


def yaml_list(items: list[str]) -> str:
    if not items:
        return "[]"
    return "\n" + "\n".join(f"  - {json.dumps(i, ensure_ascii=False)}" for i in items)


def rel_block(rels: list[dict], default_pred: str, default_target: str | None,
              name_style: str) -> str:
    if not rels and not default_target:
        return " []"
    lines = []
    src = rels or ([{"target": default_target, "predicate": default_pred,
                     "role": None, "eventType": None}] if default_target else [])
    for r in src:
        desc = r.get("role") or ""
        # `_file` is the note the edge resolves to (set by run); fall back to
        # the slugged name for a caller that didn't resolve targets.
        target = r.get("_file") or slug(r["target"], name_style)
        lines.append(
            f"  - target: \"[[{target}]]\"\n"
            f"    type: {r['predicate']}\n"
            f"    tone: neutral\n"
            f"    strength: 5\n"
            f"    bidirectional: false\n"
            f"    description: {json.dumps(desc, ensure_ascii=False)}"
        )
    return "\n" + "\n".join(lines)


def notes_bullets(notes: list[str]) -> str:
    """Player-safe notes → a bulleted markdown block (continuation lines indented)."""
    out = []
    for n in notes:
        lines = n.splitlines() or [""]
        out.append("- " + lines[0])
        out.extend("  " + l for l in lines[1:])
    return "\n".join(out)


def keeper_callout(notes: list[str]) -> str:
    """GM-only notes (hidden=true) → an Obsidian 'Keeper Only' callout."""
    inner = []
    for i, n in enumerate(notes):
        if i:
            inner.append(">")
        inner.extend((">" if not l else f"> {l}") for l in (n.splitlines() or [""]))
    return "> [!info] Keeper Only\n" + "\n".join(inner)


def classifier_of(rec: dict, kinds: tuple) -> str:
    for c in rec.get("classifiers", []):
        if c["kind"] in kinds:
            return c["name"]
    return ""


def _clean(rec: dict, file_by_id: dict | None = None) -> dict:
    """The record with C1 controls mapped through cp1252 (#255), covering
    extracts pulled before pull did that itself, and, given the id -> file
    map, mobRPG element URLs in its prose resolved to wikilinks (#252)."""
    c = _md.fix_c1

    def prose(t):
        return c(t) if file_by_id is None else links.rewrite_md_for_write(c(t), file_by_id)

    return {**rec, "name": c(rec["name"]).strip(),
            "altNames": [c(a) for a in rec.get("altNames") or []],
            "body_md": prose(rec.get("body_md")),
            "notes_public": [prose(n) for n in rec.get("notes_public") or []],
            "notes_gm": [prose(n) for n in rec.get("notes_gm") or []],
            "classifiers": [{**k, "name": c(k.get("name"))} for k in rec.get("classifiers", [])],
            "relationships": [{**r, "target": c(r.get("target")),
                               "role": c(r["role"]) if r.get("role") else r.get("role")}
                              for r in rec.get("relationships", [])]}


def _parent(rels: list[dict], name_style: str) -> str:
    r = next((r for r in rels if r["predicate"] == "part_of"), None)
    return f"[[{r.get('_file') or slug(r['target'], name_style)}]]" if r else ""


def build(rec: dict, campaign: str, source_doc: str, name_style: str) -> tuple[str, str] | None:
    kind = rec["kind"]
    if kind not in KIND_MAP:
        return None
    folder, etype = KIND_MAP[kind]
    rec = _clean(rec)
    name = rec["name"]
    body = rec.get("body_md") or ""
    rels = rec.get("relationships", [])
    aliases = rec.get("altNames") or []

    # Player-safe notes join the body as a ## Notes section; GM notes are held
    # back for the ## GM Notes section (appended after the template is built).
    pub_notes = rec.get("notes_public") or []
    gm_notes = rec.get("notes_gm") or []
    if pub_notes:
        body = (body + "\n\n" if body else "") + "## Notes\n\n" + notes_bullets(pub_notes)

    # occupation/role for NPCs comes from the most descriptive relationship role
    role = next((r["role"] for r in rels if r.get("role")), "")

    fm_common = (
        f"name: {_q(name)}\n"
        f"canon_status: AUTHORITATIVE\n"       # mobRPG declared canon
        f"source: prep\n"                       # TODO(integration): needs an 'api-import' source enum
        f"createdSession: \"\"\n"
        f"asOfSession: \"\"\n"
        f"lastUpdated: \"\"\n"
        f"aliases: {yaml_list(aliases)}\n"
        f"tags: {yaml_list(['mobrpg-import'])}\n"
        f"campaign: {_q(campaign)}\n"
    )

    if etype == "npc":
        # split first/last for nationality? leave blank; role → occupation
        fm = (
            f"---\n"
            f"type: npc\n{fm_common}"
            f"first_appearance: \"\"\n"
            f"occupation: {json.dumps(role, ensure_ascii=False)}\n"
            f"age:\n"
            f"gender: \"\"\n"
            f"nationality: \"\"\n"
            f"status: alive\n"
            f"motivations: []\n"
            f"secrets: \"\"\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'located_at', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Motivations & Secrets\n\n"
              f"## Campaign Log\n\n## Source References\n\n- {source_doc}\n\n"
              f"> [!info] Reconstruction Note\n> Imported from mobRPG; descriptive prose is "
              f"Tim's. Relationships derived from mobRPG event join-entities.\n\n## GM Notes\n")

    elif etype == "faction":
        ftype = classifier_of(rec, ("organization/type",))
        # Faction/Organization carry a scalar `part_of` (wiki-link to the parent
        # body) alongside the edge, exactly as location carries parent_location.
        # It used to be emitted hardcoded-empty while the edge was preserved, so
        # a faction with a real parent shipped with the two disagreeing.
        fm = (
            f"---\n"
            f"type: faction\n{fm_common}"
            f"factionType: {json.dumps(ftype, ensure_ascii=False)}\n"
            f"goals: []\n"
            f"resources: \"\"\n"
            f"leadership: \"\"\n"
            f"territory: \"\"\n"
            f"tier:\n"
            f"currentPlan: \"\"\n"
            f"planProgress: \"\"\n"
            f"alliances: []\n"
            f"recentActions: []\n"
            f"status: active\n"
            f"part_of: \"{_parent(rels, name_style)}\"\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'headquartered_at', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Goals & Methods\n\n## Resources\n\n"
              f"## History\n\n> [!info] Reconstruction Note\n> Imported from mobRPG (canon). "
              f"factionType from mobRPG organization-type.\n\n## GM Notes\n")

    elif etype == "location":
        ltype = (classifier_of(rec, ("political/type",)) or
                 LANDFEATURE_SUBTYPE.get(classifier_of(rec, ("landfeature/subType",)), "") or
                 (landfeature_type(name) if kind == "landfeature" else ""))
        fm = (
            f"---\n"
            f"type: location\n{fm_common}"
            f"location_type: {json.dumps(ltype, ensure_ascii=False)}\n"
            f"parent_location: \"{_parent(rels, name_style)}\"\n"
            f"atmosphere: \"\"\n"
            f"inhabitants: []\n"
            f"points_of_interest: []\n"
            f"secrets: \"\"\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'part_of', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Points of Interest\n\n"
              f"## Source References\n\n- {source_doc}\n\n"
              f"> [!info] Reconstruction Note\n> Imported from mobRPG (canon).\n\n## GM Notes\n")

    elif etype == "item":
        fm = (
            f"---\n"
            f"type: item\n{fm_common}"
            f"item_type: vehicle\n"
            f"value: \"\"\n"
            f"origin: \"\"\n"
            f"current_holder: \"\"\n"
            f"properties: {{}}\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'owns', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Properties\n\n## Source References\n\n"
              f"- {source_doc}\n\n> [!info] Reconstruction Note\n> Imported from mobRPG (canon).\n\n"
              f"## GM Notes\n")

    elif etype == "creature":
        ctype = classifier_of(rec, ("creature/type",))
        lair = next((r for r in rels if r["predicate"] == "located_at"), None)
        where = f"[[{lair.get('_file') or slug(lair['target'], name_style)}]]" if lair else ""
        fm = (
            f"---\n"
            f"type: creature\n{fm_common}"
            f"creature_type: {_q(ctype)}\n"
            f"threat_level: \"\"\n"
            f"location: \"{where}\"\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'located_at', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## What the PCs Know\n\n{body}\n\n## Encounters\n\n"
              f"## Source References\n\n- {source_doc}\n\n> [!info] Reconstruction Note\n"
              f"> Imported from mobRPG (canon). creature_type from mobRPG creature-type.\n\n"
              f"## GM Notes\n")

    elif etype == "heritage":
        # A culture's prose is its culture; a race's is its biology.
        section = "Culture" if kind == "culture" else "Biology"
        fm = (
            f"---\n"
            f"type: heritage\n{fm_common}"
            f"lifespan_range: []\n"
            f"maturity_age:\n"
            f"average_height: \"\"\n"
            f"notable_traits: []\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'associated_with', None, name_style)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## {section}\n\n{body}\n\n## History\n\n"
              f"## Source References\n\n- {source_doc}\n\n> [!info] Reconstruction Note\n"
              f"> Imported from mobRPG (canon): a mobRPG {kind} element.\n\n## GM Notes\n")
    else:
        return None

    # GM-only notes (hidden=true) land under the template's trailing ## GM Notes
    # heading as a Keeper Only callout.
    if gm_notes:
        md = md.rstrip("\n") + "\n\n" + keeper_callout(gm_notes) + "\n"

    return f"{folder}/{slug(name, name_style)}.md", md


def run(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        prog="mobrpg write",
        description="Materialize a mobRPG extract into gm-apprentice vault markdown.")
    ap.add_argument("extract", help="path to the extract JSON (from `mobrpg pull`)")
    ap.add_argument("--out", required=True, help="output vault directory")
    ap.add_argument("--campaign", default="", help="campaign name for frontmatter")
    ap.add_argument("--source-doc", default="mobRPG API import",
                    help="source reference string for '## Source References'")
    ap.add_argument("--name-style", choices=["plain", "space"], default="plain",
                    help="filename/wiki-link naming convention (default: plain)")
    ap.add_argument("--overwrite", action="store_true",
                    help="replace notes that already exist under --out "
                         "(default: skip them, keeping hand-authored content)")
    args = ap.parse_args(argv)

    with open(args.extract, encoding="utf-8") as f:
        data = json.load(f)

    out = args.out
    mp = vault.read_map(out)
    namespace = map_cmd.namespace_for(out, mp)
    world = data.get("worldId") or mp.get("worldId", "")

    # `_key` is the element id; a hand-made extract without ids still writes,
    # keyed by position, but those notes can't be linked to an element.
    records = [{**r, "_key": r.get("id") or f"#{i}"}
               for i, r in enumerate(data["entities"]) if r.get("kind") in KIND_MAP]
    unsupported = len(data["entities"]) - len(records)
    paths = plan_paths(records, vault.linked_element_paths(out), args.name_style)
    file_by_id = {key: os.path.basename(rel)[:-3] for key, rel in paths.items()}
    files_by_name: dict[str, set] = {}
    for rec in records:
        files_by_name.setdefault(_md.fix_c1(rec["name"]).strip(), set()).add(
            file_by_id[rec["_key"]])

    written: dict[str, int] = {}
    skipped = 0
    shared: list[tuple[str, str, str]] = []
    for rec in records:
        rel_path = paths[rec["_key"]]
        rec = _clean(rec, file_by_id)
        for r in rec["relationships"]:
            r["_file"] = _target_file(r, file_by_id, files_by_name, args.name_style)
        md = build(rec, args.campaign, args.source_doc, args.name_style)[1]
        if file_by_id[rec["_key"]] != slug(rec["name"], args.name_style):
            md = md.rstrip("\n") + "\n\n" + shared_name_callout(rec) + "\n"
            shared.append((rec["name"], rec.get("id") or "no id", rel_path))
        if rec.get("id"):
            md = node.write_node(md, import_node(rec, rel_path, world, namespace))
        full = os.path.join(out, rel_path)
        # An existing note is someone's work — hand-authored prose, GM Notes,
        # play bookkeeping. Replacing it wholesale is the most destructive thing
        # this tool can do, so it only happens on an explicit --overwrite (#186).
        if os.path.exists(full) and not args.overwrite:
            skipped += 1
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(md)
        written.setdefault(rec["kind"], 0)
        written[rec["kind"]] += 1
    print(f"wrote to {out}/:", written, "| total", sum(written.values()))
    if skipped:
        print(f"skipped {skipped} existing note(s) — pass --overwrite to replace them")
    if unsupported:
        print(f"ignored {unsupported} entit(y/ies) of unsupported kind(s) — "
              f"no vault template maps them")
    if shared:
        print(f"{len(shared)} element(s) share a name with another; each got its own "
              f"note (rename them to tell them apart):")
        for name, eid, rel_path in shared:
            print(f"  {rel_path}  ({name!r}, element {eid})")
    return 0


def plan_paths(records: list[dict], linked: dict, name_style: str) -> dict:
    """{record _key: vault-relative path}, one distinct file per element (#254).

    An element a note already links keeps that note, so a re-run never
    reshuffles files, even after a hand rename. The rest take their name's file
    in element-id order; when elements share a name (fathers and sons, regnal
    numbers, true duplicates) the later ones get `Name (2).md`, `Name (3).md`.
    Paths compare case-insensitively, as case-insensitive filesystems do, and
    slug() can map distinct names ("A/B", "AB") onto one file too."""
    paths, taken = {}, set()
    for rec in records:
        rel = linked.get(rec["_key"])
        if rel and os.path.dirname(rel) == KIND_MAP[rec["kind"]][0]:
            paths[rec["_key"]] = rel
            taken.add(rel.lower())
    for rec in sorted(records, key=lambda r: r["_key"]):
        if rec["_key"] in paths:
            continue
        base = f"{KIND_MAP[rec['kind']][0]}/{slug(_md.fix_c1(rec['name']), name_style)}"
        rel, n = f"{base}.md", 1
        while rel.lower() in taken:
            n += 1
            rel = f"{base} ({n}).md"
        paths[rec["_key"]] = rel
        taken.add(rel.lower())
    return paths


def _target_file(rel: dict, file_by_id: dict, files_by_name: dict, name_style: str) -> str:
    """The note an edge points at: by the target's element id when the extract
    carries it, else by name when exactly one written note has that name."""
    if rel.get("targetId") in file_by_id:
        return file_by_id[rel["targetId"]]
    files = files_by_name.get((rel.get("target") or "").strip(), set())
    return next(iter(files)) if len(files) == 1 else slug(rel["target"], name_style)


def shared_name_callout(rec: dict) -> str:
    which = f"This note is element `{rec['id']}`; rename" if rec.get("id") else "Rename"
    return (f"> [!warning] Shared name\n> Another mobRPG element is also called "
            f"\"{rec['name']}\". {which} the file to tell them apart.")


def import_node(rec: dict, rel_path: str, world: str, namespace: str) -> dict:
    """The `mobrpg:` node for an imported note (#254). `write` knows the element
    id, so the note is linked from the start and `adopt` isn't needed on a
    fresh import. Each edge carries its event id where the extract has one, so
    suggest sees it as already upstream. `determined` is left for
    `pull-canon` to fill from the live element."""
    return {
        "world_id": world,
        "external_ref": f"{namespace}:{rel_path[:-3]}",
        "element_id": rec["id"],
        "element_kind": ELEMENT_KIND[rec["kind"]],
        "review_state": "accepted",
        "last_synced": "",
        "review_note": "",
        "relationships": [{"predicate": r["predicate"], "target": r["_file"],
                           "event_type": r.get("eventType"),
                           "event_id": r.get("eventId"), "review_state": "accepted"}
                          for r in rec["relationships"]],
        "languages": [],
    }
