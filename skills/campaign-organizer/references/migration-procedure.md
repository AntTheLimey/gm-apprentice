# Vault Migration Procedure

Upgrades a vault to the current plugin version. Runs when
`vault_check.py <vault> version` returns `MISMATCH`, whether
campaign-organizer found it or another skill handed off.

## Step 1: Gather state

- **Vault version:** `gm_apprentice_version` in
  `_meta/vault-config.md` frontmatter (absent = pre-versioning).
- **Plugin version:** `version` in
  `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`; only if that
  file is absent (skill-zip install), `current_version` in
  `shared/migrations.md` frontmatter. Never prefer the
  migrations.md value when plugin.json exists.
- Which of the four `_meta/` schema files exist; if
  `_meta/entity-types.md` exists, its `## Type-Specific Fields`
  section.
- Which templates are in `_Templates/`.
- PC files (`type: pc`) and whether each has a `{Name}_Story.md`
  companion in the same directory.
- Session Wrap-Up files and their filename pattern: old
  (`Session_NN_Wrap_Up.md`) or current
  (`Chapter_CC_Session_NN_Wrap_Up.md`).
- If vault-config has `publish.site_dir`, the installed version in
  `{site_dir}/node_modules/gm-apprentice-publish/package.json`.

## Step 2: Collect pending migrations

Read only the entries you need, not the whole registry:

1. `grep -n '^## Migration' "${CLAUDE_PLUGIN_ROOT}/skills/shared/migrations.md"`
2. An entry's version is the last version in its heading
   (`1.9.4 → 1.9.5` → 1.9.5; `1.4.10` → 1.4.10; Baseline → 1.4.9).
   It is pending when that version is above the vault's, compared
   numerically per component (1.8.9 < 1.10.0). A pre-versioning
   vault takes every entry from Baseline.
3. Read from the first pending heading's line to end of file
   (Read with that offset). Entries are in ascending order.

## Step 3: Diff against vault

Check each step of each pending entry; only unsatisfied steps go
in the preview.

- Folder exists, vault-config field set, `_meta/` file exists,
  story file exists for the PC, npm package at the expected
  version → skip.
- Template in `_Templates/` identical in content to
  `shared/templates/` → skip; differs → "updated — offer
  overwrite".
- Frontmatter field rename/sweep → grep the vault for the legacy
  key(s); none → skip, else pending with the matching file count.

Three checks run on every pass, whatever is pending, because
their drift can come from any skill run, not one migration:

- **Schema mirror** — each built-in type's entry in
  `_meta/entity-types.md` `## Type-Specific Fields` matches
  `shared/entity-schema.md`'s → skip; missing or different →
  pending. Never flag vault-only (custom/evolved) entries.
- **Wrap-Up filenames** — any file still on the old
  `Session_NN_Wrap_Up.md` pattern → pending: list the files and
  any live basename collisions (two or more files resolving to the
  same wikilink target).
- **GM-only headings** — run `vault_check.py <vault> gm-leak` (see
  `shared/vault-access.md`) and read each row against the vault's
  `exclude_sections`:
  - Heading rows (bold-wrapped excluded heading, or a published
    heading matching an `exclude_sections` entry or Keeper
    keyword) → structural re-nest items.
  - Fence-balance rows (orphan `<!-- /gm-only -->`, unclosed
    opener) → their own pending item: list file and line; fix the
    marker before any re-nest, since an orphan closer changes what
    every line above it means. Step 6's re-nest does not fix
    markers, and `wrapup --fix` refuses an unbalanced wrap-up.
  - INFO rows (Keeper-facing bold label or callout) → content
    items for GM confirmation; never auto-convert (a bold
    paragraph is not a heading; a callout needs the GM to pick
    `## GM Notes` or a spoiler).

## Step 4: Build preview

Three groups; omit an empty group. If all are empty, go to
Step 7.

**Structural (will apply after confirmation):** bullets, e.g.
> - Add `gm_apprentice_version: "1.4.9"` to vault-config
> - Rename 4 Wrap-Up files to the chapter-disambiguated pattern
>   (`Chapter_03_Session_01_Wrap_Up.md`, ...) — 2 basename
>   collisions found live in the vault; repair 33 wiki-links
>   pointing at the old ambiguous names
> - Re-nest 47 headings (Keeper Checklist, World State, ...) under
>   `## GM Notes` across 62 files; collapse `exclude_sections` from
>   47 entries down to `["GM Notes"]`

