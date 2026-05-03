---
query: "How do Fortune Rolls work in Blades in the Dark?"
system: fitd
type: lookup
total_tokens: 0
wall_clock_ms: 0
files_loaded:
  - skills/ttrpg-expert/SKILL.md
  - skills/ttrpg-expert/systems/fitd/mechanics.md
  - skills/ttrpg-expert/systems/fitd/rules-reference.md
  - skills/ttrpg-expert/systems/fitd/session-procedures.md
---

## Fortune Rolls in Blades in the Dark

A **Fortune Roll** is one of the four core roll types in Blades in the Dark (alongside Action Rolls, Resistance Rolls, and Downtime Rolls). Its primary purpose is to let the GM disclaim decision-making — rather than just deciding what happens, the GM rolls dice and lets the fiction answer.

---

### When to Use a Fortune Roll

Fortune rolls handle outcomes where:

- There is **no obstacle** in the fiction for a PC to overcome personally, but the outcome is **not common knowledge** — so neither a free GM answer nor a PC action roll is appropriate.
- The GM wants to let **chance or circumstance** determine how an NPC, faction, or off-screen event resolves.
- Measuring the **quality or magnitude of an effect** when no PC is directly driving it.

Examples:
- Does the informant the crew sent ahead succeed in their task?
- Does the rival crew manage to pull off their score?
- How well does the fence pay for the stolen goods?
- What is the opening position for a score? (The **Engagement Roll** is a special fortune roll.)

---

### How to Build the Dice Pool

Roll a number of d6s based on the relevant **trait rating** plus any applicable bonuses:

- **Trait rating** — the action rating, faction Tier, quality level, or other relevant stat. For example, if rolling for an NPC using Consort, use their Consort rating; if rolling for a faction's scheme, use their Tier.
- **No relevant trait** — roll 2d6 and take the **lowest** (zero-dice rule: cannot crit).
- **Bonuses** can be added for advantages in the fiction, just as with other roll types.

---

### Reading the Result

Read the **single highest die** (same as all FitD rolls):

| Result | Outcome |
|:---:|---------|
| **Crit** (two+ 6s) | Exceptional / extreme effect |
| **6** | Good / standard effect |
| **4–5** | Mixed / limited effect |
| **1–3** | Bad / poor effect |

---

### Specific Uses

#### Engagement Roll
The most structured fortune roll in the game. It determines the **opening position** for a score (controlled, risky, or desperate). It starts at 1d and is modified by:

| Factor | Modifier |
|--------|:---:|
| Bold or daring plan | +1d |
| Overly complex or contingent | −1d |
| Detail exposes a vulnerability | +1d |
| Target is strongest against this approach | −1d |
| Friends or contacts aid | +1d |
| Enemies or rivals interfere | −1d |
| Other advantage (e.g. lower-Tier target) | +1d |
| Other disadvantage (e.g. higher-Tier target) | −1d |

Engagement result → opening position:

| Result | Opening Position |
|:---:|-----------------|
| Crit | Controlled; first obstacle already overcome |
| 6 | Controlled |
| 4–5 | Risky |
| 1–3 | Desperate |

The engagement roll sets only the **starting position**. Subsequent rolls during the score follow normal position rules.

#### Gathering Information
When PCs want information and there is no personal obstacle to roll against but the answer is not freely known, the GM rolls a fortune roll and uses the **effect level** to determine detail and quality:

- **Great effect (crit/6):** exceptional detail, full picture.
- **Standard effect (4–5):** good information, partial picture.
- **Limited effect (1–3):** scant or misleading fragments.

#### NPC and Off-Screen Actions
When a faction, NPC, or allied cohort acts independently (not directly controlled by a PC), roll a fortune roll using their relevant Tier or action rating to see how well they succeed or fail.

#### Downtime Rolls
The **Downtime Roll** uses the same result progression as a fortune roll and applies to downtime activities (Acquire Asset, Long-Term Project, Recover, Reduce Heat). It is mechanically identical but named separately to distinguish its context.

---

### Key Design Intent

Fortune rolls exist so the **GM does not have to make arbitrary calls** about uncertain off-screen outcomes. They also prevent the game from stalling — if a PC cannot or should not be making an action roll, a fortune roll keeps the fiction moving without requiring a contrived obstacle. The result always advances the story: even a 1–3 is information about how badly something went, not a blank wall.

---

*Rules based on Blades in the Dark by John Harper. CC BY 3.0.*
