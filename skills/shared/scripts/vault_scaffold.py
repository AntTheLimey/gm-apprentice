#!/usr/bin/env python3
"""vault_scaffold.py: build a new vault's skeleton, or list what one lacks.

    vault_scaffold.py VAULT [--system ID | --no-system] [--name TEXT]
                            [--inbox] [--write]

Without --write it prints what it would create and writes nothing. With
--write it creates everything or nothing. It never overwrites, moves or
deletes what is already there, and writes no campaign content: the folders,
the templates for the game system, the `_meta/` files (settings, state, entity and relationship types, index), two world stubs
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
import shutil
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import index_build
import migrate_vault as mv
from schema_rules import SYSTEMS, TYPE_FOLDERS, system_id, without_generated_markers
from migrate_core import StepFailed, write_text_atomic
from vault_write import utf8_output
from vaultlib import (PUBLISH_TOOL, SETTINGS_FILE, STAMP_KEY, STATE_FILE,
                      SettingsUnavailable, StateUnreadable, entity_type,
                      extract_frontmatter, forget_settings, parse_version,
                      plugin_version, read_stamp, settings, settings_default,
                      settings_set, stamp_file, vault_files, vault_layout)

SHARED = Path(__file__).resolve().parent.parent
SEEDS = SHARED / "scaffold"
SCHEMA = SHARED / "entity-schema.md"
ONTOLOGY = SHARED / "gm-apprentice-ontology.json"
# What a new vault gets, besides folders and schema files. An existing vault, on either layout, never gets them.
NEW_FILES = (SETTINGS_FILE, STATE_FILE)
TIMELINE = "_Campaign/Timeline.md"

# The sections of entity-schema.md a vault's `_meta/entity-types.md` starts
# with, in this order.
ENTITY_SECTIONS = ("Entity Type Hierarchy", "Frontmatter Schemas",
                   "Type-Specific Fields",
                   "Default Folder Mapping")
CATEGORY_NAMES = {"scifi": "Sci-Fi"}


class ScaffoldError(Exception):
    """A refusal. One line; nothing is written, unless `left` says the undo
    could not remove everything this run made."""

    def __init__(self, message: str, *, left: bool = False) -> None:
        super().__init__(message)
        self.left = left


def _plugin_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise ScaffoldError(f"the plugin's {path.name} cannot be read "
                            f"({e.__class__.__name__})") from e


def entity_types_text() -> str:
    """A new vault's `_meta/entity-types.md`: ENTITY_SECTIONS of the
    plugin's schema, copied whole."""
    text = without_generated_markers(_plugin_text(SCHEMA))
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


def seed(name: str, campaign: str) -> str:
    return _plugin_text(SEEDS / name).replace("{CAMPAIGN}", campaign)


def settings_text(system: str | None, campaign: str) -> str:
    """A new vault's `_meta/vault-config.yaml`, written by the publish tool
    (`settings set --create`) into a scratch folder and read back, so the
    file is exactly what the tool writes. A new vault has no site."""
    pairs: list[tuple[str, object]] = [("vault.campaign", campaign)]
    if system:
        pairs.append(("vault.system", system))
    pairs.append(("player_site.publish", False))
    with tempfile.TemporaryDirectory(prefix="vs-settings-") as tmp:
        scratch = Path(tmp) / "vault"
        (scratch / "_meta").mkdir(parents=True)
        try:
            settings_set(scratch, pairs, create=True)
            return (scratch / SETTINGS_FILE).read_text(encoding="utf-8")
        except (SettingsUnavailable, OSError) as e:
            raise ScaffoldError(f"the settings file could not be made: "
                                f"{e}") from e
        finally:
            forget_settings(scratch)


def state_text(version: str) -> str:
    """A new vault's `_meta/vault-state.json`: the version stamp, in the
    form `write_stamp` writes it."""
    return json.dumps({STAMP_KEY: version}, indent=2, ensure_ascii=False) + "\n"


# --- the skeleton: the one definition of what a vault is made of ------------

