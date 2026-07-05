#!/usr/bin/env python3
"""Canonical vault schema rules and frontmatter parser.

Single source of truth shared by the dev-side validator
(scripts/validate_schema.py) and the vault-facing utility
(skills/shared/scripts/vault_check.py). Lives under
skills/shared/ so it ships with the plugin; the dev validator
imports it from the repo. Stdlib only.
"""

import re

# Valid enum values
CANON_STATUS_VALUES = {"DRAFT", "AUTHORITATIVE", "SUPERSEDED", "STUB"}
SESSION_STATUS = {"planned", "prepped", "played", "wrap-up", "reviewed"}
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
    "session-wrap-up": ["type", "canon_status", "session"],
    "session_wrap": ["type", "canon_status", "session"],
    "scene": ["type", "canon_status", "scene_type", "status"],
    "chapter": ["type"],
    "meta": ["type"],
    "timeline": ["type"],
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
    "event": [("date", "in_game_date", "1.4.22")],
    "session": [
        ("planned_date", "play_date", "1.4.22"),
        ("actual_date", "play_date", "1.4.22"),
    ],
}


def extract_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from markdown content."""
    # Handle both LF and CRLF line endings
    match = re.match(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", content, re.DOTALL)
    if not match:
        return None

    frontmatter = {}
    yaml_content = match.group(1)

    # Simple YAML parsing (handles flat key: value and arrays)
    current_key = None
    for line in yaml_content.split("\n"):
        # Skip empty lines
        if not line.strip():
            continue

        # Array item
        if line.strip().startswith("- "):
            if current_key and current_key in frontmatter:
                if not isinstance(frontmatter[current_key], list):
                    frontmatter[current_key] = []
                frontmatter[current_key].append(
                    line.strip()[2:].strip('"').strip("'"))
            continue

        # Key: value pair
        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip()

            # Quoted value: take the quoted content, drop anything after
            # (including trailing YAML comments).
            m = re.match(r"""^(['"])(.*?)\1""", value)
            if m:
                value = m.group(2)
            else:
                # Unquoted: a ' #' starts a YAML comment.
                value = re.split(r"\s+#", value, maxsplit=1)[0].strip()

            # Handle empty value (might be start of array)
            if value == "" or value == "[]":
                frontmatter[key] = []
            elif value.startswith("[") and value.endswith("]"):
                # Inline array: aliases: [Doc, "The Colonel"]
                frontmatter[key] = [
                    v.strip().strip('"').strip("'")
                    for v in value[1:-1].split(",") if v.strip()]
            else:
                frontmatter[key] = value
            current_key = key

    return frontmatter


# Session numbers above this are implausible — a larger value is a
# year or date fragment that leaked into a session field.
MAX_PLAUSIBLE_SESSION = 500


def parse_session_number(value) -> int | None:
    """Parse a session reference like '3', 'Session 3', or 'session-03'.

    Real vaults hold free-text values: compound references
    ("Chapter 3, Session 7") must key on the session, not the first
    number, and date-bearing prose ("Reconstructed 2026-07-04") must
    parse as unknown rather than as session 2026.
    """
    if value is None or isinstance(value, list):
        return None
    text = str(value)
    m = re.search(r"session\D{0,3}(\d+)", text, re.IGNORECASE)
    if not m:
        m = re.search(r"(\d+)", text)
    if not m:
        return None
    n = int(m.group(1))
    return n if n <= MAX_PLAUSIBLE_SESSION else None
