# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 1.11.0 are in [docs/history/changelog-archive.md](docs/history/changelog-archive.md).

---

## [1.12.11] — 2026-11-10

### Changed

- Prep writes the whole Plan in one go: the skill carries the Plan's shape, and the write prints every check prep used to run by hand (read-aloud lines naming a PC, a multi-day clock, links with no note, scene pointers).
- `--gm-input` implies `--headless` and takes its parts comma-separated too; the check no longer asks for an empty `## Planned vs Played` during prep.

## [1.12.10] — 2026-11-10

### Added

- With `vault.images.auto` on, wrap-up draws the session's big moments and pictures for its new notes, and the other skills draw for the notes they create. Drawing comes last, after the report; "not now" leaves the job waiting. Nothing is drawn unasked without an Image Guidance note, and more than ten pictures become a fill offer.
- "Fill in the missing pictures": the apprentice lists notes with no picture (`gma image missing`), asks once, and draws ten at a time.
- `gma image status` names jobs still waiting to be drawn or placed; `gma image plan` takes its requests on stdin.

## [1.12.9] — 2026-11-10

### Changed

- Prep's opening read ends with a map: where every note the last Wrap-Up and the next Plan link lives, with its size, and the latest sessions' notes. Prep finds what it needs without searching the vault; on Canticle it took fewer turns and cost less.
- Prep's opening read leaves out the PCs' Backgrounds and the deferred world flags, which no prep plan used. `gma session-context --arcs` still prints the Backgrounds, and the default bundle the flags.

## [1.12.8] — 2026-11-10

### Added

