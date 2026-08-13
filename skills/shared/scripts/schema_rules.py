#!/usr/bin/env python3
"""Canonical vault schema rules and frontmatter parser.

Single source of truth shared by the dev-side validator
(scripts/validate_schema.py) and the vault-facing utility
(skills/shared/scripts/vault_check.py). Lives under
skills/shared/ so it ships with the plugin; the dev validator
imports it from the repo. Stdlib only.
"""

import json
import re
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path

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


# A complete quoted scalar and nothing else after it but blanks or a comment.
# The closing quote is the *unescaped* one (`\"` inside double quotes, `''`
# inside single), so `"5'4\" - 6'0\""` is one value rather than a truncated
# prefix. Content after the closing quote means the line is not a valid quoted
# scalar at all — see scalar_value.
QUOTED_SCALAR_RE = re.compile(
    r"""^(?:"((?:\\.|[^"\\])*)"|'((?:''|[^'])*)')\s*(?:\#.*)?$"""
)


def scalar_value(value: str) -> str:
    """Unwrap a YAML scalar: quoted content, or unquoted up to a comment.

    A quoted scalar with trailing content (`type: "npc" trailing`) is not
    valid YAML. Unwrapping it would hand a clean-looking `npc` to the type
    and predicate checks and pass malformed frontmatter silently, so the raw
    text is returned instead and the caller reports it.
    """
    text = value.strip()
    m = QUOTED_SCALAR_RE.match(text)
    if m:
        # Escapes are left as authored — nothing downstream compares against
        # an unescaped form, and decoding them here would be a second guess
        # at YAML this parser is deliberately not implementing.
        return m.group(1) if m.group(1) is not None else m.group(2)
    # Unquoted: a ' #' starts a YAML comment.
    return re.split(r"\s+#", text, maxsplit=1)[0].strip()


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
            value = scalar_value(value)

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


# Relationship predicate vocabulary
#
# The authoritative list is the predicate table in entity-schema.md; the
# ontology export beside this package restates it machine-readably (and
# scripts/validate_ontology.py fails CI when the two disagree), so the
# export is what code reads. Resolved from this file's own location: the
# vocabulary travels with the plugin, never with the vault under audit.

ONTOLOGY_PATH = Path(__file__).resolve().parent.parent / "gm-apprentice-ontology.json"

# Predicate-bearing keys inside a `relationships:` block: `type` in
# authored frontmatter, `predicate` in the machine-managed `mobrpg:` node.
RELATIONSHIP_KEY_RE = re.compile(r"^(?:-\s+)?(type|predicate):\s*(.*)$")
FRONTMATTER_KEY_RE = re.compile(r"^([\w-]+):\s*(.*)$")
# A key whose value is a YAML block scalar header (`|`, `>`, with optional
# indentation/chomping indicators and a trailing comment). Matched against the
# *raw* line so group 1 gives the key's own column — content belonging to the
# block is indented past it, and the next sibling key is not.
BLOCK_SCALAR_OPEN_RE = re.compile(r"^(\s*(?:-\s+)?)[\w-]+:\s*[|>][0-9+-]*\s*(?:#.*)?$")


def _ontology_predicates() -> list[dict]:
    return json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))["predicates"]


@lru_cache(maxsize=1)
def predicate_vocabulary() -> frozenset[str]:
    """The sanctioned relationship predicates. Raises if the export is unusable."""
    return frozenset(p["type"] for p in _ontology_predicates())


@lru_cache(maxsize=1)
def inverse_predicates() -> dict[str, str]:
    """Inverse name -> the sanctioned predicate it inverts.

    Inverse names (`led_by`, `owned_by`, `imprisoned_by`) are implied, never
    stored, so they are off-vocabulary — but they are the one class of bad
    predicate whose fix is exact rather than a guess.
    """
    return {p["inverse"]: p["type"]
            for p in _ontology_predicates() if p.get("inverse")}


def suggest_predicates(predicate: str) -> list[str]:
    """Up to three sanctioned predicates close to an off-vocabulary one."""
    return get_close_matches(predicate, sorted(predicate_vocabulary()), n=3)


def predicate_problem(key: str, predicate: str) -> str:
    """Describe what is wrong with a predicate, and how to fix it.

    Shared by both reporters so the vault-facing check and CI say the same
    thing about the same edge; each wraps it in its own row format.
    """
    if not predicate:
        return f"blank relationship {key} — every edge needs a sanctioned predicate"
    problem = f"off-vocabulary relationship {key} '{predicate}'"
    base = inverse_predicates().get(predicate)
    if base:
        return (f"{problem} — inverse of '{base}'; storage is single-direction, "
                f"so record '{base}' on the other endpoint")
    near = suggest_predicates(predicate)
    if near:
        return f"{problem} — did you mean {', '.join(near)}?"
    return f"{problem} — no close match"


def iter_relationship_predicates(content: str):
    """Yield (lineno, key, predicate) for every edge in a `relationships:` block.

    Covers both storage shapes: the authored top-level block (`type:`) and
    the `mobrpg:` node's nested one (`predicate:`). Block style only — a
    `relationships: []` or inline-flow value carries no edges to check.
    Line numbers are 1-based within the file, so findings are navigable.
    """
    match = re.match(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", content, re.DOTALL)
    if not match:
        return
    block_indent = None
    scalar_indent = None
    for offset, line in enumerate(match.group(1).split("\n")):
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip())
        # Inside a block scalar (`description: |`), every more-indented line is
        # literal text, not YAML. A relationship description whose prose begins
        # `type:` is not an edge, and a folded note that quotes a whole
        # `relationships:` block does not open one.
        if scalar_indent is not None:
            if indent > scalar_indent:
                continue
            scalar_indent = None
        # The block ends at the next key at or above its own indent.
        if block_indent is not None and indent <= block_indent \
                and not stripped.startswith("-"):
            block_indent = None
        key = FRONTMATTER_KEY_RE.match(stripped)
        if key and key.group(1) == "relationships":
            # A trailing comment is not a value: `relationships:  # later`
            # still opens a block whose edges follow.
            value = key.group(2).strip()
            block_indent = indent if not value or value.startswith("#") else None
            continue
        opener = BLOCK_SCALAR_OPEN_RE.match(line)
        if opener:
            scalar_indent = len(opener.group(1))
            continue
        if block_indent is None:
            continue
        edge = RELATIONSHIP_KEY_RE.match(stripped)
        if edge:
            # +2: line 1 is the opening `---`, so frontmatter starts at 2.
            yield offset + 2, edge.group(1), scalar_value(edge.group(2))
