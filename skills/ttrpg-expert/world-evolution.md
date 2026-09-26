# World Evolution: Post-Session Procedure

The world does not wait for the PCs. Between sessions, factions
advance plans, consequences ripen, rumours spread, and the
calendar turns. Run this procedure after every session.

**Invocation:** This procedure normally runs as reconcile
step 6.5 — offered to the GM after session canon status is
promoted. It can also be invoked standalone via ttrpg-expert
("update the world" / "post-session update").

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

## Storage Checkpoint (standalone only)

Skip this step when invoked from reconcile — the vault
location is already established.

When invoked standalone, determine where campaign state lives:

1. **campaign-organizer** (recommended if vault exists)
2. **Set up campaign-organizer now** — pause, configure, return
3. **Simple files** — plain markdown in GM-specified directory

## Post-Session Update Checklist

Seven steps in order. Each produces proposals. Present all
together after Step 7; wait for GM confirmation before filing.

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
- PF2e: `systems/pf2e/session-procedures.md`
- GURPS/Generic: Universal Faction Turn as-is

### Step 3: NPC Reactions

For each named NPC who learned something this session, came under
new pressure, or is hit by a Step 2 faction move, decide what they
do next from who they are, not from what the plot needs. The system
modules' NPC guidance (D&D "NPC reactions", CoC "NPC loyalty
shifts") applies here: the NPC's traits choose among the shapes a
reaction can take.

1. **Pressure.** One line on what changed for them: "the party has
   shown her that standing near them is dangerous."
2. **Read them.** GM Notes `### Wants`, `### Under Pressure` and
   `### Secrets` (or an `AIMS:` block: Agenda as Wants, Instinct as
   Under Pressure), plus Overview and History. Quote the traits that
   bear on this pressure, with the file. Evidence is what played: an
   earlier world-evolution note is a projection until a wrap-up
   shows it happened, so label it as one.
3. **Backfill what's missing.** No Wants or Under Pressure and no
   `AIMS:` block (older files have none): draft them first, per the
   AIMS framework in `npc-generation.md`. Wants carries the three
   agenda layers; Under Pressure carries the instinct
   (fight/flee/freeze/fawn, trusting/suspicious,
   generous/self-preserving, honest/deceptive). Draw only on what the
   vault already records (Overview, History, Campaign Log, Behind the
   Scenes, wrap-ups), cite each line, and mark inference. A
   `(projected)` entry is not evidence. The draft
   goes under the file's gm-only `## GM Notes`, created fenced if
   absent, and is proposed with the reaction.
4. **React.** Traits pointing one way: be decisive, write it as a
   scene, name the trait. Traits pulling two ways (protect the
   children vs refuse to be managed): present a fork, each branch
   with its reaction, the trait behind it, and its first ripple on
   factions, threads and PCs. Recommend one anyway: say which
   branch the traits favour, and why. Where the NPC's first move is
   to confront a PC, that PC's answer can be the hinge; otherwise the
   GM picks, or lets a resolve roll settle it (CoC: POW). Never
   settle a fork silently. Time each move to when the people in it
   are actually present.
5. **Chain.** A reaction is new pressure on whoever it lands on:
   the people in the room, the household, anyone it reaches through
   servants, informants, letters or gossip. The first NPC's reaction
   is link 1. Run steps 1–4 for each person it reaches whose reaction
   would change something the PCs or a faction will meet, in the
   order they would learn of it; name the rest in one line as unrun.
   Keep going until a reaction lands only on PCs (it becomes a
   question for the players) or on nobody new. Stop at three links
   and list what is left unrun, so the GM can ask for more at review.
   Follow the recommended branch down the whole chain and the other
   branch one link, so the GM sees where they split. An NPC reached
   twice reacts in line with their first reaction, or names what
   changed. A faction reached by the chain gets its Step 2 turn
   revised, not a second one. That includes its odds: a reaction
   that can trip an escalation trigger changes which of that
   faction's beats are still coming. A beat gated on a faction level
   (CoC heat, FitD tier, a scenario stage) or a party choice is
   conditional, never a fixed point. NPCs the
   revised turn newly hits join this chain's three links; they never
   start a new chain. Each link rests on the ones above it: present the chain as
   conditional on the GM approving them, and rerun it from any link
   the GM changes. End it with the GM's calls it rests on (did a
   scene happen, what a ruling allows) as questions, never settled
   facts.
6. **Record.** On approval each reaction goes in its own NPC's
   `### Behind the Scenes`, labelled as a projection:
   `- **After [[Session NN - Title]]** (projected) — …`. An open
   fork is recorded the same way, with both branches and its hinge;
   the first NPC's entry also lists the chain's links in order. The
   Campaign Log waits for session-wrapup, which drops the marker
   once it plays or strikes the entry through if it never does. A
   decided reaction that showed something new about how they break
   also goes in `### Under Pressure`, tagged `(projected, After
   [[Session NN - Title]])` until a wrap-up confirms it; an open
   fork adds nothing there.

A reaction can put a question to a player; it never decides what a
PC does or feels.

### Step 4: Consequence Surfacing

Review carry-forward items and active threads. For each deferred consequence:
has enough time passed? Does the current situation make surfacing
natural? Manifests as event, NPC reaction, environmental change,
or rumour?

### Step 5: Foreshadowing Review

For each planted element: did a player notice it? Is it ripe
for payoff? Should more hints be planted? Is the intended payoff
still narratively relevant?

### Step 6: Discovery State Updates

Update per-PC discovery state for clues/secrets changed this
session. Five levels: Unknown → Rumoured → Observed →
Investigated → Understood. Track individual PC knowledge vs
group knowledge.

### Step 7: World State Changes

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

**New entities:** create file per `shared/entity-schema.md` schema,
setting `createdSession` in the initial write. Then stamp the rest
with the bundled stamper (dry-run first, `--write` on confirmation):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/shared/scripts/stamp_entities.py" \
  <vault> <entity files> --set source=world-evolution --session N --date D
```

`--session`/`--date` write `asOfSession`/`lastUpdated`.

**Changed entities:** update changed fields only, then apply the
same stamp without `--set source=world-evolution`: `source` records
how the entity entered canon, and a projection doesn't change that.

**Timeline entry (standalone only)** — when invoked outside
reconcile, append to `campaign-timeline.md`. Skip when
invoked from reconcile — session-wrapup already wrote the
session's timeline entry.

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

**When invoked from reconcile:** skip this prompt — results
flow into reconcile step 7's `### Reconciliation Context`
under `#### World Evolution`. Set `world_evolved` on the
session index to the current session reference.

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

## Tracking State

Consequences, foreshadowing, and discovery state are tracked
without standalone tracking files:

- **Foreshadowing** — a thread in the Thread Tracker format
  (`continuity-engine.md`), with its Planted Detail, Intended
  Payoff and Ripeness lines
- **Clue entities** with `discoveryState` in
  `shared/entity-schema.md` (per-PC knowledge levels: Unknown →
  Rumoured → Observed → Investigated → Understood)

Consequences surface through session-wrapup's carry-forward
section and session-prep's thread review. World state snapshots
are maintained in the Wrap-Up → Plan handoff chain.
