---
name: ttrpg-expert
description: "TTRPG rules advisor and content engine for CoC 7e, GURPS 4e, Forged in the Dark, D&D 5e (2024) and Pathfinder 2e (Remaster): rules lookups, character building and point-budget validation, NPCs and stat blocks, scenes, encounters, scenarios, locations, factions, items, handouts, random inspiration, continuity and plot-hole checks, canon verification, PC arc and spotlight analysis, fail forward and improvisation. For session workflows use session-prep/play/wrapup; vault filing, campaign-organizer; audits, campaign-qa. Trigger on rules questions, point-buy, 'build me a character', 'make me an NPC', 'check for plot holes', 'write a scene', 'create a handout'."
---

TTRPG advisor and content engine. Files prefixed `shared/` live
at `skills/shared/`; `systems/` paths are relative to this skill.

## Quick Commands

Match intent → go straight to the file. Skip clarification.

**Rules or cost question** ("how much does [trait] cost?", "rules
for [mechanic]?", any skill/creature/spell/item/feat/class lookup)
→ `python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/rules_lookup.py"
<system> "<term>"` first, with `--kind` from the System Routing
row when it has one, `--variant regency` for Regency CoC, and
`all` as `<system>` when the system is unknown. Answer from the
row and cite its `file:line`. Open the routed file only when the
row's notes aren't enough or the question is about a rule rather
than a record.

**"Build me a character"** / **"create a PC"**
→ `systems/{system}/character-generation.md` + `mechanics.md`
(GURPS: + the chargen kit below). Full workflow from Step 0
(Campaign Context). Track budget.

**"Validate my character"**
→ `character-generation.md` (Validation section). Check budget,
combos, prerequisites, limits.

**"Make me an NPC"** / **"generate a character"**
→ `npc-generation.md` + system `mechanics.md`. Depth: 3-Line
(quick), AIMS (recurring), Five-Component (critical). Include
stat block.

**"Write a scene"** / **"design an encounter"**
→ `content-generation.md` (Scene Template) +
`scene-encounter-patterns.md`. Read-aloud text, NPC motivations,
complications, multiple outcomes.

**"Create a location/faction/item/creature"**
→ `content-generation.md` (relevant template); factions also
`relationship-patterns.md`. Run a continuity check.

**"Write a scenario"** / **"create an adventure"**
→ `content-generation.md` + `scenario-writing.md`. Node-based
outline with NPC roster, timeline, clue paths. Player-agency
review: `scenario-writing.md` + `continuity-engine.md`.

**"Write a handout"** / **"letter/newspaper/diary"**
→ `handouts-and-props.md`. Type → voice → embed info → write
in-character → prop notes.

**"Make something random"** / **"inspiration"** → `random-generation.md`.

**"Check for plot holes"** / **"review continuity"**
→ `continuity-engine.md`. 11-category sweep.

**"Check my facts"** / **"verify canon"**
→ `continuity-engine.md` (Canon Grounding Check). Trace every
fact to a source file; flag ungrounded content. Canon conflict →
`canon-management.md`.

**"Stale threads?"** / **"loose ends?"**
→ `continuity-engine.md` (Chekhov Protocol). Threads open 3-5
sessions: resolve, advance, or retire. Read each active PC's
`## Current Status` → `Open threads`.

**"Spotlight check"** / **"PC balance"**
→ `arc-spotlight-reference.md` (Spotlight Theory). Last 2-3
sessions per PC; flag below the 15% floor; assign B/C plots to
underserved PCs.

**"Character arc stage"** / **"what's next for this PC?"**
→ `arc-spotlight-reference.md` (Five-Stage Arc Model). Map the PC
to Establishment → Testing → Crisis → Transformation → New
Equilibrium; suggest scenes for the next stage from the PC's
`## Current Status` — `Open threads` for beats, `Knows
(exclusive)` for hooks.

**"Fail forward"** / **"failed roll, now what?"** / mid-session help
→ `active-play-management.md`. Fail-forward patterns: Succeed at
Cost, Partial Info, Delayed Consequence, Resource Drain,
Complication, Worse Position.

**"Sandbox time"** / **"open interaction"**
→ `scene-encounter-patterns.md` (Open Interaction Windows).

**"Update the world"** / **"post-session update"**
→ `world-evolution.md` + system `session-procedures.md`. Propose
all changes; file only after GM approval.

**"What happened in session [N]?"** / **"recap"**
→ `campaign-timeline.md` (vault root or campaign/).

**Worldbuilding / second-order effects** → `worldbuilding-principles.md`;
interactive worldbuilding sessions go to the-midwife.

**Relationships** → `relationship-patterns.md`.
**Prep frameworks** (Lazy DM, Three Clue Rule, Fronts, Five Room
Dungeon) and discovery state → `gm-session-patterns.md`.
**Campaign/session structure** → campaign-organizer skill +
`shared/session-document-chain.md`.
**Plan my session** → session-prep skill. After a session →
session-wrapup. After generating content → suggest
campaign-organizer to file it, campaign-qa after major content.

Use "GM" internally; keep the user's own terms (Keeper, DM,
Investigator) in output.

## System Routing

