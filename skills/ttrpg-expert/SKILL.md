---
name: ttrpg-expert
description: "TTRPG rules advisor and content engine for CoC 7e, GURPS 4e, Forged in the Dark, D&D 5e (2024), and Pathfinder 2e (Remaster). Use for: rules lookups, mechanics validation, character building and point-budget tracking, NPC generation, content creation (scenes, locations, factions, items, handouts), scenario and encounter design guidance, continuity and plot-hole detection, canon management, PC arc and spotlight analysis, active play techniques (fail forward, improvisation), and random inspiration. No dependencies on other skills. For session workflows use session-prep/play/wrapup; for vault operations use campaign-organizer; for auditing use campaign-qa. Trigger on: rules questions, character creation, point-buy, stat blocks, NPC generation, encounter design, scenario writing, handout creation, continuity checks, plot holes, spotlight balance, arc stages, canon verification, content generation, 'build me a character', 'make me an NPC', 'check for plot holes', 'write a scene', 'create a handout'."
---

Expert TTRPG advisory agent and content engine for CoC 7e,
GURPS 4e, Forged in the Dark, D&D 5e (2024), and Pathfinder 2e
(Remaster).

**Shared references:** Files prefixed `shared/` in this document
live at `skills/shared/` (sibling directory to this skill folder).

## Quick Commands

Match user intent → go directly to the file. Skip clarification.

**"Build me a character"** / **"create a PC"**
→ `systems/{system}/character-generation.md` + `mechanics.md`.
  Full workflow from Step 0 (Campaign Context). Track budget.

**"How much does [trait] cost?"** / **"rules for [mechanic]?"**
→ GURPS/CoC: use routing tables below. Others: `systems/{system}/rules-reference.md`.

**CoC skill lookup** → `systems/coc-7e/skills.md`
**CoC creature** → `systems/coc-7e/creatures.md`
**CoC weapon/equipment** → `systems/coc-7e/equipment-weapons.md`
**CoC armour** → `systems/coc-7e/equipment-armor.md`
**CoC setting/location** → `systems/coc-7e/setting-lovecraft.md`
**CoC magic/spells** → `systems/coc-7e/powers-magic.md`
**CoC occupation** → `systems/coc-7e/occupations.md`
**CoC combat** → `systems/coc-7e/combat-reference.md`

**Regency CoC skill** → `systems/coc-7e/skills.md` + `systems/coc-7e/variants/regency/skills.md`
**Regency CoC occupation** → `systems/coc-7e/occupations.md` + `systems/coc-7e/variants/regency/occupations.md`
**Regency CoC equipment** → `systems/coc-7e/equipment-weapons.md` + `systems/coc-7e/variants/regency/equipment.md`
**Regency CoC character** → `systems/coc-7e/character-generation.md` + `systems/coc-7e/variants/regency/character-generation.md`
**Regency CoC session/social** → `systems/coc-7e/session-procedures.md` + `systems/coc-7e/variants/regency/gm-guidance.md`

**FitD faction** → `systems/fitd/factions.md`
**FitD playbook** → `systems/fitd/playbooks.md`
**FitD crew type** → `systems/fitd/crew-types.md`
**FitD gathering info** → `systems/fitd/gathering-information.md`
**FitD cohorts** → `systems/fitd/cohorts.md`
**FitD GM techniques** → `systems/fitd/gm-techniques.md`
**FitD ritual/crafting** → `systems/fitd/rituals-crafting.md`
**FitD entanglement/heat** → `systems/fitd/entanglements.md`
**FitD magnitude** → `systems/fitd/magnitude.md`

**D&D monster** → `systems/dnd-5e-2024/monsters.md` (index)
  → detail: `monsters-cr0-1.md`, `monsters-cr2-4.md`, `monsters-cr5-10.md`, `monsters-cr11-16.md`, `monsters-cr17-plus.md`
**D&D animal/beast** → `systems/dnd-5e-2024/animals.md`
**D&D spell** → `systems/dnd-5e-2024/spells.md` (index)
  → detail: `spells-cantrips.md`, `spells-1.md` through `spells-9.md`
**D&D magic item** → `systems/dnd-5e-2024/magic-items.md` (index)
  → detail by category: `magic-items-armor.md`, `magic-items-weapons.md`, etc.
**D&D equipment/weapon/armor** → `systems/dnd-5e-2024/equipment.md`
**D&D class** → `systems/dnd-5e-2024/classes.md`
**D&D feat** → `systems/dnd-5e-2024/feats.md`
**D&D condition/rule** → `systems/dnd-5e-2024/conditions-rules.md`

**PF2e monster** → `systems/pf2e/monsters.md` (index)
  → detail: `monsters-level-neg1-1.md`, `monsters-level-2-4.md`, `monsters-level-5-10.md`, `monsters-level-11-16.md`, `monsters-level-17-plus.md`
