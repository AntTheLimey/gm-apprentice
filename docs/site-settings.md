# Site settings

Everything about how a campaign's site looks and what it shows is set in
one file in the vault: `_meta/vault-config.md`. This page lists every
setting, what it does, the values it takes and what you get when you
leave it out.

You rarely need to edit the file by hand. Ask the apprentice in your own
words ("give the character sheets the parchment look", "stop publishing
the Rumours section", "turn the search box off") and it changes the
setting and rebuilds the site. This page is for when you want to know
what is possible, or to read what your file already says.

## Where settings live

There are two files, and they do different jobs.

| File | Where | What it holds |
|------|-------|---------------|
| `_meta/vault-config.md` | In the vault | Every campaign setting: title, theme, what is published, character sheets, the landing page |
| `vault.config.json` | In the site folder, the one `publish.site_dir` names | Six deployment settings: where the vault is, where the pages are written, where the site is hosted |

The vault file travels with the campaign. The site file belongs to the
one computer and host the site is built on.

## Seeing and changing a setting

- **To see what your site uses now**, open `_meta/vault-config.md` in
  Obsidian, or ask the apprentice "what are my site settings?". The file
  may be short: a setting that is not there is using its default.
- **To change one, ask the apprentice.** It finds the setting, changes
  it and rebuilds the site.
- **Or edit the file yourself**, save it, then ask for the site to be
  rebuilt.

A change reaches your players only when the site is next rebuilt and
published. Until then the site is as it was.

## How the vault file is laid out

The settings sit at the top of `_meta/vault-config.md`, between two
lines of three dashes. Most are indented under `publish:`. This page
writes a setting as `publish.site_title`; in the file that is the
`site_title` line below.

```yaml
---
setting_year: 1994
publish:
  site_title: "The Iron Crown"
  mode: player
  system: gurps-4e
  link_previews: off
  theme:
    genre: military
    tagline: "A Special Forces campaign set in 1990s Britain."
---
```

If you edit by hand:

- **Keep both `---` lines**, and keep the settings between them.
- **Indent with spaces, never tabs**, two for each level. `site_title`
  is one level under `publish:`; `genre` is two levels, under `theme:`.
- **Put a space after every colon**: `mode: player`, not `mode:player`.
- **Put quotes round text** that holds a colon or a `#`, and round every
  colour: `"#1a2f3a"`.
- **A list** is written on one line in square brackets, `["a", "b"]`, or
  one item to a line, each starting with a dash and a space.
- **Copy the file first.** If the site stops building after an edit, put
  the copy back, or ask the apprentice to find the mistake.

**Check the spelling of a setting's name against this page.** The build
names any setting it does not know and suggests the nearest real name.

Some settings decide what your players do not see. When the name of one
is misspelt, or its value cannot be read, the build stops until it is
fixed, so nothing extra is ever shown by a guess. These are:

<!-- settings:hiding-list -->

- `publish.mode`
- `publish.exclude_dirs`
- `publish.exclude_sections`
- `publish.exclude_fields`
- `publish.exclude_callouts`
- `publish.exclude_drafts`
- `publish.overrides.fields`

<!-- /settings:hiding-list -->

Every other setting only warns, by name, and the site uses that setting's
usual value (off, for `publish.site`, `publish.character_sheets`,
`publish.live_stats` and `publish.inbox`).

### On and off

A setting shown as **A switch** takes `on` or `off`. `yes` and `no`, and
`true` and `false`, mean the same, in any capitals, with quotes or
without. The choices that take `on` and `off` among their words
(`publish.link_previews`, `publish.connections` and
`publish.tohit_calculator`) read those words the same way.

A setting written with nothing after the colon is treated as not set,
except `publish.site`, `publish.character_sheets`, `publish.live_stats`
and `publish.inbox`, where an empty line counts as off. A switch that
holds something that is not one of the words is reported by name, and
what follows is as described under "Check the spelling" above.

## The site itself

Where a table says "A switch", see "On and off" above.

<!-- settings:site -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.site` | Whether this vault has a site | A switch | On when a site folder is set (`publish.site_dir`), otherwise off |
| `publish.site_dir` | The folder on this computer that holds the site | A folder path | Setting up a site writes it |
| `publish.site_title` | The name in the menu bar and the browser tab | Text | No title; setting up a site writes one |
| `publish.footer` | A line at the foot of every page | Text | No footer |
| `publish.search` | The search box | A switch | On |
| `publish.link_previews` | The small card that opens when a reader rests on a link to another page, or taps it once on a phone. `on` shows it everywhere; `desktop` keeps it to a mouse and keyboard, so on a phone a tap goes straight to the page | `on`, `desktop` or `off` | `on` |
| `publish.connections` | How the Connections section on a page is drawn: what the page's subject is tied to, in tabs by kind (people, places, organisations and so on), with pages that only mention it in a last tab. `tree` is a branching list, readable on a phone; `web` puts the subject in the middle with names around it; `cards` gives a card for each; `off` leaves out the section and the list of mentions. `on`, `yes` and `true` read as `tree`; `no` and `false` as `off` | `tree`, `web`, `cards` or `off` | `tree` |
| `publish.four_oh_four.message` | The words a reader sees after following a link to a page that is not there | Text | "This page is not available." |
| `publish.system` | The game system, which decides how a character sheet is drawn | `coc-7e` (Call of Cthulhu), `coc-7e-regency` (Regency Cthulhu), `gurps-4e`, `dnd-5e-2024`, `pf2e` (Pathfinder), `fitd` (Forged in the Dark); the short names `coc`, `regency-cthulhu`, `gurps`, `dnd-5e`, `dnd`, `blades`, `pathfinder-2e` and `pathfinder` work too | A plain character page with no system's sheet |
| `setting_year` | An in-game year, shown on the landing page when the campaign overview gives no current date, and on a Call of Cthulhu sheet beside its era. Write it at the left edge of the file, beside `publish:`, not under it | A year | Nothing shown |

<!-- /settings:site -->

With link previews on, a first tap on a phone opens the card and a second
tap follows the link. A value that is none of the words gives a build
warning and counts as `on`.

Set `publish.site: false` to stop publishing without losing the site
folder's path. With the site off nothing is built.

## What gets published

These decide which notes, and which parts of a note, reach the site.

<!-- settings:published -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.mode` | `player` leaves out any note still marked as prep (a planned session, a draft or outline, a scene that was cut) and, when the vault has a publish list, publishes only the notes on it. `full` publishes those too, for a private copy of your own | `player` or `full` | `player` |
| `publish.folder_map` | Which vault folders are published, and the web address each gets | A vault folder and its address, one pair to a line | Nothing is mapped; setting up a site writes the standard map |
| `publish.attachments_dir` | The vault folder that holds pictures | A folder name | `_attachments` |
| `publish.exclude_dirs` | Vault folders never published | A list of folders | `_meta`, `_Templates` |
| `publish.exclude_sections` | Headings whose text is never published, on any page, however the heading is dressed (bold, a colon, a link) | A list of headings | `GM Notes`, `DM Notes`, `Player Notes`, `Source References`, `Reconciliation Context`, `Handoff to Reconcile` |
| `publish.exclude_fields` | Fields in the block at the top of a note (between its `---` lines) that are never shown | A list of field names | `secrets`, `current_plan`, `plan_progress`, `gm_notes`, `prep_notes`, `reliability` |
| `publish.exclude_callouts` | Whether Obsidian callouts (`> [!note]`) are left out | `on` for all, `off` for none, or a list of callout types | Off; a site set up by the apprentice starts with it on |
| `publish.exclude_drafts` | Whether a note with `canon_status: DRAFT` at its top is left off the site | A switch | Off: drafts publish with a "Draft" badge |
| `publish.overrides.fields` | Lets one note show a field that `exclude_fields` hides everywhere else | A note's path from the top of the vault, in quotes, then `include:` and the field names | No exceptions |

<!-- /settings:published -->

**Careful: a list in your file replaces the built-in list.** Setting up a
site writes the full `publish.exclude_sections` and `publish.exclude_fields`
lists into your file, so you can see them, and an existing site is given
them the next time you update the apprentice. Add your own heading to that
list and keep the rest. A list you delete falls back to the built-in one.
But a list that is empty (`[]`), or that leaves out `GM Notes`, hides
only what it names, so your GM notes are published. Repeat every
built-in entry you still want. The same holds for
`publish.exclude_dirs`.

**`full` mode still hides your notes to yourself.** The excluded
sections, fields, callouts and folders are left out in both modes, and
so is any note marked `publish: false`. Pictures are different: `full`
copies every picture in the attachments folder to the site, used on a
page or not, where `player` copies only the pictures a published page
shows.

```yaml
publish:
  folder_map:
    "Characters/NPCs": characters/npcs
    "Locations": locations
  # To hide one more heading and keep the built-in ones, run:
  #   settings add publish.exclude_sections Rumours
  overrides:
    fields:
      "Characters/NPCs/Vex Ambrose.md":
        include: [secrets]
```

In that folder map, notes in `Characters/NPCs` appear on the site at
`characters/npcs/`. A folder that holds notes but has no line in the map
is skipped, and the build says so.

## Theme

<!-- settings:theme -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.theme.genre` | A ready-made look: colours, lettering and section names. A genre the tool does not know is reported, and the site keeps the plain dark look | `horror`, `fantasy`, `noir`, `military` or `scifi` | No preset |
| `publish.theme.palette.primary` | The main colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a2f3a` |
| `publish.theme.palette.accent` | The accent colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#3d8a7a` |
| `publish.theme.palette.background` | The page background colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#e8f0f3` |
| `publish.theme.palette.text` | The text colour of your own palette. The four colours are set together: set all four, or none. Setting any one replaces the genre's colours, and a colour you leave out takes the built-in one | A colour | No palette: the genre's colours, or the built-in ones. With a palette, a colour left out is the built-in `#1a1a1a` |
| `publish.theme.fonts.heading` | The lettering for headings | A typeface's name | The preset's lettering, or the reader's own system font |
| `publish.theme.fonts.body` | The lettering for body text | A typeface's name | The preset's lettering, or the reader's own system font |
| `publish.theme.fonts.source` | Where the lettering comes from: `self-host` (the site downloads the typefaces once and serves them itself), `google` (the reader's browser fetches them from Google Fonts) or `local` (your own font files). With `self-host` a reader's browser never contacts Google. A source the tool does not know is reported, and `google` is used | `google`, `self-host` or `local` | `google`: what a vault that never set a source gets |
| `publish.theme.fonts.files` | Your own font files, each listed with its `family` (the typeface's name) and `path` (the file's place in the vault); used when the source is `local` | A list of font files, each with a `family`, a `path`, and optionally a `weight` and `style` | No files |
| `publish.theme.campaign_image` | The large picture at the top of the landing page | A picture's path in the vault | No picture |
| `publish.theme.default_mode` | Whether a reader starts in light or dark | `system`, `dark` or `light` | `system`: follows the reader's device |
| `publish.theme.tagline` | One sentence under the title on the landing page | Text | No tagline |
| `publish.section_titles` | Your own headings for the lists of locations, factions, items, creatures and documents | `locations`, `factions`, `items`, `creatures`, `documents`, each a title | Plain titles, or the genre's own |

<!-- /settings:theme -->

```yaml
publish:
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
  section_titles:
    locations: "Places of Note"
    creatures: "Bestiary"
```

Light and dark are a pair only a genre preset has. With a palette of
your own, or with no genre, the site has one set of colours: the sun and
moon button is not shown and `publish.theme.default_mode` does nothing.

A site set up by the apprentice uses `self-host` for its lettering.
With `local`, each font file is listed under `publish.theme.fonts.files`.

## Character sheets

<!-- settings:sheets -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.character_sheets` | Whether a character's page carries its sheet | A switch | On |
| `publish.pc_prose_sections` | With sheets off, extra sections of a character's note that are still published | A list of headings | Only the built-in ones: Background, Current Status, Notes, Relationships, Appearances, Fellow Investigators, Encounters with Strange Entities, Friends & Rivals and Long-Term Projects |
| `publish.sheet_skin` | The look of every character sheet | `plain`, `parchment`, `case-file`, `console` or `ledger` | `plain` |
| `publish.sheet_frame` | The ornament round each portrait | `none`, `ring`, `laurel`, `thorns`, `gilt`, `steel`, `corners`, `hex` or `cracked` | The skin's own frame |
| `publish.sheet_crest` | A crest or wax seal at the head of a Call of Cthulhu sheet | A picture's path in the vault | No crest |
| `publish.tohit_calculator` | The to-hit calculator on a GURPS character's Combat tab | `on` or `off` | `on` |
| `publish.dndbeyond_sync` | When D&D characters that carry a D&D Beyond link are brought up to date: `build` before each site update, or `manual` only when you ask | `build` or `manual` | `manual` |

<!-- /settings:sheets -->

One character can have its own look: put `sheet_skin` or `sheet_frame`
in the block at the top of that character's note and it wins over the
campaign's.

With `publish.character_sheets` off, a character page shows the
character's story and no numbers, and live stats are switched off with
it. The sections still published are the built-in ones named for
`publish.pc_prose_sections`, plus any you list there.

## Live play

Both of these need a site hosted on Cloudflare Pages, with its small
store for saved values set up (see
[choosing where to host it](publish-tool.md#choosing-where-to-host-it)).
The apprentice does the setting up and writes the switch for you.

<!-- settings:live -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.live_stats` | Players change hit points, spent resources and conditions on their own sheet during a session, and the party board follows. For Call of Cthulhu, GURPS and D&D; it does nothing for Pathfinder or Forged in the Dark | A switch | Off |
| `publish.inbox` | A box on each character page for sending the GM a request or a question | A switch | Off |

<!-- /settings:live -->

## The landing page

<!-- settings:landing -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.landing.max_npcs` | How many people appear under "NPCs in Play"; `0` shows none | A whole number, 0 or more | `6` |
| `publish.landing.max_locations` | How many places appear under "Latest Locations"; `0` shows none | A whole number, 0 or more | `4` |
| `publish.landing.max_events` | How many events appear under "Latest Events"; `0` shows none | A whole number, 0 or more | `4` |
| `publish.landing.recency_window` | How many recent sessions decide who and what is "in play"; `0` counts none | A whole number, 0 or more | `3` |
| `publish.landing.featured_npcs` | People pinned to the front of their row, in your order | A list of note names | Nobody pinned |
| `publish.landing.featured_locations` | The same, for places | A list of note names | Nothing pinned |
| `publish.landing.quick_links` | A short row of links on the page | A list of note names | No row |
| `publish.landing.explore_descriptions` | Your own line under each card in the "Explore the World" row | `characters`, `locations`, `story`, `factions`, `items`, `creatures`, `events`, each a sentence | The genre's lines, or plain ones |

<!-- /settings:landing -->

Name a note the way a link does, by its file name: `Osric_Marlow`, not
"Osric Marlow". A name that matches no published page gives a build
warning.

```yaml
publish:
  landing:
    max_npcs: 6
    featured_npcs: ["Osric_Marlow", "Edda_Marlow"]
    quick_links: ["Harbour_City_Map"]
```

## Lists and pictures

<!-- settings:lists -->

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.images.optimize` | Shrinks pictures as the site is built, which can cut a picture-heavy site to a fraction of its size | A switch | Off: pictures are copied as they are |
| `publish.images.format` | The format pictures are converted to. Only `webp` is available; any other is reported, and pictures are left as they are | `webp` | `webp` |
| `publish.images.max_width` | The widest a shrunk picture may be, in pixels; `0` for no limit | A whole number, 0 or more | `1600` |
| `publish.images.quality` | The quality of shrunk pictures: 0 is the smallest file, 100 the best picture, and anything above 100 counts as 100 | A number, 0 or more | `82` |
| `publish.banners` | A picture or map at the top of a section's list | A section's web address, with a picture's path, or with `image`, `link` and `alt` | A picture named `_banner` in the section's vault folder is used if there is one |
| `publish.locations.group_by` | Splits the list of locations into one block, under its own heading, for each place of a kind, such as each star system | A kind of location, or `false` | Off, except the `scifi` genre, which groups by `system` |
| `publish.locations.ungrouped_label` | The heading for places that fall in no block | Text | A standard heading |

<!-- /settings:lists -->

```yaml
publish:
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

## The site file: `vault.config.json`

This file sits in the site folder and holds only what the build needs to
find the vault and the host. The apprentice writes it when it sets the
site up; you should not need to touch it.

| Setting | What it does |
|---------|--------------|
| `vaultPath` | Where the vault is on this computer |
| `outputDir` | The folder the finished pages are written to |
| `host` | Where the site is hosted: `github-pages` or `cloudflare-pages` |
| `siteUrl` | The site's public address |
| `cloudflarePagesProject` | The site's project name on Cloudflare, when it differs from the folder's name |
| `preserveDirs` | Folders inside the output that a rebuild must leave alone |

An older site may still hold campaign settings in this file under other
names. Most are still read, each build ends with a warning that lists
them, and they are planned to stop being read in a later version. The
next time the apprentice updates the vault it offers to move them into
the vault file.

## See also

- [The publish tool](publish-tool.md): what a site is and how to host
  one.
- [Quickstart](quickstart.md): setting up a first campaign.
