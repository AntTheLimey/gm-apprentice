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
- If `_meta/entity-types.md` exists, read its
  `## Type-Specific Fields` section
- List files in `_Templates/` — which templates are present?
- List all PC files (`type: pc`) and check for
  `{Name}_Story.md` companions in the same directory
- List all Session Wrap-Up files in the vault and note which
  filename pattern each uses: old (`Session_NN_Wrap_Up.md`) or
  current (`Chapter_CC_Session_NN_Wrap_Up.md`)
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
- **Frontmatter field rename/sweep** → grep the vault for the
  legacy key(s); no file contains them → skip. Otherwise the
  sweep is pending, with the matching file count shown in the
  preview
- **`_meta/entity-types.md` Type-Specific Fields entry for a
  built-in type matches `shared/entity-schema.md`'s entry for
  that type** → skip. **Entry is missing or differs** → pending.
  This check always runs, independent of which versioned
  migrations are being applied — it exists to surface schema-doc
  drift accumulated from any past migration that changed a
  canonical field or type without ever updating this file.
  Vault-only entries (custom/evolved types) are never flagged.
- **All Session Wrap-Up files already use the
  `Chapter_CC_Session_NN_Wrap_Up.md` pattern** → skip. **Any file
  still uses the old `Session_NN_Wrap_Up.md` pattern** → pending,
  listing the affected files and flagging any basename collisions
  already live in the vault (two or more files that would
  resolve to the same wikilink target). This check always runs
  too, for the same reason as the entity-types.md check above —
  an old-pattern file can reappear from any skill that still
  emits the old link, not just from a pending versioned migration
- **GM-only heading vocabulary matches the canonical single
  heading** — read the vault's own `_meta/vault-config.md`
  `exclude_sections` list. If it's exactly `["GM Notes"]` (or a
  subset of it), skip. Otherwise, for each other entry, search the
  vault for real markdown headings (any level) matching that text
  exactly — pending, listed as a mechanical re-nesting item. This
  check always runs, for the same reason as the two checks above —
  drift accumulates one new heading name at a time, from any skill
  invocation, not from a single migration event
- **Bold-wrapped or bold-paragraph GM-only content** — for each
  entry in the vault's `exclude_sections` list, also search for
  that text appearing inside a bold-wrapped heading
  (`### **{text}**`) or as a bold-paragraph line with no heading
  marker at all (`**{text}:**`). Any match → pending, listed as a
  judgment item requiring GM confirmation (not safe to auto-convert
  — a bold-paragraph line isn't a real heading, and converting it
  needs the GM to confirm the boundary of what should move)
