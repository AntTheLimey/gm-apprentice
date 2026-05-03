---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/INDEX.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
  - skills/ttrpg-expert/systems/fitd/factions.md
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/session-procedures.md
---

# The Universal Faction Turn

The Universal Faction Turn is a between-session procedure found in `world-evolution.md`. It is the default mechanism for advancing faction agendas — answering the question "what happened in the world while the PCs weren't looking?" It runs as Step 2 of the Post-Session Update Checklist for every active faction in the campaign.

## When It Runs

After every session, as part of the six-step Post-Session Update. Step 2 says: run the Universal Faction Turn for each active faction. System-specific overrides apply for FitD, CoC, and D&D 5e (see below). For GURPS and any generic system, the Universal Faction Turn runs as written.

## The Five Questions

For each active faction, answer these five questions in order:

**1. What is their current goal?**
State it concretely: "Control the docks," "Summon the Deep One," "Corner the wheat market." Vague goals produce vague turns.

**2. What would they do if the PCs didn't exist?**
Identify the faction's next independent step on their own timeline. Then classify the impact of that step:

| Impact | Meaning | If PCs miss it |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical/narrative consequence |

This classification tells you how much pressure to put on the players — Critical events warrant direct visible signals; Flavour events may never surface.

**3. Did the PCs affect this faction?**
Consider both direct action (they attacked the faction's warehouse, they bribed a faction contact) and indirect action (they shut down the rival faction, which removes a source of pressure on this one).

**4. What changes?**
- No PC interference: the faction advances one step toward their goal.
- PC interference: alter, delay, accelerate, or derail the faction's plan according to what actually happened. The fiction drives this — not a formula.

**5. What becomes visible to the PCs?**
Decide the vector of revelation:
- **Directly** — the PCs witness it themselves
- **Through allies** — a contact passes on news
- **Through rumour** — overheard at a tavern, read in a broadsheet, whispered by an NPC
- **Not at all** — the faction acts invisibly; the players won't know until consequences arrive

## Writing Quality

The procedure demands decisive, specific outputs. "The cult dispatches two agents within 48 hours" — not "the cult may send agents." "Inspector Brennan starts asking questions" — not "a law enforcement figure investigates." Name every NPC. Write scenes, not summaries. Surprise the GM with unexpected-but-logical second-order consequences.

Tone should match the system: CoC = creeping dread; FitD = noir crime; D&D = living political/adventure landscape.

---

## System-Specific Overrides

### Forged in the Dark (FitD)

Replaces Q4 with clock-based mechanics (`systems/fitd/session-procedures.md`):

- PCs **opposed** the faction: tick back 1–2 segments on their project clock
- PCs **ignored** the faction: advance 1–2 segments (plan proceeds)
- PCs **helped** the faction: advance 2–3 segments

Tier and Hold changes are possible but rare:
- Lost significant resources: Hold Strong → Weak, or Tier -1
- Consolidated power: Hold Weak → Strong
- Tier changes happen every 5–10 sessions at most

Additional FitD-specific considerations:
- 4+ heat = nearby factions take notice
- Entanglement results may create new faction threads
- Scores affecting territory → propose rep changes and turf shifts; seized turf creates new enemies automatically

The FitD Faction Turn procedure in `factions.md` adds a practical sequence: select 2–4 relevant factions, advance project clocks (use a fortune roll at the faction's Tier if uncertain), choose 1–2 downtime maneuvers each, and share news through PC contacts and vice purveyors.

### Call of Cthulhu 7e (CoC)

CoC does **not** use clocks, ticks, or segments. Antagonists advance on a **narrative arc** — named stages of a plan that unfold through fiction. Example for a summoning cult:

| Stage | What's happening | Visible signs |
|-------|-----------------|---------------|
| Preparation | Gathering members, securing a location | Strange meetings, new faces |
| Gathering | Collecting ritual components, kidnapping victims | Disappearances, odd purchases |
| Ritual | Active ceremony, final preparations | Chanting at night, lights on the reef |
| Culmination | The summoning attempt | The sky changes — too late to stop quietly |

The cult advances one stage every 2–3 sessions if investigators don't intervene. Disruption doesn't roll them back — it makes them **adapt**: find a substitute, accelerate the timeline, retaliate.

Cult awareness of investigators escalates as narrative description, not a number:
- **Unaware** → **Suspicious** → **Aware** → **Hostile**

Move one level per session at most. The dread comes from investigators realising they're being watched before anything violent happens.

### D&D 5e (2024)

Focuses on influence, territory, and political consequence:

- PCs clear a dungeon or defeat a faction leader → propose a power vacuum; which faction moves in?
- PCs ally with a faction → that faction expands (new territory, recruits, resources)
- PCs anger a faction → escalation: bounty hunters, political pressure, military response

Each D&D faction turn should generate 1–2 potential quest hooks:
- Weakened faction: desperate bargain
- Strengthened faction: demands tribute or service
- Rival faction: approaches PCs for an alliance against their common enemy

Military movements take 2–4 sessions to develop; political changes can happen in a single session if PC actions trigger them.

---

## Tracking Templates

The procedure provides two supporting trackers in `world-evolution.md`:

**Consequence Tracker** — records deferred consequences and when they surface:
```
| # | Action | Deferred Consequence | Surfaces In | Manifests As | Status |
```
Status flows: Pending → Surfaced → Spent. "Banked" marks consequences held until narratively useful.

**Campaign Tracker** — a snapshot of world state:
```
## Campaign Tracker
Current In-World Date:
World State Snapshot (2-3 sentences as PCs know it)
Active Consequences (pending/banked with target session)
Active Foreshadowing (not yet paid off, with ripeness)
Rumour Board (True / Partially True / False)
```

---

## Key Principle

All faction turn outputs are **proposals awaiting GM approval**. Nothing becomes canon silently. Present the full slate of changes at the end of Step 6 (after all six post-session steps), wait for GM confirmation, then file using the campaign-organizer or simple-file protocol.
