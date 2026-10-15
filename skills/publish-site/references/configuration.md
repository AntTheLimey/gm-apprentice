# Configuration Reference

Everything about the site is a setting in the vault. The site
folder's `vault.config.json` holds only where the vault is
(`vaultPath`).

## Settings

The publish tool holds the one list of settings. Never open the
settings file to read one, and never edit it by hand:
`node "$TOOL" settings --help` shows every verb (`list`, `describe`,
`get`, `set`, `add`, `remove`, `unset`, `check`). `$TOOL` is the
plugin's `gm-publish.js` (`SKILL.md` § The build tool).

Give `--config <dir>/vault.config.json`; with no site yet, `--vault
<vault>`. A
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
was meant to be hidden. A settings file that is not valid YAML is the
one thing mended by hand: campaign-qa's
`references/checks/settings.md`, last paragraph. The same check moves
a setting or build step an older site still keeps in its own folder.

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

`player_site.images.optimize` needs the `cwebp` binary on `PATH`
(`brew install webp`, `apt install webp`). Without it the build warns
and copies the originals.

### Section index banners

Either drop a `_banner.*` file into the section's vault folder
(`Locations/_banner.svg`), or name one in `player_site.lists.banners`, which
wins. The setting is one map, so write it whole:

```bash
node "$TOOL" settings set 'player_site.lists.banners={"locations":{"image":"_attachments/sector-map.webp","link":"_attachments/sector-map.svg","alt":"Sector 7-G star chart"},"factions":"_attachments/factions-hero.svg"}' --config <dir>/vault.config.json
```

An **SVG with no `link` is inlined**, so its internal `<a>` elements stay
live — a star map whose nodes link to entity pages keeps working. Write
those hrefs relative to the index page (`corwin-system.html`). Anything
with a `link` renders as an `<img>` inside an `<a>`, since an outer
anchor would swallow an SVG's own links.

### Locations index grouping

`player_site.lists.locations.group_by` is matched as a case-insensitive
substring of `location_type`, so `system` matches both `system` and
`star system`. When fewer than two locations match, the list stays
flat: one section is not a grouping.

### Pinning landing entries

`settings add player_site.landing.featured_npcs Hugh_Cavendish` pins
one. Name an entity the way a wiki-link does: the filename form, not
the display title. A pinned entity appears even if no session has
mentioned it. A name that resolves to no published page prints a build
warning; if it is spelled right, the page is probably excluded from
the site.

### Extra menu entries

```bash
node "$TOOL" settings add player_site.menu_extra label=Gazetteer link=gazetteer/index.html group=World --config <dir>/vault.config.json
```

One entry a call. `link` is a note's name, a page on the site or a web
address; a link to a note with no page is left out of the menu, with a
build warning. `settings remove player_site.menu_extra Gazetteer`
takes one out by its label.

### Landing banner

```bash
node "$TOOL" settings set player_site.landing.banner.title="Season two starts 4 May" player_site.landing.banner.text="Bring your sheets." --config <dir>/vault.config.json
```

`.link` and `.image` (a picture in the vault) are the other two parts.
To take the banner down, `settings unset` each part that is set.

### Per-file field overrides

When one page needs a hidden field back, `player_site.hide.field_exceptions`
names the page and the fields. It is one map, so `get` it and write it
whole, keeping the notes already there:

```bash
node "$TOOL" settings set 'player_site.hide.field_exceptions={"Characters/NPCs/Vex Ambrose.md":{"include":["secrets"]}}' --config <dir>/vault.config.json
```

There is no per-file `exclude`; to strip a field from one page only,
remove it from that page's frontmatter. Whole files are included or
excluded through the publish list (`manifest apply`), not here — see `content-filtering.md`.

### Player-facing Wrap-Up sections

A Wrap-Up H2 outside the fenced `## GM Notes` is player-facing,
whatever it is called: it publishes unless `player_site.hide.sections`
names it. Of these, `vault_check wrapup --fix` moves only a heading the
template keeps under GM Notes (`## World State`, `## Skipped Prep`),
back under it. It also renames a recap under another title to
`## Narrative Recap`, and notes a second recap-titled section without
touching it. No setting lists player-facing sections.

## Switches

`player_site.publish` says whether the vault has a site.

- **On, with `player_site.folder` set.** Builds run, and `vault_check`
  `gm-leak`, `pc-body` and `wrapup` ask the site's publish tool what
  publishes.
- **On, with no `player_site.folder`.** A site still to be set up. Those
  checks stop with one ERROR row that says to run the setup or turn
  the switch off.
- **Off.** `build` and `deploy` stop with one line and exit code 1.
  `gm-leak` gives one INFO row and checks nothing. Only `wrapup` runs
  without Node; `gm-leak` and `pc-body` still read the settings through
  the tool and stop with one line when Node is missing. Turning the
  switch off stops publishing without losing the folder's path.

`player_site.sheets.show`, `player_site.features.live_stats` and `player_site.features.inbox`
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
- any heading listed in `player_site.sheets.prose_sections`

Titles match case-insensitively, ignoring bold or italic wrapping and
a trailing colon. Every other section is withheld, including a
homebrew section the build does not recognise and any text before the
first `##` heading. Withheld text is left out of the page, the search
index and every other output. `player_site.hide.sections` still applies
on top, so `GM Notes` stays hidden as always.

**Heading-shift warning.** If a link or embed label in a PC note would
change the note's headings once resolved, the build cannot tell which
sections are safe. It withholds everything after the note's title and
prints:

```text
WARNING: <page>: a link or embed label changes this note's headings; nothing after its title is published while character sheets are off. Fix the label.
```

Fix the label in the note and rebuild.
