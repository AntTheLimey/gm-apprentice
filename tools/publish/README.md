# gm-apprentice-publish

Static site generator for [gm-apprentice](https://github.com/AntTheLimey/gm-apprentice)
campaign vaults. Reads structured markdown files produced by the
campaign-organizer skill and outputs a self-contained HTML site suitable
for GitHub Pages or Cloudflare Pages.

## Requirements

Node 22 or later. Check with `node --version`.

## Vendored dependencies

This tool's runtime dependencies (`gray-matter`, `lunr`,
`markdown-it`, `yaml`, and their transitive deps) are **committed** under
`node_modules/` — an exception to the usual rule, enforced by a
negation at the bottom of the repo's root `.gitignore`.

This is deliberate. The gm-apprentice plugin distributes this tool
by **git-copying** the repo into the plugin cache
(`~/.claude/plugins/cache/gm-apprentice/.../tools/publish`). A
campaign site then pins it with a `file:` dependency, which npm
satisfies by **symlinking** the cache directory into the site's
`node_modules`. At build time Node resolves the symlink to its real
location and looks for the tool's own dependencies *there*, in the
cache — not in the site. Since `npm install` is never run against
the cached copy, the only reliable way for the dependencies to be
present is for them to travel with the git copy. Vendoring them
makes a fresh install build with zero extra steps, offline.

The alternative — having the consuming site install the deps — does
not work: Node resolves the symlinked tool from the cache path, so
the site's `node_modules` is never consulted (confirmed empirically,
including with `--preserve-symlinks`).

**Re-vendoring after a dependency change:** edit `package.json` /
`package-lock.json`, then:

```bash
cd tools/publish
rm -rf node_modules && npm ci --omit=dev
rm -rf node_modules/.bin node_modules/.package-lock.json
git add node_modules
```

The `runtime-deps` test fails if a declared dependency is not both
requireable and git-tracked, and the `clean-install` integration
test fails if a clean git-copy + symlinked site cannot build.

## Installation

