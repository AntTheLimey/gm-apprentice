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
