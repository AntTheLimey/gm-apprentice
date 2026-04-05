# Knowledge Base Index

This file maps request types to the correct knowledge base
file. Read this file first, then read only the file(s)
relevant to the current request.

## System Selection

Determine the user's game system first. If it matches one of
the four supported systems, use that subfolder under
`systems/`. Otherwise, use `systems/generic/`.

| System | Subfolder |
|--------|-----------|
| D&D 5th Edition (2024) | `systems/dnd-5e-2024/` |
| Forged in the Dark | `systems/fitd/` |
| Call of Cthulhu 7th Edition | `systems/coc-7e/` |
| GURPS 4th Edition | `systems/gurps-4e/` |
| Anything else | `systems/generic/` |

For unsupported systems, use `systems/generic/` which
provides universal RPG guidance.

## Routing Table — Per-System Requests

In the table below, `{system}` is one of: `dnd-5e-2024`,
`fitd`, `coc-7e`, `gurps-4e`, `generic`.

| Request Type | Read This File | Also Read |
|---|---|---|
| **Rules question** (any system) | `systems/{system}/mechanics.md` | For GURPS: use file routing in SKILL.md. Others: `systems/{system}/rules-reference.md` |
| **Character creation** (any system) | `systems/{system}/character-generation.md` | `systems/{system}/mechanics.md` for stats |
| **Character validation** | `systems/{system}/character-generation.md` | For GURPS: topic trait/skill files. Others: `systems/{system}/rules-reference.md` |
| **Session procedures** | `systems/{system}/session-procedures.md` | — |
| **Character sheet reference** | `systems/{system}/character-sheet.md` | — |
| **Combat or tactical question** | For GURPS: `systems/gurps-4e/combat.md`. Others: `systems/{system}/rules-reference.md` | `systems/{system}/mechanics.md` for overview |
| **Advantages, traits, or costs** | For GURPS: `systems/gurps-4e/traits-*.md` (pick by nature). Others: `systems/{system}/rules-reference.md` | `systems/{system}/character-generation.md` if building |
| **Equipment or weapons** | For GURPS: `systems/gurps-4e/equipment-*.md` (pick by type). Others: `systems/{system}/rules-reference.md` | — |
| **Powers, magic, or special abilities** | For GURPS: `powers-rules.md` or `magic-rules.md`. Others: `systems/{system}/rules-reference.md` | — |
| **Spells** | For GURPS: `systems/gurps-4e/spells.md`. Others: `systems/{system}/rules-reference.md` | — |
| **Skills** | For GURPS: `systems/gurps-4e/skills-*.md` (pick by category). Others: `systems/{system}/rules-reference.md` | — |

## Routing Table — System-Agnostic Requests

| Request Type | Read This File | Also Read |
|---|---|---|
| **NPC generation** (any depth) | `npc-generation.md` | `systems/{system}/mechanics.md` for stats |
| **Scene or encounter** generation | `content-generation.md` | `scene-encounter-patterns.md` for frameworks |
| **Location** generation | `content-generation.md` | — |
| **Faction** generation | `content-generation.md` | `relationship-patterns.md` for webs |
| **Item or artifact** generation | `content-generation.md` | `systems/{system}/mechanics.md` for stats |
| **Creature or monster** generation | `content-generation.md` | `systems/{system}/mechanics.md` for stats |
| **Scenario or adventure** outline | `content-generation.md` | `scenario-writing.md` for structure |
| **Handout, letter, newspaper, diary** | `handouts-and-props.md` | — |
| **Official document** (autopsy, police report, warrant, will) | `handouts-and-props.md` | — |
| **Mythos tome or occult text** | `handouts-and-props.md` | — |
| **Item card** | `handouts-and-props.md` | `systems/{system}/mechanics.md` for stats |
| **Telegram, wanted poster** | `handouts-and-props.md` | — |
| **Cipher or coded message** | `handouts-and-props.md` | — |
| **Random or procedural** content | `random-generation.md` | — |
| **Session prep** | `session-planner.md` | `gm-session-patterns.md` for frameworks, `scenario-writing.md` for player agency |
| **PC arc planning or spotlight** | `session-planner.md` | — |
| **Player agency review** | `session-planner.md` (Step 7) | `scenario-writing.md` for anti-patterns, `continuity-engine.md` for scan |
| **Canon grounding / hallucination check** | `continuity-engine.md` | — |
| **Continuity check or plot holes** | `continuity-engine.md` | — |
| **Revision or retcon** | `continuity-engine.md` | — |
| **Callback generation** | `continuity-engine.md` | — |
| **Campaign state snapshot** | `continuity-engine.md` | — |
| **Canon conflict** | `canon-management.md` | — |
| **Active play / mid-session help** | `active-play-management.md` | For GURPS: `systems/gurps-4e/combat.md`. Others: `systems/{system}/rules-reference.md` |
| **Terminology question** | `rpg-terminology.md` | — |
| **Relationship modeling** | `relationship-patterns.md` | — |
| **Campaign structure** | `campaign-structure.md` | — |
| **Cross-system tone or patterns** | `systems/shared-patterns.md` | — |

