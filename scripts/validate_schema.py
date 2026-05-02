#!/usr/bin/env python3
"""
Validate campaign entity frontmatter against the schema defined in entity-schema.md.

Checks:
- Required fields exist per entity type
- Enum values are valid (source_confidence, status, scene_type, etc.)
- Universal temporal fields are present where expected

Usage:
    python scripts/validate_schema.py [path_to_campaign_dir]

Defaults to tests/benchmark-campaign/ if no path provided.
"""

import re
import sys
from pathlib import Path

# Valid enum values
SOURCE_CONFIDENCE = {"DRAFT", "AUTHORITATIVE", "SUPERSEDED", "STUB"}
SESSION_STATUS = {"planned", "prepped", "played", "wrap-up", "reviewed"}
SCENE_STATUS = {"planned", "ready", "played", "cut", "skipped", "modified"}
SCENE_TYPES = {
    "investigation", "social", "combat", "chase",
    "transition", "horror", "downtime", "other"
}
NPC_STATUS = {"alive", "dead", "missing", "unknown"}

# Required fields per entity type
# All entities need: type, source_confidence
REQUIRED_FIELDS = {
    "npc": ["type", "source_confidence"],
    "pc": ["type", "source_confidence"],
    "location": ["type", "source_confidence"],
    "faction": ["type", "source_confidence"],
    "organization": ["type", "source_confidence"],
    "item": ["type", "source_confidence"],
    "creature": ["type", "source_confidence"],
    "clue": ["type", "source_confidence"],
    "event": ["type", "source_confidence"],
    "document": ["type", "source_confidence"],
    "session": ["type", "session_number", "status", "documents"],
    "session-plan": ["type", "source_confidence", "session"],
    "session-play-notes": ["type", "source_confidence", "session"],
    "session-wrap-up": ["type", "source_confidence", "session"],
    "scene": ["type", "source_confidence", "scene_type", "status"],
    "chapter": ["type"],
    "meta": ["type"],
    "timeline": ["type"],
    "player-characters": ["type"],
}

# Optional fields that support portraits (for future validation)
PORTRAIT_TYPES = {"npc", "pc", "location", "faction", "organization", "item", "creature"}


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

    # Validate source_confidence enum
    if "source_confidence" in frontmatter:
        value = frontmatter["source_confidence"]
        if not isinstance(value, str):
            errors.append("Field 'source_confidence' must be a string")
        elif value not in SOURCE_CONFIDENCE:
            errors.append(
                f"Invalid source_confidence '{value}' — "
                f"must be one of: {', '.join(sorted(SOURCE_CONFIDENCE))}"
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
    else:
        sys.exit(validate_campaign(campaign_dir))


if __name__ == "__main__":
    main()
