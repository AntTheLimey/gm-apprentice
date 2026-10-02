# Configuration Reference

Everything about what the site publishes is set in one place: the
`publish:` block of `_meta/vault-config.md` in the vault. The site's
`vault.config.json` holds only deployment settings (see
§ `vault.config.json`).

## `_meta/vault-config.md` (in the vault)

YAML frontmatter under `publish:`. A setting left out uses its
built-in default. Setting an exclude list replaces the built-in list
rather than adding to it, so repeat the default entries you still
want.

```yaml
publish:
  site_title: "The Iron Crown"
  mode: player
  system: gurps-4e
  folder_map:
    Characters/PCs: characters/pcs
    Characters/NPCs: characters/npcs
    Locations: locations
  attachments_dir: _attachments
  exclude_dirs: ["_meta", "_Templates", "_resources"]
  exclude_callouts: true
  theme:
    tagline: "A GURPS Special Forces campaign set in 1990s Britain."
```

| Setting | Key path | Description |
|---------|----------|-------------|
| Publish mode | `publish.mode` | `player` or `full` |
| Site title | `publish.site_title` | Name shown in the nav bar and browser tab |
| Landing tagline | `publish.theme.tagline` | One-sentence hook under the title on the landing page (default: none) |
| Footer | `publish.footer` | Text for the footer of every page (default: none) |
| Search | `publish.search` | `false` (or `no`, `off`) leaves out the search index (default: `true`) |
| Game system | `publish.system` | Selects the PC character-sheet renderer. Values in `schema-reference.md` § Site-level configuration fields |
| Folder map | `publish.folder_map` | Maps vault folders to site output paths. A folder holding typed pages with no entry is skipped with a build warning. Default: empty; `init` writes the standard map |
| Attachments directory | `publish.attachments_dir` | Vault folder holding images (default: `_attachments`) |
| Character sheets | `publish.character_sheets` | Switch (default: on). See § Switches |
| Live stats | `publish.live_stats` | Switch (default: off). See § Switches |
| Inbox | `publish.inbox` | Switch (default: off). See § Switches |
| PC prose sections | `publish.pc_prose_sections` | Extra `##` headings a PC page keeps when character sheets are off (default: none). See § Switches |
| Excluded sections | `publish.exclude_sections` | H2 headings to strip (default: `["GM Notes", "DM Notes", "Player Notes", "Source References", "Reconciliation Context", "Handoff to Reconcile"]`) |
| Wrap-Up player sections | `publish.wrap_up.player_sections` | Extra H2 titles on a Wrap-Up that count as player-facing, next to `## Narrative Recap` and `## Memorable Moments` (default: none). Read by `vault_check wrapup` only; see below |
| Excluded callouts | `publish.exclude_callouts` | Strip Obsidian callouts (`> [!type]`): `true` for all, or an array of types (default: `false`; scaffolded sites set `true`) |
| Excluded fields | `publish.exclude_fields` | Frontmatter fields to strip (default: `["secrets", "current_plan", "plan_progress", "gm_notes", "prep_notes", "reliability"]`) |
| Excluded directories | `publish.exclude_dirs` | Vault directories to skip (default: `["_meta", "_Templates"]`). Spelling is normalized (trailing `/`, leading `./`, backslashes, an absolute path inside the vault) and matched case-insensitively, so `"NPCs/Hidden/"` and `"npcs/hidden"` exclude the same folder |
| Landing NPC count | `publish.landing.max_npcs` | Cards in "NPCs in Play" (default: `6`) |
| Landing location count | `publish.landing.max_locations` | Cards in "Latest Locations" (default: `4`) |
| Landing recency window | `publish.landing.recency_window` | How many recent sessions feed the scoring (default: `3`) |
| Featured NPCs | `publish.landing.featured_npcs` | Pin NPCs to the front of their section, in order (see § Pinning landing entries) |
| Featured locations | `publish.landing.featured_locations` | Same, for locations |
| Quick links | `publish.landing.quick_links` | A short row of pinned links near the top of the landing page |
| Campaign image | `publish.theme.campaign_image` | Vault-relative path to hero image |
| Theme palette | `publish.theme.palette` | Colour scheme (primary, accent, background, text) |
| Theme fonts | `publish.theme.fonts` | Heading and body font families. `fonts.source: self-host` (new vaults) downloads the Google-hosted families once into the vault's `_meta/font-cache/` and serves them from the site, so visitors never contact Google (needs network on the first build only; a failed download warns and uses the fallback stack). `google` (the default for vaults that never set it) pulls custom families from Google Fonts at page load and the build warns about it; `local` self-hosts your own files instead — `fonts.files` lists `{family, path, weight?, style?}` entries copied into the site's `fonts/` (`path` must be `.woff2`/`.woff`/`.ttf`/`.otf`) and referenced with `@font-face` |
| Theme genre | `publish.theme.genre` | Genre tag for theming hints |
| Default light/dark mode | `publish.theme.default_mode` | Which palette a reader starts in: `system` (follow their OS, the default), `dark` or `light`. Readers switch with the ☀/☾ button in the nav, and their choice is remembered per site. The button appears only with a genre preset and no custom `theme.palette`, the themes that ship both palettes |
| 404 message | `publish.four_oh_four.message` | Custom in-world 404 text |
| Per-file field overrides | `publish.overrides.fields` | Re-admit an excluded frontmatter field for one named file (see § Per-file field overrides) |
| Section index titles | `publish.section_titles` | Override h1 titles on the Locations/Factions/Items/Creatures index pages |
| Exclude drafts | `publish.exclude_drafts` | When `true`, DRAFT entities are excluded entirely (default: `false`) |
| Image optimization | `publish.images` | Opt-in WebP re-encoding of copied images (default: off) |
| Section banners | `publish.banners` | Hero image or clickable map at the top of a section index |
| Locations grouping | `publish.locations` | Pivot the Locations index on a `location_type` (default: genre-derived) |
| CoC sheet crest | `publish.sheet_crest` | Vault-relative image for the Order crest / wax seal in the CoC investigator-sheet masthead. Renders only when set and the image exists. Campaign-wide — there is no per-PC override |
| Setting year | `setting_year` | Fallback in-game date on the landing page (used only when the campaign overview has no `current_game_date`) |

