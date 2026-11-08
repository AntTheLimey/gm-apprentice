# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 1.11.0 are in [docs/history/changelog-archive.md](docs/history/changelog-archive.md).

---

## [1.12.1] — 2026-11-08

Codex and Cursor tested end to end on 1.12.0 (create a vault, prep, wrap-up, build the site locally, update).

### Fixed

- A first session is reconciled like any other: before, a tidy session 1 (the campaign's, or any chapter's, as numbers restart each chapter) was skipped, so its Wrap-Up and new notes stayed DRAFT for good (#618).
- When an agent's sandbox blocks the update's backup or `gma tool install`, the message says the folder is outside the project folder and asks the assistant to stop and ask the GM to allow it, not to work around it. The automatic download before other commands only warns.

### Changed

- README: what was tested on Codex and Cursor, and the one command a sandbox may ask you to allow.

## [1.12.0] — 2026-11-08

gm-apprentice installs in Codex and in the other agents `npx skills` supports, and the skill zips are gone.

### Added

- **Codex plugin:** `codex plugin marketplace add AntTheLimey/gm-apprentice`, then `codex plugin add gm-apprentice@gm-apprentice`, installs the whole plugin, publish tool included.
- **`npx skills add AntTheLimey/gm-apprentice --all -g`** installs the nine skills and `shared`, the helper skill they use. Claude Code and Codex keep `shared` out of the skill list.

### Changed

- When a vault is newer than the skills, an install that isn't a plugin is told to run `npx skills update`; the plugin's words are unchanged.
- `gma update` offers to retire a workaround when GitHub says its issue was closed as fixed before the installed release came out; it no longer reads the changelog.
- The vault's managed note block names the `shared` folder rather than a plugin path, so it refreshes once.
- Releases before 1.11.0 moved to `docs/history/changelog-archive.md`.

### Removed

- **The skill zips.** Install through the Claude Code or Codex plugin, or `npx skills`, instead.

---

## [1.11.8] — 2026-11-08

Installs other than the Claude Code plugin now get the publish tool too: it downloads once, on first use. Nothing changes for a Claude Code GM.

### Added

- **The publish tool reaches every install.** An install without the tool beside its skills (the zips now; `npx skills` and other assistants next) downloads the matching tool release once, on the first command that needs it, checks it against the release's SHA256SUMS and keeps it in a per-user cache folder. Node does the download, so it goes through a sandbox's proxy; that needs Node 22.21 or newer (any 24 or later), and an older Node is told to upgrade. A failed download warns once, waits 15 minutes before trying again on its own, and the command carries on as it would without the tool. The three newest versions are kept, for other installs on the same machine.
- **`gma tool install` and `gma tool path`.** Install fetches the tool now, for a sandbox that blocks network access until the GM allows it; path prints the tool in use.
- **`skills/shared/PUBLISH_VERSION`** names the tool release the skills go with. A test, CI and the zip build fail when it differs from `tools/publish/package.json`.

### Changed

- **Each install pins the site its own way.** The Claude Code plugin keeps today's pin. Other installs, and a site already pinned to a release tarball, pin the checksummed release named by `PUBLISH_VERSION`, kept inside the site folder, so the site builds wherever it is. `gma publish update-pin` does the same, so the publish-site steps that run it work everywhere.
- **The checks say "run `gma update`"** where they said "run update-pin" for a site tool that is too old: the update repins the site on every install.
- **The settings schema is read from beside the publish tool**, so a downloaded tool brings it too.
- **`gma publish update-pin --check`** asks about the same release a real run would pin, and a repin stops plainly when `PUBLISH_VERSION` is missing or unreadable or Node is older than 22.21.
- **Node 22.21 or newer** is now what the docs ask for: the release download and the site repin need it to reach the network through a proxy.

## [1.11.7] — 2026-11-08

Every install now knows its own version, and an install that is missing a piece says so and stops. Nothing for a GM to do.

### Added

- **A version stamp that ships with the skills.** `skills/shared/VERSION` is committed and is the version every install reads, the Claude Code plugin included. A plugin manifest beside it is checked against it and only warns when they differ, so an install converted for another assistant no longer refuses first use. A test, CI and the zip build all fail when the stamp and `plugin.json` differ.

### Changed

- **The zips carry the committed stamp** instead of writing their own.
- **A missing piece tells the assistant to stop.** When the version cannot be found, or the publish tool is not installed, the message now ends: "Assistants: stop here, tell the GM what is missing, and do not work around it." A version mismatch warns once per command, not once per check.

## [1.11.6] — 2026-11-07

Every skill now runs its vault scripts and the publish tool through `gma`, and `gma` finds its own install. Nothing for a GM to do; the publish tool is 1.70.1.

### Changed

- **The skills call only `gma`.** Every vault script and the publish tool run as a `gma <command>` line, so the skills no longer depend on a Claude Code variable to find where the plugin lives. `gma` finds its own install, and the scripts' hints and the generated text name `gma` too. A test keeps the skill text `gma`-only.
- **Publish tool 1.70.1:** the fix line for a link that is not shown on the site names `gma links`, and its build warnings and help name `gma` commands rather than script files.

### Fixed

- **On macOS and Linux, stopping a background `gma publish serve` stops the server.** `gma publish` now hands over to the publish tool instead of running it as a child, so ending the background job ends the server rather than leaving it running. When the publish tool is not installed, `gma publish` says so plainly and stops.

## [1.11.5] — 2026-11-06

Four bug fixes.

### Fixed

- **A note that starts with a byte-order mark** (some Windows editors save one) is now read: `vault_write.py story` and `npc-story` found no such PC or NPC, and the scripts read it as having no frontmatter, so the checks skipped it. Every frontmatter and body reader in the scripts now skips the mark (#593).
- **Quoted frontmatter values are decoded** by the scripts' reader as YAML reads them: `"a \"b\""` reads `a "b"`, `"C:\\x"` reads `C:\x`, an escaped tab is a tab, and `'O''Brien'` reads `O'Brien`. Values the scripts wrote with escapes used to read back with their backslashes (#597). Block and flow lists are decoded too. The writers that put a read value back (a scene's linked notes and `played_in`, the props move's `prop_hand`) now escape it, so a name with a quote or backslash keeps its frontmatter valid. A shared set of test notes checks the publish tool's reader against the same values.
- **`migrate.py apply`** no longer lists a choice whose step failed under "not offered" as well; a choice whose step the run never reached, because an earlier step failed, reads "not run" (#595).
- **session-wrapup** never replaces the Campaign Overview's `current_game_date` with a vaguer one: with no date in the notes it keeps the date there, or moves it on only as far as the notes say time passed, and asks when unsure (#600).

## [1.11.4] — 2026-11-06

Voices, part two (#460): the skills draft and use the voices. With `vault.voices` on (the default), session-wrapup and session-prep read the campaign's voice and each character's before writing story prose, and draft a missing one for the GM's yes; session-play and ttrpg-expert use the voices they find and never draft. Records stay plain. The update refreshes an unedited character-story template and asks about an edited one, as usual.

### Added

- **`shared/voice.md`**: how a voice is drafted (from the vault: background, backstory, sheet, how the character played; a few sentences on one line), checked against the player site's hidden list before it is written, shown to the GM, and stored with `stamp_entities.py --set`; and how a GM's correction to voiced prose is folded into that voice without making it longer.
- **session-wrapup** runs `vault_check.py VAULT voices` before the recap, names a PC who died or left this session and an NPC the GM gives a story, drafts any missing voice for the GM's yes, and writes the recap in the campaign voice and each Story entry in its PC's voice. A voiced NPC who appeared gets a passage through `vault_write.py npc-story`. A gmassistant.app export's `## Summary` is still adopted word for word; it is rewritten in the campaign voice only when the GM asks.
- **session-prep** uses the campaign voice for read-aloud, scene-setting and handouts, and a voiced character's own when they speak or write; it drafts a missing campaign voice for the GM's yes. **session-play**, **ttrpg-expert** and **vault-ingest**'s backstory entries use the voices when a vault has them.
- **`vault_write.py story --replace` and `npc-story --replace`** replace a session's existing Story entry or NPC passage, found by session number (and by chapter where sessions restart or the heading names one), all or nothing. An NPC passage is looked for only where a new one would go (`## Story`, or the `--section` given, never a gm-only or hidden section), so an appearance log or GM Notes heading for the same session is never overwritten; `npc-story --replace` works while `vault.voices` is off. The preview names any gm-only or spoiler block (inline too), or comment, the new text drops. `--date` and `--as-of` stamp `lastUpdated` and `asOfSession` when given. The story format's new Corrections section says how a GM's correction is made: dry-run first, hidden blocks kept.

### Changed

- **The story format** reads the voices first; the genre table is the fallback when a voice is `(none)` or voices are off, and a starting point for drafting.
- **"Voice" means only the story voice** in the skills: the NPC generator's `Voice:` line is now `Speech:`, and craft uses elsewhere read "register", "style" or "restyle".
- **`vault_write.py timeline --under` and `--after`** take a heading by its text, without the `#` marks, when exactly one heading has that text.

### Fixed

- **session-wrapup step 4b and the world-evolution stamps** passed `--session N`, which `stamp_entities.py` refuses when the Campaign Overview labels sessions ("Session 3"); they now pass the session's value in the Overview's own shape.

---

## [1.11.3] — 2026-11-06

A new vault no longer starts with a table error, and the update repairs the same row in an existing vault (check `publish-row-pipe`) (#599, thanks to dcordle).

### Fixed

- **The `publish` row of the schema table** wrote its two values as `` `false` \| `stub` ``. A new vault copies that table into `_meta/entity-types.md`, and the table check rejects an escaped pipe in a cell, so every new vault began with one ERROR. The row now reads `` `false` or `stub` ``, and a test runs the table check over the text a new vault gets. In an existing vault, the update (check `publish-row-pipe`) rewrites the value cell of the `publish` row in `_meta/entity-types.md` the same way, whatever wording the rest of the row has; a row whose values you changed is left alone.

---

## [1.11.2] — 2026-11-05

Voices, part one (#460): the field, the switch, and the tools the skills will use. Publish tool 1.70.0. The skills start drafting and using voices in the next release. The update adds the `voice:` line to unedited PC, NPC and Campaign Overview templates and asks about edited ones, as usual; it leaves existing notes alone. A vault that keeps its own list of hidden details is asked whether to add `voice` to it, and the update waits for that answer.

### Added

- **`vault.voices`**, a vault setting, on by default. It says whether the skills keep a short voice for the campaign and for each storied character, and write story prose in it. Off, story prose takes its tone from the genre, as before.
- **A `voice:` line** on the Campaign Overview, PC and NPC templates: a few sentences on how the campaign or character is told and how they speak, on one line. An NPC with a voice is one the GM has given their own story. A voice cleared to `null`, `~` or only a comment counts as none.
- **`vault_check.py VAULT voices [NAME ...]`** prints the campaign's voice and each character's in one short list (every active PC and every NPC with a voice, or the characters named). Names match by name, alias or `[[link]]`, with or without underscores; a name two characters answer to shows as ambiguous. A voice not on one line shows as unreadable.
- **`vault_write.py npc-story`** writes a storied NPC's passage for the session at the end of its `## Story` section, made when the note has none, or under the section `--section` names. It refuses a hidden or gm-only section (and will not open a `## Story` that `player_site.hide.sections` hides), a place inside a block the site strips, a session already written there, an NPC with no voice, and every NPC while `vault.voices` is off. With no `--section`, it points out a section that already holds earlier session passages.

### Changed

- **The NPC template's `**Voice:**` line under Playing Them is now `**Speech:**`**, so "voice" means only the story voice. Existing NPC notes keep their line as written.
- **`voice` is kept off the player site.** It joins the built-in `player_site.hide.fields`. A vault that keeps its own list is asked by the update (check `hide-fields-voice`) to add `voice` to it, and stays at its old version until it answers. Answering leave keeps the list as it is, so a voice can show wherever a page names that detail.

### Fixed

- **`vault_write.py story` and `npc-story`** no longer write `lastUpdated: "null"` from a Wrap-Up whose `play_date` is still `null`; they leave `lastUpdated` as it was and warn.
- **`vault_write.py story`** in a vault that numbers sessions per chapter no longer refuses chapter 2's Session 2 as chapter 1's again; the entry is headed `Chapter 2 Session 2`, as `npc-story` heads its passage there.
- **Notes already holding `lastUpdated: "null"`**: the update (check `null-last-updated`) clears it to `lastUpdated: ""` on character story and NPC notes.
- **A value written with a line break or tab** (`stamp_entities.py --set`) is escaped onto one line, so it reads back whole.

---

## [1.11.1] — 2026-11-05

Settings writer fixes (#380). Publish tool 1.69.1. No vault change.

### Fixed

- **Values a YAML 1.1 reader would misread** (`12:30`, `yes`, `1_000` and the like) are written quoted, so Obsidian and the scripts read the same text the publish tool does. A lone `y` or `n` stays bare.
- **A value already in quotes keeps its own quotes** when a change still needs it quoted (`'yes'` stays single-quoted).
- **Renaming a note reports a settings error** (an unreadable file, or a vault with only the old settings file) instead of silently leaving the settings unchanged.
- **The site doctor reports a malformed `package.json` once**, as the settings stop, not again as a version warning.

### Changed

- **Dead code from the old settings layer removed**: the layout-aware name and file-label helpers, the hidden `layout` property of the publish config, and the old-file branches of the writer's tests. The settings-name and file-label helpers take no layout argument.

---

## [1.11.0] — 2026-11-05

**Before you update: every vault and site must already be moved.** Update each vault with plugin 1.10.134 or later first (its update moves the settings to `_meta/vault-config.yaml` and the publish list to `_meta/publish-list.yaml`, and repins the site's publish tool). Then check three things the 1.10 update can leave behind: `_meta/vault-config.md` beside the new file (remove it once its settings are in `_meta/vault-config.yaml`), a key other than `vaultPath` in the site folder's `vault.config.json`, and a `prebuild` or `postbuild` script in the site's `package.json` (move it to `player_site.before_build` or `player_site.after_build`). Plugin 1.11.0 no longer moves anything: its update refuses a vault that is not moved or still holds any of these, and names each with its fix; the build stops on them by name. Publish tool 1.69.0.

### Removed

- **The old settings file's reader** (`_meta/vault-config.md`): the scripts and the publish tool read only `_meta/vault-config.yaml`.
- **The old publish list** (`_meta/publish-manifest.md`): its reader and writer are gone.
- **The settings move** (`settings move`, with `--fold-site-file`, `--no-site-file` and `--discard-old-file`) and the update's settings-move, publish-list and hidden-entry rows.
- **`manifest convert` and `manifest hidden`.**
- **Settings in the site folder's `vault.config.json`**: only `vaultPath` is read there.
- **Running the site's `package.json` build hooks**: build steps live in `player_site.before_build` and `player_site.after_build`.
- **The closing WARNING line** a build printed for campaign settings left in the site folder's `vault.config.json` (a leftover is now a stop, below).

### Changed

- **A leftover stops the build by name.** Any key but `vaultPath` in the site folder's `vault.config.json` stops it with each key's new home (`siteTitle (now player_site.title)`); so does a build hook left in the site's `package.json`, naming the setting it moved to, and a `package.json` that cannot be read. `setup-status-bar` and `setup-inbox` stop on a leftover before they change anything.
- **Both settings files present stops the build**, and says to remove or rename the old one once its settings are checked against the new one.
- **The update refuses a vault that is not moved** (exit 2; `vault_check.py version` says `REFUSED`, a new verdict, with the file and the fix): no stamp or one older than 1.10.60, the old settings file (alone or beside the new one), the old publish list, a site publish tool older than 1.27.0, and every leftover the build stops on (site-folder keys, `package.json` build scripts or a `package.json` that cannot be read). It asks the publish tool which leftovers there are, so the update and the build agree; settings the tool refuses, or a site tool whose version cannot be read, are named. The gate does not need node: without it, it checks the stamp, the old settings file and the old publish list, and the update says the site checks were skipped (the build still stops on the rest). A vault with no site has no site checks. The message links to the last 1.10 release.
- **The Settings check names the file a leftover is in** (`vault.config.json`, `package.json`, the old file) and shows the `package.json` stops it used to miss.
- **The update's floor is 1.10.60, and the vault must actually be moved.** A stamp alone is not enough.
- **Messages name settings directly**, by the one name each has.

### Fixed

- **An unreadable `player_site.folder_map` stops the build** (#375). It was a warning, and the build then read an empty map and published no pages.
- **A hiding-list entry YAML reads as something else stops the build.** A bare `007` was read as the number 7 (and `1e3`, `0x1F`, `1.50` and `true` likewise), so it matched nothing and what it hid published. Quote it (`'007'`); a number that reads back as written (`1999`) is fine.
- **A `player_site.folder_map` entry whose value is not a folder name** (empty, a number, a list) stops the build, naming the entry. It published under a made-up folder (`null/`).

### Publish tool 1.69.0

- Reads only `_meta/vault-config.yaml` and `_meta/publish-list.yaml`; the old settings file or publish list stops a build by name, alone or beside the new one.
- A key other than `vaultPath` in the site folder's `vault.config.json`, a non-list, empty or null hiding key there, a build hook left in the site's `package.json`, or a `package.json` that cannot be read stops `build`, `deploy`, `doctor --site` and the set-up commands, naming each and where it moved.
- `build --site gm` on a vault with only the old settings file names that file.
- `settings move`, `manifest convert` and `manifest hidden` are gone, with the site-file fallback and the closing WARNING line.
- An unreadable `player_site.folder_map` is a stop (#375).
- `config.js` no longer exports `SITE_OFF` for one test (#382).
- `settings get` and `settings check` carry the `package.json` stops, the old publish list and an unparseable site `vault.config.json`, each with its `source`; the old-file and old-list messages say a 1.10 release, 1.10.134 or later.
- A hiding-list entry YAML reads as other than its text, and a `folder_map` value that is not a folder name, stop.
