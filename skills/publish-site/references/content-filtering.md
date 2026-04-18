# Content Filtering Reference

## Content Visibility Model

All campaign content falls into three categories:

### Always excluded (default, no prompt needed)

- `_meta/`, `_Templates/`, `personal/` directories
- All prep files: sessions/scenes with `status: planned | prepped`,
  `stage: outline | draft | ready`
- Files with `source: "prep"` that have no played counterpart
- H2 sections listed in `exclude_sections` (default: `["GM Notes"]`)
- Content between `<!-- gm-only -->` / `<!-- /gm-only -->` markers
- Frontmatter fields in `exclude_fields` (default:
  `["secrets", "current_plan", "plan_progress"]`)

### Always included

- Played/reviewed sessions (`status: played | reviewed`)
- Entity files in standard vault folders
- `_Campaign/` overview files
- `_attachments/` images referenced by included entities

### Ambiguous (ask the GM)

- Scenes with `status: skipped | cut | modified`
- Entities not matching any clear convention
- Files the skill cannot confidently categorize

## Configuration

All settings live in `_meta/vault-config.md` under `publish:`.
See the design spec for the full schema.

## Inline GM-Only Markers

For cases where GM and player content are mixed within a
single section, use inline markers:

~~~markdown
The tavern is warm and inviting.

<!-- gm-only -->
The barkeep is secretly a spy for the Crimson Court.
<!-- /gm-only -->

A notice board hangs near the door.
~~~

**Rules:**
- Markers must be on their own lines
- Can appear anywhere in body text (not in frontmatter)
- Can span multiple paragraphs
- The processor strips markers and everything between them

**Primary approach:** Put GM content under a "GM Notes" H2
heading. Use inline markers only when you need finer control
within a section.

**Edge cases:**
- Unclosed marker: content stripped to end of file (safe default)
- Marker inside a code block: ignored (treated as literal)

## Publish Manifest

The manifest at `_meta/publish-manifest.md` is the work order
for the build tool. It lists every file categorized as
publish/exclude/needs-decision.

The build tool reads this file directly — no rescanning needed.

## Themed 404 Page

Links to excluded entities resolve to a custom 404 page
with an in-world message. The message is stored at
`publish.four_oh_four.message` in `vault-config.md`.

## Publish Modes

- `player` (default): Only player-known content is published
- `full`: Everything is published (GM's private reference copy)
