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
from functools import partial
from pathlib import Path

import index_build
import migrate_vault as mv
from migrate_core import StepFailed, write_text_atomic
from vault_write import utf8_output
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
# Both roster type names are in use in real vaults.
ROSTER_TYPES = frozenset({"player-characters", "pc_roster"})
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


def _types_in(vault: Path) -> tuple[set[str], bool]:
    """One walk of the vault: the note types it keeps, and whether one of
    them is a world index (`type: world_domain`, `domain: index`)."""
    types: set[str] = set()
    world_index = False
    if vault.is_dir():
        for _rel, text in vault_files(vault):
            front = extract_frontmatter(text) or {}
            kind = entity_type(front)
            types.add(kind)
            if kind == "world_domain" and (
                    str(front.get("domain", "")).strip().lower() == "index"):
                world_index = True
    return types - {""}, world_index


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
    types, has_world_index = _types_in(vault)
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
            # Binds this iteration's text; mypy rejects a default-argument
            # lambda here.
            file(f"_Templates/{name}", partial(str, text))
    file("_World/world-index.md",
         lambda: _plugin_text(mv.TEMPLATES / "world-index.md"),
         present=has_world_index)
    file("_World/_flags.md",
         lambda: _plugin_text(mv.TEMPLATES / "world-flags.md"),
         present="world_flags" in types)
    file("_Campaign/Timeline.md", lambda: seed("timeline.md", campaign),
         present="timeline" in types)
    file("_Campaign/Player Characters.md",
         lambda: seed("player-characters.md", campaign),
         present=bool(ROSTER_TYPES & types))
    file("_meta/entity-types.md", entity_types_text)
    file("_meta/relationship-types.md", relationship_types_text)
    # The index is rendered when it is written, after the files above exist.
    file("_meta/index.md",
         lambda: index_build.render(vault, today=day, previous=None))
    file(CONFIG, lambda: config_text(system, campaign, version))
    return out


# --- writing ----------------------------------------------------------------

def _make_folders(path: Path, made: list[Path]) -> None:
    """Create `path` and any missing parents, one at a time, recording each
    so the undo removes exactly what this run made."""
    todo: list[Path] = []
    while not path.exists():
        todo.append(path)
        path = path.parent
    for folder in reversed(todo):
        folder.mkdir()
        made.append(folder)


def _undo(made: list[Path]) -> list[str]:
    """Remove what this run made, newest first. Returns what would not go."""
    left: list[str] = []
    for path in reversed(made):
        try:
            if path.is_dir():
                path.rmdir()
            else:
                path.unlink(missing_ok=True)
        except OSError:
            left.append(path.name)
    return left


def build(vault: Path, pieces: list[Piece]) -> None:
    """Create every piece, or none: a failure part-way, Ctrl-C included,
    removes what this run made and nothing else."""
    made: list[Path] = []
    try:
        for piece in pieces:
            path = vault / piece.rel
            if piece.text is None:
                _make_folders(path, made)
                continue
            _make_folders(path.parent, made)
            if path.exists():
                raise ScaffoldError(f"{piece.rel}: appeared since the plan "
                                    f"was made")
            made.append(path)
            write_text_atomic(path, piece.text())
    except BaseException as e:
        left = _undo(made)
        if not isinstance(e, Exception):
            if left:
                raise ScaffoldError(f"interrupted; could not remove: "
                                    f"{', '.join(left)}") from e
            raise
        name = e.__class__.__name__
        why = str(e) or name
        if str(e) and not isinstance(e, (StepFailed, OSError,
                                         ScaffoldError)):
            why = f"{name}: {e}"
        if left:
            why = f"{why}; could not remove: {', '.join(left)}"
        raise ScaffoldError(why) from e


# --- CLI --------------------------------------------------------------------

def resolve_system(vault: Path, given: str | None,
                   no_system: bool) -> str | None:
    """The system to build for. Never guessed: a new vault with none
    recorded and no flag is refused."""
    if no_system:
        return None
    ids = ", ".join(SYSTEMS)
    if given is not None:
        found = mv._system_id(given)
        if found not in SYSTEMS:
            raise ScaffoldError(f"unknown system '{given}': use one of "
                                f"{ids}, or --no-system")
        return found
    found = mv.vault_system(vault) if vault.is_dir() else None
    if found is None and not (vault / CONFIG).is_file():
        raise ScaffoldError(
            f"the game system is not recorded: ask the GM once, then pass "
            f"--system ID (one of {ids}) or --no-system")
    # A system the vault names that has no templates here builds generic.
    return found if found in SYSTEMS else None


def _refuse_ahead(vault: Path, plugin: str) -> None:
    try:
        fm = extract_frontmatter((vault / CONFIG).read_text(
            encoding="utf-8-sig", errors="replace")) or {}
    except OSError:
        return
    current = fm.get("gm_apprentice_version")
    if (current and not isinstance(current, list)
            and parse_version(str(current)) > parse_version(plugin)):
        raise ScaffoldError(f"vault {current} is ahead of plugin {plugin}: "
                            f"update the plugin before touching this vault")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="vault_scaffold.py", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", type=Path)
    which = ap.add_mutually_exclusive_group()
    which.add_argument("--system", metavar="ID",
                       help=f"one of {', '.join(SYSTEMS)}, or an alias")
    which.add_argument("--no-system", action="store_true",
                       help="no particular system: generic templates")
    ap.add_argument("--name", metavar="TEXT",
                    help="campaign name for page titles (default: the "
                         "vault folder's name)")
    ap.add_argument("--inbox", action="store_true",
                    help="also create _inbox/ for vault-ingest")
    ap.add_argument("--write", action="store_true",
                    help="create it (default: print the plan)")
    return ap


def main(argv: list[str] | None = None) -> int:
    utf8_output()
    args = build_parser().parse_args(argv)
    vault: Path = args.vault
    try:
        try:
            if vault.exists() and not vault.is_dir():
                raise ScaffoldError(f"{vault.name}: not a folder")
            found = plugin_version()
            if found is None:
                raise ScaffoldError("cannot determine the plugin version")
            _refuse_ahead(vault, found[0])
            system = resolve_system(vault, args.system, args.no_system)
            campaign = " ".join((args.name or vault.resolve().name).split())
            pieces = missing(vault, system, campaign=campaign,
                             version=found[0], inbox=args.inbox)
            if args.write:
                build(vault, pieces)
        except KeyboardInterrupt:
            raise ScaffoldError("interrupted") from None
    except ScaffoldError as e:
        print(f"ERROR\t{e}")
        print("# nothing written" if "could not remove" not in str(e)
              else "# some of this run's files were left: remove them by hand")
        return 1
    verb = "CREATED" if args.write else "WOULD-CREATE"
    rows = [f"{verb}\t{shown(p)}" for p in pieces]
    if not rows:
        rows = ["OK\t(vault)\tnothing missing"]
    print("\n".join([*rows, f"# create: {len(pieces)}"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
