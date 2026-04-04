# Default Vault Structure

Written to `_meta/vault-config.md` on first setup.

```
{Campaign Name}/
├── _meta/           (schema + index)
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
