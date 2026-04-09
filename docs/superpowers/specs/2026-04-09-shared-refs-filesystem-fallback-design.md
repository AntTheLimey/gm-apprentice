# Design: Shared References + Filesystem Fallback

## Problem

Three of four gm-apprentice skills (campaign-organizer,
campaign-qa, session-lifecycle) require Obsidian to function
fully. This creates a barrier to entry: users who don't use
Obsidian (or who use a different vault for a different
campaign) can't use two of the four skills at all.

Additionally, the four skills duplicate shared concepts
(canon confidence, vault structure, entity schema, wiki-link
conventions) across their SKILL.md files and reference
directories. When the schema changes, it must be updated in
multiple places, risking drift.

## Goals

1. Campaign-qa and session-lifecycle work at ~80% capability
   on plain markdown folders, matching the pattern campaign-
   organizer already uses.
2. All three vault-aware skills share one source of truth for
   infrastructure concepts (filesystem mode, canon confidence,
   vault structure, entity schema).
3. Users can override auto-detection to force filesystem mode
   even when Obsidian MCP is available (protects against
   clobbering a vault pointed at a different campaign).
4. No quality regression on any skill (benchmarked).

## Non-Goals

- Making campaign-qa or session-lifecycle work with zero
  campaign files (they still need a folder of markdown).
- Adding Obsidian MCP tools to ttrpg-expert (it's standalone).
- Migrating existing vaults or converting between formats.

## Architecture

### New Directory: `skills/shared/`

Four shared reference files extracted from existing content:

```
skills/
  shared/
    filesystem-mode.md    — tool mapping, detection, override
    canon-confidence.md   — DRAFT/AUTHORITATIVE/SUPERSEDED
    vault-structure.md    — folder layout, naming, _meta/
    entity-schema.md      — merged entity types + relationships
  campaign-organizer/
    SKILL.md              — references shared/ files
    references/           — skill-specific refs only
  campaign-qa/
    SKILL.md              — references shared/ files
    references/           — skill-specific refs only
  session-lifecycle/
    SKILL.md              — references shared/ files
    references/           — skill-specific refs only
  ttrpg-expert/
    SKILL.md              — references shared/entity-schema.md
    ...                   — system files unchanged
```

### Shared File Contents

**filesystem-mode.md** — Extracted from campaign-organizer's
existing `references/filesystem-mode.md`, expanded with:

- Environment detection procedure (check for MCP tools at
  invocation, announce mode)
- Override mechanism ("use filesystem mode" forces filesystem
  even if MCP is available)
- Tool mapping table:

| Operation | Obsidian MCP | Filesystem Fallback |
|-----------|-------------|-------------------|
| List files | `search_vault` / `list_vault_files` | Glob |
| Search content | `search_vault_simple` / `search_vault_smart` | Grep |
| Read file | `get_vault_file` | Read |
| Write file | (hand to campaign-organizer) | Write / Edit |
| Check existence | `list_vault_files` | Glob |

- Announcement templates:
  - "Connected to Obsidian vault at [path]. Using MCP tools."
  - "Working in filesystem mode on [path]. Files will be
    Obsidian-compatible — open the folder as a vault anytime."
  - "Obsidian MCP is available but you've requested filesystem
    mode. Working directly on [path]."

**canon-confidence.md** — Consolidated from duplicated
paragraphs across all four SKILL.md files:

- DRAFT: initial entry, not confirmed by GM
- AUTHORITATIVE: confirmed as canon
- SUPERSEDED: replaced by newer information
- Rules: new content starts DRAFT, GM confirms to promote,
  retcons mark old content SUPERSEDED
- The `source_confidence` frontmatter field

**vault-structure.md** — Moved from campaign-organizer's
`references/vault-structure.md`, made system-agnostic:

- Folder layout (`_meta/`, `_Campaign/`, `_QA/`, `Chapters/`)
- Naming conventions (entity files, session files, scene files)
- `_meta/index.md` as master registry
- `_Campaign/Timeline.md` as append-only timeline
- `_Campaign/Player Characters.md` as PC roster

**entity-schema.md** — Merged from:
- campaign-organizer's `references/ontology-reference.md`
  (relationship types, graph metadata)
- ttrpg-expert's `entity-types.md` (temporal fields, Thread
  type, Clue type, discovery state)