> **Landing page state.** The landing hero (in-game date, session count) and the
> *Latest Session* card are driven by the **`_Campaign` overview frontmatter** —
> `current_game_date`, `sessions_played`, `last_session`, `last_play_date` — which
> the `session-wrapup` skill keeps current. The overview is located by its
> `type: campaign_overview` frontmatter (not by filename, so a renamed overview
> still resolves) and is read from the full vault corpus, so it applies even
> though the overview is normally excluded from publishing. `setting_year` and
> `total_sessions` remain as fallbacks when those fields are absent.

### Section index titles

Section index pages (Locations, Factions, Items, Creatures) use neutral
titles by default. Genre presets restyle them: `military` gives "Theater
of Operations", "Intelligence Briefing", "Armory & Acquisitions",
"Bestiary"; `scifi` gives "Star Charts", "Powers & Interests",
"Hardware & Equipment", "Xenofauna"; `fantasy` and `horror` use
"Bestiary" for creatures. Override any of them in
`_meta/vault-config.md`:

```yaml
publish:
  section_titles:
    locations: "Star Charts"
    factions: "Powers & Syndicates"
```

Valid keys: `locations`, `factions`, `items`, `creatures`.

### Theme genre presets

`publish.theme.genre` accepts: `fantasy` (aliases: `adventure`),
`horror` (`gothic`, `cthulhu`), `noir` (`industrial`, `heist`),
`military` (`tactical`, `modern`), and `scifi` (`sci-fi`,
`science-fiction`, `space`, `space-opera`, `space-noir`). A preset
supplies the palette and fonts; a custom `publish.theme.palette`
overrides the preset colors. A live gallery of all presets built over
the same campaign is published from the repo's theme-showcase workflow.

### Image optimization

Off by default — images are copied byte-for-byte. When enabled, PNG and
JPEG attachments are re-encoded to WebP as they're copied, and the
`<img src>` is written to match:

```yaml
publish:
  images:
    optimize: true    # default false
    format: webp      # the only supported target today
    max_width: 1600   # 0 disables resizing
    quality: 82
```

Needs the `cwebp` binary on `PATH` (`brew install webp`, `apt install
webp`). Without it the build warns and copies the originals, so a
missing encoder never breaks a build. Images that would grow when
re-encoded keep their original bytes; SVG, GIF, WebP and AVIF are always
passed through. On a portrait-heavy campaign this is the biggest single
weight on the site — one real vault went from 164 MB to 11 MB.

### Section index banners

