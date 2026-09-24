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
- **GM-only headings** — run `vault_check.py <vault> gm-leak`
  (see `shared/vault-access.md`); while the 1.8.3 entry is pending,
  also run `gm-leak --renest-excludes` (dry run). Once 1.8.3 is done,
  leave the GM's `exclude_sections` list alone:
  - `WOULD-FIX` rows (re-nests, and the `_meta/vault-config.md`
    collapse) and bold-wrapped ERROR heading rows → one structural
    item. An ERROR row (`re-nest refused`, `migration blocked`,
    `not understood`, a code-fence heading ending an exclusion) →
    list it; the item cannot apply until it is fixed by hand.
  - Fence-balance rows (orphan `<!-- /gm-only -->`, unclosed
    opener) → their own pending item: list file and line; fix the
    marker first, since an orphan closer changes what every line
    above it means. No `--fix` rewrites markers.
  - Keyword WARNING heading rows (a title merely containing
    "Keeper", "Secret", "Tactic"…) and INFO rows (bold label or
    callout) → content items, one per heading/line; never
    auto-moved.

## Step 4: Build preview

Three groups; omit an empty group. If all are empty, go to
Step 7.

**Structural (one yes applies the group):** bullets, e.g.
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
> "May I apply the structural changes? For the items marked with
> checkboxes, let me know which you'd like to include."

**Consent (issue #220).** When the preview has Structural items,
applying them and stamping need one GM yes for the whole group — an
instruction already in the request, such as "apply the structural
changes," counts. The yes covers every item in the Structural group
regardless of file count; never reclassify a structural item as a
judgment call. A structural item is outstanding if not applied —
the GM declined the group or the item, or it failed. Content and tooling items are
chosen one at a time by checkbox; ticked ones run whatever the
structural answer. An empty or content-only preview needs no yes to
stamp — declined content never blocks it.

No GM reachable — a scripted or headless run carrying no instruction
about the migration — is not a yes: show the preview, apply nothing,
stamp nothing, and report the pending migration in Step 8.

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
6. Re-nest GM-only headings (structural): first
   `vault_check.py <vault> wrapup --fix` for Session Wrap-Ups
   (re-nest, the `<!-- gm-only -->` fence, and the 1.9.5 fixes),
   then, while the 1.8.3 entry is pending,
   `vault_check.py <vault> gm-leak --renest-excludes --fix`. That
   one command re-nests every heading titled with a current
   `exclude_sections` entry under `## GM Notes` and then collapses
   the list to `["GM Notes"]` (a vault with no list keeps the
   defaults) — all or nothing: any refusal writes nothing. Once
   1.8.3 is done, run `vault_check.py <vault> gm-leak --fix`
   instead: it moves only bold-wrapped ERROR headings and never
   touches `exclude_sections`. Then
   re-run `gm-leak` and `wrapup`; any ERROR row from either (a
   heading row, `re-nest refused`, `repair refused`, a fence that
   crosses a section, a Keeper-facing H2 that publishes) means the
   item failed
7. Copy selected templates to `_Templates/` (content)
8. Overwrite selected templates in `_Templates/` (content)
9. Update or add selected `_meta/entity-types.md` Type-Specific
   Fields entries: replace a stale line in place; insert a new one
   at the position it holds in `shared/entity-schema.md` (content)
10. Apply the selected keyword-heading, bold-paragraph and callout
    conversions — each becomes a `###` subsection under
    `## GM Notes` or is wrapped in `<!-- spoiler -->` markers, per
    the GM's choice for that item (content)
11. Create selected story files from
    `shared/templates/character-story.md`, filling PC name and
    campaign from the PC's frontmatter (content)
12. `node "$TOOL" update-pin --site <site-dir>` (publish-site's build
    tool), if selected (tooling). Not `npm update`: the site pins the
    tool with a `file:` path, so `npm update` re-links the same old version

## Step 7: Stamp version

Every structural item applied (or none pending): stamp
`gm_apprentice_version` in `_meta/vault-config.md` at the plugin
version from Step 1. Declined content and tooling items never block
the stamp and do not re-prompt.

A structural item outstanding (issue #228): find the earliest pending
entry with an outstanding structural item and stamp the version of
the pending entry just before it. If it is the first pending entry,
leave the stamp unchanged. Name the outstanding item in Step 8; the
next MISMATCH offers it again. The every-pass Step 3 checks (schema
mirror, Wrap-Up filenames, GM-only headings) do not gate the stamp —
they re-run on every MISMATCH — unless the item is also a pending
entry's own (the 1.8.3 re-nest while 1.8.3 is pending). No GM
reachable: stamp nothing.

## Step 8: Report and return

Every structural item applied:
> "Vault upgraded to version {new}. Changes applied:
> - [structural changes]
> - [accepted content changes]
> - [accepted tooling changes]"

A structural item was not applied (Step 7's partial stamp):
> "Vault is at version {stamped}, not {new} — [the outstanding
> item] is still pending and will be offered again next migration.
> Changes applied: ..."

No GM reachable (Step 5's no-consent case — nothing applied, nothing
stamped):
> "Vault is at version {old}; the plugin is now {new}. Here's what's
> pending:"
>
> [preview]

List each field-sweep value conflict (file, both values) and
each unresolved Wrap-Up link, and ask the GM to confirm or
correct them before closing out.

Then return to the calling skill, or continue the user's
original request if campaign-organizer detected the mismatch.
