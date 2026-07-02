#!/usr/bin/env python3
"""
Validate campaign entity frontmatter against the schema defined in entity-schema.md.

Checks:
- Required fields exist per entity type
- Enum values are valid (canon_status, status, scene_type, etc.)
- Universal temporal fields are present where expected

Usage:
    python scripts/validate_schema.py [path_to_campaign_dir]

Defaults to tests/benchmark-campaign/ if no path provided.
"""

import re
import sys
from collections import namedtuple
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
PORTRAIT_TYPES = {"npc", "pc", "location", "faction", "organization", "item", "creature", "campaign_overview", "heritage"}

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
                frontmatter[current_key].append(line.strip()[2:].strip('"').strip("'"))
            continue

        # Key: value pair
        if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
            key, _, value = line.partition(":")
            key = key.strip()
            value = value.strip().strip('"').strip("'")

            # Handle empty value (might be start of array)
            if value == "" or value == "[]":
                frontmatter[key] = []
            else:
                frontmatter[key] = value
            current_key = key

    return frontmatter


def validate_file(filepath: Path) -> list[str]:
    """Validate a single markdown file. Returns list of errors."""
    errors = []

    try:
        content = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as e:
        return [f"Could not read file: {e}"]

    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        # No frontmatter is OK for some files
        return []

    entity_type = frontmatter.get("type", "")
    if not entity_type:
        errors.append("Missing 'type' field")
        return errors

    # Check required fields — reject unknown entity types
    if entity_type not in REQUIRED_FIELDS:
        errors.append(
            f"Unknown type '{entity_type}' — "
            f"must be one of: {', '.join(sorted(REQUIRED_FIELDS))}"
        )
        return errors
    required = REQUIRED_FIELDS[entity_type]
    for field in required:
        if field not in frontmatter:
            errors.append(f"Missing required field '{field}' for type '{entity_type}'")

    # Validate canon_status enum
    if "canon_status" in frontmatter:
        value = frontmatter["canon_status"]
        if not isinstance(value, str):
            errors.append("Field 'canon_status' must be a string")
        elif value not in CANON_STATUS_VALUES:
            errors.append(
                f"Invalid canon_status '{value}' — "
                f"must be one of: {', '.join(sorted(CANON_STATUS_VALUES))}"
            )
        elif value == "SUPERSEDED":
            superseded_by = frontmatter.get("superseded_by", "")
            if not superseded_by:
                errors.append(
                    "SUPERSEDED entity missing 'superseded_by' reference"
                )

    # Validate session status
    if entity_type == "session" and "status" in frontmatter:
        value = frontmatter["status"]
        if not isinstance(value, str):
            errors.append("Field 'status' must be a string")
        elif value not in SESSION_STATUS:
            errors.append(
                f"Invalid session status '{value}' — "
                f"must be one of: {', '.join(sorted(SESSION_STATUS))}"
            )

    # Validate scene fields
    if entity_type == "scene":
        if "status" in frontmatter:
            value = frontmatter["status"]
            if not isinstance(value, str):
                errors.append("Field 'status' must be a string")
            elif value not in SCENE_STATUS:
                errors.append(
                    f"Invalid scene status '{value}' — "
                    f"must be one of: {', '.join(sorted(SCENE_STATUS))}"
                )
        if "scene_type" in frontmatter:
            value = frontmatter["scene_type"]
            if not isinstance(value, str):
                errors.append("Field 'scene_type' must be a string")
            elif value not in SCENE_TYPES:
                errors.append(
                    f"Invalid scene_type '{value}' — "
                    f"must be one of: {', '.join(sorted(SCENE_TYPES))}"
                )

    # Validate NPC/PC status if present
    if entity_type in ("npc", "pc") and "status" in frontmatter:
        value = frontmatter["status"]
        if not isinstance(value, str):
            errors.append("Field 'status' must be a string")
        elif value not in NPC_STATUS:
            errors.append(
                f"Invalid status '{value}' — "
                f"must be one of: {', '.join(sorted(NPC_STATUS))}"
            )

    # Validate adventure-brief fields
    if entity_type == "adventure-brief":
        if "scope" in frontmatter:
            value = frontmatter["scope"]
            if not isinstance(value, str):
                errors.append("Field 'scope' must be a string")
            elif value not in ADVENTURE_BRIEF_SCOPE:
                errors.append(
                    f"Invalid scope '{value}' — "
                    f"must be one of: {', '.join(sorted(ADVENTURE_BRIEF_SCOPE))}"
                )
        if "continuation_type" in frontmatter:
            value = frontmatter["continuation_type"]
            if not isinstance(value, str):
                errors.append("Field 'continuation_type' must be a string")
            elif value not in ADVENTURE_BRIEF_CONTINUATION:
                errors.append(
                    f"Invalid continuation_type '{value}' — "
                    f"must be one of: {', '.join(sorted(ADVENTURE_BRIEF_CONTINUATION))}"
                )
        if "adventure_shape" in frontmatter:
            value = frontmatter["adventure_shape"]
            if not isinstance(value, str):
                errors.append("Field 'adventure_shape' must be a string")
            elif value not in ADVENTURE_BRIEF_SHAPE:
                errors.append(
                    f"Invalid adventure_shape '{value}' — "
                    f"must be one of: {', '.join(sorted(ADVENTURE_BRIEF_SHAPE))}"
                )

    # Validate campaign_overview fields
    if entity_type == "campaign_overview":
        if "status" in frontmatter:
            value = frontmatter["status"]
            if not isinstance(value, str):
                errors.append("Field 'status' must be a string")
            elif value not in CAMPAIGN_OVERVIEW_STATUS:
                errors.append(
                    f"Invalid status '{value}' — "
                    f"must be one of: {', '.join(sorted(CAMPAIGN_OVERVIEW_STATUS))}"
                )
        if "scope" in frontmatter:
            value = frontmatter["scope"]
            if not isinstance(value, str):
                errors.append("Field 'scope' must be a string")
            elif value not in ADVENTURE_BRIEF_SCOPE:
                errors.append(
                    f"Invalid scope '{value}' — "
                    f"must be one of: {', '.join(sorted(ADVENTURE_BRIEF_SCOPE))}"
                )

    # Validate world_domain status
    if entity_type == "world_domain" and "status" in frontmatter:
        value = frontmatter["status"]
        if not isinstance(value, str):
            errors.append("Field 'status' must be a string")
        elif value not in WORLD_DOMAIN_STATUS:
            errors.append(
                f"Invalid status '{value}' — "
                f"must be one of: {', '.join(sorted(WORLD_DOMAIN_STATUS))}"
            )

    # Validate plan fields
    if entity_type == "plan":
        if "plan_type" in frontmatter:
            value = frontmatter["plan_type"]
            if not isinstance(value, str):
                errors.append("Field 'plan_type' must be a string")
            elif value not in PLAN_TYPES:
                errors.append(
                    f"Invalid plan_type '{value}' — "
                    f"must be one of: {', '.join(sorted(PLAN_TYPES))}"
                )

    # Validate portrait field — only allowed for supported entity types
    portrait = frontmatter.get("portrait")
    if portrait:
        if not isinstance(portrait, str):
            errors.append("Field 'portrait' must be a string path")
        elif entity_type not in PORTRAIT_TYPES:
            errors.append(
                f"Field 'portrait' not allowed for type '{entity_type}' — "
                f"only supported for: {', '.join(sorted(PORTRAIT_TYPES))}"
            )
        elif not portrait.startswith("_attachments/"):
            errors.append(
                f"Invalid portrait path '{portrait}' — "
                f"must start with '_attachments/'"
            )

    # Deprecation errors for renamed fields (universal "*" + per-type)
    deprecated = DEPRECATED_FIELDS.get("*", []) + DEPRECATED_FIELDS.get(entity_type, [])
    for old_field, new_field, migration in deprecated:
        if old_field in frontmatter:
            errors.append(
                f"Deprecated field '{old_field}' — "
                f"rename to '{new_field}' (run migration {migration})"
            )

    return errors


