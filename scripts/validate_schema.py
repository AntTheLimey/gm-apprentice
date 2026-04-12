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
SESSION_STATUS = {"planned", "prepped", "played", "reviewed"}
SCENE_STATUS = {"planned", "ready", "played", "cut"}
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
    "session": ["type", "source_confidence", "session_number", "status"],
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
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
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
        if value not in SOURCE_CONFIDENCE:
            errors.append(
                f"Invalid source_confidence '{value}' — "
                f"must be one of: {', '.join(sorted(SOURCE_CONFIDENCE))}"
            )

    # Validate session status
    if entity_type == "session" and "status" in frontmatter:
        value = frontmatter["status"]
        if value not in SESSION_STATUS:
            errors.append(
                f"Invalid session status '{value}' — "
                f"must be one of: {', '.join(sorted(SESSION_STATUS))}"
            )

    # Validate scene fields
    if entity_type == "scene":
        if "status" in frontmatter:
            value = frontmatter["status"]
            if value not in SCENE_STATUS:
                errors.append(
                    f"Invalid scene status '{value}' — "
                    f"must be one of: {', '.join(sorted(SCENE_STATUS))}"
                )
        if "scene_type" in frontmatter:
            value = frontmatter["scene_type"]
            if value not in SCENE_TYPES:
                errors.append(
                    f"Invalid scene_type '{value}' — "
                    f"must be one of: {', '.join(sorted(SCENE_TYPES))}"
                )

    # Validate NPC/PC status if present
    if entity_type in ("npc", "pc") and "status" in frontmatter:
        value = frontmatter["status"]
        if value not in NPC_STATUS:
            errors.append(
                f"Invalid status '{value}' — "
                f"must be one of: {', '.join(sorted(NPC_STATUS))}"
            )

    # Validate portrait field — only allowed for supported entity types
    portrait = frontmatter.get("portrait")
    if portrait:
        if entity_type not in PORTRAIT_TYPES:
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


def main():
    # Determine campaign directory
    if len(sys.argv) > 1:
        campaign_dir = Path(sys.argv[1])
    else:
        campaign_dir = Path("tests/benchmark-campaign")

    if not campaign_dir.exists():
        print(f"Error: Directory not found: {campaign_dir}")
        sys.exit(1)

    # Find all markdown files
    md_files = list(campaign_dir.rglob("*.md"))

    if not md_files:
        print(f"Warning: No markdown files found in {campaign_dir}")
        sys.exit(0)

    # Validate each file
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

    # Summary
    print(f"\n{'='*50}")
    print(f"Validated {len(md_files)} files")

    if total_errors == 0:
        print("All schema checks passed!")
        sys.exit(0)
    else:
        print(f"Found {total_errors} error(s) in {files_with_errors} file(s)")
        sys.exit(1)


if __name__ == "__main__":
    main()
