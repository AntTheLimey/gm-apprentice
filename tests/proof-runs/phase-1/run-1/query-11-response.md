---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 28425
wall_clock_ms: 79194
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/INDEX.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/session-procedures.md
---

# Universal Faction Turn

The Universal Faction Turn is a cross-system post-session procedure that runs between sessions to advance faction plans independently of PC action. It embodies a core GM principle: antagonist factions have their own timelines, and the world does not pause for the players.

It lives in `world-evolution.md` as **Step 2** of the six-step Post-Session Update Checklist. Run it for every active faction after every session.

---

## The Five Questions

For each active faction, answer all five in order:

**1. What is the faction's current goal?**
State it in concrete terms. Not "the cult seeks power" — rather "the cult needs to kidnap three more victims to complete the ritual." Name the objective precisely enough that you can measure progress.

**2. What would they do if the PCs didn't exist?**
Identify the faction's next autonomous step — the action they'd take on their own timeline this between-session period. Then classify its impact on the world:

| Impact | Meaning | If PCs Miss It |
|--------|---------|----------------|
| Critical | Irreversible turning point | World shifts permanently |
| Significant | Major advantage, recoverable with effort | Cost of catching up increases |
| Minor | Incremental progress | Lost opportunity, not disaster |
| Flavour | World texture — life goes on | No mechanical or narrative consequence |

This classification governs urgency and GM communication: a Critical advance that goes unobserved should produce unmistakable signs; Flavour advances can pass quietly.

**3. Did the PCs affect this faction?**
Consider both direct interference (PCs attacked, negotiated, sabotaged) and indirect effects (PCs helped a rival, published damaging information, took something the faction needed). A faction can be affected by PC actions that weren't aimed at them at all.

**4. What changes?**
Apply the result:
- **No interference** → faction advances one step toward its goal.
- **Interference** → the advance is altered, delayed, accelerated, or derailed, depending on how significant the PC action was.

Be decisive and specific. "The Guild dispatches a fixer to recover the ledger within 36 hours" beats "the Guild considers taking action."

**5. What becomes visible to PCs?**
Decide how (if at all) PCs can learn of the change:
- **Directly** — they witness it
- **Through allies** — a contact passes word
- **Through rumour** — street talk, newspaper, gossip
- **Not at all** — for now

Not every advance needs to be immediately visible. Some of the most effective faction moves are invisible until the consequences become unavoidable.

---

## Where It Fits

The Faction Turn is Step 2 in the six-step Post-Session Update Checklist:

1. Thread State Updates
2. **Faction Turns** ← here
3. Consequence Surfacing
4. Foreshadowing Review
5. Discovery State Updates
6. World State Changes

All proposals from every step are collected and presented to the GM together after Step 6. Nothing becomes canon until the GM confirms. This is the core rule: the apprentice proposes, the GM decides.

---

## System-Specific Overrides

The Universal Faction Turn is the default. System-specific modules override Step 4 (the "what changes?" step) when available:

**Forged in the Dark** (`systems/fitd/session-procedures.md`)
FitD replaces free-form advancement with clock mechanics:
- PCs opposed the faction → tick the faction's clock back 1–2 segments
- PCs ignored the faction → advance 1–2 segments (plan proceeds)
- PCs helped the faction → advance 2–3 segments
- Tier and Hold also shift based on resource loss/consolidation (Hold Strong/Weak; Tier changes are rare, every 5–10 sessions)
- 4+ Heat means nearby factions notice; entanglement results can create new faction threads

**Call of Cthulhu 7e** (`systems/coc-7e/session-procedures.md`)
CoC uses no clocks or tick counters — those are FitD mechanics. Antagonist groups advance on a **narrative arc**: a series of named stages in a plan that unfold through fiction. Example stages for a summoning cult: Preparation → Gathering → Ritual → Culmination. Advance one stage every 2–3 sessions if investigators don't intervene. Destroying a component or disrupting operations holds the stage or forces regression; passive failure lets it advance.

**D&D 5e 2024** (`systems/dnd-5e-2024/session-procedures.md`)
D&D focuses on influence, territory, and political/military shifts. Each faction turn should generate 1–2 potential quest hooks. Power vacuums from cleared dungeons or defeated leaders prompt expansion by rival factions. Major military movements take 2–4 sessions to develop; political changes can happen in a single session if PC-triggered. Specific NPC responses — grateful patron, vengeful villain, nervous ally, opportunistic neutral — are proposed for each faction.

**GURPS 4e / Generic**
Use the Universal Faction Turn as-is; no system-specific override is defined.

---

## Output Standards

Regardless of system, faction turn proposals should meet the same quality bar:
- **Name everyone.** "Magistrate Halbrook files a writ against the Lampblacks" — not "a legal figure takes action."
- **Write scenes, not summaries.** "A flat-faced stranger appears near the boarding house twice this week" — not "surveillance begins."
- **Be decisive.** Commit to a specific action with a specific timeline.
- **Surprise the GM.** Second-order consequences — unexpected but logical — are more useful than obvious moves.

---

## Quick Reference

```
For each active faction:
1. Goal → state concretely
2. Autonomous next step → classify impact (Critical / Significant / Minor / Flavour)
3. PC effect? → direct, indirect, or none
4. Result → advance / alter / delay / derail
5. Visibility → direct / ally / rumour / hidden

No changes become canon until GM confirms.
```
