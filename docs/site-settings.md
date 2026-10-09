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
| `vault.config.json` | In the site folder | Six deployment settings: where the vault is, where the pages are written, where the site is hosted |

The vault file travels with the campaign. The site file belongs to the
one computer and host the site is built on.

## How the vault file is laid out

The settings sit at the top of `_meta/vault-config.md`, between the two
`---` lines, indented under `publish:`. This page writes a setting as
`publish.site_title`; in the file that is:

```yaml
---
publish:
  site_title: "The Iron Crown"
  mode: player
  system: gurps-4e
  theme:
    genre: military
    tagline: "A Special Forces campaign set in 1990s Britain."
---
```

Three rules cover most surprises:

- **A setting you leave out uses its default.** A short file is a
  normal file.
- **Indent with spaces, never tabs**, two spaces for each level.
- **A change shows on the site at its next build.** Nothing changes for
  players until the site is rebuilt and deployed.

When a setting is misspelt or holds a value the site cannot use, the
build says so in a warning that names the setting, and carries on with
the default.

## Changing a setting

- **Ask the apprentice.** It finds the setting, changes it, and
  rebuilds. This is the way to do it.
- **Edit the file.** Open `_meta/vault-config.md` in Obsidian or any
  text editor, change the line, save, then ask for the site to be
  rebuilt.

## The site itself

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.site` | Whether this vault has a site at all | `true` or `false` | On when `publish.site_dir` is set, otherwise off |
| `publish.site_dir` | The folder on this computer that holds the site | A folder path | No site folder; setting up a site writes it |
| `publish.site_title` | The name in the menu bar and the browser tab | Text | No title; setting up a site writes one |
| `publish.footer` | A line at the foot of every page | Text | No footer |
| `publish.search` | The search box and its index | `true` or `false` | `true` |
| `publish.system` | The game system, which decides how a character sheet is drawn | `coc-7e`, `coc-7e-regency`, `gurps-4e`, `dnd-5e-2024`, `pf2e`, `fitd` | A plain character page with no system sheet |
| `publish.four_oh_four.message` | The words shown when a reader follows a link to a page that is not there | Text | A standard message |
| `setting_year` | The in-game year shown on the landing page when the campaign overview gives no current date. It sits beside `publish:`, not under it | A year | Nothing shown |

Set `publish.site: false` to stop publishing without losing the site
folder's path. With the site off nothing is built.

## What gets published

These decide which notes and which parts of a note reach the site. The
apprentice's leak checks read the same settings, so what they report is
what the site would show.

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.mode` | `player` publishes only what players may know. `full` publishes everything, for a private copy of your own | `player` or `full` | `player` |
| `publish.folder_map` | Which vault folders are published, and the address each gets on the site | Folder: address pairs | Nothing is mapped; setting up a site writes the standard map |
| `publish.attachments_dir` | The vault folder that holds images | A folder name | `_attachments` |
| `publish.exclude_dirs` | Vault folders never published | A list of folders | `_meta`, `_Templates` |
| `publish.exclude_sections` | `##` headings whose text is never published, on any page | A list of headings | `GM Notes`, `DM Notes`, `Player Notes`, `Source References`, `Reconciliation Context`, `Handoff to Reconcile` |
| `publish.exclude_fields` | Frontmatter fields never shown | A list of field names | `secrets`, `current_plan`, `plan_progress`, `gm_notes`, `prep_notes`, `reliability` |
| `publish.exclude_callouts` | Whether Obsidian callouts (`> [!note]`) are left out | `true` for all, `false` for none, or a list of callout types | `false`; a site set up by the apprentice starts at `true` |
| `publish.exclude_drafts` | Whether a note marked `canon_status: DRAFT` is left off the site | `true` or `false` | `false`: drafts publish with a "Draft" badge |
| `publish.overrides.fields` | Lets one named note show a field that `exclude_fields` hides everywhere else | A note's path, with `include:` and a list of fields | No exceptions |

**Setting an exclude list replaces the built-in list.** If you set
`publish.exclude_sections` to add one heading, repeat the built-in
headings you still want hidden, or `GM Notes` will publish.

```yaml
publish:
  exclude_sections: ["GM Notes", "DM Notes", "Player Notes", "Rumours"]
  exclude_fields: [secrets, gm_notes]
  overrides:
    fields:
      "Characters/NPCs/Vex Ambrose.md":
        include: [secrets]
```

A folder that holds notes but has no line in `publish.folder_map` is
skipped, and the build says so.