- Reconcile now settles threads with you: it proposes which open threads to close or park, and writes only what you agree to.
- A Dormant Threads list for threads parked when the party left a place or arc. Prep leaves it out of the brief until the thread is woken or its names come up.
- Thread rows `hand` (give a PC's thread to another PC), `rest` (park a thread) and `wake` (bring it back).
- `gma vault-write wrapup-settle` ticks checklist items and strikes answered questions in the Wrap-Up.

### Changed

- Wrap-up writes only active threads; settled and dormant ones stay out of what prep reads.
- The player site never publishes a Dormant Threads heading: threads are parked only once the site's publish tool hides it, and the update offers the entry to vaults that keep their own hidden-headings list.
- Publish tool 1.70.6: `Dormant Threads` joins the hidden headings.

### Fixed

- A one-line comment no longer hides the threads next to it (#641).
- A thread closed from the Wrap-Up no longer needs to be on a list (#642).
- Settled checklist items and answered questions stop reappearing in prep (#643).

## [1.12.7] — 2026-11-10

### Added

- Pictures on a ChatGPT plan: choose Codex (`vault.images.source: codex`) and it draws with its own image tool on your plan, with no money counted. A Codex signed in with an API key is never used this way. See [docs/images.md](docs/images.md).
- An apprentice running inside Codex can draw the pictures with its own image tool (`vault.images.source: self`; `draw --picture N FILE` hands them in).
- What draws is always your choice: until `vault.images.source` is set, the apprentice asks.

### Fixed

- `gma image` works for an apprentice in a sandbox that may not write to the machine's cache folder (Codex's default): its picture jobs go to the temp folder instead, never the vault.

### Changed

- Publish tool 1.70.5: the `vault.images.source` setting (`codex`, `self` or `service`).

## [1.12.6] — 2026-11-10

### Added

- Pictures. Ask the apprentice for a portrait, a place, an insignia or a scene picture and it draws it with Google Gemini on your own key, looks at it, redraws once if it is wrong, and files it. Set-up and costs are in [docs/images.md](docs/images.md). Nothing is drawn unless you ask.
- `gma image` (`status`, `key`, `plan`, `draw`, `place`), with spending limits in the vault's settings under `vault.images` that the tool enforces. The key stays on your machine.
- An Image Guidance note for the campaign's look, from a new template the update offers to existing vaults. It never reaches the player site.

### Changed

- A document note may hold a `portrait`. Image ingest files pictures for heritage and document notes too.
- Publish tool 1.70.4: the `vault.images` settings, and the Image Guidance note is never published.

## [1.12.5] — 2026-11-09

### Fixed

- Session prep now reads the Wrap-Up's Reconciliation Context, World Evolution included. The prep bundle used to hide it behind a one-line stub, so a plan could follow rulings that reconcile had already replaced.

### Changed

- Thread ageing on a long campaign is faster: pairs that cannot match are skipped.

## [1.12.4] — 2026-11-09

### Added

- `gma section VAULT NOTE "Section/Sub"` prints one section of a note by heading path. Case does not matter, headings in code blocks are ignored, and a path that fits more than one heading is refused with the candidates listed.

### Changed

- `session-context` prints a PC's `###` subsections as an outline with sizes and paths, to fetch when needed: Current Status for Active PCs, and Background and GM Notes in `--arcs`. Open threads stay whole.
- session-prep reads an outlined subsection only when a step needs it.
- One section finder serves the Overview's Open Threads and the rest of the scripts. An unclosed code block now runs to the end of the note, as on the site.
- `gma section` takes `"## Heading/Sub"` to pin a heading's level, so a repeated name can still be fetched.

### In numbers

Measured on notes-only copies of three campaigns, in characters. How much each shrinks depends on how much of the campaign sits in PC subsections:

| | 1.12.3 | 1.12.4 | Change |
|---|---|---|---|
| `session-context --prep`, 4 PCs with long session logs | 155,196 | 129,610 | −16% |
| `session-context --prep`, 4 PCs with long GM Notes | 82,881 | 51,609 | −38% |
| `session-context --arcs`, the same 4 PCs | 42,546 | 11,274 | −74% |
| `session-context --prep`, 6 PCs | 127,035 | 118,171 | −7% |
| `session-context --arcs`, the same 6 PCs | 30,675 | 21,679 | −29% |
| Prep plan quality (blind judge, both orders) | | nothing lost to the outline | |

---

## [1.12.3] — 2026-11-09

### Added

- A shared `## Open Threads` list in the Campaign Overview, for threads two or more PCs share.
- `gma vault-write threads` adds, moves and closes threads. A closed thread is recorded in that session's Wrap-Up under `#### Resolved Threads`, with the line that ends it.
- Thread Tidy mode in campaign-qa, for going through the open threads. It closes ended threads and moves word-for-word duplicates without asking, the one campaign-qa check that fixes before you see it, and reports every change it made.
- Each PC page on the site shows the shared threads that name that PC. They are read from the Overview's Open Threads even when the Overview page does not publish, or sits in a folder the player site hides; GM-only text, spoilers and comments stay hidden (publish tool 1.70.3).

### Changed

- Wrap-up writes only open questions and obligations as threads: stopping points go to the Handoff and events to the recap. It puts shared threads on the shared list, and closes a thread only on a note that says it is over, telling you each time.
- `--threads` prints each thread once and whole. `--brief` and `--prep` stub the last Wrap-Up's Resolved Threads.
- `vw threads move` waits, as the update does, while the site's publish tool is older than 1.70.3.
- `vw status` warns when a rewrite of a PC's Open threads drops a thread, and points at `vw threads close` so the end is recorded.
- The `shared-threads` check moves threads that sit word for word on several PC sheets into the Overview's Open Threads. Struck-through ones go to the latest Wrap-Up's Resolved Threads. Threads in or next to hidden text stay put, with a notice.

### In numbers

Measured on a notes-only copy of a 16-session chapter (six PCs), after the update and one Thread Tidy:

| | 1.12.2 | 1.12.3 | Change |
|---|---|---|---|
| `session-context --threads` | 49,550 chars | 36,000 chars | −27% |
| `session-context --prep` | 157,760 chars | 126,922 chars | −20% |
| Threads lost from any PC page on the site | — | 0 | |

---

## [1.12.2] — 2026-11-08

### Changed

- The update now takes vaults from 1.11.0 on, and from here the oldest it takes moves up one minor release at every minor release. A vault behind is told which release to update with first, and how to run it from its download with Python alone.

### Removed

- The update's checks for 1.10 releases, which no vault it takes can need, and the publish tool's `google-fonts` question, which only they asked (publish tool 1.70.2).

### In numbers

| | 1.12.1 | 1.12.2 | Change |
|---|---|---|---|
| Checks the update carries | 40 | 13 | −67% |
| The two migration modules | 3,230 lines | 1,481 lines | −54% |
| All shipped vault scripts | 41,376 lines | 39,389 lines | −4.8% |
| `template-history.json` | 26,242 B | 18,573 B | −29% |
| What an install downloads (`skills/`, gzipped) | 1,249 KB | 1,222 KB | −2.1% |
| Test functions | 4,324 | 4,097 | −227 |
| Full Python suite, one local run | 429 s | 398 s | −7% |

No faster on a current vault (those checks never ran on one); the gain is upkeep. From here each minor release deletes the last minor's checks, so the update stays about this size.

## [1.12.1] — 2026-11-08

Codex and Cursor tested end to end on 1.12.0 (create a vault, prep, wrap-up, build the site locally, update).

### Fixed

- A first session is reconciled like any other: before, a tidy session 1 (the campaign's, or a chapter's in a vault that restarts numbering each chapter) was skipped, so its Wrap-Up and new notes stayed DRAFT for good (#618).
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
