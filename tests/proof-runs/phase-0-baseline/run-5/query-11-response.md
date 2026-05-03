---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
  - skills/ttrpg-expert/systems/fitd/factions.md
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/session-procedures.md
---

# The Universal Faction Turn

Source: `skills/ttrpg-expert/world-evolution.md`

## What It Is

The Universal Faction Turn is a post-session procedure run for each active faction in your campaign. It is Step 2 of the six-step World Evolution checklist. Its purpose is to move the world forward independent of PC actions — factions pursue their goals whether or not the players engage with them. All outputs are proposals for GM approval; nothing becomes canon silently.

## The Five Questions

Run these for every active faction after each session:

**1. Current goal?**
State it in concrete terms. Not "the cult wants power" — "the cult wants to control the docks by bribing Harbour-Master Fen."

**2. What would they do if the PCs didn't exist?**
Identify the faction's next step on its own timeline, then classify its impact:

| Impact | Meaning | If PCs miss it |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical or narrative consequence |

This classification tells you how urgently you need to surface the faction's activity to the players.

**3. Did the PCs affect this faction?**
Look for direct interference (attacking, stealing, allying) and indirect effects (reputation ripple, collateral damage, helping a rival).

**4. What changes?**
- No PC interference: the faction advances one step toward its goal.
- PC interference: the plan is altered, delayed, accelerated, or derailed — whichever is most logical given what the PCs did. The faction adapts; it rarely simply reverses.

**5. What becomes visible to the PCs?**
Decide how (and whether) they learn about the faction's move:
- Directly (they witness it)
- Through allies or contacts
- Through rumour
- Not at all (yet)

## Output Quality Standards

When writing faction turn results, follow these rules:
- Be decisive: "The Emerson Company dispatches two dockworkers to watch the boarding house" — not "the company may begin surveillance."
- Name everyone: "Constable Whitmore starts asking at the pub" — not "law enforcement begins inquiries."
- Write scenes, not summaries: concrete fictional images, not abstractions.
- Surprise the GM: second-order consequences that are unexpected but logical.
- Match system tone: creeping dread for CoC, noir crime for FitD, living political landscape for D&D.

## System-Specific Overrides

The Universal Faction Turn is designed for GURPS and generic campaigns. Each supported system has an override for Question 4 (what changes):

### Forged in the Dark (FitD)
Source: `systems/fitd/session-procedures.md` and `systems/fitd/factions.md`

Replace the narrative "advance one step" with clock-based mechanics:
- PCs **opposed** the faction: tick back 1-2 clock segments
- PCs **ignored** the faction: advance 1-2 segments (plan proceeds)
- PCs **helped** the faction: advance 2-3 segments

Also track:
- **Tier/Hold:** lost significant resources → Hold Strong to Weak or Tier -1; consolidated power → Hold Weak to Strong. Tier changes are rare (every 5-10 sessions).
- **Heat consequences:** 4+ heat means nearby factions take notice; entanglement results may generate new faction threads.
- **Rep and turf:** scores affecting territory should propose rep changes and turf shifts. Seized turf automatically creates new enemies.

Between sessions, select 2-4 relevant factions, advance their project clocks, assign 1-2 downtime maneuvers each, and surface news through PC contacts or vice purveyors.

### Call of Cthulhu 7e (CoC)
Source: `systems/coc-7e/session-procedures.md`

**CoC does not use clocks, ticks, or segments.** Those are FitD mechanics. Instead, antagonist groups (cults, conspiracies, cosmic entities) advance on a **narrative arc** — named stages of a plan that unfold through fiction.

Example for a summoning cult:
| Stage | What's happening | Visible signs |
|-------|-----------------|---------------|
| Preparation | Gathers members, secures a location | Strange meetings, new faces |
| Gathering | Collecting ritual components, kidnapping victims | Disappearances, odd purchases |
| Ritual | Active ceremony, final preparations | Chanting at night, lights on the reef |
| Culmination | The summoning attempt | Sky changes, sea rises — too late to stop quietly |

Advance one stage every 2-3 sessions if investigators don't intervene. If they destroy a component or disrupt operations, the cult **adapts** — finds a substitute, accelerates the timeline, or retaliates. It doesn't slide back on a track.

Investigator heat is also narrative, not mechanical, escalating across four levels:
- **Unaware:** Cult doesn't know investigators exist — their most vulnerable state.
- **Suspicious:** Wrong questions asked, seen near a cult location. A watcher is assigned.
- **Aware:** Cult knows investigators are actively working against them. Security tightens, warnings are delivered.
- **Hostile:** Active attempts to stop investigators — ambushes, kidnapping of allies, framing, or direct supernatural attack.

Move one heat level per session at most. Dread comes from investigators realising they're watched before anything violent happens.

### D&D 5e 2024
Source: `systems/dnd-5e-2024/session-procedures.md`

Focus on influence, territory, and political/military ripple:
- PCs cleared a dungeon or killed a faction leader: propose a power vacuum. Which faction moves in?
- PCs allied with a faction: that faction expands influence (new territory, recruits, resources).
- PCs angered a faction: escalation (bounty hunters, political pressure, military response).

Each faction turn should produce **1-2 potential quest hooks** — a weakened faction offering a desperate bargain, a strengthened faction demanding tribute, a rival faction approaching the PCs for an alliance.

Track alliances between factions; PC actions may create or break them. Major military movements take 2-4 sessions to develop. Political changes can happen in one session if triggered by PC action.

## Where the Faction Turn Sits

The Faction Turn is Step 2 of six post-session steps. Run all six, then present all proposals together before filing anything:

1. Thread state updates
2. **Faction turns** ← here
3. Consequence surfacing
4. Foreshadowing review
5. Discovery state updates
6. World state changes (calendar, environment, politics, rumours)

All outputs wait for GM confirmation before becoming campaign canon.
