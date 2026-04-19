# gm-apprentice-publish

[![npm version](https://img.shields.io/npm/v/gm-apprentice-publish)](https://www.npmjs.com/package/gm-apprentice-publish)

Static site generator for [gm-apprentice](https://github.com/AntTheLimey/gm-apprentice)
campaign vaults. Reads structured markdown files produced by the
campaign-organizer skill and outputs a self-contained HTML site suitable
for GitHub Pages.

## Requirements

Node 22 or later. Check with `node --version`.

## Installation

Run without installing:

```bash
npx gm-apprentice-publish <command>
```

Or install globally:

```bash
npm install -g gm-apprentice-publish
gm-apprentice-publish <command>
```

Or install as a project dependency:

```bash
npm install gm-apprentice-publish
```

## Quick start

**1. Scaffold a new site repo**

```bash
npx gm-apprentice-publish init my-campaign-site
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

**2. Configure `vault.config.json`**

Open `vault.config.json` and set `vaultPath` to the absolute or relative
path of your gm-apprentice vault, and `siteUrl` to the GitHub Pages URL
you plan to publish to (e.g. `https://username.github.io/campaign-name`).

**3. Build**

```bash
npx gm-apprentice-publish build
```

Output is written to the `docs/` folder. Push to GitHub and enable
GitHub Pages from the `docs/` folder in your repo settings.

---

## CLI reference

```text
gm-apprentice-publish init [dir]          Scaffold a new site
gm-apprentice-publish build [options]     Build the site from vault
gm-apprentice-publish --version           Print version
gm-apprentice-publish --help              Print help
```

### `init [dir]`

Scaffolds a new site in `dir` (defaults to the current directory).
Refuses to overwrite existing files — run it in an empty directory
or provide a new directory name.

### `build [--config path]`

Reads `vault.config.json` (or the file at `--config path`) and writes
the generated site into the `outputDir` specified in that config.
Cleans the output directory before each build, preserving any
directories listed in `preserveDirs`.

| Option | Default | Description |
|--------|---------|-------------|
| `--config <path>` | `./vault.config.json` | Path to config file |

---

## vault.config.json reference

| Field | Type | Description |
|-------|------|-------------|
| `siteTitle` | string | Site name shown in the nav bar and page title |
| `siteUrl` | string | Canonical base URL (used for absolute links) |
| `vaultPath` | string | Path to the vault directory (resolved relative to the config file) |
| `outputDir` | string | Directory to write generated HTML into (resolved relative to the config file) |
| `attachmentsDir` | string | Subfolder inside `vaultPath` that holds images (default `_attachments`) |
| `folderMap` | object | Maps vault folder paths to site output paths (see below) |
| `excludeDirs` | array | Vault subdirectories to skip entirely (e.g. `["_meta", "_Templates"]`) |
| `excludeSections` | array | Markdown H2 section headings to strip before rendering (e.g. `["GM Notes"]`) |
| `preserveDirs` | array | Output subdirectories to keep across builds (e.g. `["superpowers"]`) |

### folderMap

`folderMap` controls which vault folders become pages and where they
appear in the output. Keys are paths relative to `vaultPath`; values
are paths relative to `outputDir`.

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
| `event`, `clue`, `document`, `chapter`, `session`, `scene` | Smart wiki | Frontmatter badges + body |
| anything else | Smart wiki | All frontmatter shown as badges |

Pages with `canon_status: SUPERSEDED` render a redirect banner pointing
to the superseding entity.

### Landing page (dashboard)

The root `index.html` is a campaign dashboard generated from vault data.
It includes these sections (each omitted if no relevant data exists):

- **Hero** — campaign image (from `publish.theme.campaign_image` in
  `vault-config.md`), site title, last-played date, and in-game date
  (from `setting_year` in vault-config.md)
- **Story So Far** — first paragraph of the most recent played session's
  `## Narrative Recap` section, with a link to the full session page
- **The Team** — PC cards with portrait (or initials fallback), status
  badge (Active / KIA / MIA), and `key_traits` or `occupation`
- **Key NPCs** — up to 8 NPCs scored by session mentions, relationship
  count, and tag signals, with inferred role labels (Patron, Antagonist,
  Companion, etc.)
- **Explore** — compact grid of category index pages with entry counts,
  excluding PC and NPC categories (those have dedicated sections above)

### Player-mode image filtering

When building in `player` mode with a publish manifest, only images
referenced by the published pages are copied to the output. This
prevents GM-only images (maps, handouts, portraits of hidden NPCs)
from leaking into the public site. In full mode, all vault images
are copied.

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

Removes H2 sections whose headings appear in `excludeHeadings`.

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
