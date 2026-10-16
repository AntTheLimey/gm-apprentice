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

import json
import re
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Re-exported for scripts/validate_schema.py, vault_check.py,
# session_context.py and the test suite, all of which import these names
# from here. vaultlib owns the definitions; this module owns the rules.
from vaultlib import (  # noqa: E402,F401
    FRONTMATTER_RE,
    MAX_PLAUSIBLE_SESSION,
    QUOTED_SCALAR_RE,
    chapter_key,
    chapter_of,
    extract_frontmatter,
    gm_only_hides,
    parse_session_number,
    scalar_value,
    wikilink_target,
)

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
    "session-wrapup": ["type", "canon_status", "session"],
    "session_wrap": ["type", "canon_status", "session"],
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
    "session_wrap": [
        ("in_game_dates", "in_game_date", "1.9.5"),
        ("in_game_date_start", "in_game_date", "1.9.5"),
        ("in_game_date_end", "in_game_date", "1.9.5"),
    ],
    "session-wrap-up": [
        ("in_game_dates", "in_game_date", "1.9.5"),
        ("in_game_date_start", "in_game_date", "1.9.5"),
        ("in_game_date_end", "in_game_date", "1.9.5"),
    ],
    "session-wrapup": [
        ("in_game_dates", "in_game_date", "1.9.5"),
        ("in_game_date_start", "in_game_date", "1.9.5"),
        ("in_game_date_end", "in_game_date", "1.9.5"),
    ],
    "event": [("date", "in_game_date", "1.4.22")],
    "session": [
        ("planned_date", "play_date", "1.4.22"),
        ("actual_date", "play_date", "1.4.22"),
    ],
}


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


@lru_cache(maxsize=1)
def _ontology() -> dict:
    return json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))


def _ontology_predicates() -> list[dict]:
    return _ontology()["predicates"]


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


def type_key(raw: str) -> str:
    """A written relationship type as the vocabulary spells it."""
    return re.sub(r"[\s-]+", "_", str(raw).strip().lower())


def verb_choices(name: str) -> list[dict] | None:
    """What a stray type means: None when the ontology has no entry, [] when
    it is not a graph edge, else the predicates it can be (one = certain)."""
    choices = _ontology().get("verbs", {}).get(type_key(name))
    return None if choices is None else [dict(c) for c in choices]


def same_fact_pairs() -> list[tuple[str, str]]:
    return [(a, b) for a, b in _ontology().get("same_fact", [])]


def place_fields() -> list[dict]:
    return [dict(p) for p in _ontology().get("place_fields", [])]


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


TONE_KEY_RE = re.compile(r"^(?:-\s+)?(tone):\s*(.*)$")
# `---` straight after `---`: the frontmatter is empty. FRONTMATTER_RE wants
# a line between the two, so on such a note it runs on to the next `---` in
# the body and hands back body text.
EMPTY_FRONTMATTER_RE = re.compile(r"^---\r?\n---(?:\r?\n|$)")
# YAML's spellings of "no value".
NO_TONE = frozenset({"null", "~"})


# A key whose value starts a quoted scalar. Group 1 gives the key's own
# column, as BLOCK_SCALAR_OPEN_RE's does; group 2 the quote; group 3 the rest.
QUOTED_OPEN_RE = re.compile(r"""^(\s*(?:-\s+)?)[\w-]+:\s*(["'])(.*)$""")
# Up to and including the quote that closes a scalar, from inside it: a
# backslash pair is skipped in double quotes, a doubled quote in single.
QUOTE_CLOSE_RE = {'"': re.compile(r'(?:\\.|[^"\\])*"'),
                  "'": re.compile(r"(?:''|[^'])*'(?!')")}


def _iter_relationship_lines(content: str, top_level_only: bool):
    """Yield (lineno, kind, indent, raw line) for each line inside a
    `relationships:` block: `key` for a line of YAML, `open` for a key
    that opens a block scalar, `text` for a line of that scalar's text or
    a later line of a quoted value that runs over several lines.
    `top_level_only` leaves out a block nested under another key (the
    machine-managed `mobrpg:` node's). This is the one walk of the block;
    the readers below take what they need from it."""
    match = FRONTMATTER_RE.match(content)
    if not match or EMPTY_FRONTMATTER_RE.match(content):
        return
    block_indent = None
    scalar_indent = None
    quote: tuple[str, int] | None = None   # an open quote, its key's column
    for offset, line in enumerate(match.group(1).split("\n")):
        stripped = line.strip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip())
        # Inside a quoted value left open (`description: "He spoke`), every
        # more-indented line is its text until the quote closes. YAML wants
        # those lines indented past the key, so a quote that is never closed
        # ends at the next sibling key or item and hides nothing after it.
        if quote is not None:
            if indent > quote[1]:
                if block_indent is not None:
                    yield offset + 2, "text", indent, line
                if QUOTE_CLOSE_RE[quote[0]].match(stripped):
                    quote = None
                continue
            quote = None
        # Inside a block scalar (`description: |`), every more-indented line is
        # literal text, not YAML. A relationship description whose prose begins
        # `type:` is not an edge, and a folded note that quotes a whole
        # `relationships:` block does not open one.
        if scalar_indent is not None:
            if indent > scalar_indent:
                if block_indent is not None:
                    yield offset + 2, "text", indent, line
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
            opens = not value or value.startswith("#")
            block_indent = indent if opens and not (
                top_level_only and indent > 0) else None
            continue
        opener = BLOCK_SCALAR_OPEN_RE.match(line)
        if opener:
            scalar_indent = len(opener.group(1))
            if block_indent is not None:
                yield offset + 2, "open", indent, line
            continue
        quoted = QUOTED_OPEN_RE.match(line.rstrip("\r"))
        if quoted and not QUOTE_CLOSE_RE[quoted.group(2)].match(
                quoted.group(3)):
            quote = (quoted.group(2), len(quoted.group(1)))
        if block_indent is None:
            continue
        # +2: line 1 is the opening `---`, so frontmatter starts at 2.
        yield offset + 2, "key", indent, line


