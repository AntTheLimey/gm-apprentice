#!/usr/bin/env python3
"""Canonical vault schema rules and the relationship vocabulary.

Single source of truth shared by the dev-side validator
(scripts/validate_schema.py) and the vault-facing utility
(skills/shared/scripts/vault_check.py). Lives under
skills/shared/ so it ships with the plugin; the dev validator
imports it from the repo. Stdlib only.

The frontmatter parser itself now lives in vaultlib, alongside every
other shared vault primitive; the names callers have always imported
from here are re-exported below so nothing had to be rewritten.
"""

from __future__ import annotations

import re
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Re-exported for scripts/validate_schema.py, vault_check.py,
# session_context.py and the test suite, all of which import these names
# from here. vaultlib owns the definitions; this module owns the rules.
from vaultlib import (  # noqa: E402,F401
    FRONTMATTER_RE,
    MAX_PLAUSIBLE_SESSION,
    ONTOLOGY_PATH,
    QUOTED_SCALAR_RE,
    WRAP_UP_TYPE,
    WRAP_UP_TYPES,
    chapter_key,
    chapter_of,
    extract_frontmatter,
    gm_only_hides,
    parse_session_number,
    scalar_value,
    wikilink_target,
)
from vaultlib import ontology as _ontology  # noqa: E402

# The short lists shared with the publish tool live in the ontology file
# (vaultlib.ontology); everything below that names one derives from it.

# A session's `status`: not yet run (prep, kept off a player site) or
# played (the `wrap-up` state between the wrap-up and the review counts).
SESSION_NOT_YET_RUN: frozenset[str] = frozenset(_ontology()["session_status"]["not_yet_run"])
SESSION_PLAYED: frozenset[str] = frozenset(_ontology()["session_status"]["played"])
# A session's `stage`: still being written (kept off a player site), or in play.
SESSION_STAGE_IN_PREP: frozenset[str] = frozenset(_ontology()["session_stage"]["in_prep"])
SESSION_STAGE: frozenset[str] = (
    SESSION_STAGE_IN_PREP | frozenset(_ontology()["session_stage"]["in_play"]))

# Game systems: canonical id -> its name, and every alias -> its canonical id.
SYSTEMS: tuple[str, ...] = tuple(s["id"] for s in _ontology()["game_systems"])
SYSTEM_NAMES: dict[str, str] = {s["id"]: s["name"] for s in _ontology()["game_systems"]}
SYSTEM_ALIASES: dict[str, str] = {
    alias: s["id"] for s in _ontology()["game_systems"] for alias in s["aliases"]}
# Where a system's rules live under ttrpg-expert/systems/, when not under its id: a
# variant of another system (Regency is coc-7e's `regency` variant).
SYSTEM_RULES: dict[str, str] = {
    s["id"]: s.get("rules", s["id"]) for s in _ontology()["game_systems"]}


def system_id(raw: object) -> str | None:
    """The canonical id a written system names (trimmed, any case); the
    text itself, lowered, when it is no known alias; None when blank."""
    text = str(raw or "").strip().lower()
    return SYSTEM_ALIASES.get(text, text) or None


def _descendants(name: str) -> set[str]:
    found = {name}
    for child in _ontology()["entity_types"]["hierarchy"].get(name, []):
        found |= _descendants(child)
    return found


# The type folders: vault folder -> every type a note in it may have (the
# folder's own types and their subtypes in the hierarchy).
TYPE_FOLDERS: dict[str, frozenset[str]] = {
    f["folder"]: frozenset().union(*(_descendants(t) for t in f["types"]))
    for f in _ontology()["vault_folders"]}

