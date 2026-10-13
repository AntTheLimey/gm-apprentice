# Configuration Reference

Everything about what the site publishes is a setting in the vault's
`_meta/vault-config.md`. The site's `vault.config.json` holds the
deployment keys (see § `vault.config.json`); a campaign setting an older
site still keeps there is read until the update moves it (see § Settings
left in `vault.config.json`).

## Settings

The publish tool holds the one list of settings. Never open the
settings file to read one, and never edit it by hand:
`node "$TOOL" settings --help` shows every verb (`list`, `describe`,
`get`, `set`, `add`, `remove`, `unset`, `check`). `$TOOL` is the
plugin's `gm-publish.js` (`SKILL.md` § The build tool).

Give `--config <dir>/vault.config.json`, which also counts settings
still left in the site file; with no site yet, `--vault <vault>`. A
bare `settings get` lists every setting with where its value came
from; the lines not marked `(default)` are the GM's own.

The GM asks in their own words; you find the setting with `list` and
`describe`, change it, rebuild, and say what changed. A change reaches
players only with the next build and deploy.

**When a setting stops the build.** A fault in a setting that hides
things from players stops the build, so nothing extra is shown by a
guess. Never mend a misspelt or old name by hand. Run campaign-qa's
Settings check, `python3
"${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/vault_check.py" <vault>
settings`: tell the GM its `fix:` lines, on a yes run it again with
`--fix`, and put what is left to the GM, above all whether something
was meant to be hidden.

> **Landing page state.** The landing hero (in-game date, session count) and the
> *Latest Session* card are driven by the **`_Campaign` overview frontmatter** —
> `current_game_date`, `sessions_played`, `last_session`, `last_play_date` — which
> the `session-wrapup` skill keeps current. The overview is located by its
> `type: campaign_overview` frontmatter (not by filename, so a renamed overview
> still resolves) and is read from the full vault corpus, so it applies even
> though the overview is normally excluded from publishing.

### Theme

A palette of the GM's own takes away the reader's light/dark button,
which only a genre preset's two palettes can offer. Say so before
setting one.

### Image optimization

`publish.images.optimize` needs the `cwebp` binary on `PATH`
(`brew install webp`, `apt install webp`). Without it the build warns
and copies the originals.

### Section index banners

Either drop a `_banner.*` file into the section's vault folder
(`Locations/_banner.svg`), or name one in `publish.banners`, which
wins. The setting is one map, so write it whole:

```bash
node "$TOOL" settings set 'publish.banners={"locations":{"image":"_attachments/sector-map.webp","link":"_attachments/sector-map.svg","alt":"Sector 7-G star chart"},"factions":"_attachments/factions-hero.svg"}' --config <dir>/vault.config.json
```

An **SVG with no `link` is inlined**, so its internal `<a>` elements stay
live — a star map whose nodes link to entity pages keeps working. Write
those hrefs relative to the index page (`corwin-system.html`). Anything
with a `link` renders as an `<img>` inside an `<a>`, since an outer
anchor would swallow an SVG's own links.

### Locations index grouping

`publish.locations.group_by` is matched as a case-insensitive
substring of `location_type`, so `system` matches both `system` and
`star system`. When fewer than two locations match, the list stays
flat: one section is not a grouping.

### Pinning landing entries

`settings add publish.landing.featured_npcs Hugh_Cavendish` pins
one. Name an entity the way a wiki-link does: the filename form, not
the display title. A pinned entity appears even if no session has
mentioned it. A name that resolves to no published page prints a build
warning; if it is spelled right, the page is probably excluded from
the site.

### Per-file field overrides

When one page needs a hidden field back, `publish.overrides.fields`
names the page and the fields. It is one map, so `get` it and write it
whole, keeping the notes already there:

```bash
node "$TOOL" settings set 'publish.overrides.fields={"Characters/NPCs/Vex Ambrose.md":{"include":["secrets"]}}' --config <dir>/vault.config.json
```