**PF2e spell** → `systems/pf2e/spells.md` (index)
  → detail: `spells-cantrips.md`, `spells-rank-1.md` through `spells-rank-10.md`
**PF2e feat** → `systems/pf2e/feats.md` (index)
  → detail by category: `feats-general-skill.md`, `feats-ancestry.md`, `feats-class.md`, `feats-archetype.md`
**PF2e class** → `systems/pf2e/classes.md`
**PF2e ancestry/heritage/background** → `systems/pf2e/ancestries.md`
**PF2e condition/rule** → `systems/pf2e/conditions-rules.md`
**PF2e equipment/weapon/armor** → `systems/pf2e/equipment.md`
**PF2e GM math (DCs/XP/treasure)** → `systems/pf2e/session-procedures.md`

**"Validate my character"**
→ `systems/{system}/character-generation.md` (Validation section).
  Full check: budget, combos, prerequisites, limits.

**"Make me an NPC"** / **"generate a character"**
→ `npc-generation.md`. Depth: 3-Line (quick), AIMS (recurring),
  Five-Component (critical). Include stat block.

**"Write a scene"** / **"design an encounter"**
→ `content-generation.md` (Scene Template). Read-aloud text,
  NPC motivations, complications, multiple outcomes.

**"Plan my session"**
→ session-prep skill. Complete prep workflow with arc check,
  touchpoint assignment, scene design, spotlight forecast.

**"Write a handout"** / **"create a letter/newspaper/diary"**
→ `handouts-and-props.md`. Full workflow: type → voice → embed
  info → write in-character → prop notes.

**"Check for plot holes"** / **"review continuity"**
→ `continuity-engine.md`. 11-category sweep.

**"Create a location/faction/item"**
→ `content-generation.md` (relevant template). Run continuity check.

**"Write a scenario"** / **"create an adventure"**
→ `content-generation.md` + `scenario-writing.md`. Node-based
  outline with NPC roster, timeline, clue paths.

**"Make something random"** / **"I need inspiration"**
→ `random-generation.md`.

**"Check my facts"** / **"verify canon"**
→ `continuity-engine.md` (Canon Grounding Check). Trace all
  facts to source files. Flag ungrounded content.

**"Stale threads?"** / **"loose ends?"**
→ `continuity-engine.md` (Chekhov Protocol). Threads open 3-5
  sessions: resolve, advance, or retire. Consult each active PC's
  `## Current Status` → `Open threads` (the always-current per-PC list).

**"Spotlight check"** / **"PC balance"**
→ `arc-spotlight-reference.md` (Spotlight Theory). Review
  last 2-3 sessions per-PC. Flag below 15% floor. Assign
  B/C plots to underserved PCs.

**"Character arc stage"** / **"what's next for this PC?"**
→ `arc-spotlight-reference.md` (Five-Stage Arc Model). Map PC
  to stage (Establishment → Testing → Crisis → Transformation
  → New Equilibrium). Suggest scenes for next stage. Read the PC's
  `## Current Status` — `Open threads` for next beats,
  `Knows (exclusive)` for personalized hooks.

**"Fail forward"** / **"failed roll, now what?"**
→ `active-play-management.md` (Fail Forward). Six patterns:
  Succeed at Cost, Partial Info, Delayed Consequence,
  Resource Drain, Complication, Worse Position.

**"Sandbox time"** / **"open interaction"**
→ `scene-encounter-patterns.md` (Open Interaction Windows).

**"Update the world"** / **"post-session update"**
→ `world-evolution.md`. Full checklist. Propose all changes;
  file only after GM approval.

**"What happened in session [N]?"** / **"campaign recap"**
→ `campaign-timeline.md` (vault root or campaign/).

**"worldbuilding"** / **"world-design"** / **"second-order"**
→ Read `worldbuilding-principles.md` for advisory guidance.
For interactive worldbuilding sessions, hand off to the midwife.

## Modes

**Analysis** — Validate, review, check, advise.
**Generation** — Create ready-to-use content.
**Continuity** — Maintain and repair campaign state.
Requests often combine modes.

## Companion Skills

- **campaign-organizer** — Vault structure and entity filing.
  Suggest after generating content or character creation.
- **session-prep** / **session-play** / **session-wrapup** —
  Session lifecycle. ttrpg-expert is the advisor (frameworks,
  reference); session-prep is the doer (prep workflow).
  session-prep references `arc-spotlight-reference.md` and
  system `session-procedures.md` during creative planning.
  Suggest session-prep for "plan/prep my session",
  session-wrapup after a session ends.
- **campaign-qa** — Validation. Suggest after session prep
  (especially Canon Grounding) or major content generation.

## Routing

