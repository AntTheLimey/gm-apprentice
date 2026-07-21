---
# Stamped from plugin.json by build-skill-zips.sh — do not edit manually
current_version: "1.8.15"
---

# Vault Migration Registry

Each vault-aware skill reads `current_version` from this file
and compares it to `gm_apprentice_version` in the vault's
`_meta/vault-config.md`. When the vault version is lower or
absent, campaign-organizer's migration workflow runs before the
skill proceeds.

When adding a new migration entry: bump `version` in
`.claude-plugin/plugin.json` and add the entry in ascending
version order at the end of this file. `current_version` in the
frontmatter above is stamped automatically from `plugin.json` by
`build-skill-zips.sh` at build time — do not edit it by hand.

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

### Schema Mirror Sync (runs on every pass)

`_meta/entity-types.md` mirrors `shared/entity-schema.md`'s
Type-Specific Fields section into each vault, so entities can be
authored and validated without reading plugin source. Unlike
`_Templates/` — which every migration re-diffs against
`shared/templates/` — this file's type-specific content had no
recurring check: a migration could rename or add a field (the
Event `date` → `in_game_date` rename in 1.4.22 is the known
example) and the vault's own copy of the schema documentation
would drift out of sync with the data it describes, forever,
because no later migration ever revisited it.

Every migration pass now diffs the vault's `_meta/entity-types.md`
Type-Specific Fields entries against the canonical ones in
`shared/entity-schema.md`, for every built-in type — regardless of
which versioned migration entries are pending. Missing or stale
entries are offered as opt-in Content items, the same way stale
templates are. Vault-only entries (custom/evolved types from
Schema Evolution) are never touched. See
`migration-procedure.md` Step 3 for the mechanics.

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
  - `pc-pf2e.md`
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
  plan entities. **(Superseded by the 1.8.38 → 1.8.39
  migration below — these are narrative flow, not graph
  predicates, and are removed from the relationship vocabulary.)**

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
  `confidence:`, apply the repair algorithm in
  `shared/canon-status.md` § Repairing Legacy Keys. **Never
  blind-rename a key** — many files carry BOTH a legacy key
  and `canon_status`; the algorithm collapses duplicates and
  keeps the `canon_status` value on conflicts, listing each
  conflicted file in the migration report with both values for
  GM review. After the sweep, verify no file contains more
  than one `canon_status:` line
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

## Migration: 1.8.0 → 1.8.2

Two fixes to the same underlying gap: things in a vault that
should stay in sync with each other, or unique across a growing
campaign, but that nothing was ever checking.

### Structural

