# World Evolution: Post-Session Procedure

The world does not wait for the player characters. Between
sessions, factions advance plans, consequences ripen, rumours
spread, and the calendar turns. This document is the procedure
for making that happen — systematically, after every session.

## Core Principle

> "Every antagonist faction has a plan that advances whether
> the PCs act or not. The PCs don't start the story — they
> *interrupt* it."

The world has momentum. Factions were scheming before the PCs
arrived and will keep scheming if left alone. The GM's job
between sessions is to decide how the PCs' actions changed
(or failed to change) that momentum.

## Apprentice Behaviour

All updates are recommendations awaiting GM approval. Present
proposed changes, then wait for the GM to confirm, modify, or
reject each one before filing anything.

Never silently update campaign state. Every proposed change
must be visible to the GM before it becomes canon.

## Output Quality

Proposals must read like a living world, not a spreadsheet.

- **Be decisive.** "The cult dispatches two agents within 48
  hours" — not "the cult may send agents." Propose specific
  committed actions. The GM can reject or modify; your job
  is to present a world that has already moved.
- **Name everyone.** Every NPC, faction, and location in a
  proposal gets a name. "Inspector Brennan starts asking
  questions" — not "a law enforcement figure investigates."
- **Surprise the GM.** The best proposals make the GM think
  "I wouldn't have thought of that, but yes, that's exactly
  what would happen." Look for unexpected-but-logical
  second-order consequences.
- **Write scenes, not summaries.** "A flat-faced stranger
  appears near the boarding house twice in one week" — not
  "Innsmouth agents begin surveillance."
- **Match the system's tone.** CoC proposals should drip with
  creeping dread. FitD should feel like noir crime fiction.
  D&D should feel like a living political/adventure landscape.

---

## Storage Checkpoint

Before running the first post-session update, determine where
campaign state lives. Ask the GM once; remember the answer.

**Choose one:**

1. **Use campaign-organizer** (recommended if vault exists) —
   Campaign files already live in an Obsidian vault managed by
   the campaign-organizer skill. File updates directly into
   the vault structure.

2. **Set up campaign-organizer now** — Pause this procedure to
   install and configure the campaign-organizer skill. Return
   here when the vault is ready.

3. **Use simple files** — Works without a vault. Store updates
   in plain markdown files in a directory the GM specifies.

Once the choice is made, all subsequent steps file their
outputs to the chosen location.

---

## Post-Session Update Checklist

Run these six steps in order after every session. Each step
produces proposals. After all six steps, present all proposals
together and wait for GM confirmation before filing.

### Step 1: Thread State Updates

Review all active threads from the continuity engine
(see continuity-engine.md lines 147-218, including the
Chekhov protocol at lines 191-218).

For each thread, evaluate whether the session changed its
state:

- **Active** threads that were resolved this session.
- **Dormant** threads that were touched or revived.
- **Chekhov elements** that fired, or that are overdue
  (5+ sessions without payoff — flag for attention).
- **Foreshadowing** that paid off or that should be planted
  next session.
- Threads dormant 3+ sessions: recommend revival, retirement,
  or background advancement.

**Propose:**
```
Thread "The Missing Ledger": advance from Active to Resolved
  because PCs recovered the ledger in session 7.
Thread "The Whispering Walls" (Chekhov): flag — introduced
  session 2, now session 8, still unfired. Recommend payoff
  or retirement.
Thread "Cult Infiltration": remains Active, advance Next Beat
  to "Cult discovers the mole" based on session events.
```

### Step 2: Faction Turns

For each active faction, run the Universal Faction Turn
(see below). If the campaign uses a supported system, defer
to the system-specific faction turn module:

- **FitD:** `systems/fitd/session-procedures.md` (Faction
  Turn section)
- **CoC 7e:** `systems/coc-7e/session-procedures.md` (Faction
  Turn section)
- **D&D 5e 2024:** `systems/dnd-5e-2024/session-procedures.md`
  (Faction Turn section)
- **GURPS / Generic:** use Universal Faction Turn as-is

**Propose:**
```
Faction "The Silver Chain": advances plan to stage 4/6
  because PCs didn't interfere. Visible change: a new
  warehouse opens on Dock Street (front for smuggling).
Faction "City Watch": reacts to PCs' arson in the Narrows.
  Shifts priority from organised crime to fire investigation.
  Visible change: Watch patrols double in the Narrows.
```

### Step 3: Consequence Surfacing

Review the Consequence Tracker (see template below). For each
deferred consequence:

- Has enough time passed for it to surface?
- Does the current situation make surfacing natural?
- Should it manifest as an event, an NPC reaction, a
  environmental change, or a rumour?

**Propose:**
```
Consequence from session 3 ("PCs left cultist alive"):
  ready to surface as the cultist warns the inner circle.
  Manifests as: increased security at the cult hideout.
Consequence from session 5 ("PCs stole from merchant"):
  not yet ripe — merchant still investigating. Surface in
  1-2 sessions as a bounty posted.
```