There is no per-file `exclude`; to strip a field from one page only,
remove it from that page's frontmatter. Whole files are included or
excluded through the publish manifest (`_meta/publish-manifest.md`),
not here — see `content-filtering.md`.

### Player-facing Wrap-Up sections

A Wrap-Up H2 outside the fenced `## GM Notes` is player-facing,
whatever it is called: it publishes unless `exclude_sections` names
it. Of these, `vault_check wrapup --fix` moves only a heading the
template keeps under GM Notes (`## World State`, `## Skipped Prep`),
back under it. It also renames a recap under another title to
`## Narrative Recap`, and notes a second recap-titled section without
touching it. Nothing lists player-facing sections any more:
the migration removes the old `publish.wrap_up.player_sections` key.

## Switches

`publish.site` says whether the vault has a site.

- **On, with `publish.site_dir` set.** Builds run, and `vault_check`
  `gm-leak`, `pc-body` and `wrapup` ask the site's publish tool what
  publishes.
- **On, with no `publish.site_dir`.** A site still to be set up. Those
  checks stop with one ERROR row that says to run the setup or turn
  the switch off.
- **Off.** `build` and `deploy` stop with one line and exit code 1.
  `gm-leak` gives one INFO row and checks nothing. Only `wrapup` runs
  without Node; `gm-leak` and `pc-body` still read the settings through
  the tool and stop with one line when Node is missing. Turning the
  switch off stops publishing without losing the folder's path.

`publish.character_sheets`, `publish.live_stats` and `publish.inbox`
decide what is published on the site.

**A deployed backend does not turn a switch on.** A site whose
Functions and KV store exist still builds without live stats and the
inbox until its switch is on, and gets a closing build warning naming
the switch. The setup commands write the switch for you
(`cloudflare-pages.md` § The fast way).

**The forcing rule.** Character sheets off turns live stats off even
when the live stats switch is on; the build prints one line saying so.
The inbox is independent of the other two.

**Functions follow their switch.** `build` and `deploy` keep the
site's `functions/` in step with the switches. A switch set to off, or
live stats forced off, removes that feature's files; a file you edited
is kept with a warning, and a switch that is not in the file removes
nothing. A removal reaches the live site only with the next deploy.

**On, but no KV store.** Live stats and the inbox need the site's
`wrangler.toml` to carry a real `INBOX` KV namespace id. Without one
the build warns and builds without that feature.

### With character sheets off

The vault does not change. The sheet stays in each PC note and
`sheet show` still prints it. On the site:

- The PC page's first tab is labelled "Character" and there are no
  Combat or Equipment tabs.
- The tab opens with a short identity strip, then the line "Character
  sheets aren't published for this campaign." When the PC lists
  `sheet_source` in `display_meta`, the line continues "This sheet is
  kept: <value>."
- The identity strip shows, where the note has them: Level, Class,
  Species and Background (D&D 5e); Level, Class, Ancestry, Heritage
  and Background (PF2e); Playbook, Heritage and Vice (FitD); the point
  total (GURPS); occupation and age (CoC). A value the page header
  already shows is not repeated.
  The header badges come from `display_meta`, which is your own
  choice, so a stat field listed there still shows and is published.
- There is no live status bar, and the roster page has no party board.
- With the inbox on the widget stays, as a question channel labelled
  "Ask the GM" (see `change-request-loop.md`).

Only these `##` sections of a PC note are published:

- `Background`, `Current Status`, `Notes`, `Relationships`,
  `Appearances`
- CoC: `Fellow Investigators`, `Encounters with Strange Entities`
- FitD: `Friends & Rivals`, `Long-Term Projects`
- any heading listed in `publish.pc_prose_sections`

Titles match case-insensitively, ignoring bold or italic wrapping and
a trailing colon. Every other section is withheld, including a
homebrew section the build does not recognise and any text before the
first `##` heading. Withheld text is left out of the page, the search
index and every other output. `publish.exclude_sections` still applies
on top, so `GM Notes` stays hidden as always.

