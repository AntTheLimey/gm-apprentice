# Schema Change Procedure

How to add, modify, or remove fields from the vault entity
schema. Follow this checklist for every schema change — skipping
steps causes migration failures or silent data loss.

## When this applies

Any change to frontmatter fields that entity files use:
adding a new field, renaming a field, changing a field's type
(string → array), removing a field, or changing default values.

## Checklist

### 1. Design the field

- [ ] Choose the field name (snake_case, consistent with
  existing fields)
- [ ] Define the type: string, number, array, object, or
  union (e.g., string-or-array)
- [ ] Define the default value for new files
- [ ] Define what happens to existing files that lack the field
  (null/absent is fine, or migration backfills a value)
- [ ] If the field can hold multiple formats (e.g., single
  date string OR array of dates), document both forms and
  which code paths handle each

### 2. Update the vault template

- [ ] Edit the template in `_Templates/` in a test vault
  (or the user's vault if doing live work)
- [ ] Add the field with its default value in the correct
  position within the frontmatter block

### 3. Update the shared template

- [ ] Edit the corresponding template in
  `skills/shared/templates/` so new vaults get the field
- [ ] If no shared template exists for this entity type,
  consider whether one should be created

### 4. Update skill reference docs

- [ ] Update the relevant skill reference that documents
  the entity's schema. Common locations:
  - `session-prep/references/session-templates.md` — session
    and session-plan schemas
  - `campaign-organizer/references/event-template.md` — events
  - `campaign-organizer/references/` — other entity types
- [ ] Add a comment explaining the field's purpose, valid
  values, and which code consumes it

### 5. Update consuming code

- [ ] Update any publish tool code that reads the field
  (templates, build pipeline, data extractors)
- [ ] Update any skill logic that reads or writes the field
- [ ] Handle both old format (field absent) and new format
  gracefully — code must not crash on vaults that haven't
  migrated yet

### 6. Update schema validation

- [ ] If `scripts/validate_schema.py` validates the entity
  type, add the new field to the schema (required or optional
  as appropriate)
- [ ] Run validation against a test vault to confirm

### 7. Add migration entry

- [ ] Add an entry to `skills/shared/migrations.md` under
  the next version number
- [ ] Describe the change in the appropriate category:
  - **Structural** — field additions to vault-config or
    required scaffolding
  - **Content** — template updates, field additions to entity
    files (usually opt-in)
- [ ] For field additions: specify whether existing files
  should be backfilled (and with what value) or left as-is
- [ ] For field renames: specify the old→new mapping
- [ ] For field removals: specify whether the old field
  should be stripped from existing files

### 8. Update tests

- [ ] Update or add unit tests for any publish tool code
  that consumes the new field
- [ ] Ensure tests cover both the old format (field absent)
  and new format
- [ ] Run the full test suite

### 9. Version bump

- [ ] Bump the version in `.claude-plugin/plugin.json`
  (patch for field additions, minor for breaking changes)
- [ ] The `current_version` in `shared/migrations.md` is
  stamped automatically by `build-skill-zips.sh` from
  `plugin.json` — do not edit it manually
- [ ] Add a CHANGELOG entry describing the schema change

## Field design guidelines

- **Prefer optional fields** — new fields should default to
  null/empty so existing vaults work without migration
- **String-or-array unions** — when a field can be either a
  single value or a list, always normalize to array in
  consuming code. Document both forms in the template comment.
- **Date fields** — use ISO 8601 (`YYYY-MM-DD`). For ranges,
  use an array of two dates `[start, end]`. Code must handle
  both string and array.
- **Wiki-link fields** — quote them: `"[[Entity Name]]"`.
  Consuming code must strip `[[` and `]]` brackets.
