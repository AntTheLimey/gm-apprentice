# Canon Status

Quick reference for the canon status states used across all
campaign entity files. For the full conflict detection and
resolution workflow, see `ttrpg-expert/canon-management.md`.

## The States

| State | Meaning | When to Use |
|-------|---------|-------------|
| DRAFT | Initial entry, not yet confirmed by GM | New entities from play notes, prep content, AI-generated content |
| AUTHORITATIVE | Confirmed as canon by the GM | GM has reviewed and approved the content |
| SUPERSEDED | Replaced by newer information | A retcon, timeline correction, or updated version exists |
| STUB | Mentioned but not yet described | Placeholder awaiting real content |

## Rules

- New content always starts as **DRAFT**
- The GM promotes DRAFT → AUTHORITATIVE by reviewing the vault
- When facts change, mark old content **SUPERSEDED** (don't delete)
- SUPERSEDED entries retain a `superseded_by` reference
- On conflicts between entries, surface the conflict to the GM — never silently resolve

## The `canon_status` Field

Every entity frontmatter includes:

```yaml
canon_status: DRAFT    # AUTHORITATIVE | SUPERSEDED | STUB
```

`canon_status` is the only correct field name. Two legacy names
(`source_confidence` and `confidence`) may appear in vaults that
haven't run the 1.8.0 migration — read them as equivalent, but
never write them. When you touch a file carrying a legacy name,
rename the key to `canon_status` as part of the edit.

## Companion Reference

For detailed conflict detection rules, source tracking,
and the full promotion workflow, read:
`ttrpg-expert/canon-management.md`
