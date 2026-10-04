#!/usr/bin/env python3
"""vault_scaffold.py: build a new vault's skeleton, or list what one lacks.

    vault_scaffold.py VAULT [--system ID | --no-system] [--name TEXT]
                            [--inbox] [--write]

Without --write it prints what it would create and writes nothing. With
--write it creates everything or nothing. It never overwrites, moves or
deletes what is already there, and writes no campaign content: the folders,
the templates for the game system, the four `_meta/` files, two world stubs
and an empty Timeline and Player Characters page.

Rows are tab-separated: verb, path. WOULD-CREATE in a plan, CREATED when
written, OK when nothing is missing, ERROR on a refusal, then one
`# create: N` line. A folder's path ends in `/`.

Exit: 0 done or a clean plan; 1 refused, and then nothing at all is
written; 2 bad arguments. Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import index_build
import migrate_vault as mv
from migrate_core import StepFailed, write_text_atomic
from vaultlib import (entity_type, extract_frontmatter, parse_version,
                      plugin_version, read_publish_scalar, vault_files)

SHARED = Path(__file__).resolve().parent.parent
SEEDS = SHARED / "scaffold"
SCHEMA = SHARED / "entity-schema.md"
ONTOLOGY = SHARED / "gm-apprentice-ontology.json"
STRUCTURE = SHARED / "vault-structure.md"
CONFIG = "_meta/vault-config.md"

# The sections of entity-schema.md a vault's `_meta/entity-types.md` starts
# with, in this order.
ENTITY_SECTIONS = ("Entity Type Hierarchy", "Frontmatter Schemas",
                   "Type-Specific Fields", "Required Relationships",
                   "Default Folder Mapping")
CATEGORY_NAMES = {"scifi": "Sci-Fi"}


class ScaffoldError(Exception):
    """A refusal. One line; nothing is written."""


def _plugin_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise ScaffoldError(f"the plugin's {path.name} cannot be read "
                            f"({e.__class__.__name__})") from e


def entity_types_text() -> str:
    """A new vault's `_meta/entity-types.md`: ENTITY_SECTIONS of the
    plugin's schema, copied whole."""
    text = _plugin_text(SCHEMA)
    heads = [(m.start(), m.group(1).strip())
             for m in re.finditer(r"^## (.+)$", text, re.M)]
    parts: list[str] = []
    for title in ENTITY_SECTIONS:
        at = next((i for i, (_pos, t) in enumerate(heads) if t == title), None)
        if at is None:
            raise ScaffoldError(f"the plugin's entity-schema.md has no "
                                f"'## {title}' section")
        end = heads[at + 1][0] if at + 1 < len(heads) else len(text)
        parts.append(text[heads[at][0]:end].rstrip("\n"))
    return ("---\ntype: meta\npurpose: entity-types\n---\n\n# Entity Types\n\n"
            + "\n\n".join(parts) + "\n")


def relationship_types_text() -> str:
    """A new vault's `_meta/relationship-types.md`: every predicate the
    plugin knows, by category."""
    try:
        predicates = json.loads(_plugin_text(ONTOLOGY))["predicates"]
        by_category: dict[str, list[dict]] = {}
        for p in predicates:
            by_category.setdefault(p["category"], []).append(p)
        rows = []
        for category, members in by_category.items():
            genres = list(dict.fromkeys(g for p in members for g in p["genre"]))
            rows.append(f"| {CATEGORY_NAMES.get(category, category.title())} "
                        f"| {', '.join(p['type'] for p in members)} "
                        f"| {', '.join(genres)} |")
        inverses = [f"- `{p['type']}` / `{p['inverse']}`"
                    for p in predicates if not p["symmetric"]]
        symmetric = ", ".join(p["type"] for p in predicates if p["symmetric"])
    except (ValueError, KeyError, TypeError) as e:
        raise ScaffoldError(f"the plugin's {ONTOLOGY.name} cannot be used "
                            f"({e.__class__.__name__})") from e
    return "\n".join([
        "---", "type: meta", "purpose: relationship-types", "---", "",
        "# Relationship Types", "",
        "Use the most specific type; generic types like `associated_with`",
        "or `related_to` add edges without meaning. Record one direction",
        "only: the inverse is implied, and both are never stored.", "",
        "| Category | Types | Genre |", "|---|---|---|", *rows, "",
        "## Inverses", "", *inverses, "",
        "## Symmetric (stored once, no direction)", "", symmetric, ""])


def structure_tree() -> str:
    """The default layout tree, as shared/vault-structure.md draws it."""
    found = re.search(r"^```text\n(.*?)\n```", _plugin_text(STRUCTURE),
                      re.M | re.S)
    if not found:
        raise ScaffoldError("the plugin's vault-structure.md has no layout "
                            "tree")
    return found.group(1)


def seed(name: str, campaign: str) -> str:
    return _plugin_text(SEEDS / name).replace("{CAMPAIGN}", campaign)


