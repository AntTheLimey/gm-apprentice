# Default Vault Structure

Written to `_meta/vault-config.md` on first setup.

```text
{Campaign Name}/
├── _meta/           (schema + index)
├── _attachments/    (image files)
│   ├── characters/  (PC and NPC portraits)
│   ├── locations/   (location images)
│   ├── factions/    (logos, HQ images)
│   ├── items/       (item illustrations)
│   ├── creatures/   (creature art)
│   ├── events/      (scene art)
│   └── documents/   (scans, letter images)
├── _Campaign/
│   ├── Campaign Overview.md
│   ├── Player Characters.md
│   └── Timeline.md
├── _Templates/      (one per type)
├── Chapters/
│   └── Chapter N - {Title}/
│       ├── Chapter N Overview.md
│       ├── Sessions/
│       └── Scenes/
├── Characters/ (PCs/, NPCs/)
├── Locations/
├── Factions & Organizations/
├── Items & Artifacts/
├── Creatures/
├── Events/
├── Documents/
└── Clues/
```

**Campaign Overview** — Front page: campaign name, game system,
setting/era, chapter list with links, premise.

**Player Characters** — Quick-reference PC roster: player name,
character name, key traits, status, link to full PC note.

**Timeline** — Master timeline of campaign events.

**Templates** — One per type in schema. On setup, create all. On
schema evolution, create immediately. Each includes: full
frontmatter, section headings, Dataview backlink query,
`## Source References` and `## GM Notes`.

**Naming:** Entity notes use canonical name as filename. Sessions:
`Session {NN} - {Title}.md`. Chapters: `Chapter {N} - {Title}/`.
Aliases in frontmatter.

## Image Attachments

The `_attachments/` folder stores image files referenced by entity
frontmatter or body embeds. Organize by entity type.

**Naming convention:** Use slug format (lowercase, hyphens) matching
entity files — e.g., `characters/ronnie-vint.jpg` for the entity
`Ronnie Vint.md`. Multiple images per entity get suffixed:
`ronnie-vint-young.jpg`, `ronnie-vint-scarred.jpg`.

**Accepted formats:** jpg, jpeg, png, webp, gif. Avoid HEIC or RAW
(not web-safe).

**Frontmatter reference:** Entity types that support portraits use
the `portrait` field with a vault-root-relative path:
```yaml
portrait: "_attachments/characters/ronnie-vint.jpg"
```

**Body embeds:** Use Obsidian's wiki-embed syntax for inline images:
```markdown
![[ronnie-vint-selection.jpg]]
```
Obsidian resolves these by searching configured attachment paths.
