---
query: "Explain the Universal Faction Turn procedure"
system: cross-system
type: framework
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/INDEX.md
  - skills/ttrpg-expert/world-evolution.md
  - skills/ttrpg-expert/gm-session-patterns.md
  - skills/ttrpg-expert/systems/fitd/factions.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
  - skills/ttrpg-expert/systems/coc-7e/session-procedures.md
  - skills/ttrpg-expert/systems/dnd-5e-2024/session-procedures.md
---

## The Universal Faction Turn

The Universal Faction Turn is a cross-system procedure run between every session as part of **Step 2 of the Post-Session Update Checklist** (defined in `world-evolution.md`). Its purpose is simple: the world does not wait for the PCs. Factions have their own plans, timelines, and motivations that advance whether or not the players interact with them.

---

### When to Run It

After every session, during the Post-Session Update. Run the Universal Faction Turn for **each active faction** in your campaign. System-specific overrides exist for FitD, CoC 7e, and D&D 5e 2024 (see below) — use those where available. For GURPS 4e and any unsupported system, run the Universal version as-is.

---

### The Five Questions

For each active faction, answer these five questions in order:

**1. What is their current concrete goal?**
State it in specific, actionable terms. "Control the docks by bribing the Dockers' guild steward" — not vague aspirations. Concrete goals produce concrete consequences.

**2. What would they do if the PCs didn't exist?**
Identify their next step on their own timeline. Then classify the impact of that step:

| Impact Level | Meaning | If PCs Miss It |
|---|---|---|
| **Critical** | Irreversible turning point | The world shifts permanently |
| **Significant** | Major advantage, recoverable with effort | Cost of catching up increases sharply |
| **Minor** | Incremental progress | A lost opportunity, not a disaster |
| **Flavour** | World texture, life goes on | No mechanical or narrative consequence |

This classification helps you decide how urgently to signal the faction's activity to the players, and how to frame consequences if they miss it.

**3. Did the PCs affect this faction — directly or indirectly?**
Consider direct interference (they attacked a faction asset, negotiated with a faction leader) and indirect effects (their actions elsewhere shifted the balance of power, created a vacuum, or drew attention away from a faction's operation).

**4. What changes in the faction's state?**
Apply the result:
- **No PC interference** → faction advances one step toward its goal.
- **PC interference** → the faction's plan is altered, delayed, accelerated, or derailed, depending on what happened. Factions adapt — they don't simply stop. A disrupted plan becomes a modified plan.

**5. What becomes visible to the PCs?**
Decide how (and whether) the faction's movement becomes known. Four channels:
- **Directly** — PCs witness it firsthand
- **Through allies** — a contact, patron, or friendly NPC reports it
- **Through rumour** — overheard, read in a broadsheet, inferred from events
- **Not at all (yet)** — the movement happens in the dark; the consequences surface later

---

### Output Quality Standards

When running the Faction Turn, all proposals should be:

- **Decisive** — "The cult dispatches two agents within 48 hours," not "the cult may send agents."
- **Named** — "Inspector Brennan starts asking questions," not "a law enforcement figure investigates."
- **Specific** — describe what a scene looks like, not a summary. "A flat-faced stranger appears near the boarding house twice" not "agents begin surveillance."
- **Logical but surprising** — aim for second-order consequences the GM might not have anticipated.

All proposals are **recommendations awaiting GM approval**. Never silently update campaign state — every change must be visible and confirmed before it becomes canon.

---

### System-Specific Overrides

The Universal Faction Turn is a baseline. Three systems have dedicated procedures that replace parts of it:

#### Forged in the Dark (FitD)

`systems/fitd/session-procedures.md` overrides the Universal Turn with clock-based mechanics:

- **PCs opposed the faction:** tick the faction clock back 1–2 segments.
- **PCs ignored the faction:** advance the clock 1–2 segments (the plan proceeds).
- **PCs aided the faction:** advance the clock 2–3 segments.

Tier and Hold changes are layered on top: losing significant resources moves Hold from Strong → Weak or drops Tier by 1; consolidating power moves Hold from Weak → Strong. Tier changes are rare (every 5–10 sessions). Heat of 4+ means nearby factions notice. Score outcomes may create new faction threads, rep changes, and turf shifts.

The practical FitD Faction Turn (from `systems/fitd/factions.md`):
1. Select 2–4 relevant factions
2. Advance project clocks (fortune roll using Tier if outcome is uncertain)
3. Choose 1–2 downtime maneuvers for each faction
4. Deliver news through PC contacts or vice purveyors

#### Call of Cthulhu 7e (CoC)

`systems/coc-7e/session-procedures.md` overrides with narrative, not mechanical, advancement. **CoC does not use clocks, ticks, or segments.** Antagonists advance on a narrative arc — named stages of a plan that unfold through fiction.

Example (summoning cult):
| Stage | What's Happening | Visible Signs |
|---|---|---|
| Preparation | Gathering members, securing a location | Strange meetings, new faces |
| Gathering | Collecting ritual components, kidnapping | Disappearances, odd purchases |
| Ritual | Active ceremony | Chanting at night, lights on the reef |
| Culmination | The summoning attempt | The sky changes; stopping it quietly is no longer possible |

Advance one stage every 2–3 sessions if investigators don't intervene. Disruption doesn't reverse the stage — it changes the approach (find a substitute, accelerate, retaliate).

Investigator awareness is also tracked narratively (Unaware → Suspicious → Aware → Hostile), escalating at most one level per session. NPC loyalty is described as a gut feeling, not a number.

#### D&D 5e 2024

`systems/dnd-5e-2024/session-procedures.md` overrides with an influence-and-territory framework:

- **PCs cleared a dungeon / defeated a faction leader:** propose a power vacuum — which faction moves in?
- **PCs allied with a faction:** propose that faction expanding influence (new territory, recruits, resources).
- **PCs angered a faction:** propose escalation (bounty hunters, political pressure, military response).

Each faction turn should produce 1–2 potential quest hooks. Major military movements take 2–4 sessions to develop; political changes can happen in 1 session if triggered by PC action. Track inter-faction alliances — PC choices create and break them.

#### GURPS 4e / Generic

No override exists. Run the Universal Faction Turn as written.

---

### Where Faction Turn Results Are Stored

After the GM approves the proposals, file them using the standard post-session protocol:

- **New entities:** create a file per `shared/entity-schema.md`, setting `source: "play"`, `createdSession`, `lastUpdated`, and `asOfSession`.
- **Changed entities:** update changed fields only, then update `lastUpdated` and `asOfSession`.
- **Timeline entry:** append to `campaign-timeline.md`.

In a vault managed by campaign-organizer, hand new and changed entities to that skill. In simple-file mode, place them under `campaign/entities/{type}/`.

---

### Summary

| Step | Question |
|---|---|
| 1 | What is this faction's concrete current goal? |
| 2 | What's their next move without PC interference? (classify impact) |
| 3 | Did the PCs affect them this session? |
| 4 | What changes — advance, alter, delay, or derail? |
| 5 | What becomes visible to the PCs, and how? |

The Universal Faction Turn is the system-agnostic backbone. FitD, CoC 7e, and D&D 5e 2024 each layer their own mechanics on top of it. GURPS and generic campaigns use the baseline directly.
