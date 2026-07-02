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
never write them.

## Repairing Legacy Keys

This is the single authoritative repair algorithm. The 1.8.0
migration sweep, campaign-qa's Legacy Canon Field Repair check,
and any skill touching a file with a legacy key all apply it.

**Never blind-rename a key** — many files carry BOTH a legacy
key and `canon_status`, and a rename would leave duplicate
`canon_status:` lines (YAML parsers then silently keep one,
which can flip the entity's status). Apply exactly one case:

1. Legacy key only, no `canon_status` → rename the key to
   `canon_status`, value unchanged
2. Legacy key(s) AND `canon_status`, values all agree → delete
   the legacy line(s), keeping the single existing `canon_status`
3. Legacy key(s) AND `canon_status`, values disagree → keep the
   `canon_status` value, delete the legacy line(s), and surface
   the file to the GM with both values to confirm or correct

After repairing, the file must contain exactly one
`canon_status:` line.

## Companion Reference

For detailed conflict detection rules, source tracking,
and the full promotion workflow, read:
`ttrpg-expert/canon-management.md`
