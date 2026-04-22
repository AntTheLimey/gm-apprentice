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

### Manifest Format

The manifest is a markdown file with YAML frontmatter and three
H2 sections. The build tool's parser (`lib/manifest.js`) reads
the sections by heading prefix and checkbox state.

**Frontmatter** (metadata, not used by the build tool):

```yaml
---
generated: 2026-04-22T10:00:00Z
vault: "My Campaign"
mode: player
total_files: 25
publishing: 18
excluded: 5
needs_decision: 2
---
```

**Sections:**

- `## Publishing` — files to include in the build. Each entry
  is a checked checkbox with a vault-relative path:
  `- [x] Characters/NPCs/Friendly Merchant.md`

- `## Excluded` — files to exclude. Also uses checked checkboxes.
  Optionally grouped by reason:
  `- Reason: prep`
  `  - Sessions/Session 7.md`

- `## Needs Decision` — files the GM hasn't categorized yet.
  Uses **unchecked** checkboxes: `- [ ] Events/Ambiguous Event.md`
  The build tool ignores these (they are not published).
  When the GM decides, check the box and move the line to
  Publishing or Excluded.

**Path format:** All paths are vault-relative using forward
slashes (e.g. `Characters/NPCs/Alice.md`, not
`/Users/me/vault/Characters/NPCs/Alice.md`).

**Example manifest:**

```markdown
---
generated: 2026-04-22T10:00:00Z
vault: "Canticle of the End"
mode: player
total_files: 42
publishing: 30
excluded: 10
needs_decision: 2
---

## Publishing (30 files)

- [x] _Campaign/Campaign Overview.md
- [x] Characters/PCs/Helena Ashworth.md
- [x] Characters/NPCs/Lord Pemberton.md
- [x] Locations/Bath Assembly Rooms.md
- [x] Sessions/Session 1.md
- [x] Sessions/Session 2.md

## Excluded (10 files)

- Reason: prep
  - Sessions/Session 7.md
  - Sessions/Session 8.md
- Reason: GM override
  - Characters/NPCs/Hidden Antagonist.md

## Needs Decision (2 files)

- [ ] Events/The Vanishing.md
- [ ] Documents/Mysterious Letter.md
```

## Campaign Image

The campaign image appears on the landing page hero and 404 page.
Set in `publish.theme.campaign_image` in `vault-config.md`.

**Path handling:** The value is a vault-relative path (e.g.
`_attachments/campaign-image.svg`). The build tool copies it to
the output `images/` directory and resolves the path automatically.
External URLs (`https://...`) are passed through unchanged.

**Supported formats:** JPG, PNG, WebP, GIF, SVG. SVG is ideal
for procedurally generated campaign art since it scales cleanly
and keeps file size small.

**Setup flow (sequential questioning):**

1. Ask: "Do you have an existing campaign image you'd like to use?"
2. If yes → ask for the path, validate it exists
3. If no → offer to generate a procedural SVG with genre-appropriate
   motifs using the campaign's theme palette
4. Store the vault-relative path in `campaign_image`

The generated SVG should use the theme's primary, accent, and
background colours and include decorative elements appropriate
to the genre (e.g. tactical HUD for military, arcane sigils
for fantasy, tentacles for horror).

## Themed 404 Page

Links to excluded entities resolve to a custom 404 page
with an in-world message. The message is stored at
`publish.four_oh_four.message` in `vault-config.md`.

The campaign image is also displayed on the 404 page when
configured. The 404 template uses absolute paths derived from
`siteUrl` so it works correctly when served from any nested URL.

**Setup flow:** Suggest 2-3 genre-appropriate messages as
options (e.g. "CLASSIFIED — CLEARANCE LEVEL INSUFFICIENT" for
military, "The stars are not yet right..." for horror). Accept
custom input as an alternative.

## Publish Modes

- `player` (default): Only player-known content is published
- `full`: Everything is published (GM's private reference copy)

## Setup Questioning Flow

First-time theme, image, and 404 setup is handled by the setup
wizard (see `setup-wizard.md` steps 8-10). The filtering workflow
in this document assumes those are already configured.

When content filtering is triggered outside of first-time setup
(capability 6 in SKILL.md), check `vault-config.md` for existing
theme/image/404 settings. If missing, ask the questions described
in the wizard steps before proceeding with the manifest workflow.