Contains:
- Universal fields (lastUpdated, asOfSession, createdSession,
  source, confidence)
- All entity types: NPC, Location, Item, Faction, Clue,
  Thread, Creature, Organization, Event, Document
- Relationship types table (knows, located_in, member_of, etc.)
- Frontmatter conventions (YAML, wiki-links in quotes)

### Files Removed After Extraction

| Original File | Replaced By |
|---|---|
| campaign-organizer/references/filesystem-mode.md | shared/filesystem-mode.md |
| campaign-organizer/references/vault-structure.md | shared/vault-structure.md |
| campaign-organizer/references/ontology-reference.md | shared/entity-schema.md |
| ttrpg-expert/entity-types.md | shared/entity-schema.md |

Campaign-organizer keeps: `graph-hygiene.md`, `index-template.md`
(these are skill-specific, not shared).

### SKILL.md Changes

Each SKILL.md that currently duplicates shared concepts gets
updated to reference the shared files instead:

**campaign-organizer:** Replace inline canon rules, vault
structure descriptions, and filesystem mode instructions with
cross-references to `skills/shared/`. Remove
`references/filesystem-mode.md`, `references/vault-structure.md`,
`references/ontology-reference.md`.

**campaign-qa:** Add filesystem mode detection at invocation.
Replace inline canon rules and entity schema references with
cross-references. Add tool fallback instructions per
`shared/filesystem-mode.md`.

**session-lifecycle:** Add filesystem mode detection at
invocation. Replace inline vault structure assumptions with
cross-references. Add tool fallback instructions.

**ttrpg-expert:** Replace `entity-types.md` routing with
`shared/entity-schema.md`. No other changes (this skill is
already standalone).

### Filesystem Fallback: campaign-qa

Campaign-qa currently says "Fall back to file Read tools if
the MCP is unavailable" (line 55) but doesn't flesh this out.

**Changes:**

1. Add environment detection at skill invocation (per
   shared/filesystem-mode.md).

2. Update `references/check-procedures.md` with dual-mode
   instructions for each audit step:

| Audit | Obsidian Mode | Filesystem Mode |
|-------|-------------|----------------|
| Canon audit: enumerate entities | `list_vault_files` in scope folder | Glob `**/*.md` in campaign folder, filter by frontmatter `type:` field |
| Canon audit: cross-reference | `search_vault_simple` for entity names | Grep for entity names across all files |
| Timeline: find dated events | `search_vault` with date patterns | Grep for date regex patterns |
| Name similarity: collect names | `list_vault_files` + read frontmatter | Glob + Read frontmatter from each file |
| Clue redundancy: find clues | `search_vault_smart` for clue references | Grep for clue entity names and `leadsTo` fields |
| Graph health: enumerate links | `search_vault_simple` for `[[...]]` | Grep for wiki-link patterns |

3. QA report output writes to `_QA/` folder regardless of
   mode (filesystem mode creates the folder if needed).

**Capability in filesystem mode:** ~90%. The only degradation
is clue redundancy analysis, which benefits from semantic
search for identifying what "points to" a conclusion. In
filesystem mode, this falls back to explicit name/link
matching, which catches most clues but may miss oblique
references. All other audits are pure structural/textual
checks that work identically.

### Filesystem Fallback: session-lifecycle

Session-lifecycle currently has no explicit fallback. All
operations are pure file I/O delegated through campaign-
organizer.

**Changes:**

1. Add environment detection at skill invocation.

2. Update SKILL.md workflow phases with dual-mode instructions:

| Phase | Operation | Obsidian Mode | Filesystem Mode |
|-------|-----------|-------------|----------------|
| Prep | Find latest session | `search_vault` by status | Glob `Chapters/*/Sessions/*.md`, read frontmatter, sort by session number |
| Prep | List NPCs | `list_vault_files` in NPC folders | Glob `**/NPCs/*.md` |
| Prep | Read entity | `get_vault_file` | Read |
| Prep | Check entity exists | `search_vault` | Glob for filename |
| Play | Quick lookup | `search_vault` + `get_vault_file` | Grep for name + Read |
| Wrap-up | Create entity | Hand to campaign-organizer | Write (YAML frontmatter + markdown) |
| Wrap-up | Update entity | Hand to campaign-organizer | Read + Edit |
| Wrap-up | Append timeline | Hand to campaign-organizer | Read + append + Write |
| Reconcile | Load all entities | `list_vault_files` + `get_vault_file` | Glob + Read |