### Step 4: Foreshadowing Review

Review the Foreshadowing Log (see template below). For each
planted foreshadowing element:

- Did a player notice it? (If so, record who.)
- Is it ripe for payoff?
- Should more hints be planted to increase ripeness?
- Is the intended payoff still narratively relevant?

**Propose:**
```
Foreshadowing "strange tides" (planted session 4): noticed
  by Elara's player. Ripeness 3/5. Intended payoff still
  relevant. Recommend one more hint next session before
  payoff in session 10.
Foreshadowing "the locked room" (planted session 2): not
  noticed by any player. Ripeness 1/5. Recommend a second
  hint through an NPC conversation.
```

### Step 5: Discovery State Updates

Update the per-PC discovery state for any clues or secrets
that changed this session. Use the five-level model from
active-play-management.md (lines 37-41):

| Level | Meaning |
|-------|---------|
| Unknown | Players have no knowledge |
| Rumoured | Players heard about it |
| Observed | Players witnessed it directly |
| Investigated | Players actively studied it |
| Understood | Players grasp significance |

Track what each individual PC knows versus what the group
knows. A clue may be Understood by one PC and Unknown to
another.

**Propose:**
```
Clue "identity of the patron": Marcus advances from
  Rumoured to Observed (saw the patron at the gala).
  Rest of party remains at Rumoured.
Clue "ritual components": whole party advances from
  Investigated to Understood (decoded the journal).
```

### Step 6: World State Changes

Update the broader world state for changes that are not
covered by threads, factions, or consequences. Consider:

- **Calendar:** What date is it in-world? How much time
  passed this session? Any upcoming events or deadlines?
- **Environment:** Weather shifts, seasonal changes, natural
  events.
- **Politics:** Elections, treaties, wars, edicts — anything
  the PCs didn't cause but that affects the world.
- **Rumours:** What are people in the world talking about?
  Include rumours about the PCs' actions (they are becoming
  known) and rumours unrelated to the PCs (the world is
  bigger than them).

**Propose:**
```
Calendar: advance from 14th Harvestmoon to 16th Harvestmoon.
  The autumn festival is now 4 days away.
Rumour (PC-caused): "Someone burned a building in the
  Narrows. The Watch is offering silver for information."
Rumour (world): "A trade ship from the east arrived with
  strange cargo — no one will say what."
```

### After All Steps

Present all proposals from steps 1-6 together, grouped by
step. The GM confirms, modifies, or rejects each one.

After GM approval, execute the filing protocol below.

### Filing Protocol

For each approved proposal, file the changes to the storage
location chosen during the Storage Checkpoint.

**New entities** (NPCs, locations, factions, items, threads
introduced during play):
1. Create an entity file using the schema in `entity-types.md`
2. Set `source: "play"` (or `"prep"` if created during prep)
3. Set `createdSession`, `lastUpdated`, and `asOfSession` to
   the current session number
4. Include all relevant attributes from the approved proposal

**Changed entities** (existing NPCs, factions, items whose
state changed):
1. Update the entity file with the changed fields
2. Set `lastUpdated` and `asOfSession` to the current session
3. Do not overwrite unchanged fields

**Timeline entry** — append to `campaign-timeline.md`:

```
## Session [N] — [date]

[One-line summary of what happened — the single sentence
a GM would use to remind players next session]

**Decisions:** [2-3 PC choices that changed campaign direction]
**Introduced:** [New entity names — details live on entities]
**Changed:** [Entity names with brief state change note]
```

Assemble this from the approved proposals — the summary
comes from the key events, the decisions from faction turns
and consequence surfacing, the introduced/changed lists from
the entity filing above. This is not a separate writing task;
it is a structured summary of what was just filed.

### Filing Location by Configuration

**Vault mode** (campaign-organizer available):
- Entity files → hand to campaign-organizer for vault filing
- `campaign-timeline.md` → vault root
- `campaign-tracker.md` → vault root

**Simple files mode** (no vault):
- Use the following directory structure:

```
campaign/
  campaign-timeline.md
  campaign-tracker.md
  entities/
    npcs/
    locations/
    factions/
    items/
    threads/
    clues/
```

- One markdown file per entity, named after the entity
- ttrpg-expert creates this structure on first use if it
  does not exist

**ttrpg-expert standalone** (only skill installed):
- Same as simple files mode
- ttrpg-expert uses `entity-types.md` as its schema guide
- No dependency on campaign-organizer

After filing, suggest: "Updates filed. Would you like to
run campaign-qa to validate, or proceed to session prep?"

---

## Universal Faction Turn

For each active faction, answer these five questions in order.
This is the generic procedure; system-specific modules may
replace or extend it.

### The Five Questions

1. **What is this faction's current goal?**
   State the goal in concrete terms: "Control the docks,"
   "Find the artifact," "Discredit the magistrate."