# Content filtering rules — scenes that should be auto-excluded or auto-included
FILTERING_EXCLUDE_STATUSES = {"cut", "skipped"}
FILTERING_INCLUDE_STATUSES = {"played", "modified"}


def validate_filtering(campaign_dir: Path) -> int:
    """Validate that scene statuses map to correct filtering decisions."""
    errors = 0

    for filepath in sorted(campaign_dir.rglob("*.md")):
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue

        frontmatter = extract_frontmatter(content)
        if frontmatter is None:
            continue

        entity_type = frontmatter.get("type", "")
        if entity_type != "scene":
            continue

        status = frontmatter.get("status", "")
        rel_path = filepath.relative_to(campaign_dir)

        if status in FILTERING_EXCLUDE_STATUSES:
            print(f"  EXCLUDE {rel_path} (status: {status})")
        elif status in FILTERING_INCLUDE_STATUSES:
            print(f"  INCLUDE {rel_path} (status: {status})")
        elif status == "planned" or status == "ready":
            print(f"  EXCLUDE {rel_path} (prep status: {status})")
        else:
            print(f"  AMBIGUOUS {rel_path} (status: {status})")
            errors += 1

    return errors


# PC entity-sheet freshness
#
# session-wrapup advances each active PC's Story file and the campaign
# overview every session, but historically never the PC's own entity
# sheet — so `asOfSession` (and the published `## Current Status`) froze
# sessions behind the rest of the vault. This check flags active PC
# sheets whose `asOfSession` lags the campaign overview's.

