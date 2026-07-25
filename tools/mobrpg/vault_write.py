#!/usr/bin/env python3
"""
Write a mobRPG extract (from etl_extract.py) into gm-apprentice vault markdown.

Maps each mobRPG entity to the correct vault folder/template/type, builds
template-conformant frontmatter + body, and writes one file per entity. Defaults
to a PREVIEW directory so nothing touches a live vault until reviewed.

Usage:
    python3 vault_write.py space_extract.json ./space_vault_preview
"""
from __future__ import annotations
import json, re, sys, os

CAMPAIGN = "Dead End"
SOURCE_DOC = "mobRPG 'Space' world (Tim) — API import"

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


# Per-vault naming convention. Dead End uses spaces in filenames AND wiki-links
# ("Thides System.md", "[[Thides System]]"); other vaults (e.g. Regency) use
# underscores. The real integration must DETECT this from the target vault.
NAME_STYLE = "space"   # "space" | "underscore"


def slug(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name).strip()
    s = re.sub(r"\s+", " ", s)
    return s if NAME_STYLE == "space" else s.replace(" ", "_")


def wl(name: str) -> str:
    return f"[[{slug(name)}]]"


def yaml_list(items: list[str]) -> str:
    if not items:
        return "[]"
    return "\n" + "\n".join(f"  - {json.dumps(i, ensure_ascii=False)}" for i in items)


def rel_block(rels: list[dict], default_pred: str, default_target: str | None) -> str:
    if not rels and not default_target:
        return " []"
    out = ["relationships:"] if False else []
    lines = []
    src = rels or ([{"target": default_target, "predicate": default_pred,
                     "role": None, "eventType": None}] if default_target else [])
    for r in src:
        desc = r.get("role") or ""
        lines.append(
            f"  - target: \"{wl(r['target'])}\"\n"
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


def build(rec: dict) -> tuple[str, str] | None:
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
        f"source_confidence: AUTHORITATIVE\n"   # mobRPG declared canon
        f"source: prep\n"                       # TODO(integration): needs an 'api-import' source enum
        f"createdSession: \"\"\n"
        f"asOfSession: \"\"\n"
        f"lastUpdated: \"\"\n"
        f"aliases: {yaml_list(aliases)}\n"
        f"tags: {yaml_list(['mobrpg-import'])}\n"
        f"campaign: \"{CAMPAIGN}\"\n"
    )

    if etype == "npc":
        # split first/last for nationality? leave blank; role → occupation
        located = next((r for r in rels if r["predicate"] == "located_at"), None)
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
            f"relationships:{rel_block(rels, 'located_at', None)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Motivations & Secrets\n\n"
              f"## Appearances\n\n## Source References\n\n- {SOURCE_DOC}\n\n"
              f"> [!info] Reconstruction Note\n> Imported from mobRPG; descriptive prose is "
              f"Tim's. Relationships derived from mobRPG event join-entities.\n\n## GM Notes\n")

    elif etype == "faction":
        ftype = classifier_of(rec, ("organization/type",))
        hq = next((r["target"] for r in rels if r["predicate"] in ("located_at", "headquartered_at")), "")
        fm = (
            f"---\n"
            f"name: \"{name}\"\n"
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
            f"relationships:{rel_block(rels, 'headquartered_at', None)}\n"
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
            f"parent_location: \"{wl(parent) if parent else ''}\"\n"
            f"atmosphere: \"\"\n"
            f"inhabitants: []\n"
            f"points_of_interest: []\n"
            f"secrets: \"\"\n"
            f"portrait: \"\"\n"
            f"relationships:{rel_block(rels, 'part_of', None)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Points of Interest\n\n"
              f"## Source References\n\n- {SOURCE_DOC}\n\n"
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
            f"relationships:{rel_block(rels, 'owns', None)}\n"
            f"---\n"
        )
        md = (f"{fm}\n## Overview\n\n{body}\n\n## Properties\n\n## Source References\n\n"
              f"- {SOURCE_DOC}\n\n> [!info] Reconstruction Note\n> Imported from mobRPG (canon).\n\n"
              f"## GM Notes\n")
    else:
        return None

    # GM-only notes (hidden=true) land under the template's trailing ## GM Notes
    # heading as a Keeper Only callout.
    if gm_notes:
        md = md.rstrip("\n") + "\n\n" + keeper_callout(gm_notes) + "\n"

    return f"{folder}/{slug(name)}.md", md


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: vault_write.py <extract.json> <out_dir>", file=sys.stderr)
        return 2
    data = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    written = {}
    for rec in data["entities"]:
        r = build(rec)
        if not r:
            continue
        rel_path, md = r
        full = os.path.join(out, rel_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(md)
        written.setdefault(rec["kind"], 0)
        written[rec["kind"]] += 1
    print(f"wrote to {out}/:", written, "| total", sum(written.values()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