**Content (choose which to apply):** checkboxes, e.g.
> - [ ] Overwrite `pc-generic.md` in `_Templates/` (local
>       version differs from plugin version)
> - [ ] Create `Lord_Blackwood_Story.md` companion file
> - [ ] Update `entity-types.md` — Event field list is stale
>       (has `date` (in-game); canonical is `in_game_date` (in-game))
> - [ ] Convert `**Keeper Notes – Reactions to Rescue:**`
>       (bold-paragraph, no heading) in
>       `Locations/Orphean_Society_Building.md` to a `### Keeper
>       Notes` subsection under `## GM Notes`
> - [ ] Move `> [!info] Keeper Only` callout in
>       `Creatures/Harmonische_Wachter.md` under `## GM Notes` (or
>       wrap in `<!-- spoiler -->` if it is a time-locked reveal)

**Tooling (choose which to apply):** checkboxes, e.g.
> - [ ] Update gm-apprentice-publish 1.0.0 → 1.1.1

## Step 5: Present and confirm

> "Your vault is at version {old} — the plugin is now {new}.
> Here's what needs to change:"
>
> [preview]
>
> "The structural changes will be applied automatically. For
> the items marked with checkboxes, let me know which you'd
> like to include."

Wait for confirmation of the structural batch and the
content/tooling selection.

## Step 6: Execute

In this order:

1. Vault-config field updates (structural)
2. Missing `_meta/` files (structural)
3. Missing folders (structural)
4. Frontmatter field sweeps (structural) — use the repair
   algorithm the entry names (canon status:
   `stamp_entities.py <vault> --repair-canon`, spec in
   `shared/canon-status.md` § Repairing Legacy Keys). No file may
   end with duplicate keys. Collect value conflicts for Step 8.
5. Rename Wrap-Up files to the chapter-disambiguated pattern
   (chapter from each file's own session index `chapter:` field)
   and repair every reference (structural). Session index
   `documents.wrap_up` fields resolve by that index's chapter.
   Other bare `[[Session_NN_Wrap_Up]]` links resolve by the
   containing file's chapter/session context; a link you can't
   resolve that way goes in the Step 8 report for the GM — never
   guess.
6. Re-nest each mechanically matched heading as a `###`
   subsection under `## GM Notes` in its file (create `## GM
   Notes` if absent), demoting it and its sub-headings to sit one
   level below. For Session Wrap-Up files use
   `vault_check.py <vault> wrapup --fix` instead (re-nest, the
   `<!-- gm-only -->` fence, and the 1.9.5 frontmatter and heading
   fixes); run it without `--fix` first and put every `WOULD-FIX`
   row in the preview. Once every entry with a match is re-nested,
   collapse the vault's `exclude_sections` to `["GM Notes"]`
   (structural)
7. Copy selected templates to `_Templates/` (content)
8. Overwrite selected templates in `_Templates/` (content)
9. Update or add selected `_meta/entity-types.md` Type-Specific
   Fields entries: replace a stale line in place; insert a new one
   at the position it holds in `shared/entity-schema.md` (content)
10. Apply the selected bold-heading, bold-paragraph and callout
    conversions — each becomes a `###` subsection under
    `## GM Notes` or is wrapped in `<!-- spoiler -->` markers, per
    the GM's choice for that item (content)
11. Create selected story files from
    `shared/templates/character-story.md`, filling PC name and
    campaign from the PC's frontmatter (content)
12. `npm update gm-apprentice-publish` in the site directory, if
    selected (tooling)

## Step 7: Stamp version

Set `gm_apprentice_version` in `_meta/vault-config.md` to the
plugin version from Step 1, whatever opt-in items were declined.
Declined items do not re-prompt next session.

## Step 8: Report and return

> "Vault upgraded to version {new}. Changes applied:
> - [structural changes]
> - [accepted content changes]
> - [accepted tooling changes]"

List each field-sweep value conflict (file, both values) and
each unresolved Wrap-Up link, and ask the GM to confirm or
correct them before closing out.

Then return to the calling skill, or continue the user's
original request if campaign-organizer detected the mismatch.
