---
# Stamped from plugin.json by build-skill-zips.sh — do not edit manually
current_version: "1.7.5"
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

## Migration: 1.6.6 → 1.7.0

### Structural

- **New entity type:** `plan` added to entity schema under
  `narrative (abstract)`, alongside `event` and `clue`.
  Existing vaults continue to work without modification.
- **New field:** `plan_type` on plan entities — values:
  `arc`, `scene`, `investigation`, `timeline`.
- **New fields:** `participants` and `locations` on plan
  entities — wiki-link arrays pointing to existing vault
  entities.
- **New relationship types:** `leads_to`, `precedes`,
  `alternative_to` added to relationship ontology for
  expressing sequencing, causation, and branching between
  plan entities.

### Content

- **New folder:** `Planning/` added to chapter directory
  structure. Created during chapter scaffolding (Midwife
  Phase 4 handoff) or on demand by campaign-organizer.
  Not backfilled — existing chapters are unaffected until
  the GM creates plans.
- **New template:** `plan.md` added to
  `skills/shared/templates/`.
- **Existing `_midwife/` content** is NOT auto-promoted.
  The GM decides if/when to bring old Midwife output into
  the vault using the new structure.

## Migration: 1.7.3 → 1.7.4

### Content

- **New canonical PC section:** `## Current Status` added to the
  PC body skeleton (`shared/entity-schema.md`) and to all six
  `pc-*` templates. It is a player-facing, skill-maintained block
  holding the PC's cumulative living state in **labelled fields**
  (`Location`, `Condition`, `Carrying`, `Open threads`,
  `Knows (exclusive)`) with an optional prose lede. Not backfilled
  and no GM action required — existing PC sheets without the section
  gain it automatically on their next wrap-up (the step creates it
  if absent), and sheets that already carry a hand-written
  `## Current Status` are reconciled in place.
- **session-wrapup now refreshes PC entity sheets** (Step 3c):
  each active PC's `asOfSession`, `lastUpdated`, chapter `tags`,
  and `## Current Status` advance every session. The status block
  is reconciled cumulatively — unresolved `Open threads` carry
  forward across sessions, new ones are added, resolved ones
  removed — so the published character page no longer drifts behind
  the Story file and campaign overview. No vault changes are
  required; the refresh happens during normal wrap-up.

## Migration: 1.7.10 → 1.8.0

Standardizes the canon-status field name to `canon_status`
across the entire vault. Three names for the same field
accumulated across plugin versions (`canon_status`,
`source_confidence`, `confidence`); `canon_status` is now the
only correct name. Skills and the publish tool write and
require `canon_status` exclusively.

### Structural

- **Vault-wide frontmatter sweep** — every `.md` file in the
  vault, including `_Templates/` and `_meta/`. For each file
  whose frontmatter contains `source_confidence:` or
  `confidence:`, apply exactly one of these repairs. **Never
  blind-rename a key: many files carry BOTH a legacy key and
  `canon_status`, and a rename would leave duplicate
  `canon_status:` lines. Always check for an existing
  `canon_status` first:**
  - Legacy key only, no `canon_status` present → rename the
    key to `canon_status`, value unchanged
  - Legacy key(s) AND `canon_status` present, values all agree
    → delete the legacy key line(s), keeping the single
    existing `canon_status`
  - Legacy key(s) AND `canon_status` present, values disagree
    → keep the `canon_status` value, delete the legacy
    line(s), and list the file in the migration report with
    both values for GM review
  - After the sweep, verify no file contains more than one
    `canon_status:` line
- **`_meta/entity-types.md`:** if the registry documents the
  canon field under a legacy name, update the field name to
  `canon_status` (values unchanged)
- **`_Templates/` key rename:** covered by the sweep above —
  the field key is renamed in place, so local template
  customizations are preserved

### Tooling

- **Publish tool:** `gm-apprentice-publish` ≥ 1.4.0 treats
  `canon_status` as canonical (legacy names still honored at
  read time, so an unmigrated vault publishes correctly). If
  `publish.site_dir` is set in vault-config, offer to run
  `npm update gm-apprentice-publish` in the site directory.