# Valid enum values
CANON_STATUS_VALUES = {"DRAFT", "AUTHORITATIVE", "SUPERSEDED", "STUB"}
SESSION_STATUS = set(SESSION_NOT_YET_RUN | SESSION_PLAYED)
SCENE_STATUS = {"planned", "ready", "played", "cut", "skipped", "modified"}
SCENE_TYPES = {
    "investigation", "social", "combat", "chase",
    "transition", "horror", "downtime", "other"
}
NPC_STATUS = {"alive", "dead", "missing", "unknown"}
ADVENTURE_BRIEF_SCOPE = {"campaign", "one-shot", "few-shot"}
CAMPAIGN_OVERVIEW_STATUS = {
    "not_started", "in_progress", "paused", "completed", "abandoned"
}
ADVENTURE_BRIEF_CONTINUATION = {
    "new", "new-chapter", "new-arc", "time-jump",
    "prequel", "parallel", "new-pcs"
}
ADVENTURE_BRIEF_SHAPE = {
    "linear", "branching", "hub-and-spoke", "open-node", "sandbox"
}
WORLD_DOMAIN_STATUS = {"active", "stub", "inactive"}
PLAN_TYPES = {"arc", "scene", "investigation", "timeline"}
# Named by the schema, checked by nothing: how a note entered canon, and
# where a faction or organization stands.
SOURCE_VALUES = frozenset({"play", "prep", "backstory", "world-evolution"})
FACTION_STATUS = frozenset({"active", "weakened", "destroyed", "allied", "dormant"})

# The values a field takes, by note type ("*": any type). CHECKED_VALUES is
# what scripts/validate_schema.py rejects anything outside of; LISTED_VALUES
# are words the schema names that no check enforces. `show` prints both.
CHECKED_VALUES: dict[str, dict[str, frozenset[str]]] = {
    "*": {"canon_status": frozenset(CANON_STATUS_VALUES)},
    "session": {"status": frozenset(SESSION_NOT_YET_RUN | SESSION_PLAYED)},
    "scene": {"status": frozenset(SCENE_STATUS), "scene_type": frozenset(SCENE_TYPES)},
    "npc": {"status": frozenset(NPC_STATUS)},
    "pc": {"status": frozenset(NPC_STATUS)},
    "adventure-brief": {"scope": frozenset(ADVENTURE_BRIEF_SCOPE),
                        "continuation_type": frozenset(ADVENTURE_BRIEF_CONTINUATION),
                        "adventure_shape": frozenset(ADVENTURE_BRIEF_SHAPE)},
    "campaign_overview": {"status": frozenset(CAMPAIGN_OVERVIEW_STATUS),
                          "scope": frozenset(ADVENTURE_BRIEF_SCOPE)},
    "world_domain": {"status": frozenset(WORLD_DOMAIN_STATUS)},
    "plan": {"plan_type": frozenset(PLAN_TYPES)},
}
LISTED_VALUES: dict[str, dict[str, frozenset[str]]] = {
    "*": {"source": SOURCE_VALUES},
    "session": {"stage": SESSION_STAGE},
    "faction": {"status": FACTION_STATUS},
    "organization": {"status": FACTION_STATUS},
}


def checked_values(etype: str) -> dict[str, frozenset[str]]:
    """Field -> the values the validator accepts, for a note of this type."""
    return {**CHECKED_VALUES["*"], **CHECKED_VALUES.get(etype, {})}

# Required fields per entity type
# All entities need: type, canon_status
REQUIRED_FIELDS = {
    "npc": ["type", "canon_status"],
    "pc": ["type", "canon_status"],
    "location": ["type", "canon_status"],
    "faction": ["type", "canon_status"],
    "organization": ["type", "canon_status"],
    "item": ["type", "canon_status"],
    "creature": ["type", "canon_status"],
    "clue": ["type", "canon_status"],
    "event": ["type", "canon_status"],
    "document": ["type", "canon_status"],
    "adventure-brief": ["type", "canon_status", "scope"],
    "session": ["type", "session_number", "status", "documents"],
    "session-plan": ["type", "canon_status", "session"],
    "session-play-notes": ["type", "canon_status", "session"],
    **{t: ["type", "canon_status", "session"] for t in sorted(WRAP_UP_TYPES)},
    "scene": ["type", "canon_status", "scene_type", "status"],
    "chapter": ["type"],
    "meta": ["type"],
    "timeline": ["type"],
    "pc_roster": ["type"],
    # An older name for pc_roster, still accepted.
    "player-characters": ["type"],
    "character-story": ["type", "canon_status"],
    "campaign_overview": ["type", "canon_status"],
    "heritage": ["type", "canon_status"],
    "plan": ["type", "canon_status", "plan_type", "chapter"],
    "world_domain": ["type", "canon_status", "domain", "status"],
    "world_flags": ["type"],
}