**Heading-shift warning.** If a link or embed label in a PC note would
change the note's headings once resolved, the build cannot tell which
sections are safe. It withholds everything after the note's title and
prints:

```text
WARNING: <page>: a link or embed label changes this note's headings; nothing after its title is published while character sheets are off. Fix the label.
```

Fix the label in the note and rebuild.

## `vault.config.json` (in the site repo)

JSON file in the site directory. It holds six deployment keys and
nothing else: where the vault is, where the output goes and where the
site is hosted.

| Setting | Key | Description |
|---------|-----|-------------|
| Vault path | `vaultPath` | Path to the vault directory, relative to this file or absolute |
| Output directory | `outputDir` | Where generated HTML is written |
| Host | `host` | Where the site is deployed: `github-pages` (default, or when absent) or `cloudflare-pages`. See `cloudflare-pages.md`. |
| Site URL | `siteUrl` | Canonical base URL. For `cloudflare-pages` this **must** be the Cloudflare URL (e.g. `https://<project>.pages.dev`) — Cloudflare serves at the root, so a leftover `github.io` URL breaks the 404 page. |
| Cloudflare project | `cloudflarePagesProject` | Optional. Cloudflare Pages project name for deploys. Defaults to the site directory's folder name. |
| Preserve directories | `preserveDirs` | Output subdirectories to keep across builds |

## Settings left in `vault.config.json`

Campaign settings used to live in the site file under other names.
The build still reads them there and warns, naming each key; that is
planned to stop in plugin 1.11.0. Where both files set a setting with
one value, the vault file's is used; the hiding lists combine both
files and `publish.exclude_callouts` takes the stricter, so emptying
the vault's list does not un-hide what the site file hides.
`settings get` with `--config` gives the value the build uses. Do not
move them by hand: the migration does it.

### Moving the settings

From the plugin, run the migration against the vault. Show the GM the
plan first, then apply it on their yes:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/migrate.py" <vault> plan
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/migrate.py" <vault> apply
```

The move is the `config-to-vault` step under Will do. The migration
offers it whenever the site file still holds campaign settings,
whatever the vault's version.

It finds the site through `publish.site_dir` in the vault file and
asks that site's publish tool to do the move (`migrate-config`). Set
`publish.site_dir` first: without it the migration looks at the vault
file only and the site file's settings stay where they are. The move:

- writes each campaign setting under `publish:` and removes it from
  the site file. Only the old names are removed;
  any other key the site file holds is left as it is, and named in
  the output;
- merges exclude lists: the vault file's entries first, then the site
  file's entries that are not already there. It adds the sub-keys of
  `landing`, `images`, `banners` and `locations` that the vault file's
  map lacks, and keeps the stricter `exclude_callouts`;
- keeps the vault file's value where both files set a key, and reports
  the value it discarded;
- copies an old `backend` flag to `live_stats` / `inbox`. With no flag
  at all, it writes `true` for a feature that is deployed on the site
  (its Function and a real KV id are present), but only while the
  site file still holds old settings to move. A later run on a
  migrated site does not switch a feature back on. It never writes
  `character_sheets`;
- copies both files to `<file>.pre-migrate` first. An existing backup
  is never replaced;
- changes only the keys it moves in the vault file. Comments and
  layout elsewhere stay as written, with one exception: adding to an
  existing list in the vault file (a merged exclude list) rewrites that
  list, so comments inside it are lost, and the tool prints a note for
  each. A `theme:` block that gets a tagline gains only that one line.
  It writes nothing when the vault
  file cannot be edited safely (a `publish: {…}` written on one line,
  tab indentation, mixed line endings, YAML that does not parse).

Running it twice is safe: once the move is done, `plan` no longer
lists it. Exit code 0 means done or nothing to do, 1 a step failed, 2
bad arguments or a vault it does not migrate. The migration repins the
site's publish tool itself, as the first step under Will do, before it
asks the tool to move anything.