**This tool ships inside the [gm-apprentice](https://github.com/AntTheLimey/gm-apprentice)
plugin and is not installed from the npm registry.** When you install the
plugin, the tool lands in the plugin cache, and the `publish-site` skill
drives it from there — the skill scaffolds a site whose `package.json`
pins the tool with a `file:` path into that cache, so every build uses the
exact version that matches your installed plugin. There is nothing to
`npm install` globally.

> The `gm-apprentice-publish` package on npm is **deprecated**. It stopped
> at 1.2.1, and that version leaks GM-only content onto the player site.
> Don't install it. To run the in-cache copy directly without the skill:
>
> ```bash
> node "<plugin-cache>/gm-apprentice/<version>/tools/publish/bin/gm-publish.js" <command>
> ```

## Releases and pinning from outside the plugin

Every version of this tool is tagged `publish-v<version>` (the version in
`package.json`, for example `publish-v1.11.40`) with a release that carries:

- `gm-apprentice-publish-<version>.tgz`, the `npm pack` output. The
  vendored runtime dependencies are bundled inside it
  (`bundleDependencies`), so it installs and builds with no registry
  access.
- `SHA256SUMS`, the checksum of that tarball.
- Notes listing only the `tools/publish` changes since the previous
  `publish-v*` tag.

These releases are never marked latest; the plugin's `v*` release stays the
repo's latest. A `publish-v*` tag is created once and never moved.
The workflow is `.github/workflows/publish-tool-release.yml`. It runs when
`tools/publish/package.json` changes on `main`, runs this tool's tests,
then packs, tags and releases.

A project outside the plugin (a site with no plugin cache) pins like this:

```bash
gm-apprentice-publish update-pin --site <site-dir> --tag publish-v1.11.40
```

That downloads the `.tgz` and `SHA256SUMS` from the release, verifies the
checksum (a mismatch aborts before anything is written), keeps the tarball
in `<site-dir>/vendor/`, points the site's `gm-apprentice-publish`
dependency at it (`file:vendor/gm-apprentice-publish-1.11.40.tgz`) and runs
`npm install`. `--check` reports whether the site is on that tag without
touching the network. To do it by hand, download both files from
`https://github.com/AntTheLimey/gm-apprentice/releases/tag/publish-v1.11.40`, run
`sha256sum -c SHA256SUMS` (`shasum -a 256 -c SHA256SUMS` on macOS), and use
the `.tgz` as a `file:` dependency. To see what a repin brings, diff tag to
tag: `git log publish-vOLD..publish-vNEW -- tools/publish`.

### Backfilling older tags (maintainer)

Run by the repo owner after the release workflow has merged; CI never
does. Each command creates a local annotated tag at the commit whose
`package.json` carries that version, and prints the push command. The
script refuses a wrong version or an existing tag.

```bash
scripts/backfill-publish-tag.sh 1.11.30 5779522
scripts/backfill-publish-tag.sh 1.11.39 95bdd0cf
git push origin refs/tags/publish-v1.11.30 refs/tags/publish-v1.11.39
```

Backfilled tags exist for tag-to-tag diffs only. They have no release or
tarball, so `update-pin --tag` works from `publish-v1.11.40` onwards.

## Quick start

**1. Scaffold a new site repo** (run the tool from the plugin cache; the
scaffold auto-pins itself to that version)

```bash
TOOL="<plugin-cache>/gm-apprentice/<version>/tools/publish/bin/gm-publish.js"
node "$TOOL" init my-campaign-site
cd my-campaign-site
```

This creates:

```text
my-campaign-site/
  package.json
  vault.config.json   ← edit this
  README.md
  css/overrides.css
  .gitignore
  .nojekyll
```

**2. Configure the site**

Open `vault.config.json` and set `vaultPath` to the absolute or relative
path of your gm-apprentice vault. That is the only key the site's file
holds. The rest of the site's settings live in the vault: set
`player_site.url` to the address you plan to publish to (e.g.
`https://username.github.io/campaign-name`) with
`settings set player_site.url=<address>`.

**3. Build** (the scaffold pinned the tool, so npm resolves it locally)

```bash
npm install   # links the pinned tool from the plugin cache (deps vendored)
npm run build
```

Output is written to the `docs/` folder. Push to GitHub and enable
GitHub Pages from the `docs/` folder in your repo settings.

---

## CLI reference

```text
gm-apprentice-publish init [dir]          Scaffold a new site
gm-apprentice-publish build [options]     Build the site from vault (--site player|gm)
gm-apprentice-publish serve [options]     Serve a built site to the home network (--site gm|player)
gm-apprentice-publish settings <cmd>      Read, set, describe and check any site setting
gm-apprentice-publish --version           Print version
gm-apprentice-publish --help              Print help
```

### `init [dir]`

Scaffolds a new site in `dir` (defaults to the current directory).
Refuses to overwrite existing files — run it in an empty directory
or provide a new directory name.

`init` also writes `player_site.publish: true` and `player_site.folder`,
the absolute path of the new site folder, into the vault's
`_meta/vault-config.yaml`. `update-pin` adds either to a vault that lacks
it and leaves a `publish: false` alone. `player_site.publish` says
whether the vault has a site: with it set to `false`, `build` and
`deploy` stop with one line and exit code 1, and nothing is built.
On a vault still on the old settings file (see
[The old settings file](#the-old-settings-file)), the same two settings
are `publish.site` and `publish.site_dir`, and every message names them
that way.

### `build [--site player|gm] [--config path]`

Reads `vault.config.json` (or the file at `--config path`) for the path to
the vault, then writes the generated site into the vault's
`player_site.output` folder (`docs` when unset). Cleans that folder before
each build, preserving any folders listed in `player_site.keep`. A
`player_site.output` or `player_site.keep` that is not a folder inside the
site folder stops the build before anything is deleted.

While `gm_site.publish` is on, `build` makes the player site and then the
GM site (the GM site alone when the player site is off); see
[The GM site](#the-gm-site). `--site player` or `--site gm` builds one.
`--site gm` with the GM site off stops with "The GM site is off for this
vault (gm_site.publish); nothing was built."

`build`, `deploy`, `setup-status-bar` and `setup-inbox` also run the vault's build steps, in order (see
[Build steps](#build-steps)). A dry build, `explain`, `manifest`,
`doctor --site` and the preview run none.

| Option | Default | Description |
|--------|---------|-------------|
| `--site <name>` | both while the GM site is on | Build one site: `player` or `gm` |
| `--config <path>` | `./vault.config.json` | Path to config file |

### `deploy [--verify] [--no-build] [--dry-run] [--ignore-leaks] [--json] [--config path]`

Builds the player site (unless `--no-build`) and puts it online on the
vault's `player_site.host`. Before anything is uploaded the leak check
reads the finished folder, after every build step, for hidden text (a
hidden sentence, list item or table cell of four words or more), a secret
name (`gm_aliases`, a withheld note's name) and the words
`player_site.never_show` lists, and stops on a finding. `leaks
list|check|accept|prune` run the same check without deploying, and an
accepted finding is not asked about again. `--ignore-leaks` uploads
anyway, on purpose: every finding is still printed, and nothing is
accepted. `--dry-run` prints what would run and runs the check on the
folder as it stands. `deploy --help` and `leaks --help` have the detail.

### `serve [--site gm|player] [--port N] [--config path]`

Serves a site that is already built to your home network, read only, so
the GM site can be opened on a tablet or phone at the table. It serves
the GM site unless `--site player` is given, on port 4321 unless `--port`
names another (a whole number from 1 to 65535). It prints the addresses
to open and runs until you stop it with Ctrl+C.

It builds nothing, watches nothing and asks for no passphrase. A folder
with nothing built in it (no `gm-build.json` for the GM site, no
`index.html` for the player site) stops it with the build command to run
first. It answers only GET and HEAD, never serves a file outside the
site's folder, and shows the site's `404.html` for a page that is not
there.

### `lines`

Answers what the build would publish, for text handed in on stdin.
`vault_check.py` uses it, so the vault checks never keep their own copy
of the build's filters. It takes no arguments: one
JSON request per input line, one JSON answer per output line, until
stdin closes.

| Request | Answer |
|---------|--------|
| `{"op":"published","text":…,"excludeSections":[…],"publish":"all"}` | `{"text":…}`: the body the site renders. `publish` is `all`, `stub` (with `include`, the page's `publish_include_sections`) or `none`. |
| `{"op":"sections","text":…,"excludeSections":[…]}` | `{"withheldBy":[…]}`: for each line of `text`, the excluded section withholding it, or `null`. |
| `{"op":"stub","text":…,"include":[…]}` | `{"kept":[…]}`: for each line of `text`, whether a stub page keeps it. |
| `{"op":"site","vault":…}` | `{"publishes":…,"site":…,"siteDir":…}`: whether the vault's settings file has a site section, whether its site is on (`player_site.publish`; unset, a `player_site.folder` says on), and the absolute path that folder names (`null` when the site is off or no folder is named). |

A request that cannot be answered gets `{"error":…}` and the process
carries on. That includes a malformed one: `text` must be a string, and
`excludeSections` (and `include`, where it applies) must be present and
a list of strings.

### `settings <cmd>`

Reads, writes, describes and checks the settings in the vault's
`_meta/vault-config.yaml`. Every setting is declared once, in
`lib/settings/registry.js`; the command works from that list.

```text
settings get [<name> ...]          What each setting is now, and where that came from
settings describe <name>           What one setting does, what it takes, its default
settings list                      Every setting that can be set
settings check                     The faults in the file; exits 1 when one stops the build
settings set <name>=<value> ...    Write settings, all or none
settings unset <name> ...          Remove settings from the file
settings add <name> <entry> ...    Add entries to a list setting
settings remove <name> <entry> ... Take entries out of a list setting
settings raw [<name>]              The file as written
settings move [--check]            Take a vault from the old settings file to the new one
settings setup-note <get|set|clear> The publish set-up guide's note to itself
```

`--create` lets `set` make the settings file when the vault has none yet.
`--vault <dir>` names the vault; without it the command uses the
`vaultPath` in the site's `vault.config.json`.

```bash
node "$TOOL" settings set player_site.features.connections=web
node "$TOOL" settings add player_site.hide.sections Rumours
node "$TOOL" settings get player_site.landing
```

A list whose entries have several parts, such as the extra menu entries,
takes one entry a call, each part written `name=value`; `remove` takes the
entry's label:

```bash
node "$TOOL" settings add player_site.menu_extra label=Gazetteer link=gazetteer/index.html group=World
node "$TOOL" settings remove player_site.menu_extra Gazetteer
```

A setting's old name (`publish.search` and so on) still works for now.
The command does the same thing and prints a line saying what the
setting is called now.

`settings --help` prints the options and `settings list` the names; the
generated page `docs/site-settings.md` holds the full tables. A fault on
a setting that hides material stops `build`, `deploy` and the other
publishing commands until it is fixed.

## Build steps

A site's own work around the build (tidying images, folding style sheets,
writing extra pages) is a list of commands in the vault's settings:

```yaml
player_site:
  before_build:
    - node scripts/fetch-maps.js
  after_build:
    - node scripts/tidy-images.js
```

`before_build` runs before the pages are written and `after_build` after
every page is written. The tool prints each command before it runs it, runs
them in order in the site folder (with the site's `node_modules/.bin` on the
path, as `npm run` gives a script), and stops the build when one fails or
takes longer than ten minutes. Nothing is published after a failure. Only
`build`, `deploy` and the two set-up commands that build before they
deploy (`setup-status-bar` and `setup-inbox`) run steps; a dry build, `explain`, `manifest`,
`doctor --site`, the live preview and `deploy --no-build` do not. Build
scripts an older site keeps in its `package.json` are carried across by
`settings move` once the site's tool is 1.24.0 or later. Until then
`deploy` keeps running those scripts for a site that has not been moved.

The steps under `player_site` never run for the GM site. Its own go under
`gm_site.before_build` and `gm_site.after_build`, and run in the same site
folder. Every step is given `GM_APPRENTICE_SITE` (`player` or `gm`) and
`GM_APPRENTICE_OUTPUT` (the folder that site is built into).

## The GM site

The GM site is a second build of the same vault, for the GM at the table:
every note and the hidden parts, each marked with why players
do not see it. It never goes online.

- `settings set gm_site.publish=on` turns it on. With no `gm_site.folder`,
  it makes a folder beside the player site folder, named after it with
  `-gm` added, and writes that path to `gm_site.folder`. With no
  `player_site.folder` either, it asks for the folder to be named.
- The GM folder holds built pages only; it uses the player site folder's
  installed tool. It cannot be the player site's folder, inside it, or
  hold it, and it cannot be in the vault. A GM folder inside a git
  repository builds with a warning not to push it.
- Every GM page carries a "GM copy: not for players" band,
  `<meta name="robots" content="noindex, nofollow">` and
  `<meta name="gm-apprentice-build" content="gm">`. A page players do not
  get at all also says why. The folder holds `gm-build.json` (the tool
  version and build time; `built` is `null` until the build has
  finished, so a `null` means the last build stopped part-way) and a
  `robots.txt` that turns every search engine away.
- `deploy` builds only the player site, and refuses an output folder that
  holds `gm-build.json` or a page with the GM meta tag, with
  `--no-build` too.
- The live status bar, the inbox and the party board stay on the player
  site.
- What it shows is set by the `gm_site.show.*` switches, and any per-site
  `player_site` setting can be written under `gm_site` for the GM site
  only. The full list is in `docs/site-settings.md`.

## The new settings, by group

Each is set with `settings set`, `add` or `remove`, and each has a row on
the generated page `docs/site-settings.md`.

| Group | Settings |
|-------|----------|
| The site itself | `player_site.url`, `host`, `output`, `cloudflare_project` and `keep` (these five were keys of the site's `vault.config.json`); `before_build` and `after_build` (the build steps); `menu_extra` (extra menu entries, each with a `label`, a `link` and optionally a `group`) |
| The landing page | `player_site.landing.banner.title`, `text`, `link` and `image`: a banner across the top of the landing page, with nothing shown until one is set. The text goes through the same audit as any page |
| Character sheets | `player_site.sheets.header_facts`: the fields a PC page shows as badges beside the player's name, when the note has no `display_meta` of its own |
| What gets published | `player_site.withheld_words.person`, `place` and `thing`: the words printed in place of a withheld note's name |
| Limits | `player_site.limits.timeline_events`, `recap_chars`, `card_excerpt_chars`, `card_fact_chars`, `card_title_chars`, `card_facts`, `list_goals` and `list_relationships`: how many entries a list shows and how long a piece of text runs before it is cut. A number below its floor, a fraction, or text that is not a number is a warning, and the built-in number is used (a whole number written in quotes is read as that number) |
| The vault | `vault.statuses.out_of_play` (statuses that take a character off the party board), `vault.statuses.fallen` (the ones listed under "Fallen"; each must also be out of play) and `vault.statuses.gone` (things that no longer exist, left off the landing page's recent rows) |

The generated page holds each setting's meaning and built-in value; this
list only says where to look.

## Where a vault keeps its settings

| File | Holds | Who writes it |
|------|-------|---------------|
| `_meta/vault-config.yaml` | The settings: choices the GM makes | The GM, or the `settings` command |
| `_meta/vault-state.json` | Bookkeeping the tools keep, such as the publish set-up note | The tools only |
| `_meta/vault-notes.md` | The GM's own notes about the vault, if any | The GM. Nothing reads it as a setting |

The settings file is plain YAML with nothing else in it: no frontmatter,
no prose. It holds four names at the top: `version` (the layout's number,
`1`), `vault` (what is true of the vault whatever site it has),
`player_site` (the site the players see) and `gm_site` (the GM's own copy;
see [The GM site](#the-gm-site)). A setting is a path through those names:
`player_site.hide.sections` is `sections` inside `hide` inside
`player_site`.

```yaml
version: 1
vault:
  system: coc-7e
  setting_year: 1925
player_site:
  publish: true
  title: The Long Night
  hide:
    folders:
      - GM
  features:
    connections: web
```

Rules for editing it by hand:

- Leave a setting out and it takes its default. A key written with
  nothing after it counts as not set, except the four switches
  `player_site.publish`, `player_site.sheets.show`,
  `player_site.features.live_stats` and `player_site.features.inbox`:
  left empty, those are a fault and read as off.
- A hiding list written in the file replaces the built-in list; it does
  not add to it. `settings add` starts from the built-in list, so use it
  when you want to add one entry.
- A switch takes `true` or `false`, or `yes`, `no`, `on` and `off`, in any
  case.
- A name the list does not know stops a player build when it sits at the
  top, inside `vault` or `player_site`, or inside `hide`, and gets a
  warning elsewhere. A hiding list under an old name (a top-level
  `publish:` block, or `player_site.exclude_sections`) hides nothing, so
  it stops the build and the message names the right name.
- Comments and order survive when the command changes the file.

A [JSON Schema](schema/vault-config.schema.json) for the file is generated
from the list, and the format is described for tool authors in
[docs/vault-config-format.md](../../docs/vault-config-format.md). Point an
editor at the schema to get names and values as you type.

### The old settings file

Vaults made before this layout keep their settings in the frontmatter of
`_meta/vault-config.md`, under `publish:`. Release 1.10.54 moves vaults to
the new file. This tool keeps reading the old file for two releases after
that one, and every message names the file the vault is on and
each setting as that file writes it (`publish.site`, not
`player_site.publish`). The `settings` command can still change an old
file, at the old names.

`settings move` takes a vault to the new file. It checks that every
setting would resolve to what it resolved to before, then writes
`_meta/vault-config.yaml`, moves bookkeeping into
`_meta/vault-state.json` and your own notes into `_meta/vault-notes.md`,
and removes the old file. It does all of it or none of it; `--check` shows
what it would do. The plugin's update normally runs it for you. Running
it by hand is safe: when the tool installed in the vault's site is older
than 1.23.0, whoever pinned it, that tool could not read the new file,
so the move leaves the vault on the old file and says so in one line.
The vault moves once that tool is 1.23.0 or later. `--discard-old-file`
removes a left-over old file that holds more than the new one;
`--site-tool-updated` is for a caller that has just repinned the site.
`--fold-site-file` is for a vault that has already moved while its site
folder's `vault.config.json` still holds settings that differ from the
vault's. Without it the command only reports them and changes nothing.
With it, those settings come out of the site file and what they say goes
into the vault: a hiding list's entries are added to the vault's list
(the built-in entries stay), the stricter of two callout rules is kept,
and for any other setting the vault's own value stays. The two files
change together or not at all. Add `--only <key>` (repeatable) to take just the named keys of the
site file, or `package.json` for its build steps; every other key is
left where it is.
If both
files exist the new one is read, and the old one is reported as left over.

---

## vault.config.json reference

The site folder's `vault.config.json` holds one key:

| Field | Type | Description |
|-------|------|-------------|
| `vaultPath` | string | Path to the vault directory (resolved relative to the config file) |

Every other choice about the site is a setting in the vault (see
[Where a vault keeps its settings](#where-a-vault-keeps-its-settings)).
The five keys that used to sit here are now:

| Old key | Setting |
|---------|---------|
| `siteUrl` | `player_site.url`: canonical base URL. For `cloudflare-pages` set it to the `.pages.dev` (or custom) URL; Cloudflare serves at the root, so a `github.io` URL breaks the 404 page (the build warns) |
| `host` | `player_site.host`: `github-pages` (the default) or `cloudflare-pages`. Affects only the deploy step, not the built output |
| `outputDir` | `player_site.output`: the folder the pages are written to, inside the site folder (`docs` unless set) |
| `cloudflarePagesProject` | `player_site.cloudflare_project`: the Cloudflare Pages project name; the site folder's name unless set |
| `preserveDirs` | `player_site.keep`: folders of the output kept across builds (e.g. `["superpowers"]`) |

While the site file still holds these keys and the vault sets none, the
tool reads them from the site file. On a vault with the new settings file
it warns that the next update moves them; a site whose own tool is older
than 1.24.0 keeps them there.

### Keys an older site file may still hold

A vault on the old settings file (`_meta/vault-config.md`) still reads
these from the site file. A vault on `_meta/vault-config.yaml` does not
read them, and `settings move` carries them across.

| Field | Type | Description |
|-------|------|-------------|
| `siteTitle` | string | Site name shown in the nav bar and page title |
| `landingTagline` | string | One-sentence campaign hook shown on the landing page hero |
| `attachmentsDir` | string | Subfolder inside `vaultPath` that holds images (default `_attachments`) |
| `folderMap` | object | Maps vault folder paths to site output paths (see below) |
| `excludeDirs` | array | A vault on `_meta/vault-config.yaml` does not read it, and it stops the build there (use `player_site.hide.folders`). Vault subdirectories to skip entirely (e.g. `["_meta", "_Templates"]`). Added to `publish.exclude_dirs` in `_meta/vault-config.md`: either source can add to the skip list, neither shadows the other. Entries are normalized (a trailing slash, a leading `./`, backslashes, and an absolute path inside the vault are all rewritten to the same vault-relative spelling the scanner uses) and matched case-insensitively |
| `excludeSections` | array | A vault on `_meta/vault-config.yaml` does not read it, and it stops the build there (use `player_site.hide.sections`). Section headings to strip before rendering, at any heading level (e.g. `["GM Notes"]`) |

### folderMap

`folderMap` controls which vault folders become pages and where they
appear in the output. Keys are paths relative to `vaultPath`; values
are paths relative to the output folder (`player_site.output`).

```json
{
  "folderMap": {
    "Characters/NPCs": "characters/npcs",
    "Locations": "locations",
    "Factions & Organizations": "factions"
  }
}
```

Files in unmapped folders are silently skipped. Files without a
`type` frontmatter field are also skipped regardless of folder.

### Default folderMap

The scaffold template provides this default, matching the standard
campaign-organizer vault structure:

```json
{
  "Characters/PCs": "characters/pcs",
  "Characters/NPCs": "characters/npcs",
  "Locations": "locations",
  "Factions & Organizations": "factions",
  "Items & Artifacts": "items",
  "Creatures": "creatures",
  "Events": "events",
  "Documents": "documents",
  "Clues": "clues",
  "_Campaign": "campaign"
}
```

---

## Page templates

The `type` frontmatter field determines which template renders each page.

| type value | Template | Notes |
|------------|----------|-------|
| `pc` | Player character | Accordion sections from H2 headings |
| `npc` | Non-player character | Header card + body content |
| `location` | Location | Header card with parent breadcrumb |
| `creature` | Creature | Combat stat block + body |
| `item` | Item | Stat block + body |
| `faction` / `organization` | Faction | Goals, leadership, auto-generated member list |
| `event`, `clue`, `document`, `chapter`, `scene` | Smart wiki | Frontmatter badges + body |
| `session` | Smart wiki | Frontmatter badges + body; once the session's Wrap-Up publishes, the body is withheld everywhere and replaced by the chapter, in-game date and the opening of the Wrap-Up's recap, linked to it |
| anything else | Smart wiki | All frontmatter shown as badges |

Pages with `canon_status: SUPERSEDED` resolve wiki-links to the
superseding entity and show a `Superseded` badge. The legacy field
names `source_confidence` and `confidence` are still honored at read
time for vaults that haven't run the 1.8.0 migration.

### Landing page (dashboard)

The root `index.html` is a campaign dashboard generated from vault data.
It includes these sections (each omitted if no relevant data exists):

- **Banner** — a title, text, link and picture across the top, shown only
  when `player_site.landing.banner.*` sets one
- **Hero** — campaign image (from `player_site.theme.campaign_image` in
  `_meta/vault-config.yaml`), site title, last-played date, and in-game
  date (from `vault.setting_year` in the same file)
- **Story So Far** — first paragraph of the most recent played session's
  `## Narrative Recap` section, with a link to the full session page
- **The Team** — PC cards with portrait (or initials fallback), status
  badge, and `key_traits` or `occupation`; a character whose status is in
  `vault.statuses.out_of_play` leaves this row and is listed under
  "In Memoriam"
- **Key NPCs** — up to 8 NPCs scored by session mentions, relationship
  count, and tag signals
- **Explore** — compact grid of category index pages with entry counts,
  excluding PC and NPC categories (those have dedicated sections above)

### Section index banners

Put a hero image or a clickable map at the top of a section index. Either
drop a `_banner.*` file in the section's vault folder
(`Locations/_banner.svg`), or name one explicitly:

```yaml
player_site:
  lists:
    banners:
      locations:
        image: _attachments/sector-map.webp
        link: _attachments/sector-map.svg    # optional, click-through target
        alt: Sector 7-G star chart
      factions: _attachments/factions-hero.svg   # shorthand: image only
```

Keys are output directories (`locations`, `factions`, `items`, …), not
vault folders. Config wins over the conventional file. Accepted
extensions, in preference order: `svg`, `webp`, `avif`, `png`, `jpg`,
`jpeg`, `gif`.

**SVG with no `link` is inlined**, so its internal `<a>` elements stay
clickable — a star map whose nodes link to entity pages keeps working.
An `<img>` would not run those links, and wrapping the SVG in an outer
anchor would swallow them, so anything with a `link` renders as an
`<img>` inside an `<a>` instead. That's the "raster on the page,
full-size SVG behind it" shape.

Because an inlined SVG lands in `<section>/index.html`, its internal
hrefs must be written relative to that page (`corwin-system.html`, or
`../characters/npcs/rook.html`).

Assets are copied to `docs/images/banners/<section>/`, namespaced by
section so the conventional `_banner.*` sitting in two different folders
can't collide. A banner path that resolves outside the vault, or names a
file that doesn't exist, prints a warning and is skipped rather than
failing the build. Banners apply to generated index pages; a section with
an authored `index.md` renders that page instead.

### Locations index grouping

When a campaign's geography funnels through one political root
(`Republic → Sector → System → planet`), the default Locations listing is
a single deep tree. Pivot grouping gives each mid-level node its own
section:

```yaml
player_site:
  lists:
    locations:
      group_by: system                    # matched against location_type
      ungrouped_label: Deep Space & Routes
```

`group_by` is a case-insensitive substring of `location_type`, so
`system` matches `star system` too. The `scifi` genre defaults it to
`system`; other genres leave grouping off, and `group_by: false` turns a
genre default back off.

Every location stays a first-class row with its own thumbnail and type
badge, with children nested beneath it. Only the scaffolding *above* the
pivot is collapsed, into a context caption. Locations with no matching
ancestor collect under `ungrouped_label`. Fewer than two matches falls
back to the flat view — one section is not a grouping.

### Player-site image filtering

On the player site, only images referenced by the published
pages are copied to the output — with or without a publish list.
This prevents GM-only images (maps, handouts, portraits of hidden NPCs)
from leaking into the public site.

`scanAttachments` also honours `excludeDirs`/`player_site.hide.folders`, so
a vault-relative folder listed there (including a subfolder of the
attachments tree, e.g. `_attachments/gm-maps`) never reaches the scan at
all, in either mode.

### Theme fonts

`player_site.theme.fonts.heading`/`.body` name Google Fonts families by
default, and the build emits a `fonts.googleapis.com` `@import` at the
top of `css/theme.css` — every visitor's browser then requests the font
directly from Google, and the build prints a warning saying so. Two ways
to opt out:

**`source: self-host`** (the setting new vaults get) downloads each
non-generic heading/body family from Google Fonts at build time, once,
and serves it from your site. Regular and bold, roman and italic are
fetched, with Google's `unicode-range` subsets kept, and the files are
served unmodified (they are OFL-licensed). They are cached in the vault
at `_meta/font-cache/<family>/` (`_meta/` is never published), so later
builds work offline and produce the same site. If a font is not cached
and the download fails, the build warns and the family falls back to
its CSS stack; it never falls back to a Google import. Existing vaults
keep `source: google` until you change it. The scifi preset's Rajdhani
is self-hosted too.

```yaml
player_site:
  theme:
    fonts:
      heading: IM Fell English
      body: Cormorant Garamond
      source: self-host    # 'google' (code default) | 'self-host' | 'local'
```

**`source: local`** self-hosts font files you supply:

```yaml
player_site:
  theme:
    fonts:
      heading: Cinzel
      body: Inter
      source: local
      files:
        - family: Cinzel
          path: _attachments/fonts/Cinzel-Regular.woff2
        - family: Inter
          path: _attachments/fonts/Inter-Regular.woff2
          weight: 400       # optional, default 400
          style: normal     # optional, default normal
```

Each `files` entry is copied from the vault (path resolved relative to
`vaultPath`, same safety rule as `campaign_image`) into the site's
`fonts/` directory — under its **full relative path**, not just its
filename, so `_attachments/fonts/Cinzel-Regular.woff2` lands at
`fonts/_attachments/fonts/Cinzel-Regular.woff2`. This is deliberate:
two font files that happen to share a filename in different subfolders
(`fonts/Cinzel/Regular.woff2` and `fonts/Inter/Regular.woff2`) must not
overwrite each other. `theme.css` gets an `@font-face` rule per entry,
referencing that same path, instead of the Google import. `path` must
end in `.woff2`, `.woff`, `.ttf` or `.otf` — anything else (a mistyped
path pointing at a GM's own note, say) is rejected with a warning and
never copied. `source: local` with no `files` emits no import at all —
fonts fall back to whatever stack `cssFontValue` supplies
(`'<family>', serif`/`sans-serif`), so pair it with a generic
`heading`/`body` (`system-ui`, `serif`, …) if you don't intend to ship
font files.

A genre preset's own CSS can also hardcode a Google Fonts import
independent of `theme.fonts` — the `scifi` preset's Rajdhani heading
font is one (`css/themes/scifi.css`). `source: local` strips that
import from the copied preset CSS too, so nothing in the built output
ever requests fonts.googleapis.com or fonts.gstatic.com. Without a
`files` entry supplying Rajdhani yourself, the scifi preset's heading
font falls back to the next family in its own stack (a condensed
system font, then `sans-serif`) rather than rendering as Rajdhani.

### Sheet skins and frames

A PC page can wear a skin, and its portrait a frame. Set them under
`player_site.sheets` in `_meta/vault-config.yaml` for the campaign, or in
a `type: pc` note's frontmatter for one character (which wins).

```yaml
player_site:
  sheets:
    skin: ledger      # plain (default), parchment, case-file, console, ledger
    frame: thorns     # ring, laurel, thorns, gilt, steel, corners, hex, cracked, none
```

With no `frame` a skin wears its own frame.

### Image optimization

Off by default: images are copied byte-for-byte. Turn it on in
`_meta/vault-config.yaml` and PNG/JPEG attachments are re-encoded to WebP
as they are copied, with the `<img src>` written to match:

```yaml
player_site:
  images:
    optimize: true    # default false
    format: webp      # the only supported target today
    max_width: 1600   # 0 disables resizing
    quality: 82
```

On a portrait-heavy campaign this is the single biggest weight on the
published site — one real vault of 89 portraits went from 164 MB to
11 MB.

Requires the **`cwebp`** binary on `PATH` (`brew install webp`,
`apt install webp`). If it isn't found the build prints a warning and
copies the originals unchanged, so a missing encoder never breaks a
build. Images that would grow when re-encoded keep their original bytes,
and SVG, GIF, WebP and AVIF are always passed through untouched.

Because the tool owns both the image copy and every `<img src>`, it
converts and re-references in one pass. An external script run after the build that
rewrites `src` attributes after the fact has to string-match paths the
tool URL-encodes (`images/Rock%20Lavey.jpg`), and silently misses every
filename containing a space.

---

## Library API

Install as a dependency and import the functions directly:

```js
const {
  build,
  scanVault,
  buildLinkMap,
  scanAttachments,
  slugify,
  mapFolder,
  processContent,
  extractSections,
  resolveWikiLinks,
  filterSections,
  stripDataview,
  stripLeadingH1,
  renderRelationships,
  relativePath,
  escapeHtml,
  resolveImageEmbeds,
  templates,
} = require('gm-apprentice-publish');
```

### High-level

**`build(options?)`**

Runs the full build pipeline. `options.configPath` sets the config file
path (default `./vault.config.json`). Logs progress to stdout. Throws on
config parse errors; logs per-page render errors and continues.

### Scanner

**`scanVault(config)`**

Walks the vault, parses frontmatter, and returns an array of page
objects. Skips files with no `type` field and files in unmapped or
excluded folders.

**`buildLinkMap(pages)`**

Returns a `{ title: outputPath }` map used to resolve `[[wiki-links]]`.
Handles aliases and SUPERSEDED redirects.

**`scanAttachments(config)`**

Returns a `{ filename: { sourcePath, relPath } }` map of all images in
`attachmentsDir`.

**`slugify(name)`**

Converts a filename into a URL-safe slug. Strips apostrophes, replaces
`&` with `and`, collapses non-alphanumeric runs to `-`.

**`mapFolder(vaultRelPath, folderMap)`**

Returns the output directory for a given vault-relative path, or `null`
if unmapped.

### Processor

**`processContent(page, linkMap, excludeSections?, imageMap?, options?)`**

Returns `{ html, relationships, warnings }` for the page body. Resolves
wiki-links, embeds images, strips excluded sections and GM-only markers,
and runs the markdown-it renderer. Pass `options.usedImages` (a `Set`) to
track which image basenames were referenced during rendering.

**`extractSections(markdown)`**

Returns an array of `{ title, id, html }` objects split on H2 headings.
Used by the PC template for accordion panels.

**`resolveWikiLinks(markdown, linkMap, currentOutputPath)`**

Replaces `[[wiki-link]]` and `[[wiki-link|alias]]` with relative HTML
anchors computed from `currentOutputPath`.

**`filterSections(markdown, excludeHeadings)`**

Removes each section whose heading appears in `excludeHeadings`, at any
level, down to the next heading of that level or shallower. It reads
headings two ways, the renderer's parser and a plain `#` pattern at the
margin, and takes whichever withholds more: a section starts at a
heading either one sees (underlined, indented, inside a blockquote or
list) and ends only at one both see, so a `#` line in a code block or a
line with `---` under it does not end it. With the PC keep-list in
force (character sheets off) the exclude list is applied the same way
first.

**`stripDataview(markdown)`**

Removes Obsidian Dataview code blocks.

**`stripGmOnly(markdown)`**

Strips content between `<!-- gm-only -->` / `<!-- /gm-only -->` markers.
Returns the cleaned string, or `{ text, warnings }` if an unclosed
marker is detected.

**`stripLeadingH1(markdown)`**

Removes the first H1 heading from body content (the page title is
rendered separately by the template).

**`renderRelationships(frontmatter, linkMap, currentOutputPath)`**

Renders the `relationships` frontmatter array as an HTML list with
linked entity names.

**`resolveImageEmbeds(markdown, imageMap, currentOutputPath, usedImages?)`**

Replaces Obsidian `![[image.jpg]]` embeds with standard HTML `<img>` tags.
If `usedImages` (a `Set`) is provided, each resolved image basename is
added to it.

**`filterFields(frontmatter, excludeFields, overrides?)`**

Returns a shallow copy of `frontmatter` with `excludeFields` removed.
Per-entity `overrides.include` can re-include specific fields.

### Templates

**`templates`**

An object exposing `pcTemplate`, `npcTemplate`, `creatureTemplate`,
`locationTemplate`, `itemTemplate`, `factionTemplate`, `wikiTemplate`,
`indexTemplate`, `landingTemplate`, `fourOhFourTemplate`, and `generateNav`.
Template signatures vary slightly — most accept
`(page, processed, navFor, config, imageMap)`, but `pcTemplate` adds a
`sections` param, `itemTemplate`/`factionTemplate` add `linkMap` for
relationship resolution, and `landingTemplate` accepts
`(pages, navFor, config, publishConfig)`. See `lib/build.js` for exact usage.

---

## Guided setup

For a step-by-step walkthrough aimed at non-technical users, use the
`publish-site` skill in [gm-apprentice](https://github.com/AntTheLimey/gm-apprentice).
It handles GitHub Pages setup, troubleshooting, and schema migrations.

---

## License

MIT