A hero image or clickable map at the top of a section index. Either drop
a `_banner.*` file into the section's vault folder
(`Locations/_banner.svg`), or name one explicitly:

```yaml
publish:
  banners:
    locations:
      image: _attachments/sector-map.webp
      link: _attachments/sector-map.svg    # optional click-through
      alt: Sector 7-G star chart
    factions: _attachments/factions-hero.svg   # shorthand
```

Keys are output directories (`locations`, `factions`), not vault
folders. Config wins over the conventional file.

An **SVG with no `link` is inlined**, so its internal `<a>` elements stay
live — a star map whose nodes link to entity pages keeps working. Write
those hrefs relative to the index page (`corwin-system.html`). Anything
with a `link` renders as an `<img>` inside an `<a>`, since an outer
anchor would swallow an SVG's own links.

Assets are copied to `docs/images/banners/<section>/`, namespaced so two
sections' `_banner.*` files can't collide. A path resolving outside the
vault, or a missing file, warns and is skipped rather than failing the
build.

### Locations index grouping

When a campaign's geography funnels through one political root
(`Republic → Sector → System → planet`), the default listing is a single
deep tree. Pivot grouping makes each mid-level node its own section
instead:

```yaml
publish:
  locations:
    group_by: system                    # matched against location_type
    ungrouped_label: Deep Space & Routes
```

`group_by` is a case-insensitive substring of `location_type`, so
`system` matches both `system` and `star system`. The `scifi` genre
defaults it to `system`; every other genre leaves grouping off. Set
`group_by: false` to turn a genre default back off.

Locations with no matching ancestor collect under `ungrouped_label`. The
scaffolding above the pivot (the Republic, the Sector) is demoted to a
small context caption rather than rendered as tree rows. Grouping is
skipped — falling back to the flat view — when fewer than two locations
match the pivot, since one section is not a grouping.

### Pinning landing entries

The landing page picks NPCs and locations by a recency score — how often
an entity appears in the last few sessions. That is a reasonable default
and a poor editor: a GM who knows which five NPCs matter this session
cannot express it, and entities tied on score are separated by nothing
more meaningful than where their files sit on disk.

`featured_npcs` / `featured_locations` pin entries to the front of their
section, in the order listed, with recency filling whatever slots remain
up to `max_npcs` / `max_locations`. A pinned entity appears even if it
scores nothing — an NPC no session has mentioned yet is still featurable.

```yaml
publish:
  landing:
    max_npcs: 6
    featured_npcs: ["Hugh_Cavendish", "Margaret_Cavendish"]
    featured_locations: ["Cavendish_Compound"]
    quick_links: ["Calcutta_City_Map", "Calcutta_Season_Calendar"]
```

Name entities the same way a wiki-link does — the filename form, not the
display title. A name that resolves to no published page prints a build
warning rather than being dropped in silence; if it is spelled right, the
page is probably excluded from the site.

Entities left unpinned still sort by score, and ties now break by title,
so the selection is at least reproducible and explainable.

### Per-file field overrides

`exclude_fields` strips a frontmatter field from every page. When one
page needs a stripped field back, name that page under
`publish.overrides.fields` and list the fields to re-admit:

```yaml
publish:
  exclude_fields: [secrets, gm_notes]
  overrides:
    fields:
      "Characters/NPCs/Vex Ambrose.md":
        include: [secrets]
```

The key is the **vault-relative path** of the note, extension included —
not its title, and not a glob. `include` is an allowlist checked against
`exclude_fields`: it re-admits a field that would otherwise be stripped,
and naming a field that isn't excluded does nothing. There is no
per-file `exclude`; to strip a field from one page only, remove it from
that page's frontmatter.

`fields` is the only key under `overrides` that the build reads. Whole
files are included or excluded through the publish manifest
(`_meta/publish-manifest.md`), not here — see
`content-filtering.md`. A build warns on any other
`publish.overrides.*` key rather than ignoring it silently.

### Extra player-facing Wrap-Up sections

`vault_check wrapup` treats every Wrap-Up H2 except the recap and
`## Memorable Moments` as Keeper-facing and, with `--fix`, re-nests it
under the fenced `## GM Notes`. A vault whose recaps carry more
player-facing sections lists their titles:

```yaml
publish:
  wrap_up:
    player_sections: ["What the Party Learned", "Where We Left Off"]
```

