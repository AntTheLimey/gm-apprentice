# Vault Migration Procedure

Step-by-step procedure for upgrading a vault to the current
plugin version. Campaign-organizer runs this directly when it
detects a version mismatch. Other skills hand off to
campaign-organizer, which then follows this procedure.

## Trigger

The vault's `gm_apprentice_version` (from `_meta/vault-config.md`
frontmatter) is lower than `current_version` (from
`shared/migrations.md` frontmatter), or the field is absent.

## Step 1: Gather state

Read the following:

- `gm_apprentice_version` from `_meta/vault-config.md`
  (absent = "pre-versioning")
- `current_version` from `shared/migrations.md`
- List files in `_meta/` — which of the four schema files exist?
- List files in `_Templates/` — which templates are present?
- List all PC files (`type: pc`) and check for
  `{Name}_Story.md` companions in the same directory
- If `publish.site_dir` exists in vault-config, read the
  installed npm version from
  `{site_dir}/node_modules/gm-apprentice-publish/package.json`

## Step 2: Collect pending migrations

Read `shared/migrations.md`. Find all migration entries that
apply between the vault's current version and the plugin's
current version. For pre-versioning vaults, this is the
baseline entry. For vaults at an intermediate version, collect
all entries above that version in ascending order.

## Step 3: Diff against vault

For each step in the collected migrations, check whether it is
already satisfied:

- **Folder exists** → skip
- **Vault-config field already set** → skip
- **Template in `_Templates/` matches `shared/templates/`** →
  skip (compare content, not just existence)
- **Template in `_Templates/` differs from `shared/templates/`**
  → mark as "updated — offer overwrite"
- **Story file already exists for PC** → skip
- **`_meta/` file already exists** → skip
- **npm package already at expected version** → skip

Only unsatisfied steps appear in the preview.

## Step 4: Build preview

Group remaining steps into three categories and format as a
preview for the user:

**Structural (will apply after confirmation):**
List each structural change as a bullet. Example:
> - Add `gm_apprentice_version: "1.4.9"` to vault-config
> - Add `publish.system: "coc-7e"` to vault-config
> - Create missing `_meta/entity-types.md`

**Content (choose which to apply):**
List each content change as a checkbox. Example:
> - [ ] Copy `pc-coc-7e.md` to `_Templates/`
> - [ ] Overwrite `pc-generic.md` in `_Templates/` (local
>       version differs from plugin version)
> - [ ] Create `Lord_Blackwood_Story.md` companion file

**Tooling (choose which to apply):**
List each tooling change as a checkbox. Example:
> - [ ] Update gm-apprentice-publish 1.0.0 → 1.1.1

If a category has no pending items, omit it from the preview.
If all categories are empty (everything already satisfied),
skip to Step 7 (stamp version).

## Step 5: Present and confirm

Show the preview to the user:

> "Your vault is at version {old} — the plugin is now {new}.
> Here's what needs to change:"
>
> [preview from Step 4]
>
> "The structural changes will be applied automatically. For
> the items marked with checkboxes, let me know which you'd
> like to include."

Wait for the user to confirm the structural batch and select
which content/tooling items to apply.

## Step 6: Execute

Apply all confirmed changes in this order:

1. Write vault-config field updates (structural)
2. Create missing `_meta/` files (structural)
3. Create missing folders (structural)
4. Copy selected templates to `_Templates/` (content)
5. Overwrite selected templates in `_Templates/` (content)
6. Create selected story files using
   `shared/templates/character-story.md` as the base, filling
   in the PC name and campaign from the PC file's frontmatter
   (content)
7. Run `npm update gm-apprentice-publish` in site directory if
   selected (tooling)

## Step 7: Stamp version

Set `gm_apprentice_version` in `_meta/vault-config.md`
frontmatter to the `current_version` value from
`shared/migrations.md`.

This happens regardless of which opt-in items the user
accepted. The vault is now "at" this version. Declined
content/tooling items will not re-prompt on the next session.

## Step 8: Report and return

Summarize what was changed:

> "Vault upgraded to version {new}. Changes applied:
> - [list of structural changes]
> - [list of accepted content changes]
> - [list of accepted tooling changes]"

Return control to the calling skill, or proceed with the
user's original request if campaign-organizer was the skill
that detected the mismatch.