StalePc = namedtuple("StalePc", ["name", "pc_asof", "campaign_asof"])
FreshnessResult = namedtuple(
    "FreshnessResult", ["stale", "campaign_asof", "unparseable", "checked", "reference"]
)

# A PC with one of these statuses is intentionally frozen at the session
# it left active play — died, or off-screen/missing — so staleness there
# is correct, not drift. `alive` and `unknown` PCs are checked.
FROZEN_PC_STATUSES = {"dead", "missing"}


def parse_session_ordinal(value: str | None) -> tuple[int, int] | None:
    """Parse an `asOfSession` label into a comparable (chapter, session) pair.

    Handles the mixed labelling real vaults accumulate as chapters
    renumber sessions: "Chapter 4, Session 3" -> (4, 3),
    "Session 10" -> (0, 10), "Chapter 2" -> (2, 0). A missing chapter
    sorts as chapter 0, so any bare "Session N" ranks below a later
    chapter. Returns None when neither a chapter nor a session number is
    present (unparseable — skipped rather than guessed).
    """
    if not isinstance(value, str):
        return None
    chapter = re.search(r"\bchapter\s*(\d+)", value, re.IGNORECASE)
    session = re.search(r"\bsession\s*(\d+)", value, re.IGNORECASE)
    if not chapter and not session:
        return None
    return (
        int(chapter.group(1)) if chapter else 0,
        int(session.group(1)) if session else 0,
    )