# Fields any note may carry, beside its type's own: on every entity, then
# recommended (not enforced), then optional anywhere.
UNIVERSAL_FIELDS = ("lastUpdated", "asOfSession", "createdSession", "source", "era")
RECOMMENDED_FIELDS = ("aliases", "tags", "source_document", "campaign", "first_appearance")
ANYWHERE_FIELDS = ("gm_aliases", "withheld", "superseded_by", "publish",
                   "publish_exclude_fields", "publish_include_sections")
COMMON_FIELDS = frozenset(UNIVERSAL_FIELDS + RECOMMENDED_FIELDS + ANYWHERE_FIELDS)

# shared/templates name -> _Templates name: the one definition. A PC
# template (pc-{system}.md, crew-fitd.md) keeps its own name.
TEMPLATE_NAMES = {
    "npc.md": "_Template_NPC.md",
    "location.md": "_Template_Location.md",
    "item.md": "_Template_Item.md",
    "creature.md": "_Template_Creature.md",
    "organization.md": "_Template_Organization.md",
    "faction.md": "_Template_Faction.md",
    "event.md": "_Template_Event.md",
    "clue.md": "_Template_Clue.md",
    "document.md": "_Template_Document.md",
    "heritage.md": "_Template_Heritage.md",
    "world-domain.md": "_Template_World_Domain.md",
    "plan.md": "_Template_Plan.md",
    "campaign-overview.md": "_Template_Campaign_Overview.md",
    "session.md": "_Template_Session.md",
    "session-plan.md": "_Template_Session_Plan.md",
    "session-wrap.md": "_Template_Session_WrapUp.md",
    "character-story.md": "character-story.md",
}
TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

# Optional fields that support portraits (for future validation)
PORTRAIT_TYPES = {
    "npc", "pc", "location", "faction", "organization", "item",
    "creature", "campaign_overview", "heritage",
}

# Deprecated field renames, keyed by entity type; "*" applies to all types
DEPRECATED_FIELDS: dict[str, list[tuple[str, str, str]]] = {
    # (old_field, replacement_field, migration_version)
    "*": [
        ("source_confidence", "canon_status", "1.8.0"),
        ("confidence", "canon_status", "1.8.0"),
    ],
    **{t: [
        ("in_game_dates", "in_game_date", "1.9.5"),
        ("in_game_date_start", "in_game_date", "1.9.5"),
        ("in_game_date_end", "in_game_date", "1.9.5"),
    ] for t in sorted(WRAP_UP_TYPES)},
    "event": [("date", "in_game_date", "1.4.22")],
    "session": [
        ("planned_date", "play_date", "1.4.22"),
        ("actual_date", "play_date", "1.4.22"),
    ],
}


# Relationship predicate vocabulary
#
# The ontology file beside this package is the one source of the vocabulary;
# the predicate table in entity-schema.md is generated from it
# (scripts/gen_ontology_docs.py --check fails CI when it is stale). vaultlib
# reads it (ONTOLOGY_PATH, re-exported above).


GENERATED_MARKER_RE = re.compile(r"^<!-- /?generated:[^>]*-->\r?\n", re.M)


def without_generated_markers(text: str) -> str:
    """The plugin's schema text as a vault should hold it: the markers
    scripts/gen_ontology_docs.py leaves around its tables are not copied."""
    return GENERATED_MARKER_RE.sub("", text)


# Tone words
#
# A relationship's `tone` is one of the listed words, in one of three
# families. The list and the near-miss table live in the ontology export;
# nothing else names a tone word.

