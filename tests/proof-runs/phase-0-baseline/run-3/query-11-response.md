---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/gm-session-patterns.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
---

# The Universal Faction Turn

The Universal Faction Turn is a cross-system procedure run between sessions as part of the Post-Session Update (Step 2 of the World Evolution checklist in `world-evolution.md`). It keeps the world alive and moving regardless of what the PCs do — factions pursue their own agendas on their own timelines, and the procedure makes that concrete.

## When to Run It

Run the Faction Turn for every active faction after each session. System-specific modules override the Universal procedure when available:

- **FitD:** use the FitD Faction Turn in `systems/fitd/session-procedures.md` (handles clocks, tier/hold, heat, rep/turf)
- **CoC 7e:** use `systems/coc-7e/session-procedures.md`
- **D&D 5e 2024:** use `systems/dnd-5e-2024/session-procedures.md`
- **GURPS 4e / Generic / any other system:** use the Universal Faction Turn as-is

## The Five Questions

For each active faction, answer all five in order:

### 1. Current Goal?

State the faction's goal in concrete terms — not vague ambition, but a specific near-term objective.

> "Control the docks." not "expand influence."

### 2. What Would They Do If the PCs Didn't Exist?

Identify the faction's next logical step on their own timeline, independent of PC interference. Then classify the impact of that step:

| Impact | Meaning | If PCs Miss It |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical/narrative consequence |

This classification determines urgency when presenting the consequence to the GM, and how hard the PCs will have to work to reverse it if they don't intervene.

### 3. Did PCs Affect This Faction?

Review what happened in the session. Did the PCs interact with this faction directly or indirectly? Even tangential actions (burning a building owned by a faction ally, eliminating a third party the faction was competing with) count.

### 4. What Changes?

Apply the appropriate outcome based on question 3:

- **No interference** → faction advances one step toward their goal
- **Interference** → faction is altered, delayed, accelerated, or derailed — depending on what happened

Be decisive and specific. "The cult dispatches two agents within 48 hours" not "the cult may send agents."

### 5. What Becomes Visible to PCs?

Decide how (and whether) the faction's movement surfaces into play:

- **Directly** — PCs witness or experience it firsthand
- **Through allies** — a contact brings word
- **Through rumour** — street gossip, overheard conversation, a newspaper item
- **Not at all** — the move happens off-screen (use sparingly; invisible consequences breed frustration)

Name people and write scenes rather than summaries. "Inspector Brennan starts asking questions near the boarding house" beats "law enforcement investigates."

## How This Fits the Post-Session Workflow

The Faction Turn is Step 2 of six in the World Evolution procedure:

1. Thread State Updates
2. **Faction Turns** (Universal or system-specific)
3. Consequence Surfacing
4. Foreshadowing Review
5. Discovery State Updates
6. World State Changes

All outputs are proposals. Present everything to the GM after Step 6. Nothing becomes canon until the GM confirms it.

## FitD-Specific Override (for reference)

When running a Forged in the Dark campaign, the FitD Faction Turn replaces the universal version with clock-based mechanics:

- **PCs opposed faction:** tick clocks back 1-2 segments
- **PCs ignored faction:** advance clocks 1-2 (plan proceeds)
- **PCs helped faction:** advance clocks 2-3
- **Tier/Hold changes:** losing significant resources drops Hold Strong → Weak or reduces Tier by 1; consolidating power raises Hold Weak → Strong. Tier changes are rare (every 5-10 sessions).
- **Heat consequences:** 4+ heat means nearby factions take notice; entanglement results may create new faction threads.
- **Rep/turf:** scores affecting territory trigger proposed rep changes and turf shifts. Seized turf automatically creates new enemies.

Reference `systems/fitd/factions.md` for canonical tiers, holds, clocks, and faction NPCs.

## Design Principles

The procedure rests on a single premise: factions don't wait. The PCs don't start the story — they interrupt it. Running this turn after every session ensures that:

- Inaction has consequences (missed Critical moves shift the world permanently)
- The world feels inhabited by agents with independent agendas
- The GM is never caught flat-footed by "what has X faction been doing?"
- Consequences are graded so the GM can calibrate urgency without everything being an emergency
