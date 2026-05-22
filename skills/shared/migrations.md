---
# Stamped from plugin.json by build-skill-zips.sh — do not edit manually
current_version: "1.5.1"
---

# Vault Migration Registry

Each vault-aware skill reads `current_version` from this file
and compares it to `gm_apprentice_version` in the vault's
`_meta/vault-config.md`. When the vault version is lower or
absent, campaign-organizer's migration workflow runs before the
skill proceeds.

When adding a new migration entry: bump `current_version` in
the frontmatter to match, and add the entry in ascending version
order at the end of this file.

## How migrations work

Each entry lists changes in three categories:

- **Structural** — applied automatically after user confirms the
  preview (fields, folders, scaffolding)
- **Content** — opt-in per item (templates, story files, anything
  in the user's content space)
- **Tooling** — opt-in (npm package updates, external tool
  changes)

The migration procedure diff-checks each step against the vault's
current state. Steps already satisfied are skipped. See
`campaign-organizer/references/migration-procedure.md` for the
full workflow.

## Migration: Baseline (pre-versioning → 1.4.9)

Applies to any vault with no `gm_apprentice_version` field or
a version below 1.4.9. This is the catch-up migration for all
vaults created before the versioning system existed.

### Structural

- Add `gm_apprentice_version: "1.4.9"` to `_meta/vault-config.md`
  frontmatter
- Add `publish.system` to vault-config if absent (read from
  campaign context or ask the user which game system this
  campaign uses)
- Add `publish.site_dir` to vault-config if the user uses the
  publish tool (ask for the absolute path to the site repo
  directory; skip if user doesn't use the publish tool)
- Ensure all four `_meta/` files exist: `vault-config.md`,
  `entity-types.md`, `relationship-types.md`, `index.md`

### Content

- Copy any missing PC templates from `shared/templates/` to the
  vault's `_Templates/` directory. List each template by name
  and let the user choose which to add:
  - `pc-generic.md`
  - `pc-coc-7e.md`
  - `pc-coc-7e-regency.md`
  - `pc-dnd-5e-2024.md`
  - `pc-gurps-4e.md`
  - `pc-fitd.md`
  - `crew-fitd.md`
  - `character-story.md`
- For templates that already exist in `_Templates/` but differ
  from the `shared/templates/` version: offer to overwrite,
  noting that local customizations will be lost
- Create `{Name}_Story.md` companion files for any PCs that
  lack them, using `shared/templates/character-story.md` as the
  template. List each PC and let the user choose which to create.

### Tooling

- If `publish.site_dir` is set in vault-config: check the
  installed `gm-apprentice-publish` version in
  `{site_dir}/node_modules/gm-apprentice-publish/package.json`.
  If lower than 1.1.1, offer to run
  `npm update gm-apprentice-publish` in the site directory.

## Migration: 1.4.10

No vault schema changes. Version stamp only.

## Migration: 1.4.11

No vault schema changes. Version stamp only.

## Migration: 1.4.12

No vault schema changes. Version stamp only.

## Migration: 1.4.13

No vault schema changes. Version stamp only.

## Migration: 1.4.14

No vault schema changes. Version stamp only.

## Migration: 1.4.15

No vault schema changes. Version stamp only.

## Migration: 1.4.16

No vault schema changes. Version stamp only.

## Migration: 1.4.17

No vault schema changes. Version stamp only.

## Migration: 1.4.18

No vault schema changes. Version stamp only.

## Migration: 1.4.19 → 1.4.20

### Content

- **Session template:** Add optional `in_game_date` field after
  `actual_date`. Accepts a single ISO date string or an array of
  ISO date strings for multi-day/time-jump sessions. Existing
  sessions without the field continue to work — consuming code
  treats absent as "no in-game date recorded."

### Tooling

- **Publish tool:** Timeline now reads `in_game_date` from sessions
  to place them on the in-game chronological timeline. Sessions
  without `in_game_date` are excluded from the timeline.

## Migration: 1.4.21 → 1.4.22

Standardizes date field names across session and event entities.

### Structural

- **Event entity files** (files with `type: event`): rename
  frontmatter field `date:` → `in_game_date:`. Value is unchanged —
  this is a key rename only.
- **Session entity files** (files with `type: session`): rename
  `planned_date:` → `play_date:`. If both `planned_date` and
  `actual_date` exist, use the value of `actual_date` as `play_date`
  (the actual played date takes precedence); otherwise use whichever
  exists. Remove `actual_date:` after migration.

### Content

- **Session wrap-up files**: standardize `type:` to `session_wrap`
  (from any of: `session-wrap-up`, `session_wrap_up`, `session_note`).
  Opt-in per file — review before applying.

## Migration: 1.4.22 → 1.5.1

### Structural

- **New entity type:** `adventure-brief` added to entity schema
  under `narrative (abstract)`. No vault changes required — the
  type is available for new files immediately. Existing vaults
  continue to work without modification.

### Content

- **New folder:** `Adventures/` added to default folder mapping
  for `adventure-brief` entities. Created automatically when the
  midwife writes its first adventure brief. No action needed for
  existing vaults.

- **New workspace folder:** `_midwife/` added to vault
  structure for midwife working files. Created automatically
  on first midwife invocation. No action needed for existing
  vaults.

- **Adventures/ subfolder convention:** Adventure briefs
  now use per-adventure subdirectories
  (`Adventures/{name}/{name}.md`). Existing briefs in flat
  `Adventures/` continue to work. No action needed for
  existing vaults.

## Migration: 1.5.3 → 1.6.0

### Structural

- **New entity type:** `heritage` added to entity schema under
  `world (abstract)`. Existing vaults continue to work without
  modification.
- **New structural types:** `world_domain` and `world_flags`
  added to entity schema. These are structural files in `_World/`,
  not knowledge-graph entities.
- **New field:** `part_of` added to faction and organization
  entity types. Optional — existing entities are unaffected.
- **New universal field:** `era` added as optional field for
  temporal referencing. Existing entities are unaffected.

### Content

- **New folder:** `_World/` added to vault structure with
  `world-index.md` and `_flags.md` stubs. Created during vault
  scaffolding. Individual domain files created on demand.
- **New folder:** `Heritages/` added to entity folder structure
  for heritage entities.
- **New templates:** `heritage.md`, `faction.md`, `world-index.md`,
  `world-flags.md`, `world-domain.md` added to
  `skills/shared/templates/`.