PLAIN_FOLDERS = ("_meta", "_Campaign", "_Templates", "_World", "Chapters",
                 "Adventures")
ATTACHMENT_SUBS = ("characters", "locations", "factions", "items",
                   "creatures", "events", "documents")
# A type folder counts as present when the vault already keeps a note of one
# of its types anywhere: that is how a renamed folder is recognised. The
# folders and their types are schema_rules.TYPE_FOLDERS (from the ontology).
# `pc_roster` is the name; `player-characters` is an older one still found
# in vaults.
ROSTER_TYPES = frozenset({"pc_roster", "player-characters"})
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
            kind = entity_type(front).strip().lower()
            types.add(kind)
            if kind == "world_domain" and (
                    str(front.get("domain", "")).strip().lower() == "index"):
                world_index = True
    return types - {""}, world_index


def _attachments(vault: Path) -> str | None:
    """The vault's attachments folder, or None when the vault names one
    outside itself: this script creates nothing out there."""
    if vault_layout(vault) != "none":
        named = settings(vault).get("vault.attachments")
    else:
        named = settings_default("vault.attachments")
    # A blank or non-text value is not a folder: an empty name would put the
    # folders at the disk's root.
    if not isinstance(named, str) or not named.strip():
        named = settings_default("vault.attachments")
    named = named.strip().replace("\\", "/")
    if (named.startswith("/") or re.match(r"[A-Za-z]:", named)
            or ".." in named.split("/")):
        return None
    return named.strip("/")


def missing(vault: Path, system: str | None, *, campaign: str, version: str,
            inbox: bool = False, templates: bool = True, pages: bool = True,
            today: str | None = None) -> list[Piece]:
    """What the vault's skeleton lacks, in the order to create it. Nothing
    that exists is listed. `templates=False` leaves `_Templates/` files to
    the update tool's own check; `pages=False` leaves out the four one-off
    pages (world index, world flags, Timeline, Player Characters)."""
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
    if attach is not None:
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
    if pages:
        file("_World/world-index.md",
             lambda: _plugin_text(mv.TEMPLATES / "world-index.md"),
             present=has_world_index)
        file("_World/_flags.md",
             lambda: _plugin_text(mv.TEMPLATES / "world-flags.md"),
             present="world_flags" in types)
        file(TIMELINE, lambda: seed("timeline.md", campaign),
             present="timeline" in types)
        file("_Campaign/Player Characters.md",
             lambda: seed("player-characters.md", campaign),
             present=bool(ROSTER_TYPES & types))
    file("_meta/entity-types.md", entity_types_text)
    file("_meta/relationship-types.md", relationship_types_text)
    # The index is rendered when it is written, after the files above exist.
    file("_meta/index.md",
         lambda: index_build.render(vault, today=day, previous=None))
    # Only for a vault with no settings file at all: a vault on either layout
    # (the update's skeleton check) must never get the new files, nor an old
    # one back beside them.
    has_settings = vault_layout(vault) != "none"
    file(SETTINGS_FILE, lambda: settings_text(system, campaign),
         present=has_settings)
    file(STATE_FILE, lambda: state_text(version), present=has_settings)
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


def _undo(vault: Path, made: list[Path]) -> list[str]:
    """Remove what this run made, newest first. Returns what would not go,
    as rows show a path: relative to the vault, a folder ending in `/`."""
    left: list[str] = []
    for path in reversed(made):
        is_dir = path.is_dir()
        try:
            if is_dir:
                path.rmdir()
            else:
                path.unlink(missing_ok=True)
        except OSError:
            rel = path.relative_to(vault).as_posix()
            if rel == ".":
                rel = vault.name
            left.append(f"{rel}/" if is_dir else rel)
    return left