2. **What would this faction do if the PCs didn't exist?**
   Their plan advances on its own timeline. Describe the next
   step the faction would take unopposed. Then classify its
   impact:

   | Impact | Meaning | If PCs miss it |
   |--------|---------|----------------|
   | **Critical** | Irreversible turning point — changes the campaign's trajectory | The world shifts permanently. New alliances lock in, rituals complete, leaders are assassinated. The PCs face a harder, different campaign from this point forward. |
   | **Significant** | Major advantage gained or lost — but recoverable with effort | The faction is stronger or the PCs' position is weaker, but creative action can still reverse it. The cost of catching up increases. |
   | **Minor** | Incremental progress — advances the plan without decisive change | A resource acquired, a contact made, territory scouted. Creates ripples and rumours but doesn't reshape the landscape. Missing it is a lost opportunity, not a disaster. |
   | **Flavour** | World texture — life goes on | A shipment moves, a meeting happens, a patrol changes route. Makes the world feel alive but has no mechanical or narrative consequence if missed. |

   When proposing faction actions to the GM, always state the
   impact level. This helps the GM decide which events to
   surface prominently (Critical/Significant) vs mention in
   passing (Minor) vs leave as background colour (Flavour).
   It also helps with session prep — Critical events should
   be scenes; Flavour events are rumours at best.

3. **Did the PCs affect this faction this session?**
   Directly (confrontation, alliance, theft) or indirectly
   (disrupting an ally, changing the environment).

4. **What changes?**
   Combine the answers above. If the PCs didn't interfere,
   the faction advances one step. If they did, the plan is
   altered, delayed, accelerated, or derailed. For supported
   systems, defer to the system-specific module for
   mechanical resolution (clocks, reaction rolls, etc.).

5. **What becomes visible to the PCs?**
   Not everything a faction does is immediately apparent.
   Determine what the PCs could notice — directly, through
   allies, through rumour, or not at all.

---

## Tracking Templates

Use these templates to maintain state between sessions. Store
them in the campaign vault or in simple files, depending on
the storage choice made above.

### Consequence Tracker

Track deferred consequences of PC actions that haven't yet
manifested in play.

```markdown
## Consequence Tracker

| # | Action | Deferred Consequence | Surfaces In | Affects | Manifests As | Status |
|---|--------|---------------------|-------------|---------|-------------|--------|
| 1 | PCs left cultist alive (S3) | Cultist warns inner circle | S8-S9 | Cult faction | Increased security | Pending |
| 2 | PCs stole merchant goods (S5) | Merchant hires bounty hunter | S7-S8 | Merchant NPC | Bounty posted | Pending |
| 3 | PCs saved drowning child (S4) | Family becomes loyal ally | When needed | Dock district NPCs | Safe house offered | Banked |
```

**Status values:** Pending (waiting to surface), Banked
(available when narratively useful), Surfaced (delivered in
play), Spent (fully resolved).

### Foreshadowing Log

Track planted hints and their intended payoffs.

```markdown
## Foreshadowing Log

| # | Planted | Element | Noticed By | Intended Payoff | Ripeness | Pay Off By |
|---|---------|---------|------------|-----------------|----------|------------|
| 1 | S4 | Strange tides in harbour | Elara | Sea creature emergence | 3/5 | S10 |
| 2 | S2 | Locked room in manor | None | Hidden shrine | 1/5 | S9 |
| 3 | S6 | NPC's nervous glance | Marcus, Jin | NPC is the traitor | 2/5 | S11 |
```

**Ripeness:** 1/5 (barely hinted) to 5/5 (payoff imminent).
If ripeness reaches 5/5, the payoff should happen next session
or the foreshadowing loses impact.

### Campaign Tracker

A single-page overview of the campaign's current state.

```markdown
## Campaign Tracker

**Campaign:** [Name]
**System:** [System]
**Session Count:** [Number]
**Current In-World Date:** [Date]

### World State Snapshot
[2-3 sentence summary of the current state of the world
as the PCs know it.]

### Active Consequences
[List consequence tracker entries with status Pending or
Banked, with their expected surface session.]

### Active Foreshadowing
[List foreshadowing log entries not yet paid off, with
ripeness and target session.]

### Rumour Board
[Current rumours circulating in the world, both PC-caused
and independent. Mark each as True, Partially True, or
False — the PCs don't know which.]
```

### Per-PC Discovery State

Track individual PC knowledge of key clues and secrets.

```markdown
## Discovery State: [Clue/Secret Name]

| PC | Level | Changed | How |
|----|-------|---------|-----|
| Marcus | Observed | S7 | Saw the patron at the gala |
| Elara | Rumoured | S5 | Heard dock workers mention it |
| Jin | Unknown | — | — |
| Vex | Investigated | S7 | Examined the patron's signet ring |
```

Update this table whenever a PC's knowledge level changes.
The five levels are: Unknown, Rumoured, Observed,
Investigated, Understood.