Titles match case-insensitively, ignoring bold or italic wrapping. A
listed H2 is never flagged or moved, and `--fix` keeps it after
Memorable Moments in its original order; one the GM already fenced
stays fenced. The list does not change what the site strips: hide
sections with `exclude_sections` as before. Absent or empty means
only the two default sections are player-facing.

## Switches

Three keys under `publish:` decide whether character sheets, live
stats and the at-table inbox are published.

```yaml
publish:
  character_sheets: true   # default: on
  live_stats: false        # default: off
  inbox: false             # default: off
```

| Key | Default | On | Off |
|-----|---------|----|-----|
| `publish.character_sheets` | on | Each PC page carries its character sheet | PC pages publish prose only (see § With character sheets off). Live stats are forced off |
| `publish.live_stats` | off | The live status bar on each PC sheet, and the roster page's party board updates live. One switch covers both | Sheets and the party board show the values in the vault |
| `publish.inbox` | off | The change-request widget on each PC page | No widget |

**Accepted values.** `true` or `false`, or one of the words `yes`,
`no`, `on`, `off`, `true`, `false` in any case. Anything else,
including a key left empty (`inbox:`), is treated as **off** and the
build prints a warning naming the key. This holds for all three
switches, so an unreadable `character_sheets` withholds the sheets.

**Unset means the default.** An unset `live_stats` or `inbox` is off.
The build does not detect a deployed backend: a site whose Functions
and KV store exist still builds without live stats and the inbox until
the switch says `true`. The setup commands write the switch for you
(`cloudflare-pages.md` § The fast way).
A site that loses either feature this way gets a closing build warning
naming the switch. When the site still holds old settings in
`vault.config.json`, `migrate.py` writes `true` for it; otherwise set the
switch to `true` to keep the feature or to `false` to remove its Functions.

**The forcing rule.** `character_sheets: false` turns live stats off
even when `live_stats: true`; the build prints one line saying so. The
inbox is independent of the other two.

**Functions follow their switch.** `build` and `deploy` keep the site's
`functions/` in step with the switches, one feature at a time. `live_stats: true`
copies the live-stats files (`api/loadout.js`, `api/loadout-list.js`,
`api/loadout-core.mjs`); `inbox: true` copies the inbox files
(`api/request.js`, `api/inbox-core.mjs`); `api/package.json` follows either.
A switch set to off, or live stats forced off by `character_sheets: false`,
removes that feature's files and prints one `removed functions/…` line each.
A file you edited is kept with a warning, and nothing else in `functions/`
is touched. A switch that is unset removes nothing. A removal reaches the live
site only with the next deploy, which uploads whatever `functions/` holds then.

**On, but no KV store.** `live_stats` and `inbox` need the site's
`wrangler.toml` to carry a real `INBOX` KV namespace id. When a switch
is on and the id is missing or is still the scaffold placeholder, the
build warns and builds without that feature:

```text
WARNING: publish.live_stats is on but this site has no KV store wired; live stats are not published
WARNING: publish.inbox is on but this site has no KV store wired; the change-request inbox is not published
```

The build copies the plugin's Cloudflare Functions into the site's
`functions/` only when live stats or the inbox is on.

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
- There is no live status bar, and the roster page has no party board.
- With `inbox: true` the widget stays, as a question channel labelled
  "Ask the GM" (see `change-request-loop.md`).

Only these `##` sections of a PC note are published:

- `Background`, `Current Status`, `Notes`, `Relationships`,
  `Appearances`
- CoC: `Fellow Investigators`, `Encounters with Strange Entities`
- FitD: `Friends & Rivals`, `Long-Term Projects`
- any heading listed in `publish.pc_prose_sections`

```yaml
publish:
  character_sheets: false
  pc_prose_sections: ["Personality", "Goals"]
```

`pc_prose_sections` is a list of heading titles. Titles match
case-insensitively, ignoring bold or italic wrapping and a trailing
colon. Every other section is withheld, including a homebrew section
the build does not recognise and any text before the first `##`
heading. Withheld text is left out of the page, the search index and
every other output. `exclude_sections` still applies on top, so
`GM Notes` stays hidden as always. A `pc_prose_sections` that is not
a list is ignored with a warning; so is an entry that is not text.

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

A newly scaffolded site file has `host`, `siteUrl`, `vaultPath` and
`outputDir`:

