# Continuity Engine

Frameworks and procedures for maintaining narrative consistency,
detecting plot holes, tracking threads, performing memory-aware
revision, and managing the living state of a campaign. This
document extends canon-management.md with active analysis and
repair capabilities.

## Continuity Philosophy

A campaign is a living document. Every session adds facts,
advances timelines, shifts relationships, and creates promises
to the players. The continuity engine ensures that generated
and revised content honours what has already been established,
surfaces contradictions before they reach the table, and helps
the GM manage the growing complexity of a long-running game.

Continuity errors damage player trust. When the friendly
innkeeper appears in a town they should not be in, or a dead
NPC is referenced as alive, players disengage from the fiction.
Prevention through systematic tracking is cheaper than repair
through retcon.

## Plot Hole Detection

### Categories of Plot Holes

| Category | Description | Example |
|----------|-------------|---------|
| Timeline contradiction | Events occur in impossible order | NPC dies in session 3 but appears in session 5 |
| Location contradiction | Entity in two places at once | Artifact is in the vault and also in the NPC's pocket |
| Knowledge violation | Character acts on unknown info | NPC reacts to a secret they should not know |
| Motivation break | Character acts against established goals | Loyal ally suddenly betrays without cause |
| Causal gap | Effect without established cause | Building is destroyed but no event caused it |
| Orphaned thread | Introduced element never resolved | Mysterious letter mentioned but never explained |
| Dead-end clue | Clue points to nothing discoverable | Players find a coded message with no decode path |
| Resurrection error | Dead entity reappears without explanation | Killed creature shows up again with no narrative reason |
| Player agency violation | Content prescribes PC actions or emotions | "The party rushes to help" instead of "If the party intervenes..." |
| Canon fabrication | Factual claim not traceable to source material | NPC gains a family residence never established in their profile |
| Premature access | PCs offered resources from contacts not yet met | Safe house available before PCs encounter its owner |

### Detection Procedures

**Timeline Sweep:**
1. List all events in chronological order.
2. For each entity, trace their appearances across sessions.
3. Flag any entity that appears after being destroyed or killed
   without explicit resurrection or explanation.
4. Flag any event that references a cause which has not yet
   occurred in the timeline.
5. Flag impossible travel times between known locations.

**Relationship Consistency Check:**
1. For each NPC, list their stated relationships.
2. Cross-reference relationships for mutual consistency (if A
   is B's enemy, does B acknowledge A as enemy or at least
   adversary?).
3. Flag one-way relationships that should be bidirectional.
4. Flag relationships that contradict faction membership or
   allegiance.

**Clue Path Verification:**
1. For each conclusion PCs need to reach, list all clues
   pointing to that conclusion.
2. Verify at least 3 clues exist (Three Clue Rule).
3. Verify clues are distributed across at least 2 nodes.
4. Flag any conclusion supported by fewer than 3 clues.
5. Flag any clue that points to a node or entity that does
   not exist.

**Motivation Consistency Check:**
1. For each NPC with an AIMS profile, review their recent
   actions against their stated goals.
2. Flag any action that contradicts their instinct or agenda
   without narrative justification.
3. Flag NPCs whose goals have been achieved or rendered
   impossible without updating their profile.

**Canon Grounding Check:**

This check prevents hallucination — the single most damaging
category of error in AI-assisted session planning. When an AI
invents facts about NPCs, locations, or resources that don't
exist in the campaign's source material, the resulting content
is worse than useless: it misleads the Keeper and creates
contradictions that may not surface until play.

1. For every NPC referenced in generated content, verify that
   their stated background, location, relationships, skills,
   and resources are traceable to a source file (character
   sheet, session notes, campaign overview, or NPC profile).
2. For every location referenced as available or accessible,
   verify that it exists in the campaign's established geography
   and that the PCs have a plausible reason to know about it
   based on prior play.
3. For every resource, contact, or option offered to the PCs,
   verify that the PCs have established access to it through
   prior play. An NPC the PCs have not yet met cannot offer
   services. A location the PCs have not yet discovered cannot
   be a refuge. A contact's safe house cannot appear as a
   lodging option before the PCs have met that contact.
4. Flag any factual claim about an NPC, location, or resource
   that cannot be sourced to an existing file. Mark unverified
   claims with a visible annotation for the GM to confirm
   rather than stating them as established canon.
5. Common hallucination patterns:
   - NPCs gaining properties not in their profiles (family
     homes, skills, relationships, titles)
   - Contacts available before the PCs have met them
   - Locations accessible before the PCs have discovered them
   - Resources appearing that were never established in play
   - Background details borrowed from similar-sounding NPCs

**Player Agency Violation Scan:**