def build(vault: Path, pieces: list[Piece]) -> None:
    """Create every piece, or none: a failure part-way, Ctrl-C included,
    removes what this run made and nothing else."""
    made: list[Path] = []
    # The vault's settings file may be among the pieces (or removed again).
    forget_settings(vault)
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
        left = _undo(vault, made)
        if not isinstance(e, Exception):
            if left:
                raise ScaffoldError(f"interrupted; could not remove: "
                                    f"{', '.join(left)}", left=True) from e
            raise
        name = e.__class__.__name__
        why = str(e) or name
        if str(e) and not isinstance(e, (StepFailed, OSError,
                                         ScaffoldError)):
            why = f"{name}: {e}"
        if left:
            why = f"{why}; could not remove: {', '.join(left)}"
        raise ScaffoldError(why, left=bool(left)) from e


# --- CLI --------------------------------------------------------------------

def resolve_system(vault: Path, given: str | None,
                   no_system: bool) -> str | None:
    """The system to build for. Never guessed: a new vault is refused when
    it records none, or one this script does not know, and no flag settles
    it; so is a flag that contradicts what the vault records."""
    if no_system:
        return None
    ids = ", ".join(SYSTEMS)
    recorded = None
    if vault.is_dir():
        recorded = mv.vault_system(vault)
    if given is not None:
        found = system_id(given)
        if found not in SYSTEMS:
            raise ScaffoldError(f"unknown system '{given}': use one of "
                                f"{ids}, or --no-system")
        if recorded in SYSTEMS and recorded != found:
            raise ScaffoldError(f"the vault records {recorded}; --system "
                                f"{found} disagrees")
        return found
    if recorded in SYSTEMS:
        return recorded
    if vault_layout(vault) == "none":
        if recorded is None:
            raise ScaffoldError(
                f"the game system is not recorded: ask the GM once, then "
                f"pass --system ID (one of {ids}) or --no-system")
        raise ScaffoldError(
            f"the vault names its system '{recorded}', which is not an id "
            f"this script knows: pass --system ID (one of {ids}) or "
            f"--no-system")
    # A set-up vault with no system, or one with no templates here: generic.
    return None


def _refuse_unusable_version(vault: Path, plugin: str) -> None:
    """A vault whose settings carry no version, or a later one than the
    plugin's, is refused. A vault with no settings file is a new one."""
    if vault_layout(vault) == "none":
        return
    try:
        current = read_stamp(vault)
    except StateUnreadable as e:
        raise ScaffoldError(str(e)) from e
    if not current or not parse_version(current):
        raise ScaffoldError(
            f"{stamp_file(vault)} has no gm_apprentice_version, so this "
            f"script cannot tell what set the vault up; it never rewrites "
            f"that file")
    if parse_version(str(current)) > parse_version(plugin):
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
            if vault_layout(vault) == "none" and (
                    not shutil.which("node") or not PUBLISH_TOOL.is_file()):
                # The settings defaults are the publish tool's, and so is the
                # new vault's settings file: asking it first would say "could
                # not read the vault's settings" of a vault that is not there.
                raise ScaffoldError(
                    "a new vault needs Node.js, which writes its settings "
                    "file; install Node.js, then run this again")
            _refuse_unusable_version(vault, found[0])
            system = resolve_system(vault, args.system, args.no_system)
            campaign = " ".join((args.name or vault.resolve().name).split())
            pieces = missing(vault, system, campaign=campaign,
                             version=found[0], inbox=args.inbox)
            if args.write:
                build(vault, pieces)
        except KeyboardInterrupt:
            raise ScaffoldError("interrupted") from None
    except SettingsUnavailable as e:
        print(f"ERROR\t{e}")
        print("# nothing written")
        return 1
    except ScaffoldError as e:
        print(f"ERROR\t{e}")
        print("# some of this run's files were left: remove them by hand"
              if e.left else "# nothing written")
        return 1
    verb = "CREATED" if args.write else "WOULD-CREATE"
    rows = [f"{verb}\t{shown(p)}" for p in pieces]
    if not rows:
        rows = ["OK\t(vault)\tnothing missing"]
    print("\n".join([*rows, f"# create: {len(pieces)}"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
