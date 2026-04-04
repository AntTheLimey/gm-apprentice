# Knowledge Base Index

This file maps request types to the correct knowledge base
file. Read this file first, then read only the file(s)
relevant to the current request.

## Routing Table

| Request Type | Read This File | Also Read |
|-------------|---------------|-----------|
| **NPC generation** (any depth) | `npc-generation.md` | `game-systems.md` for stats |
| **Scene or encounter** generation | `content-generation.md` | `scene-encounter-patterns.md` for frameworks |
| **Location** generation | `content-generation.md` | — |
| **Faction** generation | `content-generation.md` | `relationship-patterns.md` for webs |
| **Item or artifact** generation | `content-generation.md` | `game-systems.md` for stats |
| **Creature or monster** generation | `content-generation.md` | `game-systems.md` for stats |
| **Scenario or adventure** outline | `content-generation.md` | `scenario-writing.md` for structure |
| **Handout, letter, newspaper, diary** | `handouts-and-props.md` | — |
| **Official document** (autopsy, police report, warrant, will) | `handouts-and-props.md` | — |
| **Mythos tome or occult text** | `handouts-and-props.md` | — |
| **Item card** | `handouts-and-props.md` | `game-systems.md` for stats |
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
| **Character creation** (GURPS) | `gurps-character-generation.md` | `game-systems.md` for attribute costs, `gurps-rules-reference.md` for trait details |
| **Character creation** (other systems) | `game-systems.md` | `entity-types.md` for schemas |
| **Point budget / validation** (GURPS) | `gurps-character-generation.md` | `gurps-rules-reference.md` for costs |
| **GURPS combat question** | `gurps-rules-reference.md` | `game-systems.md` for overview |
| **GURPS advantages/disadvantages** | `gurps-rules-reference.md` | `gurps-character-generation.md` if building a character |
| **GURPS powers, magic, or psionics** | `gurps-rules-reference.md` | — |
| **GURPS martial arts or techniques** | `gurps-rules-reference.md` | — |
| **GURPS equipment or weapons** | `gurps-rules-reference.md` | — |
| **Rules question or validation** | `game-systems.md` | `entity-types.md` for schemas; `gurps-rules-reference.md` if GURPS-specific |
| **Canon conflict** | `canon-management.md` | — |
| **Active play / mid-session help** | `active-play-management.md` | `gurps-rules-reference.md` if GURPS combat |
| **System-specific procedures** | `system-session-procedures.md` | `game-systems.md` |
| **Terminology question** | `rpg-terminology.md` | — |
| **Relationship modeling** | `relationship-patterns.md` | — |
| **Campaign structure** | `campaign-structure.md` | — |

## File Summaries

### Core Reference (Analysis and Rules)

- `game-systems.md` — Mechanics, attributes, skills, and
  roll mechanics for all four systems. GURPS section includes
  damage table, skill cost table, active defense formulas,
  and character generation summary.
- `gurps-character-generation.md` — Full GURPS 4e character
  creation workflow: campaign context gathering, concept
  development, attributes, advantages/disadvantages, skills,
  equipment, point budget tracking, and validation checks.
  Use for any "help me build a GURPS character" request.
- `gurps-rules-reference.md` — Deep GURPS 4e mechanics:
  combat (maneuvers, hit locations, damage types, active
  defenses), expanded advantage/disadvantage lists with costs,
  enhancement/limitation system, equipment, Powers framework,
  magic, martial arts techniques, and psionics.
- `entity-types.md` — Entity type definitions and
  system-specific attribute schemas.
- `canon-management.md` — Source confidence levels (DRAFT,
  AUTHORITATIVE, SUPERSEDED), conflict detection, resolution.
- `relationship-patterns.md` — Relationship types, tones,
  strength values, and modeling.
- `campaign-structure.md` — Session management, timelines,
  discovery tracking.
- `rpg-terminology.md` — Cross-system terminology reference.

### Operational Patterns (How to Run Games)

- `gm-session-patterns.md` — Session prep frameworks: Lazy
  DM, Three Clue Rule, Five Room Dungeon, Fronts, progress
  clocks.
- `scene-encounter-patterns.md` — Scene types, framing,
  encounter design, node-based scenarios, pacing.
- `active-play-management.md` — Real-time notes, improv,
  spotlight management, pacing, mid-session adjustments.
- `system-session-procedures.md` — System-specific session
  procedures for CoC 7e, D&D 5e, GURPS 4e, Blades.
- `scenario-writing.md` — Scenario structure, player agency,
  NPC design, system-specific conventions.

### Content Generation (How to Create Content)

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

### Session Planning (How to Prep for Players)

- `session-planner.md` — PC Roster Review, Five-Stage Arc
  Model, A/B/C plot rotation, Touchpoint Planning Matrix,
  Web of Connections, spotlight tracking, system-specific
  arc drivers.