- **Wrap-Up filename disambiguation** — Session Wrap-Up
  filenames change from `Session_NN_Wrap_Up.md` to
  `Chapter_CC_Session_NN_Wrap_Up.md`. The old pattern has no
  chapter marker, so two chapters reaching the same session
  number produce identically-named files — Obsidian resolves
  bare wikilinks by basename, so every `[[Session_NN_Wrap_Up]]`
  link in the vault becomes ambiguous the moment that happens.
  Rename every existing Wrap-Up file to the new pattern (chapter
  number read from the session index's `chapter:` field) and
  rewrite every reference to it vault-wide: each session index's
  `documents.wrap_up` field (unambiguous — sourced from that
  index's own chapter), and any other bare
  `[[Session_NN_Wrap_Up]]` link found in body text or
  frontmatter (resolved by the containing file's own
  chapter/session context; if undeterminable under a live
  collision, list it for GM review rather than guessing). This is
  a pure rename + relink — file contents are otherwise untouched,
  so it applies automatically after preview confirmation like
  other structural changes.

### Content

- **Event field rename backfill** — vaults that went through the
  1.4.22 migration had the Event entity field renamed
  (`date:` → `in_game_date:`) on every entity file, but
  `_meta/entity-types.md`'s Event entry was never updated to
  match and may still show the old field name. Offered via
  Schema Mirror Sync.
- **`character-story` field block backfill** — `character-story`
  has been a fully specified type since the Story Companion
  Convention was introduced, but no migration ever added its
  entry to `_meta/entity-types.md`. Vaults with PC Story files
  are missing it from their schema mirror. Offered via Schema
  Mirror Sync.
- **`plan` / `heritage` / `world_domain` / `world_flags` field
  block backfill** — these types have templates and are in
  active use, but `shared/entity-schema.md`'s Type-Specific
  Fields summary itself never carried compact entries for them
  until this release. Vaults predating each type's introduction
  are missing the corresponding entry. Offered via Schema Mirror
  Sync.

## Migration: 1.8.2 → 1.8.3

Standardizes GM-only content hiding onto two primitives — a single
`## GM Notes` container heading and the existing `<!-- gm-only -->`
inline fence — replacing the exact-heading-string-list approach that
can't generalize past whatever's already been manually added to it.
Also introduces `<!-- spoiler -->` for narrative content that's only
hidden until revealed in play, not permanently secret.

### Structural

- **GM-only heading re-nesting** — every heading in the vault's own
  `_meta/vault-config.md` `exclude_sections` list gets re-nested as a
  `###` subsection under one `## GM Notes` heading per file (creating
  it where absent), and the vault's `exclude_sections` list collapses
  down to `["GM Notes"]` once everything's been moved. This is a pure
  structural move — no content is added, removed, or reworded, only
  relocated and demoted a heading level — so it applies automatically
  after preview confirmation like other structural changes.

### Content

- **Bold-wrapped and bold-paragraph GM-only content** — headings like
  `### **Keeper Notes**` and bold-paragraph lines like `**Keeper
  Notes:**` with no heading marker at all defeat exact-string
  matching against the vault's `exclude_sections` list even though
  they're clearly meant to be hidden. Offered as opt-in Content items
  since converting a bold-paragraph line into a real heading needs a
  GM to confirm where the section actually ends.
- **Callout-only-marked content** — an Obsidian callout (`>
  [!info] Keeper Only`, etc.) with no heading or fence protection at
  all. Offered as opt-in Content items — there's no automatic signal
  for whether it should become `## GM Notes` or a time-locked
  `<!-- spoiler -->`, so the GM decides per item.

### Tooling

- **Publish tool:** `gm-apprentice-publish` gains `<!-- spoiler -->`
  support and the `exclude_fields` union-merge fix (previously
  `exclude_sections`/`exclude_dirs` only). If `publish.site_dir` is
  set in vault-config, offer to run `npm update gm-apprentice-publish`
  in the site directory.

## Migration: 1.8.3 → 1.8.9

### Content

- **GURPS Current Status gains an optional `**Enc:**` field** —
  the GURPS PC template's `## Current Status` block adds
  `**Enc:** {level}` (e.g. `Light (1)`), and the publish tool
  (1.5.1) uses it to highlight the current row of the sheet's
  Encumbrance table. Alternatively a trailing `*` on the table's
  Level cell marks the row explicitly. Opt-in per PC: sheets that
  already carry an `Enc:` line light up on the next site build
  with no edit; others gain the line at the GM's discretion or at
  the next wrap-up refresh. No other vault changes.

### Tooling

- **Publish tool:** `gm-apprentice-publish` 1.5.1 flags the
  current encumbrance row from plain markdown tables (explicit
  Level-cell marker, else the Current Status `Enc:` value matched
  by level name or number). If `publish.site_dir` is set in
  vault-config, repoint the site's `file:` pin to the plugin-cache
  copy at ≥1.8.9 (tool ≥1.5.1) and rebuild.

## Migration: 1.8.11 → 1.8.12

### Structural

- **GURPS PC Skills table: `Effective` → `Base`, new `Current`
  column** — the Skills table header becomes
  `| Name | Difficulty | Relative Level | Points | Base | Current |`.
  `Base` is the old `Effective` value renamed (unencumbered level).
  `Current` is appended and initialized to `Base`, then reconciled
  during the migration pass: for Climbing, Stealth, Swimming, Judo,
  and Karate (B17, B203), subtract the sheet's declared `Enc:`
  level unless a perk such as Armor Familiarity (MA49) offsets it —
  the model applies perk/Talent context; the checker never does.
  Old-format sheets keep working unmigrated: `gurps_check.py` reads
  `Effective` as Base, and the publish tool falls back the same way.

### Tooling

- **Publish tool:** `gm-apprentice-publish` 1.6.1 renders `Current`
  as the displayed skill level with `base N` alongside when they
  differ, and renders old-format sheets unchanged. If
  `publish.site_dir` is set in vault-config, offer to run
  `npm update gm-apprentice-publish` in the site directory.

## Migration: 1.8.12 → 1.8.38

Two publish features shipped their renderers without a migration to
teach existing sheets the structure they parse, so pre-existing PCs
silently render incomplete. Both are opt-in per PC — the renderers are
resilient and never crash, they just drop the unparsed content — so
these are flags-and-conversions the GM confirms, not automatic rewrites.

### Content

- **GURPS Load-Outs section** — the GURPS PC renderer turns a
  `### Load-Outs` (or `### Loadouts`) subsection under `## Equipment`
  into toggleable, encumbrance-recomputing gear groups
  (`defaultCarried: false`). Sheets authored before the feature use
  ad-hoc sections instead (`## Station-Issue Equipment (Returnable)`,
  `### Optional Loadout`, a second `## Equipment` variant, etc.), and
  the parser only matches the exact `Load-Outs`/`Loadouts` titles, so
  that gear silently never appears as a toggle. Detect equipment-like
  sections on a GURPS PC that are neither the main `## Equipment` table
  nor a `### Load-Outs`/`### Loadouts` subsection, and offer to convert
  each to a `### Load-Outs` subsection (a `**Name**` bold heading
  immediately followed by an `Item`/`Weight`/`Cost` table, no bold
  before the first heading or inside table cells) — or flag it for the
  GM if the intent is ambiguous. The documented template now carries a
  worked `### Load-Outs` example (`shared/templates/pc-gurps-4e.md`).
  Opt-in per PC; no frontmatter change. (#106)
- **CoC investigator-sheet body structure** — the CoC 7e renderer reads
  the markdown body in the structure documented at
  `docs/file-format-standards.md §8` (`## Stat Sheet` →
  `### Characteristics`/`### Derived`/`### Reputation`/`### Combat`/
  `### Status`, `## Skills`, `## Combat`, `## Equipment` + Record prose).
  It normalizes skill-name variance and injects the canonical skill
  list, so most drift renders fine, but a sheet whose section/subsection
  titles diverge (or that stored characteristics/skills in frontmatter
  for the old renderer) parses to a near-empty model and renders mostly
  blank. The publish tool now warns at build time when a CoC PC parses
  no characteristics; for each flagged sheet, offer to convert it to the
  documented structure (the shipped `pc-coc-7e.md` / `pc-coc-7e-regency.md`
  templates are the target) or flag it for the GM. Opt-in per PC. (#107)

### Tooling

- **Publish tool:** `gm-apprentice-publish` 1.11.14 hardens the GURPS
  load-out-name parser (bold inside a load-out table cell can no longer
  be mistaken for a load-out name) and emits a build-time warning for a
  CoC PC that parses no characteristics. If `publish.site_dir` is set in
  vault-config, offer to run `npm update gm-apprentice-publish` in the
  site directory.

## Migration: 1.8.38 → 1.8.39

Resolves the long-open Sequencing question. `leads_to`, `precedes`, and
`alternative_to` were added as relationship predicates in 1.7.0, but they
are **not** graph edges — they are narrative flow. This reverses that
addition so the relationship vocabulary is single-sourced from
`shared/entity-schema.md` and enforced by `scripts/validate_ontology.py`.

### Content

- **Remove the Sequencing predicates from the vault vocabulary** — drop
  the `Sequencing` category (`leads_to`, `precedes`, `alternative_to`)
  from `_meta/relationship-types.md`; it is not in the authoritative
  schema, so a vault carrying it is a superset, not a subset. Then
  convert any existing edges that used them:
  - `leads_to` on a **clue** → the clue's `leads_to` *frontmatter field*
    (clue-to-clue flow lives there, per the Clue schema).
  - `precedes` / `alternative_to` between **plans** → express in the
    plan's narrative body (which plan follows or forks from which); do
    not store as a `relationships:` edge.
  - Report each converted edge; never silently drop graph data.
  Opt-in per vault. `campaign-qa` graph-health now flags these as
  off-vocabulary until converted.