def tone_key(raw: object) -> str:
    """A tone as it is compared: trimmed, inner spaces single, lower case."""
    return " ".join(str(raw).split()).lower()


@lru_cache(maxsize=1)
def tone_families() -> dict[str, str]:
    """Listed tone word -> its family (positive, negative, neutral)."""
    return {word: family
            for family, words in _ontology()["tones"].items()
            for word in words}


def tone_family(raw: object) -> str | None:
    """The family of a tone written exactly as listed, else None."""
    return tone_families().get(raw) if isinstance(raw, str) else None


def tone_proposal(raw: object) -> str | None:
    """The listed word a stray tone should become, or None when no rule
    says (and None for a tone that is already listed)."""
    if not isinstance(raw, str) or raw in tone_families():
        return None
    key = tone_key(raw)
    if key in tone_families():
        return key
    return _ontology().get("tone_near", {}).get(key)


# `show`: one note type's fields, read from the rules above, the
# templates and the ontology, so the skills ask instead of reading the
# schema files.
#
#     schema_rules.py show [TYPE]

# Older spellings of a type: the name to write instead.
OLDER_TYPE_NAMES: dict[str, str] = {
    "player-characters": "pc_roster",
    **{t: WRAP_UP_TYPE for t in sorted(WRAP_UP_TYPES) if t != WRAP_UP_TYPE},
}


def template_sources(etype: str) -> list[str]:
    """The shared/templates files a vault's `_Templates/` gets for notes
    of this type (a type's older spelling has its new name's)."""
    etype = OLDER_TYPE_NAMES.get(etype, etype)
    found = []
    for path in sorted(TEMPLATES_DIR.glob("*.md")):
        if path.name not in TEMPLATE_NAMES and not path.name.startswith("pc-") \
                and path.name != "crew-fitd.md":
            continue
        fm = extract_frontmatter(path.read_text(encoding="utf-8")) or {}
        if fm.get("type") == etype:
            found.append(path.name)
    return found


def template_fields(etype: str) -> list[str]:
    """Every frontmatter field the type's templates carry, in order."""
    fields: list[str] = []
    for name in template_sources(etype):
        fm = extract_frontmatter((TEMPLATES_DIR / name).read_text(encoding="utf-8")) or {}
        fields.extend(f for f in fm if f not in fields)
    return fields


def _ancestors(name: str) -> list[str]:
    hierarchy = _ontology()["entity_types"]["hierarchy"]
    out: list[str] = []
    todo = [name]
    while todo:
        child = todo.pop(0)
        for parent, kids in hierarchy.items():
            if child in kids and parent not in out:
                out.append(parent)
                todo.append(parent)
    return out


def known_types() -> list[str]:
    """The types the schema has rules for."""
    return sorted(REQUIRED_FIELDS)


def _values(table: dict[str, frozenset[str]]) -> str:
    return "; ".join(f"{field} {'|'.join(sorted(vals))}" for field, vals in table.items())


def _common_line() -> str:
    universal = [f"{f} {'|'.join(sorted(LISTED_VALUES['*'][f]))}" if f in LISTED_VALUES["*"]
                 else f for f in UNIVERSAL_FIELDS]
    return ("any type: " + ", ".join(universal) + "; recommended "
            + " ".join(RECOMMENDED_FIELDS) + "; optional " + " ".join(ANYWHERE_FIELDS))


def show_types() -> str:
    """`show` with no type: the types, and the fields any type takes."""
    return "\n".join([
        "types: " + " ".join(known_types()),
        "any other type is custom: no rules (vault_check reports it as INFO)",
        _common_line(),
        "canon_status SUPERSEDED needs superseded_by",
        "show <type> for one type's fields",
    ])


