# Canon Confidence

Quick reference for the three canon confidence states used
across all campaign entity files. For the full conflict
detection and resolution workflow, see
`ttrpg-expert/canon-management.md`.

## The Three States

| State | Meaning | When to Use |
|-------|---------|-------------|
| DRAFT | Initial entry, not yet confirmed by GM | New entities from play notes, prep content, AI-generated content |
| AUTHORITATIVE | Confirmed as canon by the GM | GM has reviewed and approved the content |
| SUPERSEDED | Replaced by newer information | A retcon, timeline correction, or updated version exists |

## Rules

- New content always starts as **DRAFT**
- The GM promotes DRAFT → AUTHORITATIVE by reviewing the vault
- When facts change, mark old content **SUPERSEDED** (don't delete)
- SUPERSEDED entries retain a `superseded_by` reference
- On conflicts between entries, surface the conflict to the GM — never silently resolve

## The `source_confidence` Field

Every entity frontmatter includes:

```yaml
source_confidence: DRAFT    # or AUTHORITATIVE or SUPERSEDED
```

Some vaults use `canon_status` instead — treat them as equivalent.

## Companion Reference

For detailed conflict detection rules, source tracking,
and the full promotion workflow, read:
`ttrpg-expert/canon-management.md`