1. **Quick Commands** — if the request matches above, go direct.
2. **System routing tables** below — if system + request type match.
3. **INDEX.md** — fallback for everything else.

Always read the relevant knowledge base file before generating.
Cite source books where possible. For unsupported systems,
use `systems/generic/`.

## System Routing

Load only the files relevant to the request.

### GURPS 4e (`systems/gurps-4e/`)

**Chargen** (read mechanics.md + character-generation.md first,
then the relevant kit):

| Concept | Kit |
|---------|-----|
| Combat/military | chargen-kit-combat.md |
| Wizard/mage | chargen-kit-magic.md |
| Super/psionic | chargen-kit-powers.md |
| Diplomat/face | chargen-kit-social.md |
| Scholar/doctor | chargen-kit-scholar.md |
| Thief/spy | chargen-kit-thief.md |
| Explorer/ranger | chargen-kit-outdoor.md |
| Mixed concept | Combine kits or read topic files |

**In-play:**

| Situation | File |
|-----------|------|
| Combat | combat.md |
| Spells | magic-rules.md |
| Powers | powers-rules.md |
| Social | social-rules.md |
| Session | session-procedures.md |

Book coverage: `sources.md`.

### CoC 7e (`systems/coc-7e/`)

| Request | File |
|---------|------|
| Skills / base chances | skills.md |
| Occupations | occupations.md |
| Weapons | equipment-weapons.md |
| Armour | equipment-armor.md |
| Combat / spot rules | combat-reference.md |
| Creatures | creatures.md |
| Magic / powers | powers-magic.md |
| Lovecraft setting | setting-lovecraft.md |

#### CoC 7e Variant: Regency

If the user mentions "Regency" OR the active campaign is
tagged as system "CoC 7e (Regency)":
→ Load the base file above AND the matching overlay.

| Request | Overlay |
|---------|---------|
| Skills | variants/regency/skills.md |
| Occupations | variants/regency/occupations.md |
| Equipment / weapons | variants/regency/equipment.md |
| Character creation | variants/regency/character-generation.md |
| Session / investigation | variants/regency/gm-guidance.md |

No variant keyword or tag → use base CoC files only.

### FitD (`systems/fitd/`)

| Request | File |
|---------|------|
| Doskvol setting/districts | `personal/` (requires personal files) |
| Factions | factions.md |
| Playbooks | playbooks.md |
| Crew types | crew-types.md |
| Cohorts / gangs | cohorts.md |
| Gathering information | gathering-information.md |
| GM techniques / consequences | gm-techniques.md |
| Rituals / crafting | rituals-crafting.md |
| Entanglements / heat | entanglements.md |
| Magnitude | magnitude.md |
| Combat / actions | rules-reference.md |
| Items / load | character-sheet.md |

### D&D 5e 2024 (`systems/dnd-5e-2024/`)

| Request | File |
|---------|------|
| Monsters (by CR) | monsters.md (index) → `monsters-cr{tier}.md` |
| Animals / beasts | animals.md |
| Spells (by level) | spells.md (index) → `spells-{level}.md` |
| Magic items | magic-items.md (index) → `magic-items-{category}.md` |
| Equipment | equipment.md |
| Classes | classes.md |
| Feats | feats.md |
| Conditions / rules | conditions-rules.md |
| Combat / actions | rules-reference.md |

### PF2e Remaster (`systems/pf2e/`)

| Request | File |
|---------|------|
| Monsters (by level) | monsters.md (index) → `monsters-level-{band}.md` |
| Spells (by rank) | spells.md (index) → `spells-cantrips.md`, `spells-rank-{1-10}.md` |
| Feats (by category) | feats.md (index) → `feats-general-skill.md`, `feats-ancestry.md`, `feats-class.md`, `feats-archetype.md` |
| Classes | classes.md |
| Ancestries / heritages / backgrounds | ancestries.md |
| Conditions / rules | conditions-rules.md |
| Equipment / weapons / armor | equipment.md |
| Combat / actions | rules-reference.md |
| GM math (DCs, XP budgets, treasure) | session-procedures.md |

### Personal Reference Files

`systems/{system}/personal/` may contain the user's own
setting reference (factions, NPCs, districts, world lore,
random tables). Gitignored — never distributed. Check here
when a question needs setting-specific content the public
SRD/ORC files don't cover. Subdirectories like
`personal/districts/` may exist.

## Canon and Validation

Generated content starts as DRAFT → GM confirms as
AUTHORITATIVE → superseded by newer info = SUPERSEDED.
See `canon-management.md` and `shared/canon-status.md`.
On conflicts, ask — never assume.

All content must be mechanically correct and narratively
consistent. See `shared/entity-schema.md` and
`continuity-engine.md`.
No stale threads (3+ sessions), no unfired Chekhov's guns
(5+ sessions).

Tone per system: see `systems/shared-patterns.md`.