- **Callout-only-marked content** — any Obsidian callout (`> [!info]`,
  `> [!warning]`, etc.) whose title contains "keeper" or "gm" and
  which is NOT already inside an excluded heading or a
  `<!-- gm-only -->`/`<!-- spoiler -->` fence → pending, listed as a
  judgment item (no automatic signal for what it should become —
  the GM decides whether it's `## GM Notes` or a spoiler)

Only unsatisfied steps appear in the preview.

## Step 4: Build preview

Group remaining steps into three categories and format as a
preview for the user:

**Structural (will apply after confirmation):**
List each structural change as a bullet. Example:
> - Add `gm_apprentice_version: "1.4.9"` to vault-config
> - Add `publish.system: "coc-7e"` to vault-config
> - Create missing `_meta/entity-types.md`
> - Rename 4 Wrap-Up files to the chapter-disambiguated pattern
>   (`Chapter_03_Session_01_Wrap_Up.md`, ...) — 2 basename
>   collisions found live in the vault; repair 33 wiki-links
>   pointing at the old ambiguous names
> - Re-nest 47 headings (Keeper Checklist, World State, Quality
>   Notes, ...) under `## GM Notes` across 62 files; collapse
>   `exclude_sections` from 47 entries down to `["GM Notes"]`

**Content (choose which to apply):**
List each content change as a checkbox. Example:
> - [ ] Copy `pc-coc-7e.md` to `_Templates/`
> - [ ] Overwrite `pc-generic.md` in `_Templates/` (local
>       version differs from plugin version)
> - [ ] Create `Lord_Blackwood_Story.md` companion file
> - [ ] Update `entity-types.md` — Event field list is stale
>       (has `date` (in-game); canonical is `in_game_date` (in-game))
> - [ ] Add `entity-types.md` — `character-story` field block
>       (missing from vault schema mirror)
> - [ ] Convert `### **Keeper Notes**` (bold-wrapped heading) in
>       `Characters/NPCs/Doctor_Carreau.md` to a plain `### Keeper
>       Notes` subsection under `## GM Notes`
> - [ ] Convert `**Keeper Notes – Reactions to Rescue:**`
>       (bold-paragraph, no heading) in
>       `Locations/Orphean_Society_Building.md` to a `### Keeper
>       Notes` subsection under `## GM Notes`
> - [ ] Move `> [!info] Keeper Only` callout in
>       `Creatures/Harmonische_Wachter.md` (currently unprotected)
>       under `## GM Notes` (or wrap in `<!-- spoiler -->` if this
>       is a time-locked reveal, not a permanent secret)

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
4. Run frontmatter field sweeps (structural) — apply the
   repair algorithm the migration entry names (for canon
   status: `shared/canon-status.md` § Repairing Legacy Keys).
   A file must never end up with duplicate keys. Collect any
   value conflicts for the Step 8 report
5. Rename Wrap-Up files to the chapter-disambiguated pattern
   (chapter number for each file comes from its own session
   index's `chapter:` field — see the migration entry) and
   repair every reference to a renamed file. Session index
   `documents.wrap_up` fields are unambiguous — each index's own
   chapter determines which renamed file it means. For any other
   bare `[[Session_NN_Wrap_Up]]` link found vault-wide, resolve it
   by the containing file's own chapter/session context; if a
   link's intended target can't be determined that way (e.g. it
   sits outside any chapter context and more than one renamed
   file could be the referent), list it in the Step 8 report for
   the GM to resolve by hand rather than guessing (structural)
6. Re-nest every mechanically-matched heading from the vault's
   `exclude_sections` list as a `###` subsection under `##
   GM Notes` in its file (creating `## GM Notes` if absent,
   appending under an existing one otherwise), demoting the
   moved heading and any of its own sub-headings by the amount
   needed to sit one level below `## GM Notes`. Once every
   entry that had at least one matching heading has been
   re-nested, collapse the vault's own `exclude_sections` list
   down to `["GM Notes"]` (structural)
7. Copy selected templates to `_Templates/` (content)
8. Overwrite selected templates in `_Templates/` (content)
9. Update or add selected `_meta/entity-types.md`
   Type-Specific Fields entries — replace the stale line in
   place for an update, or insert the new line in the same
   relative position it holds in `shared/entity-schema.md` for
   an addition. Never touch vault-only (custom/evolved) entries
   (content)
10. Apply selected bold-wrapped-heading, bold-paragraph, and
    callout-only conversions from the judgment batch — each one
    the GM checked in the Content preview becomes a `###`
    subsection under `## GM Notes`, or is wrapped in
    `<!-- spoiler -->` fence markers instead, per which
    destination the GM chose for that item (content)
11. Create selected story files using
    `shared/templates/character-story.md` as the base, filling
    in the PC name and campaign from the PC file's frontmatter
    (content)
12. Run `npm update gm-apprentice-publish` in site directory if
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

If a field sweep found value conflicts (legacy key disagreed
with the kept value), list each conflicted file with both
values and ask the GM to confirm or correct them before
closing out.

Return control to the calling skill, or proceed with the
user's original request if campaign-organizer was the skill
that detected the mismatch.