## Theme

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.theme.genre` | A ready-made look: colours, lettering and section names | `fantasy`, `horror`, `noir`, `military`, `scifi` | No preset |
| `publish.theme.palette` | Your own colours, in place of a preset's | `primary`, `accent`, `background` and `text`, each a colour such as `"#1a2f3a"` | The preset's colours, or the built-in ones |
| `publish.theme.fonts` | The lettering for headings and body text, and where it is loaded from | `heading`, `body`, `source`, `files` | The preset's lettering, or the reader's system font |
| `publish.theme.default_mode` | Whether a reader starts in light or dark | `system`, `dark` or `light` | `system`: follows the reader's device |
| `publish.theme.tagline` | One sentence under the title on the landing page | Text | No tagline |
| `publish.theme.campaign_image` | The large picture at the top of the landing page | An image's path in the vault | No picture |
| `publish.section_titles` | Your own headings for the Locations, Factions, Items and Creatures lists | `locations`, `factions`, `items`, `creatures`, each a title | Plain titles, or the genre's own |

The sun and moon button that lets a reader switch between light and dark
appears only with a genre preset and no palette of your own, because
only a preset has both sets of colours.

`publish.theme.fonts.source` says where lettering comes from:

- `self-host`: the site downloads the typefaces once and serves them
  itself, so a reader's browser never contacts Google. New vaults start
  here.
- `google`: the reader's browser fetches them from Google Fonts. This is
  what an older vault that never set it gets, and the build warns about
  it.
- `local`: your own font files, listed under `publish.theme.fonts.files`.

## Character sheets

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.character_sheets` | Whether a character's page carries its sheet | On or off | On |
| `publish.pc_prose_sections` | With sheets off, extra `##` sections of a character note that are still published | A list of headings | Only the built-in ones (Background, Current Status, Notes, Relationships, Appearances) |
| `publish.sheet_skin` | The look of every character sheet | `plain`, `parchment`, `case-file`, `console`, `ledger` | `plain` |
| `publish.sheet_frame` | The ornament round each portrait | `ring`, `laurel`, `thorns`, `gilt`, `steel`, `corners`, `hex`, `cracked`, `none` | The skin's own frame |
| `publish.sheet_crest` | A crest or wax seal at the head of a Call of Cthulhu sheet | An image's path in the vault | No crest |
| `publish.dndbeyond_sync` | When D&D characters that carry a D&D Beyond link are brought up to date | `build` (before each site update) or `manual` (only when you ask) | `manual` |

One character can have its own look: put `sheet_skin` or `sheet_frame`
in that character's note and it wins over the campaign's.

With `publish.character_sheets` off, a character page shows the
character's story and no numbers, and live stats are switched off with
it.

## Live play

Both of these need a site hosted on Cloudflare Pages with its small data
store set up. The apprentice does the setting up and writes the switch
for you.

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.live_stats` | Players change hit points, spent resources and conditions on their own sheet during a session, and the party board follows | On or off | Off |
| `publish.inbox` | A box on each character page for sending the GM a request or a question | On or off | Off |

## The landing page

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.landing.max_npcs` | How many people appear under "NPCs in Play" | A number | `6` |
| `publish.landing.max_locations` | How many places appear under "Latest Locations" | A number | `4` |
| `publish.landing.recency_window` | How many recent sessions decide who and what is "in play" | A number | `3` |
| `publish.landing.featured_npcs` | People pinned to the front of their row, in your order | A list of note names | Nobody pinned |
| `publish.landing.featured_locations` | The same, for places | A list of note names | Nothing pinned |
| `publish.landing.quick_links` | A short row of links near the top of the page | A list of note names | No row |

Name a note the way a link does, by its file name: `Hugh_Cavendish`, not
"Hugh Cavendish". A name that matches no published page gives a build
warning.

```yaml
publish:
  landing:
    max_npcs: 6
    featured_npcs: ["Hugh_Cavendish", "Margaret_Cavendish"]
    quick_links: ["Calcutta_City_Map"]
```

## Lists and pictures

| Setting | What it does | Values | Left out |
|---------|--------------|--------|----------|
| `publish.banners` | A picture or clickable map at the top of a section's list | A section name with an image path, or with `image`, `link` and `alt` | A file named `_banner` in the section's folder is used if there is one |
| `publish.locations.group_by` | Splits the Locations list into one block for each place of a kind, such as each star system | A kind of location, or `false` | Off, except the `scifi` genre, which groups by `system` |
| `publish.locations.ungrouped_label` | The heading for places that fall in no block | Text | A standard heading |
| `publish.images.optimize` | Shrinks pictures as the site is built, which can cut a picture-heavy site to a fraction of its size | `true` or `false` | `false`: pictures are copied as they are |
| `publish.images.max_width` | The widest a shrunk picture may be, in pixels | A number; `0` for no limit | `1600` |
| `publish.images.quality` | How hard pictures are compressed | A number up to 100 | `82` |
| `publish.images.format` | The format pictures are converted to | `webp` | `webp` |

Shrinking pictures needs a small free program called `cwebp` on the
computer that builds the site. Without it the build warns and copies the
pictures unchanged.

## A switch

Several settings are a plain on or off. For on, write `true`, `yes` or
`on`; for off, `false`, `no` or `off`. Anything else, including a line
left empty, counts as off, and the build warns and names the setting.

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
names. They still work, and each build ends with a warning that lists
them. The next time the apprentice updates the vault it offers to move
them into the vault file.

## See also

- [The publish tool](publish-tool.md): what a site is and how to host
  one.
- [Quickstart](quickstart.md): setting up a first campaign.