def config_text(system: str | None, campaign: str, version: str) -> str:
    """A new vault's `_meta/vault-config.md`. A new vault has no site."""
    front = ["---", "type: meta", f'gm_apprentice_version: "{version}"',
             "publish:", "  site: false"]
    if system:
        front.append(f'  system: "{system}"')
    body = seed("vault-config.md", campaign).replace("{TREE}",
                                                     structure_tree())
    return "\n".join([*front, "---", "", body.rstrip("\n"), ""])


SYSTEMS = ("coc-7e", "coc-7e-regency", "gurps-4e", "dnd-5e-2024", "pf2e",
           "fitd")

# --- the skeleton: the one definition of what a vault is made of ------------

PLAIN_FOLDERS = ("_meta", "_Campaign", "_Templates", "_World", "Chapters",
                 "Adventures")
ATTACHMENT_SUBS = ("characters", "locations", "factions", "items",
                   "creatures", "events", "documents")
# A type folder counts as present when the vault already keeps a note of one
# of its types anywhere: that is how a renamed folder is recognised.
TYPE_FOLDERS: dict[str, frozenset[str]] = {
    "Characters/PCs": frozenset({"pc"}),
    "Characters/NPCs": frozenset({"npc"}),
    "Locations": frozenset({"location"}),
    "Factions & Organizations": frozenset({
        "faction", "organization", "government", "corporation", "cult",
        "guild", "military", "criminal"}),
    "Items & Artifacts": frozenset({
        "item", "weapon", "armor", "vehicle", "treasure", "relic", "tool",
        "consumable"}),
    "Creatures": frozenset({
        "creature", "beast", "undead", "construct", "spirit", "deity",
        "aberration"}),
    "Heritages": frozenset({"heritage"}),
    "Events": frozenset({
        "event", "battle", "ritual", "disaster", "discovery",
        "betrayal_event", "celebration"}),
    "Documents": frozenset({
        "document", "spell", "map", "letter", "prophecy", "contract",
        "journal"}),
    "Clues": frozenset({"clue"}),
}
INBOX = ("_inbox", "_inbox/_processed")
# In the layout tree, and deliberately not made here: the midwife makes its
# own workspace; the inbox is made on request (--inbox).
NOT_CREATED = ("_midwife", "_inbox")


@dataclass(frozen=True)
class Piece:
    """One thing to create. `text` is None for a folder; for a file it is
    called when the file is written."""
    rel: str
    text: Callable[[], str] | None = None


def shown(piece: Piece) -> str:
    return piece.rel if piece.text is not None else f"{piece.rel}/"


def _types_in(vault: Path) -> set[str]:
    if not vault.is_dir():
        return set()
    return {entity_type(extract_frontmatter(text))
            for _rel, text in vault_files(vault)} - {""}


def _attachments(vault: Path) -> str:
    named = None
    if (vault / CONFIG).is_file():
        named = read_publish_scalar(vault, "attachments_dir")
    return (named or "").strip().strip("/") or "_attachments"


def missing(vault: Path, system: str | None, *, campaign: str, version: str,
            inbox: bool = False, templates: bool = True,
            today: str | None = None) -> list[Piece]:
    """What the vault's skeleton lacks, in the order to create it. Nothing
    that exists is listed. `templates=False` leaves `_Templates/` files to
    the update tool's own check."""
    types = _types_in(vault)
    day = today or datetime.date.today().isoformat()
    out: list[Piece] = []

    def folder(rel: str, present: bool = False) -> None:
        path = vault / rel
        if path.exists() and not path.is_dir():
            raise ScaffoldError(f"{rel}: a file is in the way of this folder")
        if not path.is_dir() and not present:
            out.append(Piece(rel))

    def file(rel: str, text: Callable[[], str], present: bool = False) -> None:
        path = vault / rel
        if path.is_dir():
            raise ScaffoldError(f"{rel}: a folder is in the way of this file")
        if not path.exists() and not present:
            out.append(Piece(rel, text))

    for rel in PLAIN_FOLDERS:
        folder(rel)
    attach = _attachments(vault)
    folder(attach)
    for sub in ATTACHMENT_SUBS:
        folder(f"{attach}/{sub}")
    for rel, held in TYPE_FOLDERS.items():
        folder(rel, present=bool(held & types))
    if inbox:
        for rel in INBOX:
            folder(rel)
    if templates:
        for name, text in mv.templates_for(system).items():
            file(f"_Templates/{name}", lambda text=text: text)
    file("_World/world-index.md",
         lambda: _plugin_text(mv.TEMPLATES / "world-index.md"))
    file("_World/_flags.md",
         lambda: _plugin_text(mv.TEMPLATES / "world-flags.md"))
    file("_Campaign/Timeline.md", lambda: seed("timeline.md", campaign),
         present="timeline" in types)
    file("_Campaign/Player Characters.md",
         lambda: seed("player-characters.md", campaign),
         present="player-characters" in types)
    file("_meta/entity-types.md", entity_types_text)
    file("_meta/relationship-types.md", relationship_types_text)
    # The index is rendered when it is written, after the files above exist.
    file("_meta/index.md",
         lambda: index_build.render(vault, today=day, previous=None))
    file(CONFIG, lambda: config_text(system, campaign, version))
    return out