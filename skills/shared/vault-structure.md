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
├── _midwife/        (adventure workspace — see below)
├── _World/          (world rules and domain files)
│   ├── world-index.md
│   └── _flags.md
├── _Campaign/
│   ├── Campaign Overview.md
│   ├── Player Characters.md
│   └── Timeline.md
├── _Templates/      (one per type)
├── _inbox/          (staging area for vault-ingest)
│   └── _processed/  (completed imports, date-stamped)
├── Adventures/
│   └── {Adventure Name}/
│       └── {Adventure Name}.md
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
├── Heritages/
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

## Session Document Chain

Sessions use the document chain standard. Each session has an
index hub and up to three document files. See
`shared/session-document-chain.md` for the full standard.

```text
Sessions/
  Session {NN} - {Title}.md              (index hub)
  Session {NN} - {Title} - Plan.md       (prep output)
  Session {NN} - {Title} - Play Notes.md (play record)
  Session {NN} - {Title} - Wrap-Up.md    (canonical wrap-up)
```

## Inbox

The `_inbox/` folder is a staging area for source material
being ingested by the `vault-ingest` skill. After successful
ingestion, files move to `_inbox/_processed/` with a date stamp.

`campaign-qa` ignores `_inbox/` during audits.
`campaign-organizer` creates it during vault setup but does
not process its contents.

## Adventures

The `Adventures/` folder stores adventure briefs — structured
design documents produced by the midwife skill. Each adventure
gets its own subfolder:

```text
Adventures/
└── {Adventure Name}/
    └── {Adventure Name}.md    (adventure brief)
```

The adventure brief is the folder's primary file. Entity files
referenced by the brief live in their normal type folders
(Characters/, Locations/, etc.), not under Adventures/.

## Midwife Workspace

The `_midwife/` folder is the midwife skill's creative
workspace. It stores working notes, seed ideas, entity
sketches, and other artifacts produced during adventure
brainstorming. Created automatically on first midwife
invocation.

```text
_midwife/
├── index.md             (master manifest — all adventures)
├── seeds/               (shared idea bank across adventures)
│   ├── premises/        (adventure concepts, genre combos)
│   ├── npcs/            (NPC ideas that didn't fit)
│   ├── locations/       (place concepts)
│   ├── hooks/           (plot hooks, inciting events)
│   ├── tone/            (tone/genre/atmosphere ideas)
│   └── mechanics/       (system-specific ideas)
└── {adventure-name}/    (per-adventure working directory)
    ├── index.md         (adventure TOC, status, open Qs)
    ├── discoveries.md
    ├── chapter-shape.md
    ├── adventures/      (confirmed sub-adventures)
    ├── npcs/            (confirmed NPC profiles)
    ├── entity-sketches/ (draft entities for promotion)
    ├── image-prompts/   (visual concept descriptions)
    └── session-0/       (CATS pitch, safety, handouts)
```

Additional topic files (weather, cover stories, social events,
romance threads) are created on demand. See the-midwife
SKILL.md for the full list.

Each adventure is an independent working directory. The
midwife can work on multiple adventures in parallel.
Adventures stay here until explicitly ingested into the vault
via `Adventures/`. They may never be ingested — parked
adventures remain as creative archives.

The `seeds/` folder is shared across all adventures. When an
idea is generated but not used, it goes to the appropriate
seed category. When starting a new adventure, the midwife
scans seeds for relevant prior ideas.

`campaign-qa` ignores `_midwife/` during audits.

## World Layer

The `_World/` folder stores world rules and domain definitions.
Created on demand by any skill that needs to write world content.
Domain files define machine-checkable rules; heritage entities in
`Heritages/` are first-class vault entities.

```text
_World/
├── world-index.md            (active domains, world summary)
├── _flags.md                 (three-state flag tracker)
├── heritages.md              (species/ancestry rules)
├── geography-climate.md      (landforms, biomes, resources)
├── history-timeline.md       (ages, eras, events)
├── politics-governance.md    (power structures, borders)
├── economics-trade.md        (resources, currency, trade)
├── magic-technology.md       (systems, limits, access)
├── cosmology-religion.md     (planes, gods, faiths)
├── culture-daily-life.md     (customs, food, dress)
├── ecology.md                (flora, fauna, food chains)
└── language-communication.md (naming, scripts, barriers)
```

Individual domain files are created when content exists — not
all 10 are required. `world-index.md` and `_flags.md` are
created as stubs during vault scaffolding.

`campaign-qa` audits `_World/` domain rules against entities.
`campaign-organizer` creates `_World/` during vault setup.
