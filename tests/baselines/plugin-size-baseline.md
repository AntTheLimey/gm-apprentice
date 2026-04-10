# Plugin Size Baseline

**Date:** 2026-04-10
**Measured before:** shared-refs extraction

## Total Plugin

| Metric | Value |
|--------|------:|
| Total size | 1,179,717 bytes (1.18 MB) |
| Total files | 126 .md files |
| Token estimate | ~295K tokens (chars/4) |

## Per-Skill Breakdown

| Skill | Size (bytes) | Files | Tokens (est.) |
|-------|-------------:|------:|--------------:|
| ttrpg-expert | 1,096,291 | 114 | ~274K |
| session-lifecycle | 31,597 | 3 | ~7.9K |
| campaign-qa | 28,253 | 3 | ~7.1K |
| campaign-organizer | 23,576 | 6 | ~5.9K |

## Files Being Replaced (shared-refs extraction)

| File | Size (bytes) |
|------|-------------:|
| campaign-organizer/references/ontology-reference.md | 7,258 |
| ttrpg-expert/entity-types.md | 6,086 |
| campaign-organizer/references/vault-structure.md | 1,343 |
| campaign-organizer/references/filesystem-mode.md | 1,263 |
| **Total replaced** | **15,950** |

Post-refactor, `skills/shared/` should be smaller than 15,950
bytes (deduplication savings) while the four replaced files are
removed.
