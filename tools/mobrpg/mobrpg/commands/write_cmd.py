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
import sys

# mobRPG kind → (vault subfolder, entity type)
KIND_MAP = {
    "person":       ("Characters/NPCs", "npc"),
    "organization": ("Factions & Organizations", "faction"),
    "political":    ("Locations", "location"),
    "landfeature":  ("Locations", "location"),
    "item":         ("Items & Artifacts", "item"),
}

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


def wl(name: str, name_style: str) -> str:
    return f"[[{slug(name, name_style)}]]"


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
        lines.append(
            f"  - target: \"{wl(r['target'], name_style)}\"\n"
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


def build(rec: dict, campaign: str, source_doc: str, name_style: str) -> tuple[str, str] | None:
    kind = rec["kind"]
    if kind not in KIND_MAP:
        return None
    folder, etype = KIND_MAP[kind]
    name = rec["name"].strip()
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
        f"name: \"{name}\"\n"
        f"source_confidence: AUTHORITATIVE\n"   # mobRPG declared canon
        f"source: prep\n"                       # TODO(integration): needs an 'api-import' source enum
        f"createdSession: \"\"\n"
        f"asOfSession: \"\"\n"
        f"lastUpdated: \"\"\n"
        f"aliases: {yaml_list(aliases)}\n"
        f"tags: {yaml_list(['mobrpg-import'])}\n"
        f"campaign: \"{campaign}\"\n"
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
              f"## Appearances\n\n## Source References\n\n- {source_doc}\n\n"
              f"> [!info] Reconstruction Note\n> Imported from mobRPG; descriptive prose is "
              f"Tim's. Relationships derived from mobRPG event join-entities.\n\n## GM Notes\n")

    elif etype == "faction":
        ftype = classifier_of(rec, ("organization/type",))
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
            f"part_of: \"\"\n"
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
        parent = next((r["target"] for r in rels if r["predicate"] == "part_of"), "")
        fm = (
            f"---\n"
            f"type: location\n{fm_common}"
            f"location_type: {json.dumps(ltype, ensure_ascii=False)}\n"
            f"parent_location: \"{wl(parent, name_style) if parent else ''}\"\n"
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
    args = ap.parse_args(argv)

    with open(args.extract) as f:
        data = json.load(f)

    written: dict[str, int] = {}
    for rec in data["entities"]:
        r = build(rec, args.campaign, args.source_doc, args.name_style)
        if not r:
            continue
        rel_path, md = r
        full = os.path.join(args.out, rel_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(md)
        written.setdefault(rec["kind"], 0)
        written[rec["kind"]] += 1
    print(f"wrote to {args.out}/:", written, "| total", sum(written.values()))
    return 0
