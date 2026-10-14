# Content Filtering Reference

## Content Visibility Model

All campaign content falls into three categories:

### Always excluded (default, no prompt needed)

- The folders in `player_site.hide.folders` (the vault's own `_meta` and
  template folders among them), and `personal/` directories
- All prep files: sessions/scenes with `status: planned | prepped`,
  `stage: outline | draft | ready`
- Files with `source: "prep"` that have no played counterpart
- Sections whose heading is listed in `player_site.hide.sections`
- On a `type: document` page, a handout's own Keeper sections, whatever
  that list says: `Context`, any heading starting `Clues`,
  `Prop Notes`, `Physical Prop Notes`, `Delivery`, `Delivery Notes`.
  Rename the heading to publish one
- Content between `<!-- gm-only -->` / `<!-- /gm-only -->` markers
- **Every other `<!-- ... -->` comment.** Private authoring notes
  (`<!-- UNVERIFIED: … -->`, change logs, import provenance) are
  stripped before render and never reach the site. Comments inside
  fenced code blocks are preserved. An unclosed `<!--` strips to end
  of file and prints a build warning.
- **Obsidian comments, `%% ... %%`.** Inline, or across several lines
  with `%%` on its own line above and below. A `%%` opens a comment
  and the next `%%` closes it; the text around a comment on the same
  line stays, whether the line is a paragraph, a table cell, a list
  item, a quote or a heading. `%%` in a fenced code block or in
  inline code is literal text and stays. An unclosed `%%` hides the
  rest of the note and prints a build warning. That includes a stray
  `%%` in prose, such as `100%% done`: it starts a comment, as it does
  in Obsidian. The build counts those strays in a closing warning, and
  campaign-qa's Site Faults check finds and fixes each one.
- Frontmatter fields in `player_site.hide.fields`
- Files whose frontmatter says `publish: false` — in **every** mode,
  including `full`. The file still parses, so links to it render as
  plain text rather than as a broken link; no page is emitted.
- Fields named in a file's own `publish_exclude_fields`, on that file
  only, merged over `player_site.hide.fields`.
- Relationship edges marked `gm_only: true` — removed from the page,
  its Connections (at both ends), and the search index.
- On a `publish: stub` file, everything except the sections named in
  `publish_include_sections`. Everything in this list is withheld
  first, so a named section under a withheld heading, or inside a
  `gm-only` block, a spoiler block or a comment, stays withheld.

A heading is matched by its words, not its dressing. `## GM Notes`,
`## GM Notes:`, `## **GM Notes**`, `## _GM Notes_`, `## GM Notes {#gm}`,
`## GM Notes ^gm`, `## [[GM Notes]]`, `## GM Notes ##`, `## gm  notes`
and a Setext heading (`GM Notes` underlined with `---`) are all the same
section. Emphasis (`*`, `_`, `~~`, `==`, backticks), a trailing `{#id}`
or `{.class}`, a trailing `^block-id`, closing `#`s, one trailing colon,
link brackets and spacing are ignored, and case does not matter. A link
with a label (`[[Plans|GM Notes]]`) counts as both its label and its
target. A heading with other words (`GM Notes on travel`) or a trailing
dash or emoji is a different section and is not hidden. A name in
`player_site.hide.sections` and in `publish_include_sections` is read the same
way.

A heading line written inside a fenced code block is code, not a heading:
it neither starts nor ends a hidden section. A fence that is never closed
is not trusted, so a heading after it is still read as a heading.

### Frontmatter is not covered by the fence

`<!-- gm-only -->` is a **body** primitive. It has no meaning inside
frontmatter, and it never has had — so a secret that lives in a field
(`occupation`, `key_traits`) or in a relationship target is not
protected by fencing the body, and neither are the views derived from
those fields: the character sheet, the Connections, the search
index. That is what `publish_exclude_fields` and edge-level `gm_only`
are for. Reach for them whenever the *fact of the field* is the secret
— a traitor whose `occupation` names their true allegiance, or an edge
to the cult leader whose existence gives the game away.

### Connections follows the same rules

