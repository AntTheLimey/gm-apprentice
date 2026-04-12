# Continuity Engine

Procedures for maintaining narrative consistency, detecting
plot holes, tracking threads, memory-aware revision, and
managing living campaign state. Extends canon-management.md
with active analysis and repair.

**System-specific continuity:** for system mechanics when
checking plot holes or tracking state, also read:
- CoC 7e: `systems/coc-7e/session-procedures.md`
- FitD: `systems/fitd/factions.md` (tier/hold/clock state)

Continuity errors damage player trust. Prevention through
systematic tracking is cheaper than repair through retcon.

## Plot Hole Detection

### Categories

| Category | Description | Example |
|----------|-------------|---------|
| Timeline contradiction | Impossible event order | NPC dies session 3, appears session 5 |
| Location contradiction | Entity in two places | Artifact in vault AND NPC's pocket |
| Knowledge violation | Acts on unknown info | NPC reacts to a secret they shouldn't know |
| Motivation break | Acts against established goals | Loyal ally betrays without cause |
| Causal gap | Effect without cause | Building destroyed, no event caused it |
| Orphaned thread | Element never resolved | Mysterious letter mentioned, never explained |
| Dead-end clue | Clue points nowhere | Coded message with no decode path |
| Resurrection error | Dead entity reappears | Killed creature shows up without explanation |
| Player agency violation | Prescribes PC actions/emotions | "The party rushes to help" instead of conditional |
| Canon fabrication | Claim not traceable to source | NPC gains family residence never established |
| Premature access | Resources from unmet contacts | Safe house before PCs meet its owner |

### Detection Procedures

**Timeline Sweep:**
1. List events chronologically
2. Trace each entity's appearances across sessions
3. Flag entity appearing after destruction without explanation
4. Flag event referencing a cause that hasn't occurred yet
5. Flag impossible travel times

**Relationship Consistency:**
1. List each NPC's stated relationships
2. Cross-ref for mutual consistency (A enemy of B → B acknowledges?)
3. Flag one-way relationships that should be bidirectional
4. Flag relationships contradicting faction allegiance

**Clue Path Verification:**
1. For each needed conclusion, list all pointing clues
2. Verify ≥3 clues exist (Three Clue Rule)
3. Verify clues distributed across ≥2 nodes
4. Flag conclusions with <3 clues
5. Flag clues pointing to nonexistent nodes/entities

**Motivation Consistency:**
1. Review NPCs with AIMS profiles against recent actions
2. Flag actions contradicting instinct/agenda without justification
3. Flag NPCs whose goals achieved/impossible without profile update

**Canon Grounding Check:**

Prevents hallucination — the most damaging error category in
AI-assisted session planning.

1. Every NPC detail (background, location, relationships, skills,
   resources) must trace to a source file
2. Every location must exist in established geography with
   plausible PC awareness from prior play
