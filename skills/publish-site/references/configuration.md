# Configuration Reference

Publish settings are split between two files. Understanding
which file owns which setting prevents confusion.

## `_meta/vault-config.md` (in the vault)

YAML frontmatter under `publish:`. This is the authoritative
source for content filtering and theming. Values here override
any equivalent in `vault.config.json`.

| Setting | Key path | Description |
|---------|----------|-------------|
| Publish mode | `publish.mode` | `player` or `full` |
| Excluded sections | `publish.exclude_sections` | H2 headings to strip (default: `["GM Notes"]`) |
| Excluded fields | `publish.exclude_fields` | Frontmatter fields to strip (default: `["secrets", "current_plan", "plan_progress", "gm_notes", "prep_notes"]`) |
| Excluded directories | `publish.exclude_dirs` | Vault directories to skip (default: `["_meta", "_Templates"]`) |
| Campaign image | `publish.theme.campaign_image` | Vault-relative path to hero image |
| Theme palette | `publish.theme.palette` | Colour scheme (primary, accent, background, text) |
| Theme fonts | `publish.theme.fonts` | Heading and body font families |
| Theme genre | `publish.theme.genre` | Genre tag for theming hints |
| 404 message | `publish.four_oh_four.message` | Custom in-world 404 text |
| Overrides | `publish.overrides` | Per-file include/exclude/field overrides |
| Section index titles | `publish.section_titles` | Override h1 titles on the Locations/Factions/Items/Creatures index pages |
| Exclude drafts | `publish.exclude_drafts` | When `true`, DRAFT entities are excluded entirely (default: `false`) |
| Image optimization | `publish.images` | Opt-in WebP re-encoding of copied images (default: off) |
| Section banners | `publish.banners` | Hero image or clickable map at the top of a section index |
| Locations grouping | `publish.locations` | Pivot the Locations index on a `location_type` (default: genre-derived) |
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

Assets are copied to `docs/images/banners/`. A path resolving outside the
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

## `vault.config.json` (in the site repo)

JSON file in the site directory. Controls paths, URLs, and
display settings that are specific to the generated site.

| Setting | Key | Description |
|---------|-----|-------------|
| Vault path | `vaultPath` | Path to the vault directory |
| Output directory | `outputDir` | Where generated HTML is written |
| Site title | `siteTitle` | Name shown in nav bar and browser tab |
| Landing tagline | `landingTagline` | One-sentence hook on the homepage |
| Site URL | `siteUrl` | Canonical base URL for absolute links |
| Attachments directory | `attachmentsDir` | Subfolder in vault holding images |
| Folder map | `folderMap` | Maps vault folders to site output paths |
| Exclude directories | `excludeDirs` | Fallback if `vault-config.md` doesn't set `publish.exclude_dirs` |
| Exclude sections | `excludeSections` | Fallback if `vault-config.md` doesn't set `publish.exclude_sections` |
| Preserve directories | `preserveDirs` | Output subdirectories to keep across builds |

## Precedence

When both files define the same setting (e.g. `excludeSections`
in `vault.config.json` and `publish.exclude_sections` in
`vault-config.md`), the vault-config.md value wins. The JSON
file values are used only as fallbacks.

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
