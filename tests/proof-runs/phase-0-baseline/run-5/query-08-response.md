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

# Fortune Rolls in Blades in the Dark

A **Fortune Roll** is one of the four core roll types in Blades in the Dark (alongside Action Rolls, Resistance Rolls, and Downtime Rolls). Its purpose is to **disclaim GM decision-making** — when the GM doesn't want to arbitrarily decide an outcome, they put it to the dice.

---

## The Basics

**When to use it:** Any time the GM wants to let fate decide something that isn't a direct PC action. Common uses include:

- Determining how well an NPC performs an action
- Resolving the outcome of an off-screen event
- Gathering information when there's no obstacle (but the quality of info varies)
- The **Engagement Roll** at the start of a score
- Any situation where an outcome is uncertain but no PC action roll is appropriate

**What you roll:** A pool of d6s equal to the relevant **trait rating**. This could be:
- An NPC's relevant action rating
- A crew's Tier
- A faction's Tier
- The number of relevant factors (starting from 1d, modified up or down)
- Zero dice if there's little chance — roll 2d6 and take the lowest

---

## Result Table

| Result | Outcome |
|:---:|---------|
| **Crit** (two or more 6s) | Exceptional / extreme effect |
| **6** | Good / standard effect |
| **4–5** | Mixed / limited effect |
| **1–3** | Bad / poor effect |

Fortune Rolls use the same d6 pool resolution as action rolls: read the **single highest die**. A critical result (two or more 6s) represents an exceptional outcome beyond standard success.

---

## Common Fortune Roll Applications

### 1. Information Gathering
When there's no obstacle present but the information isn't common knowledge, the GM calls a fortune roll to determine the **quality of information** obtained. Effect level maps to detail:
- **Great effect** → exceptional detail
- **Standard effect** → good, useful information
- **Limited effect** → partial or incomplete picture

Complex questions may instead become a long-term project clock during downtime.

### 2. Engagement Roll (Score Opening)
The engagement roll is explicitly a Fortune Roll, starting from **1d** and modified by plan factors:

| Factor | Modifier |
|--------|:---:|
| Bold/daring plan | +1d |
| Overly complex/contingent | −1d |
| Detail exposes vulnerability | +1d |
| Target strongest vs this approach | −1d |
| Friends/contacts aid | +1d |
| Enemies/rivals interfere | −1d |
| Other advantage (e.g. lower-Tier target) | +1d |
| Other disadvantage (e.g. higher-Tier) | −1d |

The result sets the **opening position** for the first obstacle:

| Result | Opening Position |
|:---:|-----------------|
| Crit | Controlled; first obstacle already overcome |
| 6 | Controlled |
| 4–5 | Risky |
| 1–3 | Desperate |

### 3. NPC/Off-Screen Actions
When a faction or NPC acts without PC involvement, roll their Tier or relevant rating as a fortune roll to determine how well it goes.

---

## Downtime Rolls

Downtime Rolls use the **same result progression** as Fortune Rolls and are sometimes called interchangeable with them. The key activities (Acquire Asset, Long-Term Project, Recover, Reduce Heat) all follow:

| Result | Clock Ticks / Effect |
|:---:|----------------------|
| Crit | 5 ticks / exceptional |
| 6 | 3 ticks / good |
| 4–5 | 2 ticks / limited |
| 1–3 | 1 tick / poor |

A friend or contact assisting adds **+1d**. Spending **1 coin** after the roll increases the result by one level per coin spent.

---

## Key Design Note

Fortune Rolls have **no position and no consequences** in the action roll sense — they're purely about outcomes, not about PC risk. The GM uses them as a narrative tool to keep outcomes surprising and fair without unilaterally deciding "the enemy succeeds" or "your contact comes through." If you want a roll that carries PC stakes and potential player-driven consequences, use an Action Roll instead.

---

*Source: Blades in the Dark by John Harper (CC BY 3.0). Mechanics summarised from core rules.*
