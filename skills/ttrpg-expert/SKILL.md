---
name: ttrpg-expert
description: "Use when answering TTRPG game system questions, validating mechanics, building characters, tracking point budgets, managing canon, planning sessions, designing encounters, writing scenarios, generating NPCs, creating locations/factions/items, writing handouts, detecting plot holes, or providing GM/player assistance for CoC 7e, GURPS 4e, Forged in the Dark, or D&D 5e (2024). Trigger on: TTRPG content creation, character creation, point-buy, stat blocks, encounter design, session prep, GURPS combat/advantages/skills/powers, or requests like 'build me a character', 'make me an NPC', 'how much does this cost in points', 'what are the combat rules', 'help me prep my session', 'check for plot holes'."
---

Expert TTRPG advisory agent and content engine for CoC 7e,
GURPS 4e, Forged in the Dark, and D&D 5e (2024).

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
**FitD Doskvol/setting** → `systems/fitd/setting-doskvol.md`
**FitD ritual/crafting** → `systems/fitd/rituals-crafting.md`
**FitD entanglement/heat** → `systems/fitd/entanglements.md`
**FitD magnitude** → `systems/fitd/magnitude.md`

**D&D monster** → `systems/dnd-5e-2024/monsters.md`
**D&D animal/beast** → `systems/dnd-5e-2024/animals.md`
**D&D spell** → `systems/dnd-5e-2024/spells.md`
**D&D magic item** → `systems/dnd-5e-2024/magic-items.md`
**D&D equipment/weapon/armor** → `systems/dnd-5e-2024/equipment.md`
**D&D class** → `systems/dnd-5e-2024/classes.md`
**D&D feat** → `systems/dnd-5e-2024/feats.md`
**D&D condition/rule** → `systems/dnd-5e-2024/conditions-rules.md`

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
  sessions: resolve, advance, or retire.

**"Spotlight check"** / **"PC balance"**
→ `arc-spotlight-reference.md` (Spotlight Theory). Review
  last 2-3 sessions per-PC. Flag below 15% floor. Assign
  B/C plots to underserved PCs.

**"Character arc stage"** / **"what's next for this PC?"**
→ `arc-spotlight-reference.md` (Five-Stage Arc Model). Map PC
  to stage (Establishment → Testing → Crisis → Transformation
  → New Equilibrium). Suggest scenes for next stage.

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
| Doskvol districts | setting-doskvol.md |
| Factions | factions.md |
| Playbooks | playbooks.md |
| Crew types | crew-types.md |
| Rituals / crafting | rituals-crafting.md |
| Entanglements / heat | entanglements.md |
| Magnitude | magnitude.md |
| Combat / actions | rules-reference.md |
| Items / load | character-sheet.md |

### D&D 5e 2024 (`systems/dnd-5e-2024/`)

| Request | File |
|---------|------|
| Monsters (by CR) | monsters.md |
| Animals / beasts | animals.md |
| Spells (by level) | spells.md |
| Magic items | magic-items.md |
| Equipment | equipment.md |
| Classes | classes.md |
| Feats | feats.md |
| Conditions / rules | conditions-rules.md |
| Combat / actions | rules-reference.md |

## Canon and Validation

Generated content starts as DRAFT → GM confirms as
AUTHORITATIVE → superseded by newer info = SUPERSEDED.
See `canon-management.md` and `shared/canon-confidence.md`.
On conflicts, ask — never assume.

All content must be mechanically correct and narratively
consistent. See `shared/entity-schema.md` and
`continuity-engine.md`.
No stale threads (3+ sessions), no unfired Chekhov's guns
(5+ sessions).

Tone per system: see `systems/shared-patterns.md`.
