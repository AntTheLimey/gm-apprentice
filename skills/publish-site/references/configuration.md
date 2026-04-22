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
| Excluded fields | `publish.exclude_fields` | Frontmatter fields to strip (default: `["secrets", "current_plan", "plan_progress"]`) |
| Excluded directories | `publish.exclude_dirs` | Vault directories to skip (default: `["_meta", "_Templates"]`) |
| Campaign image | `publish.theme.campaign_image` | Vault-relative path to hero image |
| Theme palette | `publish.theme.palette` | Colour scheme (primary, accent, background, text) |
| Theme fonts | `publish.theme.fonts` | Heading and body font families |
| Theme genre | `publish.theme.genre` | Genre tag for theming hints |
| 404 message | `publish.four_oh_four.message` | Custom in-world 404 text |
| Overrides | `publish.overrides` | Per-file include/exclude/field overrides |
| Setting year | `setting_year` | In-game date shown on the landing page |

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