3. In filesystem mode, session-lifecycle handles file
   creation/updates directly instead of handing off to
   campaign-organizer. Files are created with full YAML
   frontmatter and wiki-links (Obsidian-compatible).

**Capability in filesystem mode:** ~85%. Lost: semantic search
for NPC lookups during play (falls back to name-based grep,
which is slower and misses aliases unless frontmatter is
checked). Lost: automatic Obsidian graph updates (metadata
is written but not visualised until opened in Obsidian).
Everything else works identically.

## Benchmark Plan

Every change gets benchmarked to prove quality is preserved.

### Benchmark Structure

Each skill gets 5 questions targeting shared concepts plus
skill-specific functionality. 3 runs per benchmark, median
reporting. Same blind evaluation methodology as the compaction
passes (sonnet agents, opus evaluator, 5-dimension rubric).

**Control:** pre-refactor SKILL.md files (from main branch).
**Test:** post-refactor SKILL.md files (from feature branch).

### campaign-organizer Benchmark

Tests that shared ref extraction doesn't degrade the skill
that currently owns the content.

Q1: Set up a new CoC campaign vault structure.
Q2: Create an NPC entity with proper frontmatter and filing.
Q3: What's the folder layout for a chapter with 3 sessions?
Q4: An entity has DRAFT confidence — when should it become
    AUTHORITATIVE?
Q5: I'm working without Obsidian. How do I organise my
    campaign files?

### campaign-qa Benchmark

Tests filesystem fallback quality.

Q1: Run a canon audit on this campaign data (provide sample
    entities with a contradiction).
Q2: Check the timeline for inconsistencies (provide events
    in wrong order).
Q3: Find name similarity issues (provide similar NPC names).
Q4: Verify Three Clue Rule for a mystery (provide scenario
    with insufficient clues).
Q5: Check graph health (provide entities with broken links).

### session-lifecycle Benchmark

Tests filesystem fallback quality.

Q1: Prep for session 4 (provide previous session notes).
Q2: Process these play notes into a recap (provide raw notes).
Q3: What entities need updating after this session?
Q4: Reconcile planned vs actual (provide prep notes and what
    actually happened).
Q5: What carries forward to next session?

### ttrpg-expert Benchmark

Tests entity schema consolidation.

Q1: How should I structure entity tracking for a GURPS
    campaign?
Q2: What fields does an NPC entity need?
Q3: Create a faction entity with clocks and alliances.
Q4: What's the discovery state model for clues?
Q5: How do threads work (Chekhov, foreshadowing, faction)?

### Pass Criteria

- Quality: median delta ≥ -2 (within evaluator variance)
- File size: total shared/ smaller than sum of replaced files
- Tokens: no increase beyond +5% per skill
- All cross-references resolve (no broken file pointers)

## Implementation Order

1. Create `skills/shared/` with four files (extracted and
   merged from existing content)
2. Update campaign-organizer to reference shared files,
   remove replaced files, add override logic
3. Benchmark campaign-organizer (3 runs)
4. Update ttrpg-expert to reference shared entity-schema
5. Benchmark ttrpg-expert (3 runs)
6. Update campaign-qa with filesystem fallback + shared refs
7. Benchmark campaign-qa (3 runs)
8. Update session-lifecycle with filesystem fallback + shared refs
9. Benchmark session-lifecycle (3 runs)
10. Update README dependency tier table
11. Final cross-reference verification

Each step is a commit. Steps 3, 5, 7, 9 are quality gates.
If a benchmark fails, fix before proceeding.

## Risk

**Main risk:** Shared references add a layer of indirection.
An agent reading campaign-qa's SKILL.md now needs to also
read `skills/shared/entity-schema.md` to understand the
entity model. This costs an extra file read (more tokens)
but should improve consistency.

**Mitigation:** Each SKILL.md retains enough inline context
to be useful without reading the shared files (summaries with
"see shared/entity-schema.md for full schema"). The shared
files are supplementary depth, not required for basic
operation.

**Second risk:** Filesystem mode is slower than Obsidian MCP
for large vaults (Grep across 200 files vs indexed search).

**Mitigation:** For most campaigns (< 100 entity files),
the performance difference is negligible. For very large
campaigns, recommend Obsidian.