```json
{
  "host": "cloudflare-pages",
  "siteUrl": "https://iron-crown.pages.dev",
  "vaultPath": "./vault",
  "outputDir": "./docs"
}
```

## Settings left in `vault.config.json`

One rule: the vault file decides. Campaign settings used to live in
the site file under other names. The build still reads them there,
and warns. That site-file form is planned to be removed in plugin
1.11.0:

- A setting the vault file does not set is taken from the site file.
- A setting both files set comes from the vault file. The site file's
  value is ignored.
- An exclude list is the one exception: a folder, section or field
  named only in the site file is still applied, with a warning
  naming it, until the migration moves it. The two lists are merged
  only as this fallback (the vault file's entries first).
- A vault-file exclude list that is set but is not a list (for example
  left empty) gets the built-in default, with a warning. The site
  file's entries are still added to it.

Every build ends with one line naming each key still in the site file:

```text
WARNING: vault.config.json still holds campaign settings: siteTitle, excludeDirs (ignored; the vault file sets it), excludeDirs entry "Secrets" is still applied from vault.config.json. Settings left in vault.config.json are planned to stop being read in plugin 1.11.0. Run `migrate.py <vault>` to move them.
```

| Old key in `vault.config.json` | Key under `publish:` |
|--------------------------------|----------------------|
| `siteTitle` | `site_title` |
| `footer` | `footer` |
| `searchEnabled` | `search` |
| `folderMap` | `folder_map` |
| `attachmentsDir` | `attachments_dir` |
| `system` | `system` |
| `excludeDirs` | `exclude_dirs` |
| `excludeSections` | `exclude_sections` |
| `excludeFields` | `exclude_fields` |
| `excludeCallouts` | `exclude_callouts` |
| `sheet_crest` | `sheet_crest` |
| `landing` | `landing` |
| `images` | `images` |
| `banners` | `banners` |
| `locations` | `locations` |
| `backend.statusBar` | `live_stats` |
| `backend.inbox` | `inbox` |
| `landingTagline` | `theme.tagline` |

Two rows behave differently:

- `backend.statusBar` and `backend.inbox` are also old names when
  written as `publish.backend.*` in the vault file. Either form is
  still read when the new key is unset, and the build warns that it is
  an old name.
- `landingTagline` is not read by the build and is not named in the
  warning. The tagline shows only when `publish.theme.tagline` is set.

Settings that never had a site-file form (`mode`, `exclude_drafts`,
`theme`, `four_oh_four`, `overrides`, `section_titles`,
`pc_prose_sections`, `character_sheets`, `setting_year`) are read from
the vault file only.

### Moving the settings

From the plugin, run the migration against the vault. Show the GM the
dry run's lines first, then run it for real:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/migrate.py" <vault> --dry-run
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/migrate.py" <vault>
```

It finds the site through `publish.site_dir` in the vault file and
asks that site's publish tool to do the move (`migrate-config`). Set
`publish.site_dir` first: without it the migration looks at the vault
file only and the site file's settings stay where they are. To move
one site directly, run `node "$TOOL" migrate-config --dry-run --config
<dir>/vault.config.json`, then again without `--dry-run`. The move:

- writes each campaign setting under `publish:` and removes it from
  the site file. Only the old keys in the table above are removed;
  any other key the site file holds is left as it is, and named in
  the output;
- merges exclude lists: the vault file's entries first, then the site
  file's entries that are not already there;
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
  layout elsewhere stay as written, with one exception: adding a
  tagline to an existing `theme:` block rewrites that block, so
  comments inside it are lost, and the tool prints a note saying so.
  It writes nothing when the vault
  file cannot be edited safely (a `publish: {…}` written on one line,
  tab indentation, mixed line endings, YAML that does not parse).

Running it twice is safe: the second run reports nothing to do.
`--status` shows whether the step is pending. Exit code 0 means done
or nothing to do, 1 a step failed, 2 bad arguments. If it stops with
a message about the publish tool, run `update-pin --site <site-dir>`,
then `migrate.py` again.

---

## Content Filtering: DRAFT Entities

```yaml
publish:
  exclude_drafts: false
```

When `true`, entities with `canon_status: DRAFT` are
excluded entirely from the published site — they won't appear
in navigation, index pages, or as individual pages. Wiki-links
to excluded DRAFT entities will not resolve.

Default `false` — DRAFT entities publish normally with a visible
"Draft" badge, letting players see work-in-progress content
while knowing it's unconfirmed.
