# World Evolution: Post-Session Procedure

The world does not wait for the PCs. Between sessions, factions
advance plans, consequences ripen, rumours spread, and the
calendar turns. Run this procedure after every session.

> "Every antagonist faction has a plan that advances whether
> the PCs act or not. The PCs don't start the story — they
> *interrupt* it."

## Apprentice Behaviour

All updates are recommendations awaiting GM approval. Never
silently update campaign state — every proposed change must be
visible to the GM before it becomes canon.

## Output Quality

- **Be decisive.** "The cult dispatches two agents within 48
  hours" — not "the cult may send agents."
- **Name everyone.** "Inspector Brennan starts asking questions"
  — not "a law enforcement figure investigates."
- **Surprise the GM.** Unexpected-but-logical second-order
  consequences.
- **Write scenes, not summaries.** "A flat-faced stranger
  appears near the boarding house twice" — not "agents begin
  surveillance."
- **Match system tone.** CoC: creeping dread. FitD: noir crime.
  D&D: living political/adventure landscape.

## Storage Checkpoint

Before the first update, determine where campaign state lives:

1. **campaign-organizer** (recommended if vault exists)
2. **Set up campaign-organizer now** — pause, configure, return
3. **Simple files** — plain markdown in GM-specified directory

## Post-Session Update Checklist

Six steps in order. Each produces proposals. Present all
together after Step 6; wait for GM confirmation before filing.

### Step 1: Thread State Updates

Review active threads (`continuity-engine.md`). For each:
- Active threads resolved this session
- Dormant threads touched or revived
- Chekhov elements that fired, or overdue (5+ sessions unfired)
- Foreshadowing that paid off or needs planting
- Threads dormant 3+ sessions: recommend revival, retirement,
  or background advancement

### Step 2: Faction Turns

Run the Universal Faction Turn (below) for each active faction.
System-specific modules override when available:
- FitD: `systems/fitd/session-procedures.md`
- CoC: `systems/coc-7e/session-procedures.md`
- D&D: `systems/dnd-5e-2024/session-procedures.md`
- GURPS/Generic: Universal Faction Turn as-is

### Step 3: Consequence Surfacing

Review the Consequence Tracker. For each deferred consequence:
has enough time passed? Does the current situation make surfacing
natural? Manifests as event, NPC reaction, environmental change,
or rumour?

### Step 4: Foreshadowing Review

For each planted element: did a player notice it? Is it ripe
for payoff? Should more hints be planted? Is the intended payoff
still narratively relevant?

### Step 5: Discovery State Updates

Update per-PC discovery state for clues/secrets changed this
session. Five levels: Unknown → Rumoured → Observed →
Investigated → Understood. Track individual PC knowledge vs
group knowledge.

### Step 6: World State Changes

- **Calendar:** in-world date, time passed, upcoming deadlines
- **Environment:** weather, seasonal changes, natural events
- **Politics:** elections, treaties, wars, edicts (not PC-caused)
- **Rumours:** PC-caused ("someone burned a building in the
  Narrows") and independent ("a trade ship arrived with strange
  cargo")

### After All Steps

Present all proposals grouped by step. GM confirms, modifies,
or rejects each. Then execute the filing protocol.

### Filing Protocol

**New entities:** create file per `entity-types.md` schema.
Set `source: "play"`, `createdSession`, `lastUpdated`,
`asOfSession` to current session.

**Changed entities:** update changed fields only. Set
`lastUpdated` and `asOfSession`.

**Timeline entry** — append to `campaign-timeline.md`:

```markdown
## Session [N] — [date]
[One-line summary]
**Decisions:** [2-3 PC choices that changed direction]
**Introduced:** [New entity names]
**Changed:** [Entity names with brief state change]
```

### Filing Location

| Mode | Entities | Timeline/Tracker |
|------|----------|-----------------|
| Vault (campaign-organizer) | Hand to campaign-organizer | Vault root |
| Simple files | `campaign/entities/{type}/` | `campaign/` root |
| ttrpg-expert standalone | Same as simple files | Same |

After filing: "Updates filed. Run campaign-qa to validate,
or proceed to session prep?"

## Universal Faction Turn

Five questions per active faction:

1. **Current goal?** Concrete terms: "Control the docks."
2. **What would they do if PCs didn't exist?** Next step on
   their own timeline. Classify impact:

| Impact | Meaning | If PCs miss it |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical/narrative consequence |

3. **Did PCs affect this faction?** Directly or indirectly.
4. **What changes?** No interference → advance one step.
   Interference → altered, delayed, accelerated, or derailed.
5. **What becomes visible to PCs?** Directly, through allies,
   through rumour, or not at all.

## Tracking Templates

### Consequence Tracker

```markdown
| # | Action | Deferred Consequence | Surfaces In | Manifests As | Status |
|---|--------|---------------------|-------------|-------------|--------|
```

Status: Pending → Surfaced → Spent. Also: Banked (available
when narratively useful).

### Foreshadowing Log

```markdown
| # | Planted | Element | Noticed By | Intended Payoff | Ripeness | Pay Off By |
|---|---------|---------|------------|-----------------|----------|------------|
```

Ripeness 1/5 (barely hinted) to 5/5 (payoff imminent). At 5/5,
deliver next session or impact fades.

### Campaign Tracker

```markdown
## Campaign Tracker
**Campaign:**  **System:**  **Session Count:**
**Current In-World Date:**

### World State Snapshot
[2-3 sentence current state as PCs know it]

### Active Consequences
[Pending/Banked entries with expected surface session]

### Active Foreshadowing
[Entries not yet paid off, with ripeness and target]

### Rumour Board
[Current rumours — mark True, Partially True, or False]
```

### Per-PC Discovery State

```markdown
## Discovery State: [Clue/Secret Name]
| PC | Level | Changed | How |
|----|-------|---------|-----|
```

Levels: Unknown, Rumoured, Observed, Investigated, Understood.
