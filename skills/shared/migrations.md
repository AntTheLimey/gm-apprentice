---
# Stamped from plugin.json by build-skill-zips.sh — do not edit manually
current_version: "1.4.15"
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