Player agency is the foundational contract of tabletop RPGs.
The GM describes the world; the players decide what their
characters do. Session plans that prescribe PC actions,
emotions, or decisions violate this contract and produce
content the Keeper must mentally rewrite at the table. This
check catches those violations before they reach the table.

1. Search all scene text for sentences where a PC name or "the
   party" is the subject of a declarative action verb. "Varrio
   approaches Anna" is a violation. "If Varrio approaches Anna"
   is not. The distinction is conditional vs. declarative
   framing.
2. Flag any text that describes a PC's emotions, thoughts, or
   internal state. "Freddy is terrified" is a violation. "The
   information is horrifying" is not — it describes the
   situation, not the character's response.
3. Flag any text that assumes a PC takes a specific action
   without using conditional language ("if", "should the PCs
   choose to", "may", "can"). Session plans describe what is
   available, not what happens.
4. Flag any read-aloud text that uses second person with an
   emotion or perception verb ("You feel uneasy", "You sense
   danger", "You notice something wrong"). Read-aloud text
   describes objective sensory information only: what
   characters can see, hear, smell, and touch.
5. Verify that every confrontation scene includes contingencies
   for at least two player approaches: cooperative (social,
   diplomatic, passive) and hostile (physical intervention,
   combat, coercion). Never assume players won't start a fight
   just because it would be socially destructive.

## Thread Management

### Thread Types

| Thread Type | Description | Resolution |
|-------------|-------------|------------|
| Main plot | The central scenario arc | Resolved at scenario climax |
| Subplot | Secondary narrative line | Resolved within 1-3 sessions |
| Character arc | Individual PC development | Resolved over campaign arc |
| Faction thread | Ongoing faction activity | Advances between sessions via clocks |
| Mystery thread | Unanswered question | Resolved when PCs investigate |
| Chekhov's gun | Introduced element awaiting payoff | Must fire or be explicitly retired |
| Foreshadowing | Hint of future events | Pays off in a later session |
| Red herring | Player-generated false lead | Resolved when PCs realise the error |

### Thread Tracking

For each active thread, maintain:

```
## [Thread Name]

**Type:** [Main plot / Subplot / Character arc / Faction /
  Mystery / Chekhov / Foreshadowing]

**Introduced:** [Session number and context]

**Current State:** [Active / Dormant / Resolved / Retired]

**Summary:** [What the thread is about]

**Known By:** [Which PCs and NPCs are aware of this thread]

**Connected Entities:** [NPCs, locations, items involved]

**Last Advanced:** [Session number and what happened]

**Next Beat:** [What should happen next with this thread]

**Resolution Condition:** [What resolves this thread]

**Urgency:** [Immediate / This arc / Long-term / Background]
```

### The Chekhov Protocol

When an element is introduced with narrative emphasis (a
mysterious item, a cryptic warning, an unexplained event), it
becomes a Chekhov's gun that players expect to have significance.

**Rules for Chekhov elements:**

1. Track every Chekhov element from the moment of introduction.
2. Each Chekhov element must either fire (pay off narratively)
   or be explicitly retired (explained away).
3. Unresolved Chekhov elements older than 5 sessions should be
   flagged for attention.
4. When generating new content, check for Chekhov elements that
   could be incorporated as payoffs.
5. A Chekhov element that is forgotten by the GM but remembered
   by the players creates a trust gap. Prevent this.

### Dormant Thread Revival

Threads that have not advanced in 3+ sessions should be reviewed:

- **Still relevant?** If the campaign has moved on, retire the
  thread explicitly.
- **Can it connect to current events?** If so, weave it back
  in through a callback.
- **Does it affect active NPCs or factions?** If so, advance
  it in the background and let consequences surface naturally.

## Callback System

### What Is a Callback?

A callback references an earlier event, NPC, item, or decision
in a way that makes the campaign feel interconnected. Callbacks
reward player attention and create a sense of a living world.

### Callback Types

| Type | Description | Example |
|------|-------------|---------|
| Consequence callback | Earlier decision produces results | The bandit they spared returns as an informant |
| NPC callback | Earlier NPC reappears in new context | The innkeeper from session 1 is seen at the cult meeting |
| Item callback | Earlier item gains new significance | The mundane ring turns out to be a key |
| Location callback | Earlier location changes or is revisited | The peaceful village is now besieged |
| Information callback | Earlier clue becomes relevant | The strange symbol seen in session 2 appears again |
| Reputation callback | PC actions have affected their standing | The town guards recognise the PCs from wanted posters |

### Callback Generation Process

When generating new content, actively scan existing campaign
data for callback opportunities:

1. Review recent sessions for unresolved player decisions.
2. Check dormant NPCs who could logically appear in the current
   context.
3. Look for items or clues introduced but not yet paid off.
4. Consider how faction clock advances might surface to the PCs.
5. Identify locations the PCs know that connect to the current
   scenario.

**Callback density guidelines:**
- 1-2 callbacks per session maintains connection without
  feeling contrived.
- Every callback should feel organic within the current
  context, not forced.
- Callbacks to player decisions are more impactful than
  callbacks to GM content.

## Memory-Aware Revision

### What Is Memory-Aware Revision?

When existing content needs updating (an NPC description, a
location entry, a scenario outline), the revision must account
for everything that has happened in the campaign since the
content was created. Memory-aware revision prevents introducing
contradictions during updates.

### Revision Checklist

Before modifying any existing content:

1. **Check session history.** Has this entity appeared in play
   since it was last updated? What happened?

2. **Check relationship changes.** Have any of this entity's
   relationships changed due to in-play events?

3. **Check timeline.** Does the revision conflict with any
   established timeline events?

4. **Check player knowledge.** What do the players already
   know about this entity? The revision cannot contradict
   player-observed facts without a narrative explanation.

5. **Check dependent entities.** Are other entities, clues, or
   threads that reference this entity affected by the revision?

6. **Mark the source.** Record what prompted the revision and
   in which session.

### Revision vs Retcon

- **Revision** updates content to reflect in-game developments.
  The fictional history is unchanged; the GM's records are
  catching up. Example: updating an NPC's status from "alive"
  to "deceased" after they died in session 5.

- **Retcon** changes established fictional history. Something
  that was true is now declared to have never been true, or to
  have been different. Example: declaring that the NPC who died
  in session 5 actually faked their death.

Revisions are routine maintenance. Retcons are narrative events
that should be used sparingly and intentionally, because they
affect player trust in the fiction.

### Retcon Guidelines

If a retcon is necessary:

1. Acknowledge the change to the players rather than pretending
   it was always the case.
2. Provide an in-fiction explanation if possible (the NPC faked
   their death, the witness lied, the record was forged).
3. Update all dependent entities and threads to reflect the
   retcon.
4. Mark the retconned content as SUPERSEDED in canon management
   and create a new AUTHORITATIVE version.
5. Note the retcon in session records for future reference.

## World State Tracking

### The Living World

Between sessions, the world does not pause. Factions advance
their agendas, NPCs pursue their goals, environmental changes
progress, and consequences of PC actions ripple outward.

### Between-Session Update Procedure

1. **Advance faction clocks.** For each active faction, decide
   whether their current project clock advances. Consider:
   did the PCs interfere? Did opposing factions act?

2. **Progress NPC timelines.** For each NPC with a timeline,
   advance to the next step if their trigger conditions are met.

3. **Apply consequences.** For each PC decision from the last
   session, determine the downstream effects on the world.

4. **Check expiring conditions.** Are there any time-limited
   effects, healing processes, or deadlines that resolve between
   sessions?

5. **Surface new hooks.** Based on the above updates, identify
   what new information, events, or encounters are now available
   to the PCs.

### State Snapshot

Periodically generate a campaign state snapshot that captures
the current state of all tracked elements:

```
## Campaign State: [Date]

**Active Threats:** [What dangers are currently in motion]

**Faction Status:**
- [Faction]: [Current goal, clock progress, disposition to PCs]

**Key NPC Status:**
- [NPC]: [Current location, current activity, disposition]

**Active Threads:**
- [Thread]: [Current state, urgency]

**Unresolved Chekhov Elements:**
- [Element]: [Introduced in session X, not yet resolved]

**Player Knowledge Summary:**
- [What the PCs collectively know and believe]

**Upcoming Triggers:**
- [Events that will occur based on timeline or conditions]
```

## Consistency During Generation

When generating new content, the continuity engine performs
these checks automatically:

1. **Name collision check.** Does a character, location, or
   item with this name or a similar name already exist?

2. **Timeline placement.** Does the generated content fit
   within the established timeline without contradictions?

3. **Relationship coherence.** Do the relationships in the
   generated content align with existing relationship data?

4. **Canon compliance.** Does the generated content respect
   all AUTHORITATIVE canon entries?

5. **Thread integration.** Does the generated content connect
   to or advance any existing threads?

6. **Tone consistency.** Does the generated content match the
   established campaign tone and genre?

If any check fails, the generation flags the conflict and either
adjusts automatically or asks the GM for resolution.

## Sources

- Justin Alexander (The Alexandrian), Campaign Status Document
  and Node-Based Scenario Design.
- Mike Shea (Sly Flourish), Secrets and Clues methodology.
- Vincent Baker, Fronts system (Apocalypse World).
- John Harper, Faction Clocks (Blades in the Dark).
- Gnome Stew, various articles on campaign continuity.
- Robin Laws, Robin's Laws of Good Game Mastering.
