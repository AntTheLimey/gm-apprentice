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
- Files whose frontmatter says `publish: false`. The file still parses, so links to it render as
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

## Publish List

The publish list, `_meta/publish-list.yaml`, is the work order for the
build. It holds every file the GM has decided on: `publishing`,
`excluded` (each may carry a reason) and `needs_decision`.

A file publishes if and only if it is under `publishing`. Being under `excluded` or `needs_decision` never
publishes it; those lists only quiet the "not on the publish list"
warning.

The file may also hold `accepted:`, the leak check's findings the GM
accepted, each `{ page, text, note }`. `leaks accept` writes it; nobody edits
it by hand; an absent key is an empty list. A file holding only `accepted:` is
not a publish list: the vault publishes as it would with none.

Never open the file to read or change it. Ask the tool:

- `node "$TOOL" manifest list --vault <vault>` shows the three lists and
  their counts (`--json` for the whole thing).
- `manifest diff --config <dir>/vault.config.json` sorts every vault file
  by the rules in this document and shows what is not on the list yet.
- `manifest apply --config <dir>/vault.config.json --publish <path>...
  --exclude "<path>=<reason>"... --decide <path>...` moves entries between
  the lists. Paths are vault-relative, with forward slashes. A path
  that names no file in the vault is refused and nothing is written;
  `--publish` also refuses a note in a folder the site leaves out.

A vault the update has not moved may still hold the old file,
`_meta/publish-manifest.md`: one the update has not reached, or one it
held there (the site's publish tool is older than 1.27.0, or a build
step reads the old file). The commands read it and write their changes
back into it. Only the update, or `manifest convert --vault <vault>`,
moves a vault to the new file; it keeps the old file beside it as
`_meta/publish-manifest.md.converted`.

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

## The GM site

The player site is the only site this document's rules decide. For a copy
that shows everything (notes held back as prep, every hidden section and
field, each marked with why players do not see it), the GM turns on the
GM site (`gm_site.publish`); it is built in its own folder and never goes
online.

## Setup Questioning Flow

First-time theme, image, and 404 setup is handled by the setup
wizard (see `setup-wizard.md` steps 8-10). The filtering workflow
in this document assumes those are already configured.

When content filtering is triggered outside of first-time setup
(capability 6 in SKILL.md) and its first step finds no theme, image
or 404 message set, ask the questions described in the wizard steps
before proceeding with the publish list workflow.