## File Summaries

### Per-System Files (under `systems/{system}/`)

Each supported game system has its own subfolder containing
core reference files:

- `mechanics.md` — Core mechanics, attributes, skills, roll
  mechanics, and key formulas for that system.
- `character-generation.md` — Full character creation
  workflow: concept development, attributes, abilities,
  equipment, budget tracking, and validation checks.
- `rules-reference.md` — Deep mechanical reference (CoC,
  FitD, D&D, generic). GURPS uses topic-based files instead
  — see SKILL.md "Game System Data" for routing.
- `session-procedures.md` — System-specific session
  procedures, phase structures, and GM workflows.
- `character-sheet.md` — Character sheet layout reference,
  field descriptions, and recording conventions.

**GURPS 4e expanded file structure:** In addition to the
standard files, GURPS has topic-based reference files:
`sources.md` (book catalog), `traits-*.md` (4 files),
`skills-*.md` (7 files), `equipment-*.md` (3 files),
`spells.md`, `combat.md`, `magic-rules.md`,
`powers-rules.md`, `social-rules.md`. See SKILL.md for
which files to load for each request type.

Supported systems: `dnd-5e-2024`, `fitd`, `coc-7e`,
`gurps-4e`. The `generic` subfolder provides universal RPG
guidance as a fallback for unsupported systems.

- `systems/shared-patterns.md` — Cross-system tone guidance
  and generation patterns shared across all systems.

### System-Agnostic Files (root level)

#### Core Reference (Analysis and Rules)

- `entity-types.md` — Entity type definitions and
  system-specific attribute schemas.
- `canon-management.md` — Source confidence levels (DRAFT,
  AUTHORITATIVE, SUPERSEDED), conflict detection, resolution.
- `relationship-patterns.md` — Relationship types, tones,
  strength values, and modeling.
- `campaign-structure.md` — Session management, timelines,
  discovery tracking.
- `rpg-terminology.md` — Cross-system terminology reference.

#### Operational Patterns (How to Run Games)

- `gm-session-patterns.md` — Session prep frameworks: Lazy
  DM, Three Clue Rule, Five Room Dungeon, Fronts, progress
  clocks.
- `scene-encounter-patterns.md` — Scene types, framing,
  encounter design, node-based scenarios, pacing.
- `active-play-management.md` — Real-time notes, improv,
  spotlight management, pacing, mid-session adjustments.
- `scenario-writing.md` — Scenario structure, player agency,
  NPC design, system-specific conventions.

#### Content Generation (How to Create Content)

- `npc-generation.md` — 3-Line NPC, AIMS framework,
  Five-Component NPC, voice/mannerism design, stat blocks.
- `content-generation.md` — Templates for scenes, locations,
  items, factions, creatures, scenario outlines, tone
  calibration.
- `continuity-engine.md` — Plot hole detection, thread
  tracking, Chekhov protocol, callbacks, memory-aware
  revision, world state.
- `random-generation.md` — Oracle systems, random tables
  (NPCs, encounters, locations, hooks, rumours), procedural
  generation.
- `handouts-and-props.md` — In-game document templates
  (letters, newspapers, diaries, official docs, Mythos
  tomes, item cards, telegrams, ciphers), period voice
  guides, physical prop techniques.

#### Session Planning (How to Prep for Players)

- `session-planner.md` — PC Roster Review, Five-Stage Arc
  Model, A/B/C plot rotation, Touchpoint Planning Matrix,
  Web of Connections, spotlight tracking, system-specific
  arc drivers.
