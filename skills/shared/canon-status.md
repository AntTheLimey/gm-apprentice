# Canon Status

The canon states used in every entity file. Conflict detection,
source tracking and the promotion workflow:
`ttrpg-expert/canon-management.md`.

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

```yaml
canon_status: DRAFT    # AUTHORITATIVE | SUPERSEDED | STUB
```

`canon_status` is the only name to write. Read the legacy names
`source_confidence` and `confidence` as equivalent.

## Repairing Legacy Keys

Run `stamp_entities.py <vault> --repair-canon [--write]`; the
cases below are its specification, and apply by hand to any file
you touch that carries a legacy key.

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
