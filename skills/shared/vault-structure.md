# Default Vault Structure

Written to `_meta/vault-config.md` on first setup.

```text
{Campaign Name}/
├── _meta/           (schema + index)
├── _attachments/    (image files)
│   ├── characters/  (PC and NPC portraits)
│   ├── locations/   (location images)
│   ├── factions/    (faction and organization logos, HQ images)
│   ├── items/       (item illustrations)
│   ├── creatures/   (creature art)
│   ├── events/      (scene art)
│   └── documents/   (scans, letter images)
├── _midwife/        (the-midwife's workspace)
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
│       ├── Planning/
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

**Campaign Overview** — front page: campaign name, game system,
setting/era, chapter list with links, premise.
**Player Characters** — PC roster: player name, character name,
key traits, status, link to the full PC note.
**Timeline** — master timeline of campaign events.

**Templates** — one per schema type: create all on setup, and one
immediately on schema evolution. Each has full frontmatter,
section headings, a Dataview backlink query, `## Source
References` and `## GM Notes`.

**Naming:** entity notes use the canonical name as filename,
aliases in frontmatter. Chapters: `Chapter {N} - {Title}/`.
Session files: see Session Document Chain below.

## Image Attachments

Images live in `_attachments/<type folder>/` (tree above), named
by slug matching the entity file — `characters/ronnie-vint.jpg`
for `Ronnie Vint.md`; extra images get suffixes
(`ronnie-vint-young.jpg`). Formats: jpg, jpeg, png, webp, gif —
not HEIC or RAW.

Portrait-bearing entities reference it with a vault-root-relative
path:

```yaml
portrait: "_attachments/characters/ronnie-vint.jpg"
```

Inline images use Obsidian embeds (`![[ronnie-vint-selection.jpg]]`),
which Obsidian resolves via its attachment paths.

## Session Document Chain

Each session has an index hub and up to three documents
(standard: `shared/session-document-chain.md`):

```text
Sessions/
  Session {NN} - {Title}.md              (index hub)
  Session {NN} - {Title} - Plan.md       (prep output)
  Session {NN} - {Title} - Play Notes.md (play record)
  Chapter_CC_Session_NN_Wrap_Up.md       (canonical wrap-up)
```

## Inbox

`_inbox/` stages source material for vault-ingest; ingested files
move to `_inbox/_processed/` with a date stamp. campaign-qa and
campaign-organizer never process its contents.

## Adventures

`Adventures/{Adventure Name}/{Adventure Name}.md` holds a
midwife adventure brief. Entities the brief references live in
their normal type folders, not under `Adventures/`.

## Midwife Workspace

`_midwife/` is the-midwife's workspace (structure: the-midwife
SKILL.md § Content Management). It is per adventure, not per
chapter; adventures stay there until promoted, or for good.

- campaign-qa ignores it — never lint it for schema.
- session-prep and session-play read it: it often holds a
  chapter's only forward design. Resolve the directory through
  `_midwife/index.md` (or `plans_index.py`), never from a
  chapter-title slug; if the match is ambiguous, ask. `Ingested`
  means it was already promoted to `Planning/`.
- Its files have no frontmatter — find them by path, not by
  `type:`. Read and link them; never copy them.

## World Layer

`_World/` holds world rules; created on demand by any skill that
writes world content, with `world-index.md` and `_flags.md` stubbed
at vault setup. Heritage entities live in `Heritages/`.

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

Create a domain file only when it has content.