def _iter_relationship_keys(content: str, key_re: re.Pattern[str],
                            top_level_only: bool):
    """Yield (lineno, key, value) for each `key_re` line on an edge of a
    `relationships:` block."""
    for lineno, kind, _indent, line in _iter_relationship_lines(
            content, top_level_only):
        edge = key_re.match(line.strip()) if kind == "key" else None
        if edge:
            yield lineno, edge.group(1), scalar_value(edge.group(2))


def iter_relationship_predicates(content: str):
    """Yield (lineno, key, predicate) for every edge in a `relationships:` block.

    Covers both storage shapes: the authored top-level block (`type:`) and
    the `mobrpg:` node's nested one (`predicate:`). Block style only — a
    `relationships: []` or inline-flow value carries no edges to check.
    Line numbers are 1-based within the file, so findings are navigable.
    """
    yield from _iter_relationship_keys(content, RELATIONSHIP_KEY_RE, False)


def iter_relationship_tones(content: str) -> Iterator[tuple[int, str]]:
    """Yield (lineno, tone as written) for every edge of the note's own
    `relationships:` block that gives a tone. A blank `tone:` is no tone,
    and so is `null` or `~`. Line numbers are 1-based within the file."""
    for lineno, _key, value in _iter_relationship_keys(
            content, TONE_KEY_RE, True):
        if value and value.lower() not in NO_TONE:
            yield lineno, value


@dataclass
class RelationshipEdge:
    """One edge of a note's own `relationships:` block, as `tones.py uses`
    shows it."""
    tone_lines: list[int] = field(default_factory=list)
    target: str = ""
    description: str = ""
    tone: str = ""            # the first `tone:` value, unquoted
    gm_only: bool = False     # true exactly when the site drops the edge


def _site_drops_edge(value: str) -> bool:
    """Does `gm_only: <value>` make the site drop the edge? The raw line
    value read by vaultlib `gm_only_hides`, which mirrors `isGmOnlyEdge` in
    tools/publish/lib/processor.js: true, the words yes, on and 1 in any
    capitals and padding, quoted or not, and an unquoted number equal to 1
    (`1.0` too, which YAML reads as the number)."""
    text = value.strip()
    word = scalar_value(text)
    if not QUOTED_SCALAR_RE.match(text):
        try:
            if float(word) == 1:
                return True
        except ValueError:
            pass
    return gm_only_hides(word)


EDGE_KEY_RE = re.compile(r"^(-\s+)?([\w-]+):\s*(.*)$")


def iter_relationship_edges(content: str) -> Iterator[RelationshipEdge]:
    """Yield each edge of the note's own `relationships:` block: the lines
    of its `tone:` keys (the numbers `iter_relationship_tones` gives), its
    `target` as written, and its `description` on one line (a block
    scalar's lines, or a value that runs on to more-indented lines, joined
    with single spaces; empty when there is none)."""
    edge: RelationshipEdge | None = None
    column = 0                    # where this edge's keys start
    key = ""                      # the key the last line belongs to
    parts: list[str] = []         # the description, as it arrives
    folded = False                # it came from a block scalar

    def finished(e: RelationshipEdge) -> RelationshipEdge:
        text = " ".join(" ".join(parts).split())
        e.description = text if folded else scalar_value(text)
        return e

    for lineno, kind, indent, line in _iter_relationship_lines(content, True):
        bare = line.strip()
        if kind == "text":
            if edge and key == "description":
                parts.append(bare)
            continue
        m = EDGE_KEY_RE.match(bare)
        dash = bare.startswith("-")
        if not dash and edge and (indent > column or not m):
            # A value that runs on: more indented than the edge's keys.
            if key == "description" and indent > column:
                parts.append(bare)
            continue
        if dash:
            if edge:
                yield finished(edge)
            edge, parts, folded = RelationshipEdge(), [], False
            column = indent + (len(m.group(1)) if m else 2)
            key = ""
        if not edge or not m:
            continue
        key, value = m.group(2), m.group(3)
        if key == "tone":
            edge.tone_lines.append(lineno)
            if not edge.tone:
                edge.tone = scalar_value(value)
        elif key == "gm_only":
            edge.gm_only = _site_drops_edge(value)
        elif key == "target":
            edge.target = scalar_value(value)
        elif key == "description":
            folded = kind == "open"
            parts = [] if folded else [value]
    if edge:
        yield finished(edge)
