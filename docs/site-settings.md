# Site settings

Everything about how a campaign's site looks and what it shows is set in
one file in the vault: `_meta/vault-config.yaml`. This page lists every
setting, what it does, the values it takes and what you get when you
leave it out.

You rarely need to edit the file by hand. Ask the apprentice in your own
words ("give the character sheets the parchment look", "stop publishing
the Rumours section", "turn the search box off") and it changes the
setting and rebuilds the site. This page is for when you want to know
what is possible, or to read what your file already says.

## Where settings live

| File | Where | What it holds | Who writes it |
|------|-------|---------------|---------------|
| `_meta/vault-config.yaml` | In the vault | Every setting: the campaign's name and system, the site's title and theme, what is published, character sheets, the landing page | You, or the apprentice when you ask |
| `_meta/vault-state.json` | In the vault | The apprentice's own bookkeeping: which version last updated the vault, and how far setting up a site got | The apprentice only. Leave it alone |
| `vault.config.json` | In the site folder, the one `player_site.folder` names | One setting: where the vault is | The apprentice, when it sets the site up |

The two vault files travel with the campaign. The site file belongs to
the one computer and host the site is built on.

If your vault is older, you may also find `_meta/vault-notes.md`. It
holds whatever you had written in the old settings file besides
settings, kept word for word. It is yours: nothing reads it as a
setting.

## Seeing and changing a setting

- **To see what your site uses now**, ask the apprentice "what are my
  site settings?", or open `_meta/vault-config.yaml` in any text editor
  (Obsidian does not show it). The file may be short: a setting that is
  not there is using its default.
- **To change one, ask the apprentice.** It finds the setting, changes
  it and rebuilds the site.
- **Or edit the file yourself**, save it, then ask for the site to be
  rebuilt.

A change reaches your players only when the site is next rebuilt and
published. Until then the site is as it was.

## How the settings file is laid out

The whole file is settings, in groups. `vault:` holds what is true of
the campaign wherever it is shown; `player_site:` holds everything about
the site your players read. This page writes a setting as
`player_site.title`; in the file that is the `title` line under
`player_site:` below.

```yaml
version: 1

vault:
  campaign: The Iron Crown
  system: gurps-4e
  setting_year: 1994

player_site:
  title: The Iron Crown
  features:
    link_previews: off
  theme:
    genre: military
    tagline: "A Special Forces campaign set in 1990s Britain."
```

If you edit by hand:

- **Leave the `version: 1` line** as it is.
- **Write settings only.** There are no `---` lines and no room for
  notes of your own, except on a line that starts with `#`.
- **Indent with spaces, never tabs**, two for each level. `title` is one
  level under `player_site:`; `genre` is two levels, under `theme:`.
- **Put a space after every colon**: `genre: military`, not
  `genre:military`.
- **Put quotes round text** that holds a colon or a `#`, and round every
  colour: `"#1a2f3a"`.
- **A list** is written on one line in square brackets, `["a", "b"]`, or
  one item to a line, each starting with a dash and a space.
- **Ask the apprentice to check the settings** when you are done. It
  names each mistake and offers the fix.

**Check the spelling of a setting's name against this page.** The build
names any setting it does not know and suggests the nearest real name.

### A vault not yet updated

A vault last updated before plugin 1.10.54 keeps its settings in an
older file in the same folder, under older names; each table below
shows a setting's older name after "was". The next time the apprentice
updates the vault it moves the settings to the file described here and
tells you what it did. Until then, asking the apprentice to change a
setting works as it always did. See
[the old file](vault-config-format.md#the-old-file) for the detail.

Some settings decide what your players do not see. When the name of one
is misspelt, or its value cannot be read, the build stops until it is
fixed, so nothing extra is ever shown by a guess. These are:

<!-- settings:hiding-list -->

- `player_site.hide.folders`
- `player_site.hide.sections`
- `player_site.hide.fields`
- `player_site.hide.callouts`
- `player_site.hide.drafts`
- `player_site.hide.field_exceptions`
- `player_site.never_show`

<!-- /settings:hiding-list -->

Every other setting only warns, by name, and the site uses that setting's
usual value (off, for `player_site.publish`, `player_site.sheets.show`,
`player_site.features.live_stats` and `player_site.features.inbox`).

### On and off

A setting shown as **A switch** takes `on` or `off`. `yes` and `no`, and
`true` and `false`, mean the same, in any capitals, with quotes or
without. The choices that take `on` and `off` among their words
(`player_site.features.link_previews`, `player_site.features.connections` and
`player_site.features.tohit_calculator`) read those words the same way.

A setting written with nothing after the colon is treated as not set,
except `player_site.publish`, `player_site.sheets.show`, `player_site.features.live_stats`
and `player_site.features.inbox`, where an empty line counts as off. A switch that
holds something that is not one of the words is reported by name, and
what follows is as described under "Check the spelling" above.

## The vault

The status lists are matched against a note's `status` in any case and
with spaces at either end ignored. `vault.statuses.out_of_play` is read by
the site and by the apprentice's own checks and session preparation, so a
word you take out of it changes both: the same characters are out of play
on the page and at the table. The other two lists shape the site only. The
four numbers are read by the apprentice's checks, session preparation and
the index; the site does not use them.

<!-- settings:vault -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `vault.kept_by` | Who keeps this vault: `gm` for the game master, `player` for a player keeping notes on a campaign they are in | `gm` or `player` | `gm` |
| `vault.campaign` | The campaign's name | The campaign's name | The vault folder's name |
| `vault.statuses.out_of_play` | The statuses that take a character out of play. A character with one leaves the party board and the active team on the landing page, and is listed under "In Memoriam" instead; their sheet page stays. An empty list means nobody is ever out of play | A list of status words | `dead`, `deceased`, `kia`, `retired`, `departed`, `missing`, `unknown`, `inactive`, `npc`, `destroyed`, `dissolved` |
| `vault.statuses.fallen` | The statuses that put a character under "Fallen" on the Story page. Each must also be in `vault.statuses.out_of_play`; one that is not is left out, with a warning. `retired` always has its own group | A list of status words | `dead`, `deceased`, `kia`, `missing`, `unknown` |
| `vault.statuses.gone` | The statuses of things that no longer exist. A note with one is left off the landing page's "NPCs in Play" and "Latest Locations" unless the latest session mentions it. An empty list drops nothing | A list of status words | `dead`, `deceased`, `destroyed`, `kia`, `dissolved` |
| `vault.stale_after_sessions` | How many sessions a draft note, or a character's open thread, can go untouched before the checks call it stale | A whole number, 1 or more | `3` |
| `vault.name_match` | How alike two note names must be, from `0` (anything) to `1` (identical), before the name check lists them as too close. The check's `--threshold` option overrides it for one run | A number from 0 to 1 | `0.85` |
| `vault.index.recent_changes` | How many lines the "Recent Changes" list in `_meta/index.md` keeps when the index is rebuilt, counting the line for the rebuild itself; `0` and `1` both keep only that line | A whole number, 0 or more | `20` |
| `vault.index.description_chars` | How many characters of a note's description the index shows beside its link | A whole number, 1 or more | `80` |

<!-- /settings:vault -->

## The site itself

Where a table says "A switch", see "On and off" above.

<!-- settings:site -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.publish`<br>was `publish.site` | Whether this vault has a site | A switch | On when a site folder is set (`player_site.folder`), otherwise off |
| `player_site.folder`<br>was `publish.site_dir` | The folder on this computer that holds the site | A folder path | Setting up a site writes it |
| `player_site.title`<br>was `publish.site_title`, `siteTitle` | The name in the menu bar and the browser tab | Text | No title; setting up a site writes one |
| `player_site.footer`<br>was `publish.footer`, `footer` | A line at the foot of every page | Text | No footer |
| `player_site.features.search`<br>was `publish.search`, `searchEnabled` | The search box | A switch | On |
| `player_site.features.link_previews`<br>was `publish.link_previews` | The small card that opens when a reader rests on a link to another page, or taps it once on a phone. `on` shows it everywhere; `desktop` keeps it to a mouse and keyboard, so on a phone a tap goes straight to the page | `on`, `desktop` or `off` | `on` |
| `player_site.features.connections`<br>was `publish.connections` | How the Connections section on a page is drawn: what the page's subject is tied to, in tabs by kind (people, places, organisations and so on), with pages that only mention it in a last tab. `tree` is a branching list, readable on a phone; `web` puts the subject in the middle with names around it; `cards` gives a card for each; `off` leaves out the section and the list of mentions. `on`, `yes` and `true` read as `tree`; `no` and `false` as `off` | `tree`, `web`, `cards` or `off` | `tree` |
| `player_site.not_found`<br>was `publish.four_oh_four.message`, `fourOhFour.message` | The words a reader sees after following a link to a page that is not there | Text | "This page is not available." |
| `player_site.url`<br>was `siteUrl` | The site's public address. A site that lives in a sub-folder of its host, such as a project page on GitHub, takes its base path from this | A web address | No address; a Cloudflare site is then taken to be at `https://<project>.pages.dev` |
| `player_site.host`<br>was `host` | Where the site is hosted: `github-pages` or `cloudflare-pages`. Any other word is reported, and `github-pages` is used | `github-pages` or `cloudflare-pages` | `github-pages` |
| `player_site.output`<br>was `outputDir` | The folder the finished pages are written to, inside the site folder. Each build empties it first (except what `player_site.keep` names), so it can be neither the site folder itself nor a folder outside it; a setting that breaks this stops the build | A folder inside the site folder | `docs` |
| `player_site.cloudflare_project`<br>was `cloudflarePagesProject` | The site's project name on Cloudflare, when it differs from the site folder's name | Text | The site folder's name |
| `player_site.keep`<br>was `preserveDirs` | Folders inside the output folder that a rebuild must leave alone, each a plain folder name (no slashes). A setting that breaks this stops the build | A list of folder names | None: a rebuild empties the output folder |
| `player_site.before_build` | Commands the publish tool runs, in order, in the site folder, before it builds. A command that fails stops the build and nothing is published | A list of commands | None |
| `player_site.after_build` | Commands the publish tool runs, in order, in the site folder, after every page is written (image tidying, extra pages). A command that fails stops the build and nothing is published | A list of commands | None |
| `player_site.menu_extra` | Extra entries in the site's menu. `link` is the name of a page, a web address (`https://…`), or an address on the site (`gazetteer/index.html`). `group` puts the entry under one of the menu's groups (`Story`, `Characters`, `World`, `Reference`) or makes a new one; with none it stands on its own after the groups. A link to a note that has no page is left out, with a warning | A list of entries, each with `label`, `link`, and optionally `group` | No extra entries |
| `vault.system`<br>was `publish.system`, `system` | The game system, which decides how a character sheet is drawn. `coc-7e-regency` changes two things from `coc-7e`: the Regency skill list on every sheet, and the masthead label "Regency Cthulhu" for a PC with no era | `coc-7e` (Call of Cthulhu), `coc-7e-regency` (Regency Cthulhu), `gurps-4e` (GURPS), `dnd-5e-2024` (D&D 5e 2024), `pf2e` (Pathfinder), `fitd` (Forged in the Dark); the short names `coc`, `coc7e`, `cthulhu`, `regency-cthulhu`, `gurps`, `gurps4e`, `dnd`, `dnd-5e`, `dnd5e`, `5e`, `d&d`, `pathfinder`, `pathfinder-2e`, `pf2`, `pf2e-remaster`, `blades` and `bitd` work too | A plain character page with no system's sheet |
| `vault.setting_year`<br>was `setting_year` | An in-game year, shown on the landing page when the campaign overview gives no current date, and on a Call of Cthulhu sheet beside its era. | A year | Nothing shown |

<!-- /settings:site -->

With link previews on, a first tap on a phone opens the card and a second
tap follows the link. A value that is none of the words gives a build
warning and counts as `on`.

Set `player_site.publish: false` to stop publishing without losing the site
folder's path. With the site off nothing is built.

### Build steps

A build step is a command the publish tool runs for you around a build:
`player_site.before_build` runs before the pages are made, and
`player_site.after_build` runs once every page is written, for jobs such as
shrinking pictures or adding a page of your own. Each is a list, so you can
have several, and they run in the order you wrote them, in the site folder.

```yaml
player_site:
  after_build:
    - node tools/add-props.js
```

- The tool prints each command before it runs it.
- A step that fails stops the build, and nothing is published.
- The steps run when you build the site or deploy it. They do not run for a
  dry run, the preview, the sheet view, a check of the site, or a deploy
  told to skip the build.
- A step that runs for more than ten minutes is stopped and counts as
  failed.
- These steps are the player site's. The GM site's are listed under
  `gm_site.before_build` and `gm_site.after_build`, and run in the same
  site folder. Each step is told which site it runs for and where that
  site is built: `GM_APPRENTICE_SITE` is `player` or `gm`, and
  `GM_APPRENTICE_OUTPUT` is the site's output folder.

Or add a step yourself, from a terminal:

```text
gm-apprentice-publish settings add player_site.after_build "node tools/add-props.js" --vault <vault>
```

### Extra menu entries

`player_site.menu_extra` adds your own entries to the site's menu, such as
a gazetteer you built by hand. Each has a `label`, a `link` and, if you
like, a `group`. Ask the apprentice, or run:

```text
gm-apprentice-publish settings add player_site.menu_extra label=Gazetteer link=gazetteer/index.html group=World --vault <vault>
```

Take one out by its label:

```text
gm-apprentice-publish settings remove player_site.menu_extra Gazetteer --vault <vault>
```

## What gets published

These decide which notes, and which parts of a note, reach the site.

<!-- settings:published -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.folder_map`<br>was `publish.folder_map`, `folderMap` | Which vault folders are published, and the web address each gets | A vault folder and its address, one pair to a line | Nothing is mapped; setting up a site writes the standard map |
| `vault.attachments`<br>was `publish.attachments_dir`, `attachmentsDir` | The vault folder that holds pictures | A folder name | `_attachments` |
| `player_site.hide.folders`<br>was `publish.exclude_dirs`, `excludeDirs` | Vault folders never published | A list of folders | `_meta`, `_Templates` |
| `player_site.hide.sections`<br>was `publish.exclude_sections`, `excludeSections` | Headings whose text is never published, on any page, however the heading is dressed (bold, a colon, a link) | A list of headings | `GM Notes`, `DM Notes`, `Player Notes`, `Source References`, `Reconciliation Context`, `Handoff to Reconcile` |
| `player_site.hide.fields`<br>was `publish.exclude_fields`, `excludeFields` | Fields in the block at the top of a note (between its `---` lines) that are never shown | A list of field names | `secrets`, `current_plan`, `plan_progress`, `gm_notes`, `prep_notes`, `reliability` |
| `player_site.hide.callouts`<br>was `publish.exclude_callouts`, `excludeCallouts` | Whether Obsidian callouts (`> [!note]`) are left out | `on` for all, `off` for none, or a list of callout types | Off; a site set up by the apprentice starts with it on |
| `player_site.hide.drafts`<br>was `publish.exclude_drafts` | Whether a note with `canon_status: DRAFT` at its top is left off the site | A switch | Off: drafts publish with a "Draft" badge |
| `player_site.hide.field_exceptions`<br>was `publish.overrides.fields` | Lets one note show a field that `player_site.hide.fields` hides everywhere else | A note's path from the top of the vault, in quotes, then `include:` and the field names | No exceptions |
| `player_site.never_show` | Words or phrases that must never reach players: a name, a twist, a word from your prep. The build does not remove them; `deploy` stops when the finished player site holds one (any case, as a whole word, or its plural written with a capital), names the page, and `leaks check` lists them. A finding you mean to keep is accepted like any other (`leaks accept`) | A list of words or phrases | None |
| `player_site.withheld_words.person` | The word that stands in for the name of a withheld person (a character or an NPC) when a note links to them with no label of their own. It cannot hold `[`, `]` or `\|` | Text | `someone` |
| `player_site.withheld_words.place` | The word that stands in for the name of a withheld place. It cannot hold `[`, `]` or `\|` | Text | `somewhere` |
| `player_site.withheld_words.thing` | The word that stands in for the name of any other withheld note. It cannot hold `[`, `]` or `\|` | Text | `something` |

<!-- /settings:published -->

**Careful: a list in your file replaces the built-in list.** Setting up a
site writes the full `player_site.hide.sections` and `player_site.hide.fields`
lists into your file, so you can see them. Add your own heading to that
list and keep the rest. A list you delete falls back to the built-in one.
But a list that is empty (`[]`), or that leaves out `GM Notes`, hides
only what it names, so your GM notes are published. Repeat every
built-in entry you still want. The same holds for
`player_site.hide.folders`.

```yaml
player_site:
  folder_map:
    "Characters/NPCs": characters/npcs
    "Locations": locations
  hide:
    field_exceptions:
      "Characters/NPCs/Vex Ambrose.md":
        include: [secrets]
```

To hide one more heading and keep the built-in ones, ask the apprentice
to "stop publishing the Rumours section".

In that folder map, notes in `Characters/NPCs` appear on the site at
`characters/npcs/`. A folder that holds notes but has no line in the map
is skipped, and the build says so.

## Theme

<!-- settings:theme -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.theme.genre`<br>was `publish.theme.genre` | A ready-made look: colours, lettering and section names. A genre the tool does not know is reported, and the site keeps the plain dark look | `horror`, `fantasy`, `noir`, `military` or `scifi` | No preset |
| `player_site.theme.palette.primary`<br>was `publish.theme.palette.primary` | The main colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a2f3a` |
| `player_site.theme.palette.accent`<br>was `publish.theme.palette.accent` | The accent colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#3d8a7a` |
| `player_site.theme.palette.background`<br>was `publish.theme.palette.background` | The page background colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#e8f0f3` |
| `player_site.theme.palette.text`<br>was `publish.theme.palette.text` | The text colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a1a1a` |
| `player_site.theme.fonts.heading`<br>was `publish.theme.fonts.heading` | The lettering for headings | A typeface's name | The preset's lettering, or the reader's own system font |
| `player_site.theme.fonts.body`<br>was `publish.theme.fonts.body` | The lettering for body text | A typeface's name | The preset's lettering, or the reader's own system font |
| `player_site.theme.fonts.source`<br>was `publish.theme.fonts.source` | Where the lettering comes from: `self-host` (the site downloads the typefaces once and serves them itself), `google` (the reader's browser fetches them from Google Fonts) or `local` (your own font files). With `self-host` a reader's browser never contacts Google. A source the tool does not know is reported, and `google` is used | `google`, `self-host` or `local` | `google`: what a vault that never set a source gets |
| `player_site.theme.fonts.files`<br>was `publish.theme.fonts.files` | Your own font files, each listed with its `family` (the typeface's name) and `path` (the file's place in the vault); used when the source is `local` | A list of font files, each with a `family`, a `path`, and optionally a `weight` and `style` | No files |
| `player_site.theme.campaign_image`<br>was `publish.theme.campaign_image`, `campaignImage` | The large picture at the top of the landing page | A picture's path in the vault | No picture |
| `player_site.theme.default_mode`<br>was `publish.theme.default_mode` | Whether a reader starts in light or dark | `system`, `dark` or `light` | `system`: follows the reader's device |
| `player_site.theme.tagline`<br>was `publish.theme.tagline`, `landingTagline` | One sentence under the title on the landing page | Text | No tagline |
| `player_site.lists.section_titles`<br>was `publish.section_titles` | Your own headings for the lists of locations, factions, items, creatures and documents | `locations`, `factions`, `items`, `creatures`, `documents`, each a title | Plain titles, or the genre's own |

<!-- /settings:theme -->

```yaml
player_site:
  theme:
    genre: horror
    palette:
      primary: "#1a2f3a"
      accent: "#c9a227"
      background: "#101820"
      text: "#eeeeee"
    fonts:
      heading: "Cinzel"
      body: "Lora"
      source: self-host
  lists:
    section_titles:
      locations: "Places of Note"
      creatures: "Bestiary"
```

Light and dark are a pair only a genre preset has. With a palette of
your own, or with no genre, the site has one set of colours: the sun and
moon button is not shown and `player_site.theme.default_mode` does nothing.

A site set up by the apprentice uses `self-host` for its lettering.
With `local`, each font file is listed under `player_site.theme.fonts.files`.

## Character sheets

<!-- settings:sheets -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.sheets.show`<br>was `publish.character_sheets` | Whether a character's page carries its sheet | A switch | On |
| `player_site.sheets.prose_sections`<br>was `publish.pc_prose_sections` | With sheets off, extra sections of a character's note that are still published | A list of headings | Only the built-in ones: Background, Current Status, Notes, Relationships, Appearances, Fellow Investigators, Encounters with Strange Entities, Friends & Rivals and Long-Term Projects |
| `player_site.sheets.skin`<br>was `publish.sheet_skin` | The look of every character sheet | `plain`, `parchment`, `case-file`, `console` or `ledger` | `plain` |
| `player_site.sheets.frame`<br>was `publish.sheet_frame` | The ornament round each portrait | `none`, `ring`, `laurel`, `thorns`, `gilt`, `steel`, `corners`, `hex` or `cracked` | The skin's own frame |
| `player_site.sheets.crest`<br>was `publish.sheet_crest`, `sheet_crest` | A crest or wax seal at the head of a Call of Cthulhu sheet | A picture's path in the vault | No crest |
| `player_site.sheets.header_facts` | The facts shown under a character's name, as the names of fields in their note, for a character whose note has no `display_meta` of its own. An empty list shows none | A list of field names | `occupation`, `age`, `nationality` |
| `player_site.features.tohit_calculator`<br>was `publish.tohit_calculator` | The to-hit calculator on a GURPS character's Combat tab | `on` or `off` | `on` |
| `vault.dndbeyond_sync`<br>was `publish.dndbeyond_sync` | When D&D characters that carry a D&D Beyond link are brought up to date: `build` before each site update, or `manual` only when you ask | `build` or `manual` | `manual` |

<!-- /settings:sheets -->

One character can have its own look: put `sheet_skin` or `sheet_frame`
in the block at the top of that character's note and it wins over the
campaign's.

With `player_site.sheets.show` off, a character page shows the
character's story and no numbers, and live stats are switched off with
it. The sections still published are the built-in ones named for
`player_site.sheets.prose_sections`, plus any you list there.

## Live play

Both of these need a site hosted on Cloudflare Pages, with its small
store for saved values set up (see
[choosing where to host it](publish-tool.md#choosing-where-to-host-it)).
The apprentice does the setting up and writes the switch for you.

<!-- settings:live -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.features.live_stats`<br>was `publish.live_stats`, `publish.backend.statusBar`, `backend.statusBar` | Players change hit points, spent resources and conditions on their own sheet during a session, and the party board follows. For Call of Cthulhu, GURPS and D&D; it does nothing for Pathfinder or Forged in the Dark | A switch | Off |
| `player_site.features.inbox`<br>was `publish.inbox`, `publish.backend.inbox`, `backend.inbox` | A box on each character page for sending the GM a request or a question | A switch | Off |

<!-- /settings:live -->

## The landing page

<!-- settings:landing -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.landing.max_npcs`<br>was `publish.landing.max_npcs` | How many people appear under "NPCs in Play"; `0` shows none | A whole number, 0 or more | `6` |
| `player_site.landing.max_locations`<br>was `publish.landing.max_locations` | How many places appear under "Latest Locations"; `0` shows none | A whole number, 0 or more | `4` |
| `player_site.landing.max_events`<br>was `publish.landing.max_events` | How many events appear under "Latest Events"; `0` shows none | A whole number, 0 or more | `4` |
| `player_site.landing.recency_window`<br>was `publish.landing.recency_window` | How many recent sessions decide who and what is "in play"; `0` counts none | A whole number, 0 or more | `3` |
| `player_site.landing.featured_npcs`<br>was `publish.landing.featured_npcs` | People pinned to the front of their row, in your order | A list of note names | Nobody pinned |
| `player_site.landing.featured_locations`<br>was `publish.landing.featured_locations` | The same, for places | A list of note names | Nothing pinned |
| `player_site.landing.quick_links`<br>was `publish.landing.quick_links` | A short row of links on the page | A list of note names | No row |
| `player_site.landing.explore_descriptions`<br>was `publish.landing.explore_descriptions` | Your own line under each card in the "Explore the World" row | `characters`, `locations`, `story`, `factions`, `items`, `creatures`, `events`, each a sentence | The genre's lines, or plain ones |
| `player_site.landing.banner.title` | The heading of a banner between the top of the landing page and "Latest Session". Plain text, shown as written. A banner shows when it has a title, text or picture | Text | No banner |
| `player_site.landing.banner.text` | The words in the banner, under its heading. Plain text, shown as written | Text | No words |
| `player_site.landing.banner.link` | Makes the whole banner a link. It is the name of a page, a web address (`https://…`), or an address on the site (`gazetteer/index.html`). A link to a note that has no page is left out, with a warning; a link with nothing else set shows no banner | Text | Not a link |
| `player_site.landing.banner.image` | A picture at the top of the banner. A file that is missing from the vault, or outside it, is reported and the banner shows without it | A picture's path in the vault, or a web address | No picture |

<!-- /settings:landing -->

Name a note the way a link does, by its file name: `Osric_Marlow`, not
"Osric Marlow". A name that matches no published page gives a build
warning.

```yaml
player_site:
  landing:
    max_npcs: 6
    featured_npcs: ["Osric_Marlow", "Edda_Marlow"]
    quick_links: ["Harbour_City_Map"]
```

## Lists and pictures

<!-- settings:lists -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.images.optimize`<br>was `publish.images.optimize` | Shrinks pictures as the site is built, which can cut a picture-heavy site to a fraction of its size | A switch | Off: pictures are copied as they are |
| `player_site.images.format`<br>was `publish.images.format` | The format pictures are converted to. Only `webp` is available; any other is reported, and pictures are left as they are | `webp` | `webp` |
| `player_site.images.max_width`<br>was `publish.images.max_width`, `publish.images.maxWidth` | The widest a shrunk picture may be, in pixels; `0` for no limit | A whole number, 0 or more | `1600` |
| `player_site.images.quality`<br>was `publish.images.quality` | The quality of shrunk pictures: 0 is the smallest file, 100 the best picture, and anything above 100 counts as 100 | A number, 0 or more | `82` |
| `player_site.lists.banners`<br>was `publish.banners`, `banners` | A picture or map at the top of a section's list | A section's web address, with a picture's path, or with `image`, `link` and `alt` | A picture named `_banner` in the section's vault folder is used if there is one |
| `player_site.lists.locations.group_by`<br>was `publish.locations.group_by` | Splits the list of locations into one block, under its own heading, for each place of a kind, such as each star system | A kind of location, or `false` | Off, except the `scifi` genre, which groups by `system` |
| `player_site.lists.locations.ungrouped_label`<br>was `publish.locations.ungrouped_label` | The heading for places that fall in no block | Text | A standard heading |

<!-- /settings:lists -->

```yaml
player_site:
  lists:
    banners:
      locations:
        image: _attachments/sector-map.webp
        link: _attachments/sector-map-large.webp
        alt: "Star chart of Sector 9-K"
      factions: _attachments/factions-hero.svg
```

A banner is named by its section's web address from the folder map
(`locations`, `characters/npcs`), not by the vault folder. `link` is a
second picture in the vault, opened when a reader clicks the banner.

Shrinking pictures needs a small free program called `cwebp` on the
computer that builds the site. Without it the build warns and copies the
pictures unchanged.

## Limits

How long things are on the page. A number below its smallest, a fraction,
or text that is not a number is reported and the standard number is used.
Where a limit may be `0`, it means none: no timeline strip, no facts on a
preview card, no goals or relationships on a faction's card.

<!-- settings:limits -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `player_site.limits.timeline_events` | How many of the latest events the little timeline shows, on the landing page and on a character page; `0` shows none | A whole number, 0 or more | `15` |
| `player_site.limits.recap_chars` | How many characters of the latest session's recap the landing page shows before it stops at a word and adds "…" | A whole number, 1 or more | `500` |
| `player_site.limits.card_excerpt_chars` | How many characters of a note's opening the pop-up preview card shows | A whole number, 1 or more | `200` |
| `player_site.limits.card_fact_chars` | How many characters one fact on a preview card shows | A whole number, 1 or more | `120` |
| `player_site.limits.card_title_chars` | How many characters of a note's name a preview card shows | A whole number, 1 or more | `120` |
| `player_site.limits.card_facts` | How many facts a preview card lists; `0` shows none | A whole number, 0 or more | `3` |
| `player_site.limits.list_goals` | How many goals a faction's card on the factions page lists; `0` shows none | A whole number, 0 or more | `3` |
| `player_site.limits.list_relationships` | How many relationships a faction's card on the factions page lists; `0` shows none | A whole number, 0 or more | `4` |

<!-- /settings:limits -->

```yaml
player_site:
  limits:
    timeline_events: 8
    card_facts: 2
```

## The GM site

The GM site is a second copy of your campaign site, for you at the table.
It holds every note and shows the parts players do not see (the
`gm_site.show.*` switches choose which), each one marked with the reason
players do not see it. It is written to its own
folder, and it is never put online: you read it on your own computer, or
serve it to your home network with `gm-apprentice-publish serve`.

Turn it on with `gm-apprentice-publish settings set gm_site.publish=on`.
With no `gm_site.folder` set, this makes a folder beside the player site's
folder, named after it with `-gm` added, and writes that path to
`gm_site.folder`. From then on every build makes both sites; `build --site
gm` or `build --site player` makes one. Every GM page carries a "GM copy:
not for players" band and asks search engines to keep away, and `deploy`
refuses to put a GM folder online. The live status bar, the inbox and the
party board stay on the player site. Hidden words that land in a page's
title, description, image text or script data are shown there without a
mark, so do not read those places aloud as if players had them.

<!-- settings:gm -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `gm_site.publish` | Whether this vault has a GM site: a second copy of the site with every note shown and the hidden parts marked (the `gm_site.show.*` switches choose which), for you at the table. It is never put online | A switch | Off |
| `gm_site.folder` | The folder the GM site's pages are written to. It holds built pages only, and cannot be the player site's folder, inside it, or hold it. Turning the GM site on with this unset makes one beside the player site's folder | A folder path | A folder beside the player site's, made when the GM site is turned on |
| `gm_site.show.notes` | Notes the player site leaves out (prep, drafts, the ones held back by the publish list) get a page, marked | A switch | On |
| `gm_site.show.sections` | Sections the player site hides (by heading) are shown, marked | A switch | On |
| `gm_site.show.fields` | Frontmatter fields the player site hides are listed in a panel at the top of the page, marked | A switch | On |
| `gm_site.show.relationships` | Relationships the player site hides (GM-only ones) are shown, marked | A switch | On |
| `gm_site.show.gm_only_blocks` | GM-only blocks (`<!-- gm-only -->`) are shown, marked | A switch | On |
| `gm_site.show.spoilers` | Spoiler blocks (`<!-- spoiler -->`) are shown, marked | A switch | On |
| `gm_site.show.callouts` | Callouts the player site hides are shown, marked | A switch | On |
| `gm_site.show.withheld_names` | Names the player site prints as "someone" or "somewhere" are printed in full, marked with what players see | A switch | On |
| `gm_site.show.comments` | Comments in a note (`%% ... %%`) are shown, marked. They are off by default: most are notes to yourself, not things to run | A switch | Off |

<!-- /settings:gm -->

Every other player site setting can be written under `gm_site` with the
same name, for the GM site only. Left out, the GM site uses the player
site's value, except the build steps: the player site's steps never run
for the GM site, so list its own under `gm_site.before_build` and
`gm_site.after_build` (see [Build steps](#build-steps)). A GM-site build
step must write only to the folder named in `GM_APPRENTICE_OUTPUT`; a step that
ignores it acts on the player site's folder. These cannot:
they belong to the player site alone (its switch, its folders, its web
address and host), to live play, which the GM site does not have, or to
what players see (the `hide` settings), which has one source so that a
mark always means hidden from players. The GM site's folder is
`gm_site.folder`.

<!-- settings:gm-not-per-site -->

- `player_site.publish`
- `player_site.folder`
- `player_site.url`
- `player_site.host`
- `player_site.output`
- `player_site.cloudflare_project`
- `player_site.keep`
- `player_site.hide.folders`
- `player_site.hide.sections`
- `player_site.hide.fields`
- `player_site.hide.callouts`
- `player_site.hide.drafts`
- `player_site.hide.field_exceptions`
- `player_site.never_show`
- `player_site.features.live_stats`
- `player_site.features.inbox`

<!-- /settings:gm-not-per-site -->

```yaml
gm_site:
  publish: on
  title: Table copy
  show:
    comments: on
```

## The site file: `vault.config.json`

This file sits in the site folder and holds one thing: where the vault is
on this computer. The apprentice writes it when it sets the site up; you
should not need to touch it.

| Setting | What it does |
|---------|--------------|
| `vaultPath` | Where the vault is on this computer |

The site's address, host, output folder, Cloudflare project name and the
folders a rebuild leaves alone are settings of the vault
(`player_site.url`, `player_site.host`, `player_site.output`,
`player_site.cloudflare_project` and `player_site.keep`, in the tables
above), and so are the build steps. A new site's file holds none of them.

An older site may still hold some of these in its file, or other campaign
settings under other names. The next vault update moves the five site
settings and the build steps into the vault and tells you what it did. A
site whose own publish tool is older than 1.24.0 keeps them where they are
until that tool is updated. Until they move, the build reads those five from
this file when the vault sets none, and warns about each. On a vault that is
already on the new settings file, other campaign settings are not read from
this file: the build warns about each, and stops for one that hides things
from players.
Ask the apprentice to check the settings: it adds anything such a key hid
to the vault's own list and removes the keys from this file.

## See also

- [The publish tool](publish-tool.md): what a site is and how to host
  one.
- [Quickstart](quickstart.md): setting up a first campaign.
