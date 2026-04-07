# Content Generation

Frameworks for generating scenes, locations, items, factions,
creatures, documents, and scenario outlines. Templates and
system-specific guidance for ready-to-use TTRPG content.

## Principles

- **Situation over script.** Describe who is present, what
  they want, environment, complications. Never prescribe PC
  actions or event order.
- **Modular.** Each piece functions independently and combines
  with others. A location works in session 2 or session 12.
- **Genre fidelity.** CoC: dread, slow reveals. D&D: heroic,
  bold challenges. GURPS: match declared genre. FitD: gritty
  heists, faction entanglements.
- **Three Clue Principle.** Every investigative conclusion
  needs ≥3 independently discoverable clues across different
  nodes/NPCs/locations.

## Scene Template

```markdown
## [Scene Title]
Type: [Combat / Social / Investigation / Exploration /
  Chase / Downtime / Puzzle]
Agenda: [One sentence — what does this scene resolve?]
Opening: [Read-aloud sensory bullets, max 3 sentences,
  objective detail only]

Who Is Present:
- [NPC/Creature]: [want, doing]

Environment:
- [3 interactive elements]
- [Lighting, sound, smell, temperature]

Complications: [2-3 mid-scene changes]

Outcomes:
- Success / Failure / Partial / Flight: [world changes]

Connections: [Where this leads, by outcome]
System Notes: [DCs, skill checks, SAN, position/effect]
```

### Scene Type Guidelines

**Combat:** objective beyond "defeat all"; 3 environment
elements; enemy goal + retreat condition; mid-combat
complication; plan for PC loss/flight/negotiation.

**Social:** NPC price (will accept) and line (won't cross);
multiple approaches; disposition shifts across conversation;
partial success outcomes.

**Investigation:** state needed conclusion; ≥3 clues across
≥2 sources; 1 proactive clue; fail-forward for skill-gated
clues; no scenes that look investigative but reveal nothing.

**Exploration:** 3 sensory details per area; describe unusual
not mundane; montage safe areas; slow for discovery; include
interactables.

**Chase:** 3-4 rounds; environment as adversary; meaningful
choices each round; distance tracks/clocks.

### Scene Framing

**Cut in late** — begin at decision, not travel. **Deliver the
bang** — first element demands response. **Exit trigger** —
clear signal when scene should end.

## Location Template

```markdown
## [Location Name]
Type: [Building / Outdoor / Underground / Vehicle]
Atmosphere: [2-3 words]

Sensory: Sight / Sound / Smell-Touch

Key Features:
- [Feature]: [description + interaction potential]

Inhabitants: [Who, what they're doing]
Secrets: [Hidden, how found]
Connections: [To other locations; clues pointing here/away]
Hazards: [If any]
System Notes: [DCs, checks, environmental rules]
```

Design: ≥1 interactable per location; inhabitants have
routines; multiple entry points; include vertical space.

## Item Template

```markdown
## [Item Name]
Type: [Weapon / Armor / Tool / Tome / Artifact / Mundane]
Description: [Physical appearance, distinctive features]
Origin: [Who made it, where from]
Properties: [Mechanical effects]
History: [Brief narrative significance]
Hooks: [Why PCs encounter it]
System Notes: [Full mechanics per system]
```

Design: items create story opportunities (glowing sword that
detects a bloodline > +1 sword); cursed/double-edged items
create tension; artifacts connect to campaign lore/factions.

**System-specific:** CoC: tomes with title, author, language,
Mythos gain, SAN cost, study time, spells, description. D&D:
rarity tiers, attunement, weapon mastery. GURPS: cost, weight,
enchantment energy/prereqs. FitD: Tier, type, effect, load.

## Faction Template

```markdown
## [Faction Name]
Type: [Cult / Guild / Government / Criminal / etc.]
Concept: [One sentence]

Goals: Immediate / Long-term
Resources: [Power and assets]
Leadership: [Leader + lieutenants, brief]
Membership: [Size, recruitment, loyalty]
Territory: [Where they operate]
Methods: [How they pursue goals]

Relationships:
- [Faction]: [Allied / Rival / Neutral / Hostile]

Clock: [What they're working toward, segments]
Secrets: [What outsiders don't know]
Hooks: [How PCs encounter them]
System Notes: [Tier, status, etc.]
```

Design: goals advance on timeline whether PCs intervene or not;
≥1 relationship with another faction; moral complexity (under-
standable goals, objectionable means); ≥1 internal tension
PCs can exploit.

## Creature Template

```markdown
## [Creature Name]
Type: [Beast / Undead / Fiend / Aberration / Mythos / etc.]
Concept: [One sentence — what it is, why dangerous]
Appearance: [Distinctive visual]

Behaviour:
- Motivation / Tactics / Retreat condition

Lair: [If relevant]
Hooks: [How PCs encounter; foreshadowing clues]
Stat Block: [System-specific]
GM Notes: [Running tips, atmosphere]
```

## Document Template

```markdown
## [Document Title]
Type: [Letter / Diary / Newspaper / Map / Record / Tome]
Author:  Date:  Physical Description:
Content: [In-character text per type format]
What It Reveals: [GM-only: clues contained]
Discovery Method: [How PCs find it]
System Notes: [Checks to read/translate, SAN costs]
```

For detailed handout guidance: `handouts-and-props.md`.
Limit to 3-5 handouts per session. Every handout must contain
≥1 clue or story-relevant info.

## Scenario Template

```markdown
## [Scenario Title]
System:  Premise: [2-3 sentences]
Hook(s): [≥3 hooks drawing PCs in]
The Truth: [GM-only: what's actually happening]

Key NPCs:
- [NPC]: [Role, goal, connection to truth]

Key Locations:
- [Location]: [What happens here, what can be found]

Node Map: [How locations/NPCs/events connect; clues per node]
Timeline: [What happens without PC intervention]
Climax: [Confrontation/revelation scenario builds toward]
Resolution: [Possible endings and consequences]
Sequel Hooks: [Future adventures enabled]
```

Design: state truth first (GM must know everything); ≥3 hooks;
node-based with multiple paths; timeline of unopposed events;
plan for failure states.

## Tone Calibration

| System | Register |
|--------|---------|
| CoC 7e | Understated, mundane-becoming-unsettling, escalating wrongness, academic/period language |
| D&D 5e | Bold, evocative, wonder, clear stakes, colourful NPCs |
| GURPS 4e | Precise, grounded, real consequences, technical accuracy |
| FitD | Noir, rain/shadows/gaslight, everyone has an angle, ambition vs survival |

## Sources

The Alexandrian (Node-Based Design, Don't Prep Plots); Sly
Flourish (Lazy DM); Sandy Petersen (Onion Layer); Robin Laws
(GUMSHOE, Robin's Laws); John Harper (BitD SRD); Matthew
Colville (Action-Oriented Monsters); Chaosium (CoC Keeper
Rulebook); SJG (GURPS Campaigns); WotC (2024 DMG).