3. Every resource/contact/option must be established through
   prior play (unmet NPCs can't offer services; undiscovered
   locations can't be refuges)
4. Flag unsourced claims for GM confirmation — never state as
   established canon
5. Common hallucination patterns: NPCs gaining unstated properties,
   contacts before meeting, locations before discovery, resources
   never established, details borrowed from similar-sounding NPCs

**Player Agency Violation Scan:**

1. Flag PC name / "the party" as subject of declarative action verb
   ("Varrio approaches" = violation; "If Varrio approaches" = ok)
2. Flag PC emotions/thoughts/internal state described
3. Flag assumed PC actions without conditional language (if/should/may/can)
4. Flag read-aloud with 2nd-person emotion/perception verbs
   ("You feel uneasy" = violation; describe objective sensory info only)
5. Verify every confrontation has ≥2 contingencies (cooperative + hostile)

## Thread Management

### Thread Types

| Type | Resolution |
|------|-----------|
| Main plot | Scenario climax |
| Subplot | Within 1-3 sessions |
| Character arc | Over campaign arc |
| Faction thread | Advances between sessions via clocks |
| Mystery thread | When PCs investigate |
| Chekhov's gun | Must fire or be explicitly retired |
| Foreshadowing | Pays off in later session |
| Red herring | When PCs realise the error |

### Thread Tracker

```markdown
## [Thread Name]
Type:  Introduced: [session + context]
State: [Active / Dormant / Resolved / Retired]
Summary:  Known By: [PCs and NPCs aware]
Connected Entities:  Last Advanced: [session + what happened]
Next Beat:  Resolution Condition:
Urgency: [Immediate / This arc / Long-term / Background]
```

### Chekhov Protocol

1. Track every element introduced with narrative emphasis
2. Each must fire (pay off) or be explicitly retired
3. Flag unresolved elements older than 5 sessions
4. When generating content, check for Chekhov payoff opportunities
5. Forgotten by GM but remembered by players = trust gap

### Dormant Thread Revival (3+ sessions dormant)

- Still relevant? → retire explicitly if campaign moved on
- Connects to current events? → weave back via callback
- Affects active NPCs/factions? → advance in background,
  let consequences surface naturally

## Callback System

| Type | Description | Example |
|------|-------------|---------|
| Consequence | Earlier decision produces results | Spared bandit returns as informant |
| NPC | Earlier NPC in new context | Session 1 innkeeper at cult meeting |
| Item | Earlier item gains significance | Mundane ring is actually a key |
| Location | Earlier place changed/revisited | Peaceful village now besieged |
| Information | Earlier clue becomes relevant | Strange symbol from session 2 reappears |
| Reputation | PC actions affect standing | Town guards recognise from wanted posters |

### Generating Callbacks

When creating content, scan campaign data for:
1. Unresolved player decisions from recent sessions
2. Dormant NPCs who could logically appear
3. Items/clues introduced but not paid off
4. Faction clock advances that could surface to PCs
5. Known locations connecting to current scenario

Density: 1-2 per session. Must feel organic. Player-decision
callbacks > GM-content callbacks.

## Memory-Aware Revision

Before modifying existing content, check:

1. **Session history** — has this entity appeared since last update?
2. **Relationship changes** — any shifts from in-play events?
3. **Timeline** — does revision conflict with established events?
4. **Player knowledge** — can't contradict player-observed facts
   without narrative explanation
5. **Dependent entities** — other entities/clues/threads affected?
6. **Mark source** — record what prompted revision and which session

### Revision vs Retcon

**Revision:** updates records to reflect in-game developments
(fictional history unchanged). Routine maintenance.

**Retcon:** changes established fictional history (something
true is now declared different). Use sparingly — affects
player trust.

Retcon guidelines: acknowledge to players, provide in-fiction
explanation, update all dependents, mark old content
SUPERSEDED, note in session records.

## World State Tracking

### Between-Session Updates

1. **Advance faction clocks** — did PCs interfere? Opposing factions act?
2. **Progress NPC timelines** — trigger conditions met?
3. **Apply consequences** — downstream effects of PC decisions
4. **Check expiring conditions** — time-limited effects, deadlines
5. **Surface new hooks** — new info/events/encounters now available

### State Snapshot

```markdown
## Campaign State: [Date]

Active Threats:
Faction Status: [faction]: [goal, clock progress, PC disposition]
Key NPC Status: [NPC]: [location, activity, disposition]
Active Threads: [thread]: [state, urgency]
Unresolved Chekhov Elements: [element]: [introduced session X]
Player Knowledge Summary:
Upcoming Triggers: [events based on timeline/conditions]
```

## Consistency During Generation

Automatic checks when generating content:

1. **Name collision** — similar name already exists?
2. **Timeline placement** — fits without contradictions?
3. **Relationship coherence** — aligns with existing data?
4. **Canon compliance** — respects AUTHORITATIVE entries?
5. **Thread integration** — connects to/advances existing threads?
6. **Tone consistency** — matches campaign genre?

Flag conflicts; adjust automatically or ask GM for resolution.

## Sources

Justin Alexander (The Alexandrian) — Campaign Status Document,
Node-Based Scenario Design; Sly Flourish — Secrets and Clues;
Vincent Baker — Fronts (Apocalypse World); John Harper —
Faction Clocks (BitD); Gnome Stew — campaign continuity;
Robin Laws — Robin's Laws.