A page's Connections holds only what some published page shows. A
note that does not publish is not listed, an edge marked `gm_only`
is gone at both ends, a note that excludes `relationships` lists
none (the other notes' edges to it still show there). A link with
a label prints the label, never the name behind it, when its target
has no published page; a target that has one is listed under that
page's own title, so a label does not disguise a published note.

**The tone is shown.** Each relationship appears as warm (a positive
tone), hostile (negative) or neutral, never as the word itself. A
tie whose tone gives something away (a hostile edge to the person
the party trusts) wants `gm_only: true` or another tone;
campaign-qa's Tone Words check lists the hostile ties the site shows.

### Always included

- Played/reviewed sessions (`status: played | reviewed`)
- Scenes with `status: played` or `status: modified` (they
  happened — publish the reality, even if modified from plan)
- Entity files in standard vault folders
- `_Campaign/` overview files
- `_attachments/` images referenced by included entities

### Always excluded (scene-level)

- Scenes with `status: cut` (removed from the session)
- Scenes with `status: skipped` (didn't happen)

### Ambiguous (ask the GM)

- Files with no `type` field
- Files in non-standard directories
- Entities with `canon_status: SUPERSEDED` that have
  no `superseded_by` reference

## Configuration

`node "$TOOL" settings get player_site.hide --config
<dir>/vault.config.json` says what the site hides. To hide one more heading, field or folder
use `settings add`; `settings set` replaces the whole list, built-in
entries included.

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
- Put markers on their own lines where you can; a marker mid-line
  (`a <!-- gm-only -->X<!-- /gm-only --> b`) also works, and strips
  just the marked text
- Can appear anywhere in body text (not in frontmatter)
- Can span multiple paragraphs
- The processor strips markers and everything between them

**Primary approach:** Put GM content under a "GM Notes" H2
heading. Use inline markers only when you need finer control
within a section.

**Edge cases:**
- Unclosed marker: content stripped to end of file (safe default)
- Marker inside a fenced code block: ignored (treated as literal),
  with LF or CRLF line endings
- Marker inside inline code (backticks): **not** ignored. It still
  opens or closes a block, so to show one mid-sentence, use a fenced
  block instead. This errs towards hiding, and the build warns

## Inline Spoiler Markers

For narrative content that's hidden only because the story hasn't
reached it yet — not permanently secret — use `<!-- spoiler -->` /
`<!-- /spoiler -->` instead of `<!-- gm-only -->`. Mechanically
identical (same open/close-pair rules: own line or mid-line, body text
only, can span paragraphs, code-fence-literal), but semantically and
operationally different:

~~~markdown
The innkeeper seems friendly enough.

<!-- spoiler -->
He's secretly reporting the party's movements to the cult.
<!-- /spoiler -->
~~~

**`<!-- gm-only -->` never converts** — it's meta content (tactics,
design notes) that's never meant to be player-facing, regardless of
story progress.

**`<!-- spoiler -->` is lifecycle-managed.** There's no pre-declared
reveal date — a GM doesn't know which session will reveal a given
secret until play gets there. Instead, `reconcile` (run every session)
checks entities the session actually touched for open `<!-- spoiler -->`
blocks and asks the GM whether each was revealed in play. On yes, the
fence markers are stripped — a plain text edit, so the content is
permanently public prose from then on with no new state to track. See
`shared/reconcile.md` for the exact step.

Because a spoiler can be revealed in an entity that reconcile didn't
happen to check that session (the reveal happened in dialogue that
never made it into the wrap-up notes, or the entity wasn't obviously
"touched"), campaign-qa also runs a full-vault open-spoilers audit on
demand — see `campaign-qa/references/checks/open-spoilers.md`.

## Excluding Callouts (opt-in)

`player_site.hide.callouts` strips Obsidian callouts (`> [!type] Title`
blocks): every one, or only the types it lists.

The gm-apprentice convention treats callouts as Keeper-facing
(Campaign Design Decisions, Alert Levels, Keeper-Only notes, Canon
State), so **newly scaffolded** sites turn it on. A site created
before the setting existed publishes every callout until it is set;
`settings get player_site.hide.callouts` says which this site does. If
the GM relies on callouts to hide Keeper content, turn it on, or move
that content under a `## GM Notes` heading or `<!-- gm-only -->`
markers, which are excluded regardless.

Plain blockquotes (`> "an in-world quote"`) carry no `[!type]` marker
and are never touched — keep read-aloud text as a plain blockquote,
not a callout, if you want it published. Callout examples inside a
fenced code block are preserved as documentation.

## Publish Manifest

The manifest at `_meta/publish-manifest.md` is the work order
for the build tool. It lists every file categorized as
publish/exclude/needs-decision.

The build tool reads this file directly — no rescanning needed.

### Manifest Format

The manifest is a markdown file with YAML frontmatter and three
H2 sections. The build tool's parser (`lib/manifest.js`) uses the
heading to bucket each entry into Publishing/Excluded/Needs
Decision. Only `player` mode (see § Publish Modes) enforces the
manifest as an inclusion filter — and even there, a file publishes
if and only if it's a **checked** entry under `## Publishing`.
Checking the box under `## Excluded` or `## Needs Decision` never
publishes the file: those buckets are read (Excluded, to suppress a
separate "missing from manifest" warning) but never for inclusion.
In `full` mode (the GM's own copy), the manifest isn't applied as
a filter at all — every scanned page publishes regardless of what's
checked.

**Frontmatter** (metadata, not used by the build tool):

~~~yaml
---
generated: 2026-04-22T10:00:00Z
vault: "My Campaign"
mode: player
total_files: 25
publishing: 18
excluded: 5
needs_decision: 2
---
~~~

**Sections:**

- `## Publishing` — files to include in the build. Each entry
  is a checked checkbox with a vault-relative path:
  `- [x] Characters/NPCs/Friendly Merchant.md`
  Optionally annotated with an inline reason, like Excluded:
  `- [x] Documents/House Rules.md — the party's own notes`

- `## Excluded` — files to exclude. Also uses checked checkboxes.
  Optionally annotated with a reason:
  `- [x] Sessions/Session 7.md — prep`

- `## Needs Decision` — files the GM hasn't categorized yet.
  Uses **unchecked** checkboxes: `- [ ] Events/Ambiguous Event.md`
  The build tool ignores these (they are not published).
  When the GM decides, check the box and move the line to
  Publishing or Excluded.

**Path format:** All paths are vault-relative using forward
slashes (e.g. `Characters/NPCs/Alice.md`). Never use absolute
filesystem paths. An inline `— comment` after the path is ignored;
an em dash inside the filename itself is preserved. A Publishing
entry that matches no vault file prints a build warning rather
than silently dropping the page.

**Example manifest:**

~~~markdown
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

- [x] Sessions/Session 7.md — prep
- [x] Sessions/Session 8.md — prep
- [x] Characters/NPCs/Hidden Antagonist.md — GM override

## Needs Decision (2 files)

- [ ] Events/The Vanishing.md
- [ ] Documents/Mysterious Letter.md
~~~

`gm-publish manifest diff` classifies every vault file with these rules
and `manifest apply` writes this format; edit by hand only when node is
unavailable.

## Campaign Image

The campaign image appears on the landing page hero and 404 page.
The setting is `player_site.theme.campaign_image`.

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
4. Store the vault-relative path with `settings set`

The generated SVG should use the theme's primary, accent, and
background colours and include decorative elements appropriate
to the genre (e.g. tactical HUD for military, arcane sigils
for fantasy, tentacles for horror).

## Themed 404 Page

Links to excluded entities resolve to a custom 404 page
with an in-world message, the setting
`player_site.not_found`.

The campaign image is also displayed on the 404 page when
configured. The 404 template uses absolute paths derived from
`player_site.url` so it works correctly when served from any nested URL.

**Setup flow:** Suggest 2-3 genre-appropriate messages as
options (e.g. "CLASSIFIED — CLEARANCE LEVEL INSUFFICIENT" for
military, "The stars are not yet right..." for horror). Accept
custom input as an alternative.

## Publish Modes

- `player`: Only player-known content is published
- `full`: The GM's own copy. Notes held back as prep (`status: planned`
  or `prepped`, `stage: outline`, `draft` or `ready`, `source: prep`, a
  cut or skipped scene) publish, the publish manifest is not applied,
  and every image in the attachments folder is copied, used or not. Every other
  `player_site.hide` setting and a note's own `publish: false` still apply. The
  built-in lists keep GM-only sections and fields off a `full` site;
  a list the GM has replaced must still name them

## Setup Questioning Flow

First-time theme, image, and 404 setup is handled by the setup
wizard (see `setup-wizard.md` steps 8-10). The filtering workflow
in this document assumes those are already configured.

When content filtering is triggered outside of first-time setup
(capability 6 in SKILL.md) and its first step finds no theme, image
or 404 message set, ask the questions described in the wizard steps
before proceeding with the manifest workflow.
