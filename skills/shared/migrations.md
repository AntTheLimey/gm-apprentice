---
# Must equal plugin.json version — CI fails otherwise
current_version: "1.10.37"
---

# Vault Migration Record

`current_version` above must equal `version` in
`.claude-plugin/plugin.json`; CI fails when they differ.

A migration is a coded check in `skills/shared/scripts/` (`migrate.py`,
`migrate_site.py`, `migrate_vault.py`). This file records what each
release changed in a vault, one line each, from 1.10.12 (the oldest
version `migrate.py` starts from). It is not read to run a migration.
To add one, follow `docs/schema-change-procedure.md` step 7.

A check with a release runs for a vault below that release. An
every-pass check runs on every migration, whatever the vault's version.

| Release | What changes in a vault | Check |
|---|---|---|
| every pass | Missing skeleton folders and schema files created (only adds); site's publish tool repinned; an empty Timeline page created when the vault has none (after the repin); missing templates copied; templates still holding an earlier release's text updated, other changed templates and the schema mirror offered; settings left in the site's `vault.config.json` moved into the vault file; `publish.site` written; withheld sections nested under GM Notes; old Wrap-Up filenames renamed, with every link, on a yes; the retired `publish.wrap_up.player_sections` setting removed once the vault is at 1.10.28 | `skeleton`, `site-repin`, `timeline-page`, `config-to-vault`, `templates`, `schema-mirror`, `publish-site`, `gm-leak`, `wrapup-filenames`, `wrapup-sections-key` |
| 1.10.13 | Faction template writes `faction_type` (offered by every-pass `templates`); mobRPG keeps Campaign Log and Encounters in the vault | `mobrpg-sections` |
| 1.10.14 | None | |
| 1.10.15 | mobRPG heritage notes moved into `Heritages/`, with every link, on a yes | `heritage-notes` |
| 1.10.16 | `publish.theme.default_mode` | `default-mode` |
| 1.10.17 | `publish.theme.fonts.source: self-host`; a site's own postbuild step that adds a light/dark toggle (1.10.16) or drops retired PCs from the party board now doubles the tool | `fonts-self-host`, `postbuild` |
| 1.10.18 | Session template (copied by every-pass `templates`); played sessions registered; index bodies withheld | `publish-played`, `session-recaps` |
| 1.10.19 | Handout Keeper sections nested under GM Notes | every pass, see above (`gm-leak`) |
| 1.10.20, 1.10.21 | None (publish tool only) | |
| 1.10.22 | `sheet_source` on PCs and PC templates | `pc-template-sheet-source`, `sheet-source` |
| 1.10.23 | Notes the build cannot parse are reported | `unparseable-notes` |
| 1.10.24 | Publish settings move into `_meta/vault-config.md` | every pass, see above (`config-to-vault`) |
| 1.10.25 | `publish.site` says whether the vault has a site | every pass, see above (`publish-site`) |
| 1.10.26 | None. Migrations run as `migrate.py plan` and `apply` | |
| 1.10.27 | None (the two checks above now rename and move) | |
| 1.10.28 | A Wrap-Up heading is Keeper-facing only under GM Notes: headings the old rule counted as Keeper content are moved under GM Notes on a yes | `wrapup-sections` |
| 1.10.29 | None. New vaults are built by `vault_scaffold.py`; gaps in an existing vault's skeleton are filled | every pass, see above (`skeleton`) |
| 1.10.30 | None. Broken links are listed and fixed with `links.py`; nothing is changed without a yes | |
| 1.10.31 | None. A new vault's roster page is `type: pc_roster`; a roster written as `player-characters` is left as it is and still works (publish tool 1.12.4) | |
| 1.10.32 | A vault with no Timeline page is given an empty one, so session timeline entries have somewhere to go | every pass, see above (`timeline-page`) |
| 1.10.33 | D&D PC template: saving-throw numbers, Senses, Bonuses and Defences, features and spells as tables (spells with a Source), Gear with weights, Carrying, Magic Items in place of the attunement slots, and an optional Companions section (copied by every-pass `templates`); existing PC notes are not changed | — |
| 1.10.34 | D&D live sheet: no vault change. A D&D PC note is read as it is; nothing is added to it | — |
| 1.10.35 | D&D rules checks: no vault change. The fill tool reports slips and never writes for them | — |
| 1.10.36 | Sheet skins and frames: no vault change. A vault that sets no skin builds as before. The site's publish tool is repinned to 1.15.0 by the every-pass repin | — |
| 1.10.37 | None (publish tool only, 1.15.1) | |
