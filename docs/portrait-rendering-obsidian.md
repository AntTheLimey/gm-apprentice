# Portrait Rendering in Obsidian Vaults

## Problem

The entity schema defines a `portrait` field on all visual entity types
(NPC, PC, Location, Faction, Item, Creature). Vault-ingest and
campaign-organizer correctly file images into
`_attachments/{type}/{slug}.ext` and set the portrait frontmatter value,
but Obsidian doesn't render frontmatter properties as images. The
portrait field shows up as plain text metadata in the Properties panel —
the user never sees the actual image when viewing the note unless they
manually embed it in the body with `![[filename]]`.

## Desired Behaviour

When a user opens any entity file that has a portrait value, the image
should be visible in the note without the user doing anything extra.
This should work in both Reading and Live Preview modes. It should
degrade gracefully (no broken image placeholder) when portrait is empty
or the file doesn't exist.

## Scope

This belongs in campaign-organizer as part of vault setup and
maintenance. Specifically:

1. **Vault initialisation** — When campaign-organizer creates the
   `_meta/` layer and folder structure for a new vault, it should also
   ensure the portrait-rendering mechanism is in place.
2. **Entity templates** — The templates in `skills/shared/templates/`
   should include whatever is needed so new entities get portrait
   rendering by default.
3. **Retroactive repair** — Campaign-organizer's Validate mode should
   detect entity files that have a portrait value but are missing the
   rendering mechanism, and offer to fix them.

## Technical Context

- gm-apprentice already lists Dataview as an expected plugin (used by
  multiple skills). It's safe to depend on it.
- The entity schema is in `skills/shared/entity-schema.md`. Entity
  types with portrait: NPC, PC, Location, Faction, Item, Creature.
- The default vault structure is in `skills/shared/vault-structure.md`.
  Images live in `_attachments/{type}/`.
- Portrait values are bare vault-relative paths, e.g.
  `"_attachments/characters/colonel-moreau.png"` — no `![[]]` wrapping.
- The publish tool (`tools/publish/`) has its own CSS pipeline for the
  static site. That's a separate concern — this is about the Obsidian
  editing experience.

## Implementation Options to Evaluate

**Option A: Dataview inline in templates.** Add a Dataview inline query
to the body of each entity template that reads `this.portrait` and
renders it as an embed. Something like
`` `= this.portrait ? "![[" + this.portrait + "]]" : "" ` ``.
Pros: simple, uses an existing dependency, works in both view modes.
Cons: visible as a code span in Source mode; needs to be present in
every entity file body (not just frontmatter).

**Option B: CSS snippet.** Add an `.obsidian/snippets/` CSS file during
vault init that renders the portrait property as an image. Obsidian 1.4+
renders properties with `data-property-key` attributes in the DOM.
Pros: invisible to the user, no template body changes.
Cons: depends on Obsidian's internal DOM structure which can break
across versions; CSS can't easily turn a text value into a rendered
`<img>`.

**Option C: Templater automation.** Use a Templater script to insert
`![[portrait-path]]` into the body when a note is created from
template.
Pros: clean result.
Cons: only works at creation time, doesn't help existing files, adds a
Templater dependency.

Evaluate these (and any other approach missed) and pick the one that
best balances reliability, graceful degradation, and minimal maintenance
burden. If going with Dataview inline, the rendering line should be near
the top of the body (after the `# Title` heading) and should produce a
reasonably sized image (consider whether Obsidian's `![[image|width]]`
syntax is worth using for a default max width).

## Files Likely to Change

- `skills/shared/templates/*.md` — All templates with a portrait field
- `skills/shared/entity-schema.md` — If the portrait field
  documentation needs updating
- `skills/shared/vault-structure.md` — If a snippets directory or new
  file needs documenting
- `skills/campaign-organizer/SKILL.md` — Vault init and Validate mode
  procedures
- `skills/campaign-organizer/references/` — If a new reference file is
  needed for the CSS/rendering approach
- Possibly a new file for the CSS snippet itself if Option B is chosen

## Constraints

- Must work in Obsidian 1.4+ (current property/metadata system)
- Must degrade gracefully when portrait is empty or missing
- Must not break the publish pipeline (the static site has its own
  rendering)
- Must not require any community plugins beyond what gm-apprentice
  already expects (Dataview, Templater)