def show(etype: str) -> str | None:
    """One type's fields, compactly; None when the schema has no such type."""
    hierarchy = _ontology()["entity_types"]["hierarchy"]
    in_hierarchy = etype in hierarchy or any(etype in k for k in hierarchy.values())
    if etype not in REQUIRED_FIELDS and not in_hierarchy:
        return None
    lines = []
    head = etype
    if etype in OLDER_TYPE_NAMES:
        head += f" (older name: write {OLDER_TYPE_NAMES[etype]})"
    kinds = _ancestors(etype)
    if kinds:
        head += " — kind of: " + ", ".join(kinds)
    lines.append(head)
    if etype in _ontology()["entity_types"]["abstract"]:
        lines.append("abstract: never a note's type; " + "subtypes: "
                     + " ".join(hierarchy.get(etype, [])))
        return "\n".join(lines)
    if etype not in REQUIRED_FIELDS:
        lines.append("no rules of its own: a custom type to vault_check")
    subtypes = hierarchy.get(etype, [])
    if subtypes:
        lines.append("subtypes: " + " ".join(subtypes))
    sources = template_sources(etype)
    systems = [s[3:-3] for s in sources if s.startswith("pc-")]
    names = [f"_Templates/{TEMPLATE_NAMES.get(s, s)}" for s in sources
             if not s.startswith("pc-")]
    if systems:
        names.insert(0, "_Templates/pc-{system}.md (" + " ".join(systems) + ")")
    if names:
        lines.append("template: " + ", ".join(names))
    folders = [f for f, types in TYPE_FOLDERS.items() if etype in types]
    if folders:
        lines.append("folder: " + ", ".join(folders))
    required = REQUIRED_FIELDS.get(etype, [])
    if required:
        lines.append("required: " + ", ".join(required))
    checked = checked_values(etype)
    listed = LISTED_VALUES.get(etype, {})
    optional = [f for f in template_fields(etype)
                if f not in required and f not in COMMON_FIELDS]
    optional += [f for f in (*CHECKED_VALUES.get(etype, {}), *listed)
                 if f not in required and f not in optional]
    lines.append("optional: " + (", ".join(optional) if optional
                                 else "no shared template (shared/entity-schema.md)"))
    lines.append("values (checked): " + _values(checked))
    if listed:
        lines.append("values (listed, not checked): " + _values(listed))
    lines.append(_common_line())
    rules = []
    if etype in PORTRAIT_TYPES:
        rules.append("portrait is a path under _attachments/")
    if etype == "plan":
        rules.append("leads_to is a list of [[links]]")
    if rules:
        lines.append("rules: " + "; ".join(rules))
    ont = _ontology()
    edge_name = etype.replace("-", "_")
    if edge_name in ont["not_edge_target_types"]:
        lines.append("relationships: never a relationship target")
    elif "relationships" in template_fields(etype):
        edge = [f for f in ont["edge_fields"] if f != "source"]
        low, high = ont["edge_fields"]["strength"]["range"]
        lines.append(f"relationships: list of {{{', '.join(edge)}}}; type one of "
                     f"{len(ont['predicates'])} in _meta/relationship-types.md; tone one "
                     f"of {len(tone_families())} listed; strength {low}-{high}")
        stands = [f"{p['field']} ({p['predicate']})" for p in ont["place_fields"]
                  if p["field"] in template_fields(etype)]
        if stands:
            lines.append("fields that stand for an edge: " + ", ".join(stands))
    renamed: dict[str, list[str]] = {}
    for old, new, _since in DEPRECATED_FIELDS.get("*", []) + DEPRECATED_FIELDS.get(etype, []):
        renamed.setdefault(new, []).append(old)
    if renamed:
        lines.append("old names: " + "; ".join(
            f"{', '.join(olds)} -> {new}" for new, olds in renamed.items()))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(
        prog="schema_rules.py",
        description="Print the frontmatter rules for a note type.")
    sub = parser.add_subparsers(dest="command", required=True)
    one = sub.add_parser("show", help="one type's fields; no type lists the types")
    one.add_argument("type", nargs="?")
    args = parser.parse_args(argv)
    if args.type is None:
        print(show_types())
        return 0
    text = show(args.type)
    if text is None:
        print(f"no type '{args.type}' in the schema; known: {' '.join(known_types())}",
              file=sys.stderr)
        return 1
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