def find_stale_pcs(campaign_dir: Path) -> FreshnessResult:
    """Find active PC entity sheets lagging the campaign overview's asOfSession.

    Only `type: pc` sheets are inspected — never `character-story`
    companions or the `player-characters` digest. The check no-ops when
    there is no campaign overview asOfSession to compare against.
    """
    campaign_asof = None
    pcs = []  # (name, asOfSession, status)

    for filepath in sorted(campaign_dir.rglob("*.md")):
        # Skip template scaffolding — templates carry empty temporal
        # fields by design and are never "stale".
        if "_Templates" in filepath.parts or filepath.stem.startswith("_Template"):
            continue
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        frontmatter = extract_frontmatter(content)
        if frontmatter is None:
            continue
        entity_type = frontmatter.get("type", "")
        if entity_type == "campaign_overview":
            campaign_asof = frontmatter.get("asOfSession") or campaign_asof
        elif entity_type == "pc":
            pcs.append(
                (filepath.stem, frontmatter.get("asOfSession"), frontmatter.get("status"))
            )

    reference = parse_session_ordinal(campaign_asof)
    stale = []
    unparseable = []
    checked = 0

    if reference is None:
        # No usable campaign position — cannot judge freshness.
        return FreshnessResult([], campaign_asof, unparseable, checked, None)

    for name, pc_asof, status in pcs:
        if status in FROZEN_PC_STATUSES:
            continue
        pc_ordinal = parse_session_ordinal(pc_asof)
        if pc_ordinal is None:
            unparseable.append(name)
            continue
        checked += 1
        if pc_ordinal < reference:
            stale.append(StalePc(name, pc_asof, campaign_asof))

    return FreshnessResult(stale, campaign_asof, unparseable, checked, reference)


def validate_freshness(campaign_dir: Path) -> int:
    """Report stale PC entity sheets. Returns exit code (1 if any stale)."""
    result = find_stale_pcs(campaign_dir)

    if result.reference is None:
        print(
            "  No comparable campaign-overview asOfSession found — "
            "skipping PC freshness check."
        )
        return 0

    print(f"  Campaign position: asOfSession = {result.campaign_asof!r}")
    print(f"  Active PC sheets checked: {result.checked}")

    for name in result.unparseable:
        print(f"  WARN  {name}: unparseable asOfSession — skipped")

    for pc in result.stale:
        print(
            f"  STALE {pc.name}: asOfSession {pc.pc_asof!r} lags "
            f"campaign {pc.campaign_asof!r}"
        )

    return 1 if result.stale else 0


def validate_campaign(campaign_dir: Path) -> int:
    """Validate campaign entity schemas. Returns exit code."""
    md_files = list(campaign_dir.rglob("*.md"))

    if not md_files:
        print(f"Warning: No markdown files found in {campaign_dir}")
        return 0

    total_errors = 0
    files_with_errors = 0

    for filepath in sorted(md_files):
        errors = validate_file(filepath)
        if errors:
            files_with_errors += 1
            rel_path = filepath.relative_to(campaign_dir.parent) if campaign_dir.parent != Path(".") else filepath
            print(f"\n{rel_path}:")
            for error in errors:
                print(f"  - {error}")
                total_errors += 1

    print(f"\n{'='*50}")
    print(f"Validated {len(md_files)} files")

    if total_errors == 0:
        print("All schema checks passed!")
        return 0
    else:
        print(f"Found {total_errors} error(s) in {files_with_errors} file(s)")
        return 1


def main():
    mode = "campaign"
    campaign_dir = Path("tests/benchmark-campaign")

    args = sys.argv[1:]
    if args and args[0] == "filtering":
        mode = "filtering"
        campaign_dir = Path(args[1]) if len(args) > 1 else campaign_dir
    elif args and args[0] == "freshness":
        mode = "freshness"
        campaign_dir = Path(args[1]) if len(args) > 1 else campaign_dir
    elif args:
        campaign_dir = Path(args[0])

    if not campaign_dir.exists():
        print(f"Error: Directory not found: {campaign_dir}")
        sys.exit(1)

    if mode == "filtering":
        print(f"Filtering validation: {campaign_dir}")
        errors = validate_filtering(campaign_dir)
        if errors:
            print(f"\n{errors} ambiguous scene(s) found")
            sys.exit(1)
        else:
            print("\nAll scenes have deterministic filtering rules")
            sys.exit(0)
    elif mode == "freshness":
        print(f"PC freshness validation: {campaign_dir}")
        sys.exit(validate_freshness(campaign_dir))
    else:
        sys.exit(validate_campaign(campaign_dir))


if __name__ == "__main__":
    main()
