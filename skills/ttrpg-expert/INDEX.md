# Knowledge Base Index

Fallback routing when SKILL.md Quick Commands don't match.
Read only the file(s) relevant to the current request.

## System Selection

| System | Subfolder |
|--------|-----------|
| D&D 5e (2024) | `systems/dnd-5e-2024/` |
| Forged in the Dark | `systems/fitd/` |
| CoC 7e | `systems/coc-7e/` |
| GURPS 4e | `systems/gurps-4e/` |
| Other | `systems/generic/` |

## Per-System Requests

`{system}` = `dnd-5e-2024`, `fitd`, `coc-7e`, `gurps-4e`, or `generic`.

| Request | File | Also Read |
|---------|------|-----------|
| Rules question | `{system}/mechanics.md` | GURPS: routing in SKILL.md. Others: `{system}/rules-reference.md` |
| Character creation | `{system}/character-generation.md` | GURPS: `chargen-kit-{archetype}.md`. Others: `{system}/mechanics.md` |
| Character validation | `{system}/character-generation.md` | `{system}/rules-reference.md` |
| Session procedures | `{system}/session-procedures.md` | — |
| Character sheet | `{system}/character-sheet.md` | — |
| Combat | GURPS: `combat.md`. CoC: `combat-reference.md`. Others: `{system}/rules-reference.md` | `{system}/mechanics.md` |
| Traits / costs | GURPS: `traits-*.md`. Others: `{system}/rules-reference.md` | — |
| Equipment / weapons | GURPS: `equipment-*.md`. CoC: `equipment-weapons.md`. FitD: `character-sheet.md`. D&D: `equipment.md` | — |
| Armour | CoC: `equipment-armor.md`. D&D: `equipment.md`. GURPS: `equipment-*.md` | — |
| Powers / magic | GURPS: `powers-rules.md` or `magic-rules.md`. CoC: `powers-magic.md`. FitD: `rituals-crafting.md`. D&D: `magic-items.md` | — |
| Spells | GURPS: `spells.md`. CoC: `powers-magic.md`. D&D: `spells.md` | — |
| Skills | GURPS: `skills-*.md`. CoC: `skills.md`. Others: `{system}/rules-reference.md` | — |
| Feats | D&D: `feats.md` | — |
| Conditions | D&D: `conditions-rules.md` | — |
| Creatures / monsters | CoC: `creatures.md`. D&D: `monsters.md` / `animals.md` | — |
| Setting / lore | CoC: `setting-lovecraft.md`. FitD: `setting-doskvol.md` | — |
| Factions | FitD: `factions.md`. Others: `content-generation.md` | `relationship-patterns.md` |
| Classes / occupations | CoC: `occupations.md`. FitD: `playbooks.md`. D&D: `classes.md` | — |
| Crew / party type | FitD: `crew-types.md` | — |
| Entanglements / heat | FitD: `entanglements.md` | — |
| Magnitude | FitD: `magnitude.md` | — |

## System-Agnostic Requests

| Request | File | Also Read |
|---------|------|-----------|
| NPC generation | `npc-generation.md` | `{system}/mechanics.md`; CoC: `occupations.md`, FitD: `playbooks.md`, D&D: `classes.md` |
| Scene / encounter | `content-generation.md` | `scene-encounter-patterns.md`; `{system}/session-procedures.md` |
| Location | `content-generation.md` | CoC: `setting-lovecraft.md`. FitD: `setting-doskvol.md` |
| Faction generation | `content-generation.md` | `relationship-patterns.md` |
| Item / artifact | `content-generation.md` | `{system}/mechanics.md` |
| Creature generation | `content-generation.md` | CoC: `creatures.md`. D&D: `monsters.md` |
| Scenario / adventure | `content-generation.md` | `scenario-writing.md` |
| Handout / letter / document | `handouts-and-props.md` | — |
| Random / procedural | `random-generation.md` | — |
| Post-session update | `world-evolution.md` | `{system}/session-procedures.md` |
| Campaign timeline / recap | `campaign-timeline.md` | — |
| Session prep | `session-planner.md` | `gm-session-patterns.md` |
| PC arc / spotlight | `session-planner.md` | — |
| Player agency review | `session-planner.md` Step 7 | `scenario-writing.md` |
| Canon / continuity | `continuity-engine.md` | — |
| Canon conflict | `canon-management.md` | — |
| Active play / mid-session | `active-play-management.md` | `{system}/rules-reference.md` |
| Terminology | `rpg-terminology.md` | — |
| Relationships | `relationship-patterns.md` | — |
| Campaign structure | `campaign-structure.md` | — |
| Cross-system tone | `systems/shared-patterns.md` | — |

## File Reference

**Per-system core** (all systems): `mechanics.md`, `character-generation.md`, `rules-reference.md`, `session-procedures.md`, `character-sheet.md`

**Per-system topic files:** See SKILL.md routing tables for complete listings per system.

**System-agnostic:**
- `npc-generation.md` — 3-Line, AIMS, Five-Component NPC frameworks
- `content-generation.md` — Scene, location, faction, item, creature templates
- `continuity-engine.md` — Plot holes, threads, Chekhov protocol, callbacks
- `session-planner.md` — 7-step workflow, Arc Model, Spotlight Forecast
- `world-evolution.md` — Post-session: faction turns, consequences, foreshadowing
- `active-play-management.md` — Improv, fail forward, spotlight, notes
- `scene-encounter-patterns.md` — Scene types, Open Interaction Windows
- `scenario-writing.md` — Scenario structure, player agency
- `handouts-and-props.md` — In-game documents, voice guides, prop techniques
- `random-generation.md` — Oracles, random tables, procedural generation
- `gm-session-patterns.md` — Lazy DM, Three Clue Rule, Five Room Dungeon
- `entity-types.md` — Entity schemas, universal temporal fields
- `canon-management.md` — DRAFT → AUTHORITATIVE → SUPERSEDED
- `relationship-patterns.md` — Relationship types, strength, modeling
- `campaign-structure.md` — Session management, timelines, discovery
- `rpg-terminology.md` — Cross-system terminology
- `campaign-timeline.md` — Append-only session record (vault root or campaign/)
- `systems/shared-patterns.md` — Cross-system tone guidance
