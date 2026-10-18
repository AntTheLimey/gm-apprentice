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

# Schema rules and the frontmatter parser are shared with the
# plugin-bundled vault utility — single source of truth in
# skills/shared/scripts/schema_rules.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent
                        / "skills" / "shared" / "scripts"))
from schema_rules import (  # noqa: E402
    REQUIRED_FIELDS,
    extract_frontmatter,
    frontmatter_findings,
    is_schema_type,
)
import vault_check  # noqa: E402
from vaultlib import raw_frontmatter, setting_or_builtin  # noqa: E402


def validate_file(filepath: Path, content: str | None = None,
                  vault: Path | None = None) -> list[str]:
    """Validate a single markdown file. Returns list of errors.

    Pass `content` when the caller has already read the file, so a run
    that applies several checks reads each note exactly once. With `vault`,
    a field that also takes a setting's words (a PC's status) reads them
    from the vault's settings through the publish tool.
    """
    if content is None:
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as e:
            return [f"Could not read file: {e}"]

    frontmatter = extract_frontmatter(content)
    if frontmatter is None:
        # No frontmatter is OK for some files
        return []

    # The rules are schema_rules.frontmatter_findings, which the vault's own
    # check (vault_check.py frontmatter) asks too. One difference: this
    # validator guards the repo's fixtures, where a type the schema does not
    # name is a typo, not a GM's custom type.
    entity_type = frontmatter.get("type")
    if entity_type and isinstance(entity_type, str) and not is_schema_type(entity_type):
        return [f"Unknown type '{entity_type}' — must be one of: "
                f"{', '.join(sorted(REQUIRED_FIELDS))}, or a subtype in the ontology"]
    setting = None if vault is None else (lambda name: setting_or_builtin(vault, name))
    return [message for level, message
            in frontmatter_findings(frontmatter, setting, raw_frontmatter(content))
            if level == "ERROR"]


def relationship_rows(campaign_dir: Path) -> dict[str, list[str]]:
    """Every relationship rule, as the publish tool checks it, by note.

    The tool (`gm-publish.js relationships check`) is the one place the
    rules live; this asks it through vault_check and keeps the ERROR and
    WARNING rows (INFO rows are notes, not defects). A tool that cannot
    answer is an ERROR row under `(vault)`, never a clean result. The
    benchmark vault is clean of every kind, so every kind counts.
    """
    found: dict[str, list[str]] = {}
    for row in vault_check.check_relationships(campaign_dir):
        level, where, message = row.split("\t", 2)
        if level not in ("ERROR", "WARNING"):
            continue
        rel, _, line = where.rpartition(":")
        if not rel:
            rel, line = where, ""
        text = f"Line {line}: {message}" if line.isdigit() else message
        found.setdefault(rel, []).append(text)
    return found


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
    companions or the `pc_roster` digest. The check no-ops when
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

    relationships = relationship_rows(campaign_dir)

    total_errors = 0
    files_with_errors = 0

    for filepath in sorted(md_files):
        # One read per note, shared by every check below.
        try:
            content = filepath.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as e:
            errors = [f"Could not read file: {e}"]
        else:
            errors = (validate_file(filepath, content, campaign_dir)
                      + relationships.pop(
                          filepath.relative_to(campaign_dir).as_posix(), []))
        if errors:
            files_with_errors += 1
            rel_path = filepath.relative_to(campaign_dir.parent) if campaign_dir.parent != Path(".") else filepath
            print(f"\n{rel_path}:")
            for error in errors:
                print(f"  - {error}")
                total_errors += 1

    # Rows about no note on disk (the tool could not answer, or a note
    # that vanished mid-run) are still defects.
    for where, rows in sorted(relationships.items()):
        files_with_errors += 1
        print(f"\n{where}:")
        for error in rows:
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