Read the relevant file before generating; load only what the
request needs. Every system folder has `mechanics.md` (core rules;
then `rules-reference.md`, which GURPS lacks),
`character-generation.md`, `session-procedures.md` and
`character-sheet.md`. `kind` = the `rules_lookup.py --kind` for
that row. Unsupported system → `systems/generic/`. Cite source
books where possible.

### GURPS 4e (`systems/gurps-4e/`)

Chargen: `mechanics.md` + `character-generation.md`, then the kit
— combat/military `chargen-kit-combat.md`, wizard `-magic`,
super/psionic `-powers`, diplomat/face `-social`, scholar/doctor
`-scholar`, thief/spy `-thief`, explorer/ranger `-outdoor`; mixed
concept: combine kits or read topic files.

| Request | File | kind |
|---------|------|------|
| Advantages / disadvantages | `traits-*.md` | trait |
| Skills | `skills-*.md` | skill |
| Equipment / weapons / armour | `equipment-*.md` | item |
| Spells | `spells.md`; rules `magic-rules.md` | spell |
| Combat | `combat.md` | |
| Powers | `powers-rules.md` | |
| Social | `social-rules.md` | |
| Book coverage | `sources.md` | |

### CoC 7e (`systems/coc-7e/`)

| Request | File | kind |
|---------|------|------|
| Skills / base chances | `skills.md` | skill |
| Occupations | `occupations.md` | class |
| Weapons / equipment | `equipment-weapons.md` | item |
| Armour | `equipment-armor.md` | |
| Creatures | `creatures.md` | monster |
| Magic / powers | `powers-magic.md` | |
| Combat / spot rules | `combat-reference.md` | |
| Lovecraft setting / locations | `setting-lovecraft.md` | |

**Regency variant** — the user says "Regency" or the campaign's
system is "CoC 7e (Regency)": read the base file AND its overlay
in `variants/regency/`: `skills.md`, `occupations.md`,
`equipment.md`, `character-generation.md`, and `gm-guidance.md`
(with base `session-procedures.md`) for session/social/
investigation. No keyword or tag → base files only.

### FitD (`systems/fitd/`)

| Request | File |
|---------|------|
| Doskvol setting / districts | `personal/` (requires personal files) |
| Factions | `factions.md` |
| Playbooks (kind: class) | `playbooks.md` |
| Crew types | `crew-types.md` |
| Cohorts / gangs | `cohorts.md` + `crew-types.md` |
| Gathering information | `gathering-information.md` |
| GM techniques / consequences | `gm-techniques.md` |
| Rituals / crafting | `rituals-crafting.md` |
| Entanglements / heat | `entanglements.md` |
| Magnitude | `magnitude.md` |
| Combat / actions | `rules-reference.md` |
| Items / load | `character-sheet.md` |

### D&D 5e 2024 (`systems/dnd-5e-2024/`)

| Request | File | kind |
|---------|------|------|
| Monsters (by CR) | `monsters.md` index → `monsters-cr{0-1,2-4,5-10,11-16,17-plus}.md` | monster |
| Animals / beasts | `animals.md` | monster |
| Spells (by level) | `spells.md` index → `spells-cantrips.md`, `spells-{1-9}.md` | spell |
| Magic items | `magic-items.md` index → `magic-items-{category}.md` | item |
| Equipment / weapons / armour | `equipment.md` | item |
| Classes | `classes.md` | class |
| Feats | `feats.md` | feat |
| Conditions / rules | `conditions-rules.md` | condition |
| Combat / actions | `rules-reference.md` | |

### PF2e Remaster (`systems/pf2e/`)

| Request | File | kind |
|---------|------|------|
| Monsters (by level) | `monsters.md` index → `monsters-level-{neg1-1,2-4,5-7,8-10,11-16,17-plus}.md` | monster |
| Spells (by rank) | `spells.md` index → `spells-cantrips.md`, `spells-rank-{1-10}.md` | spell |
| Feats | `feats.md` index → `feats-{general-skill,ancestry,class,archetype}.md` | feat |
| Classes | `classes.md` | class |
| Ancestries / heritages / backgrounds | `ancestries.md` | class |
| Conditions / rules | `conditions-rules.md` | condition |
| Equipment / weapons / armour / runes | `equipment.md` | item |
| Combat / actions | `rules-reference.md` | |
| GM math (DCs, XP budgets, treasure) | `session-procedures.md` | |

### Personal reference files

`systems/{system}/personal/` (and subfolders like
`personal/districts/`) may hold the user's own setting material —
factions, NPCs, districts, lore, random tables. Gitignored, never
distributed. Check it when a question needs setting content the
SRD/ORC files don't cover.

## Canon and Validation

Generated content starts as DRAFT; the GM confirms it as
AUTHORITATIVE (states, including STUB and SUPERSEDED:
`canon-management.md`, `shared/canon-status.md`). On conflicts,
ask — never assume. Content must be mechanically correct and
consistent with `shared/entity-schema.md` and
`continuity-engine.md`: no stale threads (3+ sessions), no
unfired Chekhov's guns (5+ sessions). Tone per system:
`systems/shared-patterns.md`.
