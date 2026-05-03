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

## What It Is

The Universal Faction Turn is a cross-system post-session procedure for keeping the world alive between sessions. It ensures that antagonists, organisations, and power players advance their own agendas whether or not the PCs interact with them. The world does not pause for the players — it continues, and the Faction Turn is how you track and surface that momentum.

It lives in `world-evolution.md` as **Step 2** of the six-step Post-Session Update Checklist.

---

## When to Run It

Run the Faction Turn after every session, as part of the full Post-Session Update. You run it for every **active faction** — any organisation or antagonist group with goals currently in play.

System-specific modules override the Universal Faction Turn when they are available:
- **FitD:** `systems/fitd/session-procedures.md` (uses clocks, ticks, Tier rolls)
- **CoC:** `systems/coc-7e/session-procedures.md` (uses narrative arc stages, not clocks)
- **D&D:** `systems/dnd-5e-2024/session-procedures.md` (uses influence/territory, quest hooks)
- **GURPS / Generic:** Universal Faction Turn runs as-is — no override

---

## The Five Questions

For each active faction, answer these five questions:

### 1. What is their current goal?

State it in concrete, specific terms. Not "expand influence" — rather: "Control the docks by the end of the month" or "Summon the entity before the full moon." Vague goals produce vague turns.

### 2. What would they do next if the PCs didn't exist?

Identify their next independent action on their own timeline. Then classify the impact of that action:

| Impact Level | Meaning | If the PCs Miss It |
|---|---|---|
| **Critical** | Irreversible turning point | The world shifts permanently |
| **Significant** | Major advantage, recoverable with effort | The cost of catching up increases |
| **Minor** | Incremental progress | A lost opportunity, not a disaster |
| **Flavour** | World texture — life goes on | No mechanical or narrative consequence |

This classification tells you how urgently the PCs need to respond, and what the stakes are if they don't.

### 3. Did the PCs affect this faction?

Assess both direct and indirect impact. Did the PCs raid a safehouse, publicly embarrass a faction leader, make a deal with a rival, or simply ignore this faction entirely? Indirect effects count — helping one faction weakens another.

### 4. What changes?

- **No PC interference:** the faction advances one step toward their goal.
- **PC interference:** the faction's situation is altered — it may be delayed, accelerated, derailed, or forced to change approach. Be specific: "The cult loses their ritual site but secures a backup location three days later."

Avoid moving factions backwards without cause. Setbacks change their approach or timeline; they don't erase prior progress without good reason.

### 5. What becomes visible to the PCs?

Decide how (and whether) the faction's advance surfaces in the fiction:
- **Directly:** the PCs witness it first-hand
- **Through allies or contacts:** an ally reports strange activity
- **Through rumour:** a street-level whisper, a newspaper item
- **Not at all (yet):** information is banked until it becomes relevant

This last question drives the Rumour Board and feeds future sessions. Every faction move should have a visibility plan.

---

## Output Standard

The faction turn produces proposals — not immediate updates. Present all proposals together after Step 6 of the Post-Session checklist. The GM confirms, modifies, or rejects each before anything becomes canon.

When writing faction turn output:
- **Be decisive.** "The Lampblacks seize the Copper Hook tavern by Tuesday" — not "the Lampblacks may make a move."
- **Name everyone.** "Inspector Brennan begins a file on the crew" — not "law enforcement takes notice."
- **Write scenes, not summaries.** "A flat-faced stranger appears near the boarding house twice that week" — not "agents begin surveillance."
- **Surprise the GM.** Look for unexpected-but-logical second-order consequences of faction advances.
- **Match system tone.** CoC: creeping dread. FitD: noir crime and political pressure. D&D: living political and adventure landscape.

---

## System-Specific Overrides

### FitD (Forged in the Dark)

FitD replaces Q4 and Q5 with clock mechanics:
- **PCs opposed the faction:** tick faction clock back 1–2 segments
- **PCs ignored the faction:** advance clock 1–2 segments (plan proceeds)
- **PCs helped the faction:** advance clock 2–3 segments

Tier/Hold changes are rare (roughly every 5–10 sessions). Heat of 4+ causes nearby factions to notice, potentially generating entanglements. Territory seized creates new enemies automatically. Faction clocks should be shared with PCs through contacts and vice purveyors.

### CoC 7e

CoC uses **narrative arc stages**, not mechanical clocks. Each antagonist group has a plan with named stages (e.g., Preparation → Gathering → Ritual → Culmination). The faction advances one stage every 2–3 sessions if investigators don't intervene. Disruption doesn't roll them back — it forces them to adapt: find a substitute, accelerate the timeline, or retaliate.

Antagonist awareness of the investigators escalates as a fictional condition, not a number: Unaware → Suspicious → Aware → Hostile. Move one level per session at most. The dread comes from investigators realising they're being watched before anything violent happens.

### D&D 5e (2024)

D&D focuses on influence, territory, and quest generation:
- Power vacuums when the PCs defeat leaders — which faction fills it?
- Allied factions expand; antagonised factions escalate (bounties, political pressure, military response)
- Each faction turn should produce 1–2 potential quest hooks for future sessions
- Major military movements take 2–4 sessions to develop; political changes can happen in 1 session if PC actions trigger them

Track alliances between factions — PC choices create and break them.

---

## Quick Reference Card

```
For each active faction:
1. Goal? (Concrete, specific)
2. Next independent action? (Classify: Critical / Significant / Minor / Flavour)
3. Did PCs affect them? (Direct or indirect)
4. What changes? (Advance, alter, delay, or derail)
5. What's visible to PCs? (Direct / via contact / rumour / not yet)

→ Write as scenes, not summaries.
→ Name everyone. Be decisive.
→ Present as proposals — wait for GM confirmation.
```

---

## Integration with the Rest of the Checklist

The Faction Turn (Step 2) feeds and is fed by the other five steps:
- **Step 1 (Thread State):** faction moves can revive dormant threads
- **Step 3 (Consequence Surfacing):** faction advances may be the mechanism for deferred consequences arriving
- **Step 4 (Foreshadowing):** a faction's visible action can be planted as foreshadowing
- **Step 6 (World State):** faction politics entries belong in the Politics section of World State Changes

All outputs together go into the Consequence Tracker and the Campaign Tracker's Rumour Board for ongoing management.
