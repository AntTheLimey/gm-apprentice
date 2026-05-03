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
---

# Universal Faction Turn

The Universal Faction Turn is a cross-system GM procedure for advancing faction storylines between sessions. It lives in Step 2 of the Post-Session Update Checklist (see `world-evolution.md`).

**When to run it:** After every session, for each active faction in your campaign. System-specific modules override it when available (FitD has its own faction turn with clock mechanics; CoC and D&D have session-procedures overrides). For GURPS and any system without a dedicated module, run the Universal Faction Turn as written.

---

## The Five Questions

Run these five questions for each active faction, in order:

### 1. What is their current goal?

State it in concrete terms. Not "gain power" — "control the docks by bribing Harbormaster Fen." Vague goals produce vague turns.

### 2. What would they do if the PCs didn't exist?

Identify the next step on their own independent timeline. Then classify the impact of that step:

| Impact | Meaning | If PCs miss it |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture, life goes on | No mechanical or narrative consequence |

This question forces you to treat factions as autonomous agents — they don't wait around.

### 3. Did the PCs affect this faction?

Consider both direct interference (attacking their operation, stealing their asset) and indirect effects (the PCs exposed a rival, which frees this faction to move faster; the PCs made noise, which drew heat this faction now has to navigate).

### 4. What changes?

Apply the outcome:

- **No PC interference** → the faction advances one step toward their goal.
- **PC interference** → the faction's situation is altered, delayed, accelerated, or derailed, depending on what the PCs did and how effectively.

Be decisive. "The cult dispatches two agents within 48 hours" — not "the cult may consider sending agents."

### 5. What becomes visible to the PCs?

Faction moves only matter if there are signals the PCs can act on. Decide:

- **Direct observation** — the PCs see or hear it themselves.
- **Through allies** — a contact, friendly NPC, or allied faction reports it.
- **Through rumour** — garbled or partial, reaching the PCs indirectly.
- **Not visible** — the move happens off-screen; no signal yet (useful for slow-burn threats).

---

## Context: Where This Fits

The Universal Faction Turn is Step 2 of six post-session steps:

1. Thread state updates
2. **Faction turns** (this procedure)
3. Consequence surfacing
4. Foreshadowing review
5. Discovery state updates
6. World state changes

All six steps produce proposals. Present them together to the GM after Step 6 — do not silently update campaign state. The GM confirms, modifies, or rejects each proposal before anything becomes canon.

---

## Quality Standards

When writing faction turn outcomes, the skill's output rules apply:

- **Be decisive.** Factions act; they don't maybe-act.
- **Name everyone.** "Inspector Brennan starts asking questions" — not "a law enforcement figure investigates."
- **Think second-order.** The interesting consequence is usually not the obvious one.
- **Write scenes, not summaries.** "A flat-faced stranger appears near the boarding house twice" — not "agents begin surveillance."
- **Match system tone.** CoC: creeping dread. FitD: noir crime. D&D: living political/adventure landscape.

---

## FitD Override (for reference)

When running a Forged in the Dark campaign, the FitD-specific module in `systems/fitd/session-procedures.md` replaces the Universal Faction Turn with clock-based mechanics:

- PCs opposed the faction: tick back 1-2 clock segments
- PCs ignored the faction: advance 1-2 segments (their plan proceeds)
- PCs helped the faction: advance 2-3 segments
- Tier and Hold changes are rare (every 5-10 sessions) and require significant events
- 4+ heat on the crew means nearby factions take notice

For all other systems (CoC, D&D, GURPS, generic), use the Universal Faction Turn as described above.
